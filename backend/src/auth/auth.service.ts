import { Inject, Injectable } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { permissionsFor } from '../authz/permissions';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { resetLink } from '../common/links';
import { Errors } from '../common/errors';
import type { ClientInfo, RequestContext } from '../common/request-context';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

interface MembershipView {
  memberId: string;
  role: MemberRole;
  branchId: string | null;
  organization: { id: string; name: string };
}

export interface AuthSession extends TokenPair {
  user: { id: string; fullName: string; email: string };
  membership: MembershipView;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string, deviceName: string | undefined, client: ClientInfo): Promise<AuthSession> {
    const now = this.clock.now();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await this.passwords.verifyDummy(password);
      await this.auditAuth('auth.login_failed', null, client, { reason: 'unknown_account' });
      throw Errors.invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      throw Errors.tooManyAttempts(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failures,
          lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await this.auditAuth('auth.login_failed', user.id, client, { reason: 'bad_password', locked: lock });
      throw Errors.invalidCredentials();
    }
    if (!user.isActive) throw Errors.accountDisabled();

    return this.prisma.userTx(user.id, async (tx) => {
      // v1: one organization per user; the oldest active membership is used.
      const member = await tx.organizationMember.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!member) throw Errors.accountDisabled();
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${member.organizationId}, true)`;
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: member.organizationId },
        select: { id: true, name: true },
      });

      const familyId = randomUUID();
      const refresh = this.tokens.newRefreshToken();
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          memberId: member.id,
          familyId,
          tokenHash: refresh.hash,
          deviceName,
          ipAddress: client.ip ?? undefined,
          expiresAt: refresh.expiresAt,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
      await this.audit.record(tx, {
        organizationId: organization.id,
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        ip: client.ip,
        userAgent: client.userAgent,
        requestId: client.requestId,
      });

      const access = await this.tokens.signAccessToken({
        sub: user.id,
        org: organization.id,
        mid: member.id,
        role: member.role,
        branch: member.branchId,
        fam: familyId,
      });
      return {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt,
        user: { id: user.id, fullName: user.fullName, email: user.email },
        membership: { memberId: member.id, role: member.role, branchId: member.branchId, organization },
      };
    });
  }

  /** Exchanges a refresh token for a new pair. A token can be used once; reuse revokes the whole session. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
    const now = this.clock.now();
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hash(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt <= now) throw Errors.sessionRevoked();

    if (stored.rotatedAt) {
      await this.revokeFamily(stored.familyId, 'reuse_detected');
      await this.auditAuth('auth.refresh_reuse_detected', stored.userId, client, { familyId: stored.familyId });
      throw Errors.sessionRevoked();
    }
    if (!stored.user.isActive) {
      await this.revokeFamily(stored.familyId, 'account_disabled');
      throw Errors.sessionRevoked();
    }

    return this.prisma.userTx(stored.userId, async (tx) => {
      const member = await tx.organizationMember.findFirst({ where: { id: stored.memberId, isActive: true } });
      if (!member) {
        await tx.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: now, revokeReason: 'membership_disabled' },
        });
        return null;
      }
      // Guarded update: only one concurrent caller can rotate a given token.
      const rotated = await tx.refreshToken.updateMany({
        where: { id: stored.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now },
      });
      if (rotated.count !== 1) return null;

      const next = this.tokens.newRefreshToken();
      await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          memberId: member.id,
          familyId: stored.familyId,
          tokenHash: next.hash,
          deviceName: stored.deviceName,
          ipAddress: client.ip ?? undefined,
          expiresAt: next.expiresAt,
        },
      });
      // Claims are rebuilt from the current membership, so role changes take effect on refresh.
      const access = await this.tokens.signAccessToken({
        sub: stored.userId,
        org: member.organizationId,
        mid: member.id,
        role: member.role,
        branch: member.branchId,
        fam: stored.familyId,
      });
      return {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: next.token,
        refreshTokenExpiresAt: next.expiresAt,
      };
    }).then((pair) => {
      if (!pair) throw Errors.sessionRevoked();
      return pair;
    });
  }

  /** Ends the session the refresh token belongs to. Succeeds silently for unknown tokens. */
  async logout(ctx: RequestContext, refreshToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.tokens.hash(refreshToken) } });
    if (!stored || stored.userId !== ctx.userId) return;
    await this.revokeFamily(stored.familyId, 'logout');
  }

  /** Ends the session a refresh token belongs to, without needing a valid access token (browser sign-out). */
  async logoutByToken(refreshToken: string, client: ClientInfo): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.tokens.hash(refreshToken) } });
    if (!stored) return;
    await this.revokeFamily(stored.familyId, 'logout');
    await this.auditAuth('auth.logout', stored.userId, client);
  }

  async forgotPassword(email: string, client: ClientInfo): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return; // identical outward behaviour whether or not the account exists
    const { token, hash } = this.tokens.newOpaqueToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(this.clock.now().getTime() + this.config.PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });
    await this.auditAuth('auth.password_reset_requested', user.id, client);
    await this.mail.send({
      to: user.email,
      subject: 'Reset your Velora password',
      text:
        `Hello ${user.fullName},\n\nOpen this link on your phone to choose a new password. ` +
        `It works once and expires in ${this.config.PASSWORD_RESET_TTL_MINUTES} minutes.\n\n` +
        `${resetLink(this.config.APP_BASE_URL, token)}\n\n` +
        `If you did not ask for this, you can ignore this email.`,
    });
  }

  async resetPassword(token: string, newPassword: string, client: ClientInfo): Promise<void> {
    const now = this.clock.now();
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hash(token) },
      include: { user: true },
    });
    if (!stored || stored.usedAt || stored.expiresAt <= now || !stored.user.isActive) throw Errors.resetTokenInvalid();
    this.passwords.assertAcceptable(newPassword, { email: stored.user.email });
    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      const used = await tx.passwordResetToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: now } });
      if (used.count !== 1) throw Errors.resetTokenInvalid();
      await tx.user.update({
        where: { id: stored.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'password_reset' },
      });
      await this.audit.record(tx, {
        organizationId: null,
        actorUserId: stored.userId,
        action: 'auth.password_reset',
        entityType: 'user',
        entityId: stored.userId,
        ip: client.ip,
        userAgent: client.userAgent,
        requestId: client.requestId,
      });
    });
  }

  async changePassword(ctx: RequestContext, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: ctx.userId } });
    if (!user || !user.isActive) throw Errors.sessionRevoked();
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) throw Errors.currentPasswordIncorrect();
    this.passwords.assertAcceptable(newPassword, { email: user.email });
    const passwordHash = await this.passwords.hash(newPassword);
    const now = this.clock.now();

    await this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      // Other devices are signed out; the session that made the change stays.
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null, NOT: { familyId: ctx.familyId } },
        data: { revokedAt: now, revokeReason: 'password_changed' },
      });
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorUserId: user.id,
        action: 'auth.password_changed',
        entityType: 'user',
        entityId: user.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
    });
  }

  async me(ctx: RequestContext) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const [user, member, org, defaultTaxRate] = await Promise.all([
        tx.user.findUnique({ where: { id: ctx.userId } }),
        tx.organizationMember.findFirst({ where: { id: ctx.memberId, isActive: true } }),
        tx.organization.findUnique({ where: { id: ctx.organizationId } }),
        tx.taxRate.findFirst({ where: { isDefault: true, isActive: true } }),
      ]);
      if (!user || !user.isActive || !member || !org) throw Errors.sessionRevoked();
      const manager = permissionsFor(member.role).includes('product.read_cost');
      return {
        user: { id: user.id, fullName: user.fullName, email: user.email },
        membership: {
          memberId: member.id,
          role: member.role,
          branchId: member.branchId,
          organization: { id: org.id, name: org.name },
        },
        permissions: permissionsFor(member.role),
        settings: {
          currencyCode: org.currencyCode,
          currencyExponent: org.currencyExponent,
          timezone: org.timezone,
          locale: org.locale,
          // Markup limits reveal pricing policy; managers and owners only (business rule P7).
          ...(manager ? { maxMarkupBp: org.maxMarkupBp } : {}),
          defaultCreditDays: org.defaultCreditDays,
          quotationValidityDays: org.quotationValidityDays,
          lowStockThreshold: org.lowStockThreshold,
          allowOfflineSales: org.allowOfflineSales,
          defaultTaxRate: defaultTaxRate
            ? {
                id: defaultTaxRate.id,
                name: defaultTaxRate.name,
                rateBp: defaultTaxRate.rateBp,
                isDefault: true,
                isActive: true,
              }
            : null,
        },
      };
    });
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokeReason: reason },
    });
  }

  private auditAuth(action: string, userId: string | null, client: ClientInfo, after?: Record<string, string | boolean>) {
    return this.audit.record(this.prisma, {
      organizationId: null,
      actorUserId: userId,
      action,
      entityType: userId ? 'user' : undefined,
      entityId: userId ?? undefined,
      after,
      ip: client.ip,
      userAgent: client.userAgent,
      requestId: client.requestId,
    });
  }
}
