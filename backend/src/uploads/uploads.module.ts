import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { ProjectsModule } from '../projects/projects.module';
import { UploadsController } from './controllers/uploads.controller';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { UploadsService } from './services/uploads.service';

@Module({
  imports: [FilesModule, FoldersModule, ProjectsModule],
  controllers: [UploadsController],
  providers: [UploadsService, UploadSessionsRepository],
  exports: [UploadsService, UploadSessionsRepository],
})
export class UploadsModule {}
