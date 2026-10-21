import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/constants';
import { AllowAuth, CurrentContext, RequirePermissions } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { CreateProjectDto, UpdateProjectDto } from '../dto/project.dto';
import { ProjectsService } from '../services/projects.service';

@ApiTags('Projects')
@ApiBearerAuth()
@AllowAuth('JWT')
@Controller(`${API_PREFIX}/projects`)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @RequirePermissions('projects.manage')
  create(@CurrentContext() ctx: AuthContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(ctx, dto);
  }

  @Get()
  @RequirePermissions('projects.read')
  list(@CurrentContext() ctx: AuthContext) {
    return this.projects.list(ctx);
  }

  @Get(':id')
  @RequirePermissions('projects.read')
  get(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('projects.manage')
  update(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('projects.manage')
  remove(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.remove(ctx, id);
  }
}
