import { createHash } from 'node:crypto';
import { createTenant, jpeg, png, TenantFixture, TestApp } from '../helpers/test-app';

describe('Files, folders and uploads', () => {
  let t: TestApp;
  let A: TenantFixture;

  beforeAll(async () => {
    t = await TestApp.start();
    A = await createTenant(t, 'Files', { publicByDefault: true });
  });

  afterAll(() => t.stop());

  describe('objects API (S3-style, used by the Laravel helper)', () => {
    it('PUT creates, PUT again overwrites in place, GET returns the bytes', async () => {
      const v1 = await jpeg(400, 300);
      const created = await t.putObject('jewel-pilot/images/banner-image/a b.jpg', v1, A.apiKey, 'image/jpeg');
      expect(created.status).toBe(200);
      expect(created.body.data).toMatchObject({
        name: 'a b.jpg',
        path: 'jewel-pilot/images/banner-image/a b.jpg',
        mimeType: 'image/jpeg',
        visibility: 'PUBLIC',
        version: 1,
        created: true,
      });
      expect(created.body.data.url).toBe(`http://storage.test/p/${A.slug}/${A.projectSlug}/jewel-pilot/images/banner-image/a%20b.jpg`);

      const v2 = await jpeg(500, 300);
      const over = await t.putObject('jewel-pilot/images/banner-image/a b.jpg', v2, A.apiKey, 'image/jpeg');
      expect(over.body.data.id).toBe(created.body.data.id);
      expect(over.body.data.version).toBe(2);
      expect(over.body.data.created).toBe(false);

      const got = await t.get(`/api/v1/objects?path=${encodeURIComponent('jewel-pilot/images/banner-image/a b.jpg')}`, A.apiKey);
      expect(got.status).toBe(200);
      expect(createHash('sha256').update(got.raw).digest('hex')).toBe(createHash('sha256').update(v2).digest('hex'));

      const head = await t.request({ method: 'HEAD', url: `/api/v1/objects?path=${encodeURIComponent('jewel-pilot/images/banner-image/a b.jpg')}`, token: A.apiKey });
      expect(head.status).toBe(200);
      expect(Number(head.headers['content-length'])).toBe(v2.length);
    });

    it('auto-creates the folder chain', async () => {
      const folders = await t.get('/api/v1/folders', A.apiKey);
      const root = folders.body.data.find((f: any) => f.name === 'jewel-pilot');
      expect(root).toBeDefined();
      const detail = await t.get(`/api/v1/folders/${root.id}`, A.apiKey);
      expect(detail.body.data.path).toBe('jewel-pilot');
    });

    it('rejects content that does not match the extension', async () => {
      const res = await t.putObject('evil.jpg', Buffer.from('<html><script>alert(1)</script></html>'), A.apiKey, 'image/jpeg');
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      const exe = await t.putObject('tool.exe', Buffer.from('MZ....'), A.apiKey);
      expect(exe.status).toBe(422);
    });

    it('rejects path traversal', async () => {
      const res = await t.putObject('../../etc/passwd.txt', Buffer.from('x'), A.apiKey, 'text/plain');
      expect(res.status).toBe(400);
    });

    it('DELETE moves to trash, permanent=true frees the bytes', async () => {
      await t.putObject('tmp/one.txt', Buffer.from('one'), A.apiKey, 'text/plain');
      const del = await t.del(`/api/v1/objects?path=tmp/one.txt`, A.apiKey);
      expect(del.status).toBe(200);
      expect((await t.get(`/api/v1/objects/meta?path=tmp/one.txt`, A.apiKey)).status).toBe(404);
      const trash = await t.get('/api/v1/trash', A.apiKey);
      expect(trash.body.data.files.items.map((f: any) => f.path)).toContain('tmp/one.txt');

      await t.putObject('tmp/two.txt', Buffer.from('two'), A.apiKey, 'text/plain');
      const perm = await t.del(`/api/v1/objects?path=tmp/two.txt&permanent=true`, A.apiKey);
      expect(perm.body.data.bytesFreed).toBe(3);
    });
  });

  describe('public URLs and image variants', () => {
    it('serves with caching headers, 304 and ranges', async () => {
      const img = await jpeg(1200, 800);
      const up = await t.putObject('gallery/ring.jpg', img, A.apiKey, 'image/jpeg');
      const url = up.body.data.url.replace('http://storage.test', '');

      const res = await t.get(url);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+/);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.raw.length).toBe(img.length);

      const cached = await t.get(url, undefined, { 'if-none-match': String(res.headers.etag) });
      expect(cached.status).toBe(304);

      const range = await t.get(url, undefined, { range: 'bytes=0-9' });
      expect(range.status).toBe(206);
      expect(range.raw.length).toBe(10);
      expect(range.headers['content-range']).toBe(`bytes 0-9/${img.length}`);
    });

    it('generates a webp thumbnail on demand', async () => {
      const res = await t.get(`/p/${A.slug}/${A.projectSlug}/gallery/ring.jpg?v=thumb`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
      expect(res.raw.subarray(8, 12).toString('latin1')).toBe('WEBP');
    });

    it('private files are reachable only through signed links', async () => {
      const up = await t.putObject('private/doc.png', await png(), A.apiKey, 'image/png', '&visibility=PRIVATE');
      expect(up.body.data.url).toBeNull();
      expect((await t.get(`/p/${A.slug}/${A.projectSlug}/private/doc.png`)).status).toBe(404);
      const link = await t.get(`/api/v1/files/${up.body.data.id}/download?disposition=inline`, A.apiKey);
      const res = await t.get(link.body.data.downloadUrl.replace('http://storage.test', ''));
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toMatch(/^private/);
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('making a file private removes its public URL immediately', async () => {
      const up = await t.putObject('flip/pic.png', await png(), A.apiKey, 'image/png');
      const url = up.body.data.url.replace('http://storage.test', '');
      expect((await t.get(url)).status).toBe(200);
      await t.patch(`/api/v1/files/${up.body.data.id}`, { visibility: 'PRIVATE' }, A.apiKey);
      expect((await t.get(url)).status).toBe(404);
    });
  });

  describe('presigned (browser) upload flow', () => {
    it('presign → PUT content → complete → available', async () => {
      const img = await png(32, 32);
      const pres = await t.post(
        '/api/v1/uploads/presign',
        { filename: 'product.png', contentType: 'image/png', sizeBytes: img.length, folderPath: 'web/uploads' },
        A.apiKey,
      );
      expect(pres.status).toBe(201);
      const { uploadId, fileId, uploadUrl } = pres.body.data;

      // Not completable before the bytes arrive.
      expect((await t.post(`/api/v1/uploads/${uploadId}/complete`, {}, A.apiKey)).status).toBe(409);

      const put = await t.request({ method: 'PUT', url: uploadUrl.replace('http://storage.test', ''), body: img, contentType: 'image/png' });
      expect(put.status).toBe(200);
      expect(put.body.data.receivedBytes).toBe(img.length);

      const done = await t.post(`/api/v1/uploads/${uploadId}/complete`, {}, A.apiKey);
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({ id: fileId, status: 'AVAILABLE', path: 'web/uploads/product.png' });

      // Completing twice is harmless.
      expect((await t.post(`/api/v1/uploads/${uploadId}/complete`, {}, A.apiKey)).body.data.id).toBe(fileId);
    });

    it('renames on conflict by default', async () => {
      const pres = await t.post('/api/v1/uploads/presign', { filename: 'product.png', contentType: 'image/png', sizeBytes: 10, folderPath: 'web/uploads' }, A.apiKey);
      expect(pres.body.data.path).toBe('web/uploads/product (1).png');
    });

    it('rejects a body of the wrong size', async () => {
      const pres = await t.post('/api/v1/uploads/presign', { filename: 'x.txt', contentType: 'text/plain', sizeBytes: 5 }, A.apiKey);
      const res = await t.request({ method: 'PUT', url: pres.body.data.uploadUrl.replace('http://storage.test', ''), body: Buffer.from('too long body'), contentType: 'text/plain' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SIZE_MISMATCH');
    });
  });

  describe('multipart upload', () => {
    it('streams a multipart file into a folder', async () => {
      const res = await t.multipart('/api/v1/uploads', 'report.pdf', Buffer.from('%PDF-1.4\n%fake pdf body'), A.apiKey, { folderPath: 'docs/2026' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ path: 'docs/2026/report.pdf', mimeType: 'application/pdf' });
    });
  });

  describe('file operations', () => {
    let fileId: string;
    let target: string;

    beforeAll(async () => {
      fileId = (await t.putObject('ops/source.txt', Buffer.from('hello'), A.apiKey, 'text/plain')).body.data.id;
      target = (await t.post('/api/v1/folders', { name: 'archive' }, A.apiKey)).body.data.id;
    });

    it('rename, move and copy only change metadata / make a new id', async () => {
      const renamed = await t.patch(`/api/v1/files/${fileId}`, { name: 'renamed.txt' }, A.apiKey);
      expect(renamed.body.data.path).toBe('ops/renamed.txt');
      const moved = await t.post(`/api/v1/files/${fileId}/move`, { targetFolderId: target }, A.apiKey);
      expect(moved.body.data.path).toBe('archive/renamed.txt');
      const copy = await t.post(`/api/v1/files/${fileId}/copy`, {}, A.apiKey);
      expect(copy.status).toBe(201);
      expect(copy.body.data.id).not.toBe(fileId);
      expect(copy.body.data.name).toBe('renamed (1).txt');
    });

    it('rename onto an existing name conflicts', async () => {
      const res = await t.patch(`/api/v1/files/${fileId}`, { name: 'renamed (1).txt' }, A.apiKey);
      expect(res.status).toBe(409);
    });

    it('delete → trash → restore', async () => {
      expect((await t.del(`/api/v1/files/${fileId}`, A.apiKey)).status).toBe(200);
      expect((await t.get(`/api/v1/files/${fileId}`, A.apiKey)).status).toBe(404);
      const restored = await t.post(`/api/v1/files/${fileId}/restore`, {}, A.apiKey);
      expect(restored.status).toBe(200);
      expect(restored.body.data.status).toBe('AVAILABLE');
    });

    it('renaming a folder rewrites the paths of everything inside', async () => {
      const res = await t.patch(`/api/v1/folders/${target}`, { name: 'archive-2026' }, A.apiKey);
      expect(res.body.data.path).toBe('archive-2026');
      const file = await t.get(`/api/v1/files/${fileId}`, A.apiKey);
      expect(file.body.data.path).toBe('archive-2026/renamed.txt');
      expect((await t.get(`/api/v1/objects/meta?path=archive-2026/renamed.txt`, A.apiKey)).status).toBe(200);
    });

    it('deleting a folder trashes its files; restoring the folder brings them back', async () => {
      expect((await t.del(`/api/v1/folders/${target}`, A.apiKey)).body.data.filesTrashed).toBeGreaterThan(0);
      expect((await t.get(`/api/v1/files/${fileId}`, A.apiKey)).status).toBe(404);
      const restored = await t.post(`/api/v1/folders/${target}/restore`, {}, A.apiKey);
      expect(restored.status).toBe(200);
      expect((await t.get(`/api/v1/files/${fileId}`, A.apiKey)).body.data.path).toBe('archive-2026/renamed.txt');
    });

    it('a folder cannot be moved into its own subfolder', async () => {
      const child = (await t.post('/api/v1/folders', { name: 'child', parentId: target }, A.apiKey)).body.data;
      const res = await t.post(`/api/v1/folders/${target}/move`, { targetParentId: child.id }, A.apiKey);
      expect(res.status).toBe(400);
    });

    it('search filters by name and type', async () => {
      const res = await t.get('/api/v1/files?search=renamed&mimeType=text/*', A.apiKey);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items.every((f: any) => f.name.includes('renamed'))).toBe(true);
    });
  });

  describe('quota, permissions, idempotency', () => {
    it('enforces the tenant storage quota with 413', async () => {
      const Q = await createTenant(t, 'Quota');
      const big = Buffer.alloc(30 * 1024 * 1024, 1);
      expect((await t.putObject('big1.bin', big, Q.apiKey)).status).toBe(200);
      const res = await t.putObject('big2.bin', big, Q.apiKey);
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
      const tenant = await t.get('/api/v1/tenants/me', Q.token);
      expect(tenant.body.data.storage.usedBytes).toBe(big.length);
      expect(tenant.body.data.storage.fileCount).toBe(1);
    });

    it('read-only API keys cannot upload', async () => {
      const key = await t.post('/api/v1/api-keys', { projectId: A.projectId, name: 'ro', permissions: ['files.read'] }, A.token);
      const res = await t.putObject('ro.txt', Buffer.from('x'), key.body.data.apiKey, 'text/plain');
      expect(res.status).toBe(403);
    });

    it('revoked keys stop working', async () => {
      const key = await t.post('/api/v1/api-keys', { projectId: A.projectId, name: 'temp' }, A.token);
      expect((await t.get('/api/v1/files', key.body.data.apiKey)).status).toBe(200);
      await t.post(`/api/v1/api-keys/${key.body.data.id}/revoke`, {}, A.token);
      const res = await t.get('/api/v1/files', key.body.data.apiKey);
      expect(res.status).toBe(401);
    });

    it('replays the response for a repeated Idempotency-Key instead of uploading twice', async () => {
      const headers = { 'idempotency-key': 'retry-test-0001' };
      const body = { filename: 'once.txt', contentType: 'text/plain', sizeBytes: 4 };
      const first = await t.post('/api/v1/uploads/presign', body, A.apiKey, headers);
      const second = await t.post('/api/v1/uploads/presign', body, A.apiKey, headers);
      expect(second.body.data.uploadId).toBe(first.body.data.uploadId);
      expect(second.headers['idempotent-replayed']).toBe('true');
    });
  });

  describe('auth', () => {
    it('refresh tokens rotate and a reused one kills the session family', async () => {
      const email = `rotate-${Date.now()}@example.com`;
      const reg = await t.post('/api/v1/auth/register', { tenantName: 'Rotate Co', name: 'R', email, password: 'correct-horse-battery' });
      const r1 = reg.body.data.refreshToken;
      const second = await t.post('/api/v1/auth/refresh', { refreshToken: r1 });
      expect(second.status).toBe(200);
      const r2 = second.body.data.refreshToken;
      // Replay of r1 → family revoked → r2 no longer works either.
      expect((await t.post('/api/v1/auth/refresh', { refreshToken: r1 })).status).toBe(401);
      expect((await t.post('/api/v1/auth/refresh', { refreshToken: r2 })).status).toBe(401);
    });

    it('wrong password and unknown user look the same', async () => {
      const a = await t.post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'whatever-123' });
      const reg = await t.post('/api/v1/auth/register', { tenantName: 'Login Co', name: 'L', email: `login-${Date.now()}@example.com`, password: 'correct-horse-battery' });
      const b = await t.post('/api/v1/auth/login', { email: reg.body.data.user.email, password: 'wrong-password-1' });
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body.error).toEqual(b.body.error);
    });
  });
});
