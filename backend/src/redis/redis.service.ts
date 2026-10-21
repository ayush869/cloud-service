import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConfig, RedisConfig } from '../config';

/**
 * Owns the shared ioredis connection. When REDIS_HOST is empty `client` is null and
 * cache / rate limiting / jobs fall back to in-process implementations.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis | null;

  constructor(@Inject(redisConfig.KEY) readonly config: RedisConfig) {
    if (!config.enabled) {
      this.client = null;
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn(
          'REDIS_HOST is not set: rate limits, cache and jobs are per-process. Run a single instance only.',
        );
      }
      return;
    }
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      keyPrefix: config.keyPrefix,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Connection options for BullMQ (it needs maxRetriesPerRequest=null and manages its own prefix). */
  bullConnection() {
    return {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      db: this.config.db,
      maxRetriesPerRequest: null,
    };
  }

  async ping(): Promise<boolean> {
    if (!this.client) return true;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
