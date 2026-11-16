import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IdempotentRequest, IdempotentResult } from '../idempotency/idempotency.service';

/** Describes the incoming request to the idempotency service. */
export function idempotentRequest(req: FastifyRequest): IdempotentRequest {
  const key = req.headers['idempotency-key'];
  return {
    key: typeof key === 'string' ? key : undefined,
    method: req.method,
    path: req.url.split('?')[0] ?? req.url,
    body: req.body,
  };
}

/** Applies the stored status, flags replays, and returns the body for the response envelope. */
export function sendIdempotent<T>(reply: FastifyReply, result: IdempotentResult<T>): T {
  void reply.status(result.status);
  if (result.replayed) void reply.header('Idempotent-Replayed', 'true');
  return result.body;
}
