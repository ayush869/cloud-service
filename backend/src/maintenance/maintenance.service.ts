import { Inject, Injectable, Logger } from '@nestjs/common';
import { storageConfig, StorageConfig } from '../config';
import { PrismaService } from '../database/prisma.service';
import { FilesRepository } from '../files/repositories/files.repository';
import { FilesService } from '../files/services/files.service';
import { FoldersRepository } from '../folders/repositories/folders.repository';
import { FoldersService } from '../folders/services/folders.service';
import { JobName, JobPayloads, JobRunner } from '../jobs/jobs.service';
import { QuotaService } from '../quotas/quota.service';
import { ImageVariantsService } from '../storage/image-variants.service';
import { StorageService } from '../storage/storage.service';
import { UploadSessionsRepository } from '../uploads/repositories/upload-sessions.repository';
import { RefreshTokensRepository } from '../auth/repositories/refresh-tokens.repository';

const BATCH = 200;
const UPLOAD_GRACE_MS = 30 * 60_000;

/** Executes background jobs - in the worker process (BullMQ) or inline without Redis. */
@Injectable()
export class MaintenanceService extends JobRunner {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesRepository,
    private readonly filesService: FilesService,
    private readonly folders: FoldersRepository,
    private readonly foldersService: FoldersService,
    private readonly sessions: UploadSessionsRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly storage: StorageService,
    private readonly variants: ImageVariantsService,
    private readonly quota: QuotaService,
    @Inject(storageConfig.KEY) private readonly config: StorageConfig,
  ) {
    super();
  }

  async run<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    switch (name) {
      case 'image-variants':
        return this.imageVariants(data as JobPayloads['image-variants']);
      case 'purge-objects':
        return this.purgeObjects((data as JobPayloads['purge-objects']).keys);
      case 'expire-uploads':
        return this.expireUploads();
      case 'purge-trash':
        return this.purgeTrash();
      case 'reconcile-usage':
        return this.reconcileUsage();
      default:
        this.logger.warn(`Unknown job ${String(name)}`);
    }
  }

  private async imageVariants({ tenantId, fileId }: JobPayloads['image-variants']) {
    const file = await this.files.findLiveByIdForTenant(fileId, tenantId);
    if (!file || !this.variants.supports(file.mimeType)) return;
    await this.variants.generateAll(file);
  }

  /** Deletes objects + their variants, unless a row started referencing the key again. */
  private async purgeObjects(keys: string[]) {
    for (const key of keys) {
      if (await this.files.isKeyReferenced(key)) continue;
      await this.storage.delete(key);
      await this.storage.deletePrefix(this.storage.variantPrefix(this.storage.tenantIdOf(key), this.storage.objectIdOf(key)));
    }
  }

  /** Upload sessions that were never completed: free the reserved path and the bytes. */
  private async expireUploads() {
    const stale = await this.sessions.findStale(new Date(Date.now() - UPLOAD_GRACE_MS), BATCH);
    for (const s of stale) {
      await this.prisma.$transaction(async (tx) => {
        await this.sessions.transition(s.id, s.tenantId, ['CREATED', 'UPLOADED'], { status: 'EXPIRED' }, tx);
        await this.files.updateIfStatus(s.fileId, s.tenantId, ['PENDING'], { status: 'FAILED', pathHash: null }, tx);
      });
      await this.storage.delete(s.storageKey);
    }
    await this.refreshTokens.deleteExpired(new Date());
    if (stale.length) this.logger.log(`Expired ${stale.length} abandoned uploads`);
  }

  /** Trash older than TRASH_RETENTION_DAYS is destroyed for good. */
  private async purgeTrash() {
    const cutoff = new Date(Date.now() - this.config.trashRetentionDays * 86_400_000);
    let purged = 0;
    for (const f of await this.files.findExpiredTrashRoots(cutoff, BATCH)) {
      const file = await this.files.findById(f.id, f.tenantId, f.projectId);
      if (!file) continue;
      await this.filesService.purge({ tenantId: f.tenantId }, file).catch((e: Error) => this.logger.warn(e.message));
      purged++;
    }
    for (const r of await this.folders.findExpiredTrashRoots(cutoff, BATCH)) {
      const folder = await this.folders.findById(r.id, r.tenantId, r.projectId);
      if (!folder) continue;
      await this.foldersService.purgeSubtree({ tenantId: r.tenantId }, folder);
      purged++;
    }
    if (purged) this.logger.log(`Purged ${purged} expired trash items`);
  }

  private async reconcileUsage() {
    const tenants = await this.quota.reconcileAll();
    this.logger.log(`Reconciled storage usage for ${tenants} tenants`);
  }
}
