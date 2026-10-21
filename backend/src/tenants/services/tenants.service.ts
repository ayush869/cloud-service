import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { CacheKeys } from '../../common/constants';
import { Errors } from '../../common/exceptions/app.exception';
import { AuthContext } from '../../common/types';
import { AuditService } from '../../audit/audit.service';
import { QuotaService } from '../../quotas/quota.service';
import { CacheService } from '../../redis/cache.service';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { TenantsRepository } from '../repositories/tenants.repository';

@Injectable()
export class TenantsService {
  constructor(
    private readonly tenants: TenantsRepository,
    private readonly quota: QuotaService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {}

  async getMine(ctx: AuthContext) {
    const tenant = await this.tenants.findById(ctx.tenantId);
    if (!tenant) throw Errors.notFound('tenant');
    return this.toDto(tenant, await this.quota.getUsage(tenant.id));
  }

  async updateMine(ctx: AuthContext, dto: UpdateTenantDto) {
    const tenant = await this.tenants.update(ctx.tenantId, { name: dto.name });
    await this.audit.log(ctx, { action: 'TENANT_UPDATE', resourceType: 'TENANT', resourceId: tenant.id, metadata: { name: dto.name } });
    return this.toDto(tenant, await this.quota.getUsage(tenant.id));
  }

  /** Slugs never change, so this is cached for a long time. Used to build public URLs. */
  slugOf(tenantId: string): Promise<string> {
    return this.cache.wrap(CacheKeys.tenantSlug(tenantId), 3600, async () => {
      const tenant = await this.tenants.findById(tenantId);
      if (!tenant) throw Errors.notFound('tenant');
      return tenant.slug;
    });
  }

  private toDto(tenant: Tenant, usage: { usedBytes: number; fileCount: number; limitBytes: number }) {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      storage: {
        usedBytes: usage.usedBytes,
        limitBytes: Number(tenant.storageLimitBytes),
        fileCount: usage.fileCount,
        usedPercent: usage.limitBytes ? Math.round((usage.usedBytes / usage.limitBytes) * 10000) / 100 : 0,
      },
      createdAt: tenant.createdAt,
    };
  }
}
