import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { FastifyRequest } from 'fastify';
import { isUUID } from 'class-validator';
import { API_KEY_LIVE_PREFIX, CacheKeys, PROJECT_HEADER, ROLE_PERMISSIONS } from '../../common/constants';
import { AUTH_TYPES, clientMetaOf, IS_PUBLIC } from '../../common/decorators';
import { AppException, Errors } from '../../common/exceptions/app.exception';
import { AuthContext, AuthType } from '../../common/types';
import { ApiKeysService } from '../../api-keys/services/api-keys.service';
import { normalizeOrigin } from '../../projects/services/projects.service';
import { ProjectsRepository } from '../../projects/repositories/projects.repository';
import { CacheService } from '../../redis/cache.service';
import { UsersRepository } from '../../users/repositories/users.repository';
import { TokenService } from '../services/token.service';
import { HttpStatus } from '@nestjs/common';

interface CachedUser {
  tenantId: string;
  role: UserRole;
  active: boolean;
}

/**
 * Global guard: turns "Authorization: Bearer <JWT | cs_live_ API key>" into an AuthContext.
 * The tenant always comes from the verified credential - never from the request body.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly apiKeys: ApiKeysService,
    private readonly users: UsersRepository,
    private readonly projects: ProjectsRepository,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    if (!header || !/^Bearer\s+\S+/i.test(header)) throw Errors.unauthorized();
    const credential = header.replace(/^Bearer\s+/i, '').trim();

    const ctx = credential.startsWith(API_KEY_LIVE_PREFIX)
      ? await this.fromApiKey(credential, request)
      : await this.fromJwt(credential, request);

    const allowed = this.reflector.getAllAndOverride<AuthType[] | undefined>(AUTH_TYPES, targets);
    if (allowed && !allowed.includes(ctx.authType)) {
      throw Errors.forbidden(
        ctx.authType === 'API_KEY' ? 'This endpoint requires a dashboard login, not an API key' : 'This endpoint requires an API key',
        'AUTH_TYPE_NOT_ALLOWED',
      );
    }

    await this.resolveProject(ctx, request);
    request.authContext = ctx;
    return true;
  }

  private async fromJwt(token: string, request: FastifyRequest): Promise<AuthContext> {
    const payload = await this.tokens.verifyAccess(token);
    if (!payload) throw Errors.unauthorized('Invalid or expired access token');

    const user = await this.cache.wrap<CachedUser | null>(CacheKeys.user(payload.sub), 30, async () => {
      const row = await this.users.findForAuth(payload.sub, payload.tid);
      return row ? { tenantId: row.tenantId, role: row.role, active: row.status === 'ACTIVE' && row.tenant.status === 'ACTIVE' } : null;
    });
    if (!user || user.tenantId !== payload.tid || !user.active) {
      throw Errors.unauthorized('Account is not active');
    }
    return {
      tenantId: user.tenantId,
      userId: payload.sub,
      role: user.role,
      authType: 'JWT',
      permissions: new Set(ROLE_PERMISSIONS[user.role]),
      ...clientMetaOf(request),
    };
  }

  private async fromApiKey(raw: string, request: FastifyRequest): Promise<AuthContext> {
    const key = await this.apiKeys.authenticate(raw);
    if (!key) throw new AppException('INVALID_API_KEY', 'Invalid, revoked or expired API key', HttpStatus.UNAUTHORIZED);

    // Browser calls must come from an origin registered on the project. Server-to-server
    // calls send no Origin header and are not affected.
    const origin = request.headers.origin;
    if (origin && !this.originAllowed(origin, key.allowedOrigins)) {
      throw Errors.forbidden('This origin is not allowed for the project', 'ORIGIN_NOT_ALLOWED');
    }
    return {
      tenantId: key.tenantId,
      projectId: key.projectId,
      apiKeyId: key.id,
      authType: 'API_KEY',
      permissions: new Set(key.permissions),
      ...clientMetaOf(request),
    };
  }

  /** X-Project-Id: verified against the tenant for JWT callers; must match the key's project for API keys. */
  private async resolveProject(ctx: AuthContext, request: FastifyRequest): Promise<void> {
    const raw = request.headers[PROJECT_HEADER];
    const requested = Array.isArray(raw) ? raw[0] : raw;
    if (!requested) return;

    if (ctx.authType === 'API_KEY') {
      if (requested !== ctx.projectId) throw Errors.notFound('project');
      return;
    }
    if (!isUUID(requested)) throw Errors.notFound('project');
    const project = await this.cache.wrap<{ status: string } | null>(
      CacheKeys.project(ctx.tenantId, requested),
      (p) => (p ? 60 : 10),
      async () => {
        const row = await this.projects.findByIdAndTenant(requested, ctx.tenantId);
        return row ? { status: row.status } : null;
      },
    );
    if (!project) throw Errors.notFound('project');
    if (project.status !== 'ACTIVE') throw Errors.forbidden('This project is disabled', 'PROJECT_DISABLED');
    ctx.projectId = requested;
  }

  private originAllowed(origin: string, allowed: string[]): boolean {
    try {
      return allowed.includes(normalizeOrigin(origin));
    } catch {
      return false;
    }
  }
}
