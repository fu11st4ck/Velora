import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { Envelope, Invoice } from '../../../core/api/types';

/** One-off reads of an invoice (the return page needs a snapshot it can edit against). */
@Injectable({ providedIn: 'root' })
export class InvoicesReader {
  private readonly http = inject(HttpClient);

  async invoice(id: string): Promise<Invoice> {
    return (await firstValueFrom(this.http.get<Envelope<Invoice>>(`${environment.apiBaseUrl}/invoices/${encodeURIComponent(id)}`))).data;
  }
}
