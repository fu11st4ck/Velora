import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../authz/decorators';
import { Page } from '../common/envelope.interceptor';
import { idempotentRequest, sendIdempotent } from '../common/idempotent-response';
import { Ctx, type RequestContext } from '../common/request-context';
import { IdParam } from '../common/uuid-param';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { CreateProductDto, ListProductsQuery, UpdateProductDto } from './dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @RequirePermission('product.read')
  @Get()
  async list(@Ctx() ctx: RequestContext, @Query() query: ListProductsQuery) {
    const { items, meta } = await this.products.list(ctx, query);
    return new Page(items, meta);
  }

  @RequirePermission('product.manage')
  @Post()
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateProductDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.idempotency.execute(ctx, idempotentRequest(req), 201, (tx) =>
      this.products.create(tx, ctx, dto),
    );
    return sendIdempotent(reply, result);
  }

  @RequirePermission('product.read')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @IdParam() id: string) {
    return this.products.get(ctx, id);
  }

  @RequirePermission('product.manage')
  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @IdParam() id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(ctx, id, dto);
  }

  @RequirePermission('product.manage')
  @Delete(':id')
  @HttpCode(204)
  async archive(@Ctx() ctx: RequestContext, @IdParam() id: string): Promise<void> {
    await this.products.archive(ctx, id);
  }
}

