import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { Public, RateLimit } from '../common/decorators';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';

@ApiTags('Health')
@Public()
@RateLimit('none')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  /** Liveness: the process is up. */
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Reports only up/down - no hosts, versions or errors. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const [database, redis, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.redis.enabled ? this.redis.ping() : Promise.resolve(null),
      this.storage.healthCheck(),
    ]);
    const ok = database && redis !== false && storage;
    reply.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? 'ok' : 'degraded',
      checks: {
        database: database ? 'up' : 'down',
        redis: redis === null ? 'disabled' : redis ? 'up' : 'down',
        storage: storage ? 'up' : 'down',
      },
    };
  }
}
