import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users.controller';
import { UsersRepository } from './repositories/users.repository';
import { PasswordService } from './services/password.service';
import { UsersService } from './services/users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, PasswordService],
  exports: [UsersService, UsersRepository, PasswordService],
})
export class UsersModule {}
