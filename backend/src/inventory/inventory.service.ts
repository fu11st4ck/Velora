import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { canSeeCost } from '../authz/permissions';
import { productView } from '../catalog/product.view';
import { ProductsService, resolveBranch, totalQuantity } from '../catalog/products.service';
import { Errors } from '../common/errors';
import { weightedAverageCost } from '../common/money';
import { DEFAULT_LIMIT, decodeCursor, encodeCursor, takePage } from '../common/pagination';
import type { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { AdjustStockDto, ListMovementsQuery, ReceiveStockDto } from './dto';

interface LockedProduct {
  id: string;
  costMinor: bigint;
  archivedAt: Date | null;
}

interface MovementRow {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  type: string;
  quantityDelta: number;
  balanceAfter: number;
  unitCostMinor: bigint;
  invoiceId: string | null;
  invoiceNumber: string | null;
  returnId: string | null;
  returnNumber: string | null;
  supplierName: string | null;
  referenceNote: string | null;
  reason: string | null;
  createdById: string;
  createdByName: string;
  createdAt: Date;
  createdUs: bigint;
}

/**
 * Every change of stock goes through here: one ledger row per change, with the cached level
 * updated in the same transaction (business rules S1–S6).
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly audit: AuditService,
  ) {}

  /** S4 + S5: adds stock at a unit cost and re-averages the product cost. */
  async receive(tx: Tx, ctx: RequestContext, dto: ReceiveStockDto) {
    const product = await this.lockProduct(tx, dto.productId);
    if (product.archivedAt) throw Errors.productArchived();
    const branchId = await resolveBranch(tx, ctx, dto.branchId);

    // Cost is averaged over everything the organization holds, across branches.
    const held = await tx.stockLevel.aggregate({ where: { productId: product.id }, _sum: { quantity: true } });
    const onHand = held._sum.quantity ?? 0;
    const unitCostMinor = BigInt(dto.unitCostMinor);
    const newCost = weightedAverageCost(onHand, product.costMinor, dto.quantity, unitCostMinor);

    const balanceAfter = await this.applyDelta(tx, ctx, product.id, branchId, dto.quantity);
    const movement = await tx.stockMovement.create({
      data: {
        organizationId: ctx.organizationId,
        productId: product.id,
        branchId,
        type: 'PURCHASE_RECEIPT',
        quantityDelta: dto.quantity,
        balanceAfter,
        unitCostMinor,
        supplierName: dto.supplierName ?? null,
        referenceNote: dto.referenceNote ?? null,
        createdById: ctx.memberId,
      },
    });
    await tx.product.update({ where: { id: product.id }, data: { costMinor: newCost } });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'inventory.receive',
      entityType: 'product',
      entityId: product.id,
      before: { quantity: onHand, costMinor: product.costMinor.toString() },
      after: {
        quantity: onHand + dto.quantity,
        costMinor: newCost.toString(),
        received: dto.quantity,
        unitCostMinor: unitCostMinor.toString(),
        movementId: movement.id,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return this.result(tx, ctx, movement.id, product.id);
  }

  /** S6: corrects stock up or down with a mandatory reason, at the current cost. */
  async adjust(tx: Tx, ctx: RequestContext, dto: AdjustStockDto) {
    const product = await this.lockProduct(tx, dto.productId);
    if (product.archivedAt) throw Errors.productArchived();
    const branchId = await resolveBranch(tx, ctx, dto.branchId);

    const balanceAfter = await this.applyDelta(tx, ctx, product.id, branchId, dto.quantityDelta);
    const movement = await tx.stockMovement.create({
      data: {
        organizationId: ctx.organizationId,
        productId: product.id,
        branchId,
        type: dto.quantityDelta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
        quantityDelta: dto.quantityDelta,
        balanceAfter,
        unitCostMinor: product.costMinor,
        reason: dto.reason,
        createdById: ctx.memberId,
      },
    });
    await this.audit.record(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: 'inventory.adjust',
      entityType: 'product',
      entityId: product.id,
      before: { quantity: balanceAfter - dto.quantityDelta },
      after: { quantity: balanceAfter, quantityDelta: dto.quantityDelta, reason: dto.reason, movementId: movement.id },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
    });
    return this.result(tx, ctx, movement.id, product.id);
  }

  /**
   * S2/S3: takes stock for one invoice line and writes its SALE movement. Throws INSUFFICIENT_STOCK
   * when the branch does not hold enough; the caller's transaction then rolls everything back.
   */
  async takeForSale(
    tx: Tx,
    ctx: RequestContext,
    line: { productId: string; branchId: string; quantity: number; unitCostMinor: bigint; invoiceId: string },
  ): Promise<void> {
    const balanceAfter = await this.applyDelta(tx, ctx, line.productId, line.branchId, -line.quantity);
    await tx.stockMovement.create({
      data: {
        organizationId: ctx.organizationId,
        productId: line.productId,
        branchId: line.branchId,
        type: 'SALE',
        quantityDelta: -line.quantity,
        balanceAfter,
        unitCostMinor: line.unitCostMinor,
        invoiceId: line.invoiceId,
        createdById: ctx.memberId,
      },
    });
  }

  /**
   * S7/S8: puts sold stock back (cancellation or customer return) at the cost it was sold at,
   * re-averaging the product cost exactly as a receipt would.
   */
  async restoreFromSale(
    tx: Tx,
    ctx: RequestContext,
    line: {
      productId: string;
      branchId: string;
      quantity: number;
      unitCostMinor: bigint;
      type: 'SALE_CANCELLATION' | 'CUSTOMER_RETURN';
      invoiceId?: string;
      returnId?: string;
    },
  ): Promise<void> {
    const product = await this.lockProduct(tx, line.productId);
    const held = await tx.stockLevel.aggregate({ where: { productId: product.id }, _sum: { quantity: true } });
    const newCost = weightedAverageCost(held._sum.quantity ?? 0, product.costMinor, line.quantity, line.unitCostMinor);
    const balanceAfter = await this.applyDelta(tx, ctx, product.id, line.branchId, line.quantity);
    await tx.stockMovement.create({
      data: {
        organizationId: ctx.organizationId,
        productId: product.id,
        branchId: line.branchId,
        type: line.type,
        quantityDelta: line.quantity,
        balanceAfter,
        unitCostMinor: line.unitCostMinor,
        invoiceId: line.invoiceId ?? null,
        returnId: line.returnId ?? null,
        createdById: ctx.memberId,
      },
    });
    await tx.product.update({ where: { id: product.id }, data: { costMinor: newCost } });
  }

  async listMovements(ctx: RequestContext, query: ListMovementsQuery) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const where: Prisma.Sql[] = [Prisma.sql`m.organization_id = ${ctx.organizationId}::uuid`];
      if (ctx.branchId) where.push(Prisma.sql`m.branch_id = ${ctx.branchId}::uuid`);
      if (query.productId) where.push(Prisma.sql`m.product_id = ${query.productId}::uuid`);
      if (query.type?.length) {
        where.push(Prisma.sql`m.type::text IN (${Prisma.join(query.type)})`);
      }
      if (query.from) where.push(Prisma.sql`m.created_at >= ${new Date(query.from)}`);
      if (query.to) where.push(Prisma.sql`m.created_at <= ${new Date(query.to)}`);
      if (query.cursor) {
        const [us, id] = decodeCursor(query.cursor, 2);
        where.push(Prisma.sql`(${CREATED_US}, m.id) < (${String(us)}::bigint, ${String(id)}::uuid)`);
      }
      const rows = await tx.$queryRaw<MovementRow[]>`
        ${MOVEMENT_SELECT}
        WHERE ${Prisma.join(where, ' AND ')}
        ORDER BY ${CREATED_US} DESC, m.id DESC
        LIMIT ${limit + 1}`;
      const { items, hasMore } = takePage(rows, limit);
      const last = items[items.length - 1];
      return {
        items: items.map((r) => movementView(r, canSeeCost(ctx.role))),
        meta: { nextCursor: hasMore && last ? encodeCursor([last.createdUs.toString(), last.id]) : null, hasMore },
      };
    });
  }

  /**
   * Changes the on-hand quantity and returns the new balance. A reduction is one conditional
   * UPDATE, so two concurrent reductions can never take stock below zero (S3).
   */
  private async applyDelta(tx: Tx, ctx: RequestContext, productId: string, branchId: string, delta: number): Promise<number> {
    if (delta > 0) {
      const rows = await tx.$queryRaw<{ quantity: number }[]>`
        INSERT INTO stock_levels (id, organization_id, product_id, branch_id, quantity, updated_at)
        VALUES (gen_random_uuid(), ${ctx.organizationId}::uuid, ${productId}::uuid, ${branchId}::uuid, ${delta}, now())
        ON CONFLICT (product_id, branch_id)
        DO UPDATE SET quantity = stock_levels.quantity + EXCLUDED.quantity, updated_at = now()
        RETURNING quantity`;
      return (rows[0] as { quantity: number }).quantity;
    }
    const take = -delta;
    const rows = await tx.$queryRaw<{ quantity: number }[]>`
      UPDATE stock_levels SET quantity = quantity - ${take}, updated_at = now()
      WHERE product_id = ${productId}::uuid AND branch_id = ${branchId}::uuid AND quantity >= ${take}
      RETURNING quantity`;
    if (rows.length === 0) {
      const level = await tx.stockLevel.findUnique({ where: { productId_branchId: { productId, branchId } } });
      throw Errors.insufficientStock([{ productId, requested: take, available: level?.quantity ?? 0 }]);
    }
    return (rows[0] as { quantity: number }).quantity;
  }

  /** Row lock: serializes cost averaging and archiving for one product. */
  private async lockProduct(tx: Tx, id: string): Promise<LockedProduct> {
    const rows = await tx.$queryRaw<LockedProduct[]>`
      SELECT id, cost_minor AS "costMinor", archived_at AS "archivedAt"
      FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound('Product');
    return rows[0];
  }

  private async result(tx: Tx, ctx: RequestContext, movementId: string, productId: string) {
    const [row] = await tx.$queryRaw<MovementRow[]>`${MOVEMENT_SELECT} WHERE m.id = ${movementId}::uuid`;
    const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
    const org = await this.products.orgPricing(tx, ctx);
    return {
      movement: movementView(row as MovementRow, canSeeCost(ctx.role)),
      product: productView(product, await totalQuantity(tx, ctx, productId), org, ctx.role),
    };
  }
}

const CREATED_US = Prisma.sql`(extract(epoch FROM m.created_at) * 1000000)::bigint`;

const MOVEMENT_SELECT = Prisma.sql`
  SELECT m.id, m.product_id AS "productId", p.name AS "productName", p.sku AS "productSku",
         m.type::text AS type, m.quantity_delta AS "quantityDelta", m.balance_after AS "balanceAfter",
         m.unit_cost_minor AS "unitCostMinor",
         m.invoice_id AS "invoiceId", i.number AS "invoiceNumber",
         m.return_id AS "returnId", r.number AS "returnNumber",
         m.supplier_name AS "supplierName", m.reference_note AS "referenceNote", m.reason,
         m.created_by_id AS "createdById", u.full_name AS "createdByName",
         m.created_at AS "createdAt", ${CREATED_US} AS "createdUs"
  FROM stock_movements m
  JOIN products p ON p.id = m.product_id
  JOIN organization_members om ON om.id = m.created_by_id
  JOIN users u ON u.id = om.user_id
  LEFT JOIN invoices i ON i.id = m.invoice_id
  LEFT JOIN sales_returns r ON r.id = m.return_id`;

/** Cost and supplier are purchasing information: omitted without cost access (P7). */
function movementView(r: MovementRow, withCost: boolean) {
  const base = {
    id: r.id,
    productId: r.productId,
    productName: r.productName,
    productSku: r.productSku,
    type: r.type,
    quantityDelta: r.quantityDelta,
    balanceAfter: r.balanceAfter,
    invoice: r.invoiceId ? { id: r.invoiceId, number: r.invoiceNumber } : null,
    return: r.returnId ? { id: r.returnId, number: r.returnNumber } : null,
    referenceNote: r.referenceNote,
    reason: r.reason,
    createdBy: { memberId: r.createdById, fullName: r.createdByName },
    createdAt: r.createdAt,
  };
  return withCost ? { ...base, unitCostMinor: r.unitCostMinor, supplierName: r.supplierName } : base;
}
