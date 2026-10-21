import { registerAs } from '@nestjs/config';
import { int, secret, str } from './env';

export const authConfig = registerAs('auth', () => ({
  jwtAccessSecret: secret('JWT_ACCESS_SECRET'),
  jwtAccessExpires: str('JWT_ACCESS_EXPIRES', '15m'),
  refreshExpiresDays: int('JWT_REFRESH_EXPIRES_DAYS', 30),
  urlSigningSecret: secret('URL_SIGNING_SECRET'),
  apiKeyPepper: secret('API_KEY_PEPPER'),
  passwordResetExpiresMinutes: int('PASSWORD_RESET_EXPIRES_MINUTES', 30),
}));

export type AuthConfig = ReturnType<typeof authConfig>;
