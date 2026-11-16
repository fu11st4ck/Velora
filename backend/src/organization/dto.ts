import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Trims; an empty string clears the field. */
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const notNull = (_: unknown, value: unknown) => value !== null;

export class UpdateOrganizationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(160)
  legalName?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(40)
  taxRegistrationNumber?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(240)
  addressLine?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(80)
  city?: string | null;

  @IsOptional()
  @Transform(upper)
  @ValidateIf(notNull)
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf(notNull)
  @IsString()
  @MaxLength(400)
  invoiceFooter?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  maxMarkupBp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  defaultMarkupBp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  defaultMinMarkupBp?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  defaultCreditDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  quotationValidityDays?: number;

  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class InviteMemberDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(['MANAGER', 'SALES'])
  role!: 'MANAGER' | 'SALES';
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(['OWNER', 'MANAGER', 'SALES'])
  role?: 'OWNER' | 'MANAGER' | 'SALES';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTaxRateDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(10_000)
  rateBp!: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateTaxRateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListTaxRatesQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}
