import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';

/** Every query except login-by-email is scoped by tenantId. */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Login only: e-mail is globally unique, the tenant comes from the matched row. */
  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email }, include: { tenant: true } });
  }

  /** Used by AuthGuard after verifying a JWT that already names the tenant. */
  findForAuth(userId: string, tenantId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, tenantId: true, role: true, status: true, tenant: { select: { status: true } } },
    });
  }

  findByIdAndTenant(id: string, tenantId: string) {
    return this.prisma.user.findFirst({ where: { id, tenantId } });
  }

  findAllByTenant(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  create(data: Prisma.UserUncheckedCreateInput, tx?: Tx) {
    return (tx ?? this.prisma).user.create({ data });
  }

  async updateByIdAndTenant(id: string, tenantId: string, data: Prisma.UserUncheckedUpdateManyInput) {
    await this.prisma.user.updateMany({ where: { id, tenantId }, data });
    return this.findByIdAndTenant(id, tenantId);
  }

  async deleteByIdAndTenant(id: string, tenantId: string): Promise<boolean> {
    const { count } = await this.prisma.user.deleteMany({ where: { id, tenantId } });
    return count > 0;
  }

  countOwners(tenantId: string) {
    return this.prisma.user.count({ where: { tenantId, role: 'OWNER', status: 'ACTIVE' } });
  }

  setPasswordHash(id: string, passwordHash: string, tx?: Tx) {
    return (tx ?? this.prisma).user.update({ where: { id }, data: { passwordHash } });
  }

  touchLastLogin(id: string) {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }
}
