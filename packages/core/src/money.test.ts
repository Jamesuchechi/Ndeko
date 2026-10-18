import { describe, expect, it } from 'vitest';
import { formatNaira, lineTotal, parseNairaToKobo, sumKobo } from './money';

describe('lineTotal', () => {
  it('multiplies whole units exactly', () => {
    expect(lineTotal(250_00, 3_000)).toBe(750_00);
  });

  it('handles fractional quantities with a single rounding rule', () => {
    expect(lineTotal(10_00, 1_500)).toBe(15_00); // 1.5 units
    expect(lineTotal(333, 1_500)).toBe(500); // 499.5 rounds half up
    expect(lineTotal(333, 1_499)).toBe(499); // 499.167 rounds down
  });

  it('rounds half away from zero for negatives (voids)', () => {
    expect(lineTotal(333, -1_500)).toBe(-500);
    expect(lineTotal(1, -1)).toBe(0);
    expect(Object.is(lineTotal(1, -1), -0)).toBe(false);
  });

  it('rejects floats and overflow', () => {
    expect(() => lineTotal(10.5, 1_000)).toThrow(RangeError);
    expect(() => lineTotal(1_000, 1.5)).toThrow(RangeError);
    expect(() => lineTotal(Number.MAX_SAFE_INTEGER, 2_000)).toThrow(RangeError);
  });
});

describe('sumKobo', () => {
  it('sums exactly where floats would drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the bug we are avoiding
    expect(sumKobo([10, 20])).toBe(30);
    expect(sumKobo([])).toBe(0);
  });

  it('rejects non-integers', () => {
    expect(() => sumKobo([1, 0.5])).toThrow(RangeError);
  });
});

describe('formatNaira', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatNaira(0)).toBe('₦0.00');
    expect(formatNaira(5)).toBe('₦0.05');
    expect(formatNaira(123_450)).toBe('₦1,234.50');
    expect(formatNaira(1_000_000_00)).toBe('₦1,000,000.00');
    expect(formatNaira(-250_00)).toBe('-₦250.00');
  });
});

describe('parseNairaToKobo', () => {
  it('parses common input forms', () => {
    expect(parseNairaToKobo('1,234.50')).toBe(123_450);
    expect(parseNairaToKobo('₦500')).toBe(50_000);
    expect(parseNairaToKobo('0.5')).toBe(50);
    expect(parseNairaToKobo('-10.05')).toBe(-1_005);
  });

  it('round-trips with formatNaira', () => {
    for (const k of [0, 1, 99, 100, 123_456_789]) {
      expect(parseNairaToKobo(formatNaira(k))).toBe(k);
    }
  });

  it('rejects ambiguous input', () => {
    expect(() => parseNairaToKobo('1.234')).toThrow();
    expect(() => parseNairaToKobo('abc')).toThrow();
    expect(() => parseNairaToKobo('')).toThrow();
  });
});
