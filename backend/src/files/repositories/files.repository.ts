import { Injectable } from '@nestjs/common';
import { FileStatus, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';

/** Statuses of a file that is "there" (listed, downloadable, counts as occupying its path). */
export const LIVE_STATUSES: FileStatus[] = ['AVAILABLE', 'PROCESSING', 'QUARANTINED'];

export interface FileListFilter {
  tenantId: string;
  projectId: string;
  /** undefined = whole project, null = root level, string = that folder */
  folderId?: string | null;
  search?: string;
  pathPrefix?: string;
  mimeType?: string;
  extension?: string;
  minSize?: number;
  maxSize?: number;
  createdFrom?: Date;
  createdTo?: Date;
  updatedFrom?: Date;
  updatedTo?: Date;
  sort: 'name' | 'createdAt' | 'updatedAt' | 'sizeBytes';
  order: 'asc' | 'desc';
  skip: number;
  take: number;
}

/**
 * File metadata. Every lookup is scoped by tenantId + projectId; a file id from another
 * tenant simply matches nothing, which surfaces as 404.
 */
@Injectable()
export class FilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findLiveById(id: string, tenantId: string, projectId: string, tx?: Tx) {
    return (tx ?? this.prisma).file.findFirst({
      where: { id, tenantId, projectId, deletedAt: null, status: { in: LIVE_STATUSES } },
    });
  }

  /** Any state except permanently deleted (trash operations). */
  findById(id: string, tenantId: string, projectId: string, tx?: Tx) {
    return (tx ?? this.prisma).file.findFirst({
      where: { id, tenantId, projectId, status: { not: 'PERMANENTLY_DELETED' } },
    });
  }

  /** Signed download links carry tenant + file id only. */
  findLiveByIdForTenant(id: string, tenantId: string) {
    return this.prisma.file.findFirst({
      where: { id, tenantId, deletedAt: null, status: { in: LIVE_STATUSES } },
    });
  }

  /** Row currently holding a path - live or a pending upload reservation. */
  findByPathHash(pathHash: string, tenantId: string, projectId: string, tx?: Tx) {
    return (tx ?? this.prisma).file.findFirst({ where: { pathHash, tenantId, projectId } });
  }

  /** Public URL lookup: only AVAILABLE + PUBLIC files are ever served without credentials. */
  findPublicByPathHash(pathHash: string, tenantId: string, projectId: string) {
    return this.prisma.file.findFirst({
      where: { pathHash, tenantId, projectId, status: 'AVAILABLE', visibility: 'PUBLIC', deletedAt: null },
      select: {
        id: true,
        name: true,
        storageKey: true,
        storedName: true,
        mimeType: true,
        sizeBytes: true,
        checksum: true,
        updatedAt: true,
      },
    });
  }

  async list(f: FileListFilter) {
    const where: Prisma.FileWhereInput = {
      tenantId: f.tenantId,
      projectId: f.projectId,
      deletedAt: null,
      status: { in: LIVE_STATUSES },
      ...(f.folderId !== undefined ? { folderId: f.folderId } : {}),
      ...(f.search ? { name: { contains: f.search } } : {}),
      ...(f.pathPrefix ? { path: { startsWith: f.pathPrefix } } : {}),
      ...(f.mimeType ? { mimeType: f.mimeType.endsWith('/*') ? { startsWith: f.mimeType.slice(0, -1) } : f.mimeType } : {}),
      ...(f.extension ? { extension: f.extension.toLowerCase() } : {}),
      ...(f.minSize !== undefined || f.maxSize !== undefined
        ? { sizeBytes: { ...(f.minSize !== undefined ? { gte: f.minSize } : {}), ...(f.maxSize !== undefined ? { lte: f.maxSize } : {}) } }
        : {}),
      ...(f.createdFrom || f.createdTo
        ? { createdAt: { ...(f.createdFrom ? { gte: f.createdFrom } : {}), ...(f.createdTo ? { lte: f.createdTo } : {}) } }
        : {}),
      ...(f.updatedFrom || f.updatedTo
        ? { updatedAt: { ...(f.updatedFrom ? { gte: f.updatedFrom } : {}), ...(f.updatedTo ? { lte: f.updatedTo } : {}) } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.file.findMany({ where, orderBy: [{ [f.sort]: f.order }, { id: 'asc' }], skip: f.skip, take: f.take }),
      this.prisma.file.count({ where }),
    ]);
    return { items, total };
  }

  create(data: Prisma.FileUncheckedCreateInput, tx: Tx) {
    return tx.file.create({ data });
  }

  update(id: string, data: Prisma.FileUncheckedUpdateInput, tx?: Tx) {
    return (tx ?? this.prisma).file.update({ where: { id }, data });
  }

  /** Conditional state change - returns false if the row was not in an expected status (lost race). */
  async updateIfStatus(id: string, tenantId: string, from: FileStatus[], data: Prisma.FileUncheckedUpdateManyInput, tx: Tx) {
    const { count } = await tx.file.updateMany({ where: { id, tenantId, status: { in: from } }, data });
    return count === 1;
  }

  createVersion(data: Prisma.FileVersionUncheckedCreateInput, tx: Tx) {
    return tx.fileVersion.create({ data });
  }

  markVersionsPurged(fileId: string, beforeVersion: number, tx: Tx) {
    return tx.fileVersion.updateMany({
      where: { fileId, versionNumber: { lt: beforeVersion }, purgedAt: null },
      data: { purgedAt: new Date() },
    });
  }

  /** Files of a folder subtree in any non-final state (permanent folder delete). */
  findInFolders(tenantId: string, folderIds: string[], tx: Tx) {
    return tx.file.findMany({
      where: { tenantId, folderId: { in: folderIds }, status: { notIn: ['PERMANENTLY_DELETED', 'PENDING', 'FAILED'] } },
      select: { id: true, storageKey: true, sizeBytes: true },
    });
  }

  markPermanentlyDeleted(tenantId: string, ids: string[], tx: Tx) {
    return tx.file.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { status: 'PERMANENTLY_DELETED', pathHash: null, isTrashRoot: false, deleteBatchId: null, deletedAt: new Date() },
    });
  }

  listTrashRoots(tenantId: string, projectId: string, skip: number, take: number) {
    const where: Prisma.FileWhereInput = { tenantId, projectId, isTrashRoot: true, status: 'DELETED' };
    return Promise.all([
      this.prisma.file.findMany({ where, orderBy: { deletedAt: 'desc' }, skip, take }),
      this.prisma.file.count({ where }),
    ]);
  }

  findExpiredTrashRoots(before: Date, take: number) {
    return this.prisma.file.findMany({
      where: { isTrashRoot: true, status: 'DELETED', deletedAt: { lt: before } },
      select: { id: true, tenantId: true, projectId: true },
      take,
    });
  }

  /** Is any row still pointing at this object? (guards purge against copy/overwrite races) */
  async isKeyReferenced(storageKey: string): Promise<boolean> {
    const [files, sessions] = await Promise.all([
      this.prisma.file.count({ where: { storageKey, status: { in: [...LIVE_STATUSES, 'DELETED', 'PENDING'] } } }),
      this.prisma.uploadSession.count({ where: { storageKey, status: { in: ['CREATED', 'UPLOADED'] } } }),
    ]);
    return files + sessions > 0;
  }
}
