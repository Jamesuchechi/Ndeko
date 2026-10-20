/**
 * Deterministic multi-device convergence simulator. See ARCHITECTURE.md section 14.
 *
 * N devices with skewed clocks create random commands, go offline, and sync through an
 * in-process server over a lossy channel (duplicated and reordered batches, lost acks,
 * lost pull responses). At the end everything is synced and we assert:
 *   - no event was lost, duplicated or rejected;
 *   - every device has the identical projections;
 *   - incremental projection equals a full replay;
 *   - projections equal an independent oracle that does not use the projection code.
 *
 * A failing seed is reproducible: `runSimulation(seed)` always does the same thing.
 */
import {
  createUuidV7Generator,
  foldEvents,
  HlcClock,
  lineTotal,
  compareEvents,
  ProjectionRunner,
  type EventType,
  type NdekoEvent,
  type Projection,
} from '@ndeko/core';
import {
  negativeStock,
  productsProjection,
  productView,
  stockLevel,
  stockProjection,
  type ProductsState,
  type StockState,
} from '@ndeko/projections';
import { LATEST_SCHEMA_V } from '@ndeko/schemas';
import { MemoryEventStore } from '@ndeko/store';
import { Rng } from './rng';
import { SimServer } from './server';

export interface SimOptions {
  /** Number of devices. Default: 3 to 10, chosen from the seed. */
  devices?: number;
  /** Number of random actions. Default 300. */
  steps?: number;
  branches?: number;
  products?: number;
  /** Probability a push ack is lost (the device will re-push; the server must dedupe). */
  ackLoss?: number;
  /** Probability a pull response is lost. */
  pullLoss?: number;
  /**
   * Override the stock projection. Only for negative-control tests that prove the
   * simulator catches a broken (order-dependent) projection.
   */
  stockProjection?: Projection<StockState>;
}

export interface SimStats {
  devices: number;
  events: number;
  sales: number;
  voids: number;
  duplicateDeliveries: number;
  lostAcks: number;
  driftWarnings: number;
  negativeStockLines: number;
  syncRoundsToConverge: number;
}

export interface SimResult {
  readonly seed: number;
  readonly ok: boolean;
  readonly failures: string[];
  readonly stats: SimStats;
}

interface Device {
  readonly id: string;
  readonly branchId: string;
  readonly clock: HlcClock;
  readonly newId: () => string;
  readonly store: MemoryEventStore;
  readonly stockRunner: ProjectionRunner<StockState>;
  readonly productsRunner: ProjectionRunner<ProductsState>;
  readonly knownSales: Set<string>;
  readonly knownTransfers: Map<string, { fromBranch: string; toBranch: string; lines: Line[] }>;
  readonly receivedTransfers: Set<string>;
  online: boolean;
  seq: number;
  receiptCounter: number;
}

interface Line {
  productId: string;
  qty: number;
}

const BATCH = 40;
const PAGE = 60;
const CLOCK_OFFSETS_MS = [0, 0, 0, 45_000, -90_000, 20 * 60_000, -2 * 3_600_000];

/** Canonical JSON with sorted keys, so structurally equal states compare equal as strings. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

export async function runSimulation(seed: number, options: SimOptions = {}): Promise<SimResult> {
  const rng = new Rng(seed);
  const nDevices = options.devices ?? rng.range(3, 10);
  const steps = options.steps ?? 300;
  const nBranches = options.branches ?? 2;
  const nProducts = options.products ?? 5;
  const ackLoss = options.ackLoss ?? 0.25;
  const pullLoss = options.pullLoss ?? 0.2;

  const failures: string[] = [];
  const fail = (msg: string): void => void failures.push(msg);
  const stats: SimStats = {
    devices: nDevices,
    events: 0,
    sales: 0,
    voids: 0,
    duplicateDeliveries: 0,
    lostAcks: 0,
    driftWarnings: 0,
    negativeStockLines: 0,
    syncRoundsToConverge: 0,
  };

  const server = new SimServer();
  const created: NdekoEvent[] = [];
  let simNow = 1_700_000_000_000;
  const products = Array.from({ length: nProducts }, (_, i) => `p${i}`);
  const prices = new Map(products.map((p) => [p, rng.range(100, 5000)]));
  const customers = ['c0', 'c1', 'c2'];
  const stockProj = options.stockProjection ?? stockProjection;

  const devices: Device[] = Array.from({ length: nDevices }, (_, i) => {
    const id = `dev${i}`;
    const offset = rng.pick(CLOCK_OFFSETS_MS);
    const now = (): number => simNow + offset;
    return {
      id,
      branchId: `br${i % nBranches}`,
      clock: new HlcClock({ deviceId: id, now }),
      newId: createUuidV7Generator({ now, random: (b) => rng.fill(b) }),
      store: new MemoryEventStore(),
      stockRunner: new ProjectionRunner(stockProj),
      productsRunner: new ProjectionRunner(productsProjection),
      knownSales: new Set(),
      knownTransfers: new Map(),
      receivedTransfers: new Set(),
      online: true,
      seq: 0,
      receiptCounter: 0,
    };
  });

  async function emit(d: Device, type: EventType, payload: unknown): Promise<void> {
    const event: NdekoEvent = {
      id: d.newId(),
      orgId: 'org1',
      branchId: d.branchId,
      deviceId: d.id,
      seq: d.seq++,
      hlc: d.clock.tick(),
      type,
      schemaV: LATEST_SCHEMA_V[type],
      payload,
      createdAt: simNow,
    };
    await d.store.append(event);
    created.push(event);
    stats.events++;
  }

  function observe(d: Device, e: NdekoEvent): void {
    if (e.type === 'SALE_RECORDED') d.knownSales.add((e.payload as { saleId: string }).saleId);
    if (e.type === 'STOCK_TRANSFER_SENT') {
      const p = e.payload as { transferId: string; toBranchId: string; lines: Line[] };
      d.knownTransfers.set(p.transferId, {
        fromBranch: e.branchId,
        toBranch: p.toBranchId,
        lines: p.lines,
      });
    }
  }

  async function act(d: Device): Promise<void> {
    const roll = rng.int(100);
    if (roll < 15) {
      await emit(d, 'STOCK_RECEIVED', {
        productId: rng.pick(products),
        qty: rng.range(1, 20) * 1000,
      });
    } else if (roll < 50) {
      const lines = Array.from({ length: rng.range(1, 3) }, () => {
        const productId = rng.pick(products);
        const qty = rng.range(1, 8) * 250;
        const unitPriceKobo = prices.get(productId) as number;
        return { productId, qty, unitPriceKobo, lineTotalKobo: lineTotal(unitPriceKobo, qty) };
      });
      const total = lines.reduce((s, l) => s + l.lineTotalKobo, 0);
      const mode = rng.int(3);
      let tenders: { method: string; amountKobo: number }[] = [
        { method: 'CASH', amountKobo: total },
      ];
      let customerId: string | undefined;
      if (mode === 1 && total > 1) {
        const cash = rng.range(1, total - 1);
        tenders = [
          { method: 'CASH', amountKobo: cash },
          { method: 'TRANSFER', amountKobo: total - cash },
        ];
      } else if (mode === 2) {
        tenders = [{ method: 'CREDIT', amountKobo: total }];
        customerId = rng.pick(customers);
      }
      d.receiptCounter++;
      const saleId = `${d.id}-sale-${d.receiptCounter}`;
      await emit(d, 'SALE_RECORDED', {
        saleId,
        receiptNo: `${d.branchId}-${d.id}-${String(d.receiptCounter).padStart(6, '0')}`,
        lines,
        tenders,
        totalKobo: total,
        ...(customerId === undefined ? {} : { customerId }),
      });
      stats.sales++;
    } else if (roll < 56) {
      const sales = [...d.knownSales];
      // Occasionally void something nobody has seen yet to exercise held voids.
      const target =
        sales.length > 0 && !rng.chance(0.1)
          ? rng.pick(sales)
          : `${rng.pick(devices).id}-sale-${rng.range(1, 40)}`;
      await emit(d, 'SALE_VOIDED', { saleId: target, reason: 'sim' });
      stats.voids++;
    } else if (roll < 62) {
      await emit(d, 'STOCK_ADJUSTED', {
        productId: rng.pick(products),
        qtyDelta: rng.pick([-1, 1]) * rng.range(1, 5) * 500,
        reason: rng.pick(['COUNT', 'DAMAGE', 'EXPIRY', 'THEFT', 'OTHER']),
      });
    } else if (roll < 74) {
      const fields: Record<string, unknown> = { productId: rng.pick(products) };
      if (rng.chance(0.5)) fields.name = `name-${rng.int(1000)}`;
      if (rng.chance(0.5)) fields.priceKobo = rng.range(100, 5000);
      if (rng.chance(0.3)) fields.barcode = rng.chance(0.2) ? null : `bc-${rng.int(50)}`;
      if (rng.chance(0.2)) fields.archived = rng.chance(0.5);
      if (rng.chance(0.2)) fields.unit = rng.pick(['each', 'kg', 'litre']);
      await emit(d, 'PRODUCT_UPSERTED', fields);
    } else if (roll < 78 && nBranches > 1) {
      const toBranchId = rng.pick(
        Array.from({ length: nBranches }, (_, i) => `br${i}`).filter((b) => b !== d.branchId),
      );
      await emit(d, 'STOCK_TRANSFER_SENT', {
        transferId: `${d.id}-tr-${d.seq}`,
        toBranchId,
        lines: [{ productId: rng.pick(products), qty: rng.range(1, 5) * 1000 }],
      });
    } else if (roll < 82) {
      const open = [...d.knownTransfers].filter(
        ([id, t]) => t.toBranch === d.branchId && !d.receivedTransfers.has(id),
      );
      if (open.length > 0) {
        const [transferId, t] = rng.pick(open);
        d.receivedTransfers.add(transferId);
        await emit(d, 'STOCK_TRANSFER_RECEIVED', {
          transferId,
          fromBranchId: t.fromBranch,
          lines: t.lines,
        });
      }
    } else if (roll < 90) {
      d.online = !d.online;
    } else {
      if (d.online) await sync(d, true);
    }
    if (rng.chance(0.1)) {
      await d.stockRunner.catchUp(d.store, rng.range(1, 50));
      await d.productsRunner.catchUp(d.store, rng.range(1, 50));
    }
  }

  async function sync(d: Device, lossy: boolean): Promise<void> {
    // Push: duplicated and reordered batch; the ack may be lost.
    const batch = await d.store.pending(BATCH);
    if (batch.length > 0) {
      const dups = lossy ? batch.filter(() => rng.chance(0.2)) : [];
      stats.duplicateDeliveries += dups.length;
      const sent = lossy ? rng.shuffle([...batch, ...dups]) : batch;
      const results = server.push(sent);
      if (lossy && rng.chance(ackLoss)) {
        stats.lostAcks++;
      } else {
        const ok = results.filter((r) => r.status !== 'rejected').map((r) => r.id);
        await d.store.markAcked(ok, server.head);
      }
    }
    // Pull: paged, may lose a response, may duplicate and reorder events.
    const maxPages = lossy ? rng.range(1, 3) : Number.MAX_SAFE_INTEGER;
    for (let page = 0; page < maxPages; page++) {
      const cursor = await d.store.getPullCursor();
      const res = server.pull(cursor, PAGE, d.id);
      if (res.nextCursor === cursor) break;
      if (lossy && rng.chance(pullLoss)) break;
      const dups = lossy ? res.events.filter(() => rng.chance(0.2)) : [];
      stats.duplicateDeliveries += dups.length;
      const delivered = lossy ? rng.shuffle([...res.events, ...dups]) : res.events;
      for (const e of delivered) {
        if (d.clock.receive(e.hlc).drifted) stats.driftWarnings++;
        observe(d, e);
      }
      await d.store.appendRemote(delivered);
      await d.store.setPullCursor(res.nextCursor);
    }
  }

  // Phase 1: chaos.
  for (let i = 0; i < steps; i++) {
    simNow += rng.range(1, 5000);
    await act(rng.pick(devices));
  }

  // Phase 2: heal the network and sync until quiescent.
  for (const d of devices) d.online = true;
  let rounds = 0;
  for (; rounds < 100; rounds++) {
    for (const d of rng.shuffle(devices)) await sync(d, false);
    let settled = true;
    for (const d of devices) {
      if ((await d.store.pendingCount()) > 0 || (await d.store.getPullCursor()) < server.head) {
        settled = false;
      }
    }
    if (settled) break;
  }
  stats.syncRoundsToConverge = rounds + 1;
  if (rounds >= 100) fail('did not reach quiescence within 100 sync rounds');

  // Checks.
  if (server.rejected > 0) fail(`server rejected ${server.rejected} valid events`);
  if (server.count !== created.length) {
    fail(`server holds ${server.count} events, ${created.length} were created`);
  }
  const createdIds = canonical([...created.map((e) => e.id)].sort());

  const oracleStock = foldEvents(stockProj, [...created].sort(compareEvents));
  const oracleProducts = foldEvents(productsProjection, [...created].sort(compareEvents));
  const expectedStock = independentStock(created);
  const expectedProducts = independentProducts(created);

  for (const d of devices) {
    const all = (await d.store.readSince(0, Number.MAX_SAFE_INTEGER)).events;
    if (all.length !== created.length) {
      fail(`${d.id}: holds ${all.length} events, expected ${created.length}`);
    }
    if (canonical(all.map((e) => e.id).sort()) !== createdIds) {
      fail(`${d.id}: event id set differs from the created set (lost or phantom events)`);
    }
    if ((await d.store.pendingCount()) !== 0) fail(`${d.id}: still has pending events`);

    await d.stockRunner.catchUp(d.store);
    await d.productsRunner.catchUp(d.store);
    const fullStock = foldEvents(stockProj, all);
    const fullProducts = foldEvents(productsProjection, all);

    if (canonical(d.stockRunner.state) !== canonical(fullStock)) {
      fail(`${d.id}: incremental stock projection differs from full replay`);
    }
    if (canonical(d.productsRunner.state) !== canonical(fullProducts)) {
      fail(`${d.id}: incremental products projection differs from full replay`);
    }
    if (canonical(fullStock) !== canonical(oracleStock)) {
      fail(`${d.id}: stock projection differs from the HLC-ordered fold (not convergent)`);
    }
    if (canonical(fullProducts) !== canonical(oracleProducts)) {
      fail(`${d.id}: products projection differs from the HLC-ordered fold (not convergent)`);
    }
    compareStock(d.id, fullStock, expectedStock, fail);
    compareProducts(d.id, fullProducts, expectedProducts, products, fail);
  }

  stats.negativeStockLines = negativeStock(oracleStock).length;
  return { seed, ok: failures.length === 0, failures, stats };
}

/** Stock computed directly from first principles, without the projection code. */
function independentStock(events: readonly NdekoEvent[]): Map<string, number> {
  const levels = new Map<string, number>();
  const add = (branch: string, product: string, delta: number): void => {
    const k = `${branch}/${product}`;
    levels.set(k, (levels.get(k) ?? 0) + delta);
  };
  const sales = new Map<string, { branch: string; lines: Line[] }>();
  const voided = new Set<string>();
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case 'STOCK_RECEIVED':
        add(e.branchId, p.productId as string, p.qty as number);
        break;
      case 'STOCK_ADJUSTED':
        add(e.branchId, p.productId as string, p.qtyDelta as number);
        break;
      case 'SALE_RECORDED':
        sales.set(p.saleId as string, { branch: e.branchId, lines: p.lines as Line[] });
        break;
      case 'SALE_VOIDED':
        voided.add(p.saleId as string);
        break;
      case 'STOCK_TRANSFER_SENT':
        for (const l of p.lines as Line[]) add(e.branchId, l.productId, -l.qty);
        break;
      case 'STOCK_TRANSFER_RECEIVED':
        for (const l of p.lines as Line[]) add(e.branchId, l.productId, l.qty);
        break;
      default:
        break;
    }
  }
  for (const [saleId, s] of sales) {
    if (voided.has(saleId)) continue;
    for (const l of s.lines) add(s.branch, l.productId, -l.qty);
  }
  return levels;
}

function compareStock(
  deviceId: string,
  state: StockState,
  expected: Map<string, number>,
  fail: (m: string) => void,
): void {
  const keys = new Set(expected.keys());
  for (const [b, ps] of Object.entries(state.levels))
    for (const p of Object.keys(ps)) keys.add(`${b}/${p}`);
  for (const k of keys) {
    const [b, p] = k.split('/') as [string, string];
    const got = stockLevel(state, b, p);
    const want = expected.get(k) ?? 0;
    if (got !== want) fail(`${deviceId}: stock ${k} is ${got}, oracle says ${want}`);
  }
}

type FieldWins = Map<string, { hlc: string; value: unknown }>;

/** Last-writer-wins per (product, field), computed directly from the events. */
function independentProducts(events: readonly NdekoEvent[]): Map<string, FieldWins> {
  const out = new Map<string, FieldWins>();
  for (const e of events) {
    if (e.type !== 'PRODUCT_UPSERTED') continue;
    const { productId, ...fields } = e.payload as { productId: string } & Record<string, unknown>;
    const wins = out.get(productId) ?? new Map();
    out.set(productId, wins);
    for (const [f, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const cur = wins.get(f);
      if (cur === undefined || e.hlc > cur.hlc) wins.set(f, { hlc: e.hlc, value });
    }
  }
  return out;
}

function compareProducts(
  deviceId: string,
  state: ProductsState,
  expected: Map<string, FieldWins>,
  productIds: readonly string[],
  fail: (m: string) => void,
): void {
  for (const id of productIds) {
    const view = productView(state, id);
    const wins = expected.get(id);
    if (wins === undefined) {
      if (view !== undefined) fail(`${deviceId}: product ${id} exists but was never upserted`);
      continue;
    }
    if (view === undefined) {
      fail(`${deviceId}: product ${id} missing`);
      continue;
    }
    for (const f of ['name', 'barcode', 'priceKobo', 'costKobo', 'unit'] as const) {
      const want = wins.get(f)?.value;
      if (view[f] !== want)
        fail(`${deviceId}: product ${id}.${f} is ${String(view[f])}, oracle ${String(want)}`);
    }
    const wantArchived = (wins.get('archived')?.value as boolean | undefined) ?? false;
    if (view.archived !== wantArchived) fail(`${deviceId}: product ${id}.archived mismatch`);
  }
}
