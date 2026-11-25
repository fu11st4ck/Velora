import type { ApiFailure } from './api-failure';

/**
 * User-facing text for a failure, keyed by error code so wording never depends on the server's
 * message. Same table as the mobile app (lib/core/api/failure_messages.dart).
 */
export function describeFailure(failure: ApiFailure): string {
  switch (failure.kind) {
    case 'network':
      return 'No connection. Check your internet and try again.';
    case 'timeout':
      return 'The server took too long to respond. Try again.';
    case 'unauthorized':
      return failure.code === 'INVALID_CREDENTIALS' ? 'Email or password is incorrect.' : 'Your session has ended. Please sign in again.';
    case 'forbidden':
      return failure.code === 'ACCOUNT_DISABLED' ? 'This account is disabled. Ask the business owner for access.' : "You don't have access to this.";
    case 'notFound':
      return 'This item no longer exists.';
    case 'rateLimited':
      return `Too many attempts. Try again in ${wait(failure.retryAfterSeconds)}.`;
    case 'validation':
      return 'Some details are not valid. Check the form and try again.';
    case 'business':
      return BUSINESS[failure.code] ?? withNumbers(failure.code, failure.details) ?? weakPassword(failure.code, failure.details) ?? failure.message ?? 'This action could not be completed.';
    case 'server':
      return failure.requestId ? `Something went wrong on our side. Try again. (Ref ${failure.requestId})` : 'Something went wrong on our side. Try again.';
    case 'unexpected':
      return 'Something went wrong. Try again.';
  }
}

const BUSINESS: Record<string, string> = {
  RESET_TOKEN_INVALID: 'This reset link is invalid or has expired. Request a new one.',
  CURRENT_PASSWORD_INCORRECT: 'The current password is incorrect.',
  INVOICE_ALREADY_PAID: 'This invoice is already paid in full.',
  INVOICE_CANCELLED: 'This invoice was cancelled.',
  INVOICE_HAS_RETURNS: 'An invoice with returns cannot be cancelled. Return the remaining items instead.',
  QUOTATION_ALREADY_CONVERTED: 'This quotation was already converted to an invoice.',
  CUSTOMER_ARCHIVED: 'This customer is archived. Choose another customer.',
  TAX_RATE_INACTIVE: 'This tax rate is no longer available. Choose another.',
  PRODUCT_UNAVAILABLE: 'A product in this sale is no longer available.',
  DISCOUNT_EXCEEDS_SUBTOTAL: 'The discount cannot be more than the subtotal.',
  RETURN_QUANTITY_EXCEEDS_SOLD: 'More items were selected than can still be returned.',
  REFUND_METHOD_REQUIRED: 'Choose how the money is refunded.',
  PRICE_BELOW_MINIMUM: 'A price is below the lowest allowed price.',
  PRICE_ABOVE_MAXIMUM: 'A price is above the highest allowed price.',
  SETTING_LOCKED: 'Currency and time zone cannot be changed once prices or documents use them.',
  LAST_OWNER: 'The business needs at least one active owner. Make someone else an owner first.',
  MEMBER_EXISTS: 'This email address already has an account.',
  DUPLICATE_NAME: 'Another tax rate already has this name.',
  DEFAULT_RATE_REQUIRED: 'Choose another default tax rate first.',
  SKU_TAKEN: 'Another product already uses this SKU.',
  BARCODE_TAKEN: 'Another product already uses this barcode.',
  PRODUCT_ARCHIVED: 'This product is archived.',
  VERSION_CONFLICT: 'Someone else changed this product. Reload it and make your change again.',
  IDEMPOTENCY_KEY_REUSED: 'This request could not be repeated. Check whether it was already saved.',
};

const PASSWORD_RULES: Record<string, string> = {
  min_length_10: 'Use at least 10 characters.',
  max_length_200: 'Use at most 200 characters.',
  too_common: 'That password is too common. Choose something less predictable.',
  too_repetitive: 'Use a wider mix of characters.',
  contains_email: 'Do not include your email name in the password.',
};

function weakPassword(code: string, details: Record<string, unknown>[]): string | null {
  if (code !== 'WEAK_PASSWORD') return null;
  const rule = details[0]?.['rule'];
  return (typeof rule === 'string' ? PASSWORD_RULES[rule] : undefined) ?? 'Choose a stronger password.';
}

function wait(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** Messages that quote the numbers the server returned, so the user knows exactly what to change. */
function withNumbers(code: string, details: Record<string, unknown>[]): string | null {
  const d = details[0] ?? {};
  switch (code) {
    case 'INSUFFICIENT_STOCK':
      return typeof d['available'] === 'number' ? `Only ${d['available']} in stock.` : 'Not enough stock.';
    case 'PRODUCT_HAS_STOCK':
      return typeof d['quantity'] === 'number'
        ? `This product still has ${d['quantity']} in stock. Adjust the stock to zero before archiving.`
        : 'A product with stock on hand cannot be archived.';
    case 'MARKUP_POLICY_INVALID': {
      const products = d['productCount'];
      if (typeof products === 'number') {
        return products === 1
          ? 'One product has a default markup above this maximum. Lower it first.'
          : `${products} products have a default markup above this maximum. Lower those first.`;
      }
      const max = d['maxMarkupBp'];
      return typeof max === 'number'
        ? `Minimum markup must not exceed the default, and the default must not exceed ${Math.trunc(max / 100)}%.`
        : 'Minimum markup must not exceed the default markup.';
    }
  }
  return null;
}
