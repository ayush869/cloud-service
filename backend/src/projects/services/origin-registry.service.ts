import { Inject, Injectable } from '@nestjs/common';
import { appConfig, AppConfig } from '../../config';
import { CacheKeys } from '../../common/constants';
import { CacheService } from '../../redis/cache.service';
import { ProjectsRepository } from '../repositories/projects.repository';
import { normalizeOrigin } from './projects.service';

/**
 * Answers CORS preflights: an origin is allowed if it is a dashboard origin or registered
 * on any active project. This only lets the browser send the request - AuthGuard then
 * checks the origin against the specific project of the API key.
 */
@Injectable()
export class OriginRegistry {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly cache: CacheService,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  async isAllowed(origin: string): Promise<boolean> {
    let normalized: string;
    try {
      normalized = normalizeOrigin(origin);
    } catch {
      return false;
    }
    if (this.app.dashboardOrigins.some((o) => o.toLowerCase() === normalized)) return true;
    const origins = await this.cache.wrap<string[]>(CacheKeys.corsOrigins, 60, () => this.projects.allActiveOrigins());
    return origins.includes(normalized);
  }
}
