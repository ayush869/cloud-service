import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Project, Visibility } from '@prisma/client';
import { appConfig, AppConfig } from '../../config';
import { CacheKeys } from '../../common/constants';
import { Errors } from '../../common/exceptions/app.exception';
import { AuthContext } from '../../common/types';
import { slugify, uniqueSlug } from '../../common/utils/slug';
import { isUniqueViolation } from '../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CacheService } from '../../redis/cache.service';
import { TenantsService } from '../../tenants/services/tenants.service';
import { ApiKeysRepository } from '../../api-keys/repositories/api-keys.repository';
import { CreateProjectDto, ProjectSettingsDto, UpdateProjectDto } from '../dto/project.dto';
import { ProjectsRepository } from '../repositories/projects.repository';

export interface ProjectSettings {
  defaultVisibility: Visibility;
  maxUploadBytes: number | null;
  allowedExtensions: string[] | null;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  defaultVisibility: 'PRIVATE',
  maxUploadBytes: null,
  allowedExtensions: null,
};

export function settingsOf(project: Pick<Project, 'settings'>): ProjectSettings {
  const s = (project.settings ?? {}) as Partial<ProjectSettings>;
  return { ...DEFAULT_SETTINGS, ...s };
}

/** Normalizes "https://ABC.com/" to "https://abc.com" (the form browsers send in Origin). */
export const normalizeOrigin = (o: string): string => {
  const url = new URL(o);
  return `${url.protocol}//${url.host}`.toLowerCase();
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly apiKeys: ApiKeysRepository,
    private readonly tenants: TenantsService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async list(ctx: AuthContext) {
    const rows = await this.projects.findAllByTenant(ctx.tenantId);
    const tenantSlug = await this.tenants.slugOf(ctx.tenantId);
    return rows.map((p) => this.toDto(p, tenantSlug));
  }

  async get(ctx: AuthContext, id: string) {
    const project = await this.projects.findByIdAndTenant(id, ctx.tenantId);
    if (!project) throw Errors.notFound('project');
    return this.toDto(project, await this.tenants.slugOf(ctx.tenantId));
  }

  async create(ctx: AuthContext, dto: CreateProjectDto) {
    const slug = dto.slug ?? (await uniqueSlug(slugify(dto.name), (s) => this.projects.slugTaken(ctx.tenantId, s)));
    try {
      const project = await this.projects.create({
        tenantId: ctx.tenantId,
        name: dto.name.trim(),
        slug,
        description: dto.description ?? null,
        allowedOrigins: (dto.allowedOrigins ?? []).map(normalizeOrigin),
        settings: this.mergeSettings(DEFAULT_SETTINGS, dto.settings) as unknown as Prisma.InputJsonValue,
      });
      await this.cache.del(CacheKeys.corsOrigins);
      await this.audit.log(ctx, { action: 'PROJECT_CREATE', resourceType: 'PROJECT', resourceId: project.id, projectId: project.id, metadata: { slug } });
      return this.toDto(project, await this.tenants.slugOf(ctx.tenantId));
    } catch (e) {
      if (isUniqueViolation(e)) throw Errors.conflict('PROJECT_SLUG_TAKEN', `A project with slug "${slug}" already exists`);
      throw e;
    }
  }

  async update(ctx: AuthContext, id: string, dto: UpdateProjectDto) {
    const current = await this.projects.findByIdAndTenant(id, ctx.tenantId);
    if (!current) throw Errors.notFound('project');
    const updated = await this.projects.updateByIdAndTenant(id, ctx.tenantId, {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.allowedOrigins !== undefined ? { allowedOrigins: dto.allowedOrigins.map(normalizeOrigin) } : {}),
      ...(dto.settings !== undefined
        ? { settings: this.mergeSettings(settingsOf(current), dto.settings) as unknown as Prisma.InputJsonValue }
        : {}),
    });
    await this.invalidate(current);
    await this.audit.log(ctx, { action: 'PROJECT_UPDATE', resourceType: 'PROJECT', resourceId: id, projectId: id, metadata: { fields: Object.keys(dto) } });
    return this.toDto(updated!, await this.tenants.slugOf(ctx.tenantId));
  }

  /** Only empty projects can be deleted; this never silently destroys files. */
  async remove(ctx: AuthContext, id: string) {
    const project = await this.projects.findByIdAndTenant(id, ctx.tenantId);
    if (!project) throw Errors.notFound('project');
    if ((await this.projects.countLiveFiles(id, ctx.tenantId)) > 0) {
      throw Errors.conflict('PROJECT_NOT_EMPTY', 'Delete all files of this project (including trash) first');
    }
    await this.apiKeys.revokeAllForProject(id, ctx.tenantId);
    await this.projects.updateByIdAndTenant(id, ctx.tenantId, { deletedAt: new Date(), status: 'DISABLED' });
    await this.invalidate(project);
    await this.audit.log(ctx, { action: 'PROJECT_DELETE', resourceType: 'PROJECT', resourceId: id, projectId: id });
    return { deleted: true };
  }

  /** Base for permanent public URLs: {base}/{path} */
  publicBaseUrl(tenantSlug: string, projectSlug: string): string {
    return `${this.app.publicBaseUrl}/p/${tenantSlug}/${projectSlug}`;
  }

  /** Cached: tenant and project slugs never change. */
  publicBaseFor(tenantId: string, projectId: string): Promise<string> {
    return this.cache.wrap(CacheKeys.projectPublicBase(projectId), 3600, async () => {
      const project = await this.projects.findByIdAndTenant(projectId, tenantId);
      if (!project) throw Errors.notFound('project');
      return this.publicBaseUrl(await this.tenants.slugOf(tenantId), project.slug);
    });
  }

  /** Upload policy of a project (fresh read - settings may have just changed). */
  async settingsFor(tenantId: string, projectId: string): Promise<ProjectSettings> {
    const project = await this.projects.findByIdAndTenant(projectId, tenantId);
    if (!project) throw Errors.notFound('project');
    return settingsOf(project);
  }

  private mergeSettings(base: ProjectSettings, patch?: ProjectSettingsDto): ProjectSettings {
    if (!patch) return base;
    return {
      defaultVisibility: patch.defaultVisibility ?? base.defaultVisibility,
      maxUploadBytes: patch.maxUploadBytes !== undefined ? patch.maxUploadBytes : base.maxUploadBytes,
      allowedExtensions:
        patch.allowedExtensions !== undefined
          ? patch.allowedExtensions && patch.allowedExtensions.length > 0
            ? [...new Set(patch.allowedExtensions.map((e) => e.toLowerCase()))]
            : null
          : base.allowedExtensions,
    };
  }

  private async invalidate(project: Project): Promise<void> {
    const tenantSlug = await this.tenants.slugOf(project.tenantId);
    const keys = await this.apiKeys.prefixesForProject(project.id, project.tenantId);
    await this.cache.del(
      CacheKeys.project(project.tenantId, project.id),
      CacheKeys.publicProject(tenantSlug, project.slug),
      CacheKeys.corsOrigins,
      ...keys.map((k) => CacheKeys.apiKey(k.keyPrefix)),
    );
  }

  private toDto(p: Project, tenantSlug: string) {
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      status: p.status,
      allowedOrigins: p.allowedOrigins as string[],
      settings: settingsOf(p),
      publicBaseUrl: this.publicBaseUrl(tenantSlug, p.slug),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
