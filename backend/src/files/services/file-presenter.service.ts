import { Injectable } from '@nestjs/common';
import { File } from '@prisma/client';
import { CacheKeys } from '../../common/constants';
import { isRasterImage } from '../../common/utils/file-type.util';
import { encodePathForUrl, pathHash } from '../../common/utils/path.util';
import { ProjectsService } from '../../projects/services/projects.service';
import { CacheService } from '../../redis/cache.service';
import { VARIANTS } from '../../storage/image-variants.service';

export type FileDto = ReturnType<FilePresenter['present']>;

/** Turns file rows into API responses (BigInt -> number, public URLs, variant URLs). */
@Injectable()
export class FilePresenter {
  constructor(
    private readonly projects: ProjectsService,
    private readonly cache: CacheService,
  ) {}

  async toDto(file: File): Promise<FileDto> {
    const base = file.visibility === 'PUBLIC' ? await this.projects.publicBaseFor(file.tenantId, file.projectId) : null;
    return this.present(file, base);
  }

  async toDtos(files: File[]): Promise<FileDto[]> {
    const bases = new Map<string, string>();
    for (const f of files) {
      if (f.visibility === 'PUBLIC' && !bases.has(f.projectId)) {
        bases.set(f.projectId, await this.projects.publicBaseFor(f.tenantId, f.projectId));
      }
    }
    return files.map((f) => this.present(f, bases.get(f.projectId) ?? null));
  }

  present(file: File, publicBase: string | null) {
    const url = publicBase && file.status === 'AVAILABLE' ? `${publicBase}/${encodePathForUrl(file.path)}` : null;
    return {
      id: file.id,
      projectId: file.projectId,
      folderId: file.folderId,
      name: file.name,
      originalName: file.originalName,
      path: file.path,
      mimeType: file.mimeType,
      extension: file.extension,
      sizeBytes: Number(file.sizeBytes),
      checksum: file.checksum,
      status: file.status,
      visibility: file.visibility,
      version: file.version,
      /** Permanent URL - only for PUBLIC files. Private files use GET /files/:id/download. */
      url,
      /** WebP renditions for images (generated on first request if not ready yet). */
      variants:
        url && isRasterImage(file.mimeType)
          ? Object.fromEntries(Object.keys(VARIANTS).map((v) => [v, `${url}?v=${v}`]))
          : null,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      deletedAt: file.deletedAt,
    };
  }

  /** Drops the public-URL lookup cache for a path (call with old and new paths). */
  async invalidatePublic(projectId: string, ...paths: string[]): Promise<void> {
    await this.cache.del(...paths.map((p) => CacheKeys.publicFile(projectId, pathHash(projectId, p))));
  }
}
