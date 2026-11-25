import type { Routes } from '@angular/router';
import { requires } from '../../core/auth/guards';

/** Inventory (W-C1–C6). Guards only spare the user a page the API would refuse; the API decides. */
export const INVENTORY_ROUTES: Routes = [
  { path: '', title: 'Products · Velora', loadComponent: () => import('./pages/products.page').then((m) => m.ProductsPage) },
  {
    path: 'history',
    canActivate: [requires('inventory.read')],
    title: 'Stock history · Velora',
    loadComponent: () => import('./pages/stock-history.page').then((m) => m.StockHistoryPage),
  },
  {
    path: 'new',
    canActivate: [requires('product.manage')],
    title: 'New product · Velora',
    loadComponent: () => import('./pages/product-form.page').then((m) => m.ProductFormPage),
  },
  { path: ':id', title: 'Product · Velora', loadComponent: () => import('./pages/product-detail.page').then((m) => m.ProductDetailPage) },
  {
    path: ':id/edit',
    canActivate: [requires('product.manage')],
    title: 'Edit product · Velora',
    loadComponent: () => import('./pages/product-form.page').then((m) => m.ProductFormPage),
  },
];
