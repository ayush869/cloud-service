import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';

@Injectable()
export class TenantsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  findBySlug(slug: string) {
    return this.prisma.tenant.findUnique({ where: { slug } });
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.prisma.tenant.count({ where: { slug } })) > 0;
  }

  /** Tenant + its usage row, created together so quota updates always have a row to hit. */
  create(data: Prisma.TenantUncheckedCreateInput, tx: Tx) {
    return tx.tenant.create({ data: { ...data, usage: { create: {} } } });
  }

  update(id: string, data: Prisma.TenantUncheckedUpdateInput) {
    return this.prisma.tenant.update({ where: { id }, data });
  }
}
