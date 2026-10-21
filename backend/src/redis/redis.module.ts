import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { RateLimiterService } from './rate-limiter.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, CacheService, RateLimiterService],
  exports: [RedisService, CacheService, RateLimiterService],
})
export class RedisModule {}
