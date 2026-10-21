import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { map, Observable } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators';

/** Wraps every JSON result as { success: true, data, message?, requestId }. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const message = this.reflector.get<string | undefined>(RESPONSE_MESSAGE_KEY, context.getHandler());
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data: data ?? null,
        ...(message ? { message } : {}),
        requestId: String(request.id),
      })),
    );
  }
}
