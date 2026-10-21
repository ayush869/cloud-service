/** Every cache key in one place so writers and invalidators cannot drift apart. */
export const CacheKeys = {
  user: (userId: string) => `auth:user:${userId}`,
  apiKey: (keyPrefix: string) => `auth:key:${keyPrefix}`,
  apiKeyTouched: (keyId: string) => `auth:key-touch:${keyId}`,
  project: (tenantId: string, projectId: string) => `auth:proj:${tenantId}:${projectId}`,
  tenantSlug: (tenantId: string) => `tenant:slug:${tenantId}`,
  projectPublicBase: (projectId: string) => `proj:base:${projectId}`,
  publicProject: (tenantSlug: string, projectSlug: string) => `pub:proj:${tenantSlug}/${projectSlug}`,
  publicFile: (projectId: string, pathHash: string) => `pub:file:${projectId}:${pathHash}`,
  corsOrigins: 'cors:origins',
  idempotency: (tenantId: string, route: string, key: string) => `idem:${tenantId}:${route}:${key}`,
};
