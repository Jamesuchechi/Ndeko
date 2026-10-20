/**
 * Schema registry and upcasters.
 *
 * Old events are never rewritten. On read they are upcast, one version step at a
 * time, to the latest payload shape. See ARCHITECTURE.md section 4, rule 3.
 */
import { EVENT_TYPES, isHlc, isUuidV7, type EventType, type NdekoEvent } from '@ndeko/core';
import { z } from 'zod';
import {
  dayClosedV1,
  paymentReceivedV1,
  productUpsertedV1,
  saleRecordedV1,
  saleVoidedV1,
  stockAdjustedV1,
  stockReceivedV1,
  stockTransferReceivedV1,
  stockTransferSentV1,
  type DayClosedV1,
  type PaymentReceivedV1,
  type ProductUpsertedV1,
  type SaleRecordedV1,
  type SaleVoidedV1,
  type StockAdjustedV1,
  type StockReceivedV1,
  type StockTransferReceivedV1,
  type StockTransferSentV1,
} from './payloads';

/** Latest payload type per event type. */
export interface EventPayloads {
  PRODUCT_UPSERTED: ProductUpsertedV1;
  STOCK_RECEIVED: StockReceivedV1;
  STOCK_ADJUSTED: StockAdjustedV1;
  SALE_RECORDED: SaleRecordedV1;
  SALE_VOIDED: SaleVoidedV1;
  PAYMENT_RECEIVED: PaymentReceivedV1;
  STOCK_TRANSFER_SENT: StockTransferSentV1;
  STOCK_TRANSFER_RECEIVED: StockTransferReceivedV1;
  DAY_CLOSED: DayClosedV1;
}

/** An event whose type and payload have been validated and upcast to latest. */
export type TypedEvent<T extends EventType = EventType> = {
  [K in T]: Omit<NdekoEvent<EventPayloads[K]>, 'type'> & { readonly type: K };
}[T];

/** Payload schema for every known (type, schemaV). Append new versions, never edit old ones. */
const PAYLOAD_SCHEMAS: Record<EventType, Readonly<Record<number, z.ZodTypeAny>>> = {
  PRODUCT_UPSERTED: { 1: productUpsertedV1 },
  STOCK_RECEIVED: { 1: stockReceivedV1 },
  STOCK_ADJUSTED: { 1: stockAdjustedV1 },
  SALE_RECORDED: { 1: saleRecordedV1 },
  SALE_VOIDED: { 1: saleVoidedV1 },
  PAYMENT_RECEIVED: { 1: paymentReceivedV1 },
  STOCK_TRANSFER_SENT: { 1: stockTransferSentV1 },
  STOCK_TRANSFER_RECEIVED: { 1: stockTransferReceivedV1 },
  DAY_CLOSED: { 1: dayClosedV1 },
};

/** Latest payload version per event type. Bump when a new schema version is added. */
export const LATEST_SCHEMA_V: Readonly<Record<EventType, number>> = {
  PRODUCT_UPSERTED: 1,
  STOCK_RECEIVED: 1,
  STOCK_ADJUSTED: 1,
  SALE_RECORDED: 1,
  SALE_VOIDED: 1,
  PAYMENT_RECEIVED: 1,
  STOCK_TRANSFER_SENT: 1,
  STOCK_TRANSFER_RECEIVED: 1,
  DAY_CLOSED: 1,
};

/** An upcaster turns a payload of version N into version N+1. Pure and total. */
export type Upcaster = (payload: unknown) => unknown;
export type UpcasterTable = Partial<Record<EventType, Readonly<Record<number, Upcaster>>>>;

/** Registered upcasters, keyed by the version they upgrade FROM. Empty until v2 exists. */
export const UPCASTERS: UpcasterTable = {};

export type UpcastResult =
  | { readonly ok: true; readonly payload: unknown; readonly schemaV: number }
  | { readonly ok: false; readonly error: string };

/**
 * Walk a payload from `fromV` up to `latest` using the upcaster chain.
 * Fails (never throws) if a step in the chain is missing.
 */
export function upcastPayload(
  type: EventType,
  fromV: number,
  payload: unknown,
  table: UpcasterTable = UPCASTERS,
  latest: number = LATEST_SCHEMA_V[type],
): UpcastResult {
  if (!Number.isInteger(fromV) || fromV < 1) {
    return { ok: false, error: `invalid schemaV ${String(fromV)}` };
  }
  if (fromV > latest) {
    return { ok: false, error: `schemaV ${fromV} is newer than supported (${latest})` };
  }
  let current = payload;
  for (let v = fromV; v < latest; v++) {
    const step = table[type]?.[v];
    if (step === undefined) {
      return { ok: false, error: `no upcaster for ${type} v${v} -> v${v + 1}` };
    }
    current = step(current);
  }
  return { ok: true, payload: current, schemaV: latest };
}

const nonNegInt = z.number().int().nonnegative();

/** Envelope validation. The payload is validated separately per (type, schemaV). */
export const eventEnvelopeSchema = z
  .object({
    id: z.string().refine(isUuidV7, 'id must be a UUIDv7'),
    orgId: z.string().min(1).max(64),
    branchId: z.string().min(1).max(64),
    deviceId: z.string().min(1).max(64),
    seq: nonNegInt,
    hlc: z.string().refine(isHlc, 'hlc is malformed'),
    type: z.enum(EVENT_TYPES),
    schemaV: z.number().int().positive(),
    payload: z.unknown(),
    createdAt: nonNegInt,
  })
  .strict();

export type ParseEventResult =
  | { readonly ok: true; readonly event: TypedEvent }
  | { readonly ok: false; readonly error: string };

/**
 * Validate an untrusted event end to end: envelope, payload for its declared
 * version, then upcast to the latest payload shape.
 *
 * Returns a result instead of throwing so the server can report a per-event
 * error without failing the whole batch (ARCHITECTURE.md section 4, rule 4).
 */
export function parseEvent(raw: unknown, table: UpcasterTable = UPCASTERS): ParseEventResult {
  const env = eventEnvelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, error: formatIssues(env.error) };
  const e = env.data;

  const schema = PAYLOAD_SCHEMAS[e.type][e.schemaV];
  if (schema === undefined) {
    return { ok: false, error: `unknown schemaV ${e.schemaV} for ${e.type}` };
  }
  const parsed = schema.safeParse(e.payload);
  if (!parsed.success) return { ok: false, error: `payload: ${formatIssues(parsed.error)}` };

  const up = upcastPayload(e.type, e.schemaV, parsed.data, table);
  if (!up.ok) return up;

  // Cast is safe: payload was validated against the schema for its version and
  // upcast to the latest version, which `EventPayloads` describes.
  return { ok: true, event: { ...e, schemaV: up.schemaV, payload: up.payload } as TypedEvent };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
