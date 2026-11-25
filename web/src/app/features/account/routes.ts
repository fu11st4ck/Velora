import type { Routes } from '@angular/router';

export const ACCOUNT_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'password' },
  { path: 'password', title: 'Change password · Velora', loadComponent: () => import('./pages/password.page').then((m) => m.PasswordPage) },
  { path: 'devices', title: 'Signed-in devices · Velora', loadComponent: () => import('./pages/devices.page').then((m) => m.DevicesPage) },
];
