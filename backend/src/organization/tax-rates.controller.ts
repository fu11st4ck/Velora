import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { Authenticated, RequirePermission } from '../authz/decorators';
import { Ctx, type RequestContext } from '../common/request-context';
import { IdParam } from '../common/uuid-param';
import { CreateTaxRateDto, ListTaxRatesQuery, UpdateTaxRateDto } from './dto';
import { OrganizationService } from './organization.service';

@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly organization: OrganizationService) {}

  /** Active rates for choosing one on a sale; `includeInactive` is honoured for managers and owners. */
  @Authenticated()
  @Get()
  list(@Ctx() ctx: RequestContext, @Query() query: ListTaxRatesQuery) {
    return this.organization.listTaxRates(ctx, query.includeInactive === true);
  }

  @RequirePermission('settings.manage')
  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateTaxRateDto) {
    return this.organization.createTaxRate(ctx, dto);
  }

  @RequirePermission('settings.manage')
  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @IdParam() id: string, @Body() dto: UpdateTaxRateDto) {
    return this.organization.updateTaxRate(ctx, id, dto);
  }
}
