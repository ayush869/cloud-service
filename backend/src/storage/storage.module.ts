import { Global, Module } from '@nestjs/common';
import { storageConfig, StorageConfig } from '../config';
import { ImageVariantsService } from './image-variants.service';
import { LocalDiskStorageProvider } from './providers/local-disk.provider';
import { StorageProvider } from './providers/storage.provider';
import { SignedUrlService } from './signed-url.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: StorageProvider,
      inject: [storageConfig.KEY],
      useFactory: (config: StorageConfig): StorageProvider => {
        switch (config.driver) {
          case 'local':
            return new LocalDiskStorageProvider(config.root);
          default:
            // Add S3/R2/MinIO providers here; nothing above StorageService changes.
            throw new Error(`Unsupported STORAGE_DRIVER "${config.driver}"`);
        }
      },
    },
    StorageService,
    SignedUrlService,
    ImageVariantsService,
  ],
  exports: [StorageService, SignedUrlService, ImageVariantsService],
})
export class StorageModule {}
