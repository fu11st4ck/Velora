/** Minor units as a plain decimal string ("364000", 2 → "3640.00"), using integer arithmetic only. */
export function minorToDecimal(minor: bigint, exponent: number): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? '' : `.${digits.slice(-exponent)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

function cell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  // A spreadsheet would run a cell that starts with one of these as a formula.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const BOM = String.fromCharCode(0xfeff);

/** RFC 4180 CSV with a UTF-8 byte-order mark, so spreadsheet apps read non-ASCII names correctly. */
export function toCsv(header: readonly string[], rows: readonly (string | number | null)[][]): Buffer {
  const lines = [header.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))];
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}
