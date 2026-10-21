import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/constants';
import { CurrentContext, RequirePermissions } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { PageQuery } from '../../common/utils/pagination';
import { requireProject } from '../../common/utils/project-context';
import { BulkIdsDto, BulkMoveDto, CopyFileDto, ListFilesQuery, MoveFileDto, UpdateFileDto } from '../dto/file.dto';
import { FilesService } from '../services/files.service';

@ApiTags('Files')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Project-Id', required: false, description: 'Required for dashboard (JWT) calls; implied by API keys' })
@Controller(`${API_PREFIX}/files`)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** List / search: ?search=product&folderId=...&mimeType=image/*&sort=name&order=asc */
  @Get()
  @RequirePermissions('files.read')
  list(@CurrentContext() ctx: AuthContext, @Query() q: ListFilesQuery) {
    return this.files.list(requireProject(ctx), q);
  }

  @Get(':id')
  @RequirePermissions('files.read')
  get(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.get(requireProject(ctx), id);
  }

  /** Rename and/or change visibility. */
  @Patch(':id')
  @RequirePermissions('files.update')
  update(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFileDto) {
    return this.files.update(requireProject(ctx), id, dto);
  }

  @Post(':id/move')
  @HttpCode(200)
  @RequirePermissions('files.move')
  move(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveFileDto) {
    return this.files.move(requireProject(ctx), id, dto.targetFolderId);
  }

  @Post(':id/copy')
  @RequirePermissions('files.copy', 'files.upload')
  copy(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CopyFileDto) {
    return this.files.copy(requireProject(ctx), id, dto.targetFolderId, dto.newName);
  }

  /** Moves the file to the trash. */
  @Delete(':id')
  @RequirePermissions('files.delete')
  remove(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.remove(requireProject(ctx), id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('files.restore')
  restore(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.restore(requireProject(ctx), id);
  }

  @Delete(':id/permanent')
  @RequirePermissions('files.delete')
  permanentDelete(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.permanentDelete(requireProject(ctx), id);
  }

  @Post('bulk/delete')
  @HttpCode(200)
  @RequirePermissions('files.delete')
  bulkDelete(@CurrentContext() ctx: AuthContext, @Body() dto: BulkIdsDto) {
    return this.files.bulkRemove(requireProject(ctx), dto.ids);
  }

  @Post('bulk/move')
  @HttpCode(200)
  @RequirePermissions('files.move')
  bulkMove(@CurrentContext() ctx: AuthContext, @Body() dto: BulkMoveDto) {
    return this.files.bulkMove(requireProject(ctx), dto.ids, dto.targetFolderId);
  }
}

@ApiTags('Files')
@ApiBearerAuth()
@Controller(`${API_PREFIX}/trash`)
export class TrashController {
  constructor(private readonly files: FilesService) {}

  /** Trashed files (paged) and trashed folders of the project. */
  @Get()
  @RequirePermissions('files.read')
  list(@CurrentContext() ctx: AuthContext, @Query() q: PageQuery) {
    return this.files.listTrash(requireProject(ctx), q.page, q.limit);
  }
}
