import type { Routes } from '@angular/router';
import { requires } from '../../core/auth/guards';

/** Documents (W-F1–F8). A salesperson's access to someone else's document is refused by the API (404). */
export const DOCUMENT_ROUTES: Routes = [
  { path: '', title: 'Documents · Velora', loadComponent: () => import('./pages/documents.page').then((m) => m.DocumentsPage) },
  { path: 'invoices/:id', title: 'Invoice · Velora', loadComponent: () => import('./pages/invoice-detail.page').then((m) => m.InvoiceDetailPage) },
  { path: 'invoices/:id/return', canActivate: [requires('invoice.return')], title: 'Return items · Velora', loadComponent: () => import('./pages/return.page').then((m) => m.ReturnPage) },
  { path: 'quotations/:id', title: 'Quotation · Velora', loadComponent: () => import('./pages/quotation-detail.page').then((m) => m.QuotationDetailPage) },
];
