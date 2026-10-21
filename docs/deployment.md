# Deploying on an EC2 server

One instance runs everything with Docker Compose: MySQL, Redis, API, worker and nginx.
File bytes go on an EBS volume mounted on the host.

## 1. Instance

- Ubuntu 24.04, at least 2 vCPU / 4 GB RAM (t3.medium or larger). Sharp image resizing is
  CPU-bound.
- Root disk 30 GB, plus a **separate EBS data volume** (gp3) sized for your files. Resize it
  later without downtime.
- Security group: allow 80/443 from anywhere and 22 from your IP only. Never expose 3000,
  3306 or 6379.

```bash
# format + mount the data volume (check the device name with lsblk)
sudo mkfs.xfs /dev/nvme1n1
sudo mkdir -p /srv/cloud-storage
echo '/dev/nvme1n1 /srv/cloud-storage xfs defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a
sudo mkdir -p /srv/cloud-storage/data && sudo chown -R 1000:1000 /srv/cloud-storage/data

# docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out / in
```

XFS is recommended: file copies become instant copy-on-write clones.

## 2. Configure and start

```bash
git clone <this repo> cloud-service && cd cloud-service
cp .env.example .env
nano .env        # PUBLIC_BASE_URL, MYSQL_*, the three secrets, STORAGE_HOST_PATH=/srv/cloud-storage/data
docker compose up -d --build
docker compose ps                      # api, worker, nginx running; migrate exited 0
curl -s http://localhost/health/ready  # database/redis/storage all "up"
```

Generate each secret with `openssl rand -base64 48 | tr -d '\n='`. Keep them stable:
- Changing `URL_SIGNING_SECRET` invalidates outstanding signed links.
- Changing `API_KEY_PEPPER` invalidates every API key.

## 3. HTTPS

Point a DNS record (e.g. `storage.example.com`) at the instance (Elastic IP). Then choose one:

- **AWS ALB + ACM certificate** forwarding to port 80 on the instance. Easiest, with
  auto-renewing certificates.
- **certbot on the host**: add a `listen 443 ssl` server block to `nginx/default.conf`,
  mount `/etc/letsencrypt` into the nginx container, and publish port 443.

`PUBLIC_BASE_URL` must be the https URL, because public and signed file URLs are built
from it.

## 4. Create your tenant, project and key

```bash
docker compose exec api node dist/cli.js tenant:create --name "Jewelpilot" --slug jewelpilot \
  --email you@example.com --password 'a-long-password'
docker compose exec api node dist/cli.js tenant:set-limit jewelpilot 500GB
docker compose exec api node dist/cli.js project:create jewelpilot "Website" --slug website --public \
  --origins https://jewelpilot.com,https://www.jewelpilot.com
docker compose exec api node dist/cli.js apikey:create jewelpilot website "laravel"
```

The project's public base URL is `https://storage.example.com/p/jewelpilot/website`.

## 5. Migrating existing files

Copy the old files to the server first, preserving the folder structure. From S3, for
example: `aws s3 sync s3://<bucket>/jewel-pilot ./import/jewel-pilot`. From a Laravel
`public/jewel-pilot` folder, use `rsync`. Then:

```bash
docker compose cp ./import api:/tmp/import
docker compose exec api node dist/cli.js import jewelpilot website /tmp/import
#   --prefix some/path    put everything under a prefix
#   --private             import as PRIVATE instead of PUBLIC
#   --skip-existing       do not overwrite paths that already exist
```

Paths are kept exactly as they were, so the names already stored in your database keep
working.

## 6. Verify X-Accel mode

`SERVE_MODE=x-accel` makes nginx send file bytes (sendfile) instead of Node. After
deploying, check that a public file keeps its headers:

```bash
curl -sI https://storage.example.com/p/jewelpilot/website/<some image path>
# expect: 200, the right Content-Type, Cache-Control: public, Access-Control-Allow-Origin: *
```

If anything looks wrong, set `SERVE_MODE=stream` in `.env` and run `docker compose up -d`.
Node then serves the bytes itself, which is slower under heavy load but behaves the same.

## Operations

| Task | Command |
|---|---|
| Logs | `docker compose logs -f api worker` (one JSON line per request with tenant/project ids) |
| Upgrade | `git pull && docker compose up -d --build` (migrations run automatically) |
| Scale | `docker compose up -d --scale api=3` (stateless; Redis shares limits/cache/jobs) |
| Backups | EBS snapshots of the data volume (Data Lifecycle Manager) + `mysqldump` of `cloud_storage`. **Back up both** - metadata and bytes belong together. |
| Monitoring | alert on `/health/ready`, disk usage of the data volume, 5xx rate in logs |

When you outgrow one box, move MySQL to RDS and Redis to ElastiCache by changing the env
values. Run several API instances behind an ALB on shared storage (EFS), or add an S3/R2
`StorageProvider`.
