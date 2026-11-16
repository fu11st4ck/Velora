import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canSeeCost } from '../authz/permissions';
import { Clock } from '../common/clock';
import { addDays, isCalendarDate, localDate } from '../common/dates';
import { Errors } from '../common/errors';
import { divRoundHalfUp } from '../common/money';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, takePage } from '../common/pagination';
import type { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { DocumentsService } from '../sales/documents.service';
import { minorToDecimal, toCsv } from './csv';
import type { ValuationQuery } from './dto';

const MAX_PERIOD_DAYS = 366;

interface Period {
  from: string;
  to: string;
}

/** Figures for one salesperson over a period. Definitions: docs/business-rules.md §8. */
interface Figures {
  invoiceCount: number;
  invoicedMinor: bigint;
  netSalesMinor: bigint;
  taxMinor: bigint;
  discountMinor: bigint;
  returnsMinor: bigint;
  cogsMinor: bigint;
  receivedMinor: bigint;
}

const ZERO: Figures = {
  invoiceCount: 0,
  invoicedMinor: 0n,
  netSalesMinor: 0n,
  taxMinor: 0n,
  discountMinor: 0n,
  returnsMinor: 0n,
  cogsMinor: 0n,
  receivedMinor: 0n,
};

function add(a: Figures, b: Figures): Figures {
  return {
    invoiceCount: a.invoiceCount + b.invoiceCount,
    invoicedMinor: a.invoicedMinor + b.invoicedMinor,
    netSalesMinor: a.netSalesMinor + b.netSalesMinor,
    taxMinor: a.taxMinor + b.taxMinor,
    discountMinor: a.discountMinor + b.discountMinor,
    returnsMinor: a.returnsMinor + b.returnsMinor,
    cogsMinor: a.cogsMinor + b.cogsMinor,
    receivedMinor: a.receivedMinor + b.receivedMinor,
  };
}

/** part / whole in basis points, rounded half away from zero; the part may be negative (a loss, a fall in sales). */
function ratioBp(part: bigint, whole: bigint): number {
  const magnitude = Number(divRoundHalfUp((part < 0n ? -part : part) * 10_000n, whole));
  return part < 0n ? -magnitude : magnitude;
}

/** Gross margin in basis points of net sales; null when there are no net sales to divide by. */
function marginBp(grossProfitMinor: bigint, netSalesMinor: bigint): number | null {
  return netSalesMinor > 0n ? ratioBp(grossProfitMinor, netSalesMinor) : null;
}

export function assertPeriod(period: Period): void {
  if (!isCalendarDate(period.from)) throw Errors.validation('from', 'date');
  if (!isCalendarDate(period.to)) throw Errors.validation('to', 'date');
  if (period.from > period.to) throw Errors.validation('to', 'before_from');
  if (addDays(period.from, MAX_PERIOD_DAYS) < period.to) throw Errors.validation('to', 'period_too_long');
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly clock: Clock,
  ) {}

  // ───────── Dashboard ─────────

  async dashboard(ctx: RequestContext) {
    const now = this.clock.now();
    const manager = canSeeCost(ctx.role);
    const scope = ctx.role === 'SALES' ? ctx.memberId : undefined;

    const body = await this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await this.org(tx, ctx);
      const today = localDate(now, org.timezone);
      const yesterday = addDays(today, -1);

      const days = await tx.$queryRaw<{ day: string; invoicedMinor: bigint; invoiceCount: number }[]>`
        SELECT to_char((d.issued_at AT TIME ZONE ${org.timezone})::date, 'YYYY-MM-DD') AS day,
               COALESCE(sum(d.total_minor), 0)::bigint AS "invoicedMinor", count(*)::int AS "invoiceCount"
        FROM invoices d
        WHERE d.organization_id = ${ctx.organizationId}::uuid AND d.status = 'ISSUED'
          AND (d.issued_at AT TIME ZONE ${org.timezone})::date BETWEEN ${yesterday}::date AND ${today}::date
          ${scope ? Prisma.sql`AND d.salesperson_id = ${scope}::uuid` : Prisma.empty}
        GROUP BY 1`;
      const todayRow = days.find((d) => d.day === today);
      const yesterdayMinor = days.find((d) => d.day === yesterday)?.invoicedMinor ?? 0n;
      const todayMinor = todayRow?.invoicedMinor ?? 0n;

      const eff = Prisma.sql`COALESCE(p.reorder_level, ${org.lowStockThreshold})`;
      const stockFrom = Prisma.sql`
        FROM products p
        LEFT JOIN (SELECT product_id, sum(quantity)::int AS qty FROM stock_levels GROUP BY product_id) s ON s.product_id = p.id
        WHERE p.organization_id = ${ctx.organizationId}::uuid AND p.archived_at IS NULL`;
      const [stock] = await tx.$queryRaw<{ units: number; productCount: number; lowCount: number; outCount: number; valueMinor: bigint }[]>`
        SELECT COALESCE(sum(COALESCE(s.qty, 0)), 0)::int AS units, count(*)::int AS "productCount",
               count(*) FILTER (WHERE COALESCE(s.qty, 0) > 0 AND COALESCE(s.qty, 0) <= ${eff})::int AS "lowCount",
               count(*) FILTER (WHERE COALESCE(s.qty, 0) = 0)::int AS "outCount",
               COALESCE(sum(COALESCE(s.qty, 0) * p.cost_minor), 0)::bigint AS "valueMinor"
        ${stockFrom}`;
      const attentionProducts = await tx.$queryRaw<{ id: string; name: string; sku: string; quantity: number; stockStatus: string }[]>`
        SELECT p.id, p.name, p.sku, COALESCE(s.qty, 0) AS quantity,
               CASE WHEN COALESCE(s.qty, 0) = 0 THEN 'OUT' ELSE 'LOW' END AS "stockStatus"
        ${stockFrom} AND COALESCE(s.qty, 0) <= ${eff}
        ORDER BY COALESCE(s.qty, 0), p.name, p.id
        LIMIT 5`;

      const outstanding = await this.outstanding(tx, ctx, today, scope);
      const month = manager ? await this.figures(tx, ctx, org.timezone, { from: `${today.slice(0, 8)}01`, to: today }) : null;
      const monthTotal = month ? [...month.values()].reduce(add, ZERO) : null;

      return {
        asOf: now,
        currencyCode: org.currencyCode,
        todaySales: {
          invoicedMinor: todayMinor,
          invoiceCount: todayRow?.invoiceCount ?? 0,
          yesterdayInvoicedMinor: yesterdayMinor,
          changeBp: yesterdayMinor > 0n ? ratioBp(todayMinor - yesterdayMinor, yesterdayMinor) : null,
        },
        stock: { units: stock!.units, productCount: stock!.productCount, lowCount: stock!.lowCount, outCount: stock!.outCount },
        outstanding,
        ...(monthTotal
          ? {
              monthProfit: {
                netSalesMinor: monthTotal.netSalesMinor,
                grossProfitMinor: monthTotal.netSalesMinor - monthTotal.cogsMinor,
                marginBp: marginBp(monthTotal.netSalesMinor - monthTotal.cogsMinor, monthTotal.netSalesMinor),
              },
              inventoryValueMinor: stock!.valueMinor,
            }
          : {}),
        attentionProducts,
      };
    });
    const recent = await this.documents.list(ctx, { limit: 5 });
    return { ...body, recentDocuments: recent.items };
  }

  // ───────── Reports ─────────

  async salesSummary(ctx: RequestContext, period: Period, salespersonId?: string) {
    assertPeriod(period);
    const scope = ctx.role === 'SALES' ? ctx.memberId : salespersonId;
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await this.org(tx, ctx);
      const total = [...(await this.figures(tx, ctx, org.timezone, period, scope)).values()].reduce(add, ZERO);
      const now = await this.outstanding(tx, ctx, localDate(this.clock.now(), org.timezone), scope);
      const { cogsMinor, ...open } = total;
      return {
        from: period.from,
        to: period.to,
        ...open,
        ...(canSeeCost(ctx.role)
          ? { cogsMinor, grossProfitMinor: total.netSalesMinor - cogsMinor, marginBp: marginBp(total.netSalesMinor - cogsMinor, total.netSalesMinor) }
          : {}),
        outstandingNowMinor: now.balanceMinor,
        overdueNowMinor: now.overdueMinor,
      };
    });
  }

  async salesBySalesperson(ctx: RequestContext, period: Period) {
    assertPeriod(period);
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await this.org(tx, ctx);
      const figures = await this.figures(tx, ctx, org.timezone, period);
      if (figures.size === 0) return [];
      const members = await tx.organizationMember.findMany({
        where: { id: { in: [...figures.keys()] } },
        select: { id: true, user: { select: { fullName: true } } },
      });
      const names = new Map(members.map((m) => [m.id, m.user.fullName]));
      return [...figures.entries()]
        .map(([memberId, f]) => ({
          memberId,
          fullName: names.get(memberId) ?? '',
          invoiceCount: f.invoiceCount,
          invoicedMinor: f.invoicedMinor,
          netSalesMinor: f.netSalesMinor,
          grossProfitMinor: f.netSalesMinor - f.cogsMinor,
        }))
        .sort((a, b) => (b.netSalesMinor > a.netSalesMinor ? 1 : b.netSalesMinor < a.netSalesMinor ? -1 : a.fullName.localeCompare(b.fullName)));
    });
  }

  async paymentStatus(ctx: RequestContext, period: Period) {
    assertPeriod(period);
    const scope = ctx.role === 'SALES' ? ctx.memberId : undefined;
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await this.org(tx, ctx);
      const today = localDate(this.clock.now(), org.timezone);
      const balance = Prisma.sql`(d.total_minor - d.returned_minor - d.paid_minor)`;
      const rows = await tx.$queryRaw<{ status: string; count: number; totalMinor: bigint; balanceMinor: bigint; overdue: boolean }[]>`
        SELECT d.payment_status::text AS status, (${balance} > 0 AND d.due_date < ${today}::date) AS overdue,
               count(*)::int AS count, COALESCE(sum(d.total_minor), 0)::bigint AS "totalMinor",
               COALESCE(sum(${balance}), 0)::bigint AS "balanceMinor"
        FROM invoices d
        WHERE d.organization_id = ${ctx.organizationId}::uuid AND d.status = 'ISSUED'
          AND (d.issued_at AT TIME ZONE ${org.timezone})::date BETWEEN ${period.from}::date AND ${period.to}::date
          ${scope ? Prisma.sql`AND d.salesperson_id = ${scope}::uuid` : Prisma.empty}
        GROUP BY 1, 2`;
      const sum = (pick: (r: (typeof rows)[number]) => boolean, status: string) => {
        const chosen = rows.filter(pick);
        return {
          status,
          count: chosen.reduce((n, r) => n + r.count, 0),
          totalMinor: chosen.reduce((n, r) => n + r.totalMinor, 0n),
          balanceMinor: chosen.reduce((n, r) => n + r.balanceMinor, 0n),
        };
      };
      // OVERDUE is a subset of PARTIAL and UNPAID, reported separately.
      return [
        sum((r) => r.status === 'PAID', 'PAID'),
        sum((r) => r.status === 'PARTIAL', 'PARTIAL'),
        sum((r) => r.status === 'UNPAID', 'UNPAID'),
        sum((r) => r.overdue, 'OVERDUE'),
      ];
    });
  }

  async inventoryValuation(ctx: RequestContext, query: ValuationQuery) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const byName = query.sort === 'name';
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const rows = await this.valuationRows(tx, ctx, { byName, cursor: query.cursor, limit: limit + 1 });
      const [summary] = await tx.$queryRaw<{ units: number; valueMinor: bigint; productCount: number }[]>`
        SELECT COALESCE(sum(v.quantity), 0)::int AS units, COALESCE(sum(v.quantity * v.cost_minor), 0)::bigint AS "valueMinor",
               count(*)::int AS "productCount"
        FROM (${VALUATION(ctx.organizationId)}) v`;
      const { items, hasMore } = takePage(rows, limit);
      const last = items[items.length - 1];
      return {
        items,
        meta: {
          summary: summary!,
          nextCursor: hasMore && last ? encodeCursor(byName ? [last.name, last.productId] : [last.valueMinor.toString(), last.productId]) : null,
          hasMore,
        },
      };
    });
  }

  // ───────── CSV exports (managers) ─────────

  async salesCsv(ctx: RequestContext, period: Period, salespersonId?: string): Promise<{ filename: string; body: Buffer }> {
    assertPeriod(period);
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await this.org(tx, ctx);
      const rows = await tx.$queryRaw<
        {
          number: string; day: string; customerName: string | null; customerCompany: string | null; salesperson: string;
          subtotalMinor: bigint; discountMinor: bigint; taxMinor: bigint; totalMinor: bigint; returnedMinor: bigint;
          paidMinor: bigint; costMinor: bigint; paymentStatus: string;
        }[]
      >`
        SELECT d.number, to_char((d.issued_at AT TIME ZONE ${org.timezone})::date, 'YYYY-MM-DD') AS day,
               d.customer_name AS "customerName", d.customer_company AS "customerCompany", u.full_name AS salesperson,
               d.subtotal_minor AS "subtotalMinor", d.discount_minor AS "discountMinor", d.tax_minor AS "taxMinor",
               d.total_minor AS "totalMinor", d.returned_minor AS "returnedMinor", d.paid_minor AS "paidMinor",
               d.cost_minor AS "costMinor", d.payment_status::text AS "paymentStatus"
        FROM invoices d
        JOIN organization_members om ON om.id = d.salesperson_id
        JOIN users u ON u.id = om.user_id
        WHERE d.organization_id = ${ctx.organizationId}::uuid AND d.status = 'ISSUED'
          AND (d.issued_at AT TIME ZONE ${org.timezone})::date BETWEEN ${period.from}::date AND ${period.to}::date
          ${salespersonId ? Prisma.sql`AND d.salesperson_id = ${salespersonId}::uuid` : Prisma.empty}
        ORDER BY d.issued_at, d.id`;
      const m = (v: bigint) => minorToDecimal(v, org.currencyExponent);
      return {
        filename: `velora-sales-${period.from}-to-${period.to}.csv`,
        body: toCsv(
          ['Invoice', 'Date', 'Customer', 'Company', 'Salesperson', 'Currency', 'Subtotal', 'Discount', 'Tax', 'Total', 'Returned', 'Paid', 'Balance', 'Payment status', 'Cost of goods'],
          rows.map((r) => [
            r.number, r.day, r.customerName, r.customerCompany, r.salesperson, org.currencyCode,
            m(r.subtotalMinor), m(r.discountMinor), m(r.taxMinor), m(r.totalMinor), m(r.returnedMinor), m(r.paidMinor),
            m(r.totalMinor - r.returnedMinor - r.paidMinor), r.paymentStatus, m(r.costMinor),
          ]),
        ),
      };
    });
  }

  async valuationCsv(ctx: RequestContext): Promise<{ filename: string; body: Buffer }> {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await this.org(tx, ctx);
      const rows = await this.valuationRows(tx, ctx, { byName: true });
      const m = (v: bigint) => minorToDecimal(v, org.currencyExponent);
      return {
        filename: `velora-inventory-${localDate(this.clock.now(), org.timezone)}.csv`,
        body: toCsv(
          ['SKU', 'Product', 'Quantity', 'Currency', 'Unit cost', 'Value'],
          rows.map((r) => [r.sku, r.name, r.quantity, org.currencyCode, m(r.costMinor), m(r.valueMinor)]),
        ),
      };
    });
  }

  // ───────── Shared queries ─────────

  private org(tx: Tx, ctx: RequestContext) {
    return tx.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { timezone: true, currencyCode: true, currencyExponent: true, lowStockThreshold: true },
    });
  }

  private valuationRows(tx: Tx, ctx: RequestContext, o: { byName: boolean; cursor?: string; limit?: number }) {
    let after = Prisma.empty;
    if (o.cursor) {
      const [key, id] = decodeCursor(o.cursor, 2);
      after = o.byName
        ? Prisma.sql`WHERE (v.name, v.id) > (${String(key)}, ${String(id)}::uuid)`
        : Prisma.sql`WHERE (v.quantity * v.cost_minor, v.id) < (${String(key)}::bigint, ${String(id)}::uuid)`;
    }
    return tx.$queryRaw<{ productId: string; name: string; sku: string; quantity: number; costMinor: bigint; valueMinor: bigint }[]>`
      SELECT v.id AS "productId", v.name, v.sku, v.quantity, v.cost_minor AS "costMinor",
             (v.quantity * v.cost_minor)::bigint AS "valueMinor"
      FROM (${VALUATION(ctx.organizationId)}) v
      ${after}
      ORDER BY ${o.byName ? Prisma.sql`v.name, v.id` : Prisma.sql`v.quantity * v.cost_minor DESC, v.id DESC`}
      ${o.limit ? Prisma.sql`LIMIT ${o.limit}` : Prisma.empty}`;
  }

  private async outstanding(tx: Tx, ctx: RequestContext, today: string, salespersonId?: string) {
    const balance = Prisma.sql`(d.total_minor - d.returned_minor - d.paid_minor)`;
    const [row] = await tx.$queryRaw<{ balanceMinor: bigint; invoiceCount: number; overdueMinor: bigint; overdueCount: number }[]>`
      SELECT COALESCE(sum(${balance}), 0)::bigint AS "balanceMinor", count(*)::int AS "invoiceCount",
             COALESCE(sum(${balance}) FILTER (WHERE d.due_date < ${today}::date), 0)::bigint AS "overdueMinor",
             count(*) FILTER (WHERE d.due_date < ${today}::date)::int AS "overdueCount"
      FROM invoices d
      WHERE d.organization_id = ${ctx.organizationId}::uuid AND d.status = 'ISSUED' AND ${balance} > 0
        ${salespersonId ? Prisma.sql`AND d.salesperson_id = ${salespersonId}::uuid` : Prisma.empty}`;
    return row!;
  }

  /**
   * Period figures per salesperson. Invoices count on their issue date, returns on the date of the
   * return and money on the date it was received — each in the organization's time zone.
   */
  private async figures(tx: Tx, ctx: RequestContext, timezone: string, period: Period, salespersonId?: string): Promise<Map<string, Figures>> {
    const day = (column: Prisma.Sql) => Prisma.sql`(${column} AT TIME ZONE ${timezone})::date BETWEEN ${period.from}::date AND ${period.to}::date`;
    const org = Prisma.sql`i.organization_id = ${ctx.organizationId}::uuid`;
    const who = salespersonId ? Prisma.sql`AND i.salesperson_id = ${salespersonId}::uuid` : Prisma.empty;

    const [invoices, returns, restocked, money] = await Promise.all([
      tx.$queryRaw<{ id: string; n: number; invoiced: bigint; net: bigint; tax: bigint; discount: bigint; cost: bigint }[]>`
        SELECT i.salesperson_id AS id, count(*)::int AS n, COALESCE(sum(i.total_minor), 0)::bigint AS invoiced,
               COALESCE(sum(i.subtotal_minor - i.discount_minor), 0)::bigint AS net, COALESCE(sum(i.tax_minor), 0)::bigint AS tax,
               COALESCE(sum(i.discount_minor), 0)::bigint AS discount, COALESCE(sum(i.cost_minor), 0)::bigint AS cost
        FROM invoices i WHERE ${org} AND i.status = 'ISSUED' AND ${day(Prisma.sql`i.issued_at`)} ${who}
        GROUP BY 1`,
      tx.$queryRaw<{ id: string; net: bigint; tax: bigint; total: bigint }[]>`
        SELECT i.salesperson_id AS id, COALESCE(sum(r.subtotal_minor), 0)::bigint AS net,
               COALESCE(sum(r.tax_minor), 0)::bigint AS tax, COALESCE(sum(r.total_minor), 0)::bigint AS total
        FROM sales_returns r JOIN invoices i ON i.id = r.invoice_id
        WHERE ${org} AND i.status = 'ISSUED' AND ${day(Prisma.sql`r.created_at`)} ${who}
        GROUP BY 1`,
      tx.$queryRaw<{ id: string; cost: bigint }[]>`
        SELECT i.salesperson_id AS id, COALESCE(sum(ii.unit_cost_minor * ri.quantity), 0)::bigint AS cost
        FROM return_items ri
        JOIN sales_returns r ON r.id = ri.return_id
        JOIN invoice_items ii ON ii.id = ri.invoice_item_id
        JOIN invoices i ON i.id = r.invoice_id
        WHERE ${org} AND i.status = 'ISSUED' AND ri.restock AND ${day(Prisma.sql`r.created_at`)} ${who}
        GROUP BY 1`,
      tx.$queryRaw<{ id: string; received: bigint }[]>`
        SELECT i.salesperson_id AS id,
               COALESCE(sum(CASE WHEN p.kind = 'PAYMENT' THEN p.amount_minor ELSE -p.amount_minor END), 0)::bigint AS received
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE ${org} AND ${day(Prisma.sql`p.received_at`)} ${who}
        GROUP BY 1`,
    ]);

    const result = new Map<string, Figures>();
    const at = (id: string) => result.get(id) ?? { ...ZERO };
    for (const r of invoices) {
      result.set(r.id, { ...at(r.id), invoiceCount: r.n, invoicedMinor: r.invoiced, netSalesMinor: r.net, taxMinor: r.tax, discountMinor: r.discount, cogsMinor: r.cost });
    }
    for (const r of returns) {
      const f = at(r.id);
      result.set(r.id, { ...f, netSalesMinor: f.netSalesMinor - r.net, taxMinor: f.taxMinor - r.tax, returnsMinor: r.total });
    }
    for (const r of restocked) {
      const f = at(r.id);
      result.set(r.id, { ...f, cogsMinor: f.cogsMinor - r.cost });
    }
    for (const r of money) {
      const f = at(r.id);
      result.set(r.id, { ...f, receivedMinor: r.received });
    }
    return result;
  }
}

/** Active products with their stock on hand. */
const VALUATION = (organizationId: string) => Prisma.sql`
  SELECT p.id, p.name, p.sku, p.cost_minor, COALESCE(s.qty, 0)::bigint AS quantity
  FROM products p
  LEFT JOIN (SELECT product_id, sum(quantity) AS qty FROM stock_levels GROUP BY product_id) s ON s.product_id = p.id
  WHERE p.organization_id = ${organizationId}::uuid AND p.archived_at IS NULL`;
