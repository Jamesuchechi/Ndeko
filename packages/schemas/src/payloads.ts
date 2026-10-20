/**
 * Payload schemas, one per (event type, schemaV). See ARCHITECTURE.md sections 4, 8, 10.
 *
 * Money is integer kobo, quantities are integer milli-units. No floats anywhere.
 */
import { lineTotal, sumKobo } from '@ndeko/core';
import { z } from 'zod';

const id = z.string().min(1).max(64);
const note = z.string().max(500);
const kobo = z.number().int().nonnegative();
const positiveKobo = z.number().int().positive();
/** Positive quantity in milli-units (1000 = 1 unit). */
const qty = z.number().int().positive();

export const UNITS = ['each', 'kg', 'g', 'litre', 'ml', 'pack', 'carton'] as const;
export const TENDER_METHODS = ['CASH', 'TRANSFER', 'CARD', 'CREDIT'] as const;
export const ADJUST_REASONS = ['COUNT', 'DAMAGE', 'EXPIRY', 'THEFT', 'OTHER'] as const;

/**
 * Partial update: only `productId` is required so each field can be
 * last-writer-wins by HLC independently. `barcode: null` clears the barcode.
 */
export const productUpsertedV1 = z
  .object({
    productId: id,
    name: z.string().trim().min(1).max(120).optional(),
    barcode: z.string().trim().min(1).max(64).nullable().optional(),
    priceKobo: kobo.optional(),
    costKobo: kobo.optional(),
    minStockQty: kobo.optional(),
    unit: z.enum(UNITS).optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const customerUpsertedV1 = z
  .object({
    customerId: id,
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().max(30).optional(),
    creditLimitKobo: kobo.optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const stockReceivedV1 = z
  .object({
    productId: id,
    qty,
    unitCostKobo: kobo.optional(),
    supplierId: id.optional(),
    note: note.optional(),
  })
  .strict();

export const stockAdjustedV1 = z
  .object({
    productId: id,
    /** Signed change. Zero is meaningless and rejected. */
    qtyDelta: z
      .number()
      .int()
      .refine((n) => n !== 0, 'qtyDelta must be non-zero'),
    reason: z.enum(ADJUST_REASONS),
    note: note.optional(),
  })
  .strict();

const saleLine = z
  .object({
    productId: id,
    qty,
    unitPriceKobo: kobo,
    lineTotalKobo: kobo,
  })
  .strict()
  .refine(
    // Zod still runs refinements after field-level failures, and lineTotal throws on
    // non-integers, so only compare when the inputs are already valid integers.
    (l) =>
      !Number.isSafeInteger(l.unitPriceKobo) ||
      !Number.isSafeInteger(l.qty) ||
      l.lineTotalKobo === lineTotal(l.unitPriceKobo, l.qty),
    {
      message: 'lineTotalKobo does not match unitPriceKobo x qty',
      path: ['lineTotalKobo'],
    },
  );

const tender = z
  .object({
    method: z.enum(TENDER_METHODS),
    amountKobo: positiveKobo,
  })
  .strict();

export const saleRecordedV1 = z
  .object({
    saleId: id,
    receiptNo: z.string().min(1).max(40),
    lines: z.array(saleLine).min(1).max(500),
    tenders: z.array(tender).min(1).max(8),
    totalKobo: kobo,
    customerId: id.optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const amounts = [
      s.totalKobo,
      ...s.lines.map((l) => l.lineTotalKobo),
      ...s.tenders.map((t) => t.amountKobo),
    ];
    // Field-level checks already reported these; sumKobo would throw on non-integers.
    if (!amounts.every((n) => Number.isSafeInteger(n))) return;
    if (sumKobo(s.lines.map((l) => l.lineTotalKobo)) !== s.totalKobo) {
      ctx.addIssue({
        code: 'custom',
        path: ['totalKobo'],
        message: 'totalKobo must equal the sum of line totals',
      });
    }
    if (sumKobo(s.tenders.map((t) => t.amountKobo)) !== s.totalKobo) {
      ctx.addIssue({
        code: 'custom',
        path: ['tenders'],
        message: 'tenders must sum to totalKobo',
      });
    }
    if (s.tenders.some((t) => t.method === 'CREDIT') && s.customerId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'a credit tender requires a customer',
      });
    }
  });

export const saleVoidedV1 = z
  .object({
    saleId: id,
    reason: z.string().trim().min(1).max(200),
  })
  .strict();

export const paymentReceivedV1 = z
  .object({
    paymentId: id,
    customerId: id,
    amountKobo: positiveKobo,
    method: z.enum(['CASH', 'TRANSFER', 'CARD']),
    note: note.optional(),
  })
  .strict();

const transferLine = z.object({ productId: id, qty }).strict();

export const stockTransferSentV1 = z
  .object({
    transferId: id,
    toBranchId: id,
    lines: z.array(transferLine).min(1).max(500),
  })
  .strict();

export const stockTransferReceivedV1 = z
  .object({
    transferId: id,
    fromBranchId: id,
    lines: z.array(transferLine).min(1).max(500),
  })
  .strict();

export const dayClosedV1 = z
  .object({
    /** Local business date, YYYY-MM-DD. */
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    expectedCashKobo: kobo,
    countedCashKobo: kobo,
    note: note.optional(),
  })
  .strict();

export type ProductUpsertedV1 = z.infer<typeof productUpsertedV1>;
export type CustomerUpsertedV1 = z.infer<typeof customerUpsertedV1>;
export type StockReceivedV1 = z.infer<typeof stockReceivedV1>;
export type StockAdjustedV1 = z.infer<typeof stockAdjustedV1>;
export type SaleRecordedV1 = z.infer<typeof saleRecordedV1>;
export type SaleVoidedV1 = z.infer<typeof saleVoidedV1>;
export type PaymentReceivedV1 = z.infer<typeof paymentReceivedV1>;
export type StockTransferSentV1 = z.infer<typeof stockTransferSentV1>;
export type StockTransferReceivedV1 = z.infer<typeof stockTransferReceivedV1>;
export type DayClosedV1 = z.infer<typeof dayClosedV1>;
