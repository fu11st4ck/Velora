import { Pipe, type PipeTransform, inject } from '@angular/core';
import { SessionStore } from '../../core/auth/session.store';
import { formatMoney } from '../../core/money/money';

/** `{{ 298095 | money }}` → `AED 2,980.95`, in the organization's currency. */
@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly session = inject(SessionStore);

  transform(minor: number | null | undefined, withCode = true): string {
    return minor === null || minor === undefined ? '' : formatMoney(minor, this.session.money(), { withCode });
  }
}
