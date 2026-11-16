import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_LIMIT } from '../common/pagination';

/** Largest amount that survives JSON as an exact integer. */
export const MAX_MINOR = Number.MAX_SAFE_INTEGER;
export const MAX_QUANTITY = 1_000_000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class WeightDto {
  /** Decimal string with up to three decimals, e.g. "12.8". */
  @IsString()
  @Matches(/^\d{1,9}(\.\d{1,3})?$/)
  value!: string;

  @IsIn(['G', 'KG'])
  unit!: 'G' | 'KG';
}

export class CreateProductDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9._-]+$/)
  sku?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeightDto)
  weight?: WeightDto | null;

  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  costMinor!: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  defaultMarkupBp!: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minMarkupBp!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_QUANTITY)
  openingQuantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_QUANTITY)
  reorderLevel?: number | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  supplierName?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  referenceNote?: string | null;
}

export class UpdateProductDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9._-]+$/)
  sku?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(64)
  barcode?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => WeightDto)
  weight?: WeightDto | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  defaultMarkupBp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minMarkupBp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_QUANTITY)
  reorderLevel?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export const PRODUCT_SORTS = ['name', '-name', 'quantity', '-quantity', '-createdAt'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export const STOCK_FILTERS = ['in_stock', 'low', 'out', 'attention'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export class ListProductsQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(STOCK_FILTERS)
  stockStatus?: StockFilter;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  sellable?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;

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
