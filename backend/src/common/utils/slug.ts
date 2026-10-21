import { randomBase62 } from './crypto.util';

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || `t-${randomBase62(6).toLowerCase()}`;
}

/** Finds a free slug by appending -2, -3, ... (then a random suffix as a last resort). */
export async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let i = 2; i < 20; i++) {
    const candidate = `${base}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${base}-${randomBase62(6).toLowerCase()}`;
}
