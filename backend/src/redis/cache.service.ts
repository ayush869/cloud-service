import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

interface Entry {
  value: string;
  expiresAt: number;
}

/**
 * Two-level cache: a small in-process LRU (short TTL, absorbs hot keys such as public
 * file lookups) in front of Redis (shared between instances, explicit invalidation).
 */
@Injectable()
export class CacheService {
  private readonly local = new Map<string, Entry>();
  private readonly maxLocalEntries = 20_000;
  /** Upper bound for the local copy so other instances' invalidations are seen quickly. */
  private readonly localTtlMs = 5_000;

  constructor(private readonly redis: RedisService) {}

  async get<T>(key: string): Promise<T | undefined> {
    const hit = this.local.get(key);
    if (hit) {
      if (hit.expiresAt > Date.now()) {
        // Refresh LRU position.
        this.local.delete(key);
        this.local.set(key, hit);
        return JSON.parse(hit.value) as T;
      }
      this.local.delete(key);
    }
    if (!this.redis.client) return undefined;
    const raw = await this.redis.client.get(key).catch(() => null);
    if (raw === null) return undefined;
    this.setLocal(key, raw, this.localTtlMs);
    return JSON.parse(raw) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redis.client) {
      await this.redis.client.set(key, raw, 'EX', ttlSeconds).catch(() => undefined);
      this.setLocal(key, raw, Math.min(this.localTtlMs, ttlSeconds * 1000));
    } else {
      this.setLocal(key, raw, ttlSeconds * 1000);
    }
  }

  /** SET NX: true when this caller created the key (idempotency reservations, locks). */
  async setIfAbsent(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    const raw = JSON.stringify(value);
    if (this.redis.client) {
      const result = await this.redis.client.set(key, raw, 'EX', ttlSeconds, 'NX').catch(() => null);
      return result === 'OK';
    }
    const existing = this.local.get(key);
    if (existing && existing.expiresAt > Date.now()) return false;
    this.setLocal(key, raw, ttlSeconds * 1000);
    return true;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    keys.forEach((k) => this.local.delete(k));
    await this.redis.client?.del(...keys).catch(() => undefined);
  }

  /** Read-through helper. `ttlSeconds` may depend on the loaded value (e.g. shorter for misses). */
  async wrap<T>(
    key: string,
    ttlSeconds: number | ((value: T) => number),
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await load();
    const ttl = typeof ttlSeconds === 'function' ? ttlSeconds(value) : ttlSeconds;
    if (ttl > 0) await this.set(key, value, ttl);
    return value;
  }

  private setLocal(key: string, value: string, ttlMs: number): void {
    if (this.local.size >= this.maxLocalEntries) {
      const oldest = this.local.keys().next().value;
      if (oldest !== undefined) this.local.delete(oldest);
    }
    this.local.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
