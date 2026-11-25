import type { Routes } from '@angular/router';

export const REPORT_ROUTES: Routes = [{ path: '', title: 'Reports · Velora', loadComponent: () => import('./pages/reports.page').then((m) => m.ReportsPage) }];
