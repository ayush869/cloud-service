import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { authConfig, AuthConfig } from '../config';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { ProjectsModule } from '../projects/projects.module';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { PasswordResetsRepository } from './repositories/password-resets.repository';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';

@Module({
  imports: [
    TenantsModule,
    UsersModule,
    ProjectsModule,
    ApiKeysModule,
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (cfg: AuthConfig) => ({
        secret: cfg.jwtAccessSecret,
        signOptions: { algorithm: 'HS256', expiresIn: cfg.jwtAccessExpires as `${number}m` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshTokensRepository,
    PasswordResetsRepository,
    // Order matters: authenticate, then rate-limit (needs the project), then authorize.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService, TokenService, RefreshTokensRepository],
})
export class AuthModule {}
