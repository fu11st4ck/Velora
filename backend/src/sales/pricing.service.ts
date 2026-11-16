import { Injectable } from '@nestjs/common';
import { hasPermission } from '../authz/permissions';
import { resolveBranch } from '../catalog/products.service';
import { DomainError, Errors } from '../common/errors';
import { allocateProportionally, documentTotals, markupFromPrice, priceFromMarkup } from '../common/money';
import type { RequestContext } from '../common/request-context';
import type { Tx } from '../prisma/prisma.service';
import type { LineDto } from './dto';

export type LineIssueCode = 'PRODUCT_UNAVAILABLE' | 'PRICE_BELOW_MINIMUM' | 'PRICE_ABOVE_MAXIMUM' | 'INSUFFICIENT_STOCK';

export interface LineIssue {
  code: LineIssueCode;
  floorPriceMinor?: bigint;
  ceilingPriceMinor?: bigint;
  available?: number;
}

export interface PricedLine {
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  unitCostMinor: bigint;
  unitPriceMinor: bigint;
  markupBp: number;
  lineTotalMinor: bigint;
  discountAllocMinor: bigint;
  taxMinor: bigint;
  available: number;
  /** Set when a manager sold below the lowest price; written to the audit log. */
  belowMinimumReason: string | null;
  issues: LineIssue[];
}

export interface PricedDocument {
  branchId: string;
  lines: PricedLine[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxRate: { id: string; name: string; rateBp: number };
  taxMinor: bigint;
  totalMinor: bigint;
  costMinor: bigint;
  valid: boolean;
}

export interface PricingInput {
  lines: LineDto[];
  discountMinor?: number;
  taxRateId?: string;
}

/**
 * The one place prices, totals and allocations are computed (business rules P1–P7, T1–T6).
 * The cart preview, quotations and invoices all go through `price`, so they cannot disagree.
 * Totals submitted by a client are never used.
 */
@Injectable()
export class PricingService {
  async price(tx: Tx, ctx: RequestContext, input: PricingInput, options: { checkStock: boolean }): Promise<PricedDocument> {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { maxMarkupBp: true } });
    const branchId = await resolveBranch(tx, ctx);

    const taxRate = input.taxRateId
      ? await tx.taxRate.findFirst({ where: { id: input.taxRateId } })
      : await tx.taxRate.findFirst({ where: { isDefault: true } });
    if (!taxRate || !taxRate.isActive) throw Errors.taxRateInactive();

    const ids = [...new Set(input.lines.map((l) => l.productId))];
    const products = new Map((await tx.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]));
    const stock = new Map(
      (await tx.stockLevel.findMany({ where: { productId: { in: ids }, branchId } })).map((s) => [s.productId, s.quantity]),
    );
    const mayGoBelow = hasPermission(ctx.role, 'sale.below_minimum');
    const requested = new Map<string, number>();

    const lines: PricedLine[] = input.lines.map((line, index) => {
      const product = products.get(line.productId);
      const unitPriceMinor = BigInt(line.unitPriceMinor);
      const base = {
        lineNo: index + 1,
        productId: line.productId,
        quantity: line.quantity,
        unitPriceMinor,
        lineTotalMinor: unitPriceMinor * BigInt(line.quantity),
        discountAllocMinor: 0n,
        taxMinor: 0n,
      };
      if (!product || product.archivedAt || !product.isActive) {
        return {
          ...base,
          productName: product?.name ?? '',
          productSku: product?.sku ?? '',
          unitCostMinor: 0n,
          markupBp: 0,
          available: 0,
          belowMinimumReason: null,
          issues: [{ code: 'PRODUCT_UNAVAILABLE' as const }],
        };
      }

      const issues: LineIssue[] = [];
      const floorPriceMinor = priceFromMarkup(product.costMinor, product.minMarkupBp);
      const ceilingPriceMinor = priceFromMarkup(product.costMinor, Math.max(org.maxMarkupBp, product.defaultMarkupBp));
      const reason = line.belowMinimumReason ?? null;
      const overridden = unitPriceMinor < floorPriceMinor && mayGoBelow && reason !== null;
      if (unitPriceMinor < floorPriceMinor && !overridden) issues.push({ code: 'PRICE_BELOW_MINIMUM', floorPriceMinor });
      if (unitPriceMinor > ceilingPriceMinor) issues.push({ code: 'PRICE_ABOVE_MAXIMUM', ceilingPriceMinor });

      // Stock is checked per product across all of its lines (the reference checked each line alone).
      const available = stock.get(product.id) ?? 0;
      const total = (requested.get(product.id) ?? 0) + line.quantity;
      requested.set(product.id, total);
      if (options.checkStock && total > available) issues.push({ code: 'INSUFFICIENT_STOCK', available });

      return {
        ...base,
        productName: product.name,
        productSku: product.sku,
        unitCostMinor: product.costMinor,
        markupBp: markupFromPrice(product.costMinor, unitPriceMinor),
        available,
        belowMinimumReason: overridden ? reason : null,
        issues,
      };
    });

    const lineTotals = lines.map((l) => l.lineTotalMinor);
    const subtotalMinor = lineTotals.reduce((a, b) => a + b, 0n);
    const discountMinor = BigInt(input.discountMinor ?? 0);
    if (discountMinor > subtotalMinor) throw Errors.discountExceedsSubtotal(subtotalMinor);
    const totals = documentTotals(lineTotals, discountMinor, taxRate.rateBp);

    const discounts = allocateProportionally(discountMinor, lineTotals);
    const taxes = allocateProportionally(
      totals.taxMinor,
      lineTotals.map((t, i) => t - (discounts[i] as bigint)),
    );
    lines.forEach((l, i) => {
      l.discountAllocMinor = discounts[i] as bigint;
      l.taxMinor = taxes[i] as bigint;
    });

    return {
      branchId,
      lines,
      subtotalMinor,
      discountMinor,
      taxRate: { id: taxRate.id, name: taxRate.name, rateBp: taxRate.rateBp },
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      costMinor: lines.reduce((sum, l) => sum + l.unitCostMinor * BigInt(l.quantity), 0n),
      valid: lines.every((l) => l.issues.length === 0),
    };
  }

  /** Throws the first problem as the error code, with every problem listed in `details`. */
  assertValid(priced: PricedDocument): void {
    if (priced.valid) return;
    const details = priced.lines.flatMap((l) =>
      l.issues.map((issue) => ({
        lineNo: l.lineNo,
        productId: l.productId,
        code: issue.code,
        ...(issue.floorPriceMinor !== undefined ? { floorPriceMinor: Number(issue.floorPriceMinor) } : {}),
        ...(issue.ceilingPriceMinor !== undefined ? { ceilingPriceMinor: Number(issue.ceilingPriceMinor) } : {}),
        ...(issue.available !== undefined ? { requested: l.quantity, available: issue.available } : {}),
      })),
    );
    const first = (details[0] as { code: LineIssueCode }).code;
    const messages: Record<LineIssueCode, string> = {
      PRODUCT_UNAVAILABLE: 'A product in this sale is no longer available.',
      PRICE_BELOW_MINIMUM: 'A price is below the lowest allowed price.',
      PRICE_ABOVE_MAXIMUM: 'A price is above the highest allowed price.',
      INSUFFICIENT_STOCK: 'Not enough stock.',
    };
    throw new DomainError(first, first === 'INSUFFICIENT_STOCK' ? 409 : 422, messages[first], details);
  }

  /** The cart preview: totals plus per-line problems, so the app can show everything at once. */
  previewView(priced: PricedDocument) {
    return {
      lines: priced.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        lineTotalMinor: l.lineTotalMinor,
        available: l.available,
        issues: l.issues,
      })),
      subtotalMinor: priced.subtotalMinor,
      discountMinor: priced.discountMinor,
      tax: { id: priced.taxRate.id, name: priced.taxRate.name, rateBp: priced.taxRate.rateBp, amountMinor: priced.taxMinor },
      totalMinor: priced.totalMinor,
      valid: priced.valid,
    };
  }
}
