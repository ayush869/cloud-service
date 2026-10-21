import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthContext } from '../common/types';
import { Tx } from '../database/prisma.service';
import { AuditRepository } from './audit.repository';

export type AuditAction =
  | 'REGISTER'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_RESET'
  | 'TENANT_UPDATE'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'PROJECT_CREATE'
  | 'PROJECT_UPDATE'
  | 'PROJECT_DELETE'
  | 'API_KEY_CREATE'
  | 'API_KEY_REVOKE'
  | 'FILE_UPLOAD'
  | 'FILE_OVERWRITE'
  | 'FILE_DOWNLOAD'
  | 'FILE_RENAME'
  | 'FILE_UPDATE'
  | 'FILE_MOVE'
  | 'FILE_COPY'
  | 'FILE_DELETE'
  | 'FILE_RESTORE'
  | 'FILE_PERMANENT_DELETE'
  | 'FOLDER_CREATE'
  | 'FOLDER_RENAME'
  | 'FOLDER_MOVE'
  | 'FOLDER_DELETE'
  | 'FOLDER_RESTORE'
  | 'FOLDER_PERMANENT_DELETE';

export type ResourceType = 'TENANT' | 'USER' | 'PROJECT' | 'API_KEY' | 'FILE' | 'FOLDER' | 'AUTH';

export interface AuditEntry {
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string | null;
  projectId?: string | null;
  /** Never put secrets here (passwords, tokens, API keys, signed URLs). */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repository: AuditRepository) {}

  /** Writes inside the caller's transaction when given one, so the audit row commits with the change. */
  async log(ctx: AuthContext, entry: AuditEntry, tx?: Tx): Promise<void> {
    await this.repository.create(this.toRow(ctx, entry), tx);
  }

  /** For read-only events (downloads): never blocks or fails the request. */
  logAsync(ctx: AuthContext, entry: AuditEntry): void {
    this.repository
      .create(this.toRow(ctx, entry))
      .catch((err: Error) => this.logger.warn(`Audit write failed: ${err.message}`));
  }

  list(tenantId: string, q: { action?: string; resourceId?: string; page: number; limit: number }) {
    return this.repository.listByTenant(tenantId, {
      action: q.action,
      resourceId: q.resourceId,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
  }

  private toRow(ctx: AuthContext, entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      apiKeyId: ctx.apiKeyId ?? null,
      projectId: entry.projectId ?? ctx.projectId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      ipAddress: ctx.ipAddress?.slice(0, 64) ?? null,
      userAgent: ctx.userAgent?.slice(0, 255) ?? null,
      metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
    };
  }
}
