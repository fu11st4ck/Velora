import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import type { ApiFailure } from '../../core/api/api-failure';
import { describeFailure } from '../../core/api/messages';

/** "Showing n" and the Load more button under a server-paginated list. */
@Component({
  selector: 'app-load-more',
  imports: [MatButton, MatProgressSpinner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="t-body-sm t-muted" aria-live="polite">Showing {{ shown() }}{{ total() === null ? '' : ' of ' + total() }}</span>
    @if (failure(); as f) {
      <span class="t-body-sm error" role="alert">{{ message() }}</span>
    }
    @if (hasMore()) {
      <button matButton="outlined" type="button" (click)="more.emit()" [disabled]="loading()" data-testid="load-more">
        @if (loading()) {
          <mat-progress-spinner diameter="18" mode="indeterminate" aria-label="Loading" />
        } @else {
          {{ failure() ? 'Try again' : 'Load more' }}
        }
      </button>
    }
  `,
  styles: `
    :host { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-4) 0; }
    .error { color: var(--color-error); flex: 1; }
  `,
})
export class LoadMore {
  readonly shown = input.required<number>();
  readonly total = input<number | null>(null);
  readonly hasMore = input(false);
  readonly loading = input(false);
  readonly failure = input<ApiFailure | null>(null);
  readonly more = output<void>();
  protected readonly message = computed(() => {
    const f = this.failure();
    return f ? describeFailure(f) : '';
  });
}
