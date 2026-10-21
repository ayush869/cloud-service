import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiHeader, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { storageConfig, StorageConfig } from '../../config';
import { Inject } from '@nestjs/common';
import { API_PREFIX } from '../../common/constants';
import { CurrentContext, Public, RateLimit, RequirePermissions } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { requireProject } from '../../common/utils/project-context';
import { DownloadQuery } from '../../files/dto/file.dto';
import { DownloadsService } from '../services/downloads.service';
import { FileServingService } from '../services/file-serving.service';

@ApiTags('Downloads')
@Controller()
export class DownloadsController {
  constructor(
    private readonly downloads: DownloadsService,
    private readonly serving: FileServingService,
    @Inject(storageConfig.KEY) private readonly config: StorageConfig,
  ) {}

  /** Returns a short-lived signed URL. The URL itself needs no credentials. */
  @Get(`${API_PREFIX}/files/:id/download`)
  @ApiBearerAuth()
  @ApiHeader({ name: 'X-Project-Id', required: false })
  @RequirePermissions('files.read')
  @RateLimit('download')
  createLink(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: DownloadQuery) {
    return this.downloads.createLink(requireProject(ctx), id, q);
  }

  /** Signed download link target. */
  @Get('d/:token')
  @Public()
  @RateLimit('download')
  @ApiExcludeEndpoint()
  async signed(@Param('token') token: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const { servable, attachment, maxAge } = await this.downloads.resolveSigned(token);
    await this.serving.send(req, reply, servable, {
      cacheControl: `private, max-age=${maxAge}`,
      disposition: attachment ? 'attachment' : 'inline',
    });
  }

  /**
   * Permanent URL of a PUBLIC file: /p/{tenantSlug}/{projectSlug}/{path}[?v=thumb|small|medium|large]
   * This is the hot path for website images - fully cached lookup, no auth, no rate-limit round trip.
   */
  @Get('p/:tenant/:project/*')
  @Public()
  @RateLimit('none')
  @ApiExcludeEndpoint()
  async publicFile(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const params = req.params as Record<string, string>;
    const variant = (req.query as Record<string, string | undefined>).v;
    const servable = await this.downloads.resolvePublic(params.tenant, params.project, params['*'] ?? '', variant);
    await this.serving.send(req, reply, servable, {
      cacheControl: `public, max-age=${this.config.publicCacheMaxAge}`,
      disposition: 'inline',
      anyOrigin: true,
    });
  }
}
