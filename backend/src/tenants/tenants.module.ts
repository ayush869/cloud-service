import { Module } from '@nestjs/common';
import { TenantsController } from './controllers/tenants.controller';
import { TenantsRepository } from './repositories/tenants.repository';
import { TenantsService } from './services/tenants.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, TenantsRepository],
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
