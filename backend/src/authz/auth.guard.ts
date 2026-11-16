import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/errors';
import type { AuthedRequest } from '../common/request-context';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_KEY, type AccessRule } from './decorators';
import { hasPermission } from './permissions';

/**
 * Global guard. Deny by default: a route with no access rule is rejected, so forgetting the
 * decorator can never expose an endpoint (also enforced by test/route-access.spec.ts).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) throw Errors.forbidden();
    if (rule.kind === 'public') return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw Errors.tokenInvalid();
    const claims = await this.tokens.verifyAccessToken(header.slice(7));

    // A signed token alone is not enough: the session it belongs to must still be open. Signing out,
    // a password change, a role change or removal of access close it, and take effect at once
    // rather than when the token expires. One primary-key-sized index lookup per request.
    const open = await this.prisma.refreshToken.findFirst({
      where: { familyId: claims.fam, userId: claims.sub, revokedAt: null },
      select: { id: true },
    });
    if (!open) throw Errors.sessionRevoked();

    const ua = req.headers['user-agent'];
    req.ctx = {
      userId: claims.sub,
      organizationId: claims.org,
      memberId: claims.mid,
      role: claims.role,
      branchId: claims.branch,
      familyId: claims.fam,
      requestId: String(req.id),
      ip: req.ip ?? null,
      userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
    };

    if (rule.kind === 'permission' && !hasPermission(claims.role, rule.permission)) throw Errors.forbidden();
    return true;
  }
}
