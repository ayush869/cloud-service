import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/constants';
import { AllowAuth, CurrentContext, RequirePermissions, ResponseMessage } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { CreateApiKeyDto, ListApiKeysQuery } from '../dto/api-key.dto';
import { ApiKeysService } from '../services/api-keys.service';

@ApiTags('API keys')
@ApiBearerAuth()
@AllowAuth('JWT')
@Controller(`${API_PREFIX}/api-keys`)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  @RequirePermissions('api_keys.create')
  @ResponseMessage('Store this API key now - it will not be shown again')
  create(@CurrentContext() ctx: AuthContext, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(ctx, dto);
  }

  @Get()
  @RequirePermissions('api_keys.read')
  list(@CurrentContext() ctx: AuthContext, @Query() q: ListApiKeysQuery) {
    return this.apiKeys.list(ctx, q.projectId);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions('api_keys.revoke')
  revoke(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.revoke(ctx, id);
  }

  /** Same as revoke - keys are never hard-deleted so audit history stays intact. */
  @Delete(':id')
  @RequirePermissions('api_keys.revoke')
  remove(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.revoke(ctx, id);
  }
}
