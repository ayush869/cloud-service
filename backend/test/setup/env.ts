import * as os from 'node:os';
import * as path from 'node:path';

// Isolated environment for e2e tests: dedicated database, temp storage, no Redis.
// Values set here win over .env (dotenv never overrides existing variables).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'mysql://root:@127.0.0.1:3306/cloud_storage_test';
process.env.REDIS_HOST = '';
process.env.STORAGE_ROOT = path.join(os.tmpdir(), `cs-test-${process.pid}-${Date.now()}`);
process.env.PUBLIC_BASE_URL = 'http://storage.test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-0123456789-abcdef';
process.env.URL_SIGNING_SECRET = 'test-signing-secret-0123456789-0123456789-abcdef';
process.env.API_KEY_PEPPER = 'test-api-key-pepper-0123456789-0123456789-abcdef';
process.env.SWAGGER_ENABLED = 'false';
process.env.REGISTRATION_ENABLED = 'true';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_INLINE_SCHEDULER = 'true';
process.env.IMAGE_VARIANTS_EAGER = 'false';
process.env.RATE_LIMIT_LOGIN_PER_MIN = '10000';
process.env.RATE_LIMIT_API_PER_MIN = '100000';
process.env.RATE_LIMIT_PRESIGN_PER_MIN = '100000';
process.env.RATE_LIMIT_DOWNLOAD_PER_MIN = '100000';
process.env.DEFAULT_TENANT_STORAGE_LIMIT_BYTES = String(50 * 1024 * 1024);
