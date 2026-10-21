/** Small typed readers for process.env - config files use these instead of raw strings. */
export function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

export function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number`);
  return Math.trunc(n);
}

export function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Secrets must be long and random in production; dev gets a loud warning instead. */
export function secret(name: string): string {
  const v = process.env[name] ?? '';
  if (v.length >= 32) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set to a random value of at least 32 characters`);
  }
  // eslint-disable-next-line no-console
  console.warn(`[config] ${name} is missing/short - using an insecure development value`);
  return `insecure-dev-${name}-change-me-0000000000000000`;
}
