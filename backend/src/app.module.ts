import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { allConfigs } from './config';
import { PrismaModule } from './database/prisma.module';
import { DownloadsModule } from './downloads/downloads.module';
import { FilesModule } from './files/files.module';
import { FoldersModule } from './folders/folders.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ObjectsModule } from './objects/objects.module';
import { ProjectsModule } from './projects/projects.module';
import { QuotasModule } from './quotas/quotas.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { TenantsModule } from './tenants/tenants.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: allConfigs }),
    // infrastructure
    PrismaModule,
    RedisModule,
    JobsModule,
    StorageModule,
    AuditModule,
    QuotasModule,
    // domain
    AuthModule,
    TenantsModule,
    UsersModule,
    ProjectsModule,
    ApiKeysModule,
    FoldersModule,
    FilesModule,
    UploadsModule,
    DownloadsModule,
    ObjectsModule,
    MaintenanceModule,
    HealthModule,
  ],
  providers: [
    // Outer to inner: the envelope wraps whatever idempotency returns (fresh or replayed).
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
