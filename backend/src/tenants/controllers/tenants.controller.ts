import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/constants';
import { AllowAuth, CurrentContext, RequirePermissions } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { TenantsService } from '../services/tenants.service';

@ApiTags('Tenants')
@ApiBearerAuth()
@Controller(`${API_PREFIX}/tenants`)
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Current tenant with storage usage. Also available to API keys (usage display on websites). */
  @Get('me')
  getMine(@CurrentContext() ctx: AuthContext) {
    return this.tenants.getMine(ctx);
  }

  @Patch('me')
  @AllowAuth('JWT')
  @RequirePermissions('projects.manage')
  updateMine(@CurrentContext() ctx: AuthContext, @Body() dto: UpdateTenantDto) {
    return this.tenants.updateMine(ctx, dto);
  }
}
