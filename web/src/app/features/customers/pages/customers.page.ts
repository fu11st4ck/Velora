import { ScrollRegion } from '../../../shared/table/scroll-region';
import { ChangeDetectionStrategy, Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatPrefix, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { describeFailure } from '../../../core/api/messages';
import type { Customer } from '../../../core/api/types';
import { SessionStore } from '../../../core/auth/session.store';
import { formatInstant } from '../../../core/dates/dates';
import { EntityVersions } from '../../../core/state/entity-versions';
import { LoadMore } from '../../../shared/table/load-more';
import { COMPACT, mediaQuery } from '../../../shared/table/media';
import { PagedList } from '../../../shared/table/paged-list';
import { UrlSearch } from '../../../shared/table/url-search';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { StateView } from '../../../shared/ui/state-view';
import { CustomersApi, type CustomerQuery, type CustomerSort } from '../data/customers.api';

/** W-E1 Customers. Balances per row need the optional backend item B4, so that column is absent (not faked). */
@Component({
  selector: 'app-customers-page',
  imports: [ScrollRegion, FormsModule, RouterLink, PageHeader, StateView, Skeleton, LoadMore, MatButton, MatIconButton, MatIcon, MatFormField, MatLabel, MatPrefix, MatSuffix, MatInput, MatSelect, MatOption],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-header heading="Customers">
      @if (canWrite()) {
        <a matButton="filled" routerLink="/customers/new" data-testid="new-customer"><mat-icon>person_add</mat-icon>New customer</a>
      }
    </app-page-header>

    <section class="filters" aria-label="Filters">
      <mat-form-field class="search">
        <mat-label>Search name, company, email or phone</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input matInput type="search" [ngModel]="search.text()" (ngModelChange)="search.input($event)" maxlength="100" data-testid="customer-search" />
        @if (search.text()) {
          <button matIconButton matSuffix type="button" aria-label="Clear search" (click)="search.clear()"><mat-icon>close</mat-icon></button>
        }
      </mat-form-field>
      <mat-form-field class="sort">
        <mat-label>Sort</mat-label>
        <mat-select [value]="query().sort" (selectionChange)="setSort($event.value)">
          <mat-option value="name">Name A–Z</mat-option>
          <mat-option value="-createdAt">Newest first</mat-option>
        </mat-select>
      </mat-form-field>
    </section>

    @if (failure(); as message) {
      <app-state-view kind="error" heading="Could not load customers" [message]="message" actionLabel="Try again" (action)="list.reload()" />
    } @else if (list.status() === 'loading' && list.items().length === 0) {
      <div role="status" aria-busy="true" aria-label="Loading customers">
        @for (i of [1, 2, 3, 4]; track i) {
          <app-skeleton height="56px" />
        }
      </div>
    } @else if (list.items().length === 0) {
      @if (query().q) {
        <app-state-view heading="No customers match" message="Try a name, company, email or part of the phone number." actionLabel="Clear search" (action)="search.clear()" />
      } @else {
        <app-state-view heading="No customers yet" message="Customers are added here or while making a sale." />
      }
    } @else {
      <div [attr.aria-busy]="list.status() === 'loading'" class="results">
        @if (compact()) {
          <ul class="cards">
            @for (c of list.items(); track c.id) {
              <li><a class="card" [routerLink]="['/customers', c.id]" data-testid="customer-row">
                <span class="name">{{ c.company || c.name }}</span>
                @if (c.company && c.name) { <span class="t-body-sm">{{ c.name }}</span> }
                <span class="t-body-sm t-muted">{{ c.mobile || c.email || '' }}</span>
              </a></li>
            }
          </ul>
        } @else {
          <div class="table-wrap" appScrollRegion="Customers table">
            <table class="table" data-testid="customers-table">
              <caption class="visually-hidden">Customers</caption>
              <thead><tr><th scope="col">Name</th><th scope="col">Company</th><th scope="col">Mobile</th><th scope="col">Email</th><th scope="col">Added</th></tr></thead>
              <tbody>
                @for (c of list.items(); track c.id) {
                  <tr data-testid="customer-row">
                    <td><a [routerLink]="['/customers', c.id]">{{ c.name || c.company }}</a></td>
                    <td>{{ c.name ? (c.company ?? '—') : '—' }}</td>
                    <td class="nowrap">{{ c.mobile ?? '—' }}</td>
                    <td>{{ c.email ?? '—' }}</td>
                    <td class="nowrap">{{ added(c) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <app-load-more [shown]="list.items().length" [hasMore]="list.hasMore()" [loading]="list.status() === 'loadingMore'" [failure]="list.moreFailure()" (more)="list.more()" />
      </div>
    }
  `,
  styleUrl: './customers.page.scss',
})
export class CustomersPage {
  private readonly api = inject(CustomersApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionStore);
  private readonly versions = inject(EntityVersions);
  protected readonly compact = mediaQuery(COMPACT);
  protected readonly canWrite = computed(() => this.session.can('customer.write'));
  protected readonly list = new PagedList<Customer>();

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly query = computed<CustomerQuery>(() => {
    const p = this.params();
    return { q: p.get('q')?.trim() || undefined, sort: p.get('sort') === '-createdAt' ? '-createdAt' : 'name', limit: 25 };
  });
  protected readonly search = new UrlSearch(this.params, (q) =>
    void this.router.navigate([], { relativeTo: this.route, queryParams: { q }, queryParamsHandling: 'merge', replaceUrl: true }),
  );
  protected readonly failure = computed(() => {
    const f = this.list.failure();
    return f ? describeFailure(f) : null;
  });

  constructor() {
    let lastKey = '';
    effect(() => {
      const query = this.query();
      this.versions.of('customers')();
      const key = JSON.stringify(query);
      untracked(() => {
        void this.list.load((cursor) => this.api.list(query, cursor), { keepItems: key === lastKey });
        lastKey = key;
      });
    });
  }

  protected setSort(sort: CustomerSort): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { sort: sort === 'name' ? null : sort }, queryParamsHandling: 'merge' });
  }

  protected added(c: Customer): string {
    return c.createdAt ? formatInstant(c.createdAt, this.session.me()?.settings.timezone ?? 'UTC') : '—';
  }
}
