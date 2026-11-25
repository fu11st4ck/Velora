import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { parseMoney } from '../../core/money/money';
import { parsePercent } from '../../core/money/pricing';

/**
 * Money and percentage fields are plain text inputs: what the user types stays as typed, and these
 * validators (with parseMoney / parsePercent) turn it into integers — never floating point.
 */
export function moneyValidator(exponent: () => number, options: { required?: boolean; min?: number } = {}): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const text = (control.value ?? '').trim();
    if (!text) return options.required ? { required: true } : null;
    const minor = parseMoney(text, { exponent: exponent() });
    if (minor === null) return { money: true };
    if (options.min !== undefined && minor < options.min) return { min: { min: options.min } };
    return null;
  };
}

export function percentValidator(options: { required?: boolean; max?: () => number | null } = {}): ValidatorFn {
  return (control: AbstractControl<string>): ValidationErrors | null => {
    const text = (control.value ?? '').trim();
    if (!text) return options.required ? { required: true } : null;
    const bp = parsePercent(text);
    if (bp === null) return { percent: true };
    const max = options.max?.();
    if (max !== null && max !== undefined && bp > max) return { maxPercent: { max } };
    return null;
  };
}

/** A whole number within bounds (quantities, reorder levels). */
export function wholeNumber(options: { required?: boolean; min?: number; max?: number } = {}): ValidatorFn {
  return (control: AbstractControl<string | number | null>): ValidationErrors | null => {
    const text = String(control.value ?? '').trim();
    if (!text) return options.required ? { required: true } : null;
    if (!/^-?\d+$/.test(text)) return { whole: true };
    const n = Number(text);
    if (options.min !== undefined && n < options.min) return { min: { min: options.min } };
    if (options.max !== undefined && n > options.max) return { max: { max: options.max } };
    return null;
  };
}
