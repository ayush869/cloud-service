import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { createApp } from '../../src/app.factory';
import { JobsService } from '../../src/jobs/jobs.service';

export interface InjectOptions {
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  token?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
}

export interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: any;
  raw: Buffer;
}

export class TestApp {
  private constructor(readonly app: NestFastifyApplication) {}

  static async start(): Promise<TestApp> {
    const app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return new TestApp(app);
  }

  async stop(): Promise<void> {
    await this.app.get(JobsService).drain();
    await this.app.close();
    await fs.rm(process.env.STORAGE_ROOT!, { recursive: true, force: true });
  }

  /** Runs queued in-process background jobs (variants, purges) to completion. */
  drainJobs(): Promise<void> {
    return this.app.get(JobsService).drain();
  }

  async request(o: InjectOptions): Promise<TestResponse> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    let payload: Buffer | string | undefined;
    if (o.json !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(o.json);
    } else if (o.body !== undefined) {
      headers['content-type'] = o.contentType ?? 'application/octet-stream';
      payload = o.body;
    }
    const res = await this.app.inject({ method: o.method, url: o.url, headers, payload });
    let body: any = res.body;
    if (String(res.headers['content-type'] ?? '').includes('application/json') && res.body) {
      body = JSON.parse(res.body);
    }
    return { status: res.statusCode, headers: res.headers as TestResponse['headers'], body, raw: res.rawPayload };
  }

  get = (url: string, token?: string, headers?: Record<string, string>) => this.request({ method: 'GET', url, token, headers });
  post = (url: string, json: unknown, token?: string, headers?: Record<string, string>) =>
    this.request({ method: 'POST', url, json, token, headers });
  patch = (url: string, json: unknown, token?: string, headers?: Record<string, string>) =>
    this.request({ method: 'PATCH', url, json, token, headers });
  del = (url: string, token?: string, headers?: Record<string, string>) => this.request({ method: 'DELETE', url, token, headers });

  /** PUT raw bytes to the objects API. */
  putObject = (path: string, body: Buffer, token: string, contentType = 'application/octet-stream', query = '') =>
    this.request({ method: 'PUT', url: `/api/v1/objects?path=${encodeURIComponent(path)}${query}`, body, token, contentType });

  /** Multipart upload to POST /api/v1/uploads. */
  async multipart(url: string, filename: string, content: Buffer, token: string, fields: Record<string, string> = {}) {
    const boundary = `----cs${randomBytes(8).toString('hex')}`;
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    );
    return this.request({ method: 'POST', url, token, body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` });
  }
}

export interface TenantFixture {
  slug: string;
  tenantId: string;
  userId: string;
  token: string;
  projectId: string;
  projectSlug: string;
  apiKey: string;
  /** Headers a dashboard (JWT) call needs for project-scoped endpoints. */
  projectHeaders: Record<string, string>;
}

let counter = 0;

/** Registers a tenant with an owner, one project and one API key. */
export async function createTenant(t: TestApp, name: string, opts: { publicByDefault?: boolean } = {}): Promise<TenantFixture> {
  const n = ++counter;
  const email = `${name.toLowerCase().replace(/\W+/g, '')}-${n}-${Date.now()}@example.com`;
  const reg = await t.post('/api/v1/auth/register', { tenantName: `${name} ${n}`, name: `${name} Owner`, email, password: 'correct-horse-battery' });
  expect(reg.status).toBe(201);
  const token = reg.body.data.accessToken as string;
  const project = await t.post(
    '/api/v1/projects',
    { name: `${name} Website`, settings: { defaultVisibility: opts.publicByDefault ? 'PUBLIC' : 'PRIVATE' } },
    token,
  );
  expect(project.status).toBe(201);
  const key = await t.post('/api/v1/api-keys', { projectId: project.body.data.id, name: 'server' }, token);
  expect(key.status).toBe(201);
  return {
    slug: reg.body.data.tenant.slug,
    tenantId: reg.body.data.tenant.id,
    userId: reg.body.data.user.id,
    token,
    projectId: project.body.data.id,
    projectSlug: project.body.data.slug,
    apiKey: key.body.data.apiKey,
    projectHeaders: { 'x-project-id': project.body.data.id },
  };
}

export const jpeg = (w = 640, h = 480) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 140, b: 60 } } }).jpeg().toBuffer();

export const png = (w = 64, h = 64) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();
