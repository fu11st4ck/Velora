import type { MemberRole } from '@prisma/client';

/** Every capability the API checks. Mirrors docs/business-rules.md §9. */
export const PERMISSIONS = [
  'product.read',
  'product.read_cost',
  'product.manage',
  'inventory.read',
  'inventory.manage',
  'customer.read',
  'customer.write',
  'customer.archive',
  'sale.create',
  'sale.below_minimum',
  'document.read_own',
  'document.read_all',
  'payment.record',
  'payment.refund',
  'invoice.cancel',
  'invoice.return',
  'report.read_own',
  'report.read_all',
  'settings.read',
  'settings.manage',
  'team.read',
  'team.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SALES: readonly Permission[] = [
  'product.read',
  'inventory.read',
  'customer.read',
  'customer.write',
  'sale.create',
  'document.read_own',
  'payment.record',
  'report.read_own',
];

const MANAGER: readonly Permission[] = [
  ...SALES,
  'product.read_cost',
  'product.manage',
  'inventory.manage',
  'customer.archive',
  'sale.below_minimum',
  'document.read_all',
  'payment.refund',
  'invoice.cancel',
  'invoice.return',
  'report.read_all',
  'settings.read',
  'team.read',
];

const OWNER: readonly Permission[] = [...MANAGER, 'settings.manage', 'team.manage'];

const ROLE_PERMISSIONS: Record<MemberRole, ReadonlySet<Permission>> = {
  SALES: new Set(SALES),
  MANAGER: new Set(MANAGER),
  OWNER: new Set(OWNER),
};

export function permissionsFor(role: MemberRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]].sort();
}

export function hasPermission(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Cost, markup and profit fields are visible only with this permission (business rule P7). */
export function canSeeCost(role: MemberRole): boolean {
  return hasPermission(role, 'product.read_cost');
}
