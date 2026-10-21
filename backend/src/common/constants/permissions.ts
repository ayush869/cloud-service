import { UserRole } from '@prisma/client';

export const PERMISSIONS = [
  'files.read',
  'files.upload',
  'files.update',
  'files.delete',
  'files.move',
  'files.copy',
  'files.restore',
  'folders.read',
  'folders.create',
  'folders.update',
  'folders.delete',
  'folders.move',
  'users.read',
  'users.manage',
  'api_keys.read',
  'api_keys.create',
  'api_keys.revoke',
  'projects.read',
  'projects.manage',
  'billing.read',
  'billing.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const byPrefix = (...prefixes: string[]): Permission[] =>
  PERMISSIONS.filter((p) => prefixes.some((prefix) => p.startsWith(prefix)));

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: [...byPrefix('files.', 'folders.', 'users.', 'projects.', 'api_keys.'), 'audit.read', 'billing.read'],
  MANAGER: byPrefix('files.', 'folders.'),
  MEMBER: ['files.read', 'files.upload', 'files.update', 'files.move', 'files.copy', 'folders.read'],
  VIEWER: ['files.read', 'folders.read'],
};

/** What an API key gets when the creator does not choose explicitly. */
export const DEFAULT_API_KEY_PERMISSIONS: Permission[] = byPrefix('files.', 'folders.');

/** API keys act for a single project - tenant administration is never delegated to them. */
export const API_KEY_ASSIGNABLE_PERMISSIONS: Permission[] = byPrefix('files.', 'folders.');

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
