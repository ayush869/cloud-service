import 'fastify';
import { AuthContext } from './auth-context';

declare module 'fastify' {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}
