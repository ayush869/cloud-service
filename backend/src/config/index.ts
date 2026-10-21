export * from './app.config';
export * from './auth.config';
export * from './database.config';
export * from './redis.config';
export * from './storage.config';

import { appConfig } from './app.config';
import { authConfig } from './auth.config';
import { databaseConfig } from './database.config';
import { redisConfig } from './redis.config';
import { storageConfig } from './storage.config';

export const allConfigs = [appConfig, authConfig, databaseConfig, redisConfig, storageConfig];
