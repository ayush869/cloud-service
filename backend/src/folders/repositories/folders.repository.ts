import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';

const ACTIVE = { deletedAt: null } as const;

/**
 * Folder metadata. Every method takes tenantId (and projectId where relevant): there is
 * no way to address a folder by id alone.
 */
@Injectable()
export class FoldersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveById(id: string, tenantId: string, projectId: string, tx?: Tx) {
    return (tx ?? this.prisma).folder.findFirst({ where: { id, tenantId, projectId, ...ACTIVE } });
  }

  /** Includes trashed folders (restore / permanent delete). */
  findById(id: string, tenantId: string, projectId: string) {
    return this.prisma.folder.findFirst({ where: { id, tenantId, projectId } });
  }

  findActiveByPathHash(pathHash: string, tenantId: string, projectId: string, tx?: Tx) {
    return (tx ?? this.prisma).folder.findFirst({ where: { pathHash, tenantId, projectId } });
  }

  listChildren(tenantId: string, projectId: string, parentId: string | null) {
    return this.prisma.folder.findMany({
      where: { tenantId, projectId, parentId, ...ACTIVE },
      orderBy: { name: 'asc' },
    });
  }

  create(data: Prisma.FolderUncheckedCreateInput, tx?: Tx) {
    return (tx ?? this.prisma).folder.create({ data });
  }

  async update(id: string, tenantId: string, data: Prisma.FolderUncheckedUpdateManyInput, tx: Tx) {
    await tx.folder.updateMany({ where: { id, tenantId }, data });
  }

  /** Root first. Uses the parent chain, so it is correct for trashed folders too. */
  async ancestors(id: string, tenantId: string) {
    return this.prisma.$queryRaw<{ id: string; name: string; path: string; depth: number }[]>`
      WITH RECURSIVE chain (id, name, path, parent_id, depth) AS (
        SELECT id, name, path, parent_id, 0 FROM folders WHERE id = ${id} AND tenant_id = ${tenantId}
        UNION ALL
        SELECT f.id, f.name, f.path, f.parent_id, c.depth + 1
        FROM folders f JOIN chain c ON f.id = c.parent_id
        WHERE f.tenant_id = ${tenantId}
      )
      SELECT id, name, path, depth FROM chain ORDER BY depth DESC`;
  }

  /** The folder and all its descendants, trashed ones included. */
  async subtreeIds(id: string, tenantId: string, tx?: Tx): Promise<string[]> {
    const rows = await (tx ?? this.prisma).$queryRaw<{ id: string }[]>`
      WITH RECURSIVE sub (id) AS (
        SELECT id FROM folders WHERE id = ${id} AND tenant_id = ${tenantId}
        UNION ALL
        SELECT f.id FROM folders f JOIN sub s ON f.parent_id = s.id WHERE f.tenant_id = ${tenantId}
      )
      SELECT id FROM sub`;
    return rows.map((r) => r.id);
  }

  /**
   * Rewrites the "oldPath" prefix to "newPath" for every folder and file in the subtree.
   * path_hash is assigned before path so it is computed from the old value regardless of
   * the server's assignment semantics; trashed rows keep path_hash NULL.
   */
  async rewritePaths(tx: Tx, tenantId: string, folderIds: string[], oldPath: string, newPath: string) {
    if (folderIds.length === 0) return;
    const ids = Prisma.join(folderIds);
    await tx.$executeRaw`
      UPDATE folders
      SET path_hash = IF(path_hash IS NULL, NULL,
            SHA2(CONCAT(project_id, ':', ${newPath}, SUBSTRING(path, CHAR_LENGTH(${oldPath}) + 1)), 256)),
          path = CONCAT(${newPath}, SUBSTRING(path, CHAR_LENGTH(${oldPath}) + 1)),
          updated_at = NOW(3)
      WHERE tenant_id = ${tenantId} AND id IN (${ids})`;
    await tx.$executeRaw`
      UPDATE files
      SET path_hash = IF(path_hash IS NULL, NULL,
            SHA2(CONCAT(project_id, ':', ${newPath}, SUBSTRING(path, CHAR_LENGTH(${oldPath}) + 1)), 256)),
          path = CONCAT(${newPath}, SUBSTRING(path, CHAR_LENGTH(${oldPath}) + 1)),
          updated_at = NOW(3)
      WHERE tenant_id = ${tenantId} AND folder_id IN (${ids})`;
  }

  /** Moves a subtree to the trash as one batch (so it can be restored as one). */
  async trashSubtree(tx: Tx, tenantId: string, rootId: string, folderIds: string[], batchId: string, now: Date) {
    await tx.folder.updateMany({
      where: { tenantId, id: { in: folderIds }, deletedAt: null },
      data: { deletedAt: now, deleteBatchId: batchId, pathHash: null, isTrashRoot: false },
    });
    await tx.folder.updateMany({ where: { tenantId, id: rootId }, data: { isTrashRoot: true } });
    return tx.file.updateMany({
      where: { tenantId, folderId: { in: folderIds }, deletedAt: null, status: { in: ['AVAILABLE', 'PROCESSING', 'QUARANTINED'] } },
      data: { deletedAt: now, deleteBatchId: batchId, pathHash: null, isTrashRoot: false, status: 'DELETED' },
    });
  }

  /** Brings a whole trash batch back, recomputing each row's active path hash. */
  async restoreBatch(tx: Tx, tenantId: string, batchId: string) {
    await tx.$executeRaw`
      UPDATE folders
      SET path_hash = SHA2(CONCAT(project_id, ':', path), 256),
          deleted_at = NULL, delete_batch_id = NULL, is_trash_root = 0, updated_at = NOW(3)
      WHERE tenant_id = ${tenantId} AND delete_batch_id = ${batchId}`;
    await tx.$executeRaw`
      UPDATE files
      SET path_hash = SHA2(CONCAT(project_id, ':', path), 256),
          deleted_at = NULL, delete_batch_id = NULL, is_trash_root = 0,
          status = 'AVAILABLE', updated_at = NOW(3)
      WHERE tenant_id = ${tenantId} AND delete_batch_id = ${batchId} AND status = 'DELETED'`;
  }

  /** Tombstones every folder of a subtree (rows stay for audit history). */
  async tombstone(tx: Tx, tenantId: string, folderIds: string[], now: Date) {
    await tx.folder.updateMany({
      where: { tenantId, id: { in: folderIds } },
      // Clearing the batch id means no later restore can revive a permanently deleted folder.
      data: { deletedAt: now, pathHash: null, isTrashRoot: false, deleteBatchId: null },
    });
  }

  listTrashRoots(tenantId: string, projectId: string) {
    return this.prisma.folder.findMany({
      where: { tenantId, projectId, isTrashRoot: true, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  /** Trashed folder roots older than the cut-off, across tenants (retention job). */
  findExpiredTrashRoots(before: Date, take: number) {
    return this.prisma.folder.findMany({
      where: { isTrashRoot: true, deletedAt: { lt: before } },
      select: { id: true, tenantId: true, projectId: true },
      take,
    });
  }
}
