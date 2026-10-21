# API reference

Base URL: `https://storage.example.com/api/v1`. The full interactive reference is Swagger at
`/docs` (enable it with `SWAGGER_ENABLED=true`).

## Conventions

**Authentication**: `Authorization: Bearer <credential>`

| Credential | Who uses it | Project |
|---|---|---|
| `cs_live_…` API key | websites / backends (server-side) | fixed by the key |
| JWT access token | dashboard users | send `X-Project-Id: <uuid>` for files/folders/uploads |

**Responses**

```json
{ "success": true, "data": { }, "message": "optional", "requestId": "uuid" }
{ "success": false, "error": { "code": "FILE_NOT_FOUND", "message": "File not found" }, "requestId": "uuid" }
```

| Status | Typical codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `PROJECT_REQUIRED`, `SIZE_MISMATCH`, `INVALID_MOVE` |
| 401 | `UNAUTHORIZED`, `INVALID_API_KEY`, `INVALID_CREDENTIALS` |
| 403 | `FORBIDDEN`, `AUTH_TYPE_NOT_ALLOWED`, `ORIGIN_NOT_ALLOWED`, `INVALID_DOWNLOAD_LINK` |
| 404 | `FILE_NOT_FOUND`, `FOLDER_NOT_FOUND`, `PROJECT_NOT_FOUND` (also for other tenants' ids) |
| 409 | `PATH_EXISTS`, `FILE_EXISTS`, `UPLOAD_IN_PROGRESS`, `PARENT_DELETED`, `IDEMPOTENCY_IN_PROGRESS` |
| 413 | `QUOTA_EXCEEDED`, `FILE_TOO_LARGE` |
| 415 / 422 | `UNSUPPORTED_MEDIA_TYPE` / `UNSUPPORTED_FILE_TYPE` |
| 429 | `RATE_LIMITED` (see `Retry-After`) |

**Idempotency**: send `Idempotency-Key: <8-128 chars>` on `POST /uploads`,
`/uploads/presign`, `/uploads/{id}/complete` and `PUT /objects`. A retry with the same key
returns the original response (with header `Idempotent-Replayed: true`).

**Paths** are like S3 keys: `folder/sub/name.ext`. `..`, empty segments and control
characters are rejected. Missing folders are created automatically.

## Objects API (S3-style, for server-side code)

| | |
|---|---|
| `PUT /objects?path=a/b/c.jpg&visibility=PUBLIC&onConflict=overwrite` | body = raw bytes, `Content-Type` = file type. Default `onConflict=overwrite` keeps the file id and bumps `version`. |
| `GET /objects?path=…[&v=thumb]` | streams the bytes (works for private files) |
| `HEAD /objects?path=…` | 200 / 404 with `Content-Length`, `Content-Type`, `ETag` |
| `GET /objects/meta?path=…` | JSON metadata incl. `url` and `variants` |
| `GET /objects/list?prefix=a/b/&page=1&limit=50` | listing |
| `DELETE /objects?path=…[&permanent=true]` | to trash, or destroy immediately |

```bash
curl -X PUT "$BASE/objects?path=jewel-pilot/images/ring.jpg" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: image/jpeg" --data-binary @ring.jpg
```

## Uploads

**Direct multipart**: `POST /uploads` (`multipart/form-data`, field `file`). Options go in
the query string or as form fields placed before the file: `path` | `folderId` |
`folderPath`, `visibility`, `onConflict` (`rename` default, `error`, `overwrite`).

**Browser flow** (no API key in the upload request itself):

```js
// 1. your backend (with the API key) asks for an upload URL
const { data } = await api.post('/uploads/presign', {
  filename: file.name, contentType: file.type, sizeBytes: file.size, folderPath: 'products',
});
// 2. the browser sends the bytes straight to the storage server
await fetch(data.uploadUrl, { method: 'PUT', headers: data.headers, body: file });
// 3. your backend completes it
await api.post(`/uploads/${data.uploadId}/complete`);
```

`presign` returns `{ uploadId, fileId, path, uploadUrl, method, headers, expiresIn }`. Name
conflicts are renamed by default (`photo (1).jpg`); pass `onConflict: "error"` to refuse.
The body must be exactly `sizeBytes`.

## Files

| | |
|---|---|
| `GET /files?search=&folderId=<uuid>|root&prefix=&mimeType=image/*&extension=&minSize=&maxSize=&createdFrom=&sort=name|createdAt|updatedAt|sizeBytes&order=asc|desc&page=&limit=` | list / search |
| `GET /files/{id}` | metadata |
| `PATCH /files/{id}` `{ "name"?, "visibility"? }` | rename and/or change visibility |
| `POST /files/{id}/move` `{ "targetFolderId": uuid|null }` | move (metadata only) |
| `POST /files/{id}/copy` `{ "targetFolderId"?, "newName"? }` | new file, new id, server-side copy |
| `DELETE /files/{id}` | to trash |
| `POST /files/{id}/restore` | from trash |
| `DELETE /files/{id}/permanent` | destroy, frees quota |
| `POST /files/bulk/delete` `{ "ids": [] }`, `POST /files/bulk/move` `{ "ids": [], "targetFolderId" }` | up to 100 ids |
| `GET /files/{id}/download?disposition=inline|attachment&variant=thumb&expiresIn=300` | `{ downloadUrl, expiresIn }` |
| `GET /trash` | trashed files (paged) and folders |

A file object:

```json
{
  "id": "…", "projectId": "…", "folderId": "…", "name": "ring.jpg", "path": "jewel-pilot/images/ring.jpg",
  "mimeType": "image/jpeg", "extension": "jpg", "sizeBytes": 245832, "checksum": "<sha256>",
  "status": "AVAILABLE", "visibility": "PUBLIC", "version": 1,
  "url": "https://storage.example.com/p/jewelpilot/website/jewel-pilot/images/ring.jpg",
  "variants": { "thumb": "…?v=thumb", "small": "…?v=small", "medium": "…?v=medium", "large": "…?v=large" },
  "createdAt": "…", "updatedAt": "…", "deletedAt": null
}
```

## Folders

`POST /folders {name, parentId?}` · `GET /folders?parentId=` · `GET /folders/{id}` (with
breadcrumb) · `PATCH /folders/{id} {name}` · `POST /folders/{id}/move {targetParentId}` ·
`DELETE /folders/{id}` (trashes the subtree) · `POST /folders/{id}/restore` ·
`DELETE /folders/{id}/permanent`

## File URLs

| URL | Access |
|---|---|
| `/p/{tenantSlug}/{projectSlug}/{path}[?v=thumb|small|medium|large]` | PUBLIC files, permanent, `Cache-Control: public` |
| `/d/{token}` | signed link from `/files/{id}/download`, expires |

Variants are WebP renditions: thumb 300×300 crop, small 480w, medium 800w, large 1600w.
Each is generated once and then served from disk.

## Auth, tenants, users, projects, keys

| | |
|---|---|
| `POST /auth/register {tenantName, name, email, password}` | when `REGISTRATION_ENABLED=true` |
| `POST /auth/login {email, password}` | `{accessToken, refreshToken, expiresIn, user, tenant}` |
| `POST /auth/refresh {refreshToken}` · `POST /auth/logout {refreshToken}` | |
| `POST /auth/forgot-password {email}` · `POST /auth/reset-password {token, password}` | |
| `GET /tenants/me` (includes storage usage) · `PATCH /tenants/me {name}` | |
| `GET/POST /users`, `GET/PATCH/DELETE /users/{id}` | roles: OWNER, ADMIN, MANAGER, MEMBER, VIEWER |
| `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}` | `allowedOrigins`, `settings.defaultVisibility / maxUploadBytes / allowedExtensions` |
| `GET/POST /api-keys`, `POST /api-keys/{id}/revoke` | the full key is returned once on create |
| `GET /audit-logs?action=&resourceId=` | |
| `GET /health`, `GET /health/ready` | liveness / readiness (database, redis, storage) |
