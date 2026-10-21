import { Injectable } from '@nestjs/common';
import { File } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Errors } from '../../common/exceptions/app.exception';
import { actorOf, ProjectContext } from '../../common/types';
import { paged } from '../../common/utils/pagination';
import {
  extensionOf,
  joinPath,
  normalizeName,
  normalizePath,
  numberedName,
  pathHash,
} from '../../common/utils/path.util';
import { isUniqueViolation, PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FoldersService } from '../../folders/services/folders.service';
import { JobsService } from '../../jobs/jobs.service';
import { QuotaService } from '../../quotas/quota.service';
import { StorageService } from '../../storage/storage.service';
import { ListFilesQuery, UpdateFileDto } from '../dto/file.dto';
import { FilesRepository } from '../repositories/files.repository';
import { FilePresenter } from './file-presenter.service';

/**
 * File metadata operations. Names and folders are logical: rename and move only touch
 * MySQL, copy is a server-side object copy, delete goes to the trash first.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesRepository,
    private readonly folders: FoldersService,
    private readonly storage: StorageService,
    private readonly quota: QuotaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly presenter: FilePresenter,
  ) {}

  async list(ctx: ProjectContext, q: ListFilesQuery) {
    let folderId: string | null | undefined;
    if (q.folderId === 'root') folderId = null;
    else if (q.folderId) folderId = (await this.folders.requireActive(ctx, q.folderId)).id;

    const { items, total } = await this.files.list({
      tenantId: ctx.tenantId,
      projectId: ctx.projectId,
      folderId,
      search: q.search?.trim() || undefined,
      pathPrefix: q.prefix ? q.prefix.replace(/^\/+/, '') : undefined,
      mimeType: q.mimeType,
      extension: q.extension,
      minSize: q.minSize,
      maxSize: q.maxSize,
      createdFrom: q.createdFrom,
      createdTo: q.createdTo,
      updatedFrom: q.updatedFrom,
      updatedTo: q.updatedTo,
      sort: q.sort,
      order: q.order,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
    return paged(await this.presenter.toDtos(items), total, q);
  }

  async get(ctx: ProjectContext, id: string) {
    return this.presenter.toDto(await this.requireLive(ctx, id));
  }

  /** Lookup by full logical path (objects API). */
  async getByPath(ctx: ProjectContext, rawPath: string): Promise<File> {
    const path = normalizePath(rawPath);
    const file = await this.files.findByPathHash(pathHash(ctx.projectId, path), ctx.tenantId, ctx.projectId);
    if (!file || file.deletedAt || !['AVAILABLE', 'PROCESSING', 'QUARANTINED'].includes(file.status)) {
      throw Errors.notFound('file');
    }
    return file;
  }

  async update(ctx: ProjectContext, id: string, dto: UpdateFileDto) {
    const file = await this.requireLive(ctx, id);
    let updated = file;
    if (dto.name !== undefined) {
      const name = normalizeName(dto.name, 'file name');
      if (name !== file.name) {
        const dir = file.path.slice(0, file.path.length - file.name.length).replace(/\/$/, '');
        updated = await this.relocate(ctx, file, joinPath(dir, name), { name, extension: extensionOf(name) });
        await this.audit.log(ctx, { action: 'FILE_RENAME', resourceType: 'FILE', resourceId: id, metadata: { from: file.path, to: updated.path } });
      }
    }
    if (dto.visibility !== undefined && dto.visibility !== updated.visibility) {
      updated = await this.files.update(id, { visibility: dto.visibility });
      await this.presenter.invalidatePublic(file.projectId, updated.path);
      await this.audit.log(ctx, { action: 'FILE_UPDATE', resourceType: 'FILE', resourceId: id, metadata: { visibility: dto.visibility } });
    }
    return this.presenter.toDto(updated);
  }

  async move(ctx: ProjectContext, id: string, targetFolderId: string | null) {
    const file = await this.requireLive(ctx, id);
    if (file.folderId === targetFolderId) return this.presenter.toDto(file);
    const target = targetFolderId ? await this.folders.requireActive(ctx, targetFolderId) : null;
    const updated = await this.relocate(ctx, file, joinPath(target?.path ?? '', file.name), { folderId: target?.id ?? null });
    await this.audit.log(ctx, { action: 'FILE_MOVE', resourceType: 'FILE', resourceId: id, metadata: { from: file.path, to: updated.path } });
    return this.presenter.toDto(updated);
  }

  /** New file with its own id and its own physical object (server-side copy, no re-upload). */
  async copy(ctx: ProjectContext, id: string, targetFolderId?: string | null, newName?: string) {
    const source = await this.requireLive(ctx, id);
    const folderId = targetFolderId === undefined ? source.folderId : targetFolderId;
    const target = folderId ? await this.folders.requireActive(ctx, folderId) : null;
    const dir = target?.path ?? '';
    const name = newName
      ? normalizeName(newName, 'file name')
      : await this.freeName(ctx, dir, source.name);
    const path = joinPath(dir, name);
    await this.folders.assertPathFree(ctx, path);

    const objectId = randomUUID();
    const key = this.storage.objectKey(ctx.tenantId, objectId);
    await this.storage.copy(source.storageKey, key);
    try {
      const copy = await this.prisma.$transaction(async (tx) => {
        await this.quota.apply(tx, ctx.tenantId, Number(source.sizeBytes), 1);
        const created = await this.files.create(
          {
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            folderId: target?.id ?? null,
            name,
            originalName: source.originalName,
            storedName: objectId,
            path,
            pathHash: pathHash(ctx.projectId, path),
            storageProvider: source.storageProvider,
            storageBucket: source.storageBucket,
            storageKey: key,
            mimeType: source.mimeType,
            extension: extensionOf(name),
            sizeBytes: source.sizeBytes,
            checksum: source.checksum,
            status: 'AVAILABLE',
            visibility: source.visibility,
            createdBy: actorOf(ctx).userId,
          },
          tx,
        );
        await this.files.createVersion(
          { tenantId: ctx.tenantId, fileId: created.id, versionNumber: 1, storageKey: key, sizeBytes: source.sizeBytes, checksum: source.checksum, mimeType: source.mimeType, createdBy: actorOf(ctx).userId },
          tx,
        );
        await this.audit.log(ctx, { action: 'FILE_COPY', resourceType: 'FILE', resourceId: created.id, metadata: { sourceId: source.id, path } }, tx);
        return created;
      });
      return this.presenter.toDto(copy);
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      if (isUniqueViolation(e)) throw this.pathTaken(path);
      throw e;
    }
  }

  /** Soft delete: to the trash, path freed, bytes kept (still counted) until purge. */
  async remove(ctx: ProjectContext, id: string) {
    const file = await this.requireLive(ctx, id);
    await this.prisma.$transaction(async (tx) => {
      const ok = await this.files.updateIfStatus(file.id, ctx.tenantId, ['AVAILABLE', 'PROCESSING', 'QUARANTINED'], {
        status: 'DELETED',
        deletedAt: new Date(),
        deleteBatchId: randomUUID(),
        isTrashRoot: true,
        pathHash: null,
      }, tx);
      if (!ok) throw Errors.notFound('file');
      await this.audit.log(ctx, { action: 'FILE_DELETE', resourceType: 'FILE', resourceId: id, metadata: { path: file.path } }, tx);
    });
    await this.presenter.invalidatePublic(file.projectId, file.path);
    return { deleted: true };
  }

  async restore(ctx: ProjectContext, id: string) {
    const file = await this.files.findById(id, ctx.tenantId, ctx.projectId);
    if (!file || file.status !== 'DELETED' || !file.isTrashRoot) throw Errors.notFound('file');
    if (file.folderId && !(await this.folders.requireActive(ctx, file.folderId).catch(() => null))) {
      throw Errors.conflict('PARENT_DELETED', 'The folder of this file is in the trash - restore it first');
    }
    await this.folders.assertPathFree(ctx, file.path);
    try {
      const restored = await this.prisma.$transaction(async (tx) => {
        const ok = await this.files.updateIfStatus(file.id, ctx.tenantId, ['DELETED'], {
          status: 'AVAILABLE',
          deletedAt: null,
          deleteBatchId: null,
          isTrashRoot: false,
          pathHash: pathHash(file.projectId, file.path),
        }, tx);
        if (!ok) throw Errors.notFound('file');
        await this.audit.log(ctx, { action: 'FILE_RESTORE', resourceType: 'FILE', resourceId: id, metadata: { path: file.path } }, tx);
        return this.files.findLiveById(file.id, ctx.tenantId, ctx.projectId, tx);
      });
      return this.presenter.toDto(restored!);
    } catch (e) {
      if (isUniqueViolation(e)) throw this.pathTaken(file.path);
      throw e;
    }
  }

  /** Irreversible. Works on live and trashed files; frees quota and deletes the bytes. */
  async permanentDelete(ctx: ProjectContext, id: string) {
    const file = await this.files.findById(id, ctx.tenantId, ctx.projectId);
    if (!file || !['AVAILABLE', 'PROCESSING', 'QUARANTINED', 'DELETED'].includes(file.status)) {
      throw Errors.notFound('file');
    }
    await this.purge(ctx, file);
    await this.audit.log(ctx, { action: 'FILE_PERMANENT_DELETE', resourceType: 'FILE', resourceId: id, metadata: { path: file.path, sizeBytes: Number(file.sizeBytes) } });
    return { deleted: true, bytesFreed: Number(file.sizeBytes) };
  }

  /** Shared with the trash-retention job and objects API. */
  async purge(ctx: Pick<ProjectContext, 'tenantId'>, file: File): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const ok = await this.files.updateIfStatus(file.id, ctx.tenantId, ['AVAILABLE', 'PROCESSING', 'QUARANTINED', 'DELETED'], {
        status: 'PERMANENTLY_DELETED',
        pathHash: null,
        isTrashRoot: false,
        deleteBatchId: null,
        deletedAt: file.deletedAt ?? new Date(),
      }, tx);
      if (!ok) throw Errors.notFound('file');
      await this.quota.apply(tx, ctx.tenantId, -Number(file.sizeBytes), -1);
    });
    await this.presenter.invalidatePublic(file.projectId, file.path);
    await this.jobs.dispatch('purge-objects', { keys: [file.storageKey] });
  }

  async listTrash(ctx: ProjectContext, page: number, limit: number) {
    const [items, total] = await this.files.listTrashRoots(ctx.tenantId, ctx.projectId, (page - 1) * limit, limit);
    const folders = page === 1 ? await this.folders.listTrash(ctx) : [];
    return { files: paged(await this.presenter.toDtos(items), total, { page, limit }), folders };
  }

  async bulkRemove(ctx: ProjectContext, ids: string[]) {
    return this.bulk(ids, (id) => this.remove(ctx, id));
  }

  async bulkMove(ctx: ProjectContext, ids: string[], targetFolderId: string | null) {
    return this.bulk(ids, (id) => this.move(ctx, id, targetFolderId));
  }

  async requireLive(ctx: ProjectContext, id: string): Promise<File> {
    const file = await this.files.findLiveById(id, ctx.tenantId, ctx.projectId);
    if (!file) throw Errors.notFound('file');
    return file;
  }

  /** "photo.jpg" or, if taken, the first free "photo (n).jpg". */
  async freeName(ctx: ProjectContext, dir: string, name: string): Promise<string> {
    for (let n = 0; n < 1000; n++) {
      const candidate = n === 0 ? name : numberedName(name, n);
      const hash = pathHash(ctx.projectId, joinPath(dir, candidate));
      const taken = await this.files.findByPathHash(hash, ctx.tenantId, ctx.projectId);
      if (!taken) return candidate;
    }
    throw Errors.conflict('PATH_EXISTS', `Could not find a free name for "${name}"`);
  }

  private async relocate(ctx: ProjectContext, file: File, newPath: string, data: { name?: string; extension?: string; folderId?: string | null }) {
    await this.folders.assertPathFree(ctx, newPath);
    try {
      const updated = await this.files.update(file.id, { ...data, path: newPath, pathHash: pathHash(file.projectId, newPath) });
      await this.presenter.invalidatePublic(file.projectId, file.path, newPath);
      return updated;
    } catch (e) {
      if (isUniqueViolation(e)) throw this.pathTaken(newPath);
      throw e;
    }
  }

  private async bulk(ids: string[], op: (id: string) => Promise<unknown>) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        await op(id);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as { code?: string }).code ?? 'FAILED' });
      }
    }
    return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  private pathTaken(path: string) {
    return Errors.conflict('PATH_EXISTS', `Something named "${path}" already exists`);
  }
}
