import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { OutgoingHttpHeaders } from 'node:http';
import { storageConfig, StorageConfig } from '../../config';
import { AppException, Errors } from '../../common/exceptions/app.exception';
import { isInlineSafe } from '../../common/utils/file-type.util';
import { ByteRange } from '../../storage/providers/storage.provider';
import { StorageService } from '../../storage/storage.service';

/** Everything needed to send an object - small enough to cache for public URLs. */
export interface Servable {
  storageKey: string;
  mimeType: string;
  size: number;
  etag: string;
  lastModifiedMs: number;
  filename: string;
}

export interface ServeOptions {
  cacheControl: string;
  disposition: 'inline' | 'attachment';
  /** Allow any site to fetch() it (public files). */
  anyOrigin?: boolean;
}

/**
 * Sends object bytes with HTTP caching (ETag / 304), byte ranges, safe content headers,
 * and - in SERVE_MODE=x-accel - hands the actual transfer to nginx (sendfile, no Node I/O).
 */
@Injectable()
export class FileServingService {
  private readonly logger = new Logger(FileServingService.name);

  constructor(
    private readonly storage: StorageService,
    @Inject(storageConfig.KEY) private readonly config: StorageConfig,
  ) {}

  async send(req: FastifyRequest, reply: FastifyReply, obj: Servable, opts: ServeOptions): Promise<void> {
    const inline = opts.disposition === 'inline' && isInlineSafe(obj.mimeType);
    reply
      .header('content-type', obj.mimeType)
      .header('etag', obj.etag)
      .header('last-modified', new Date(obj.lastModifiedMs).toUTCString())
      .header('cache-control', opts.cacheControl)
      .header('accept-ranges', 'bytes')
      .header('x-content-type-options', 'nosniff')
      .header('cross-origin-resource-policy', 'cross-origin')
      .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', obj.filename));
    if (!inline || obj.mimeType === 'image/svg+xml') {
      // Even if a browser renders it, scripts inside cannot run on our origin.
      reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    }
    if (opts.anyOrigin) reply.header('access-control-allow-origin', '*');

    if (this.notModified(req, obj)) {
      reply.code(304).send();
      return;
    }

    if (this.config.serveMode === 'x-accel') {
      // nginx serves the file from disk (internal location) and handles Range/HEAD itself.
      reply.header('x-accel-redirect', `${this.config.xAccelPrefix}${obj.storageKey}`).code(200).send();
      return;
    }

    const range = parseRange(req.headers.range, obj.size);
    if (range === 'unsatisfiable') {
      reply.code(416).header('content-range', `bytes */${obj.size}`).send();
      return;
    }
    if (range) {
      reply
        .code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${obj.size}`)
        .header('content-length', range.end - range.start + 1);
    } else {
      reply.code(200).header('content-length', obj.size);
    }
    if (req.method === 'HEAD') {
      // Write headers ourselves: Fastify would recompute Content-Length from an empty body.
      reply.hijack();
      reply.raw.writeHead(reply.statusCode, reply.getHeaders() as OutgoingHttpHeaders);
      reply.raw.end();
      return;
    }
    try {
      reply.send(await this.storage.read(obj.storageKey, range ?? undefined));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Metadata says it exists but the bytes are gone: worth an alert.
        this.logger.error(`Object missing from storage: ${obj.storageKey}`);
        reply.removeHeader('content-length').removeHeader('content-range');
        throw Errors.notFound('file');
      }
      throw err;
    }
  }

  private notModified(req: FastifyRequest, obj: Servable): boolean {
    const inm = req.headers['if-none-match'];
    if (inm) {
      return inm === '*' || inm.split(',').some((t) => t.trim().replace(/^W\//, '') === obj.etag);
    }
    const ims = req.headers['if-modified-since'];
    if (ims) {
      const since = Date.parse(ims);
      return Number.isFinite(since) && Math.floor(obj.lastModifiedMs / 1000) * 1000 <= since;
    }
    return false;
  }
}

/** Single "bytes=a-b" ranges only (multi-range requests get the full body). */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header || !header.startsWith('bytes=') || header.includes(',')) return null;
  const [startRaw, endRaw] = header.slice(6).split('-');
  let start: number;
  let end: number;
  if (startRaw === '') {
    const suffix = Number(endRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' || endRaw === undefined ? size - 1 : Number(endRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) return null;
    end = Math.min(end, size - 1);
  }
  if (size === 0 || start >= size) return 'unsatisfiable';
  return { start, end };
}

export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export const invalidLink = () =>
  new AppException('INVALID_DOWNLOAD_LINK', 'The download link is invalid or has expired', HttpStatus.FORBIDDEN);
