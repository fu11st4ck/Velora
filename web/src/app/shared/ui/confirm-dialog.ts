import { ChangeDetectionStrategy, Component, Injectable, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogClose, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';

export interface ConfirmOptions {
  title: string;
  /** What will happen, in plain words. */
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButton, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><p>{{ data.message }}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" [mat-dialog-close]="false">{{ data.cancelLabel ?? 'Cancel' }}</button>
      <button matButton="filled" type="button" [mat-dialog-close]="true" [class.danger]="data.danger" data-testid="confirm">{{ data.confirmLabel }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    p { margin: 0; white-space: pre-line; }
    .danger { --mat-button-filled-container-color: var(--status-danger-fg); }
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmOptions>(MAT_DIALOG_DATA);
}

/** Asks before a consequential action. Resolves true only when the user confirms. */
@Injectable({ providedIn: 'root' })
export class Confirm {
  private readonly dialog = inject(MatDialog);

  async ask(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmOptions, boolean>(ConfirmDialog, { data: options, width: '420px', autoFocus: 'dialog' });
    return (await firstValueFrom(ref.afterClosed())) === true;
  }
}
