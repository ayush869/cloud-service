import { Module } from '@nestjs/common';
import { ApiKeysRepository } from '../api-keys/repositories/api-keys.repository';
import { TenantsModule } from '../tenants/tenants.module';
import { ProjectsController } from './controllers/projects.controller';
import { ProjectsRepository } from './repositories/projects.repository';
import { OriginRegistry } from './services/origin-registry.service';
import { ProjectsService } from './services/projects.service';

@Module({
  imports: [TenantsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository, ApiKeysRepository, OriginRegistry],
  exports: [ProjectsService, ProjectsRepository, OriginRegistry],
})
export class ProjectsModule {}
