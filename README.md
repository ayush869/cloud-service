# Cloud Storage

Self-hosted, multi-tenant file storage, built as a replacement for Amazon S3. Run it on
your own server (e.g. an EC2 instance). Your websites and apps then store images and files
through its REST API.

- **Tenants** (customers) own **projects** (websites/apps). Each project has its own API keys,
  folders and files. Tenants are completely isolated from each other.
- Files live on the server's disk, under random object keys. Names and folders live in MySQL,
  so rename and move are instant metadata updates.
- **Public files** get permanent, cacheable URLs (like S3 `public-read`), plus on-the-fly WebP
  thumbnails (`?v=thumb|small|medium|large`).
- **Private files** are only reachable through short-lived signed links.
- Includes trash and restore, storage quotas, RBAC, audit logs, Redis rate limiting,
  idempotent uploads, and Swagger at `/docs`.

```
cloud-service/
├── backend/            NestJS + Fastify API, worker and CLI (TypeScript)
│   ├── src/            modules: auth, tenants, users, projects, api-keys, folders, files,
│   │                   uploads, downloads, objects, storage, quotas, audit, jobs, health
│   ├── prisma/         schema + migrations (MySQL 8)
│   └── test/           unit, integration and tenant-isolation security tests
├── nginx/              reverse proxy config (serves file bytes via X-Accel-Redirect)
├── docker-compose.yml  MySQL + Redis + API + worker + nginx on one server
└── docs/               architecture, API, deployment, Laravel integration
```

## Quick start (local development)

Requirements: Node 20+, MySQL 8 or MariaDB 10.4+. Redis is optional locally; without it,
rate limits, cache and background jobs run in-process.

```bash
cd backend
cp .env.example .env          # set DATABASE_URL, STORAGE_ROOT=./storage-data, REDIS_HOST= (empty)
npm install
npx prisma migrate deploy
npm run build && npm start    # http://localhost:3000, Swagger at /docs
```

Create a tenant, a project and an API key with the CLI:

```bash
node dist/cli.js tenant:create --name "Jewelpilot" --slug jewelpilot --email you@example.com --password '...'
node dist/cli.js project:create jewelpilot "Website" --slug website --public
node dist/cli.js apikey:create jewelpilot website "laravel"      # prints cs_live_... once
```

Upload a file and fetch it:

```bash
curl -X PUT "http://localhost:3000/api/v1/objects?path=images/ring.jpg" \
     -H "Authorization: Bearer cs_live_..." -H "Content-Type: image/jpeg" --data-binary @ring.jpg
# -> data.url = http://localhost:3000/p/jewelpilot/website/images/ring.jpg
```

## Tests

```bash
npm test             # unit
npm run test:e2e     # integration + tenant-isolation matrix (needs database cloud_storage_test)
```

## Documentation

- [docs/architecture.md](docs/architecture.md): design, tenant isolation, storage layout, security
- [docs/api.md](docs/api.md): authentication and every endpoint, with examples
- [docs/deployment.md](docs/deployment.md): installing on an EC2 server
- [docs/integration-laravel.md](docs/integration-laravel.md): replacing S3 in a Laravel app (jewelpilot)
