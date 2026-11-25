/** Sidebar entries. An item appears only when its feature exists and the role may use it. */
export interface NavItem {
  label: string;
  icon: string;
  path: string;
  /** Permission from /auth/me; omitted for items every signed-in user may open. */
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Features are added here as each sprint ships them (docs/web-implementation-roadmap.md) —
// never earlier, so there are no links to pages that do not exist yet.
export const NAVIGATION: NavGroup[] = [
  {
    label: 'Operations',
    items: [{ label: 'Dashboard', icon: 'space_dashboard', path: '/dashboard' }],
  },
];

export function visibleNavigation(can: (permission: string) => boolean, groups: NavGroup[] = NAVIGATION): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) }))
    .filter((g) => g.items.length > 0);
}
