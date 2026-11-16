import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { Errors } from '../common/errors';

/**
 * Normalizes a typed phone number to E.164 (`+971501234567`). A number without a country prefix is
 * read as belonging to the organization's country. Returns null when it is not a valid number.
 */
export function toE164(input: string, defaultCountry: string | null): string | null {
  const parsed = parsePhoneNumberFromString(input, (defaultCountry ?? undefined) as CountryCode | undefined);
  return parsed?.isValid() ? parsed.number : null;
}

/** Normalizes or throws a validation error on the `mobile` field. */
export function requireE164(input: string, defaultCountry: string | null): string {
  const number = toE164(input, defaultCountry);
  if (!number) throw Errors.validation('mobile', 'phone');
  return number;
}
