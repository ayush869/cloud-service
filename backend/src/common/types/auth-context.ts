import { UserRole } from '@prisma/client';
import { Permission } from '../constants/permissions';

export type AuthType = 'JWT' | 'API_KEY';

/** Who is calling. Built only by AuthGuard from a verified JWT or API key - never from client input. */
export interface AuthContext {
  tenantId: string;
  /** Fixed for API keys; for JWT callers, taken from the X-Project-Id header after it is verified to belong to the tenant. */
  projectId?: string;
  userId?: string;
  apiKeyId?: string;
  role?: UserRole;
  authType: AuthType;
  permissions: ReadonlySet<Permission>;
  ipAddress: string;
  userAgent?: string;
  requestId: string;
}

/** AuthContext once a project has been resolved (files/folders/uploads endpoints). */
export type ProjectContext = AuthContext & { projectId: string };

/** Actor fields copied onto audit rows and created_by columns. */
export function actorOf(ctx: AuthContext) {
  return { userId: ctx.userId ?? null, apiKeyId: ctx.apiKeyId ?? null };
}
