import { Module } from '@nestjs/common';
import { FilesRepository } from '../files/repositories/files.repository';
import { FoldersController } from './controllers/folders.controller';
import { FoldersRepository } from './repositories/folders.repository';
import { FoldersService } from './services/folders.service';

@Module({
  controllers: [FoldersController],
  providers: [FoldersService, FoldersRepository, FilesRepository],
  exports: [FoldersService, FoldersRepository],
})
export class FoldersModule {}
