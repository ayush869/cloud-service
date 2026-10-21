import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/constants';
import { CurrentContext, RequirePermissions } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { requireProject } from '../../common/utils/project-context';
import { CreateFolderDto, ListFoldersQuery, MoveFolderDto, RenameFolderDto } from '../dto/folder.dto';
import { FoldersService } from '../services/folders.service';

@ApiTags('Folders')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Project-Id', required: false, description: 'Required for dashboard (JWT) calls; implied by API keys' })
@Controller(`${API_PREFIX}/folders`)
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Post()
  @RequirePermissions('folders.create')
  create(@CurrentContext() ctx: AuthContext, @Body() dto: CreateFolderDto) {
    return this.folders.create(requireProject(ctx), dto.name, dto.parentId);
  }

  @Get()
  @RequirePermissions('folders.read')
  list(@CurrentContext() ctx: AuthContext, @Query() q: ListFoldersQuery) {
    return this.folders.list(requireProject(ctx), q.parentId);
  }

  @Get(':id')
  @RequirePermissions('folders.read')
  get(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.folders.get(requireProject(ctx), id);
  }

  @Patch(':id')
  @RequirePermissions('folders.update')
  rename(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameFolderDto) {
    return this.folders.rename(requireProject(ctx), id, dto.name);
  }

  @Post(':id/move')
  @HttpCode(200)
  @RequirePermissions('folders.move')
  move(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveFolderDto) {
    return this.folders.move(requireProject(ctx), id, dto.targetParentId);
  }

  @Delete(':id')
  @RequirePermissions('folders.delete')
  remove(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.folders.remove(requireProject(ctx), id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('files.restore')
  restore(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.folders.restore(requireProject(ctx), id);
  }

  @Delete(':id/permanent')
  @RequirePermissions('folders.delete', 'files.delete')
  permanentDelete(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.folders.permanentDelete(requireProject(ctx), id);
  }
}
