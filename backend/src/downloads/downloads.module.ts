import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ProjectsModule } from '../projects/projects.module';
import { DownloadsController } from './controllers/downloads.controller';
import { DownloadsService } from './services/downloads.service';
import { FileServingService } from './services/file-serving.service';

@Module({
  imports: [FilesModule, ProjectsModule],
  controllers: [DownloadsController],
  providers: [DownloadsService, FileServingService],
  exports: [DownloadsService, FileServingService],
})
export class DownloadsModule {}
