import { Module } from '@nestjs/common';
import { DownloadsModule } from '../downloads/downloads.module';
import { FilesModule } from '../files/files.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ObjectsController } from './objects.controller';

@Module({
  imports: [UploadsModule, FilesModule, DownloadsModule],
  controllers: [ObjectsController],
})
export class ObjectsModule {}
