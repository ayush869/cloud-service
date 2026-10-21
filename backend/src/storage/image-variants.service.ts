import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { isRasterImage } from '../common/utils/file-type.util';
import { StorageService } from './storage.service';

export interface VariantSpec {
  width: number;
  height?: number;
  fit: 'cover' | 'inside';
  quality: number;
}

/** Fixed presets (not arbitrary sizes) so nobody can make the server render unlimited sizes. */
export const VARIANTS: Record<string, VariantSpec> = {
  thumb: { width: 300, height: 300, fit: 'cover', quality: 78 },
  small: { width: 480, fit: 'inside', quality: 80 },
  medium: { width: 800, fit: 'inside', quality: 80 },
  large: { width: 1600, fit: 'inside', quality: 82 },
};

export const isVariantName = (v: unknown): v is string =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(VARIANTS, v);

export interface VariantSource {
  tenantId: string;
  storedName: string;
  storageKey: string;
  mimeType: string;
}

sharp.cache(false);

/**
 * WebP renditions of uploaded images. Generated eagerly by the worker after upload and
 * lazily on first request if missing; either way they are stored once and served from disk.
 */
@Injectable()
export class ImageVariantsService {
  private readonly logger = new Logger(ImageVariantsService.name);
  private readonly inflight = new Map<string, Promise<string | null>>();
  /** Variant objects are immutable (keyed by object id), so a known size never goes stale. */
  private readonly knownSizes = new Map<string, number>();

  constructor(private readonly storage: StorageService) {}

  supports(mimeType: string): boolean {
    return isRasterImage(mimeType);
  }

  /** Returns the variant's storage key, generating it if needed; null if not applicable. */
  async ensure(source: VariantSource, variant: string): Promise<string | null> {
    if (!this.supports(source.mimeType) || !isVariantName(variant)) return null;
    const key = this.storage.variantKey(source.tenantId, source.storedName, variant);
    if (await this.storage.exists(key)) return key;

    const running = this.inflight.get(key);
    if (running) return running;
    const job = this.generate(source, variant, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /** ensure() plus the variant's byte size; sizes of known variants are remembered in memory. */
  async ensureWithSize(source: VariantSource, variant: string): Promise<{ key: string; size: number } | null> {
    const key = this.storage.variantKey(source.tenantId, source.storedName, variant);
    const known = this.knownSizes.get(key);
    if (known !== undefined) return { key, size: known };
    const ensured = await this.ensure(source, variant);
    if (!ensured) return null;
    const stat = await this.storage.stat(ensured);
    if (!stat) return null;
    if (this.knownSizes.size >= 50_000) this.knownSizes.delete(this.knownSizes.keys().next().value!);
    this.knownSizes.set(key, stat.size);
    return { key, size: stat.size };
  }

  async generateAll(source: VariantSource): Promise<void> {
    for (const name of Object.keys(VARIANTS)) await this.ensure(source, name);
  }

  private async generate(source: VariantSource, variant: string, key: string): Promise<string | null> {
    const spec = VARIANTS[variant];
    try {
      const localPath = this.storage.localPath(source.storageKey);
      const input = localPath ?? (await streamToBuffer(await this.storage.read(source.storageKey)));
      const output = await sharp(input, { failOn: 'none', limitInputPixels: 120_000_000 })
        .rotate()
        .resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: true })
        .webp({ quality: spec.quality, effort: 4 })
        .toBuffer();
      await this.storage.write(key, Readable.from(output), Number.MAX_SAFE_INTEGER);
      return key;
    } catch (err) {
      this.logger.warn(`Variant ${variant} failed for ${source.storageKey}: ${(err as Error).message}`);
      return null;
    }
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
