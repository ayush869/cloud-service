import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const NOT_DELETED = { deletedAt: null } as const;

@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByIdAndTenant(id: string, tenantId: string) {
    return this.prisma.project.findFirst({ where: { id, tenantId, ...NOT_DELETED } });
  }

  findBySlugAndTenant(slug: string, tenantId: string) {
    return this.prisma.project.findFirst({ where: { slug, tenantId, ...NOT_DELETED } });
  }

  /** Public file URLs name the tenant and project by slug. */
  findPublicBySlugs(tenantSlug: string, projectSlug: string) {
    return this.prisma.project.findFirst({
      where: { slug: projectSlug, ...NOT_DELETED, tenant: { slug: tenantSlug } },
      select: { id: true, tenantId: true, status: true, tenant: { select: { status: true } } },
    });
  }

  findAllByTenant(tenantId: string) {
    return this.prisma.project.findMany({ where: { tenantId, ...NOT_DELETED }, orderBy: { createdAt: 'asc' } });
  }

  async slugTaken(tenantId: string, slug: string): Promise<boolean> {
    // Soft-deleted projects keep their slug reserved (unique index includes them).
    return (await this.prisma.project.count({ where: { tenantId, slug } })) > 0;
  }

  create(data: Prisma.ProjectUncheckedCreateInput) {
    return this.prisma.project.create({ data });
  }

  async updateByIdAndTenant(id: string, tenantId: string, data: Prisma.ProjectUncheckedUpdateManyInput) {
    await this.prisma.project.updateMany({ where: { id, tenantId, ...NOT_DELETED }, data });
    return this.findByIdAndTenant(id, tenantId);
  }

  countLiveFiles(id: string, tenantId: string) {
    return this.prisma.file.count({
      where: { projectId: id, tenantId, status: { not: 'PERMANENTLY_DELETED' } },
    });
  }

  /** All allowed origins of active projects - feeds the CORS preflight check. */
  async allActiveOrigins(): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { status: 'ACTIVE', ...NOT_DELETED, tenant: { status: 'ACTIVE' } },
      select: { allowedOrigins: true },
    });
    return rows.flatMap((r) => (Array.isArray(r.allowedOrigins) ? (r.allowedOrigins as string[]) : []));
  }
}
