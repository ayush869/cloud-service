import { UserRole, UserStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(1, 150)
  name: string;

  @IsEmail()
  @MaxLength(191)
  email: string;

  @IsString()
  @Length(10, 128)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 150)
  name?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  @Length(10, 128)
  password?: string;
}
