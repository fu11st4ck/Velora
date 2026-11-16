import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../authz/decorators';
import { Page } from '../common/envelope.interceptor';
import { idempotentRequest, sendIdempotent } from '../common/idempotent-response';
import { Ctx, type RequestContext } from '../common/request-context';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { AdjustStockDto, ListMovementsQuery, ReceiveStockDto } from './dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermission('inventory.read')
  @Get('movements')
  async movements(@Ctx() ctx: RequestContext, @Query() query: ListMovementsQuery) {
    const { items, meta } = await this.inventory.listMovements(ctx, query);
    return new Page(items, meta);
  }

  @RequirePermission('inventory.manage')
  @Post('receipts')
  async receive(
    @Ctx() ctx: RequestContext,
    @Body() dto: ReceiveStockDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) =>
      this.inventory.receive(tx, ctx, dto),
    );
    return sendIdempotent(reply, result);
  }

  @RequirePermission('inventory.manage')
  @Post('adjustments')
  async adjust(
    @Ctx() ctx: RequestContext,
    @Body() dto: AdjustStockDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) =>
      this.inventory.adjust(tx, ctx, dto),
    );
    return sendIdempotent(reply, result);
  }
}
