import type { Routes } from '@angular/router';
import { requires } from '../../core/auth/guards';

/** Customers (W-E1–E3). Guards spare the user a page the API would refuse; the API decides. */
export const CUSTOMER_ROUTES: Routes = [
  { path: '', title: 'Customers · Velora', loadComponent: () => import('./pages/customers.page').then((m) => m.CustomersPage) },
  { path: 'new', canActivate: [requires('customer.write')], title: 'New customer · Velora', loadComponent: () => import('./pages/customer-form.page').then((m) => m.CustomerFormPage) },
  { path: ':id', title: 'Customer · Velora', loadComponent: () => import('./pages/customer-detail.page').then((m) => m.CustomerDetailPage) },
  { path: ':id/edit', canActivate: [requires('customer.write')], title: 'Edit customer · Velora', loadComponent: () => import('./pages/customer-form.page').then((m) => m.CustomerFormPage) },
];
