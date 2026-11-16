import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_LIMIT } from '../common/pagination';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class PeriodQuery {
  @Matches(DATE)
  from!: string;

  @Matches(DATE)
  to!: string;
}

export class SalesSummaryQuery extends PeriodQuery {
  @IsOptional()
  @IsUUID()
  salespersonId?: string;
}

export class ValuationQuery {
  @IsOptional()
  @IsIn(['-valueMinor', 'name'])
  sort?: '-valueMinor' | 'name';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
