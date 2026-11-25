import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Short confirmations of completed actions. Errors that need a decision belong on the page, not here. */
@Injectable({ providedIn: 'root' })
export class Notify {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, undefined, { duration: 4000, politeness: 'polite' });
  }

  error(message: string): void {
    this.snackBar.open(message, 'Dismiss', { duration: 10000, politeness: 'assertive' });
  }
}
