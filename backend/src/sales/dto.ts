import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_MINOR, MAX_QUANTITY } from '../catalog/dto';
import { MAX_LIMIT } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER'] as const;
export type PaymentMethodDto = (typeof PAYMENT_METHODS)[number];

export class LineDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity!: number;

  /** The price the customer pays per item. The server validates it against the product's limits. */
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  unitPriceMinor!: number;

  /** Manager/Owner only: required to sell below the product's lowest price. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  belowMinimumReason?: string | null;
}

class DocumentBaseDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  discountMinor?: number;

  @IsOptional()
  @IsUUID()
  taxRateId?: string;
}

export class PricingPreviewDto extends DocumentBaseDto {}

export class CreateQuotationDto extends DocumentBaseDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  customerId!: string;

  @IsOptional()
  @Matches(DATE)
  validUntil?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class FirstPaymentDto {
  @IsInt()
  @Min(1)
  @Max(MAX_MINOR)
  amountMinor!: number;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethodDto;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  reference?: string | null;
}

export class CreateInvoiceDto extends DocumentBaseDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsUUID()
  quotationId?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  /** Money received now. Omit for a credit sale. */
  @IsOptional()
  @ValidateNested()
  @Type(() => FirstPaymentDto)
  payment?: FirstPaymentDto | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  creditDays?: number | null;

  @IsOptional()
  @Matches(DATE)
  dueDate?: string | null;
}

export class RecordPaymentDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsInt()
  @Min(1)
  @Max(MAX_MINOR)
  amountMinor!: number;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethodDto;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  receivedAt?: string;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  note?: string | null;
}

export class RecordRefundDto {
  @IsInt()
  @Min(1)
  @Max(MAX_MINOR)
  amountMinor!: number;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethodDto;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  note!: string;
}

export class CancelInvoiceDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  refundMethod?: PaymentMethodDto;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  refundReference?: string | null;
}

export class CancelQuotationDto {
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(240)
  reason?: string | null;
}

export class ReturnLineDto {
  @IsInt()
  @Min(1)
  lineNo!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity!: number;

  /** False for damaged items that do not go back to sellable stock. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
}

export class RefundChoiceDto {
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethodDto;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(80)
  reference?: string | null;
}

export class CreateReturnDto {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RefundChoiceDto)
  refund?: RefundChoiceDto | null;
}

export const DOCUMENT_STATUSES = [
  'paid',
  'partial',
  'unpaid',
  'overdue',
  'cancelled',
  'quotation_open',
  'quotation_converted',
  'quotation_expired',
  'quotation_cancelled',
] as const;
export type DocumentStatusFilter = (typeof DOCUMENT_STATUSES)[number];

export class ListDocumentsQuery {
  @IsOptional()
  @IsIn(['invoice', 'quotation'])
  type?: 'invoice' | 'quotation';

  /** Repeatable or comma-separated. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()).filter(Boolean),
  )
  @IsArray()
  @IsIn(DOCUMENT_STATUSES, { each: true })
  status?: DocumentStatusFilter[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  salespersonId?: string;

  @IsOptional()
  @Matches(DATE)
  from?: string;

  @IsOptional()
  @Matches(DATE)
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
