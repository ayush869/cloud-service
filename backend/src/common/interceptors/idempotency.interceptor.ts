import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, from, Observable, of, switchMap, throwError } from 'rxjs';
import { CacheService } from '../../redis/cache.service';
import { CacheKeys } from '../constants';
import { IDEMPOTENT_KEY } from '../decorators';
import { AppException, Errors } from '../exceptions/app.exception';

type Entry = { state: 'pending' } | { state: 'done'; status: number; body: unknown };

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const REPLAY_TTL = 24 * 3600;
const LOCK_TTL = 5 * 60;

/**
 * For @Idempotent() routes: a retried request with the same Idempotency-Key gets the
 * original response instead of creating a duplicate upload/file. Keys are scoped to the
 * tenant + caller + route, so they cannot collide across customers.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler())) return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const header = request.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key || !request.authContext) return next.handle();
    if (!KEY_PATTERN.test(key)) {
      return throwError(() => Errors.validation('Idempotency-Key must be 8-128 characters of [A-Za-z0-9_.:-]'));
    }

    const ctx = request.authContext;
    const route = `${request.method}:${request.routeOptions.url}:${ctx.projectId ?? ''}`;
    const cacheKey = CacheKeys.idempotency(ctx.tenantId, route, `${ctx.apiKeyId ?? ctx.userId}:${key}`);

    return from(this.cache.get<Entry>(cacheKey)).pipe(
      switchMap((existing) => {
        if (existing?.state === 'done') {
          reply.status(existing.status).header('idempotent-replayed', 'true');
          return of(existing.body);
        }
        if (existing?.state === 'pending') throw this.inProgress();
        return from(this.cache.setIfAbsent(cacheKey, { state: 'pending' } satisfies Entry, LOCK_TTL)).pipe(
          switchMap((acquired) => {
            if (!acquired) throw this.inProgress();
            return next.handle().pipe(
              switchMap(async (body) => {
                await this.cache.set(cacheKey, { state: 'done', status: reply.statusCode, body } satisfies Entry, REPLAY_TTL);
                return body;
              }),
              catchError((err) => from(this.cache.del(cacheKey)).pipe(switchMap(() => throwError(() => err)))),
            );
          }),
        );
      }),
    );
  }

  private inProgress() {
    return new AppException('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed', HttpStatus.CONFLICT);
  }
}
