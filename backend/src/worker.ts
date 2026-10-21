import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { AppModule } from './app.module';
import { JobRunner, JobsService, QUEUE_NAME } from './jobs/jobs.service';
import { RedisService } from './redis/redis.service';

/**
 * Background worker: image variants, object purging, upload expiry, trash retention and
 * usage reconciliation. Requires Redis (without Redis the API runs these in-process).
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Worker');
  process.env.DISABLE_INLINE_SCHEDULER = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: false });
  const redis = app.get(RedisService);
  const jobs = app.get(JobsService);
  if (!jobs.usesQueue) {
    logger.error('REDIS_HOST is not configured - the worker has nothing to consume. Exiting.');
    await app.close();
    process.exit(1);
  }
  await jobs.registerSchedules();

  const runner = app.get(JobRunner, { strict: false });
  const run = runner.run.bind(runner) as (name: string, data: unknown) => Promise<void>;
  const worker = new Worker(QUEUE_NAME, (job) => run(job.name, job.data), {
    connection: redis.bullConnection(),
    prefix: `${redis.config.keyPrefix}bull`,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  });
  worker.on('failed', (job, err) => logger.warn(`Job ${job?.name} (${job?.id}) failed: ${err.message}`));
  worker.on('error', (err) => logger.error(`Worker error: ${err.message}`));
  logger.log(`Worker started (concurrency ${worker.opts.concurrency})`);

  const shutdown = async () => {
    logger.log('Shutting down worker...');
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void bootstrap();
