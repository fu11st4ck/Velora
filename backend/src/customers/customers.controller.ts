import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../authz/decorators';
import { Page } from '../common/envelope.interceptor';
import { idempotentRequest, sendIdempotent } from '../common/idempotent-response';
import { Ctx, type RequestContext } from '../common/request-context';
import { IdParam } from '../common/uuid-param';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, ListCustomersQuery, UpdateCustomerDto } from './dto';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermission('customer.read')
  @Get()
  async list(@Ctx() ctx: RequestContext, @Query() query: ListCustomersQuery) {
    const { items, meta } = await this.customers.list(ctx, query);
    return new Page(items, meta);
  }

  @RequirePermission('customer.write')
  @Post()
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateCustomerDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) =>
      this.customers.create(tx, ctx, dto),
    );
    return sendIdempotent(reply, result);
  }

  @RequirePermission('customer.read')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @IdParam() id: string) {
    return this.customers.get(ctx, id);
  }

  @RequirePermission('customer.write')
  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @IdParam() id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(ctx, id, dto);
  }

  @RequirePermission('customer.archive')
  @Delete(':id')
  @HttpCode(204)
  async archive(@Ctx() ctx: RequestContext, @IdParam() id: string): Promise<void> {
    await this.customers.archive(ctx, id);
  }
}
