import { signal } from '@angular/core';
import { toApiFailure, type ApiFailure } from '../api/api-failure';

/** Failures after which the same request may have reached the server: retry with the same key. */
function retryable(f: ApiFailure): boolean {
  // The server stores the outcome with the key in the same transaction and replays it for a
  // repeated key (backend/src/idempotency), so resending after these is always safe.
  return f.kind === 'network' || f.kind === 'timeout' || f.kind === 'server';
}

/**
 * One intended change sent to the server at most once (docs/web-state-management.md §6).
 * The idempotency key survives retries after a lost answer, and is renewed after success, after a
 * definite refusal, or when the input changes. While sending, further calls are ignored.
 */
export class Submission {
  private key: string = crypto.randomUUID();
  readonly sending = signal(false);
  readonly failure = signal<ApiFailure | null>(null);
  /** True when the last attempt may or may not have been applied — the user should retry, not edit. */
  readonly unconfirmed = signal(false);

  /** Call when the user changes what will be sent: it is a different change now. */
  inputChanged(): void {
    if (!this.sending()) {
      this.key = crypto.randomUUID();
      this.unconfirmed.set(false);
    }
  }

  /** Continues a change whose key was saved earlier (e.g. before a reload) and may already be applied. */
  adopt(key: string): void {
    if (this.sending()) return;
    this.key = key;
    this.unconfirmed.set(true);
  }

  async run<T>(send: (idempotencyKey: string) => Promise<T>): Promise<T | undefined> {
    if (this.sending()) return undefined;
    this.sending.set(true);
    this.failure.set(null);
    try {
      const result = await send(this.key);
      this.key = crypto.randomUUID();
      this.unconfirmed.set(false);
      return result;
    } catch (error) {
      const failure = toApiFailure(error);
      this.failure.set(failure);
      if (retryable(failure)) {
        this.unconfirmed.set(true); // keep the key: a retry must not apply the change twice
      } else {
        this.key = crypto.randomUUID();
        this.unconfirmed.set(false);
      }
      return undefined;
    } finally {
      this.sending.set(false);
    }
  }

  /** For tests and logs only. */
  get currentKey(): string {
    return this.key;
  }
}
