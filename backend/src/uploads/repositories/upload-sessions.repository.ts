import { Injectable } from '@nestjs/common';
import { Prisma, UploadStatus } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';

@Injectable()
export class UploadSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.UploadSessionUncheckedCreateInput, tx: Tx) {
    return tx.uploadSession.create({ data });
  }

  findByIdAndTenant(id: string, tenantId: string, projectId?: string) {
    return this.prisma.uploadSession.findFirst({ where: { id, tenantId, ...(projectId ? { projectId } : {}) } });
  }

  async transition(id: string, tenantId: string, from: UploadStatus[], data: Prisma.UploadSessionUncheckedUpdateManyInput, tx?: Tx) {
    const { count } = await (tx ?? this.prisma).uploadSession.updateMany({
      where: { id, tenantId, status: { in: from } },
      data,
    });
    return count === 1;
  }

  /** Sessions past their deadline (plus grace) that never completed, across tenants. */
  findStale(before: Date, take: number) {
    return this.prisma.uploadSession.findMany({
      where: { status: { in: ['CREATED', 'UPLOADED'] }, expiresAt: { lt: before } },
      select: { id: true, tenantId: true, fileId: true, storageKey: true },
      take,
    });
  }
}
