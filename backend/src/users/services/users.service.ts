import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { CacheKeys } from '../../common/constants';
import { Errors } from '../../common/exceptions/app.exception';
import { AuthContext } from '../../common/types';
import { isUniqueViolation } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CacheService } from '../../redis/cache.service';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import { UsersRepository } from '../repositories/users.repository';
import { PasswordService } from './password.service';

export const toUserDto = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly passwords: PasswordService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: AuthContext) {
    return (await this.users.findAllByTenant(ctx.tenantId)).map(toUserDto);
  }

  async get(ctx: AuthContext, id: string) {
    const user = await this.users.findByIdAndTenant(id, ctx.tenantId);
    if (!user) throw Errors.notFound('user');
    return toUserDto(user);
  }

  async create(ctx: AuthContext, dto: CreateUserDto) {
    if (dto.role === 'OWNER' && ctx.role !== 'OWNER') throw Errors.forbidden('Only an owner can add another owner');
    try {
      const user = await this.users.create({
        tenantId: ctx.tenantId,
        name: dto.name.trim(),
        email: dto.email.toLowerCase().trim(),
        passwordHash: await this.passwords.hash(dto.password),
        role: dto.role,
      });
      await this.audit.log(ctx, { action: 'USER_CREATE', resourceType: 'USER', resourceId: user.id, metadata: { role: user.role } });
      return toUserDto(user);
    } catch (e) {
      if (isUniqueViolation(e)) throw Errors.conflict('EMAIL_TAKEN', 'A user with this e-mail already exists');
      throw e;
    }
  }

  async update(ctx: AuthContext, id: string, dto: UpdateUserDto) {
    const target = await this.users.findByIdAndTenant(id, ctx.tenantId);
    if (!target) throw Errors.notFound('user');
    if ((target.role === 'OWNER' || dto.role === 'OWNER') && ctx.role !== 'OWNER') {
      throw Errors.forbidden('Only an owner can change owners');
    }
    const demotesOwner =
      target.role === 'OWNER' && ((dto.role && dto.role !== 'OWNER') || dto.status === 'DISABLED');
    if (demotesOwner && (await this.users.countOwners(ctx.tenantId)) <= 1) {
      throw Errors.conflict('LAST_OWNER', 'A tenant must keep at least one active owner');
    }
    const updated = await this.users.updateByIdAndTenant(id, ctx.tenantId, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.password !== undefined ? { passwordHash: await this.passwords.hash(dto.password) } : {}),
    });
    await this.cache.del(CacheKeys.user(id));
    await this.audit.log(ctx, {
      action: 'USER_UPDATE',
      resourceType: 'USER',
      resourceId: id,
      metadata: { fields: Object.keys(dto).filter((k) => k !== 'password'), passwordChanged: dto.password !== undefined },
    });
    return toUserDto(updated!);
  }

  async remove(ctx: AuthContext, id: string) {
    if (id === ctx.userId) throw Errors.conflict('CANNOT_DELETE_SELF', 'You cannot delete your own account');
    const target = await this.users.findByIdAndTenant(id, ctx.tenantId);
    if (!target) throw Errors.notFound('user');
    if (target.role === 'OWNER' && ctx.role !== 'OWNER') throw Errors.forbidden('Only an owner can remove an owner');
    await this.users.deleteByIdAndTenant(id, ctx.tenantId);
    await this.cache.del(CacheKeys.user(id));
    await this.audit.log(ctx, { action: 'USER_DELETE', resourceType: 'USER', resourceId: id });
    return { deleted: true };
  }
}
