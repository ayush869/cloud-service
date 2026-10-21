import { Controller, Delete, Get, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { FastifyReply, FastifyRequest } from 'fastify';
import { API_PREFIX } from '../common/constants';
import { CurrentContext, Idempotent, RequirePermissions } from '../common/decorators';
import { Errors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/types';
import { rawBodyStream } from '../common/utils/raw-body';
import { requireProject } from '../common/utils/project-context';
import { DeleteByPathQuery, ListFilesQuery, PathQuery } from '../files/dto/file.dto';
import { FilePresenter } from '../files/services/file-presenter.service';
import { FilesService } from '../files/services/files.service';
import { DirectUploadQuery } from '../uploads/dto/upload.dto';
import { UploadsService } from '../uploads/services/uploads.service';
import { FileServingService } from '../downloads/services/file-serving.service';
import { ImageVariantsService } from '../storage/image-variants.service';

class GetObjectQuery extends PathQuery {
  @IsOptional()
  @IsIn(['thumb', 'small', 'medium', 'large'])
  v?: string;
}

/**
 * S3-style API addressed by path - the drop-in replacement for putObject / getObject /
 * headObject / deleteObject in server-side code (e.g. the Laravel UploadHelper).
 *
 *   PUT    /api/v1/objects?path=a/b/c.jpg&visibility=PUBLIC   body = raw bytes
 *   GET    /api/v1/objects?path=a/b/c.jpg                      -> bytes (HEAD -> headers only)
 *   GET    /api/v1/objects/meta?path=a/b/c.jpg                 -> JSON metadata (+ public url)
 *   GET    /api/v1/objects/list?prefix=a/b/                    -> JSON listing
 *   DELETE /api/v1/objects?path=a/b/c.jpg[&permanent=true]
 */
@ApiTags('Objects (path API)')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Project-Id', required: false, description: 'Required for dashboard (JWT) calls; implied by API keys' })
@Controller(`${API_PREFIX}/objects`)
export class ObjectsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly files: FilesService,
    private readonly presenter: FilePresenter,
    private readonly serving: FileServingService,
    private readonly variants: ImageVariantsService,
  ) {}

  /** Creates or (by default) overwrites the object at `path`. Body = raw file bytes. */
  @Put()
  @RequirePermissions('files.upload')
  @Idempotent()
  @ApiConsumes('application/octet-stream')
  put(@CurrentContext() ctx: AuthContext, @Query() q: DirectUploadQuery, @Req() req: FastifyRequest) {
    if (!q.path) throw Errors.validation('path is required');
    const body = rawBodyStream(req);
    if (!body) throw Errors.badRequest('BODY_REQUIRED', 'Send the file bytes as the request body');
    const length = req.headers['content-length'];
    return this.uploads.ingest(requireProject(ctx), body, {
      path: q.path,
      declaredSize: length !== undefined ? Number(length) : undefined,
      visibility: q.visibility,
      onConflict: q.onConflict ?? 'overwrite',
    });
  }

  /** Streams the object (works for private files; authenticated by the API key). */
  @Get()
  @RequirePermissions('files.read')
  async get(@CurrentContext() ctx: AuthContext, @Query() q: GetObjectQuery, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const file = await this.files.getByPath(requireProject(ctx), q.path);
    let servable = {
      storageKey: file.storageKey,
      mimeType: file.mimeType,
      size: Number(file.sizeBytes),
      etag: `"${(file.checksum ?? file.storedName).slice(0, 32)}"`,
      lastModifiedMs: file.updatedAt.getTime(),
      filename: file.name,
    };
    if (q.v && this.variants.supports(file.mimeType)) {
      const variant = await this.variants.ensureWithSize(file, q.v);
      if (variant) servable = { ...servable, storageKey: variant.key, size: variant.size, mimeType: 'image/webp', etag: servable.etag.replace(/"$/, `-${q.v}"`) };
    }
    await this.serving.send(req, reply, servable, { cacheControl: 'private, no-cache', disposition: 'attachment' });
  }

  @Get('meta')
  @RequirePermissions('files.read')
  async meta(@CurrentContext() ctx: AuthContext, @Query() q: PathQuery) {
    return this.presenter.toDto(await this.files.getByPath(requireProject(ctx), q.path));
  }

  @Get('list')
  @RequirePermissions('files.read')
  list(@CurrentContext() ctx: AuthContext, @Query() q: ListFilesQuery) {
    return this.files.list(requireProject(ctx), q);
  }

  /** Moves the object to the trash, or destroys it with permanent=true. */
  @Delete()
  @RequirePermissions('files.delete')
  async remove(@CurrentContext() ctx: AuthContext, @Query() q: DeleteByPathQuery) {
    const project = requireProject(ctx);
    const file = await this.files.getByPath(project, q.path);
    return q.permanent ? this.files.permanentDelete(project, file.id) : this.files.remove(project, file.id);
  }
}
