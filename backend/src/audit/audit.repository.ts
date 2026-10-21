import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../database/prisma.service';

export interface AuditListQuery {
  action?: string;
  resourceId?: string;
  skip: number;
  take: number;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AuditLogUncheckedCreateInput, tx?: Tx) {
    return (tx ?? this.prisma).auditLog.create({ data });
  }

  async listByTenant(tenantId: string, q: AuditListQuery) {
    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(q.action ? { action: q.action } : {}),
      ...(q.resourceId ? { resourceId: q.resourceId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
