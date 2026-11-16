import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../authz/decorators';
import { Page } from '../common/envelope.interceptor';
import { idempotentRequest, sendIdempotent } from '../common/idempotent-response';
import { Ctx, type RequestContext } from '../common/request-context';
import { IdParam } from '../common/uuid-param';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';
import {
  CancelInvoiceDto,
  CancelQuotationDto,
  CreateInvoiceDto,
  CreateQuotationDto,
  CreateReturnDto,
  ListDocumentsQuery,
  PricingPreviewDto,
  RecordPaymentDto,
  RecordRefundDto,
} from './dto';
import { InvoicesService } from './invoices.service';
import { PricingService } from './pricing.service';
import { QuotationsService } from './quotations.service';

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /** Read-only: returns totals and every per-line problem so the cart can show them together. */
  @RequirePermission('sale.create')
  @Post('preview')
  @HttpCode(200)
  preview(@Ctx() ctx: RequestContext, @Body() dto: PricingPreviewDto) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) =>
      this.pricing.previewView(await this.pricing.price(tx, ctx, dto, { checkStock: true })),
    );
  }
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermission('document.read_own')
  @Get()
  async list(@Ctx() ctx: RequestContext, @Query() query: ListDocumentsQuery) {
    const { items, meta } = await this.documents.list(ctx, query);
    return new Page(items, meta);
  }
}

@Controller('quotations')
export class QuotationsController {
  constructor(
    private readonly quotations: QuotationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermission('sale.create')
  @Post()
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateQuotationDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return sendIdempotent(
      reply,
      await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) => this.quotations.create(tx, ctx, dto)),
    );
  }

  @RequirePermission('document.read_own')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @IdParam() id: string) {
    return this.quotations.get(ctx, id);
  }

  @RequirePermission('sale.create')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Ctx() ctx: RequestContext, @IdParam() id: string, @Body() dto: CancelQuotationDto) {
    return this.quotations.cancel(ctx, id, dto.reason ?? null);
  }
}

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermission('sale.create')
  @Post()
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateInvoiceDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return sendIdempotent(
      reply,
      await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) => this.invoices.create(tx, ctx, dto)),
    );
  }

  @RequirePermission('document.read_own')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @IdParam() id: string) {
    return this.invoices.get(ctx, id);
  }

  @RequirePermission('payment.record')
  @Post(':id/payments')
  async recordPayment(
    @Ctx() ctx: RequestContext,
    @IdParam() id: string,
    @Body() dto: RecordPaymentDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return sendIdempotent(
      reply,
      await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) => this.invoices.recordPayment(tx, ctx, id, dto)),
    );
  }

  @RequirePermission('payment.refund')
  @Post(':id/refunds')
  async recordRefund(
    @Ctx() ctx: RequestContext,
    @IdParam() id: string,
    @Body() dto: RecordRefundDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return sendIdempotent(
      reply,
      await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) => this.invoices.recordRefund(tx, ctx, id, dto)),
    );
  }

  @RequirePermission('invoice.cancel')
  @Post(':id/cancel')
  async cancel(
    @Ctx() ctx: RequestContext,
    @IdParam() id: string,
    @Body() dto: CancelInvoiceDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return sendIdempotent(
      reply,
      await this.idempotency.execute(ctx, idempotentRequest(req), 200, (tx) => this.invoices.cancel(tx, ctx, id, dto)),
    );
  }

  @RequirePermission('invoice.return')
  @Post(':id/returns')
  async createReturn(
    @Ctx() ctx: RequestContext,
    @IdParam() id: string,
    @Body() dto: CreateReturnDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return sendIdempotent(
      reply,
      await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) => this.invoices.createReturn(tx, ctx, id, dto)),
    );
  }
}
