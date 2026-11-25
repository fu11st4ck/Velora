import { ChangeDetectionStrategy, Component, DOCUMENT, DestroyRef, Injectable, inject, input, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogActions, MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { MatDialogClose } from '@angular/material/dialog';
import { toApiFailure } from '../../../core/api/api-failure';
import { describeFailure } from '../../../core/api/messages';
import { Notify } from '../../../shared/ui/notify';
import { DocumentsApi, type DocumentType } from '../data/documents.api';

interface Viewer {
  title: string;
  url: SafeResourceUrl;
  download: () => void;
}

@Component({
  selector: 'app-pdf-viewer',
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content class="content">
      <!-- A blob: URL created by this page from the server's PDF (allowed by the CSP's frame-src). -->
      <iframe [src]="data.url" [title]="data.title" data-testid="pdf-frame"></iframe>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton type="button" (click)="data.download()"><mat-icon>download</mat-icon>Download</button>
      <button matButton="filled" type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content { padding: 0; max-height: none; }
    iframe { display: block; width: min(900px, 92vw); height: 75vh; border: 0; }
  `,
})
export class PdfViewerDialog {
  protected readonly data = inject<Viewer>(MAT_DIALOG_DATA);
}

/** W-F8: view, print and download a document's PDF exactly as the server renders it. */
@Injectable({ providedIn: 'root' })
export class DocumentPdf {
  private readonly api = inject(DocumentsApi);
  private readonly dialog = inject(MatDialog);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject(DOCUMENT);
  private readonly notify = inject(Notify);

  private async fetch(kind: DocumentType, id: string): Promise<string | null> {
    try {
      return URL.createObjectURL(await this.api.pdf(kind, id));
    } catch (e) {
      this.notify.error(describeFailure(toApiFailure(e)));
      return null;
    }
  }

  private save(url: string, number: string): void {
    const a = this.document.createElement('a');
    a.href = url;
    a.download = `${number}.pdf`;
    this.document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async view(kind: DocumentType, id: string, number: string): Promise<void> {
    const url = await this.fetch(kind, id);
    if (!url) return;
    // The only URL ever trusted here is a blob: this page just created from the server's PDF.
    if (!url.startsWith('blob:')) throw new Error('Refusing to frame a non-blob URL');
    const ref = this.dialog.open(PdfViewerDialog, {
      data: { title: number, url: this.sanitizer.bypassSecurityTrustResourceUrl(url), download: () => this.save(url, number) } satisfies Viewer,
      maxWidth: '96vw',
    });
    ref.afterClosed().subscribe(() => URL.revokeObjectURL(url));
  }

  async download(kind: DocumentType, id: string, number: string): Promise<void> {
    const url = await this.fetch(kind, id);
    if (!url) return;
    this.save(url, number);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Loads the PDF in a hidden frame and opens the browser's print dialog for it. */
  async print(kind: DocumentType, id: string): Promise<void> {
    const url = await this.fetch(kind, id);
    if (!url) return;
    const frame = this.document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.src = url;
    frame.dataset['testid'] = 'pdf-print-frame';
    frame.addEventListener('load', () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        // Some browsers cannot print a PDF from a frame; open it instead so it can be printed there.
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    });
    this.document.body.appendChild(frame);
  }
}

/** The PDF button with its menu, for a document header. */
@Component({
  selector: 'app-pdf-actions',
  imports: [MatButton, MatIcon, MatMenu, MatMenuItem, MatMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button matButton="outlined" type="button" [matMenuTriggerFor]="menu" [disabled]="busy()" data-testid="pdf-menu"><mat-icon>picture_as_pdf</mat-icon>PDF</button>
    <mat-menu #menu="matMenu">
      <button mat-menu-item type="button" (click)="run(pdf.view(kind(), id(), number()))" data-testid="pdf-view"><mat-icon>visibility</mat-icon>View</button>
      <button mat-menu-item type="button" (click)="run(pdf.print(kind(), id()))" data-testid="pdf-print"><mat-icon>print</mat-icon>Print</button>
      <button mat-menu-item type="button" (click)="run(pdf.download(kind(), id(), number()))" data-testid="pdf-download"><mat-icon>download</mat-icon>Download</button>
    </mat-menu>
  `,
})
export class PdfActions {
  readonly kind = input.required<DocumentType>();
  readonly id = input.required<string>();
  readonly number = input.required<string>();
  protected readonly pdf = inject(DocumentPdf);
  protected readonly busy = signal(false);
  private alive = true;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.alive = false));
  }

  protected async run(task: Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await task;
    } finally {
      if (this.alive) this.busy.set(false);
    }
  }
}
