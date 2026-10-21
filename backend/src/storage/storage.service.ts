import { Inject, Injectable } from '@nestjs/common';
import { createHash, Hash } from 'node:crypto';
import { Readable, Transform, TransformCallback } from 'node:stream';
import { storageConfig, StorageConfig } from '../config';
import { SNIFF_BYTES } from '../common/utils/file-type.util';
import { ByteRange, StorageProvider } from './providers/storage.provider';

export class ObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Object exceeds ${maxBytes} bytes`);
  }
}

export interface WrittenObject {
  size: number;
  /** sha256 hex of the content. */
  checksum: string;
  /** First bytes of the content, for magic-number type detection. */
  head: Buffer;
}

/** Counts, hashes and captures the head of a stream while it flows to storage. */
class ProbeStream extends Transform {
  size = 0;
  private readonly hash: Hash = createHash('sha256');
  private readonly headChunks: Buffer[] = [];
  private headLength = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.maxBytes) {
      cb(new ObjectTooLargeError(this.maxBytes));
      return;
    }
    this.hash.update(chunk);
    if (this.headLength < SNIFF_BYTES) {
      const part = chunk.subarray(0, SNIFF_BYTES - this.headLength);
      this.headChunks.push(part);
      this.headLength += part.length;
    }
    cb(null, chunk);
  }

  digest(): string {
    return this.hash.digest('hex');
  }

  head(): Buffer {
    return Buffer.concat(this.headChunks);
  }
}

/**
 * The only way business code reaches stored bytes. Owns the physical key layout:
 *   tenants/{tenantId}/objects/{xx}/{objectId}
 *   tenants/{tenantId}/variants/{xx}/{objectId}/{variant}.webp
 * where objectId is a random UUID (files.stored_name) and xx its first two characters,
 * which spreads objects over 256 directories.
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly provider: StorageProvider,
    @Inject(storageConfig.KEY) readonly config: StorageConfig,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  get bucket(): string {
    return this.config.bucket;
  }

  objectKey(tenantId: string, objectId: string): string {
    return `tenants/${tenantId}/objects/${objectId.slice(0, 2)}/${objectId}`;
  }

  variantPrefix(tenantId: string, objectId: string): string {
    return `tenants/${tenantId}/variants/${objectId.slice(0, 2)}/${objectId}`;
  }

  variantKey(tenantId: string, objectId: string, variant: string): string {
    return `${this.variantPrefix(tenantId, objectId)}/${variant}.webp`;
  }

  /** Streams `source` into storage, enforcing `maxBytes` while it flows. */
  async write(key: string, source: Readable, maxBytes: number): Promise<WrittenObject> {
    const probe = new ProbeStream(maxBytes);
    source.on('error', (err) => probe.destroy(err));
    await this.provider.put(key, source.pipe(probe));
    return { size: probe.size, checksum: probe.digest(), head: probe.head() };
  }

  read(key: string, range?: ByteRange): Promise<Readable> {
    return this.provider.get(key, range);
  }

  stat(key: string) {
    return this.provider.stat(key);
  }

  exists(key: string): Promise<boolean> {
    return this.provider.exists(key);
  }

  copy(sourceKey: string, destinationKey: string): Promise<void> {
    return this.provider.copy(sourceKey, destinationKey);
  }

  delete(key: string): Promise<void> {
    return this.provider.delete(key);
  }

  deletePrefix(prefix: string): Promise<void> {
    return this.provider.deletePrefix(prefix);
  }

  localPath(key: string): string | undefined {
    return this.provider.localPath?.(key);
  }

  healthCheck(): Promise<boolean> {
    return this.provider.healthCheck();
  }

  /** objectId (stored_name) back from an object key. */
  objectIdOf(key: string): string {
    return key.slice(key.lastIndexOf('/') + 1);
  }

  /** tenant id back from an object key. */
  tenantIdOf(key: string): string {
    return key.split('/')[1];
  }
}
