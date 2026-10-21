import { Readable } from 'node:stream';

export interface StoredObjectInfo {
  size: number;
  modifiedAt: Date;
}

/** Inclusive byte range, as in HTTP Range: bytes=start-end. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Where object bytes physically live. Business code talks to StorageService, which talks
 * to one of these - so swapping local disk for S3/R2/MinIO later touches nothing above.
 */
export abstract class StorageProvider {
  /** Recorded in files.storage_provider. */
  abstract readonly name: string;

  /** Writes the stream to `key` atomically (readers never see a partial object). */
  abstract put(key: string, body: Readable): Promise<{ size: number }>;

  abstract get(key: string, range?: ByteRange): Promise<Readable>;

  /** null when the object does not exist. */
  abstract stat(key: string): Promise<StoredObjectInfo | null>;

  abstract exists(key: string): Promise<boolean>;

  /** Idempotent: deleting a missing object is not an error. */
  abstract delete(key: string): Promise<void>;

  /** Removes every object under `prefix` (e.g. all variants of one file). */
  abstract deletePrefix(prefix: string): Promise<void>;

  abstract copy(sourceKey: string, destinationKey: string): Promise<void>;

  abstract healthCheck(): Promise<boolean>;

  /**
   * Absolute filesystem path for disk-backed providers, letting Sharp read the file
   * directly and nginx serve it with sendfile. Remote providers return undefined.
   */
  localPath?(key: string): string;
}
