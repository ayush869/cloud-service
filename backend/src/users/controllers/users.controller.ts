import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/constants';
import { AllowAuth, CurrentContext, RequirePermissions } from '../../common/decorators';
import { AuthContext } from '../../common/types';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import { UsersService } from '../services/users.service';

@ApiTags('Users')
@ApiBearerAuth()
@AllowAuth('JWT')
@Controller(`${API_PREFIX}/users`)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @RequirePermissions('users.manage')
  create(@CurrentContext() ctx: AuthContext, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @Get()
  @RequirePermissions('users.read')
  list(@CurrentContext() ctx: AuthContext) {
    return this.users.list(ctx);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  get(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  update(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('users.manage')
  remove(@CurrentContext() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.remove(ctx, id);
  }
}
