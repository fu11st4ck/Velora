/** A business or protocol error with a stable machine-readable code (docs/api-error-handling.md). */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: ReadonlyArray<Record<string, unknown>>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const Errors = {
  invalidCredentials: () => new DomainError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.'),
  tokenExpired: () => new DomainError('TOKEN_EXPIRED', 401, 'Your session token has expired.'),
  tokenInvalid: () => new DomainError('TOKEN_INVALID', 401, 'Authentication is required.'),
  sessionRevoked: () => new DomainError('SESSION_REVOKED', 401, 'Your session has ended. Please sign in again.'),
  accountDisabled: () => new DomainError('ACCOUNT_DISABLED', 403, 'This account is disabled.'),
  forbidden: () => new DomainError('FORBIDDEN', 403, 'You do not have permission to do this.'),
  notFound: (what = 'Resource') => new DomainError('NOT_FOUND', 404, `${what} not found.`),
  tooManyAttempts: (retryAfterSeconds: number) =>
    new DomainError('TOO_MANY_ATTEMPTS', 429, 'Too many attempts. Try again later.', [{ retryAfterSeconds }], {
      'Retry-After': String(retryAfterSeconds),
    }),
  resetTokenInvalid: () => new DomainError('RESET_TOKEN_INVALID', 422, 'This reset link is invalid or has expired.'),
  currentPasswordIncorrect: () =>
    new DomainError('CURRENT_PASSWORD_INCORRECT', 422, 'The current password is incorrect.'),
  weakPassword: (rule: string) =>
    new DomainError('WEAK_PASSWORD', 422, 'Choose a stronger password.', [{ field: 'newPassword', rule }]),
  idempotencyKeyRequired: () =>
    new DomainError('IDEMPOTENCY_KEY_REQUIRED', 400, 'An Idempotency-Key header (UUID) is required.'),
  idempotencyKeyReused: () =>
    new DomainError('IDEMPOTENCY_KEY_REUSED', 409, 'This Idempotency-Key was already used with a different request.'),
  validation: (field: string, rule: string) =>
    new DomainError('VALIDATION_ERROR', 400, 'The request is not valid.', [{ field, rule }]),
  versionConflict: (currentVersion: number) =>
    new DomainError('VERSION_CONFLICT', 409, 'This record was changed by someone else. Reload and try again.', [
      { currentVersion },
    ]),
  invalidState: (state: string, message: string) => new DomainError('INVALID_STATE', 409, message, [{ state }]),
  skuTaken: () => new DomainError('SKU_TAKEN', 409, 'Another product already uses this SKU.', [{ field: 'sku' }]),
  barcodeTaken: () =>
    new DomainError('BARCODE_TAKEN', 409, 'Another product already uses this barcode.', [{ field: 'barcode' }]),
  markupPolicyInvalid: (maxMarkupBp: number) =>
    new DomainError(
      'MARKUP_POLICY_INVALID',
      422,
      'Minimum markup must not exceed the default, and the default must not exceed the maximum.',
      [{ maxMarkupBp }],
    ),
  productHasStock: (quantity: number) =>
    new DomainError('PRODUCT_HAS_STOCK', 409, 'A product with stock on hand cannot be archived.', [{ quantity }]),
  productArchived: () => new DomainError('PRODUCT_ARCHIVED', 422, 'This product is archived.'),
  insufficientStock: (details: { productId: string; requested: number; available: number; lineNo?: number }[]) =>
    new DomainError('INSUFFICIENT_STOCK', 409, 'Not enough stock.', details),
  discountExceedsSubtotal: (subtotalMinor: bigint) =>
    new DomainError('DISCOUNT_EXCEEDS_SUBTOTAL', 422, 'The discount cannot be more than the subtotal.', [
      { field: 'discountMinor', subtotalMinor: Number(subtotalMinor) },
    ]),
  taxRateInactive: () => new DomainError('TAX_RATE_INACTIVE', 422, 'This tax rate is not available.', [{ field: 'taxRateId' }]),
  customerArchived: () => new DomainError('CUSTOMER_ARCHIVED', 422, 'This customer is archived.', [{ field: 'customerId' }]),
  quotationAlreadyConverted: (invoiceId: string) =>
    new DomainError('QUOTATION_ALREADY_CONVERTED', 409, 'This quotation was already converted to an invoice.', [{ invoiceId }]),
  paymentExceedsBalance: (balanceMinor: bigint) =>
    new DomainError('PAYMENT_EXCEEDS_BALANCE', 422, 'The amount is more than the balance due.', [
      { field: 'amountMinor', balanceMinor: Number(balanceMinor) },
    ]),
  invoiceAlreadyPaid: () => new DomainError('INVOICE_ALREADY_PAID', 422, 'This invoice is already paid in full.'),
  invoiceCancelled: () => new DomainError('INVOICE_CANCELLED', 409, 'This invoice was cancelled.'),
  invoiceHasReturns: () =>
    new DomainError('INVOICE_HAS_RETURNS', 409, 'An invoice with returns cannot be cancelled. Return the remaining items instead.'),
  refundExceedsPaid: (paidMinor: bigint) =>
    new DomainError('REFUND_EXCEEDS_PAID', 422, 'The refund is more than the amount received.', [
      { field: 'amountMinor', paidMinor: Number(paidMinor) },
    ]),
  refundMethodRequired: (refundMinor: bigint) =>
    new DomainError('REFUND_METHOD_REQUIRED', 422, 'Choose how the money is refunded.', [{ refundMinor: Number(refundMinor) }]),
  returnQuantityExceedsSold: (details: { lineNo: number; requested: number; returnable: number }[]) =>
    new DomainError('RETURN_QUANTITY_EXCEEDS_SOLD', 422, 'More items were selected than can be returned.', details),
} as const;
