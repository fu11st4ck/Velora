import { Controller, Get } from '@nestjs/common';
import { Authenticated } from '../authz/decorators';
import { Ctx, type RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/** Read side of tax rates, for choosing a rate on a sale. Managing rates arrives with settings (sprint 5). */
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Authenticated()
  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.prisma.tenantTx(ctx.organizationId, (tx) =>
      tx.taxRate.findMany({
        where: { isActive: true },
        orderBy: [{ isDefault: 'desc' }, { rateBp: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, rateBp: true, isDefault: true, isActive: true },
      }),
    );
  }
}
