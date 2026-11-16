import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, likePattern, takePage } from '../common/pagination';
import type { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { CreateProductDto, ListProductsQuery, ProductSort, UpdateProductDto } from './dto';
import { productView, type OrgPricing, type ProductRecord } from './product.view';

interface ListRow extends ProductRecord {
  quantity: number;
  createdUs: bigint;
}

const SELECT = Prisma.sql`
  p.id, p.sku, p.barcode, p.name, p.description,
  p.weight_value AS "weightValue", p.weight_unit AS "weightUnit", p.image_key AS "imageKey",
  p.cost_minor AS "costMinor", p.default_markup_bp AS "defaultMarkupBp", p.min_markup_bp AS "minMarkupBp",
  p.reorder_level AS "reorderLevel", p.is_active AS "isActive", p.archived_at AS "archivedAt",
  p.version, p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  (extract(epoch FROM p.created_at) * 1000000)::bigint AS "createdUs",
  COALESCE(s.qty, 0)::int AS quantity`;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, query: ListProductsQuery) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sort: ProductSort = query.sort ?? 'name';
    const includeArchived = query.includeArchived === true && ctx.role !== 'SALES';

    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await this.orgPricing(tx, ctx);
      const stock = stockSubquery(ctx);
      const eff = Prisma.sql`COALESCE(p.reorder_level, ${org.lowStockThreshold})`;
      const qty = Prisma.sql`COALESCE(s.qty, 0)`;

      // Filters shared by the page and the per-status counts.
      const base: Prisma.Sql[] = [Prisma.sql`p.organization_id = ${ctx.organizationId}::uuid`];
      if (!includeArchived) base.push(Prisma.sql`p.archived_at IS NULL`);
      if (query.q) {
        const pattern = likePattern(query.q);
        base.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.sku ILIKE ${pattern} OR p.barcode ILIKE ${pattern})`);
      }
      if (query.sellable) base.push(Prisma.sql`p.is_active AND ${qty} > 0`);

      const where = [...base];
      switch (query.stockStatus) {
        case 'in_stock':
          where.push(Prisma.sql`${qty} > ${eff}`);
          break;
        case 'low':
          where.push(Prisma.sql`${qty} > 0 AND ${qty} <= ${eff}`);
          break;
        case 'out':
          where.push(Prisma.sql`${qty} = 0`);
          break;
        case 'attention':
          where.push(Prisma.sql`${qty} <= ${eff}`);
          break;
      }

      const order = ORDERINGS[sort];
      if (query.cursor) {
        const [value, id] = decodeCursor(query.cursor, 2);
        where.push(order.after(value as string | number, String(id)));
      }

      const rows = await tx.$queryRaw<ListRow[]>`
        SELECT ${SELECT}
        FROM products p LEFT JOIN (${stock}) s ON s.product_id = p.id
        WHERE ${Prisma.join(where, ' AND ')}
        ORDER BY ${order.by}
        LIMIT ${limit + 1}`;
      const { items, hasMore } = takePage(rows, limit);
      const last = items[items.length - 1];

      const meta: Record<string, unknown> = {
        nextCursor: hasMore && last ? encodeCursor([order.key(last), last.id]) : null,
        hasMore,
      };
      if (!query.cursor) {
        const [counts] = await tx.$queryRaw<{ all: number; inStock: number; low: number; out: number }[]>`
          SELECT count(*)::int AS "all",
                 (count(*) FILTER (WHERE ${qty} > ${eff}))::int AS "inStock",
                 (count(*) FILTER (WHERE ${qty} > 0 AND ${qty} <= ${eff}))::int AS "low",
                 (count(*) FILTER (WHERE ${qty} = 0))::int AS "out"
          FROM products p LEFT JOIN (${stock}) s ON s.product_id = p.id
          WHERE ${Prisma.join(base, ' AND ')}`;
        meta.counts = counts;
      }
      return { items: items.map((r) => productView(r, r.quantity, org, ctx.role)), meta };
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id } });
      if (!product) throw Errors.notFound('Product');
      const org = await this.orgPricing(tx, ctx);
      const levels = await tx.stockLevel.findMany({
        where: { productId: id, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
        include: { branch: { select: { name: true } } },
        orderBy: { branch: { name: 'asc' } },
      });
      const quantity = levels.reduce((sum, l) => sum + l.quantity, 0);
      return {
        ...productView(product, quantity, org, ctx.role),
        stockByBranch: levels.map((l) => ({ branchId: l.branchId, branchName: l.branch.name, quantity: l.quantity })),
      };
    });
  }

  /** Creates the product, its stock level and (when stock was received) the first ledger entry — atomically. */
  async create(tx: Tx, ctx: RequestContext, dto: CreateProductDto) {
    const org = await this.orgPricing(tx, ctx);
    assertPolicy(dto.minMarkupBp, dto.defaultMarkupBp, org.maxMarkupBp);
    const branchId = await resolveBranch(tx, ctx);

    const sku = dto.sku ?? (await this.generateSku(tx));
    if (await tx.product.findFirst({ where: { sku: { equals: sku, mode: 'insensitive' } }, select: { id: true } })) {
      throw Errors.skuTaken();
    }
    if (dto.barcode && (await tx.product.findFirst({ where: { barcode: dto.barcode }, select: { id: true } }))) {
      throw Errors.barcodeTaken();
    }

    const product = await tx.product.create({
      data: {
        organizationId: ctx.organizationId,
        sku,
        barcode: dto.barcode ?? null,
        name: dto.name,
        description: dto.description ?? null,
        weightValue: dto.weight?.value ?? null,
        weightUnit: dto.weight?.unit ?? null,
        costMinor: BigInt(dto.costMinor),
        defaultMarkupBp: dto.defaultMarkupBp,
        minMarkupBp: dto.minMarkupBp,
        reorderLevel: dto.reorderLevel ?? null,
      },
    });
    await tx.stockLevel.create({
      data: { organizationId: ctx.organizationId, productId: product.id, branchId, quantity: dto.openingQuantity },
    });
    if (dto.openingQuantity > 0) {
      await tx.stockMovement.create({
        data: {
          organizationId: ctx.organizationId,
          productId: product.id,
          branchId,
          type: 'PURCHASE_RECEIPT',
          quantityDelta: dto.openingQuantity,
          balanceAfter: dto.openingQuantity,
          unitCostMinor: product.costMinor,
          supplierName: dto.supplierName ?? null,
          referenceNote: dto.referenceNote ?? null,
          createdById: ctx.memberId,
        },
      });
    }
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'product.create',
      entityType: 'product',
      entityId: product.id,
      after: auditSnapshot(product, dto.openingQuantity),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return productView(product, dto.openingQuantity, org, ctx.role);
  }

  async update(ctx: RequestContext, id: string, dto: UpdateProductDto) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const current = await tx.product.findFirst({ where: { id } });
      if (!current) throw Errors.notFound('Product');
      if (current.archivedAt) throw Errors.invalidState('ARCHIVED', 'An archived product cannot be edited.');
      if (current.version !== dto.version) throw Errors.versionConflict(current.version);

      const org = await this.orgPricing(tx, ctx);
      const minMarkupBp = dto.minMarkupBp ?? current.minMarkupBp;
      const defaultMarkupBp = dto.defaultMarkupBp ?? current.defaultMarkupBp;
      if (dto.minMarkupBp !== undefined || dto.defaultMarkupBp !== undefined) {
        assertPolicy(minMarkupBp, defaultMarkupBp, org.maxMarkupBp);
      }
      if (dto.sku !== undefined && dto.sku.toLowerCase() !== current.sku.toLowerCase()) {
        const taken = await tx.product.findFirst({
          where: { sku: { equals: dto.sku, mode: 'insensitive' }, NOT: { id } },
          select: { id: true },
        });
        if (taken) throw Errors.skuTaken();
      }
      if (dto.barcode && dto.barcode !== current.barcode) {
        if (await tx.product.findFirst({ where: { barcode: dto.barcode, NOT: { id } }, select: { id: true } })) {
          throw Errors.barcodeTaken();
        }
      }

      // The version predicate makes the check-and-write atomic: a concurrent editor updates zero rows.
      const updated = await tx.product.updateMany({
        where: { id, version: dto.version },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
          ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.weight !== undefined
            ? { weightValue: dto.weight?.value ?? null, weightUnit: dto.weight?.unit ?? null }
            : {}),
          ...(dto.reorderLevel !== undefined ? { reorderLevel: dto.reorderLevel } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          minMarkupBp,
          defaultMarkupBp,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw Errors.versionConflict(current.version + 1);

      const product = await tx.product.findUniqueOrThrow({ where: { id } });
      const quantity = await totalQuantity(tx, ctx, id);
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'product.update',
        entityType: 'product',
        entityId: id,
        before: auditSnapshot(current),
        after: auditSnapshot(product),
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
      return productView(product, quantity, org, ctx.role);
    });
  }

  /** Archives (never deletes). Succeeds silently when already archived. */
  async archive(ctx: RequestContext, id: string): Promise<void> {
    await this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      // Lock the row so stock cannot be received between the check and the archive.
      const rows = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
        SELECT archived_at AS "archivedAt" FROM products WHERE id = ${id}::uuid FOR UPDATE`;
      const current = rows[0];
      if (!current) throw Errors.notFound('Product');
      if (current.archivedAt) return;
      const total = await tx.stockLevel.aggregate({ where: { productId: id }, _sum: { quantity: true } });
      const quantity = total._sum.quantity ?? 0;
      if (quantity > 0) throw Errors.productHasStock(quantity);
      await tx.product.update({
        where: { id },
        data: { archivedAt: new Date(), isActive: false, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: 'product.archive',
        entityType: 'product',
        entityId: id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
    });
  }

  async orgPricing(tx: Tx, ctx: RequestContext): Promise<OrgPricing> {
    return tx.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { lowStockThreshold: true, maxMarkupBp: true },
    });
  }

  /** `SKU-` + six digits; retried on the rare collision. */
  private async generateSku(tx: Tx): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const sku = `SKU-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
      if (!(await tx.product.findFirst({ where: { sku }, select: { id: true } }))) return sku;
    }
    throw new Error('Could not generate a unique SKU');
  }
}

/** Business rule P3. */
export function assertPolicy(minMarkupBp: number, defaultMarkupBp: number, maxMarkupBp: number): void {
  if (minMarkupBp > defaultMarkupBp || defaultMarkupBp > maxMarkupBp) throw Errors.markupPolicyInvalid(maxMarkupBp);
}

/** The branch a stock-changing request applies to: the member's branch, else the organization default. */
export async function resolveBranch(tx: Tx, ctx: RequestContext, requested?: string): Promise<string> {
  if (requested) {
    if (ctx.branchId && ctx.branchId !== requested) throw Errors.forbidden();
    const branch = await tx.branch.findFirst({ where: { id: requested, isActive: true }, select: { id: true } });
    if (!branch) throw Errors.notFound('Branch');
    return branch.id;
  }
  if (ctx.branchId) return ctx.branchId;
  const branch = await tx.branch.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!branch) throw new Error('Organization has no default branch');
  return branch.id;
}

export async function totalQuantity(tx: Tx, ctx: RequestContext, productId: string): Promise<number> {
  const total = await tx.stockLevel.aggregate({
    where: { productId, ...(ctx.branchId ? { branchId: ctx.branchId } : {}) },
    _sum: { quantity: true },
  });
  return total._sum.quantity ?? 0;
}

function stockSubquery(ctx: RequestContext): Prisma.Sql {
  const branch = ctx.branchId ? Prisma.sql`AND branch_id = ${ctx.branchId}::uuid` : Prisma.empty;
  return Prisma.sql`
    SELECT product_id, SUM(quantity) AS qty FROM stock_levels
    WHERE organization_id = ${ctx.organizationId}::uuid ${branch} GROUP BY product_id`;
}

interface Ordering {
  by: Prisma.Sql;
  key: (row: ListRow) => string | number;
  after: (value: string | number, id: string) => Prisma.Sql;
}

const QTY = Prisma.sql`COALESCE(s.qty, 0)`;
const CREATED = Prisma.sql`(extract(epoch FROM p.created_at) * 1000000)::bigint`;

/** Keyset ordering per sort option; `id` breaks ties so pages never skip or repeat a row. */
const ORDERINGS: Record<ProductSort, Ordering> = {
  name: {
    by: Prisma.sql`lower(p.name) ASC, p.id ASC`,
    key: (r) => r.name.toLowerCase(),
    after: (v, id) => Prisma.sql`(lower(p.name), p.id) > (${String(v)}, ${id}::uuid)`,
  },
  '-name': {
    by: Prisma.sql`lower(p.name) DESC, p.id DESC`,
    key: (r) => r.name.toLowerCase(),
    after: (v, id) => Prisma.sql`(lower(p.name), p.id) < (${String(v)}, ${id}::uuid)`,
  },
  quantity: {
    by: Prisma.sql`${QTY} ASC, p.id ASC`,
    key: (r) => r.quantity,
    after: (v, id) => Prisma.sql`(${QTY}, p.id) > (${Number(v)}::numeric, ${id}::uuid)`,
  },
  '-quantity': {
    by: Prisma.sql`${QTY} DESC, p.id DESC`,
    key: (r) => r.quantity,
    after: (v, id) => Prisma.sql`(${QTY}, p.id) < (${Number(v)}::numeric, ${id}::uuid)`,
  },
  '-createdAt': {
    by: Prisma.sql`${CREATED} DESC, p.id DESC`,
    key: (r) => r.createdUs.toString(),
    after: (v, id) => Prisma.sql`(${CREATED}, p.id) < (${String(v)}::bigint, ${id}::uuid)`,
  },
};

function auditSnapshot(p: ProductRecord, openingQuantity?: number): Prisma.InputJsonValue {
  return {
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    costMinor: p.costMinor.toString(),
    defaultMarkupBp: p.defaultMarkupBp,
    minMarkupBp: p.minMarkupBp,
    reorderLevel: p.reorderLevel,
    isActive: p.isActive,
    ...(openingQuantity !== undefined ? { openingQuantity } : {}),
  };
}
