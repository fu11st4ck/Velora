import type { DashboardSummary, Me } from '../app/core/api/types';

/** Test data shaped exactly like the API's responses (types come from the OpenAPI contract). Test-only. */
export function meFixture(role: 'OWNER' | 'MANAGER' | 'SALES' = 'MANAGER'): Me {
  const manager = role !== 'SALES';
  return {
    user: { id: 'u1', fullName: 'Maya Manager', email: 'maya@velora.example' },
    membership: { memberId: 'm1', role, branchId: null, organization: { id: 'o1', name: 'Velora Fine Jewellery LLC' } },
    permissions: ['product.read', 'sale.create', 'report.read_own', ...(manager ? ['product.read_cost', 'report.read_all', 'settings.read', 'team.read'] : [])],
    settings: {
      currencyCode: 'AED',
      currencyExponent: 2,
      timezone: 'Asia/Dubai',
      locale: 'en',
      defaultCreditDays: 30,
      quotationValidityDays: 14,
      lowStockThreshold: 8,
      allowOfflineSales: false,
      ...(manager ? { maxMarkupBp: 6000 } : {}),
    },
  } as Me;
}

export function dashboardFixture(role: 'MANAGER' | 'SALES' = 'MANAGER'): DashboardSummary {
  return {
    asOf: '2026-11-25T05:30:00.000Z',
    currencyCode: 'AED',
    todaySales: { invoicedMinor: 1069425, invoiceCount: 2, yesterdayInvoicedMinor: 951450, changeBp: 1240 },
    stock: { units: 53, productCount: 4, lowCount: 2, outCount: 1 },
    outstanding: { balanceMinor: 1250000, invoiceCount: 3, overdueMinor: 350000, overdueCount: 1 },
    ...(role === 'MANAGER' ? { monthProfit: { netSalesMinor: 7530000, grossProfitMinor: 1845000, marginBp: 2450 }, inventoryValueMinor: 15085000 } : {}),
    attentionProducts: [],
    recentDocuments: [
      {
        type: 'INVOICE', id: 'i7', number: 'INV-2026-00007', issuedAt: '2026-11-25T05:00:00.000Z',
        customer: { id: 'c1', name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971558204412' },
        salesperson: { memberId: 'm3', fullName: 'Ahmed Karim' }, lineCount: 1, totalMinor: 735000,
        status: 'ISSUED', paymentStatus: 'PARTIAL', balanceMinor: 67500, dueDate: '2026-12-25', isOverdue: false,
      },
    ],
  } as DashboardSummary;
}
