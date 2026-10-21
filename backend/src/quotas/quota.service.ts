import { Injectable } from '@nestjs/common';
import { Errors } from '../common/exceptions/app.exception';
import { PrismaService, Tx } from '../database/prisma.service';

export interface UsageSnapshot {
  usedBytes: number;
  fileCount: number;
  limitBytes: number;
}

/**
 * Tenant storage accounting. Bytes count from upload completion until permanent delete
 * (trash still counts, like most drives). Increments are a single conditional UPDATE, so
 * concurrent uploads cannot push a tenant over its limit.
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsage(tenantId: string): Promise<UsageSnapshot> {
    const rows = await this.prisma.$queryRaw<{ used: bigint; files: number; lim: bigint }[]>`
      SELECT su.used_bytes AS used, su.file_count AS files, t.storage_limit_bytes AS lim
      FROM tenants t LEFT JOIN storage_usage su ON su.tenant_id = t.id
      WHERE t.id = ${tenantId}`;
    const row = rows[0];
    return {
      usedBytes: Number(row?.used ?? 0),
      fileCount: Number(row?.files ?? 0),
      limitBytes: Number(row?.lim ?? 0),
    };
  }

  /** Fast pre-check before accepting bytes. The authoritative check is `reserve`. */
  async assertCanStore(tenantId: string, additionalBytes: number): Promise<void> {
    const usage = await this.getUsage(tenantId);
    if (usage.usedBytes + additionalBytes > usage.limitBytes) throw Errors.quotaExceeded();
  }

  /**
   * Atomically applies a usage delta inside `tx`. Positive deltas fail with
   * QUOTA_EXCEEDED (rolling back the caller's transaction) if they would exceed the limit.
   */
  async apply(tx: Tx, tenantId: string, bytesDelta: number, filesDelta: number): Promise<void> {
    if (bytesDelta === 0 && filesDelta === 0) return;
    if (bytesDelta > 0) {
      const changed = await tx.$executeRaw`
        UPDATE storage_usage su JOIN tenants t ON t.id = su.tenant_id
        SET su.used_bytes = su.used_bytes + ${bytesDelta},
            su.file_count = GREATEST(0, su.file_count + ${filesDelta}),
            su.updated_at = NOW(3)
        WHERE su.tenant_id = ${tenantId}
          AND su.used_bytes + ${bytesDelta} <= t.storage_limit_bytes`;
      if (changed === 0) throw Errors.quotaExceeded();
      return;
    }
    await tx.$executeRaw`
      UPDATE storage_usage
      SET used_bytes = GREATEST(0, CAST(used_bytes AS SIGNED) + ${bytesDelta}),
          file_count = GREATEST(0, file_count + ${filesDelta}),
          updated_at = NOW(3)
      WHERE tenant_id = ${tenantId}`;
  }

  /** Recomputes every tenant's usage from the files table (drift repair, run daily). */
  async reconcileAll(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE storage_usage su
      LEFT JOIN (
        SELECT tenant_id, SUM(size_bytes) AS bytes, COUNT(*) AS files
        FROM files
        WHERE status IN ('AVAILABLE', 'PROCESSING', 'QUARANTINED', 'DELETED')
        GROUP BY tenant_id
      ) f ON f.tenant_id = su.tenant_id
      SET su.used_bytes = COALESCE(f.bytes, 0),
          su.file_count = COALESCE(f.files, 0),
          su.updated_at = NOW(3)`;
  }
}
