import { Injectable } from '@nestjs/common';
import { Prisma, type Customer, type MemberRole } from '@prisma/client';
import { productView, type ProductRecord } from '../catalog/product.view';
import { Errors } from '../common/errors';
import type { RequestContext } from '../common/request-context';
import { customerView } from '../customers/customers.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export const SYNC_DEFAULT_LIMIT = 200;
export const SYNC_MAX_LIMIT = 500;

/**
 * A change committed a moment after a page was read can carry a slightly earlier timestamp than
 * rows already sent. The position therefore never advances closer than this to "now": the most
 * recent changes are sent again on the next call (applying them twice is harmless) and none is missed.
 */
const OVERLAP_SECONDS = 10;
const ZERO_ID = '00000000-0000-0000-0000-000000000000';

export type SyncEntity = 'products' | 'customers';

/** Where a client has read up to, per entity: microseconds since the epoch and the last id at that instant. */
interface Position {
  us: string;
  id: string;
}

interface Token {
  v: 1;
  /** The role the cache was filled for: a different role gets a fresh snapshot, never a mix. */
  r: MemberRole;
  p?: Position;
  c?: Position;
}

interface Changed {
  changedUs: bigint;
  safeUs: bigint;
}

function encode(token: Token): string {
  return Buffer.from(JSON.stringify(token), 'utf8').toString('base64url');
}

function decode(raw: string, role: MemberRole): Token {
  try {
    const t = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Token;
    const ok = (p: Position | undefined) => p === undefined || (/^\d{1,19}$/.test(p.us) && /^[0-9a-f-]{36}$/.test(p.id));
    if (t.v === 1 && t.r === role && ok(t.p) && ok(t.c)) return t;
  } catch {
    // fall through
  }
  // The client answers this by dropping its cache and asking for a full snapshot.
  throw Errors.validation('since', 'invalid_token');
}

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Products and customers changed since the client's token, oldest change first. Without a token
   * the client gets everything current. Archived rows are reported by id so a cache can drop them.
   */
  async changes(ctx: RequestContext, query: { since?: string; entities?: SyncEntity[]; limit?: number }) {
    const limit = query.limit ?? SYNC_DEFAULT_LIMIT;
    const entities = new Set<SyncEntity>(query.entities?.length ? query.entities : ['products', 'customers']);
    const since: Token = query.since ? decode(query.since, ctx.role) : { v: 1, r: ctx.role };

    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const [{ now }] = await tx.$queryRaw<[{ now: Date }]>`SELECT now() AS now`;
      const next: Token = { v: 1, r: ctx.role, p: since.p, c: since.c };
      const data: Record<string, { upserted: unknown[]; archivedIds: string[] }> = {};
      let hasMore = false;

      if (entities.has('products')) {
        const page = await this.products(tx, ctx, since.p, limit);
        data.products = page.data;
        next.p = page.position ?? since.p;
        hasMore ||= page.hasMore;
      }
      if (entities.has('customers')) {
        const page = await this.customers(tx, ctx, since.c, limit);
        data.customers = page.data;
        next.c = page.position ?? since.c;
        hasMore ||= page.hasMore;
      }
      return { data, meta: { next: encode(next), hasMore, serverTime: now } };
    });
  }

  private async products(tx: Tx, ctx: RequestContext, since: Position | undefined, limit: number) {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { lowStockThreshold: true, maxMarkupBp: true },
    });
    const branch = ctx.branchId ? Prisma.sql`AND branch_id = ${ctx.branchId}::uuid` : Prisma.empty;
    // A product "changes" when its own row, its stock, or the organization's pricing settings change:
    // each of them alters what the app shows for it.
    const rows = await tx.$queryRaw<(ProductRecord & Changed & { quantity: number })[]>`
      WITH v AS (
        SELECT p.id, p.sku, p.barcode, p.name, p.description,
               p.weight_value AS "weightValue", p.weight_unit AS "weightUnit", p.image_key AS "imageKey",
               p.cost_minor AS "costMinor", p.default_markup_bp AS "defaultMarkupBp", p.min_markup_bp AS "minMarkupBp",
               p.reorder_level AS "reorderLevel", p.is_active AS "isActive", p.archived_at AS "archivedAt",
               p.version, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
               COALESCE(s.qty, 0)::int AS quantity,
               (extract(epoch FROM GREATEST(p.updated_at, COALESCE(s.changed, p.updated_at), o.updated_at)) * 1000000)::bigint AS "changedUs"
        FROM products p
        JOIN organizations o ON o.id = p.organization_id
        LEFT JOIN (
          SELECT product_id, SUM(quantity) AS qty, MAX(updated_at) AS changed FROM stock_levels
          WHERE organization_id = ${ctx.organizationId}::uuid ${branch} GROUP BY product_id
        ) s ON s.product_id = p.id
        WHERE p.organization_id = ${ctx.organizationId}::uuid
      )
      SELECT v.*, ${SAFE_US} AS "safeUs" FROM v
      WHERE ${since ? Prisma.sql`(v."changedUs", v.id) > (${since.us}::bigint, ${since.id}::uuid)` : Prisma.sql`v."archivedAt" IS NULL`}
      ORDER BY v."changedUs", v.id
      LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    return {
      data: {
        upserted: page.filter((r) => r.archivedAt === null).map((r) => productView(r, r.quantity, org, ctx.role)),
        archivedIds: page.filter((r) => r.archivedAt !== null).map((r) => r.id),
      },
      hasMore: rows.length > limit,
      position: await this.position(tx, page, rows.length > limit, since),
    };
  }

  private async customers(tx: Tx, ctx: RequestContext, since: Position | undefined, limit: number) {
    const rows = await tx.$queryRaw<{ id: string; changedUs: bigint; safeUs: bigint }[]>`
      SELECT c.id, (extract(epoch FROM c.updated_at) * 1000000)::bigint AS "changedUs", ${SAFE_US} AS "safeUs"
      FROM customers c
      WHERE c.organization_id = ${ctx.organizationId}::uuid
        AND ${since ? Prisma.sql`((extract(epoch FROM c.updated_at) * 1000000)::bigint, c.id) > (${since.us}::bigint, ${since.id}::uuid)` : Prisma.sql`c.archived_at IS NULL`}
      ORDER BY 2, c.id
      LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const records = new Map<string, Customer>(
      (await tx.customer.findMany({ where: { id: { in: page.map((r) => r.id) } } })).map((c) => [c.id, c]),
    );
    const ordered = page.map((r) => records.get(r.id)).filter((c): c is Customer => c !== undefined);
    return {
      data: {
        upserted: ordered.filter((c) => c.archivedAt === null).map(customerView),
        archivedIds: ordered.filter((c) => c.archivedAt !== null).map((c) => c.id),
      },
      hasMore: rows.length > limit,
      position: await this.position(tx, page, rows.length > limit, since),
    };
  }

  /** The position to resume from after this page; undefined keeps the client's current one. */
  private async position(
    tx: Tx,
    page: { id: string; changedUs: bigint; safeUs: bigint }[],
    hasMore: boolean,
    since: Position | undefined,
  ): Promise<Position | undefined> {
    const last = page[page.length - 1];
    // More pages follow: continue exactly after the last row.
    if (last && hasMore) return { us: last.changedUs.toString(), id: last.id };
    // Caught up: never rest closer to "now" than the overlap (see OVERLAP_SECONDS).
    const safeUs = last?.safeUs ?? (await tx.$queryRaw<[{ safeUs: bigint }]>`SELECT ${SAFE_US} AS "safeUs"`)[0].safeUs;
    if (last) return last.changedUs <= safeUs ? { us: last.changedUs.toString(), id: last.id } : { us: safeUs.toString(), id: ZERO_ID };
    if (since && BigInt(since.us) > safeUs) return { us: safeUs.toString(), id: ZERO_ID };
    // First snapshot of an empty table: start from the safe point rather than from nothing.
    return since ? undefined : { us: safeUs.toString(), id: ZERO_ID };
  }
}

const SAFE_US = Prisma.sql`(extract(epoch FROM now() - make_interval(secs => ${OVERLAP_SECONDS})) * 1000000)::bigint`;
