import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { SLUG_PATTERN } from '../../common/utils/slug';

export class RegisterDto {
  /** Company / customer name, e.g. "ABC Jewellery". */
  @IsString()
  @Length(2, 150)
  tenantName: string;

  /** Optional URL-safe tenant id used in public file URLs; generated from tenantName if omitted. */
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'tenantSlug may contain lowercase letters, digits and dashes' })
  tenantSlug?: string;

  @IsString()
  @Length(1, 150)
  name: string;

  @IsEmail()
  @MaxLength(191)
  email: string;

  @IsString()
  @Length(10, 128)
  password: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(191)
  email: string;

  @IsString()
  @Length(1, 128)
  password: string;
}

export class RefreshDto {
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(191)
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(20, 200)
  token: string;

  @IsString()
  @Length(10, 128)
  password: string;
}
