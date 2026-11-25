import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { DocumentSummary } from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';
import { formatCalendarDate, formatInstant } from '../../core/dates/dates';
import { formatMoney } from '../../core/money/money';
import { RouterLink } from '@angular/router';
import { StatusPill } from '../ui/status-pill';
import { documentStatus } from './document-status';

/** A compact list of documents (customer detail), each linking to its page. */
@Component({
  selector: 'app-document-rows',
  imports: [StatusPill, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul>
      @for (d of rows(); track d.doc.id) {
        <li data-testid="document-row">
          <div class="main">
            <a class="number" [routerLink]="d.link">{{ d.doc.number }}</a>
            <app-status-pill [label]="d.status.label" [tone]="d.status.tone" />
            <span class="t-body-sm t-muted">{{ d.line }}</span>
          </div>
          <span class="t-money">{{ d.total }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) 0; border-top: 1px solid var(--color-line); }
    li:first-child { border-top: 0; }
    .main { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); }
    .main .t-body-sm { flex-basis: 100%; }
    .number { font-weight: 600; color: var(--color-text); }
    .t-money { white-space: nowrap; }
  `,
})
export class DocumentRows {
  readonly documents = input.required<DocumentSummary[]>();
  private readonly session = inject(SessionStore);

  protected readonly rows = computed(() => {
    const tz = this.session.me()?.settings.timezone ?? 'UTC';
    const money = (minor: number) => formatMoney(minor, this.session.money());
    return this.documents().map((doc) => {
      const parts = [formatInstant(doc.issuedAt, tz), doc.salesperson.fullName];
      if (doc.type === 'INVOICE' && doc.status !== 'CANCELLED' && (doc.balanceMinor ?? 0) > 0) {
        parts.push(`Balance ${money(doc.balanceMinor ?? 0)}${doc.dueDate ? ` · due ${formatCalendarDate(doc.dueDate)}` : ''}`);
      }
      const link = doc.type === 'INVOICE' ? ['/documents/invoices', doc.id] : ['/documents/quotations', doc.id];
      return { doc, link, status: documentStatus(doc), line: parts.join(' · '), total: money(doc.totalMinor) };
    });
  });
}
