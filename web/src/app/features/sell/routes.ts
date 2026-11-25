import type { Routes } from '@angular/router';

/** The sale workspace (W-D1–D4); `?customer=` presets the customer, `?quotation=` converts a quotation. */
export const SELL_ROUTES: Routes = [{ path: '', title: 'New sale · Velora', loadComponent: () => import('./pages/sell.page').then((m) => m.SellPage) }];
