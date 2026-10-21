import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authConfig, AuthConfig } from '../../config';
import {
  API_KEY_LIVE_PREFIX,
  CacheKeys,
  DEFAULT_API_KEY_PERMISSIONS,
  isPermission,
  Permission,
} from '../../common/constants';
import { Errors } from '../../common/exceptions/app.exception';
import { AuthContext } from '../../common/types';
import { hmacSha256, randomBase62, safeEqual } from '../../common/utils/crypto.util';
import { AuditService } from '../../audit/audit.service';
import { ProjectsRepository } from '../../projects/repositories/projects.repository';
import { CacheService } from '../../redis/cache.service';
import { CreateApiKeyDto } from '../dto/api-key.dto';
import { ApiKeysRepository } from '../repositories/api-keys.repository';

const PREFIX_LENGTH = 12;
const SECRET_LENGTH = 40;
const KEY_PATTERN = new RegExp(`^${API_KEY_LIVE_PREFIX}([0-9A-Za-z]{${PREFIX_LENGTH}})_([0-9A-Za-z]{${SECRET_LENGTH}})$`);

/** What AuthGuard needs to know about a key; cached so most requests skip the database. */
export interface ApiKeyPrincipal {
  id: string;
  tenantId: string;
  projectId: string;
  keyHash: string;
  permissions: Permission[];
  active: boolean;
  expiresAtMs: number | null;
  allowedOrigins: string[];
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly keys: ApiKeysRepository,
    private readonly projects: ProjectsRepository,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    @Inject(authConfig.KEY) private readonly auth: AuthConfig,
  ) {}

  list(ctx: AuthContext, projectId?: string) {
    return this.keys.findAllByTenant(ctx.tenantId, projectId).then((rows) => rows.map((k) => this.toDto(k)));
  }

  async create(ctx: AuthContext, dto: CreateApiKeyDto) {
    const project = await this.projects.findByIdAndTenant(dto.projectId, ctx.tenantId);
    if (!project) throw Errors.notFound('project');

    const requested = (dto.permissions ?? DEFAULT_API_KEY_PERMISSIONS).filter(isPermission);
    // A key can never do more than the person creating it.
    const denied = requested.filter((p) => !ctx.permissions.has(p));
    if (denied.length > 0) throw Errors.forbidden(`You cannot grant permissions you do not have: ${denied.join(', ')}`);

    const prefix = randomBase62(PREFIX_LENGTH);
    const secret = randomBase62(SECRET_LENGTH);
    const created = await this.keys.create({
      tenantId: ctx.tenantId,
      projectId: project.id,
      name: dto.name.trim(),
      keyPrefix: prefix,
      keyHash: this.hash(secret),
      permissions: [...new Set(requested)] as unknown as Prisma.InputJsonValue,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: ctx.userId ?? null,
    });
    await this.audit.log(ctx, {
      action: 'API_KEY_CREATE',
      resourceType: 'API_KEY',
      resourceId: created.id,
      projectId: project.id,
      metadata: { name: created.name, prefix },
    });
    // The full key is returned exactly once and never stored.
    return { ...this.toDto(created), apiKey: `${API_KEY_LIVE_PREFIX}${prefix}_${secret}` };
  }

  async revoke(ctx: AuthContext, id: string) {
    const key = await this.keys.findByIdAndTenant(id, ctx.tenantId);
    if (!key) throw Errors.notFound('api_key');
    await this.keys.revokeByIdAndTenant(id, ctx.tenantId);
    await this.cache.del(CacheKeys.apiKey(key.keyPrefix));
    await this.audit.log(ctx, { action: 'API_KEY_REVOKE', resourceType: 'API_KEY', resourceId: id, projectId: key.projectId });
    return { revoked: true };
  }

  /** Verifies a raw "cs_live_..." key. Returns null for anything invalid, revoked or expired. */
  async authenticate(raw: string): Promise<ApiKeyPrincipal | null> {
    const match = KEY_PATTERN.exec(raw);
    if (!match) return null;
    const [, prefix, secret] = match;

    const principal = await this.cache.wrap<ApiKeyPrincipal | null>(
      CacheKeys.apiKey(prefix),
      (p) => (p ? 60 : 30),
      async () => {
        const row = await this.keys.findForAuth(prefix);
        if (!row) return null;
        return {
          id: row.id,
          tenantId: row.tenantId,
          projectId: row.projectId,
          keyHash: row.keyHash,
          permissions: (row.permissions as string[]).filter(isPermission),
          active:
            row.status === 'ACTIVE' &&
            row.project.status === 'ACTIVE' &&
            row.project.deletedAt === null &&
            row.tenant.status === 'ACTIVE',
          expiresAtMs: row.expiresAt ? row.expiresAt.getTime() : null,
          allowedOrigins: (row.project.allowedOrigins as string[]) ?? [],
        };
      },
    );

    if (!principal || !safeEqual(this.hash(secret), principal.keyHash)) return null;
    if (!principal.active) return null;
    if (principal.expiresAtMs !== null && principal.expiresAtMs < Date.now()) return null;

    // last_used_at is informational: write it at most once a minute per key.
    if (await this.cache.setIfAbsent(CacheKeys.apiKeyTouched(principal.id), 1, 60)) {
      void this.keys.touchLastUsed(principal.id).catch(() => undefined);
    }
    return principal;
  }

  private hash(secret: string): string {
    return hmacSha256(this.auth.apiKeyPepper, secret).toString('hex');
  }

  private toDto(k: {
    id: string;
    projectId: string;
    name: string;
    keyPrefix: string;
    permissions: Prisma.JsonValue;
    status: string;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    revokedAt: Date | null;
  }) {
    return {
      id: k.id,
      projectId: k.projectId,
      name: k.name,
      /** Shown in dashboards to recognise a key; useless for authentication on its own. */
      keyPreview: `${API_KEY_LIVE_PREFIX}${k.keyPrefix}_…`,
      permissions: k.permissions,
      status: k.status,
      expiresAt: k.expiresAt,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
    };
  }
}
