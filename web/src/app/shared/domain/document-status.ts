import type { DocumentSummary } from '../../core/api/types';
import type { Tone } from '../ui/status-pill';

/** The status pill for a document, in priority order — same rules as the mobile app. */
export function documentStatus(d: DocumentSummary): { label: string; tone: Tone } {
  if (d.type === 'QUOTATION') {
    switch (d.quotationStatus) {
      case 'CONVERTED':
        return { label: 'Converted', tone: 'success' };
      case 'EXPIRED':
        return { label: 'Expired', tone: 'warning' };
      case 'CANCELLED':
        return { label: 'Cancelled', tone: 'danger' };
      default:
        return { label: 'Quotation', tone: 'neutral' };
    }
  }
  if (d.status === 'CANCELLED') return { label: 'Cancelled', tone: 'danger' };
  if (d.isOverdue) return { label: 'Overdue', tone: 'danger' };
  switch (d.paymentStatus) {
    case 'PAID':
      return { label: 'Paid', tone: 'success' };
    case 'PARTIAL':
      return { label: 'Partially paid', tone: 'warning' };
    default:
      return { label: 'Unpaid', tone: 'warning' };
  }
}
