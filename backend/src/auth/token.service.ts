import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { MemberRole } from '@prisma/client';
import { createHash, generateKeyPairSync, KeyObject, randomBytes } from 'node:crypto';
import { errors as joseErrors, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { Errors } from '../common/errors';

const ALG = 'EdDSA';
const ISSUER = 'velora-api';
const AUDIENCE = 'velora-app';
const ROLES: readonly MemberRole[] = ['OWNER', 'MANAGER', 'SALES'];

export interface AccessClaims {
  sub: string;
  org: string;
  mid: string;
  role: MemberRole;
  branch: string | null;
  fam: string;
}

type SigningKey = Awaited<ReturnType<typeof importPKCS8>> | KeyObject;

/** Signs and verifies access tokens; creates and hashes opaque refresh tokens. */
@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey!: SigningKey;
  private publicKey!: SigningKey;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.JWT_PRIVATE_KEY && this.config.JWT_PUBLIC_KEY) {
      this.privateKey = await importPKCS8(this.config.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), ALG);
      this.publicKey = await importSPKI(this.config.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'), ALG);
    } else {
      // Config validation guarantees this branch is unreachable in production.
      const pair = generateKeyPairSync('ed25519');
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
    }
  }

  async signAccessToken(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const token = await new SignJWT({ org: claims.org, mid: claims.mid, role: claims.role, branch: claims.branch, fam: claims.fam })
      .setProtectedHeader({ alg: ALG, kid: this.config.JWT_KEY_ID })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.privateKey);
    return { token, expiresAt };
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: [ALG],
        issuer: ISSUER,
        audience: AUDIENCE,
        currentDate: this.clock.now(),
      });
      const { sub, org, mid, role, branch, fam } = payload as Record<string, unknown>;
      if (
        typeof sub !== 'string' ||
        typeof org !== 'string' ||
        typeof mid !== 'string' ||
        typeof fam !== 'string' ||
        !ROLES.includes(role as MemberRole) ||
        !(branch === null || typeof branch === 'string')
      ) {
        throw Errors.tokenInvalid();
      }
      return { sub, org, mid, role: role as MemberRole, branch: (branch as string | null) ?? null, fam };
    } catch (e) {
      if (e instanceof joseErrors.JWTExpired) throw Errors.tokenExpired();
      throw Errors.tokenInvalid();
    }
  }

  /** A new opaque refresh token: 256 bits of randomness. Only its hash is stored. */
  newRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = `vr_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(this.clock.now().getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    return { token, hash: this.hash(token), expiresAt };
  }

  newOpaqueToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
