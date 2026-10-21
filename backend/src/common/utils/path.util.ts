import { sha256Hex } from './crypto.util';
import { Errors } from '../exceptions/app.exception';

export const MAX_NAME_LENGTH = 255;
export const MAX_PATH_LENGTH = 1024;

// Control characters and characters that break URLs/filesystems for clients.
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/;

/** Validates one file/folder name and returns it NFC-normalized. */
export function normalizeName(raw: string, what = 'name'): string {
  const name = (raw ?? '').normalize('NFC').trim();
  if (!name) throw Errors.validation(`The ${what} must not be empty`);
  if (name.length > MAX_NAME_LENGTH) throw Errors.validation(`The ${what} must be at most ${MAX_NAME_LENGTH} characters`);
  if (name === '.' || name === '..') throw Errors.validation(`"${name}" is not a valid ${what}`);
  if (name.includes('/') || FORBIDDEN.test(name)) {
    throw Errors.validation(`The ${what} contains characters that are not allowed`);
  }
  return name;
}

/**
 * Normalizes a logical path like "/images//products/a.jpg" to "images/products/a.jpg".
 * Rejects traversal segments instead of resolving them, so a path can never escape its project.
 */
export function normalizePath(raw: string): string {
  const segments = (raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '');
  if (segments.length === 0) throw Errors.validation('The path must not be empty');
  const normalized = segments.map((s) => normalizeName(s, 'path segment')).join('/');
  if (normalized.length > MAX_PATH_LENGTH) {
    throw Errors.validation(`The path must be at most ${MAX_PATH_LENGTH} characters`);
  }
  return normalized;
}

/** Like normalizePath but "" / "/" mean the project root. */
export function normalizeFolderPath(raw: string | undefined | null): string {
  if (!raw || raw.replace(/[\/]/g, '') === '') return '';
  return normalizePath(raw);
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

/**
 * Key of the unique (project_id, path_hash) index. Must match the SQL used when
 * folders are renamed: SHA2(CONCAT(project_id, ':', path), 256).
 */
export const pathHash = (projectId: string, path: string): string => sha256Hex(`${projectId}:${path}`);

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase().slice(0, 32);
}

/** "photo.jpg" -> "photo (1).jpg" */
export function numberedName(name: string, n: number): string {
  const ext = extensionOf(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  return ext ? `${base} (${n}).${name.slice(-ext.length)}` : `${base} (${n})`;
}

/** Public URLs keep "/" between segments but escape everything else. */
export const encodePathForUrl = (path: string): string =>
  path.split('/').map(encodeURIComponent).join('/');
