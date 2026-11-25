import type { Customer, DashboardSummary, Invoice, Me, PricingPreview, Product, StockMovement } from '../app/core/api/types';

/** Test data shaped exactly like the API's responses (types come from the OpenAPI contract). Test-only. */
export function meFixture(role: 'OWNER' | 'MANAGER' | 'SALES' = 'MANAGER'): Me {
  const manager = role !== 'SALES';
  return {
    user: { id: 'u1', fullName: 'Maya Manager', email: 'maya@velora.example' },
    membership: { memberId: 'm1', role, branchId: null, organization: { id: 'o1', name: 'Velora Fine Jewellery LLC' } },
    // Same matrix as backend/src/authz/permissions.ts.
    permissions: [
      ...['product.read', 'inventory.read', 'customer.read', 'customer.write', 'sale.create', 'document.read_own', 'payment.record', 'report.read_own'],
      ...(manager
        ? ['product.read_cost', 'product.manage', 'inventory.manage', 'customer.archive', 'sale.below_minimum', 'document.read_all', 'payment.refund', 'invoice.cancel', 'invoice.return', 'report.read_all', 'settings.read', 'team.read']
        : []),
      ...(role === 'OWNER' ? ['settings.manage', 'team.manage'] : []),
    ],
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

/** A product as the API returns it to the given role (cost fields only with product.read_cost). */
export function productFixture(overrides: Partial<Product> = {}, role: 'MANAGER' | 'SALES' = 'MANAGER'): Product {
  const base: Product = {
    id: '01a1e0ca-13af-7da1-9715-c7f57be85084', sku: 'VLR-BR-001', barcode: null, name: 'Alhambra Gold Bracelet', description: null,
    weight: { value: '12.8', unit: 'G' }, imageUrl: null, quantity: 23, stockStatus: 'IN_STOCK', reorderLevel: null, effectiveReorderLevel: 8,
    listPriceMinor: 364000, floorPriceMinor: 322000, ceilingPriceMinor: 448000, isActive: true, archivedAt: null, version: 3,
    createdAt: '2026-11-15T19:58:00.000Z', updatedAt: '2026-11-16T07:32:00.000Z',
    ...(role === 'MANAGER' ? { costMinor: 280000, defaultMarkupBp: 3000, minMarkupBp: 1500 } : {}),
  };
  return { ...base, ...overrides };
}

export function movementFixture(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: 'mv1', productId: '01a1e0ca-13af-7da1-9715-c7f57be85084', productName: 'Alhambra Gold Bracelet', productSku: 'VLR-BR-001',
    type: 'ADJUSTMENT_OUT', quantityDelta: -2, balanceAfter: 21, unitCostMinor: 280000, invoice: null, return: null,
    supplierName: null, referenceNote: null, reason: 'Damaged clasp', createdBy: { memberId: 'm1', fullName: 'Maya Manager' }, createdAt: '2026-11-24T21:05:00.000Z',
    ...overrides,
  };
}

export function customerFixture(overrides: Partial<Customer> = {}): Customer {
  return { id: 'c0a1e0ca-13af-4da1-9715-c7f57be85001', name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971558204412', email: null, address: null, taxRegistrationNumber: null, notes: null, archivedAt: null, createdAt: '2026-11-20T08:00:00.000Z', updatedAt: '2026-11-20T08:00:00.000Z', ...overrides };
}

/** A preview for one line of the bracelet at list price with 5% VAT, as the server computes it. */
export function previewFixture(overrides: Partial<PricingPreview> = {}): PricingPreview {
  return {
    lines: [{ productId: '01a1e0ca-13af-7da1-9715-c7f57be85084', quantity: 1, unitPriceMinor: 364000, lineTotalMinor: 364000, available: 23, issues: [] }],
    subtotalMinor: 364000, discountMinor: 0, tax: { id: 't1', name: 'VAT', rateBp: 500, amountMinor: 18200 }, totalMinor: 382200, valid: true,
    ...overrides,
  };
}

export function invoiceFixture(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv1', number: 'INV-2026-00008', status: 'ISSUED', issuedAt: '2026-11-25T08:00:00.000Z', currencyCode: 'AED',
    customer: { id: 'c0a1e0ca-13af-4da1-9715-c7f57be85001', name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971558204412' },
    salesperson: { memberId: 'm1', fullName: 'Maya Manager' },
    lines: [{ lineNo: 1, productId: '01a1e0ca-13af-7da1-9715-c7f57be85084', name: 'Alhambra Gold Bracelet', sku: 'VLR-BR-001', quantity: 1, unitPriceMinor: 364000, lineTotalMinor: 364000 }],
    subtotalMinor: 364000, discountMinor: 0, tax: { id: 't1', name: 'VAT', rateBp: 500, amountMinor: 18200 }, totalMinor: 382200,
    returnedMinor: 0, paidMinor: 191100, balanceMinor: 191100, paymentStatus: 'PARTIAL', isOverdue: false, creditDays: 30, dueDate: '2026-12-25',
    notes: null, payments: [], returns: [], quotation: null, cancellation: null,
    ...overrides,
  } as Invoice;
}
