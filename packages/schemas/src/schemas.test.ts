import { formatHlc, uuidv7, type EventType } from '@ndeko/core';
import { describe, expect, it } from 'vitest';
import { parseEvent, upcastPayload, LATEST_SCHEMA_V, type UpcasterTable } from './registry';

function envelope(type: EventType, payload: unknown, over: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    orgId: 'org1',
    branchId: 'br1',
    deviceId: 'dev1',
    seq: 0,
    hlc: formatHlc(1_700_000_000_000, 0, 'dev1'),
    type,
    schemaV: 1,
    payload,
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

const validSale = {
  saleId: 's1',
  receiptNo: 'ABJ1-D1-000001',
  lines: [{ productId: 'p1', qty: 2000, unitPriceKobo: 15000, lineTotalKobo: 30000 }],
  tenders: [{ method: 'CASH', amountKobo: 30000 }],
  totalKobo: 30000,
};

describe('parseEvent: envelope', () => {
  it('accepts a valid event', () => {
    const r = parseEvent(envelope('SALE_RECORDED', validSale));
    expect(r.ok).toBe(true);
  });

  it('rejects a non-UUIDv7 id', () => {
    const r = parseEvent(envelope('SALE_RECORDED', validSale, { id: 'nope' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed hlc', () => {
    expect(parseEvent(envelope('SALE_RECORDED', validSale, { hlc: 'x' })).ok).toBe(false);
  });

  it('rejects unknown event types and extra envelope fields', () => {
    expect(parseEvent(envelope('NOPE' as EventType, {})).ok).toBe(false);
    expect(parseEvent(envelope('SALE_VOIDED', { saleId: 's', reason: 'r' }, { x: 1 })).ok).toBe(
      false,
    );
  });

  it('rejects non-objects without throwing', () => {
    expect(parseEvent(null).ok).toBe(false);
    expect(parseEvent('string').ok).toBe(false);
  });

  it('rejects an unknown or future schemaV', () => {
    expect(parseEvent(envelope('SALE_RECORDED', validSale, { schemaV: 99 })).ok).toBe(false);
    expect(parseEvent(envelope('SALE_RECORDED', validSale, { schemaV: 0 })).ok).toBe(false);
  });
});

describe('SALE_RECORDED', () => {
  const bad = (patch: Record<string, unknown>) =>
    parseEvent(envelope('SALE_RECORDED', { ...validSale, ...patch }));

  it('rejects floats in money and quantity', () => {
    expect(bad({ totalKobo: 300.5 }).ok).toBe(false);
    expect(
      bad({ lines: [{ productId: 'p1', qty: 1.5, unitPriceKobo: 100, lineTotalKobo: 150 }] }).ok,
    ).toBe(false);
  });

  it('rejects a line total that disagrees with price x qty', () => {
    const lines = [{ productId: 'p1', qty: 2000, unitPriceKobo: 15000, lineTotalKobo: 1 }];
    expect(bad({ lines }).ok).toBe(false);
  });

  it('rejects total that does not equal the sum of lines', () => {
    expect(bad({ totalKobo: 31000, tenders: [{ method: 'CASH', amountKobo: 31000 }] }).ok).toBe(
      false,
    );
  });

  it('rejects tenders that do not sum to the total', () => {
    expect(bad({ tenders: [{ method: 'CASH', amountKobo: 100 }] }).ok).toBe(false);
  });

  it('accepts split tenders', () => {
    const tenders = [
      { method: 'CASH', amountKobo: 10000 },
      { method: 'TRANSFER', amountKobo: 20000 },
    ];
    expect(bad({ tenders }).ok).toBe(true);
  });

  it('requires a customer for a credit tender', () => {
    const tenders = [{ method: 'CREDIT', amountKobo: 30000 }];
    expect(bad({ tenders }).ok).toBe(false);
    expect(bad({ tenders, customerId: 'c1' }).ok).toBe(true);
  });

  it('rejects an empty cart', () => {
    expect(bad({ lines: [], totalKobo: 0, tenders: [] }).ok).toBe(false);
  });
});

describe('other payloads', () => {
  it('PRODUCT_UPSERTED allows partial updates and clearing the barcode', () => {
    expect(parseEvent(envelope('PRODUCT_UPSERTED', { productId: 'p1', priceKobo: 500 })).ok).toBe(
      true,
    );
    expect(parseEvent(envelope('PRODUCT_UPSERTED', { productId: 'p1', barcode: null })).ok).toBe(
      true,
    );
    expect(parseEvent(envelope('PRODUCT_UPSERTED', { productId: 'p1', priceKobo: 1.5 })).ok).toBe(
      false,
    );
  });

  it('STOCK_ADJUSTED requires a reason and a non-zero delta', () => {
    const ok = { productId: 'p1', qtyDelta: -1000, reason: 'DAMAGE' };
    expect(parseEvent(envelope('STOCK_ADJUSTED', ok)).ok).toBe(true);
    expect(parseEvent(envelope('STOCK_ADJUSTED', { ...ok, reason: undefined })).ok).toBe(false);
    expect(parseEvent(envelope('STOCK_ADJUSTED', { ...ok, qtyDelta: 0 })).ok).toBe(false);
  });

  it('STOCK_RECEIVED requires positive quantity', () => {
    expect(parseEvent(envelope('STOCK_RECEIVED', { productId: 'p1', qty: 0 })).ok).toBe(false);
    expect(parseEvent(envelope('STOCK_RECEIVED', { productId: 'p1', qty: 5000 })).ok).toBe(true);
  });

  it('SALE_VOIDED requires a reason', () => {
    expect(parseEvent(envelope('SALE_VOIDED', { saleId: 's1', reason: '' })).ok).toBe(false);
  });

  it('PAYMENT_RECEIVED rejects CREDIT as a repayment method', () => {
    const p = { paymentId: 'pay1', customerId: 'c1', amountKobo: 100, method: 'CREDIT' };
    expect(parseEvent(envelope('PAYMENT_RECEIVED', p)).ok).toBe(false);
  });

  it('DAY_CLOSED validates the business date', () => {
    const p = { businessDate: '2026-10-20', expectedCashKobo: 100, countedCashKobo: 90 };
    expect(parseEvent(envelope('DAY_CLOSED', p)).ok).toBe(true);
    expect(parseEvent(envelope('DAY_CLOSED', { ...p, businessDate: '20/10/2026' })).ok).toBe(false);
  });

  it('transfer events accept valid lines', () => {
    const lines = [{ productId: 'p1', qty: 1000 }];
    expect(
      parseEvent(envelope('STOCK_TRANSFER_SENT', { transferId: 't1', toBranchId: 'b2', lines })).ok,
    ).toBe(true);
    expect(
      parseEvent(
        envelope('STOCK_TRANSFER_RECEIVED', { transferId: 't1', fromBranchId: 'b1', lines }),
      ).ok,
    ).toBe(true);
  });
});

describe('upcasting', () => {
  const table: UpcasterTable = {
    SALE_VOIDED: {
      1: (p) => ({ ...(p as object), reason: (p as { reason?: string }).reason ?? 'unspecified' }),
      2: (p) => ({ ...(p as object), upgraded: true }),
    },
  };

  it('is a no-op when already at latest', () => {
    const r = upcastPayload('SALE_VOIDED', 1, { a: 1 }, table, 1);
    expect(r).toEqual({ ok: true, payload: { a: 1 }, schemaV: 1 });
  });

  it('chains steps in order from the stored version', () => {
    const r = upcastPayload('SALE_VOIDED', 1, { saleId: 's' }, table, 3);
    expect(r).toEqual({
      ok: true,
      payload: { saleId: 's', reason: 'unspecified', upgraded: true },
      schemaV: 3,
    });
  });

  it('fails when a step is missing', () => {
    expect(upcastPayload('SALE_RECORDED', 1, {}, table, 2).ok).toBe(false);
  });

  it('fails for versions newer than supported', () => {
    expect(upcastPayload('SALE_VOIDED', 5, {}, table, 3).ok).toBe(false);
  });

  it('every event type has a latest version with a registered schema', () => {
    for (const v of Object.values(LATEST_SCHEMA_V)) expect(v).toBeGreaterThanOrEqual(1);
  });
});
