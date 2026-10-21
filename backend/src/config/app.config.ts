import { registerAs } from '@nestjs/config';
import { bool, int, list, str } from './env';

export const appConfig = registerAs('app', () => ({
  env: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  port: int('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''),
  trustProxy: bool('TRUST_PROXY', false),
  logLevel: str('LOG_LEVEL', 'info'),
  swaggerEnabled: bool('SWAGGER_ENABLED', true),
  registrationEnabled: bool('REGISTRATION_ENABLED', true),
  dashboardOrigins: list('DASHBOARD_ORIGINS'),
  rateLimits: {
    login: int('RATE_LIMIT_LOGIN_PER_MIN', 5),
    api: int('RATE_LIMIT_API_PER_MIN', 1000),
    presign: int('RATE_LIMIT_PRESIGN_PER_MIN', 100),
    download: int('RATE_LIMIT_DOWNLOAD_PER_MIN', 500),
  },
}));

export type AppConfig = ReturnType<typeof appConfig>;
