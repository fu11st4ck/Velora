import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { addDays, isCalendarDate, localDate, toDbDate } from '../common/dates';
import { DomainError, Errors } from '../common/errors';
import type { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { CreateQuotationDto } from './dto';
import { NumberingService } from './numbering.service';
import { PdfService, sellerOf } from './pdf.service';
import { PricingService } from './pricing.service';
import { QUOTATION_INCLUDE, quotationStatusOf, quotationView } from './views';

/** Loads the customer a document is for, refusing archived ones. Returns the snapshot columns. */
export async function customerSnapshotFor(tx: Tx, customerId: string) {
  const customer = await tx.customer.findFirst({ where: { id: customerId } });
  if (!customer) throw Errors.notFound('Customer');
  if (customer.archivedAt) throw Errors.customerArchived();
  return {
    customerId: customer.id,
    customerName: customer.name,
    customerCompany: customer.company,
    customerMobile: customer.mobile,
    customerEmail: customer.email,
    customerAddress: customer.address,
    customerTrn: customer.taxRegistrationNumber,
  };
}

/** The sales role sees only its own documents (business rule D5); others' answer 404. */
export function ownFilter(ctx: RequestContext): { salespersonId?: string } {
  return ctx.role === 'SALES' ? { salespersonId: ctx.memberId } : {};
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly pdf: PdfService,
  ) {}

  /** A quotation fixes prices for a customer. It does not check, reserve or change stock (rule D4). */
  async create(tx: Tx, ctx: RequestContext, dto: CreateQuotationDto) {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const today = localDate(this.clock.now(), org.timezone);
    const validUntil = dto.validUntil ?? addDays(today, org.quotationValidityDays);
    if (!isCalendarDate(validUntil) || validUntil < today) throw Errors.validation('validUntil', 'notInPast');
    if (dto.id && (await tx.quotation.findFirst({ where: { id: dto.id }, select: { id: true } }))) {
      throw new DomainError('DOCUMENT_EXISTS', 409, 'A quotation with this id already exists.');
    }

    const customer = await customerSnapshotFor(tx, dto.customerId);
    const priced = await this.pricing.price(tx, ctx, dto, { checkStock: false });
    this.pricing.assertValid(priced);
    const number = await this.numbering.next(tx, ctx, 'QUOTATION', org.timezone);

    const quotation = await tx.quotation.create({
      data: {
        ...(dto.id ? { id: dto.id } : {}),
        organizationId: ctx.organizationId,
        branchId: priced.branchId,
        number,
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
        validUntil: toDbDate(validUntil),
        notes: dto.notes ?? null,
        issuedAt: this.clock.now(),
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
          })),
        },
      },
      include: QUOTATION_INCLUDE,
    });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'quotation.create',
      entityType: 'quotation',
      entityId: quotation.id,
      after: { number, totalMinor: priced.totalMinor.toString(), customerId: dto.customerId, belowMinimum: belowMinimum(priced.lines) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return quotationView(quotation, ctx.role, today);
  }

  async get(ctx: RequestContext, id: string) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const quotation = await tx.quotation.findFirst({ where: { id, ...ownFilter(ctx) }, include: QUOTATION_INCLUDE });
      if (!quotation) throw Errors.notFound('Quotation');
      return quotationView(quotation, ctx.role, await this.today(tx, ctx));
    });
  }

  async pdfOf(ctx: RequestContext, id: string): Promise<{ filename: string; etag: string; render: () => Promise<Buffer> }> {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const q = await tx.quotation.findFirst({ where: { id, ...ownFilter(ctx) }, include: QUOTATION_INCLUDE });
      if (!q) throw Errors.notFound('Quotation');
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      return {
        filename: `${q.number}.pdf`,
        etag: `"${q.id}-${q.updatedAt.getTime()}"`,
        render: () =>
          this.pdf.render({
            kind: 'QUOTATION',
            number: q.number,
            issuedAt: q.issuedAt,
            cancelled: q.status === 'CANCELLED',
            seller: sellerOf(org),
            customer: { name: q.customerName, company: q.customerCompany, mobile: q.customerMobile, email: q.customerEmail, address: q.customerAddress, trn: q.customerTrn },
            salesperson: q.salesperson.user.fullName,
            currencyCode: q.currencyCode,
            currencyExponent: org.currencyExponent,
            timezone: org.timezone,
            lines: q.items.map((i) => ({ name: i.productName, sku: i.productSku, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor })),
            subtotalMinor: q.subtotalMinor,
            discountMinor: q.discountMinor,
            taxName: q.taxName,
            taxMinor: q.taxMinor,
            totalMinor: q.totalMinor,
            notes: q.notes,
            validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : null,
          }),
      };
    });
  }

  async cancel(ctx: RequestContext, id: string, reason: string | null) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const today = await this.today(tx, ctx);
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM quotations WHERE id = ${id}::uuid FOR UPDATE`;
      const current = rows[0] ? await tx.quotation.findFirst({ where: { id, ...ownFilter(ctx) } }) : null;
      if (!current) throw Errors.notFound('Quotation');
      if (current.status !== 'OPEN') {
        throw Errors.invalidState(quotationStatusOf(current, today), 'Only an open quotation can be cancelled.');
      }
      const quotation = await tx.quotation.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: this.clock.now() },
        include: QUOTATION_INCLUDE,
      });
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'quotation.cancel',
        entityType: 'quotation',
        entityId: id,
        after: { reason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
      return quotationView(quotation, ctx.role, today);
    });
  }

  private async today(tx: Tx, ctx: RequestContext): Promise<string> {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
    return localDate(this.clock.now(), org.timezone);
  }
}

/** Lines sold under the lowest price with a manager's reason — recorded in the audit entry (rule P5). */
export function belowMinimum(lines: { lineNo: number; belowMinimumReason: string | null; unitPriceMinor: bigint }[]) {
  return lines
    .filter((l) => l.belowMinimumReason !== null)
    .map((l) => ({ lineNo: l.lineNo, unitPriceMinor: l.unitPriceMinor.toString(), reason: l.belowMinimumReason }));
}
