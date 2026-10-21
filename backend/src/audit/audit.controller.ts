import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { API_PREFIX } from '../common/constants';
import { AllowAuth, CurrentContext, RequirePermissions } from '../common/decorators';
import { AuthContext } from '../common/types';
import { AuditService } from './audit.service';

class ListAuditLogsQuery {
  @IsOptional() @IsString() @MaxLength(64) action?: string;
  @IsOptional() @IsUUID() resourceId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

@ApiTags('Audit logs')
@ApiBearerAuth()
@Controller(`${API_PREFIX}/audit-logs`)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @AllowAuth('JWT')
  @RequirePermissions('audit.read')
  async list(@CurrentContext() ctx: AuthContext, @Query() q: ListAuditLogsQuery) {
    const { items, total } = await this.audit.list(ctx.tenantId, q);
    return { items, total, page: q.page, limit: q.limit };
  }
}
