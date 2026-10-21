import 'dotenv/config';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { FastifyInstance, FastifyRequest, LogController } from 'fastify';
import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { AppModule } from './app.module';
import { appConfig, AppConfig, storageConfig, StorageConfig } from './config';
import { Errors } from './common/exceptions/app.exception';
import { isRawUploadRequest } from './common/utils/raw-body';
import { OriginRegistry } from './projects/services/origin-registry.service';

const JSON_BODY_LIMIT = 1024 * 1024;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Removes signed tokens from URLs before they reach any log line. */
export function redactUrl(url: string): string {
  return url
    .replace(/^\/d\/[^/?]+/, '/d/[signed]')
    .replace(/([?&](token|sig|signature)=)[^&]*/gi, '$1[redacted]');
}

/** Builds the fully configured application (used by main.ts and the e2e tests). */
export async function createApp(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: process.env.TRUST_PROXY === 'true',
    bodyLimit: JSON_BODY_LIMIT,
    // Signed download tokens travel in the path (/d/{token}).
    routerOptions: { maxParamLength: 4096 },
    // We log one line per request ourselves (onResponse hook, with tenant/project ids).
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["idempotency-key"]'],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: FastifyRequest) => ({ id: req.id, method: req.method, url: redactUrl(req.url) }),
      },
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bodyParser: false,
    bufferLogs: false,
    logger: process.env.NODE_ENV === 'test' ? ['error', 'warn'] : undefined,
  });
  const app_ = app.get<AppConfig>(appConfig.KEY);
  const storage = app.get<StorageConfig>(storageConfig.KEY);
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;

  registerBodyParsers(fastify);
  await app.register(fastifyMultipart as never, {
    // One byte over the server-wide limit so our own size check fires first with a clear error.
    limits: { fileSize: storage.maxUploadBytes + 1, files: 1, fields: 20, fieldSize: 64 * 1024, parts: 25 },
  });
  await app.register(fastifyHelmet as never, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
  const origins = app.get(OriginRegistry);
  await app.register(fastifyCors as never, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (!origin) return cb(null, false);
      origins.isAllowed(origin).then((ok) => cb(null, ok), () => cb(null, false));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Project-Id', 'Idempotency-Key', 'X-Request-Id', 'Range', 'If-None-Match'],
    exposedHeaders: ['X-Request-Id', 'ETag', 'Content-Range', 'Content-Length', 'Content-Disposition', 'X-RateLimit-Remaining', 'Retry-After'],
    maxAge: 600,
  });

  fastify.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
  fastify.addHook('onResponse', async (req, reply) => {
    const ctx = req.authContext;
    const entry = {
      requestId: req.id,
      tenantId: ctx?.tenantId,
      projectId: ctx?.projectId,
      userId: ctx?.userId,
      apiKeyId: ctx?.apiKeyId,
      method: req.method,
      url: redactUrl(req.url),
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 10) / 10,
    };
    if (req.url.startsWith('/health')) return;
    // Public file hits are the bulk of traffic; keep them out of info logs.
    if (req.url.startsWith('/p/')) req.log.debug(entry, 'request');
    else req.log.info(entry, 'request');
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => Errors.validation('Validation failed', flattenValidation(errors)),
    }),
  );
  app.enableShutdownHooks();

  if (app_.swaggerEnabled) {
    const doc = new DocumentBuilder()
      .setTitle('Cloud Storage API')
      .setDescription(
        'Multi-tenant file storage. Authenticate with `Authorization: Bearer <JWT>` (dashboard) or ' +
          '`Authorization: Bearer cs_live_...` (API key). Dashboard calls to files/folders/uploads must send `X-Project-Id`.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'docs/json' });
  }
  return app;
}

/**
 * JSON for normal routes; raw streams for the upload PUT routes (any Content-Type, the
 * bytes go straight to disk); everything else is rejected with 415.
 */
function registerBodyParsers(fastify: FastifyInstance): void {
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('application/json', (req, payload, done) => {
    if (isRawUploadRequest(req)) return done(null, payload);
    readLimited(payload, JSON_BODY_LIMIT).then(
      (buf) => {
        if (buf.length === 0) return done(null, undefined);
        try {
          done(null, JSON.parse(buf.toString('utf8')));
        } catch {
          done(Object.assign(new Error('Request body is not valid JSON'), { statusCode: 400 }), undefined);
        }
      },
      (err: Error) => done(err, undefined),
    );
  });
  fastify.addContentTypeParser('*', (req, payload, done) => {
    if (isRawUploadRequest(req)) return done(null, payload);
    done(Object.assign(new Error('Unsupported Content-Type'), { statusCode: 415 }), undefined);
  });
}

function readLimited(stream: Readable, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        stream.destroy();
        reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function flattenValidation(errors: ValidationError[], parent = ''): { field: string; errors: string[] }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, errors: Object.values(e.constraints) }] : [];
    return [...own, ...flattenValidation(e.children ?? [], field)];
  });
}
