import { Injectable } from '@nestjs/common';
import { Prisma, type Customer } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { DomainError, Errors } from '../common/errors';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, likePattern, takePage } from '../common/pagination';
import type { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { CreateCustomerDto, CustomerFieldsDto, CustomerSort, ListCustomersQuery } from './dto';
import { requireE164, toE164 } from './phone';

interface ListRow extends Customer {
  createdUs: bigint;
  sortName: string;
}

const COLUMNS = Prisma.sql`
  c.id, c.organization_id AS "organizationId", c.name, c.company, c.mobile, c.email, c.address,
  c.tax_registration_number AS "taxRegistrationNumber", c.notes, c.archived_at AS "archivedAt",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;
/** Customers sort by the name shown in lists: the person's name, else the company. */
const SORT_NAME = Prisma.sql`lower(COALESCE(c.name, c.company))`;
const CREATED_US = Prisma.sql`(extract(epoch FROM c.created_at) * 1000000)::bigint`;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, query: ListCustomersQuery) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sort: CustomerSort = query.sort ?? 'name';
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const where: Prisma.Sql[] = [
        Prisma.sql`c.organization_id = ${ctx.organizationId}::uuid`,
        Prisma.sql`c.archived_at IS NULL`,
      ];
      if (query.q) {
        const pattern = likePattern(query.q);
        const conditions = [
          Prisma.sql`c.name ILIKE ${pattern}`,
          Prisma.sql`c.company ILIKE ${pattern}`,
          Prisma.sql`c.email ILIKE ${pattern}`,
        ];
        // Phone search ignores spaces and punctuation: "050 555" finds +971505550184.
        const digits = query.q.replace(/\D/g, '').replace(/^0+/, '');
        if (digits.length >= 3) conditions.push(Prisma.sql`c.mobile LIKE ${`%${digits}%`}`);
        where.push(Prisma.sql`(${Prisma.join(conditions, ' OR ')})`);
      }
      if (query.mobile) {
        const number = toE164(query.mobile, await this.country(tx, ctx));
        // An unparseable number cannot match any stored (normalized) number.
        where.push(number ? Prisma.sql`c.mobile = ${number}` : Prisma.sql`false`);
      }
      if (query.cursor) {
        const [value, id] = decodeCursor(query.cursor, 2);
        where.push(
          sort === 'name'
            ? Prisma.sql`(${SORT_NAME}, c.id) > (${String(value)}, ${String(id)}::uuid)`
            : Prisma.sql`(${CREATED_US}, c.id) < (${String(value)}::bigint, ${String(id)}::uuid)`,
        );
      }
      const order = sort === 'name' ? Prisma.sql`${SORT_NAME} ASC, c.id ASC` : Prisma.sql`${CREATED_US} DESC, c.id DESC`;
      const rows = await tx.$queryRaw<ListRow[]>`
        SELECT ${COLUMNS}, ${CREATED_US} AS "createdUs", ${SORT_NAME} AS "sortName"
        FROM customers c
        WHERE ${Prisma.join(where, ' AND ')}
        ORDER BY ${order}
        LIMIT ${limit + 1}`;
      const { items, hasMore } = takePage(rows, limit);
      const last = items[items.length - 1];
      return {
        items: items.map(customerView),
        meta: {
          nextCursor:
            hasMore && last ? encodeCursor([sort === 'name' ? last.sortName : last.createdUs.toString(), last.id]) : null,
          hasMore,
        },
      };
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id } });
      if (!customer) throw Errors.notFound('Customer');
      return { ...customerView(customer), summary: await this.summary(tx, ctx, id) };
    });
  }

  async create(tx: Tx, ctx: RequestContext, dto: CreateCustomerDto) {
    assertIdentity(dto.name ?? null, dto.company ?? null);
    const mobile = dto.mobile ? requireE164(dto.mobile, await this.country(tx, ctx)) : null;
    if (dto.id && (await tx.customer.findFirst({ where: { id: dto.id }, select: { id: true } }))) {
      throw new DomainError('CUSTOMER_EXISTS', 409, 'A customer with this id already exists.');
    }
    const customer = await tx.customer.create({
      data: {
        ...(dto.id ? { id: dto.id } : {}),
        organizationId: ctx.organizationId,
        name: dto.name ?? null,
        company: dto.company ?? null,
        mobile,
        email: dto.email ?? null,
        address: dto.address ?? null,
        taxRegistrationNumber: dto.taxRegistrationNumber ?? null,
        notes: dto.notes ?? null,
      },
    });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'customer.create',
      entityType: 'customer',
      entityId: customer.id,
      after: snapshot(customer),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return customerView(customer);
  }

  /** Edits the directory entry. Issued documents keep the details they were issued with (rule D2). */
  async update(ctx: RequestContext, id: string, dto: CustomerFieldsDto) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const current = await tx.customer.findFirst({ where: { id } });
      if (!current) throw Errors.notFound('Customer');
      if (current.archivedAt) throw Errors.invalidState('ARCHIVED', 'An archived customer cannot be edited.');

      const pick = <K extends keyof CustomerFieldsDto>(key: K): string | null =>
        dto[key] === undefined ? current[key] : (dto[key] ?? null);
      const mobileInput = pick('mobile');
      const next = {
        name: pick('name'),
        company: pick('company'),
        mobile:
          dto.mobile === undefined || mobileInput === null
            ? mobileInput
            : requireE164(mobileInput, await this.country(tx, ctx)),
        email: pick('email'),
        address: pick('address'),
        taxRegistrationNumber: pick('taxRegistrationNumber'),
        notes: pick('notes'),
      };
      assertIdentity(next.name, next.company);

      const customer = await tx.customer.update({ where: { id }, data: next });
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'customer.update',
        entityType: 'customer',
        entityId: id,
        before: snapshot(current),
        after: snapshot(customer),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
      return customerView(customer);
    });
  }

  /** Archives (never deletes): hidden from lists, still present on past documents. Idempotent. */
  async archive(ctx: RequestContext, id: string): Promise<void> {
    await this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const current = await tx.customer.findFirst({ where: { id } });
      if (!current) throw Errors.notFound('Customer');
      if (current.archivedAt) return;
      await tx.customer.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'customer.archive',
        entityType: 'customer',
        entityId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
    });
  }

  /**
   * Totals over issued (not cancelled) invoices. The sales role sees figures for its own
   * invoices only (rule D5). "Overdue" is evaluated on today's date in the organization timezone.
   */
  private async summary(tx: Tx, ctx: RequestContext, customerId: string) {
    const own = ctx.role === 'SALES' ? Prisma.sql`AND i.salesperson_id = ${ctx.memberId}::uuid` : Prisma.empty;
    const [row] = await tx.$queryRaw<
      { invoiced: bigint; outstanding: bigint; overdue: bigint; count: number; last: Date | null }[]
    >`
      SELECT COALESCE(SUM(i.total_minor), 0)::bigint AS invoiced,
             COALESCE(SUM(i.total_minor - i.returned_minor - i.paid_minor), 0)::bigint AS outstanding,
             COALESCE(SUM(i.total_minor - i.returned_minor - i.paid_minor)
               FILTER (WHERE i.due_date < (now() AT TIME ZONE o.timezone)::date), 0)::bigint AS overdue,
             count(*)::int AS count,
             max(i.issued_at) AS last
      FROM invoices i JOIN organizations o ON o.id = i.organization_id
      WHERE i.customer_id = ${customerId}::uuid AND i.status = 'ISSUED' ${own}`;
    return {
      invoicedMinor: row?.invoiced ?? 0n,
      outstandingMinor: row?.outstanding ?? 0n,
      overdueMinor: row?.overdue ?? 0n,
      invoiceCount: row?.count ?? 0,
      lastInvoiceAt: row?.last ?? null,
    };
  }

  private async country(tx: Tx, ctx: RequestContext): Promise<string | null> {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { countryCode: true } });
    return org.countryCode;
  }
}

/** A customer needs a person's name or a company (the reference's rule, also a database CHECK). */
function assertIdentity(name: string | null, company: string | null): void {
  if (!name && !company) throw Errors.validation('name', 'nameOrCompanyRequired');
}

export function customerView(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    company: c.company,
    mobile: c.mobile,
    email: c.email,
    address: c.address,
    taxRegistrationNumber: c.taxRegistrationNumber,
    notes: c.notes,
    archivedAt: c.archivedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function snapshot(c: Customer): Prisma.InputJsonValue {
  return {
    name: c.name,
    company: c.company,
    mobile: c.mobile,
    email: c.email,
    address: c.address,
    taxRegistrationNumber: c.taxRegistrationNumber,
  };
}
