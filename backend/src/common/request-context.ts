import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

/** The authenticated caller. Built only from a verified access token — never from request input. */
export interface RequestContext {
  userId: string;
  organizationId: string;
  memberId: string;
  role: MemberRole;
  branchId: string | null;
  familyId: string;
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export type AuthedRequest = FastifyRequest & { ctx?: RequestContext };

/** Injects the RequestContext into a controller method. */
export const Ctx = createParamDecorator((_data: unknown, context: ExecutionContext): RequestContext => {
  const req = context.switchToHttp().getRequest<AuthedRequest>();
  if (!req.ctx) throw new Error('Ctx used on a route without authentication');
  return req.ctx;
});

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

/** Network details for audit entries on public routes. */
export const Client = createParamDecorator((_data: unknown, context: ExecutionContext): ClientInfo => {
  const req = context.switchToHttp().getRequest<FastifyRequest>();
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null, requestId: String(req.id) };
});
