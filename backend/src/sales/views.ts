import type { MemberRole, PaymentStatus, Prisma } from '@prisma/client';
import { canSeeCost } from '../authz/permissions';
import { fromDbDate } from '../common/dates';

/** Relations loaded for an invoice response. */
export const INVOICE_INCLUDE = {
  items: { orderBy: { lineNo: 'asc' } },
  salesperson: { include: { user: { select: { fullName: true } } } },
  payments: { orderBy: { createdAt: 'asc' }, include: { recordedBy: { include: { user: { select: { fullName: true } } } } } },
  returns: { orderBy: { createdAt: 'asc' }, include: { items: { include: { invoiceItem: { select: { lineNo: true } } } }, refunds: true } },
  quotation: { select: { id: true, number: true } },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

export const QUOTATION_INCLUDE = {
  items: { orderBy: { lineNo: 'asc' } },
  salesperson: { include: { user: { select: { fullName: true } } } },
  invoice: { select: { id: true, number: true } },
} satisfies Prisma.QuotationInclude;
export type QuotationRecord = Prisma.QuotationGetPayload<{ include: typeof QUOTATION_INCLUDE }>;

/** Business rule Y2. */
export function balanceOf(i: { totalMinor: bigint; returnedMinor: bigint; paidMinor: bigint }): bigint {
  return i.totalMinor - i.returnedMinor - i.paidMinor;
}

/** Business rule Y3. */
export function paymentStatusOf(paidMinor: bigint, balanceMinor: bigint): PaymentStatus {
  if (balanceMinor === 0n) return 'PAID';
  return paidMinor === 0n ? 'UNPAID' : 'PARTIAL';
}

/** Business rule Y6: derived, never stored. `today` is the date in the organization timezone. */
export function isOverdue(i: { status: string; dueDate: Date | null; totalMinor: bigint; returnedMinor: bigint; paidMinor: bigint }, today: string): boolean {
  const due = fromDbDate(i.dueDate);
  return i.status === 'ISSUED' && balanceOf(i) > 0n && due !== null && due < today;
}

interface CustomerSnapshotSource {
  customerId: string;
  customerName: string | null;
  customerCompany: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerTrn: string | null;
}

function customerSnapshot(d: CustomerSnapshotSource) {
  return {
    id: d.customerId,
    name: d.customerName,
    company: d.customerCompany,
    mobile: d.customerMobile,
    email: d.customerEmail,
    address: d.customerAddress,
    taxRegistrationNumber: d.customerTrn,
  };
}

interface ItemSource {
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitCostMinor: bigint;
  markupBp: number;
  unitPriceMinor: bigint;
  lineTotalMinor: bigint;
  returnedQuantity?: number;
}

/** Cost and markup per line are manager-only (business rule P7). */
function lineView(item: ItemSource, withCost: boolean) {
  const base = {
    lineNo: item.lineNo,
    productId: item.productId,
    name: item.productName,
    sku: item.productSku,
    quantity: item.quantity,
    ...(item.returnedQuantity !== undefined ? { returnedQuantity: item.returnedQuantity } : {}),
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
  };
  return withCost ? { ...base, unitCostMinor: item.unitCostMinor, markupBp: item.markupBp } : base;
}

export function quotationStatusOf(q: { status: string; validUntil: Date | null }, today: string): string {
  const until = fromDbDate(q.validUntil);
  return q.status === 'OPEN' && until !== null && until < today ? 'EXPIRED' : q.status;
}

export function quotationView(q: QuotationRecord, role: MemberRole, today: string) {
  const withCost = canSeeCost(role);
  return {
    id: q.id,
    number: q.number,
    status: quotationStatusOf(q, today),
    issuedAt: q.issuedAt,
    validUntil: fromDbDate(q.validUntil),
    currencyCode: q.currencyCode,
    customer: customerSnapshot(q),
    salesperson: { memberId: q.salespersonId, fullName: q.salesperson.user.fullName },
    lines: q.items.map((i) => lineView(i, withCost)),
    subtotalMinor: q.subtotalMinor,
    discountMinor: q.discountMinor,
    tax: { id: q.taxRateId, name: q.taxName, rateBp: q.taxRateBp, amountMinor: q.taxMinor },
    totalMinor: q.totalMinor,
    notes: q.notes,
    invoice: q.invoice,
  };
}

export function invoiceView(i: InvoiceRecord, role: MemberRole, today: string, cancelledByName: string | null = null) {
  const withCost = canSeeCost(role);
  const balanceMinor = balanceOf(i);
  const base = {
    id: i.id,
    number: i.number,
    status: i.status,
    issuedAt: i.issuedAt,
    currencyCode: i.currencyCode,
    customer: customerSnapshot(i),
    salesperson: { memberId: i.salespersonId, fullName: i.salesperson.user.fullName },
    lines: i.items.map((item) => lineView(item, withCost)),
    subtotalMinor: i.subtotalMinor,
    discountMinor: i.discountMinor,
    tax: { id: i.taxRateId, name: i.taxName, rateBp: i.taxRateBp, amountMinor: i.taxMinor },
    totalMinor: i.totalMinor,
    returnedMinor: i.returnedMinor,
    paidMinor: i.paidMinor,
    balanceMinor,
    paymentStatus: i.paymentStatus,
    isOverdue: isOverdue(i, today),
    creditDays: i.creditDays,
    dueDate: fromDbDate(i.dueDate),
    notes: i.notes,
    payments: i.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      method: p.method,
      amountMinor: p.amountMinor,
      reference: p.reference,
      note: p.note,
      receivedAt: p.receivedAt,
      recordedBy: { memberId: p.recordedById, fullName: p.recordedBy.user.fullName },
    })),
    returns: i.returns.map((r) => ({
      id: r.id,
      number: r.number,
      reason: r.reason,
      subtotalMinor: r.subtotalMinor,
      taxMinor: r.taxMinor,
      totalMinor: r.totalMinor,
      refundMinor: r.refunds.reduce((sum, p) => sum + p.amountMinor, 0n),
      lines: r.items
        .map((it) => ({ lineNo: it.invoiceItem.lineNo, quantity: it.quantity, restock: it.restock, amountMinor: it.amountMinor, taxMinor: it.taxMinor }))
        .sort((a, b) => a.lineNo - b.lineNo),
      createdAt: r.createdAt,
    })),
    quotation: i.quotation,
    cancellation: i.cancelledAt
      ? { at: i.cancelledAt, by: i.cancelledById ? { memberId: i.cancelledById, fullName: cancelledByName ?? '' } : null, reason: i.cancelReason }
      : null,
  };
  if (!withCost) return base;

  // Profit after returns: net sales less the cost of goods that stayed sold (business rules §8).
  const returnedNet = i.returns.reduce((sum, r) => sum + r.subtotalMinor, 0n);
  const netSales = i.subtotalMinor - i.discountMinor - returnedNet;
  const restocked = new Map<number, number>();
  for (const r of i.returns) {
    for (const it of r.items) if (it.restock) restocked.set(it.invoiceItem.lineNo, (restocked.get(it.invoiceItem.lineNo) ?? 0) + it.quantity);
  }
  const costMinor = i.items.reduce((sum, item) => sum + item.unitCostMinor * BigInt(item.quantity - (restocked.get(item.lineNo) ?? 0)), 0n);
  const grossProfitMinor = netSales - costMinor;
  return {
    ...base,
    profit: {
      costMinor,
      grossProfitMinor,
      marginBp: netSales > 0n ? Number((grossProfitMinor * 10000n) / netSales) : null,
    },
  };
}
