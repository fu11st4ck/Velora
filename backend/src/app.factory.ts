import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { BadRequestException, ConsoleLogger, ValidationPipe, type INestApplication } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from './common/config';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function createAdapter(trustProxy: boolean): FastifyAdapter {
  const adapter = new FastifyAdapter({
    bodyLimit: 1_048_576,
    trustProxy,
    // A well-formed client request id is kept for tracing; anything else is replaced.
    genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
      const supplied = req.headers['x-request-id'];
      return typeof supplied === 'string' && REQUEST_ID.test(supplied) ? supplied : `req_${randomUUID()}`;
    },
  });
  // HTTP clients commonly send `Content-Type: application/json` on requests that carry no body
  // (a DELETE, for example), which the JSON parser rejects as an empty document. Such a request
  // has no content to type, so the header is dropped before parsing. Requests with a body are
  // untouched and still go through the standard parser.
  adapter.getInstance().addHook('onRequest', (req, _reply, done) => {
    const length = req.headers['content-length'];
    const bodiless = length === '0' || (length === undefined && req.headers['transfer-encoding'] === undefined);
    if (bodiless) delete req.headers['content-type'];
    done();
  });
  return adapter;
}

/** Applies everything that must be identical in production and in tests. */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // unknown fields are an error, never silently dropped
      transform: true,
      exceptionFactory: (errors) => new BadRequestException({ details: flatten(errors) }),
    }),
  );
  await app.register(helmet as never);
  await app.register(rateLimit as never, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
  });
  app.enableShutdownHooks();
}

export function jsonLogger(config: Pick<AppConfig, 'NODE_ENV' | 'LOG_LEVEL'>): ConsoleLogger | false {
  if (config.LOG_LEVEL === 'silent') return false;
  const levels = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
  const map = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 } as const;
  return new ConsoleLogger({
    json: config.NODE_ENV === 'production',
    logLevels: levels.slice(0, map[config.LOG_LEVEL] + 1) as never,
  });
}

function flatten(errors: ValidationError[], parent = ''): { field: string; rule: string }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.keys(e.constraints ?? {}).map((rule) => ({ field, rule }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

export type App = INestApplication & NestFastifyApplication;
