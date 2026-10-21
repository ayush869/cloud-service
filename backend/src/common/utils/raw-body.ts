import { FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

/** Routes whose PUT body is streamed to storage instead of being parsed. */
export const RAW_UPLOAD_ROUTE = /^\/api\/v1\/(objects|uploads\/[^/?]+\/content)(\?|$)/;

export const isRawUploadRequest = (req: { method: string; url: string }): boolean =>
  req.method === 'PUT' && RAW_UPLOAD_ROUTE.test(req.url);

/**
 * The request body as a stream. With a Content-Type our parser hands the stream over as
 * `body`; without one Fastify leaves it unread on `raw`.
 */
export function rawBodyStream(req: FastifyRequest): Readable | null {
  if (req.body instanceof Readable) return req.body;
  const length = Number(req.headers['content-length'] ?? 0);
  if (length > 0 || req.headers['transfer-encoding']) return req.raw;
  return null;
}
