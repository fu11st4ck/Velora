import type { Routes } from '@angular/router';
import { environment } from '../environments/environment';
import { signedIn, signedOut } from './core/auth/guards';

export const routes: Routes = [
  { path: 'sign-in', canActivate: [signedOut], title: 'Sign in · Velora', loadComponent: () => import('./features/auth/sign-in.page').then((m) => m.SignInPage) },
  {
    path: 'forgot-password',
    canActivate: [signedOut],
    title: 'Reset password · Velora',
    loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  // Not guarded: an invited person may open their link while someone else is signed in on this browser.
  { path: 'reset-password', title: 'Choose a password · Velora', loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage) },
  {
    path: '',
    canActivate: [signedIn],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: 'Dashboard · Velora', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'forbidden', title: 'No access · Velora', loadComponent: () => import('./features/errors/error-pages').then((m) => m.ForbiddenPage) },
      ...(environment.devTools ? [{ path: 'dev/ui', title: 'Design system · Velora', loadComponent: () => import('./dev/ui.page').then((m) => m.DevUiPage) }] : []),
      { path: '**', title: 'Not found · Velora', loadComponent: () => import('./features/errors/error-pages').then((m) => m.NotFoundPage) },
    ],
  },
];
