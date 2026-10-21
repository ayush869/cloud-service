# Architecture

## Overview

A modular monolith: one NestJS application on the Fastify adapter, plus a worker process
built from the same code. It is not split into microservices.

```
 Website / Laravel app ──(API key)──┐
 Dashboard ─────────────(JWT)───────┤
 Browsers (public images) ──────────┤
                                    ▼
                               nginx :80/443 ──────── X-Accel-Redirect ───┐
                                    │                                      │
                                    ▼                                      ▼
                         NestJS + Fastify (API)                 STORAGE_ROOT on disk
        Controllers → Guards → Services → Repositories → Prisma → MySQL (metadata)
                                    │       └→ StorageService → StorageProvider → disk
                                    └→ Redis (rate limits, cache, BullMQ) → worker
```

Every module follows **Controller → Service → Repository**. Controllers never touch Prisma,
Redis, the queue or the disk. Business rules live in services; queries live in repositories.

| Module | Responsibility |
|---|---|
| `auth` | register, login, JWT access tokens, rotating refresh tokens, password reset; the global `AuthGuard` |
| `tenants`, `users`, `projects`, `api-keys` | tenant administration, RBAC roles, per-project keys and allowed origins |
| `folders`, `files` | logical tree, rename / move / copy / trash / restore / permanent delete, search |
| `uploads` | direct streaming upload, presign → PUT → complete flow, quota and type checks |
| `downloads` | signed links (`/d/…`), public URLs (`/p/…`), Range/ETag/304, X-Accel-Redirect |
| `objects` | S3-style path API (`PUT/GET/HEAD/DELETE /objects?path=`) for server-side clients |
| `storage` | provider abstraction (local disk today), signed URLs, Sharp image variants |
| `quotas`, `audit`, `jobs`, `maintenance`, `health` | usage accounting, audit trail, BullMQ, cleanup jobs, probes |

## Multi-tenancy and isolation

- Every tenant-owned table has `tenant_id`. **Every repository method takes the tenant id**
  (and the project id for files and folders), so no query can address a row by id alone.
- The tenant comes only from the verified credential:
  - A JWT carries the user, re-checked against the database (cached for 30s).
  - An API key resolves to key → project → tenant.
  
  A `tenantId` sent in a body is rejected as an unknown property.
- Dashboard (JWT) calls choose a project with `X-Project-Id`, which is verified to belong to
  the user's tenant. API keys are bound to one project; any other `X-Project-Id` gives 404.
- Cross-tenant access returns **404**, the same response as a resource that does not exist.
- `test/security/tenant-isolation.e2e-spec.ts` covers the full allow/deny matrix (files,
  folders, downloads, rename, move, copy, delete, restore, keys, users, signed URLs, upload
  tokens, public URLs).

## Storage layout

```
STORAGE_ROOT/
└── tenants/{tenantId}/
    ├── objects/{xx}/{objectId}                  original bytes (objectId = random UUID)
    └── variants/{xx}/{objectId}/{thumb|small|medium|large}.webp
```

- `xx` is the first two characters of the object id. This spreads objects over 256
  directories so no single directory grows huge.
- The logical path (`jewel-pilot/images/banner-image/a.jpg`) lives only in MySQL.
  - Renaming or moving a file or folder never touches the disk.
  - Copying makes a new object (a copy-on-write clone on XFS/btrfs).
- Writes stream to a temp file in the same directory and are then renamed into place, so a
  crash never leaves a half-written object under a real key.
- Paths are unique per project through `path_hash = sha256(projectId:path)`, which has a unique
  index. Trashed rows set the hash to NULL, so a deleted name can be reused.
- The provider interface (`StorageProvider`) lets S3, R2 or MinIO be added later without
  changing anything above `StorageService`.

## Upload paths

1. **Direct (server-to-server).** `PUT /objects?path=` with a raw body, or multipart `POST /uploads`.
   - The body streams to disk while being counted, SHA-256 hashed and size-limited.
   - The first 4 KB are sniffed for the real file type.
   - The quota, file row, version row and audit row are then committed in one transaction.
     If anything fails, the bytes are removed.
2. **Presigned (browser).** `POST /uploads/presign` reserves the path (a PENDING file) and
   returns a signed `PUT` URL on this server.
   - The browser sends the bytes there, then calls `POST /uploads/{id}/complete`.
   - Abandoned sessions expire, and a job frees the path and deletes the bytes.

File types are decided from **magic bytes**, never from the name or the client's
Content-Type:
- An HTML page renamed to `.jpg` is rejected.
- Executables are always rejected.
- Each project can whitelist extensions.

## Serving

- `/p/{tenantSlug}/{projectSlug}/{path}` serves PUBLIC files.
  - Lookups are cached in two levels: a 5-second in-process LRU in front of Redis.
  - Responses send `Cache-Control: public`, ETag/304 and Range support.
- `/d/{token}` is an HMAC-signed, expiring link to one file of one tenant. It replaces S3
  presigned URLs.
- With `SERVE_MODE=x-accel`, the API only authorizes the request and nginx sends the bytes
  with `sendfile`, so Node never handles file I/O.
- Non-image types are sent as attachments with `nosniff` and a sandbox CSP, so uploaded
  content can never run scripts on the storage domain.

## Background jobs

BullMQ on Redis, executed by `dist/worker.js`:

| Job | When |
|---|---|
| `image-variants` | after each image upload (WebP thumb/small/medium/large) |
| `purge-objects` | after permanent delete / overwrite (removes bytes + variants) |
| `expire-uploads` | every 10 min: abandoned presigned uploads |
| `purge-trash` | every 6 h: trash older than `TRASH_RETENTION_DAYS` |
| `reconcile-usage` | daily: recompute `storage_usage` from `files` |

Without Redis (single instance or development), the same jobs run in-process.

## Security summary

- Passwords: Argon2id.
- Access JWTs (HS256) last 15 minutes and carry only ids.
- Refresh tokens are opaque and stored hashed. They rotate on every use, and replaying an
  old one revokes the whole session family.
- API keys look like `cs_live_{prefix}_{secret}`. Only an HMAC of the secret is stored, and
  each key is shown once. A key gets a permission subset that can't exceed its creator's.
  A key used from a browser must come from one of the project's registered origins.
- RBAC roles: OWNER / ADMIN / MANAGER / MEMBER / VIEWER, which map to explicit permissions.
- Redis rate limits: login per IP, API / presign / download per project.
- Audit log of every mutation and download link. Secrets, tokens and signed URLs are never
  logged; request logs redact them.
- Security headers come from Helmet, and CORS is restricted to registered project origins.
- Errors are a uniform `{ success:false, error:{code,message} }` with no stack traces.
