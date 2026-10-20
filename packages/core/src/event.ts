/**
 * The immutable event envelope. See ARCHITECTURE.md section 4.
 * Payload shapes live in @ndeko/schemas; core only knows the envelope.
 */

export const EVENT_TYPES = [
  'PRODUCT_UPSERTED',
  'CUSTOMER_UPSERTED',
  'STOCK_RECEIVED',
  'STOCK_ADJUSTED',
  'SALE_RECORDED',
  'SALE_VOIDED',
  'PAYMENT_RECEIVED',
  'STOCK_TRANSFER_SENT',
  'STOCK_TRANSFER_RECEIVED',
  'DAY_CLOSED',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface NdekoEvent<P = unknown> {
  /** UUIDv7, globally unique. The idempotency key. */
  readonly id: string;
  readonly orgId: string;
  readonly branchId: string;
  readonly deviceId: string;
  /** Per-device monotonic counter. */
  readonly seq: number;
  /** Hybrid logical clock. Lexicographically sortable. */
  readonly hlc: string;
  readonly type: EventType;
  /** Payload version, used by upcasters. */
  readonly schemaV: number;
  readonly payload: P;
  /** Device wall clock in ms. Informational only, never used for ordering. */
  readonly createdAt: number;
}

/**
 * Total order for events: (hlc, deviceId, seq).
 * Returns a negative number if a sorts before b.
 */
export function compareEvents(a: NdekoEvent, b: NdekoEvent): number {
  if (a.hlc !== b.hlc) return a.hlc < b.hlc ? -1 : 1;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return a.seq - b.seq;
}
