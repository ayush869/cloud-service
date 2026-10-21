import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { appConfig, AppConfig } from '../../config';
import { RateLimiterService } from '../../redis/rate-limiter.service';
import { RATE_LIMIT_KEY, RateLimitBucket } from '../decorators';
import { AppException } from '../exceptions/app.exception';

/**
 * Redis fixed-window limits (configurable per minute):
 *  login    - per client IP (login, register, password reset)
 *  api      - per project (or tenant for dashboard calls without a project) - the default
 *  presign  - per project, upload URL creation
 *  download - per project, or per IP for signed download links
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucket =
      this.reflector.getAllAndOverride<RateLimitBucket | undefined>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'api';
    if (bucket === 'none') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const ctx = request.authContext;

    const subject =
      bucket === 'login' || !ctx ? `ip:${request.ip}` : ctx.projectId ? `p:${ctx.projectId}` : `t:${ctx.tenantId}`;
    const limit = this.app.rateLimits[bucket];
    const result = await this.limiter.hit(`${bucket}:${subject}`, limit);

    reply.header('x-ratelimit-limit', result.limit);
    reply.header('x-ratelimit-remaining', result.remaining);
    reply.header('x-ratelimit-reset', Math.ceil(result.resetMs / 1000));
    if (!result.allowed) {
      reply.header('retry-after', Math.max(1, Math.ceil(result.resetMs / 1000)));
      throw new AppException('RATE_LIMITED', 'Too many requests, please slow down', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
