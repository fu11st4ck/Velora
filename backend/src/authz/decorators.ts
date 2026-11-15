import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const ACCESS_KEY = 'velora:access';

export type AccessRule = { kind: 'public' } | { kind: 'authenticated' } | { kind: 'permission'; permission: Permission };

/** No token required. Use only for sign-in, token refresh, password reset and health probes. */
export const Public = () => SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies AccessRule);

/** Any signed-in member, regardless of role. */
export const Authenticated = () => SetMetadata(ACCESS_KEY, { kind: 'authenticated' } satisfies AccessRule);

/** Signed-in member whose role grants the permission. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(ACCESS_KEY, { kind: 'permission', permission } satisfies AccessRule);
