import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { DocumentSummary } from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';
import { formatCalendarDate, formatInstant } from '../../core/dates/dates';
import { formatMoney } from '../../core/money/money';
import { StatusPill } from '../ui/status-pill';
import { documentStatus } from './document-status';

/**
 * A compact list of documents (customer detail, dashboard-like lists). Numbers become links once
 * the document pages exist (W4); until then they are plain text — no dead links.
 */
@Component({
  selector: 'app-document-rows',
  imports: [StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul>
      @for (d of rows(); track d.doc.id) {
        <li data-testid="document-row">
          <div class="main">
            <span class="number">{{ d.doc.number }}</span>
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
    .number { font-weight: 600; }
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
      return { doc, status: documentStatus(doc), line: parts.join(' · '), total: money(doc.totalMinor) };
    });
  });
}
