import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

// Fixed-window counter: INCR, set the expiry on the first hit, return count + TTL atomically.
const SCRIPT = [
  "local c = redis.call('INCR', KEYS[1])",
  "if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end",
  'return {c, ttl}',
].join('\n');

@Injectable()
export class RateLimiterService {
  private readonly memory = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowMs = 60_000): Promise<RateLimitResult> {
    if (limit <= 0) return { allowed: true, limit, remaining: Number.MAX_SAFE_INTEGER, resetMs: 0 };
    let count: number;
    let ttl: number;
    if (this.redis.client) {
      try {
        const [c, t] = (await this.redis.client.eval(SCRIPT, 1, `rl:${key}`, windowMs)) as [
          number,
          number,
        ];
        count = c;
        ttl = t;
      } catch {
        // Fail open: losing Redis must not take the whole API down.
        return { allowed: true, limit, remaining: limit, resetMs: windowMs };
      }
    } else {
      ({ count, ttl } = this.hitMemory(key, windowMs));
    }
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetMs: ttl };
  }

  private hitMemory(key: string, windowMs: number) {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      for (const [k, v] of this.memory) if (v.resetAt <= now) this.memory.delete(k);
      this.lastSweep = now;
    }
    let entry = this.memory.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      this.memory.set(key, entry);
    }
    entry.count++;
    return { count: entry.count, ttl: entry.resetAt - now };
  }
}
