import type { Invoice, Payment, Quotation } from '../../../core/api/types';
import type { Tone } from '../../../shared/ui/status-pill';

/** Same priority as the list (shared/domain/document-status.ts) and the mobile app. */
export function invoiceStatus(i: Pick<Invoice, 'status' | 'isOverdue' | 'paymentStatus'>): { label: string; tone: Tone } {
  if (i.status === 'CANCELLED') return { label: 'Cancelled', tone: 'danger' };
  if (i.isOverdue) return { label: 'Overdue', tone: 'danger' };
  switch (i.paymentStatus) {
    case 'PAID':
      return { label: 'Paid', tone: 'success' };
    case 'PARTIAL':
      return { label: 'Partially paid', tone: 'warning' };
    default:
      return { label: 'Unpaid', tone: 'warning' };
  }
}

export function quotationStatus(q: Pick<Quotation, 'status'>): { label: string; tone: Tone } {
  switch (q.status) {
    case 'CONVERTED':
      return { label: 'Converted', tone: 'success' };
    case 'EXPIRED':
      return { label: 'Expired', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' };
    default:
      return { label: 'Open', tone: 'neutral' };
  }
}

export function methodLabel(method: Payment['method']): string {
  return method === 'CASH' ? 'Cash' : 'Bank transfer';
}

/** Digits of a phone number for a WhatsApp link (wa.me needs the international number without "+"). */
export function whatsappLink(mobile: string | null | undefined, text: string): string | null {
  const digits = mobile?.replace(/\D/g, '') ?? '';
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}
