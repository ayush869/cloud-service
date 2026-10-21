import { registerAs } from '@nestjs/config';
import * as path from 'node:path';
import { bool, int, str } from './env';

export const storageConfig = registerAs('storage', () => {
  const serveMode = str('SERVE_MODE', 'stream');
  if (serveMode !== 'stream' && serveMode !== 'x-accel') {
    throw new Error('SERVE_MODE must be "stream" or "x-accel"');
  }
  return {
    driver: str('STORAGE_DRIVER', 'local'),
    root: path.resolve(str('STORAGE_ROOT', './storage-data')),
    /** Logical bucket name recorded on each file row (useful once several roots/providers exist). */
    bucket: str('STORAGE_BUCKET', 'default'),
    serveMode: serveMode as 'stream' | 'x-accel',
    xAccelPrefix: str('X_ACCEL_PREFIX', '/_protected/'),
    uploadUrlExpires: int('UPLOAD_URL_EXPIRES', 600),
    downloadUrlExpires: int('DOWNLOAD_URL_EXPIRES', 300),
    maxUploadBytes: int('MAX_UPLOAD_SIZE_BYTES', 1024 * 1024 * 1024),
    defaultTenantLimitBytes: int('DEFAULT_TENANT_STORAGE_LIMIT_BYTES', 50 * 1024 ** 3),
    trashRetentionDays: int('TRASH_RETENTION_DAYS', 30),
    publicCacheMaxAge: int('PUBLIC_CACHE_MAX_AGE', 86400),
    imageVariantsEager: bool('IMAGE_VARIANTS_EAGER', true),
  };
});

export type StorageConfig = ReturnType<typeof storageConfig>;
