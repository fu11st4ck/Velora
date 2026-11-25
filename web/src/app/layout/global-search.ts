import { DIALOG_DEFAULTS } from '../shared/ui/dialog-defaults';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogContent, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressBar } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Customer, DocumentSummary, Page, Product } from '../core/api/types';
import { SessionStore } from '../core/auth/session.store';
import { formatMoney } from '../core/money/money';

interface Hit {
  group: 'Products' | 'Customers' | 'Documents';
  title: string;
  detail: string;
  link: string[];
}

/**
 * W-S2 Global search (Ctrl/⌘ + K): products, customers and documents at once, each searched by the
 * server and limited to what the role may see. ↑ ↓ choose, Enter opens, Esc closes.
 */
@Component({
  selector: 'app-global-search',
  // Not ngModel: it writes its initial value a tick after the field appears, which erased text
  // typed immediately after Ctrl+K.
  imports: [MatDialogContent, MatIcon, MatProgressBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-dialog-content class="content">
      <div class="field">
        <mat-icon aria-hidden="true">search</mat-icon>
        <input
          type="text"
          [value]="text()"
          (input)="onText($any($event.target).value)"
          (keydown)="onKey($event)"
          placeholder="Search products, customers, documents"
          aria-label="Search products, customers and documents"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          [attr.aria-activedescendant]="hits().length ? 'hit-' + active() : null"
          autocomplete="off"
          cdkFocusInitial
          data-testid="global-search-input"
        />
        <kbd>Esc</kbd>
      </div>
      @if (loading()) { <mat-progress-bar mode="indeterminate" aria-label="Searching" /> }
      <ul id="search-results" role="listbox" aria-label="Results">
        @for (h of hits(); track $index; let i = $index) {
          @if (i === 0 || hits()[i - 1]!.group !== h.group) {
            <li class="group" role="presentation">{{ h.group }}</li>
          }
          <li [id]="'hit-' + i" role="option" tabindex="-1" [attr.aria-selected]="i === active()" [class.active]="i === active()" (click)="open(h)" (keydown.enter)="open(h)" (mouseenter)="active.set(i)" data-testid="global-search-hit">
            <span class="title">{{ h.title }}</span>
            <span class="t-body-sm t-muted">{{ h.detail }}</span>
          </li>
        }
      </ul>
      @if (!loading() && text().trim().length >= 2 && hits().length === 0) {
        <p class="t-muted empty">Nothing matches “{{ text().trim() }}”.</p>
      }
      @if (text().trim().length < 2) {
        <p class="t-muted empty">Type at least 2 characters: a name, SKU, barcode, phone number or document number.</p>
      }
    </mat-dialog-content>
  `,
  styles: `
    .content { padding: 0 !important; max-height: 70vh; width: min(640px, 92vw); }
    .field { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-line); position: sticky; top: 0; background: var(--color-surface-raised); }
    input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--color-text); font: 400 16px/24px var(--font-ui); }
    kbd { font: 12px var(--font-ui); padding: 2px 6px; border: 1px solid var(--color-line); border-radius: var(--radius-sm); color: var(--color-text-muted); }
    ul { list-style: none; margin: 0; padding: var(--space-2); }
    .group { padding: var(--space-3) var(--space-3) var(--space-1); font: 600 12px var(--font-ui); letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-muted); }
    [role='option'] { display: flex; flex-direction: column; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); cursor: pointer; }
    [role='option'].active { background: var(--color-primary-container); color: var(--color-on-primary-container); }
    .title { font-weight: 600; }
    .empty { padding: var(--space-4); margin: 0; }
  `,
})
export class GlobalSearchDialog {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly ref = inject<MatDialogRef<GlobalSearchDialog>>(MatDialogRef);
  protected readonly text = signal('');
  protected readonly loading = signal(false);
  protected readonly results = signal<Hit[]>([]);
  protected readonly active = signal(0);
  protected readonly hits = computed(() => this.results());
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  protected onText(value: string): void {
    this.text.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.search(value.trim()), 250);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.hits().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.active.update((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.update((i) => (i - 1 + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = this.hits()[this.active()];
      if (hit) this.open(hit);
    }
  }

  protected open(hit: Hit): void {
    this.ref.close();
    void this.router.navigate(hit.link);
  }

  private money(minor: number): string {
    return formatMoney(minor, this.session.money());
  }

  private async search(q: string): Promise<void> {
    const generation = ++this.generation;
    if (q.length < 2) {
      this.results.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    const base = environment.apiBaseUrl;
    const get = <T>(url: string, params: Record<string, string | number>) => firstValueFrom(this.http.get<Page<T>>(url, { params })).then((p) => p.data, () => [] as T[]);
    const [products, customers, documents] = await Promise.all([
      this.session.can('product.read') ? get<Product>(`${base}/products`, { q, limit: 5 }) : Promise.resolve([] as Product[]),
      this.session.can('customer.read') ? get<Customer>(`${base}/customers`, { q, limit: 5 }) : Promise.resolve([] as Customer[]),
      this.session.can('document.read_own') ? get<DocumentSummary>(`${base}/documents`, { q, limit: 5 }) : Promise.resolve([] as DocumentSummary[]),
    ]);
    if (generation !== this.generation) return;
    this.results.set([
      ...products.map((p): Hit => ({ group: 'Products', title: p.name, detail: `${p.sku} · ${p.quantity} on hand · ${this.money(p.listPriceMinor)}`, link: ['/inventory', p.id] })),
      ...customers.map((c): Hit => ({ group: 'Customers', title: [c.company, c.name].filter(Boolean).join(' · '), detail: c.mobile ?? c.email ?? '', link: ['/customers', c.id] })),
      ...documents.map((d): Hit => ({
        group: 'Documents',
        title: d.number,
        detail: `${d.customer.company || d.customer.name || ''} · ${this.money(d.totalMinor)}`,
        link: d.type === 'INVOICE' ? ['/documents/invoices', d.id] : ['/documents/quotations', d.id],
      })),
    ]);
    this.active.set(0);
    this.loading.set(false);
  }
}

@Injectable({ providedIn: 'root' })
export class GlobalSearch {
  private readonly dialog = inject(MatDialog);
  private open = false;

  show(): void {
    if (this.open) return;
    this.open = true;
    const ref = this.dialog.open(GlobalSearchDialog, { ...DIALOG_DEFAULTS, position: { top: '12vh' }, maxWidth: '96vw', autoFocus: 'first-tabbable', ariaLabel: 'Search' });
    ref.afterClosed().subscribe(() => (this.open = false));
  }
}
