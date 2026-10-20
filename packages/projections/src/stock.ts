/**
 * Stock levels projection. See ARCHITECTURE.md sections 6 and 8.
 *
 * Quantities are integer milli-units. Stock is a sum of deltas per (branch, product),
 * so the result is independent of event order. Voids are held until their sale
 * arrives by tracking both sets and cancelling at apply time.
 */
import { type NdekoEvent, type Projection } from '@ndeko/core';
import { parseEvent, type TypedEvent } from '@ndeko/schemas';

interface SaleRecord {
  readonly branchId: string;
  readonly lines: readonly { readonly productId: string; readonly qty: number }[];
}

export interface StockState {
  /** branchId -> productId -> quantity (milli-units). May be negative; see `negativeStock`. */
  levels: Record<string, Record<string, number>>;
  /** Sales seen, by saleId, so a later void can reverse them. */
  sales: Record<string, SaleRecord>;
  /** Voided sale ids, including voids whose sale has not arrived yet. */
  voided: Record<string, true>;
}

function bump(state: StockState, branchId: string, productId: string, delta: number): void {
  const branch = (state.levels[branchId] ??= {});
  branch[productId] = (branch[productId] ?? 0) + delta;
}

export const stockProjection: Projection<StockState> = {
  name: 'stock',
  version: 1,
  init: () => ({ levels: {}, sales: {}, voided: {} }),
  apply(state, raw: NdekoEvent) {
    const parsed = parseEvent(raw);
    // The server and the command handlers already validated; an invalid event here is
    // skipped rather than allowed to break every projection on the device.
    if (!parsed.ok) return state;
    applyTyped(state, parsed.event);
    return state;
  },
};

function applyTyped(state: StockState, e: TypedEvent): void {
  switch (e.type) {
    case 'STOCK_RECEIVED':
      bump(state, e.branchId, e.payload.productId, e.payload.qty);
      return;
    case 'STOCK_ADJUSTED':
      bump(state, e.branchId, e.payload.productId, e.payload.qtyDelta);
      return;
    case 'SALE_RECORDED': {
      const { saleId, lines } = e.payload;
      if (state.sales[saleId] !== undefined) return; // same sale id seen twice
      state.sales[saleId] = {
        branchId: e.branchId,
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
      };
      if (state.voided[saleId] === true) return; // void arrived first: net effect is zero
      for (const l of lines) bump(state, e.branchId, l.productId, -l.qty);
      return;
    }
    case 'SALE_VOIDED': {
      const { saleId } = e.payload;
      if (state.voided[saleId] === true) return;
      state.voided[saleId] = true;
      const sale = state.sales[saleId];
      if (sale === undefined) return; // held until the sale arrives
      for (const l of sale.lines) bump(state, sale.branchId, l.productId, l.qty);
      return;
    }
    case 'STOCK_TRANSFER_SENT':
      // Origin branch loses stock. In-transit visibility is added with branches (Phase 4).
      for (const l of e.payload.lines) bump(state, e.branchId, l.productId, -l.qty);
      return;
    case 'STOCK_TRANSFER_RECEIVED':
      for (const l of e.payload.lines) bump(state, e.branchId, l.productId, l.qty);
      return;
    default:
      return; // events that do not affect stock
  }
}

export function stockLevel(state: StockState, branchId: string, productId: string): number {
  return state.levels[branchId]?.[productId] ?? 0;
}

export interface NegativeStock {
  readonly branchId: string;
  readonly productId: string;
  readonly qty: number;
}

/**
 * Reconciliation flags (ARCHITECTURE.md section 8). Derived from state rather than
 * stored, so it is order-independent and clears itself once stock is received.
 */
export function negativeStock(state: StockState): NegativeStock[] {
  const out: NegativeStock[] = [];
  for (const [branchId, products] of Object.entries(state.levels)) {
    for (const [productId, qty] of Object.entries(products)) {
      if (qty < 0) out.push({ branchId, productId, qty });
    }
  }
  return out.sort((a, b) =>
    `${a.branchId}/${a.productId}` < `${b.branchId}/${b.productId}` ? -1 : 1,
  );
}
