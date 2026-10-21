import { Errors } from '../exceptions/app.exception';
import { AuthContext, ProjectContext } from '../types/auth-context';

/**
 * Files/folders/uploads always run inside one project. API keys carry it; dashboard
 * users send X-Project-Id, which AuthGuard has already verified against their tenant.
 */
export function requireProject(ctx: AuthContext): ProjectContext {
  if (!ctx.projectId) {
    throw Errors.badRequest('PROJECT_REQUIRED', 'Select a project with the X-Project-Id header');
  }
  return ctx as ProjectContext;
}
