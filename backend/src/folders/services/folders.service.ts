import { Injectable } from '@nestjs/common';
import { Folder } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Errors } from '../../common/exceptions/app.exception';
import { actorOf, ProjectContext } from '../../common/types';
import { joinPath, normalizeFolderPath, normalizeName, pathHash } from '../../common/utils/path.util';
import { isUniqueViolation, PrismaService, Tx } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FilesRepository } from '../../files/repositories/files.repository';
import { JobsService } from '../../jobs/jobs.service';
import { QuotaService } from '../../quotas/quota.service';
import { FoldersRepository } from '../repositories/folders.repository';

export const toFolderDto = (f: Folder) => ({
  id: f.id,
  projectId: f.projectId,
  parentId: f.parentId,
  name: f.name,
  path: f.path,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
  deletedAt: f.deletedAt,
});

/**
 * Logical folder tree, kept entirely in MySQL. Physical objects never move: renaming or
 * moving a folder only rewrites metadata paths, however many files it contains.
 */
@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly folders: FoldersRepository,
    private readonly files: FilesRepository,
    private readonly quota: QuotaService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: ProjectContext, parentId?: string) {
    if (parentId) await this.requireActive(ctx, parentId);
    return (await this.folders.listChildren(ctx.tenantId, ctx.projectId, parentId ?? null)).map(toFolderDto);
  }

  async get(ctx: ProjectContext, id: string) {
    const folder = await this.requireActive(ctx, id);
    const chain = await this.folders.ancestors(folder.id, ctx.tenantId);
    return {
      ...toFolderDto(folder),
      breadcrumb: chain.map((c) => ({ id: c.id, name: c.name, path: c.path })),
    };
  }

  async create(ctx: ProjectContext, name: string, parentId?: string | null) {
    const cleanName = normalizeName(name, 'folder name');
    const parent = parentId ? await this.requireActive(ctx, parentId) : null;
    const path = joinPath(parent?.path ?? '', cleanName);
    await this.assertPathFree(ctx, path);
    try {
      const folder = await this.folders.create({
        tenantId: ctx.tenantId,
        projectId: ctx.projectId,
        parentId: parent?.id ?? null,
        name: cleanName,
        path,
        pathHash: pathHash(ctx.projectId, path),
        createdBy: actorOf(ctx).userId,
      });
      await this.audit.log(ctx, { action: 'FOLDER_CREATE', resourceType: 'FOLDER', resourceId: folder.id, metadata: { path } });
      return toFolderDto(folder);
    } catch (e) {
      if (isUniqueViolation(e)) throw this.pathTaken(path);
      throw e;
    }
  }

  /**
   * mkdir -p: returns the id of the folder at `dirPath`, creating missing levels.
   * Safe under concurrency - a lost creation race just re-reads the winner's row.
   */
  async ensurePath(ctx: ProjectContext, dirPath: string): Promise<string | null> {
    const normalized = normalizeFolderPath(dirPath);
    if (!normalized) return null;
    let parentId: string | null = null;
    let current = '';
    for (const segment of normalized.split('/')) {
      current = joinPath(current, segment);
      const hash = pathHash(ctx.projectId, current);
      let folder = await this.folders.findActiveByPathHash(hash, ctx.tenantId, ctx.projectId);
      if (!folder) {
        if (await this.files.findByPathHash(hash, ctx.tenantId, ctx.projectId)) {
          throw Errors.conflict('PATH_IS_FILE', `"${current}" is a file, not a folder`);
        }
        try {
          folder = await this.folders.create({
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
            parentId,
            name: segment,
            path: current,
            pathHash: hash,
            createdBy: actorOf(ctx).userId,
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
          folder = await this.folders.findActiveByPathHash(hash, ctx.tenantId, ctx.projectId);
          if (!folder) throw e;
        }
      }
      parentId = folder.id;
    }
    return parentId;
  }

  async rename(ctx: ProjectContext, id: string, name: string) {
    const folder = await this.requireActive(ctx, id);
    const cleanName = normalizeName(name, 'folder name');
    if (cleanName === folder.name) return toFolderDto(folder);
    const parentPath = folder.path.slice(0, folder.path.length - folder.name.length).replace(/\/$/, '');
    const newPath = joinPath(parentPath, cleanName);
    await this.relocate(ctx, folder, newPath, { name: cleanName });
    await this.audit.log(ctx, { action: 'FOLDER_RENAME', resourceType: 'FOLDER', resourceId: id, metadata: { from: folder.path, to: newPath } });
    return toFolderDto((await this.folders.findActiveById(id, ctx.tenantId, ctx.projectId))!);
  }

  async move(ctx: ProjectContext, id: string, targetParentId: string | null) {
    const folder = await this.requireActive(ctx, id);
    if (targetParentId === folder.parentId) return toFolderDto(folder);
    const target = targetParentId ? await this.requireActive(ctx, targetParentId) : null;
    if (target && (target.id === folder.id || target.path.startsWith(`${folder.path}/`))) {
      throw Errors.badRequest('INVALID_MOVE', 'A folder cannot be moved into itself or one of its subfolders');
    }
    const newPath = joinPath(target?.path ?? '', folder.name);
    await this.relocate(ctx, folder, newPath, { parentId: target?.id ?? null });
    await this.audit.log(ctx, { action: 'FOLDER_MOVE', resourceType: 'FOLDER', resourceId: id, metadata: { from: folder.path, to: newPath } });
    return toFolderDto((await this.folders.findActiveById(id, ctx.tenantId, ctx.projectId))!);
  }

  /** Soft delete: the folder, its subfolders and their files go to the trash as one batch. */
  async remove(ctx: ProjectContext, id: string) {
    const folder = await this.requireActive(ctx, id);
    const batchId = randomUUID();
    const { count } = await this.prisma.$transaction(async (tx) => {
      const ids = await this.folders.subtreeIds(folder.id, ctx.tenantId, tx);
      const result = await this.folders.trashSubtree(tx, ctx.tenantId, folder.id, ids, batchId, new Date());
      await this.audit.log(ctx, { action: 'FOLDER_DELETE', resourceType: 'FOLDER', resourceId: id, metadata: { path: folder.path, folders: ids.length } }, tx);
      return result;
    });
    return { deleted: true, filesTrashed: count };
  }

  async restore(ctx: ProjectContext, id: string) {
    const folder = await this.folders.findById(id, ctx.tenantId, ctx.projectId);
    if (!folder || !folder.isTrashRoot || !folder.deleteBatchId) throw Errors.notFound('folder');
    if (folder.parentId && !(await this.folders.findActiveById(folder.parentId, ctx.tenantId, ctx.projectId))) {
      throw Errors.conflict('PARENT_DELETED', 'The parent folder is in the trash - restore it first');
    }
    await this.assertPathFree(ctx, folder.path);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.folders.restoreBatch(tx, ctx.tenantId, folder.deleteBatchId!);
        await this.audit.log(ctx, { action: 'FOLDER_RESTORE', resourceType: 'FOLDER', resourceId: id, metadata: { path: folder.path } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw this.pathTaken(folder.path);
      throw e;
    }
    return toFolderDto((await this.folders.findActiveById(id, ctx.tenantId, ctx.projectId))!);
  }

  /** Irreversible: every file in the subtree (trashed or not) is destroyed and its bytes freed. */
  async permanentDelete(ctx: ProjectContext, id: string) {
    const folder = await this.folders.findById(id, ctx.tenantId, ctx.projectId);
    if (!folder || (folder.deletedAt && !folder.isTrashRoot)) throw Errors.notFound('folder');
    const result = await this.purgeSubtree(ctx, folder);
    await this.audit.log(ctx, {
      action: 'FOLDER_PERMANENT_DELETE',
      resourceType: 'FOLDER',
      resourceId: id,
      metadata: { path: folder.path, files: result.files, bytes: result.bytes },
    });
    return { deleted: true, filesDeleted: result.files, bytesFreed: result.bytes };
  }

  /** Shared with the trash-retention job. */
  async purgeSubtree(ctx: Pick<ProjectContext, 'tenantId'>, folder: Folder) {
    const { keys, files, bytes } = await this.prisma.$transaction(async (tx) => {
      const ids = await this.folders.subtreeIds(folder.id, ctx.tenantId, tx);
      const victims = await this.files.findInFolders(ctx.tenantId, ids, tx);
      const bytes = victims.reduce((sum, f) => sum + Number(f.sizeBytes), 0);
      await this.files.markPermanentlyDeleted(ctx.tenantId, victims.map((v) => v.id), tx);
      await this.folders.tombstone(tx, ctx.tenantId, ids, new Date());
      await this.quota.apply(tx, ctx.tenantId, -bytes, -victims.length);
      return { keys: victims.map((v) => v.storageKey), files: victims.length, bytes };
    });
    if (keys.length > 0) await this.jobs.dispatch('purge-objects', { keys });
    return { files, bytes };
  }

  listTrash(ctx: ProjectContext) {
    return this.folders.listTrashRoots(ctx.tenantId, ctx.projectId).then((rows) => rows.map(toFolderDto));
  }

  /** Throws FOLDER_NOT_FOUND for missing, trashed or other-tenant folders alike. */
  async requireActive(ctx: ProjectContext, id: string, tx?: Tx): Promise<Folder> {
    const folder = await this.folders.findActiveById(id, ctx.tenantId, ctx.projectId, tx);
    if (!folder) throw Errors.notFound('folder');
    return folder;
  }

  /** A path may be held by one live folder or one live/pending file, never both. */
  async assertPathFree(ctx: ProjectContext, path: string): Promise<void> {
    const hash = pathHash(ctx.projectId, path);
    const [folder, file] = await Promise.all([
      this.folders.findActiveByPathHash(hash, ctx.tenantId, ctx.projectId),
      this.files.findByPathHash(hash, ctx.tenantId, ctx.projectId),
    ]);
    if (folder || file) throw this.pathTaken(path);
  }

  private async relocate(ctx: ProjectContext, folder: Folder, newPath: string, data: { name?: string; parentId?: string | null }) {
    await this.assertPathFree(ctx, newPath);
    try {
      await this.prisma.$transaction(async (tx) => {
        const ids = await this.folders.subtreeIds(folder.id, ctx.tenantId, tx);
        await this.folders.update(folder.id, ctx.tenantId, data, tx);
        await this.folders.rewritePaths(tx, ctx.tenantId, ids, folder.path, newPath);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw this.pathTaken(newPath);
      throw e;
    }
  }

  private pathTaken(path: string) {
    return Errors.conflict('PATH_EXISTS', `Something named "${path}" already exists`);
  }
}
