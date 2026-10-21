import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppException } from '../exceptions/app.exception';

export interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
}

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  411: 'LENGTH_REQUIRED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/** Converts any error into the standard envelope. Never leaks stack traces or SQL. */
export function toErrorResponse(exception: unknown): { status: number; code: string; message: string; details?: unknown } {
  if (exception instanceof AppException) {
    return { status: exception.getStatus(), code: exception.code, message: exception.message, details: exception.details };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse() as string | { message?: string | string[] };
    const raw = typeof body === 'string' ? body : body.message;
    if (Array.isArray(raw)) return { status, code: 'VALIDATION_ERROR', message: 'Validation failed', details: raw };
    return { status, code: STATUS_CODES[status] ?? 'ERROR', message: raw ?? exception.message };
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') return { status: 409, code: 'CONFLICT', message: 'Resource already exists' };
    if (exception.code === 'P2025') return { status: 404, code: 'NOT_FOUND', message: 'Resource not found' };
  }
  const err = exception as { statusCode?: number; code?: string; message?: string };
  // Client went away mid-upload.
  if (err?.code === 'ECONNRESET' || err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || err?.message === 'aborted') {
    return { status: 400, code: 'UPLOAD_ABORTED', message: 'The request body was not fully received' };
  }
  // Errors raised by Fastify / plugins (body parsing, multipart limits, ...).
  if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
    const code = err.code === 'FST_REQ_FILE_TOO_LARGE' ? 'FILE_TOO_LARGE' : STATUS_CODES[err.statusCode] ?? 'BAD_REQUEST';
    return { status: err.statusCode, code, message: err.message ?? 'Bad request' };
  }
  return { status: HttpStatus.INTERNAL_SERVER_ERROR, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const { status, code, message, details } = toErrorResponse(exception);
    if (status >= 500) {
      this.logger.error(`${request.method} ${request.routeOptions?.url ?? ''} failed`, (exception as Error)?.stack);
    }
    if (reply.sent) return;
    const body: ErrorBody = {
      success: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      requestId: String(request.id),
    };
    reply.status(status).header('content-type', 'application/json; charset=utf-8').send(body);
  }
}
