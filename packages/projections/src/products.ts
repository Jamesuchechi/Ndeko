/**
 * Products projection: field-level last-writer-wins by HLC. See ARCHITECTURE.md section 6.
 *
 * Each field remembers the HLC of the write that set it and only accepts a strictly
 * newer write, so concurrent edits to different fields both survive and the final
 * state does not depend on arrival order.
 */
import { compareHlc, type NdekoEvent, type Projection } from '@ndeko/core';
import { parseEvent, type ProductUpsertedV1 } from '@ndeko/schemas';

export interface Lww<T> {
  v: T;
  hlc: string;
}

export interface ProductRecord {
  name?: Lww<string>;
  barcode?: Lww<string | null>;
  priceKobo?: Lww<number>;
  costKobo?: Lww<number>;
  minStockQty?: Lww<number>;
  unit?: Lww<NonNullable<ProductUpsertedV1['unit']>>;
  archived?: Lww<boolean>;
}

export interface ProductsState {
  products: Record<string, ProductRecord>;
}

const FIELDS = [
  'name',
  'barcode',
  'priceKobo',
  'costKobo',
  'minStockQty',
  'unit',
  'archived',
] as const;

function write<K extends (typeof FIELDS)[number]>(
  rec: ProductRecord,
  key: K,
  value: ProductUpsertedV1[K],
  hlc: string,
): void {
  if (value === undefined) return;
  const cur = rec[key];
  if (cur !== undefined && compareHlc(hlc, cur.hlc) <= 0) return;
  // Safe: `value` is the validated type for `key`, and `Lww<T>` matches the record's field type.
  (rec as Record<string, Lww<unknown>>)[key] = { v: value, hlc };
}

export const productsProjection: Projection<ProductsState> = {
  name: 'products',
  version: 1,
  init: () => ({ products: {} }),
  apply(state, raw: NdekoEvent) {
    const parsed = parseEvent(raw);
    if (!parsed.ok || parsed.event.type !== 'PRODUCT_UPSERTED') return state;
    const { event } = parsed;
    const rec = (state.products[event.payload.productId] ??= {});
    for (const f of FIELDS) write(rec, f, event.payload[f], event.hlc);
    return state;
  },
};

/** Flattened current view of a product, or undefined if it has never been upserted. */
export interface ProductView {
  readonly productId: string;
  readonly name: string | undefined;
  readonly barcode: string | null | undefined;
  readonly priceKobo: number | undefined;
  readonly costKobo: number | undefined;
  readonly minStockQty: number | undefined;
  readonly unit: ProductUpsertedV1['unit'];
  readonly archived: boolean;
}

export function productView(state: ProductsState, productId: string): ProductView | undefined {
  const r = state.products[productId];
  if (r === undefined) return undefined;
  return {
    productId,
    name: r.name?.v,
    barcode: r.barcode?.v,
    priceKobo: r.priceKobo?.v,
    costKobo: r.costKobo?.v,
    minStockQty: r.minStockQty?.v,
    unit: r.unit?.v,
    archived: r.archived?.v ?? false,
  };
}

/** Exact barcode lookup among non-archived products. Linear; add an index when catalogs grow. */
export function findByBarcode(state: ProductsState, barcode: string): ProductView | undefined {
  for (const id of Object.keys(state.products)) {
    const v = productView(state, id);
    if (v !== undefined && !v.archived && v.barcode === barcode) return v;
  }
  return undefined;
}
