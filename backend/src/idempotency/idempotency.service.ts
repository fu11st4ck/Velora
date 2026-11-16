import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { toJsonSafe } from '../common/envelope.interceptor';
import { Errors } from '../common/errors';
import type { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETENTION_DAYS = 7;

export interface IdempotentRequest {
  key: string | undefined;
  method: string;
  path: string;
  body: unknown;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Makes a mutating operation safe to retry (docs/api-error-handling.md §6).
 *
 * The key row, the business change and the stored response are written in ONE transaction:
 * either all exist or none do. A concurrent request with the same key blocks on the unique
 * index until the first commits, then replays its response.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(
    ctx: RequestContext,
    request: IdempotentRequest,
    successStatus: number,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const key = request.key;
    if (!key || !UUID.test(key)) throw Errors.idempotencyKeyRequired();
    const requestHash = createHash('sha256')
      .update(JSON.stringify([request.method, request.path, canonical(request.body)]))
      .digest('hex');
    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 86_400_000);

    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const inserted = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO idempotency_keys (id, organization_id, key, user_id, method, path, request_hash, expires_at)
        VALUES (gen_random_uuid(), ${ctx.organizationId}::uuid, ${key}, ${ctx.userId}::uuid,
                ${request.method}, ${request.path}, ${requestHash}, ${expiresAt})
        ON CONFLICT (organization_id, key) DO NOTHING
        RETURNING id`;

      if (inserted.length === 0) {
        const existing = await tx.idempotencyKey.findUnique({
          where: { organizationId_key: { organizationId: ctx.organizationId, key } },
        });
        if (!existing || existing.requestHash !== requestHash || existing.userId !== ctx.userId) {
          throw Errors.idempotencyKeyReused();
        }
        return { status: existing.responseStatus ?? successStatus, body: existing.responseBody as T, replayed: true };
      }

      const result = await fn(tx);
      const body = toJsonSafe(result) as Prisma.InputJsonValue;
      await tx.idempotencyKey.update({
        where: { id: (inserted[0] as { id: string }).id },
        data: { responseStatus: successStatus, responseBody: body ?? Prisma.JsonNull },
      });
      // The stored (JSON-safe) form is returned so the first response and a replay have the same content.
      return { status: successStatus, body: body as T, replayed: false };
    });
  }
}

/** Stable JSON form: object keys sorted, so equivalent bodies hash equally. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
