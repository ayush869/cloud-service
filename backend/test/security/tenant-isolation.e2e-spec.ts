import { createTenant, jpeg, TenantFixture, TestApp } from '../helpers/test-app';

/**
 * The mandatory isolation matrix: Tenant A can do everything with its own resources and
 * nothing with Tenant B's. Cross-tenant access must look exactly like "does not exist" (404).
 */
describe('Tenant isolation', () => {
  let t: TestApp;
  let A: TenantFixture;
  let B: TenantFixture;
  let aFile: { id: string; path: string };
  let aPublicFile: { id: string; path: string; url: string };
  let aFolder: { id: string };
  let bFolder: { id: string };

  beforeAll(async () => {
    t = await TestApp.start();
    A = await createTenant(t, 'Alpha');
    B = await createTenant(t, 'Bravo');

    const img = await jpeg();
    const up = await t.putObject('secret/plan.jpg', img, A.apiKey, 'image/jpeg', '&visibility=PRIVATE');
    expect(up.status).toBe(200);
    aFile = up.body.data;
    const pub = await t.putObject('public/logo.jpg', img, A.apiKey, 'image/jpeg', '&visibility=PUBLIC');
    aPublicFile = pub.body.data;

    aFolder = (await t.post('/api/v1/folders', { name: 'alpha-folder' }, A.apiKey)).body.data;
    bFolder = (await t.post('/api/v1/folders', { name: 'bravo-folder' }, B.apiKey)).body.data;
  });

  afterAll(() => t.stop());

  const expect404 = (res: { status: number; body: any }) => {
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/another tenant|belongs/i);
  };

  describe('files', () => {
    it('A → A file metadata = ALLOW, B → A file = DENY', async () => {
      expect((await t.get(`/api/v1/files/${aFile.id}`, A.apiKey)).status).toBe(200);
      expect404(await t.get(`/api/v1/files/${aFile.id}`, B.apiKey));
      expect404(await t.get(`/api/v1/files/${aFile.id}`, B.token, B.projectHeaders));
    });

    it('A → A download = ALLOW, B → A download = DENY', async () => {
      const own = await t.get(`/api/v1/files/${aFile.id}/download`, A.apiKey);
      expect(own.status).toBe(200);
      expect(own.body.data.downloadUrl).toMatch(/^http:\/\/storage\.test\/d\//);
      expect404(await t.get(`/api/v1/files/${aFile.id}/download`, B.apiKey));
    });

    it('B cannot rename, move, copy, delete, restore or permanently delete A files', async () => {
      expect404(await t.patch(`/api/v1/files/${aFile.id}`, { name: 'pwned.jpg' }, B.apiKey));
      expect404(await t.post(`/api/v1/files/${aFile.id}/move`, { targetFolderId: bFolder.id }, B.apiKey));
      expect404(await t.post(`/api/v1/files/${aFile.id}/copy`, { targetFolderId: bFolder.id }, B.apiKey));
      expect404(await t.del(`/api/v1/files/${aFile.id}`, B.apiKey));
      expect404(await t.post(`/api/v1/files/${aFile.id}/restore`, {}, B.apiKey));
      expect404(await t.del(`/api/v1/files/${aFile.id}/permanent`, B.apiKey));
      // Still intact for A.
      const own = await t.get(`/api/v1/files/${aFile.id}`, A.apiKey);
      expect(own.body.data.name).toBe('plan.jpg');
      expect(own.body.data.status).toBe('AVAILABLE');
    });

    it('A → A rename/move = ALLOW', async () => {
      const renamed = await t.patch(`/api/v1/files/${aFile.id}`, { name: 'plan-v2.jpg' }, A.apiKey);
      expect(renamed.status).toBe(200);
      const moved = await t.post(`/api/v1/files/${aFile.id}/move`, { targetFolderId: aFolder.id }, A.apiKey);
      expect(moved.status).toBe(200);
      expect(moved.body.data.path).toBe('alpha-folder/plan-v2.jpg');
      aFile = moved.body.data;
    });

    it('A cannot move its own file into a B folder', async () => {
      expect404(await t.post(`/api/v1/files/${aFile.id}/move`, { targetFolderId: bFolder.id }, A.apiKey));
    });

    it('listing and search only ever return the caller’s files', async () => {
      await t.putObject('bravo/only.txt', Buffer.from('b'), B.apiKey, 'text/plain');
      const listB = await t.get('/api/v1/files?search=plan', B.apiKey);
      expect(listB.body.data.items).toHaveLength(0);
      const allB = await t.get('/api/v1/files', B.apiKey);
      expect(allB.body.data.items.every((f: any) => f.projectId === B.projectId)).toBe(true);
    });

    it('paths are namespaced per project: B cannot read A objects by path', async () => {
      expect((await t.get(`/api/v1/objects/meta?path=${encodeURIComponent(aFile.path)}`, A.apiKey)).status).toBe(200);
      expect404(await t.get(`/api/v1/objects/meta?path=${encodeURIComponent(aFile.path)}`, B.apiKey));
      expect404(await t.get(`/api/v1/objects?path=${encodeURIComponent(aFile.path)}`, B.apiKey));
      expect404(await t.del(`/api/v1/objects?path=${encodeURIComponent(aFile.path)}`, B.apiKey));
    });
  });

  describe('folders', () => {
    it('A → A folder = ALLOW, B → A folder = DENY', async () => {
      expect((await t.get(`/api/v1/folders/${aFolder.id}`, A.apiKey)).status).toBe(200);
      expect404(await t.get(`/api/v1/folders/${aFolder.id}`, B.apiKey));
      expect404(await t.patch(`/api/v1/folders/${aFolder.id}`, { name: 'x' }, B.apiKey));
      expect404(await t.post(`/api/v1/folders/${aFolder.id}/move`, { targetParentId: bFolder.id }, B.apiKey));
      expect404(await t.del(`/api/v1/folders/${aFolder.id}`, B.apiKey));
      expect404(await t.post('/api/v1/folders', { name: 'inside-a', parentId: aFolder.id }, B.apiKey));
      expect404(await t.get(`/api/v1/files?folderId=${aFolder.id}`, B.apiKey));
    });
  });

  describe('projects and credentials', () => {
    it('A API key → A project = ALLOW, A API key → B project = DENY', async () => {
      expect((await t.get('/api/v1/files', A.apiKey, { 'x-project-id': A.projectId })).status).toBe(200);
      expect404(await t.get('/api/v1/files', A.apiKey, { 'x-project-id': B.projectId }));
    });

    it('A dashboard user cannot select B project', async () => {
      expect((await t.get('/api/v1/files', A.token, A.projectHeaders)).status).toBe(200);
      expect404(await t.get('/api/v1/files', A.token, B.projectHeaders));
      expect404(await t.get(`/api/v1/projects/${B.projectId}`, A.token));
    });

    it('B cannot see, revoke or mint keys for A projects', async () => {
      const keysA = await t.get('/api/v1/api-keys', A.token);
      const keyId = keysA.body.data[0].id;
      expect404(await t.post(`/api/v1/api-keys/${keyId}/revoke`, {}, B.token));
      expect404(await t.post('/api/v1/api-keys', { projectId: A.projectId, name: 'steal' }, B.token));
      const keysB = await t.get('/api/v1/api-keys', B.token);
      expect(keysB.body.data.every((k: any) => k.projectId === B.projectId)).toBe(true);
    });

    it('B cannot read A users', async () => {
      expect404(await t.get(`/api/v1/users/${A.userId}`, B.token));
    });

    it('tenantId in the request body is ignored', async () => {
      const res = await t.post('/api/v1/folders', { name: 'sneaky', tenantId: A.tenantId }, B.apiKey);
      // Unknown properties are rejected outright - the tenant only ever comes from the credential.
      expect(res.status).toBe(400);
    });

    it('API keys cannot use dashboard-only endpoints', async () => {
      const res = await t.get('/api/v1/api-keys', A.apiKey);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_TYPE_NOT_ALLOWED');
    });
  });

  describe('URLs', () => {
    it('public URL serves only PUBLIC files', async () => {
      const ok = await t.get(aPublicFile.url.replace('http://storage.test', ''));
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toBe('image/jpeg');
      const privatePath = `/p/${A.slug}/${A.projectSlug}/${aFile.path}`;
      expect404(await t.get(privatePath));
    });

    it('B project slug cannot reach A files', async () => {
      expect404(await t.get(`/p/${B.slug}/${B.projectSlug}/public/logo.jpg`));
      expect404(await t.get(`/p/${B.slug}/${A.projectSlug}/public/logo.jpg`));
    });

    it('signed download links cannot be tampered with', async () => {
      const link = (await t.get(`/api/v1/files/${aFile.id}/download`, A.apiKey)).body.data.downloadUrl as string;
      const path = link.replace('http://storage.test', '');
      expect((await t.get(path)).status).toBe(200);

      const token = path.slice(3);
      const [body, sig] = token.split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      const forged = Buffer.from(JSON.stringify({ ...payload, t: B.tenantId })).toString('base64url');
      const res = await t.get(`/d/${forged}.${sig}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_DOWNLOAD_LINK');
    });

    it('an upload token of A cannot be used for an upload of B', async () => {
      const presA = await t.post('/api/v1/uploads/presign', { filename: 'a.txt', contentType: 'text/plain', sizeBytes: 3 }, A.apiKey);
      const presB = await t.post('/api/v1/uploads/presign', { filename: 'b.txt', contentType: 'text/plain', sizeBytes: 3 }, B.apiKey);
      const tokenA = new URL(presA.body.data.uploadUrl).searchParams.get('token');
      const res = await t.request({
        method: 'PUT',
        url: `/api/v1/uploads/${presB.body.data.uploadId}/content?token=${tokenA}`,
        body: Buffer.from('abc'),
        contentType: 'text/plain',
      });
      expect(res.status).toBe(403);
      // And B cannot complete A's upload.
      expect404(await t.post(`/api/v1/uploads/${presA.body.data.uploadId}/complete`, {}, B.apiKey));
    });
  });
});
