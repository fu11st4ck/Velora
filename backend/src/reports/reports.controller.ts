import { Controller, Get, Query, Req, StreamableFile } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Authenticated, RequirePermission } from '../authz/decorators';
import { hasPermission } from '../authz/permissions';
import { Page } from '../common/envelope.interceptor';
import { Errors } from '../common/errors';
import { Ctx, type RequestContext } from '../common/request-context';
import { PeriodQuery, SalesSummaryQuery, ValuationQuery } from './dto';
import { ReportsService } from './reports.service';

const wantsCsv = (req: FastifyRequest) => (req.headers.accept ?? '').toLowerCase().includes('text/csv');
const csvFile = (file: { filename: string; body: Buffer }) =>
  new StreamableFile(file.body, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${file.filename}"` });

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly reports: ReportsService) {}

  /** One round trip for the Home screen. The sales role gets its own figures and no cost-based ones. */
  @Authenticated()
  @Get('summary')
  summary(@Ctx() ctx: RequestContext) {
    return this.reports.dashboard(ctx);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermission('report.read_own')
  @Get('sales-summary')
  async salesSummary(@Ctx() ctx: RequestContext, @Query() query: SalesSummaryQuery, @Req() req: FastifyRequest) {
    if (wantsCsv(req)) {
      // The export lists every invoice with its cost: managers and owners only.
      if (!hasPermission(ctx.role, 'report.read_all')) throw Errors.forbidden();
      return csvFile(await this.reports.salesCsv(ctx, query, query.salespersonId));
    }
    return this.reports.salesSummary(ctx, query, query.salespersonId);
  }

  @RequirePermission('report.read_all')
  @Get('sales-by-salesperson')
  salesBySalesperson(@Ctx() ctx: RequestContext, @Query() query: PeriodQuery) {
    return this.reports.salesBySalesperson(ctx, query);
  }

  @RequirePermission('report.read_own')
  @Get('payment-status')
  paymentStatus(@Ctx() ctx: RequestContext, @Query() query: PeriodQuery) {
    return this.reports.paymentStatus(ctx, query);
  }

  @RequirePermission('report.read_all')
  @Get('inventory-valuation')
  async inventoryValuation(@Ctx() ctx: RequestContext, @Query() query: ValuationQuery, @Req() req: FastifyRequest) {
    if (wantsCsv(req)) return csvFile(await this.reports.valuationCsv(ctx));
    const page = await this.reports.inventoryValuation(ctx, query);
    return new Page(page.items, page.meta);
  }
}
