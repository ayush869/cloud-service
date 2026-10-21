import { registerAs } from '@nestjs/config';
import { int, str } from './env';

export const redisConfig = registerAs('redis', () => {
  const host = process.env.REDIS_HOST ?? '';
  return {
    /** Redis is optional for single-instance/dev; required when running more than one API instance. */
    enabled: host.trim() !== '',
    host,
    port: int('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: int('REDIS_DB', 0),
    keyPrefix: str('REDIS_KEY_PREFIX', 'cs:'),
  };
});

export type RedisConfig = ReturnType<typeof redisConfig>;
