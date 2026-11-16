import { Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { addDays, isCalendarDate, localDate, toDbDate } from '../common/dates';
import { DomainError, Errors } from '../common/errors';
import { divRoundHalfUp } from '../common/money';
import type { RequestContext } from '../common/request-context';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { CancelInvoiceDto, CreateInvoiceDto, CreateReturnDto, RecordPaymentDto, RecordRefundDto } from './dto';
import { NumberingService } from './numbering.service';
import { PdfService, sellerOf, type PrintableDocument } from './pdf.service';
import { PricingService } from './pricing.service';
import { belowMinimum, customerSnapshotFor, ownFilter } from './quotations.service';
import { balanceOf, INVOICE_INCLUDE, invoiceView, paymentStatusOf } from './views';

/**
 * Invoices are the sale (ADR-0009). Everything that changes money or stock for an invoice happens
 * here, each operation in ONE transaction: it either completes entirely or leaves no trace.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly numbering: NumberingService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly pdf: PdfService,
  ) {}

  /** Issues the invoice: prices it, takes the stock, numbers it and records any money received now. */
  async create(tx: Tx, ctx: RequestContext, dto: CreateInvoiceDto) {
    const now = this.clock.now();
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const today = localDate(now, org.timezone);
    if (dto.id && (await tx.invoice.findFirst({ where: { id: dto.id }, select: { id: true } }))) {
      throw new DomainError('DOCUMENT_EXISTS', 409, 'An invoice with this id already exists.');
    }

    // A quotation converts once. Locking its row makes two simultaneous conversions queue up.
    if (dto.quotationId) {
      await tx.$queryRaw`SELECT id FROM quotations WHERE id = ${dto.quotationId}::uuid FOR UPDATE`;
      const quotation = await tx.quotation.findFirst({
        where: { id: dto.quotationId, ...ownFilter(ctx) },
        include: { invoice: { select: { id: true } } },
      });
      if (!quotation) throw Errors.notFound('Quotation');
      if (quotation.invoice) throw Errors.quotationAlreadyConverted(quotation.invoice.id);
      if (quotation.status !== 'OPEN') throw Errors.invalidState(quotation.status, 'This quotation can no longer be converted.');
    }

    const customer = await customerSnapshotFor(tx, dto.customerId);
    const priced = await this.pricing.price(tx, ctx, dto, { checkStock: true });
    this.pricing.assertValid(priced);

    const received = BigInt(dto.payment?.amountMinor ?? 0);
    if (received > priced.totalMinor) throw Errors.paymentExceedsBalance(priced.totalMinor);
    const balance = priced.totalMinor - received;
    // Every invoice with a balance has a due date (the reference set none for partial payments).
    let dueDate: string | null = null;
    let creditDays: number | null = null;
    if (balance > 0n) {
      if (dto.dueDate) {
        if (!isCalendarDate(dto.dueDate) || dto.dueDate < today) throw Errors.validation('dueDate', 'notInPast');
        dueDate = dto.dueDate;
      } else {
        creditDays = dto.creditDays ?? org.defaultCreditDays;
        dueDate = addDays(today, creditDays);
      }
    }

    const number = await this.numbering.next(tx, ctx, 'INVOICE', org.timezone);
    const invoice = await tx.invoice.create({
      data: {
        ...(dto.id ? { id: dto.id } : {}),
        organizationId: ctx.organizationId,
        branchId: priced.branchId,
        number,
        quotationId: dto.quotationId ?? null,
        ...customer,
        salespersonId: ctx.memberId,
        currencyCode: org.currencyCode,
        subtotalMinor: priced.subtotalMinor,
        discountMinor: priced.discountMinor,
        taxRateId: priced.taxRate.id,
        taxName: priced.taxRate.name,
        taxRateBp: priced.taxRate.rateBp,
        taxMinor: priced.taxMinor,
        totalMinor: priced.totalMinor,
        costMinor: priced.costMinor,
        paidMinor: received,
        paymentStatus: paymentStatusOf(received, balance),
        creditDays,
        dueDate: dueDate ? toDbDate(dueDate) : null,
        notes: dto.notes ?? null,
        issuedAt: now,
        items: {
          create: priced.lines.map((l) => ({
            lineNo: l.lineNo,
            productId: l.productId,
            productName: l.productName,
            productSku: l.productSku,
            quantity: l.quantity,
            unitCostMinor: l.unitCostMinor,
            markupBp: l.markupBp,
            unitPriceMinor: l.unitPriceMinor,
            lineTotalMinor: l.lineTotalMinor,
            discountAllocMinor: l.discountAllocMinor,
            taxMinor: l.taxMinor,
          })),
        },
      },
    });

    // Take stock line by line, in product order so concurrent sales lock rows in the same sequence.
    // Each take is a conditional UPDATE: the last unit cannot be sold twice (rule S3).
    const shortages: { lineNo: number; productId: string; requested: number; available: number }[] = [];
    const ordered = [...priced.lines].sort((a, b) => (a.productId === b.productId ? a.lineNo - b.lineNo : a.productId < b.productId ? -1 : 1));
    for (const line of ordered) {
      try {
        await this.inventory.takeForSale(tx, ctx, {
          productId: line.productId,
          branchId: priced.branchId,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          invoiceId: invoice.id,
        });
      } catch (e) {
        if (!(e instanceof DomainError) || e.code !== 'INSUFFICIENT_STOCK') throw e;
        const available = (e.details?.[0] as { available?: number } | undefined)?.available ?? 0;
        shortages.push({ lineNo: line.lineNo, productId: line.productId, requested: line.quantity, available });
      }
    }
    if (shortages.length > 0) throw Errors.insufficientStock(shortages.sort((a, b) => a.lineNo - b.lineNo));

    if (dto.payment) {
      await tx.payment.create({
        data: {
          organizationId: ctx.organizationId,
          invoiceId: invoice.id,
          kind: 'PAYMENT',
          method: dto.payment.method,
          amountMinor: received,
          reference: dto.payment.reference ?? null,
          receivedAt: now,
          recordedById: ctx.memberId,
        },
      });
    }
    if (dto.quotationId) await tx.quotation.update({ where: { id: dto.quotationId }, data: { status: 'CONVERTED' } });

    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'invoice.issue',
      entityType: 'invoice',
      entityId: invoice.id,
      after: {
        number,
        customerId: dto.customerId,
        totalMinor: priced.totalMinor.toString(),
        receivedMinor: received.toString(),
        method: dto.payment?.method ?? null,
        dueDate,
        quotationId: dto.quotationId ?? null,
        belowMinimum: belowMinimum(priced.lines),
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return this.view(tx, ctx, invoice.id, today);
  }

  async get(ctx: RequestContext, id: string) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      return this.view(tx, ctx, id, await this.today(tx, ctx));
    });
  }

  /** The customer-facing PDF, with a version tag that changes whenever the invoice does. */
  async pdfOf(ctx: RequestContext, id: string): Promise<{ filename: string; etag: string; render: () => Promise<Buffer> }> {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      await this.requireVisible(tx, ctx, id);
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id }, include: INVOICE_INCLUDE });
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      const balance = balanceOf(invoice);
      const cancelled = invoice.status === 'CANCELLED';
      const printable: PrintableDocument = {
        kind: 'INVOICE',
        number: invoice.number,
        issuedAt: invoice.issuedAt,
        cancelled,
        seller: sellerOf(org),
        customer: {
          name: invoice.customerName,
          company: invoice.customerCompany,
          mobile: invoice.customerMobile,
          email: invoice.customerEmail,
          address: invoice.customerAddress,
          trn: invoice.customerTrn,
        },
        salesperson: invoice.salesperson.user.fullName,
        currencyCode: invoice.currencyCode,
        currencyExponent: org.currencyExponent,
        timezone: org.timezone,
        lines: invoice.items.map((i) => ({ name: i.productName, sku: i.productSku, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor })),
        subtotalMinor: invoice.subtotalMinor,
        discountMinor: invoice.discountMinor,
        taxName: invoice.taxName,
        taxMinor: invoice.taxMinor,
        totalMinor: invoice.totalMinor,
        notes: invoice.notes,
        settlement: {
          payments: invoice.payments.map((p) => ({ kind: p.kind, method: p.method, amountMinor: p.amountMinor, receivedAt: p.receivedAt, reference: p.reference })),
          returnedMinor: invoice.returnedMinor,
          paidMinor: invoice.paidMinor,
          balanceMinor: cancelled ? 0n : balance,
          dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null,
          statusLabel: cancelled ? 'Cancelled' : balance === 0n ? 'Paid in full' : invoice.paidMinor > 0n ? 'Partially paid' : 'Payment due',
        },
      };
      return {
        filename: `${invoice.number}.pdf`,
        etag: `"${invoice.id}-${invoice.updatedAt.getTime()}"`,
        render: () => this.pdf.render(printable),
      };
    });
  }

  /** Records money received against the balance (rules Y1–Y4). */
  async recordPayment(tx: Tx, ctx: RequestContext, id: string, dto: RecordPaymentDto) {
    const invoice = await this.lock(tx, ctx, id);
    const balance = balanceOf(invoice);
    if (balance === 0n) throw Errors.invoiceAlreadyPaid();
    const amount = BigInt(dto.amountMinor);
    if (amount > balance) throw Errors.paymentExceedsBalance(balance);
    const now = this.clock.now();
    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : now;
    if (receivedAt > now) throw Errors.validation('receivedAt', 'notInFuture');
    if (receivedAt < invoice.issuedAt) throw Errors.validation('receivedAt', 'notBeforeInvoice');
    if (dto.id && (await tx.payment.findFirst({ where: { id: dto.id }, select: { id: true } }))) {
      throw new DomainError('DOCUMENT_EXISTS', 409, 'A payment with this id already exists.');
    }

    const payment = await tx.payment.create({
      data: {
        ...(dto.id ? { id: dto.id } : {}),
        organizationId: ctx.organizationId,
        invoiceId: id,
        kind: 'PAYMENT',
        method: dto.method,
        amountMinor: amount,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
        receivedAt,
        recordedById: ctx.memberId,
      },
    });
    const paid = invoice.paidMinor + amount;
    await tx.invoice.update({ where: { id }, data: { paidMinor: paid, paymentStatus: paymentStatusOf(paid, balance - amount) } });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'payment.record',
      entityType: 'invoice',
      entityId: id,
      before: { paidMinor: invoice.paidMinor.toString(), balanceMinor: balance.toString() },
      after: { paymentId: payment.id, amountMinor: amount.toString(), method: dto.method, balanceMinor: (balance - amount).toString() },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return this.result(tx, ctx, id, payment.id);
  }

  /** Corrects a mis-recorded payment. Payments are never edited or deleted (rule Y1). */
  async recordRefund(tx: Tx, ctx: RequestContext, id: string, dto: RecordRefundDto) {
    const invoice = await this.lock(tx, ctx, id);
    const amount = BigInt(dto.amountMinor);
    if (amount > invoice.paidMinor) throw Errors.refundExceedsPaid(invoice.paidMinor);
    const payment = await this.refund(tx, ctx, id, amount, dto.method, dto.reference ?? null, dto.note, null);
    const paid = invoice.paidMinor - amount;
    await tx.invoice.update({
      where: { id },
      data: { paidMinor: paid, paymentStatus: paymentStatusOf(paid, invoice.totalMinor - invoice.returnedMinor - paid) },
    });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'payment.refund',
      entityType: 'invoice',
      entityId: id,
      before: { paidMinor: invoice.paidMinor.toString() },
      after: { paymentId: payment.id, amountMinor: amount.toString(), method: dto.method, note: dto.note },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return this.result(tx, ctx, id, payment.id);
  }

  /** Reverses the whole sale: money received is refunded and every item goes back to stock (rule C2). */
  async cancel(tx: Tx, ctx: RequestContext, id: string, dto: CancelInvoiceDto) {
    const invoice = await this.lock(tx, ctx, id);
    if ((await tx.salesReturn.count({ where: { invoiceId: id } })) > 0) throw Errors.invoiceHasReturns();
    if (invoice.paidMinor > 0n) {
      if (!dto.refundMethod) throw Errors.refundMethodRequired(invoice.paidMinor);
      await this.refund(tx, ctx, id, invoice.paidMinor, dto.refundMethod, dto.refundReference ?? null, `Invoice cancelled: ${dto.reason}`, null);
    }
    const items = await tx.invoiceItem.findMany({ where: { invoiceId: id }, orderBy: [{ productId: 'asc' }, { lineNo: 'asc' }] });
    for (const item of items) {
      await this.inventory.restoreFromSale(tx, ctx, {
        productId: item.productId,
        branchId: invoice.branchId,
        quantity: item.quantity,
        unitCostMinor: item.unitCostMinor,
        type: 'SALE_CANCELLATION',
        invoiceId: id,
      });
    }
    await tx.invoice.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: this.clock.now(),
        cancelledById: ctx.memberId,
        cancelReason: dto.reason,
        paidMinor: 0n,
        paymentStatus: 'UNPAID',
      },
    });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'invoice.cancel',
      entityType: 'invoice',
      entityId: id,
      before: { status: 'ISSUED', paidMinor: invoice.paidMinor.toString() },
      after: { status: 'CANCELLED', reason: dto.reason, refundedMinor: invoice.paidMinor.toString(), refundMethod: dto.refundMethod ?? null },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return this.view(tx, ctx, id, await this.today(tx, ctx));
  }

  /** Returns items against an invoice and issues a credit note (rules C3, C4, S8). */
  async createReturn(tx: Tx, ctx: RequestContext, id: string, dto: CreateReturnDto) {
    const invoice = await this.lock(tx, ctx, id);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
    const items = new Map((await tx.invoiceItem.findMany({ where: { invoiceId: id } })).map((i) => [i.lineNo, i]));
    const lineNos = dto.lines.map((l) => l.lineNo);
    if (new Set(lineNos).size !== lineNos.length) throw Errors.validation('lines', 'duplicateLine');

    const excess = dto.lines
      .map((l) => ({ lineNo: l.lineNo, requested: l.quantity, returnable: (items.get(l.lineNo)?.quantity ?? 0) - (items.get(l.lineNo)?.returnedQuantity ?? 0) }))
      .filter((l) => l.requested > l.returnable);
    if (excess.length > 0) throw Errors.returnQuantityExceedsSold(excess);

    // What earlier returns already credited per line, so the final units take exactly the remainder.
    const credited = new Map<string, { net: bigint; tax: bigint }>();
    for (const r of await tx.returnItem.findMany({ where: { salesReturn: { invoiceId: id } } })) {
      const c = credited.get(r.invoiceItemId) ?? { net: 0n, tax: 0n };
      credited.set(r.invoiceItemId, { net: c.net + r.amountMinor, tax: c.tax + r.taxMinor });
    }
    const lines = dto.lines.map((l) => {
      const item = items.get(l.lineNo) as NonNullable<ReturnType<typeof items.get>>;
      const lineNet = item.lineTotalMinor - item.discountAllocMinor;
      const before = credited.get(item.id) ?? { net: 0n, tax: 0n };
      const completes = item.returnedQuantity + l.quantity === item.quantity;
      const net = completes ? lineNet - before.net : divRoundHalfUp(lineNet * BigInt(l.quantity), BigInt(item.quantity));
      const tax = completes ? item.taxMinor - before.tax : divRoundHalfUp(item.taxMinor * BigInt(l.quantity), BigInt(item.quantity));
      return { item, quantity: l.quantity, restock: l.restock ?? true, net, tax };
    });
    const subtotal = lines.reduce((s, l) => s + l.net, 0n);
    const tax = lines.reduce((s, l) => s + l.tax, 0n);
    const total = subtotal + tax;

    // Money: the credit first reduces what is still owed; only the excess is refunded.
    const balanceAfter = balanceOf(invoice) - total;
    const refundMinor = balanceAfter < 0n ? -balanceAfter : 0n;
    if (refundMinor > 0n && !dto.refund) throw Errors.refundMethodRequired(refundMinor);

    const number = await this.numbering.next(tx, ctx, 'CREDIT_NOTE', org.timezone);
    const salesReturn = await tx.salesReturn.create({
      data: {
        organizationId: ctx.organizationId,
        invoiceId: id,
        number,
        reason: dto.reason,
        subtotalMinor: subtotal,
        taxMinor: tax,
        totalMinor: total,
        createdById: ctx.memberId,
        // The application clock, like every other business timestamp, so reports date the return consistently.
        createdAt: this.clock.now(),
        items: {
          create: lines.map((l) => ({ invoiceItemId: l.item.id, quantity: l.quantity, amountMinor: l.net, taxMinor: l.tax, restock: l.restock })),
        },
      },
    });
    for (const l of [...lines].sort((a, b) => (a.item.productId < b.item.productId ? -1 : a.item.productId > b.item.productId ? 1 : a.item.lineNo - b.item.lineNo))) {
      await tx.invoiceItem.update({ where: { id: l.item.id }, data: { returnedQuantity: { increment: l.quantity } } });
      if (l.restock) {
        await this.inventory.restoreFromSale(tx, ctx, {
          productId: l.item.productId,
          branchId: invoice.branchId,
          quantity: l.quantity,
          unitCostMinor: l.item.unitCostMinor,
          type: 'CUSTOMER_RETURN',
          returnId: salesReturn.id,
        });
      }
    }
    if (refundMinor > 0n && dto.refund) {
      await this.refund(tx, ctx, id, refundMinor, dto.refund.method, dto.refund.reference ?? null, `Refund for ${number}`, salesReturn.id);
    }
    const paid = invoice.paidMinor - refundMinor;
    const returned = invoice.returnedMinor + total;
    await tx.invoice.update({
      where: { id },
      data: { paidMinor: paid, returnedMinor: returned, paymentStatus: paymentStatusOf(paid, invoice.totalMinor - returned - paid) },
    });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'invoice.return',
      entityType: 'invoice',
      entityId: id,
      after: {
        returnId: salesReturn.id,
        number,
        reason: dto.reason,
        totalMinor: total.toString(),
        refundMinor: refundMinor.toString(),
        lines: lines.map((l) => ({ lineNo: l.item.lineNo, quantity: l.quantity, restock: l.restock })),
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    const view = await this.view(tx, ctx, id, localDate(this.clock.now(), org.timezone));
    return { return: view.returns.find((r) => r.id === salesReturn.id), invoice: view };
  }

  private refund(tx: Tx, ctx: RequestContext, invoiceId: string, amount: bigint, method: PaymentMethod, reference: string | null, note: string, returnId: string | null) {
    return tx.payment.create({
      data: {
        organizationId: ctx.organizationId,
        invoiceId,
        kind: 'REFUND',
        method,
        amountMinor: amount,
        reference,
        note,
        returnId,
        receivedAt: this.clock.now(),
        recordedById: ctx.memberId,
      },
    });
  }

  /** Locks the invoice row for the transaction and checks it can still be changed. */
  private async lock(tx: Tx, ctx: RequestContext, id: string) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
    const invoice = await this.requireVisible(tx, ctx, id);
    if (invoice.status === 'CANCELLED') throw Errors.invoiceCancelled();
    return invoice;
  }

  private async requireVisible(tx: Tx, ctx: RequestContext, id: string) {
    const invoice = await tx.invoice.findFirst({ where: { id, ...ownFilter(ctx) } });
    if (!invoice) throw Errors.notFound('Invoice');
    return invoice;
  }

  private async view(tx: Tx, ctx: RequestContext, id: string, today: string) {
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id }, include: INVOICE_INCLUDE });
    const cancelledBy = invoice.cancelledById
      ? await tx.organizationMember.findFirst({ where: { id: invoice.cancelledById }, include: { user: { select: { fullName: true } } } })
      : null;
    return invoiceView(invoice, ctx.role, today, cancelledBy?.user.fullName ?? null);
  }

  private async result(tx: Tx, ctx: RequestContext, id: string, paymentId: string) {
    const invoice = await this.view(tx, ctx, id, await this.today(tx, ctx));
    return { payment: invoice.payments.find((p) => p.id === paymentId), invoice };
  }

  private async today(tx: Tx, ctx: RequestContext): Promise<string> {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
    return localDate(this.clock.now(), org.timezone);
  }
}
