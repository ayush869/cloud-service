import { Module } from '@nestjs/common';
import { RefreshTokensRepository } from '../auth/repositories/refresh-tokens.repository';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { JobRunner } from '../jobs/jobs.service';
import { UploadsModule } from '../uploads/uploads.module';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [FilesModule, FoldersModule, UploadsModule],
  providers: [MaintenanceService, RefreshTokensRepository, { provide: JobRunner, useExisting: MaintenanceService }],
  exports: [JobRunner],
})
export class MaintenanceModule {}
