import { Module } from '@nestjs/common';
import { FoldersModule } from '../folders/folders.module';
import { ProjectsModule } from '../projects/projects.module';
import { FilesController, TrashController } from './controllers/files.controller';
import { FilesRepository } from './repositories/files.repository';
import { FilePresenter } from './services/file-presenter.service';
import { FilesService } from './services/files.service';

@Module({
  imports: [FoldersModule, ProjectsModule],
  controllers: [FilesController, TrashController],
  providers: [FilesService, FilesRepository, FilePresenter],
  exports: [FilesService, FilesRepository, FilePresenter],
})
export class FilesModule {}
