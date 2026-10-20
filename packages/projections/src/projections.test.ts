import { formatHlc, foldEvents, uuidv7, type EventType, type NdekoEvent } from '@ndeko/core';
import { describe, expect, it } from 'vitest';
import { findByBarcode, productsProjection, productView } from './products';
import { negativeStock, stockLevel, stockProjection } from './stock';

let n = 0;
function ev(
  type: EventType,
  payload: unknown,
  o: { branchId?: string; deviceId?: string; wall?: number } = {},
): NdekoEvent {
  const deviceId = o.deviceId ?? 'dev1';
  n++;
  return {
    id: uuidv7(),
    orgId: 'org1',
    branchId: o.branchId ?? 'br1',
    deviceId,
    seq: n,
    hlc: formatHlc(o.wall ?? 1_700_000_000_000 + n, 0, deviceId),
    type,
    schemaV: 1,
    payload,
    createdAt: 0,
  };
}

const receive = (productId: string, qty: number, o = {}) =>
  ev('STOCK_RECEIVED', { productId, qty }, o);
const sale = (saleId: string, productId: string, qty: number, o = {}) =>
  ev(
    'SALE_RECORDED',
    {
      saleId,
      receiptNo: `R-${saleId}`,
      lines: [{ productId, qty, unitPriceKobo: 1000, lineTotalKobo: (1000 * qty) / 1000 }],
      tenders: [{ method: 'CASH', amountKobo: (1000 * qty) / 1000 }],
      totalKobo: (1000 * qty) / 1000,
    },
    o,
  );
const voidSale = (saleId: string, o = {}) => ev('SALE_VOIDED', { saleId, reason: 'mistake' }, o);

/** Deterministic Fisher-Yates using a small LCG so failures are reproducible. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const a = [...items];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

describe('stock projection', () => {
  it('sums receipts, adjustments and sales per branch', () => {
    const s = foldEvents(stockProjection, [
      receive('p1', 10_000),
      ev('STOCK_ADJUSTED', { productId: 'p1', qtyDelta: -1000, reason: 'DAMAGE' }),
      sale('s1', 'p1', 2000),
      receive('p1', 5000, { branchId: 'br2' }),
    ]);
    expect(stockLevel(s, 'br1', 'p1')).toBe(7000);
    expect(stockLevel(s, 'br2', 'p1')).toBe(5000);
    expect(stockLevel(s, 'br1', 'unknown')).toBe(0);
  });

  it('voiding a sale restores stock', () => {
    const s = foldEvents(stockProjection, [
      receive('p1', 5000),
      sale('s1', 'p1', 2000),
      voidSale('s1'),
    ]);
    expect(stockLevel(s, 'br1', 'p1')).toBe(5000);
  });

  it('a void that arrives before its sale nets to zero', () => {
    const s = foldEvents(stockProjection, [
      receive('p1', 5000),
      voidSale('s1'),
      sale('s1', 'p1', 2000),
    ]);
    expect(stockLevel(s, 'br1', 'p1')).toBe(5000);
  });

  it('a duplicate void or duplicate sale id does not double-apply', () => {
    const s = foldEvents(stockProjection, [
      receive('p1', 5000),
      sale('s1', 'p1', 2000),
      sale('s1', 'p1', 2000),
      voidSale('s1'),
      voidSale('s1'),
    ]);
    expect(stockLevel(s, 'br1', 'p1')).toBe(5000);
  });

  it('two tills selling the last unit both stand and raise a negative-stock flag', () => {
    const s = foldEvents(stockProjection, [
      receive('p1', 1000),
      sale('a', 'p1', 1000, { deviceId: 'tillA' }),
      sale('b', 'p1', 1000, { deviceId: 'tillB' }),
    ]);
    expect(stockLevel(s, 'br1', 'p1')).toBe(-1000);
    expect(negativeStock(s)).toEqual([{ branchId: 'br1', productId: 'p1', qty: -1000 }]);
  });

  it('the flag clears once stock is received', () => {
    const s = foldEvents(stockProjection, [sale('a', 'p1', 1000), receive('p1', 3000)]);
    expect(negativeStock(s)).toEqual([]);
  });

  it('transfers move stock between branches', () => {
    const lines = [{ productId: 'p1', qty: 2000 }];
    const s = foldEvents(stockProjection, [
      receive('p1', 5000),
      ev('STOCK_TRANSFER_SENT', { transferId: 't1', toBranchId: 'br2', lines }),
      ev(
        'STOCK_TRANSFER_RECEIVED',
        { transferId: 't1', fromBranchId: 'br1', lines },
        { branchId: 'br2' },
      ),
    ]);
    expect(stockLevel(s, 'br1', 'p1')).toBe(3000);
    expect(stockLevel(s, 'br2', 'p1')).toBe(2000);
  });

  it('ignores invalid events instead of throwing', () => {
    const bad = ev('STOCK_RECEIVED', { productId: 'p1', qty: -5 });
    const s = foldEvents(stockProjection, [bad, receive('p1', 1000)]);
    expect(stockLevel(s, 'br1', 'p1')).toBe(1000);
  });

  it('is order-independent: every shuffle yields identical state', () => {
    const events = [
      receive('p1', 10_000),
      receive('p2', 4000, { branchId: 'br2' }),
      sale('s1', 'p1', 3000),
      sale('s2', 'p1', 1000, { deviceId: 'dev2' }),
      sale('s3', 'p2', 5000, { branchId: 'br2', deviceId: 'dev3' }),
      voidSale('s1'),
      voidSale('s3', { deviceId: 'dev3' }),
      ev('STOCK_ADJUSTED', { productId: 'p1', qtyDelta: -500, reason: 'COUNT' }),
      sale('s1', 'p1', 3000), // duplicate sale id
    ];
    const expected = foldEvents(stockProjection, events);
    for (let seed = 1; seed <= 200; seed++) {
      expect(foldEvents(stockProjection, shuffle(events, seed))).toEqual(expected);
    }
  });
});

describe('products projection', () => {
  const upsert = (payload: object, wall: number, deviceId = 'dev1') =>
    ev('PRODUCT_UPSERTED', { productId: 'p1', ...payload }, { wall, deviceId });

  it('applies partial updates field by field', () => {
    const s = foldEvents(productsProjection, [
      upsert({ name: 'Rice 1kg', priceKobo: 150_000, barcode: '123' }, 1_000),
      upsert({ priceKobo: 160_000 }, 2_000),
    ]);
    expect(productView(s, 'p1')).toMatchObject({
      name: 'Rice 1kg',
      priceKobo: 160_000,
      barcode: '123',
      archived: false,
    });
  });

  it('older write arriving late does not overwrite a newer one', () => {
    const s = foldEvents(productsProjection, [
      upsert({ priceKobo: 200 }, 2_000),
      upsert({ priceKobo: 100 }, 1_000),
    ]);
    expect(productView(s, 'p1')?.priceKobo).toBe(200);
  });

  it('concurrent edits to different fields both survive', () => {
    const s = foldEvents(productsProjection, [
      upsert({ name: 'A' }, 1_000, 'devA'),
      upsert({ priceKobo: 500 }, 1_001, 'devB'),
    ]);
    expect(productView(s, 'p1')).toMatchObject({ name: 'A', priceKobo: 500 });
  });

  it('null clears the barcode and archived hides it from lookup', () => {
    let s = foldEvents(productsProjection, [upsert({ barcode: '999' }, 1_000)]);
    expect(findByBarcode(s, '999')?.productId).toBe('p1');
    s = foldEvents(productsProjection, [upsert({ archived: true }, 2_000)], s);
    expect(findByBarcode(s, '999')).toBeUndefined();
    s = foldEvents(productsProjection, [upsert({ barcode: null, archived: false }, 3_000)], s);
    expect(productView(s, 'p1')?.barcode).toBeNull();
    expect(findByBarcode(s, '999')).toBeUndefined();
  });

  it('is order-independent: every shuffle yields identical state', () => {
    const events = [
      upsert({ name: 'A', priceKobo: 1 }, 1_000, 'devA'),
      upsert({ name: 'B' }, 2_000, 'devB'),
      upsert({ priceKobo: 3, unit: 'kg' }, 3_000, 'devA'),
      upsert({ barcode: '1' }, 2_500, 'devC'),
      upsert({ barcode: null }, 2_600, 'devC'),
      upsert({ archived: true }, 2_700, 'devB'),
    ];
    const expected = foldEvents(productsProjection, events);
    for (let seed = 1; seed <= 200; seed++) {
      expect(foldEvents(productsProjection, shuffle(events, seed))).toEqual(expected);
    }
  });

  it('productView is undefined for unknown ids', () => {
    expect(productView(productsProjection.init(), 'nope')).toBeUndefined();
  });
});
