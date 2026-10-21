import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/constants';
import { Client, ClientMeta, Public, RateLimit } from '../../common/decorators';
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from '../dto/auth.dto';
import { AuthService } from '../services/auth.service';

@ApiTags('Auth')
@Public()
@Controller(`${API_PREFIX}/auth`)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Creates a tenant and its owner account. */
  @Post('register')
  @RateLimit('login')
  register(@Body() dto: RegisterDto, @Client() meta: ClientMeta) {
    return this.auth.register(dto, meta);
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit('login')
  login(@Body() dto: LoginDto, @Client() meta: ClientMeta) {
    return this.auth.login(dto, meta);
  }

  /** Exchanges a refresh token for a new access + refresh token pair (the old one stops working). */
  @Post('refresh')
  @HttpCode(200)
  @RateLimit('login')
  refresh(@Body() dto: RefreshDto, @Client() meta: ClientMeta) {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Post('logout')
  @HttpCode(200)
  @RateLimit('login')
  logout(@Body() dto: RefreshDto, @Client() meta: ClientMeta) {
    return this.auth.logout(dto.refreshToken, meta);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @RateLimit('login')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @RateLimit('login')
  resetPassword(@Body() dto: ResetPasswordDto, @Client() meta: ClientMeta) {
    return this.auth.resetPassword(dto, meta);
  }
}
