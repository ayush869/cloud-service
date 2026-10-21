import '@fastify/multipart';
import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Visibility } from '@prisma/client';
import { FastifyRequest } from 'fastify';
import { API_PREFIX } from '../../common/constants';
import { CurrentContext, Idempotent, Public, RateLimit, RequirePermissions } from '../../common/decorators';
import { Errors } from '../../common/exceptions/app.exception';
import { AuthContext } from '../../common/types';
import { rawBodyStream } from '../../common/utils/raw-body';
import { requireProject } from '../../common/utils/project-context';
import { ConflictStrategy, DirectUploadQuery, PresignUploadDto, UploadContentQuery } from '../dto/upload.dto';
import { UploadsService } from '../services/uploads.service';

@ApiTags('Uploads')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Project-Id', required: false, description: 'Required for dashboard (JWT) calls; implied by API keys' })
@Controller(`${API_PREFIX}/uploads`)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Direct upload (multipart/form-data, field "file"). Streams to disk - suitable for
   * server-to-server uploads of any size. Options may be query params or form fields
   * placed before the file: path | folderId | folderPath, visibility, onConflict.
   */
  @Post()
  @RequirePermissions('files.upload')
  @Idempotent()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async direct(@CurrentContext() ctx: AuthContext, @Req() req: FastifyRequest, @Query() q: DirectUploadQuery) {
    const project = requireProject(ctx);
    if (!req.isMultipart()) throw Errors.badRequest('MULTIPART_REQUIRED', 'Send the file as multipart/form-data');
    const part = await req.file();
    if (!part) throw Errors.badRequest('FILE_REQUIRED', 'No file part named "file" in the request');
    const field = (name: string): string | undefined => {
      const f = part.fields[name];
      const one = Array.isArray(f) ? f[0] : f;
      return one && one.type === 'field' ? String(one.value) : undefined;
    };
    const visibility = (q.visibility ?? field('visibility')) as Visibility | undefined;
    if (visibility && visibility !== 'PUBLIC' && visibility !== 'PRIVATE') throw Errors.validation('visibility must be PUBLIC or PRIVATE');
    const onConflict = (q.onConflict ?? field('onConflict') ?? 'rename') as ConflictStrategy;
    if (!['error', 'rename', 'overwrite'].includes(onConflict)) throw Errors.validation('onConflict must be error, rename or overwrite');

    return this.uploads.ingest(project, part.file, {
      path: q.path ?? field('path'),
      name: part.filename,
      folderId: q.folderId ?? field('folderId'),
      folderPath: q.folderPath ?? field('folderPath'),
      visibility,
      onConflict,
    });
  }

  /** Step 1 of a browser upload: reserve the file and get a short-lived signed PUT URL. */
  @Post('presign')
  @RequirePermissions('files.upload')
  @RateLimit('presign')
  @Idempotent()
  presign(@CurrentContext() ctx: AuthContext, @Body() dto: PresignUploadDto) {
    return this.uploads.presign(requireProject(ctx), dto);
  }

  /** Step 2: the client PUTs the raw bytes to uploadUrl. Authorized by the signed token only. */
  @Put(':id/content')
  @Public()
  @RateLimit('none')
  @ApiConsumes('application/octet-stream')
  receive(@Param('id', ParseUUIDPipe) id: string, @Query() q: UploadContentQuery, @Req() req: FastifyRequest) {
    const body = rawBodyStream(req);
    if (!body) throw Errors.badRequest('BODY_REQUIRED', 'Send the file bytes as the request body');
    const length = req.headers['content-length'];
    return this.uploads.receiveContent(id, q.token, body, length !== undefined ? Number(length) : undefined);
  }

  /** Step 3: verify the object and make the file available. */
  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('files.upload')
  @Idempotent()
  complete(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.uploads.complete(requireProject(ctx), id);
  }
}
