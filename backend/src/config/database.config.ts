import { registerAs } from '@nestjs/config';
import { str } from './env';

export const databaseConfig = registerAs('database', () => ({
  url: str('DATABASE_URL'),
}));

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
