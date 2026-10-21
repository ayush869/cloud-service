import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const PUBLIC_FIELDS = {
  id: true,
  tenantId: true,
  projectId: true,
  name: true,
  keyPrefix: true,
  permissions: true,
  status: true,
  expiresAt: true,
  lastUsedAt: true,
  createdBy: true,
  createdAt: true,
  revokedAt: true,
} satisfies Prisma.ApiKeySelect;

@Injectable()
export class ApiKeysRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Authentication lookup by the non-secret part of the key. */
  findForAuth(keyPrefix: string) {
    return this.prisma.apiKey.findUnique({
      where: { keyPrefix },
      include: {
        project: { select: { status: true, deletedAt: true, allowedOrigins: true } },
        tenant: { select: { status: true } },
      },
    });
  }

  findAllByTenant(tenantId: string, projectId?: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId, ...(projectId ? { projectId } : {}) },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  findByIdAndTenant(id: string, tenantId: string) {
    return this.prisma.apiKey.findFirst({ where: { id, tenantId }, select: PUBLIC_FIELDS });
  }

  create(data: Prisma.ApiKeyUncheckedCreateInput) {
    return this.prisma.apiKey.create({ data, select: PUBLIC_FIELDS });
  }

  async revokeByIdAndTenant(id: string, tenantId: string): Promise<boolean> {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id, tenantId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    return count > 0;
  }

  revokeAllForProject(projectId: string, tenantId: string) {
    return this.prisma.apiKey.updateMany({
      where: { projectId, tenantId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
  }

  prefixesForProject(projectId: string, tenantId: string) {
    return this.prisma.apiKey.findMany({ where: { projectId, tenantId }, select: { keyPrefix: true } });
  }

  touchLastUsed(id: string) {
    return this.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } });
  }
}
