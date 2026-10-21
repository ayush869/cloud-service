import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Permission } from '../constants/permissions';
import { Errors } from '../exceptions/app.exception';
import { AuthContext, AuthType } from '../types/auth-context';

export const IS_PUBLIC = 'cs:isPublic';
export const AUTH_TYPES = 'cs:authTypes';
export const PERMISSIONS_KEY = 'cs:permissions';
export const RATE_LIMIT_KEY = 'cs:rateLimit';
export const IDEMPOTENT_KEY = 'cs:idempotent';
export const RESPONSE_MESSAGE_KEY = 'cs:responseMessage';

/** Route needs no authentication (login, health, signed URLs, public files). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict which credential types may call a route (e.g. tenant administration is JWT-only). */
export const AllowAuth = (...types: AuthType[]) => SetMetadata(AUTH_TYPES, types);

/** Caller must hold every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export type RateLimitBucket = 'login' | 'api' | 'presign' | 'download' | 'none';
/** Overrides the default "api" bucket. "login" is keyed by client IP, the rest by project/tenant. */
export const RateLimit = (bucket: RateLimitBucket) => SetMetadata(RATE_LIMIT_KEY, bucket);

/** Replays the stored response when a request is retried with the same Idempotency-Key header. */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

/** Human readable message placed in the success envelope. */
export const ResponseMessage = (message: string) => SetMetadata(RESPONSE_MESSAGE_KEY, message);

/** Injects the AuthContext produced by AuthGuard. */
export const CurrentContext = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!request.authContext) throw Errors.unauthorized();
  return request.authContext;
});
