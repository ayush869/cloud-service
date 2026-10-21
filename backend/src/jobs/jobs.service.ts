import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JobsOptions, Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';

export const QUEUE_NAME = 'cloud-storage';

export interface JobPayloads {
  /** Generate thumbnail/webp variants for an uploaded image. */
  'image-variants': { tenantId: string; fileId: string };
  /** Delete stored objects (and their variants) that no row references any more. */
  'purge-objects': { keys: string[] };
  /** Mark expired upload sessions and free their reserved paths. */
  'expire-uploads': Record<string, never>;
  /** Permanently delete trash older than TRASH_RETENTION_DAYS. */
  'purge-trash': Record<string, never>;
  /** Recompute storage_usage from the files table. */
  'reconcile-usage': Record<string, never>;
}
export type JobName = keyof JobPayloads;

/** Implemented by MaintenanceModule; resolved lazily to avoid an import cycle. */
export abstract class JobRunner {
  abstract run<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void>;
}

/** Recurring maintenance and how often it runs. */
export const SCHEDULES: { name: JobName; everyMs: number }[] = [
  { name: 'expire-uploads', everyMs: 10 * 60_000 },
  { name: 'purge-trash', everyMs: 6 * 60 * 60_000 },
  { name: 'reconcile-usage', everyMs: 24 * 60 * 60_000 },
];

/**
 * Background work dispatcher. With Redis it enqueues to BullMQ and a separate worker
 * process (dist/worker.js) executes; without Redis it runs the job in this process
 * right after the current request and runs the maintenance schedule on timers.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private queue: Queue | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly redis: RedisService,
    private readonly moduleRef: ModuleRef,
  ) {
    if (redis.enabled) {
      this.queue = new Queue(QUEUE_NAME, {
        connection: redis.bullConnection(),
        prefix: `${redis.config.keyPrefix}bull`,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      });
    }
  }

  get usesQueue(): boolean {
    return this.queue !== null;
  }

  async dispatch<N extends JobName>(name: N, data: JobPayloads[N], opts?: JobsOptions): Promise<void> {
    if (this.queue) {
      await this.queue.add(name, data, opts);
      return;
    }
    const p = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.runner().run(name, data))
      .catch((err: Error) => this.logger.error(`Job ${name} failed: ${err.message}`, err.stack))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Waits for in-process jobs (used by tests and graceful shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  /** Registers the recurring maintenance jobs with BullMQ (called by the worker). */
  async registerSchedules(): Promise<void> {
    if (!this.queue) return;
    for (const s of SCHEDULES) {
      await this.queue.upsertJobScheduler(s.name, { every: s.everyMs }, { name: s.name, data: {} });
    }
  }

  onApplicationBootstrap(): void {
    if (this.queue || process.env.DISABLE_INLINE_SCHEDULER === 'true') return;
    for (const s of SCHEDULES) {
      const t = setInterval(() => void this.dispatch(s.name, {} as never), s.everyMs);
      t.unref();
      this.timers.push(t);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.timers.forEach(clearInterval);
    await this.drain();
    await this.queue?.close();
  }

  private runner(): JobRunner {
    return this.moduleRef.get(JobRunner, { strict: false });
  }
}
