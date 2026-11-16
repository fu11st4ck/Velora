import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';

/** Everything printed on a customer-facing document. Deliberately has no cost, markup or profit. */
export interface PrintableDocument {
  kind: 'INVOICE' | 'QUOTATION';
  number: string;
  issuedAt: Date;
  cancelled: boolean;
  seller: { name: string; legalName: string | null; address: string | null; phone: string | null; email: string | null; trn: string | null; footer: string | null };
  customer: { name: string | null; company: string | null; mobile: string | null; email: string | null; address: string | null; trn: string | null };
  salesperson: string;
  currencyCode: string;
  currencyExponent: number;
  timezone: string;
  lines: { name: string; sku: string; quantity: number; unitPriceMinor: bigint; lineTotalMinor: bigint }[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxName: string;
  taxMinor: bigint;
  totalMinor: bigint;
  notes: string | null;
  /** Invoices only. */
  settlement?: {
    payments: { kind: 'PAYMENT' | 'REFUND'; method: string; amountMinor: bigint; receivedAt: Date; reference: string | null }[];
    returnedMinor: bigint;
    paidMinor: bigint;
    balanceMinor: bigint;
    dueDate: string | null;
    statusLabel: string;
  };
  /** Quotations only. */
  validUntil?: string | null;
}

const FONTS = join(__dirname, '..', '..', 'assets', 'fonts');
const WINE = '#45151F';
const GOLD = '#7A5A28';
const INK = '#211B1C';
const MUTED = '#655D5E';
const LINE = '#E7E0DB';
const MARGIN = 48;
const METHODS: Record<string, string> = { CASH: 'Cash', BANK_TRANSFER: 'Bank transfer' };

/** `298095` → `2,980.95` using integer arithmetic only. */
export function formatMinor(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(exponent);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = exponent === 0 ? '' : `.${(abs % scale).toString().padStart(exponent, '0')}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * Renders the customer-facing PDF of an invoice or quotation: one canonical document for every
 * device. Built from structured data with fixed layout code — no user text is interpreted as markup.
 *
 * Known limit: the bundled fonts cover Latin, Greek and Cyrillic. Right-to-left scripts such as
 * Arabic are not shaped correctly yet (docs/implementation-roadmap.md risk R8).
 */
@Injectable()
export class PdfService {
  render(doc: PrintableDocument): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: MARGIN,
        info: { Title: `${doc.kind === 'INVOICE' ? 'Invoice' : 'Quotation'} ${doc.number}`, Author: doc.seller.name },
      });
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      pdf.registerFont('sans', join(FONTS, 'Inter.ttf'));
      pdf.registerFont('serif', join(FONTS, 'PlayfairDisplay.ttf'));
      this.draw(pdf, doc);
      pdf.end();
    });
  }

  private draw(pdf: PDFKit.PDFDocument, doc: PrintableDocument): void {
    const width = pdf.page.width - MARGIN * 2;
    const right = MARGIN + width;
    const money = (minor: bigint) => `${doc.currencyCode} ${formatMinor(minor, doc.currencyExponent)}`;
    const day = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: doc.timezone, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
    const dateOnly = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${d}T00:00:00Z`));
    const hasTax = doc.taxMinor > 0n;
    const title = doc.kind === 'QUOTATION' ? 'QUOTATION' : hasTax ? 'TAX INVOICE' : 'INVOICE';

    // Header
    pdf.font('serif').fontSize(22).fillColor(WINE).text(doc.seller.name, MARGIN, MARGIN, { width: width * 0.6 });
    pdf.font('serif').fontSize(20).fillColor(WINE).text(title, MARGIN + width * 0.5, MARGIN, { width: width * 0.5, align: 'right' });
    pdf.font('sans').fontSize(10).fillColor(INK).text(doc.number, MARGIN + width * 0.5, MARGIN + 28, { width: width * 0.5, align: 'right' });
    pdf.fillColor(MUTED).text(day(doc.issuedAt), { width: width * 0.5, align: 'right' });
    if (doc.cancelled) pdf.fillColor('#A3261F').text('CANCELLED', { width: width * 0.5, align: 'right' });
    let y = Math.max(pdf.y, MARGIN + 70) + 10;
    pdf.moveTo(MARGIN, y).lineTo(right, y).lineWidth(1.5).strokeColor(WINE).stroke();
    y += 18;

    // Parties
    const column = (x: number, label: string, rows: (string | null)[]) => {
      pdf.font('sans').fontSize(8).fillColor(GOLD).text(label, x, y, { width: width / 2 - 12, characterSpacing: 0.8 });
      const [first, ...rest] = rows.filter((r): r is string => Boolean(r));
      pdf.font('serif').fontSize(13).fillColor(INK).text(first ?? '', x, pdf.y + 4, { width: width / 2 - 12 });
      pdf.font('sans').fontSize(9).fillColor(MUTED);
      for (const row of rest) pdf.text(row, x, pdf.y + 2, { width: width / 2 - 12 });
      return pdf.y;
    };
    const fromEnd = column(MARGIN, 'FROM', [
      doc.seller.legalName ?? doc.seller.name,
      doc.seller.address,
      doc.seller.phone,
      doc.seller.email,
      doc.seller.trn ? `TRN ${doc.seller.trn}` : null,
    ]);
    const toEnd = column(MARGIN + width / 2 + 12, doc.kind === 'INVOICE' ? 'BILL TO' : 'PREPARED FOR', [
      doc.customer.company ?? doc.customer.name,
      doc.customer.company ? doc.customer.name : null,
      doc.customer.address,
      doc.customer.mobile,
      doc.customer.email,
      doc.customer.trn ? `TRN ${doc.customer.trn}` : null,
    ]);
    y = Math.max(fromEnd, toEnd) + 22;

    // Items
    const cols = { item: MARGIN + 8, qty: MARGIN + width * 0.56, unit: MARGIN + width * 0.66, total: MARGIN + width * 0.83 };
    const head = () => {
      pdf.rect(MARGIN, y, width, 22).fill(WINE);
      pdf.font('sans').fontSize(8).fillColor('#FFFFFF');
      pdf.text('ITEM', cols.item, y + 7, { characterSpacing: 0.8 });
      pdf.text('QTY', cols.qty, y + 7, { width: width * 0.08, align: 'right', characterSpacing: 0.8 });
      pdf.text('UNIT PRICE', cols.unit, y + 7, { width: width * 0.16, align: 'right', characterSpacing: 0.8 });
      pdf.text('TOTAL', cols.total, y + 7, { width: width * 0.17 - 8, align: 'right', characterSpacing: 0.8 });
      y += 22;
    };
    const ensure = (needed: number, withHead = false) => {
      if (y + needed <= pdf.page.height - MARGIN - 30) return;
      pdf.addPage();
      y = MARGIN;
      if (withHead) head();
    };
    head();
    for (const line of doc.lines) {
      const nameHeight = pdf.font('sans').fontSize(10).heightOfString(line.name, { width: width * 0.52 });
      ensure(nameHeight + 30, true);
      pdf.font('sans').fontSize(10).fillColor(INK).text(line.name, cols.item, y + 8, { width: width * 0.52 });
      pdf.fontSize(8).fillColor(MUTED).text(line.sku, cols.item, y + 10 + nameHeight, { width: width * 0.52 });
      pdf.fontSize(10).fillColor(INK);
      pdf.text(String(line.quantity), cols.qty, y + 8, { width: width * 0.08, align: 'right' });
      pdf.text(formatMinor(line.unitPriceMinor, doc.currencyExponent), cols.unit, y + 8, { width: width * 0.16, align: 'right' });
      pdf.text(formatMinor(line.lineTotalMinor, doc.currencyExponent), cols.total, y + 8, { width: width * 0.17 - 8, align: 'right' });
      y += nameHeight + 28;
      pdf.moveTo(MARGIN, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
    }
    y += 16;

    // Totals (right) and settlement details (left)
    const totals: [string, string, boolean][] = [
      ['Subtotal', money(doc.subtotalMinor), false],
      ...(doc.discountMinor > 0n ? ([['Discount', `- ${money(doc.discountMinor)}`, false]] as [string, string, boolean][]) : []),
      [doc.taxName, money(doc.taxMinor), false],
      ['Total', money(doc.totalMinor), true],
    ];
    const s = doc.settlement;
    if (s) {
      if (s.returnedMinor > 0n) totals.push(['Returned', `- ${money(s.returnedMinor)}`, false]);
      totals.push(['Paid', money(s.paidMinor), false], ['Balance due', money(s.balanceMinor), true]);
    }
    ensure(totals.length * 20 + 40);
    const top = y;
    const tx = MARGIN + width * 0.55;
    for (const [label, value, strong] of totals) {
      if (strong) {
        pdf.moveTo(tx, y).lineTo(right, y).lineWidth(0.8).strokeColor(INK).stroke();
        y += 6;
      }
      pdf.font('sans').fontSize(strong ? 11 : 10).fillColor(strong ? INK : MUTED).text(label, tx, y, { width: width * 0.2 });
      pdf.font(strong ? 'serif' : 'sans').fontSize(strong ? 13 : 10).fillColor(strong ? WINE : INK).text(value, tx + width * 0.15, y - (strong ? 2 : 0), { width: width * 0.3, align: 'right' });
      y += strong ? 24 : 18;
    }
    const totalsEnd = y;

    y = top;
    const leftWidth = width * 0.5;
    const label = (text: string) => {
      pdf.font('sans').fontSize(8).fillColor(GOLD).text(text, MARGIN, y, { width: leftWidth, characterSpacing: 0.8 });
      y = pdf.y + 4;
    };
    const row = (text: string, color = INK) => {
      pdf.font('sans').fontSize(9).fillColor(color).text(text, MARGIN, y, { width: leftWidth });
      y = pdf.y + 2;
    };
    if (s) {
      label('PAYMENT');
      row(s.statusLabel);
      if (s.dueDate && s.balanceMinor > 0n) row(`Due ${dateOnly(s.dueDate)}`, MUTED);
      for (const p of s.payments) {
        row(`${day(p.receivedAt)} · ${p.kind === 'REFUND' ? 'Refund' : 'Payment'} · ${METHODS[p.method] ?? p.method} · ${money(p.amountMinor)}${p.reference ? ` · Ref ${p.reference}` : ''}`, MUTED);
      }
      y += 8;
    } else if (doc.validUntil) {
      label('VALIDITY');
      row(`Valid until ${dateOnly(doc.validUntil)}`);
      row('Prices are held until this date. Items are not reserved.', MUTED);
      y += 8;
    }
    if (doc.notes) {
      label('NOTES');
      row(doc.notes, MUTED);
    }
    y = Math.max(y, totalsEnd) + 24;

    // Footer
    ensure(50);
    pdf.moveTo(MARGIN, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 12;
    if (doc.seller.footer) {
      pdf.font('serif').fontSize(11).fillColor(WINE).text(doc.seller.footer, MARGIN, y, { width, align: 'center' });
      y = pdf.y + 4;
    }
    pdf.font('sans').fontSize(8).fillColor(MUTED).text(`Served by ${doc.salesperson} · ${doc.number}`, MARGIN, y, { width, align: 'center' });
  }
}

/** The seller block printed on documents, from the organization profile. */
export function sellerOf(org: {
  name: string;
  legalName: string | null;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  taxRegistrationNumber: string | null;
  invoiceFooter: string | null;
}): PrintableDocument['seller'] {
  return {
    name: org.name,
    legalName: org.legalName,
    address: [org.addressLine, org.city].filter(Boolean).join(', ') || null,
    phone: org.phone,
    email: org.email,
    trn: org.taxRegistrationNumber,
    footer: org.invoiceFooter,
  };
}
