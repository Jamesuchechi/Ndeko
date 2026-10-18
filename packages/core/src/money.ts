/**
 * Money and quantities. No floats, ever.
 *  - Money is an integer number of kobo (1 naira = 100 kobo).
 *  - Quantity is an integer number of milli-units (1000 = 1 unit), so weighed goods work.
 * Rounding happens in exactly one place: lineTotal, half away from zero.
 */

export type Kobo = number;
export type MilliUnits = number;

export const MILLI = 1000;

export function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

/** unitPrice (kobo per whole unit) x quantity (milli-units), rounded half away from zero. */
export function lineTotal(unitPrice: Kobo, quantity: MilliUnits): Kobo {
  assertInteger(unitPrice, 'unitPrice');
  assertInteger(quantity, 'quantity');
  const product = unitPrice * quantity;
  assertInteger(product, 'line total (overflow)');

  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  let whole = Math.floor(abs / MILLI);
  if (abs % MILLI >= MILLI / 2) whole += 1;
  return whole === 0 ? 0 : sign * whole;
}

export function sumKobo(values: readonly Kobo[]): Kobo {
  let total = 0;
  for (const v of values) {
    assertInteger(v, 'amount');
    total += v;
    assertInteger(total, 'sum (overflow)');
  }
  return total;
}

/** Display only. Never parse this back; use parseNairaToKobo for input. */
export function formatNaira(kobo: Kobo): string {
  assertInteger(kobo, 'amount');
  const negative = kobo < 0;
  const abs = Math.abs(kobo);
  const naira = Math.floor(abs / 100);
  const k = String(abs % 100).padStart(2, '0');
  const grouped = String(naira).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}₦${grouped}.${k}`;
}

/** Parse user input like "1,234.50" or "₦500" into kobo. Rejects more than 2 decimal places. */
export function parseNairaToKobo(input: string): Kobo {
  const cleaned = input.replace(/[₦,\s]/g, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new Error(`Invalid naira amount: "${input}"`);
  const [, sign, whole, frac = ''] = match;
  const kobo = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  assertInteger(kobo, 'amount');
  return sign === '-' && kobo !== 0 ? -kobo : kobo;
}
