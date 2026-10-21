import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ApiKeysController } from './controllers/api-keys.controller';
import { ApiKeysRepository } from './repositories/api-keys.repository';
import { ApiKeysService } from './services/api-keys.service';

@Module({
  imports: [ProjectsModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeysRepository],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
