import { execSync } from 'node:child_process';

/**
 * Brings the dedicated test database up to the latest migration (non-destructive).
 * Tests create uniquely named tenants, so rows left from earlier runs do not interfere.
 * To start from scratch, drop and recreate `cloud_storage_test` yourself.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL ?? 'mysql://root:@127.0.0.1:3306/cloud_storage_test';
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url } });
}
