import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import { MAX_MINOR, MAX_QUANTITY } from '../catalog/dto';
import { MAX_LIMIT } from '../common/pagination';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

export class ReceiveStockDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity!: number;

  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  unitCostMinor!: number;

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

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class AdjustStockDto {
  @IsUUID()
  productId!: string;

  /** Signed and non-zero: negative removes stock. */
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_QUANTITY)
  @Max(MAX_QUANTITY)
  quantityDelta!: number;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'SALE',
  'SALE_CANCELLATION',
  'CUSTOMER_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export class ListMovementsQuery {
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Repeatable (`type=SALE&type=CUSTOMER_RETURN`) or comma-separated. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()).filter(Boolean),
  )
  @IsArray()
  @IsIn(MOVEMENT_TYPES, { each: true })
  type?: MovementType[];

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

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
