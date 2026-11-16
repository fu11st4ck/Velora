import { Controller, Get, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Authenticated } from '../authz/decorators';
import { Page } from '../common/envelope.interceptor';
import { Ctx, type RequestContext } from '../common/request-context';
import { SYNC_MAX_LIMIT, SyncService, type SyncEntity } from './sync.service';

export class SyncChangesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(600)
  since?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsIn(['products', 'customers'], { each: true })
  entities?: SyncEntity[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SYNC_MAX_LIMIT)
  limit?: number;
}

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Feeds the app's offline cache. Products follow the same role field policy as everywhere else. */
  @Authenticated()
  @Get('changes')
  async changes(@Ctx() ctx: RequestContext, @Query() query: SyncChangesQuery) {
    const result = await this.sync.changes(ctx, query);
    return new EntityPage(result.data, result.meta);
  }
}

/** `{ data: {…per entity…}, meta }` — the envelope's list form with an object as data. */
class EntityPage extends Page<never> {
  constructor(data: Record<string, unknown>, meta: Record<string, unknown>) {
    super(data as unknown as never[], meta);
  }
}
