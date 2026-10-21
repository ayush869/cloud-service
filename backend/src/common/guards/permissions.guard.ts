import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { Permission } from '../constants/permissions';
import { PERMISSIONS_KEY } from '../decorators';
import { Errors } from '../exceptions/app.exception';

/** Enforces @RequirePermissions(...). Runs after AuthGuard has attached the context. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const ctx = context.switchToHttp().getRequest<FastifyRequest>().authContext;
    if (!ctx) throw Errors.unauthorized();
    const missing = required.filter((p) => !ctx.permissions.has(p));
    if (missing.length > 0) {
      throw Errors.forbidden(`Missing permission: ${missing.join(', ')}`);
    }
    return true;
  }
}
