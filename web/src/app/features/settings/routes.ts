import type { Routes } from '@angular/router';
import { requires } from '../../core/auth/guards';

/** Settings (W-H1–H3). Managers read, the owner edits; the API enforces both. */
export const SETTINGS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'business' },
  { path: 'business', canActivate: [requires('settings.read')], title: 'Business settings · Velora', loadComponent: () => import('./pages/business.page').then((m) => m.BusinessPage) },
  { path: 'tax-rates', canActivate: [requires('settings.read')], title: 'Tax rates · Velora', loadComponent: () => import('./pages/tax-rates.page').then((m) => m.TaxRatesPage) },
  { path: 'team', canActivate: [requires('team.read')], title: 'Team · Velora', loadComponent: () => import('./pages/team.page').then((m) => m.TeamPage) },
];
