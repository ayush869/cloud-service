import { Inject, Injectable } from '@nestjs/common';
import { File } from '@prisma/client';
import { storageConfig, StorageConfig } from '../../config';
import { CacheKeys } from '../../common/constants';
import { Errors } from '../../common/exceptions/app.exception';
import { ProjectContext } from '../../common/types';
import { normalizePath, pathHash } from '../../common/utils/path.util';
import { AuditService } from '../../audit/audit.service';
import { FilesRepository } from '../../files/repositories/files.repository';
import { ProjectsRepository } from '../../projects/repositories/projects.repository';
import { CacheService } from '../../redis/cache.service';
import { ImageVariantsService, isVariantName } from '../../storage/image-variants.service';
import { SignedUrlService } from '../../storage/signed-url.service';
import { DownloadQuery } from '../../files/dto/file.dto';
import { invalidLink, Servable } from './file-serving.service';

interface CachedPublicProject {
  projectId: string;
  tenantId: string;
  active: boolean;
}

interface CachedPublicFile extends Servable {
  tenantId: string;
  storedName: string;
}

const etagOf = (checksum: string | null, fallback: string, variant?: string) =>
  `"${(checksum ?? fallback).slice(0, 32)}${variant ? `-${variant}` : ''}"`;

@Injectable()
export class DownloadsService {
  constructor(
    private readonly files: FilesRepository,
    private readonly projects: ProjectsRepository,
    private readonly variants: ImageVariantsService,
    private readonly signer: SignedUrlService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    @Inject(storageConfig.KEY) private readonly config: StorageConfig,
  ) {}

  /** Short-lived signed link for a private (or public) file. Never a permanent URL. */
  async createLink(ctx: ProjectContext, fileId: string, q: DownloadQuery) {
    const file = await this.files.findLiveById(fileId, ctx.tenantId, ctx.projectId);
    if (!file || file.status !== 'AVAILABLE') throw Errors.notFound('file');
    if (q.variant && !this.variants.supports(file.mimeType)) {
      throw Errors.badRequest('VARIANT_NOT_SUPPORTED', 'Variants are only available for images');
    }
    const max = this.config.downloadUrlExpires * 12;
    const expiresIn = Math.min(Math.max(q.expiresIn ?? this.config.downloadUrlExpires, 10), max);
    const downloadUrl = this.signer.downloadUrl(
      { f: file.id, t: ctx.tenantId, ...(q.variant ? { v: q.variant } : {}), ...(q.disposition === 'attachment' ? { a: true } : {}) },
      expiresIn,
    );
    this.audit.logAsync(ctx, { action: 'FILE_DOWNLOAD', resourceType: 'FILE', resourceId: file.id, metadata: { path: file.path, variant: q.variant } });
    return { downloadUrl, expiresIn, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  /** Resolves a /d/{token} link. */
  async resolveSigned(token: string): Promise<{ servable: Servable; attachment: boolean; maxAge: number }> {
    const grant = this.signer.verifyDownload(token);
    if (!grant) throw invalidLink();
    const file = await this.files.findLiveByIdForTenant(grant.f, grant.t);
    if (!file || file.status !== 'AVAILABLE') throw Errors.notFound('file');
    const servable = grant.v ? await this.variantServable(this.toCached(file), grant.v) : this.toCached(file);
    return { servable, attachment: !!grant.a, maxAge: this.config.downloadUrlExpires };
  }

  /** Resolves /p/{tenant}/{project}/{path} - PUBLIC + AVAILABLE files only. Cached both ways. */
  async resolvePublic(tenantSlug: string, projectSlug: string, rawPath: string, variant?: string): Promise<Servable> {
    const project = await this.cache.wrap<CachedPublicProject | null>(
      CacheKeys.publicProject(tenantSlug, projectSlug),
      (p) => (p ? 300 : 30),
      async () => {
        const row = await this.projects.findPublicBySlugs(tenantSlug, projectSlug);
        return row ? { projectId: row.id, tenantId: row.tenantId, active: row.status === 'ACTIVE' && row.tenant.status === 'ACTIVE' } : null;
      },
    );
    if (!project || !project.active) throw Errors.notFound('file');

    let path: string;
    try {
      path = normalizePath(rawPath);
    } catch {
      throw Errors.notFound('file');
    }
    const hash = pathHash(project.projectId, path);
    const file = await this.cache.wrap<CachedPublicFile | null>(
      CacheKeys.publicFile(project.projectId, hash),
      (f) => (f ? 60 : 10),
      async () => {
        const row = await this.files.findPublicByPathHash(hash, project.tenantId, project.projectId);
        return row
          ? {
              tenantId: project.tenantId,
              storedName: row.storedName,
              storageKey: row.storageKey,
              mimeType: row.mimeType,
              size: Number(row.sizeBytes),
              etag: etagOf(row.checksum, row.storedName),
              lastModifiedMs: row.updatedAt.getTime(),
              filename: row.name,
            }
          : null;
      },
    );
    if (!file) throw Errors.notFound('file');
    if (variant === undefined) return file;
    if (!isVariantName(variant) || !this.variants.supports(file.mimeType)) return file;
    return this.variantServable(file, variant);
  }

  private toCached(file: File): CachedPublicFile {
    return {
      tenantId: file.tenantId,
      storedName: file.storedName,
      storageKey: file.storageKey,
      mimeType: file.mimeType,
      size: Number(file.sizeBytes),
      etag: etagOf(file.checksum, file.storedName),
      lastModifiedMs: file.updatedAt.getTime(),
      filename: file.name,
    };
  }

  /** Falls back to the original if the variant cannot be produced (e.g. corrupt image). */
  private async variantServable(file: CachedPublicFile, variant: string): Promise<Servable> {
    const result = await this.variants.ensureWithSize(
      { tenantId: file.tenantId, storedName: file.storedName, storageKey: file.storageKey, mimeType: file.mimeType },
      variant,
    );
    if (!result) return file;
    return {
      storageKey: result.key,
      mimeType: 'image/webp',
      size: result.size,
      etag: file.etag.replace(/"$/, `-${variant}"`),
      lastModifiedMs: file.lastModifiedMs,
      filename: file.filename.replace(/\.[^.]+$/, '') + `-${variant}.webp`,
    };
  }
}
