import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { isCalendarDate, localDate } from '../common/dates';
import { Errors } from '../common/errors';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, likePattern, takePage } from '../common/pagination';
import type { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { DocumentStatusFilter, ListDocumentsQuery } from './dto';

interface Row {
  type: 'INVOICE' | 'QUOTATION';
  id: string;
  number: string;
  issuedAt: Date;
  issuedUs: bigint;
  customerId: string;
  customerName: string | null;
  customerCompany: string | null;
  customerMobile: string | null;
  salespersonId: string;
  salespersonName: string;
  lineCount: number;
  totalMinor: bigint;
  status: string;
  paymentStatus: string | null;
  balanceMinor: bigint | null;
  dueDate: string | null;
  validUntil: string | null;
}

/** The reference's combined "Quotations & invoices" list, as one paginated query. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, query: ListDocumentsQuery) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    for (const [field, value] of [['from', query.from], ['to', query.to]] as const) {
      if (value !== undefined && !isCalendarDate(value)) throw Errors.validation(field, 'date');
    }
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { timezone: true } });
      const today = localDate(this.clock.now(), org.timezone);

      // Filters common to both document kinds, written against the alias `d`.
      const common: Prisma.Sql[] = [Prisma.sql`d.organization_id = ${ctx.organizationId}::uuid`];
      // The sales role sees only its own documents; a salesperson filter from it is ignored.
      const salesperson = ctx.role === 'SALES' ? ctx.memberId : query.salespersonId;
      if (salesperson) common.push(Prisma.sql`d.salesperson_id = ${salesperson}::uuid`);
      if (query.customerId) common.push(Prisma.sql`d.customer_id = ${query.customerId}::uuid`);
      if (query.q) {
        const pattern = likePattern(query.q);
        const conditions = [
          Prisma.sql`d.number ILIKE ${pattern}`,
          Prisma.sql`d.customer_name ILIKE ${pattern}`,
          Prisma.sql`d.customer_company ILIKE ${pattern}`,
        ];
        const digits = query.q.replace(/\D/g, '').replace(/^0+/, '');
        if (digits.length >= 3 && !/[a-z]/i.test(query.q)) conditions.push(Prisma.sql`d.customer_mobile LIKE ${`%${digits}%`}`);
        common.push(Prisma.sql`(${Prisma.join(conditions, ' OR ')})`);
      }
      const localDay = Prisma.sql`(d.issued_at AT TIME ZONE ${org.timezone})::date`;
      if (query.from) common.push(Prisma.sql`${localDay} >= ${query.from}::date`);
      if (query.to) common.push(Prisma.sql`${localDay} <= ${query.to}::date`);
      if (query.cursor) {
        const [us, id] = decodeCursor(query.cursor, 2);
        // Compared as a timestamp (exactly, microsecond by microsecond) so the (organization, issued_at) index serves it.
        common.push(Prisma.sql`(d.issued_at, d.id) < (timestamptz 'epoch' + ${String(us)}::bigint * interval '1 microsecond', ${String(id)}::uuid)`);
      }

      const statuses = new Set<DocumentStatusFilter>(query.status ?? []);
      const balance = Prisma.sql`(d.total_minor - d.returned_minor - d.paid_minor)`;
      const invoiceStatus: Record<string, Prisma.Sql> = {
        paid: Prisma.sql`(d.status = 'ISSUED' AND d.payment_status = 'PAID')`,
        partial: Prisma.sql`(d.status = 'ISSUED' AND d.payment_status = 'PARTIAL')`,
        unpaid: Prisma.sql`(d.status = 'ISSUED' AND d.payment_status = 'UNPAID')`,
        overdue: Prisma.sql`(d.status = 'ISSUED' AND ${balance} > 0 AND d.due_date < ${today}::date)`,
        cancelled: Prisma.sql`(d.status = 'CANCELLED')`,
      };
      const quotationStatus: Record<string, Prisma.Sql> = {
        quotation_open: Prisma.sql`(d.status = 'OPEN' AND (d.valid_until IS NULL OR d.valid_until >= ${today}::date))`,
        quotation_expired: Prisma.sql`(d.status = 'OPEN' AND d.valid_until < ${today}::date)`,
        quotation_converted: Prisma.sql`(d.status = 'CONVERTED')`,
        quotation_cancelled: Prisma.sql`(d.status = 'CANCELLED')`,
      };
      const chosen = (map: Record<string, Prisma.Sql>) => Object.entries(map).filter(([k]) => statuses.has(k as DocumentStatusFilter)).map(([, v]) => v);
      const invoiceChosen = chosen(invoiceStatus);
      const quotationChosen = chosen(quotationStatus);
      // A status filter that names only one kind of document excludes the other kind entirely.
      const wantInvoices = query.type !== 'quotation' && (statuses.size === 0 || invoiceChosen.length > 0);
      const wantQuotations = query.type !== 'invoice' && (statuses.size === 0 || quotationChosen.length > 0);

      const where = (extra: Prisma.Sql[]) => Prisma.join([...common, ...(extra.length ? [Prisma.sql`(${Prisma.join(extra, ' OR ')})`] : [])], ' AND ');
      // Each kind takes only its newest page straight from the (organization, issued_at) index; the
      // two short lists are then merged. Sorting all documents first made this list slow at volume.
      const newestFirst = Prisma.sql`ORDER BY d.issued_at DESC, d.id DESC LIMIT ${limit + 1}`;
      const parts: Prisma.Sql[] = [];
      if (wantInvoices) {
        parts.push(Prisma.sql`
          (SELECT 'INVOICE' AS type, d.id, d.number, d.issued_at AS "issuedAt", ${ISSUED_US} AS "issuedUs",
                 d.customer_id AS "customerId", d.customer_name AS "customerName", d.customer_company AS "customerCompany",
                 d.customer_mobile AS "customerMobile", d.salesperson_id AS "salespersonId",
                 d.total_minor AS "totalMinor", d.status::text AS status, d.payment_status::text AS "paymentStatus",
                 ${balance} AS "balanceMinor", to_char(d.due_date, 'YYYY-MM-DD') AS "dueDate", NULL::text AS "validUntil"
          FROM invoices d WHERE ${where(invoiceChosen)} ${newestFirst})`);
      }
      if (wantQuotations) {
        parts.push(Prisma.sql`
          (SELECT 'QUOTATION' AS type, d.id, d.number, d.issued_at AS "issuedAt", ${ISSUED_US} AS "issuedUs",
                 d.customer_id AS "customerId", d.customer_name AS "customerName", d.customer_company AS "customerCompany",
                 d.customer_mobile AS "customerMobile", d.salesperson_id AS "salespersonId",
                 d.total_minor AS "totalMinor", d.status::text AS status, NULL::text AS "paymentStatus",
                 NULL::bigint AS "balanceMinor", NULL::text AS "dueDate", to_char(d.valid_until, 'YYYY-MM-DD') AS "validUntil"
          FROM quotations d WHERE ${where(quotationChosen)} ${newestFirst})`);
      }
      if (parts.length === 0) return { items: [], meta: { nextCursor: null, hasMore: false } };

      const rows = await tx.$queryRaw<Row[]>`
        SELECT u.*, usr.full_name AS "salespersonName",
               CASE u.type WHEN 'INVOICE' THEN (SELECT count(*)::int FROM invoice_items x WHERE x.invoice_id = u.id)
                           ELSE (SELECT count(*)::int FROM quotation_items x WHERE x.quotation_id = u.id) END AS "lineCount"
        FROM (${Prisma.join(parts, ' UNION ALL ')}) u
        JOIN organization_members om ON om.id = u."salespersonId"
        JOIN users usr ON usr.id = om.user_id
        ORDER BY u."issuedUs" DESC, u.id DESC
        LIMIT ${limit + 1}`;
      const { items, hasMore } = takePage(rows, limit);
      const last = items[items.length - 1];
      return {
        items: items.map((r) => view(r, today)),
        meta: { nextCursor: hasMore && last ? encodeCursor([last.issuedUs.toString(), last.id]) : null, hasMore },
      };
    });
  }
}

const ISSUED_US = Prisma.sql`(extract(epoch FROM d.issued_at) * 1000000)::bigint`;

function view(r: Row, today: string) {
  const base = {
    type: r.type,
    id: r.id,
    number: r.number,
    issuedAt: r.issuedAt,
    customer: { id: r.customerId, name: r.customerName, company: r.customerCompany, mobile: r.customerMobile },
    salesperson: { memberId: r.salespersonId, fullName: r.salespersonName },
    lineCount: r.lineCount,
    totalMinor: r.totalMinor,
  };
  if (r.type === 'QUOTATION') {
    const expired = r.status === 'OPEN' && r.validUntil !== null && r.validUntil < today;
    return { ...base, quotationStatus: expired ? 'EXPIRED' : r.status, validUntil: r.validUntil };
  }
  const balanceMinor = r.balanceMinor ?? 0n;
  return {
    ...base,
    status: r.status,
    paymentStatus: r.paymentStatus,
    balanceMinor,
    dueDate: r.dueDate,
    isOverdue: r.status === 'ISSUED' && balanceMinor > 0n && r.dueDate !== null && r.dueDate < today,
  };
}
