import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { MAX_LIMIT } from '../common/pagination';

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Fields shared by create and edit. A blank string means "no value". */
export class CustomerFieldsDto {
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  name?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(160)
  company?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(32)
  mobile?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  taxRegistrationNumber?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class CreateCustomerDto extends CustomerFieldsDto {
  /** Optional client-generated id, so a customer created offline keeps its identity. */
  @IsOptional()
  @IsUUID()
  id?: string;
}

export class UpdateCustomerDto extends CustomerFieldsDto {}

export const CUSTOMER_SORTS = ['name', '-createdAt'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export class ListCustomersQuery {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Exact match on the normalized number: used to find an existing customer before creating one. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  mobile?: string;

  @IsOptional()
  @IsIn(CUSTOMER_SORTS)
  sort?: CustomerSort;

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
