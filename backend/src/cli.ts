import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Visibility } from '@prisma/client';
import { AppModule } from './app.module';
import { AuthService } from './auth/services/auth.service';
import { ApiKeysService } from './api-keys/services/api-keys.service';
import { PERMISSIONS } from './common/constants';
import { ProjectContext } from './common/types';
import { PrismaService } from './database/prisma.service';
import { JobsService } from './jobs/jobs.service';
import { ProjectsService } from './projects/services/projects.service';
import { UploadsService } from './uploads/services/uploads.service';

/**
 * Operator CLI (run on the server):
 *   node dist/cli.js tenant:create  --name "ABC Jewellery" --email owner@abc.com --password '...' [--slug abc]
 *   node dist/cli.js tenant:set-limit <tenantSlug> <size, e.g. 100GB>
 *   node dist/cli.js project:create <tenantSlug> <name> [--slug x] [--public] [--origins https://a.com,https://b.com]
 *   node dist/cli.js apikey:create  <tenantSlug> <projectSlug> [name]
 *   node dist/cli.js import         <tenantSlug> <projectSlug> <localDir> [--prefix some/path] [--private] [--skip-existing]
 */
const USAGE = 'Commands: tenant:create, tenant:set-limit, project:create, apikey:create, import (see src/cli.ts)';

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function parseSize(input: string): bigint {
  const m = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i.exec(input.trim());
  if (!m) throw new Error(`Invalid size "${input}" (examples: 500MB, 100GB, 2TB)`);
  const unit = (m[2] ?? 'B').toUpperCase();
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit]!;
  return BigInt(Math.round(Number(m[1]) * mult));
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command) {
    console.log(USAGE);
    return;
  }
  process.env.DISABLE_INLINE_SCHEDULER = 'true';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  const systemContext = async (tenantSlug: string, projectSlug?: string): Promise<ProjectContext> => {
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new Error(`Tenant "${tenantSlug}" not found`);
    let projectId = '';
    if (projectSlug) {
      const project = await prisma.project.findFirst({ where: { tenantId: tenant.id, slug: projectSlug, deletedAt: null } });
      if (!project) throw new Error(`Project "${projectSlug}" not found in tenant "${tenantSlug}"`);
      projectId = project.id;
    }
    return {
      tenantId: tenant.id,
      projectId,
      authType: 'JWT',
      role: 'OWNER',
      permissions: new Set(PERMISSIONS),
      ipAddress: 'cli',
      userAgent: 'cli',
      requestId: `cli-${Date.now()}`,
    };
  };

  try {
    switch (command) {
      case 'tenant:create': {
        const { name, email, password, slug } = flags as Record<string, string>;
        if (!name || !email || !password) throw new Error('tenant:create needs --name, --email and --password');
        const session = await app.get(AuthService).register(
          { tenantName: name, tenantSlug: slug, name: String(flags.owner ?? name), email, password },
          { ipAddress: 'cli', requestId: 'cli' },
          { bypassToggle: true },
        );
        console.log(`Tenant created: ${session.tenant.name} (slug: ${session.tenant.slug}, id: ${session.tenant.id})`);
        console.log(`Owner login: ${session.user.email}`);
        break;
      }
      case 'tenant:set-limit': {
        const [slug, size] = positional;
        if (!slug || !size) throw new Error('Usage: tenant:set-limit <tenantSlug> <size>');
        const bytes = parseSize(size);
        await prisma.tenant.update({ where: { slug }, data: { storageLimitBytes: bytes } });
        console.log(`Storage limit of "${slug}" set to ${bytes} bytes`);
        break;
      }
      case 'project:create': {
        const [tenantSlug, name] = positional;
        if (!tenantSlug || !name) throw new Error('Usage: project:create <tenantSlug> <name> [--slug x] [--public] [--origins a,b]');
        const ctx = await systemContext(tenantSlug);
        const project = await app.get(ProjectsService).create(ctx, {
          name,
          slug: typeof flags.slug === 'string' ? flags.slug : undefined,
          allowedOrigins: typeof flags.origins === 'string' ? flags.origins.split(',').map((s) => s.trim()) : [],
          settings: { defaultVisibility: flags.public ? 'PUBLIC' : 'PRIVATE' },
        });
        console.log(`Project created: ${project.name} (slug: ${project.slug}, id: ${project.id})`);
        console.log(`Public base URL: ${project.publicBaseUrl}`);
        break;
      }
      case 'apikey:create': {
        const [tenantSlug, projectSlug, keyName] = positional;
        if (!tenantSlug || !projectSlug) throw new Error('Usage: apikey:create <tenantSlug> <projectSlug> [name]');
        const ctx = await systemContext(tenantSlug, projectSlug);
        const key = await app.get(ApiKeysService).create(ctx, { projectId: ctx.projectId, name: keyName ?? 'server key' });
        console.log('API key (shown once - store it now):');
        console.log(key.apiKey);
        break;
      }
      case 'import': {
        const [tenantSlug, projectSlug, dir] = positional;
        if (!tenantSlug || !projectSlug || !dir) throw new Error('Usage: import <tenantSlug> <projectSlug> <localDir> [--prefix p] [--private] [--skip-existing]');
        const ctx = await systemContext(tenantSlug, projectSlug);
        const uploads = app.get(UploadsService);
        const prefix = typeof flags.prefix === 'string' ? flags.prefix.replace(/^\/+|\/+$/g, '') : '';
        const visibility: Visibility = flags.private ? 'PRIVATE' : 'PUBLIC';
        const root = path.resolve(dir);
        let ok = 0;
        let skipped = 0;
        let failed = 0;
        for await (const file of walk(root)) {
          const rel = path.relative(root, file).split(path.sep).join('/');
          const target = prefix ? `${prefix}/${rel}` : rel;
          try {
            const { size } = await fs.stat(file);
            await uploads.ingest(ctx, createReadStream(file), {
              path: target,
              declaredSize: size,
              visibility,
              onConflict: flags['skip-existing'] ? 'error' : 'overwrite',
            });
            ok++;
          } catch (e) {
            const code = (e as { code?: string }).code;
            if (code === 'FILE_EXISTS') skipped++;
            else {
              failed++;
              console.error(`  failed: ${target} - ${(e as Error).message}`);
            }
          }
          if ((ok + skipped + failed) % 100 === 0) console.log(`  ${ok} imported, ${skipped} skipped, ${failed} failed...`);
        }
        await app.get(JobsService).drain();
        console.log(`Import finished: ${ok} imported, ${skipped} skipped, ${failed} failed`);
        break;
      }
      default:
        console.log(USAGE);
    }
  } finally {
    await app.close();
  }
}

main().catch((err: Error) => {
  Logger.error(err.message, undefined, 'CLI');
  process.exit(1);
});
