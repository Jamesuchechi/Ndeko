import { foldEvents, type NdekoEvent } from '@ndeko/core';
import { stockProjection, type StockState } from '@ndeko/projections';
import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { runSimulation } from './sim';

/** Seeds per run. CI sets SIM_SEEDS=2000; local default keeps `pnpm test` fast. */
const SEEDS = Number(process.env.SIM_SEEDS ?? 60);

describe('Rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });

  it('range is inclusive and shuffle preserves elements', () => {
    const r = new Rng(1);
    const seen = new Set(Array.from({ length: 500 }, () => r.range(1, 3)));
    expect(seen).toEqual(new Set([1, 2, 3]));
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('convergence simulator', () => {
  it('is reproducible: the same seed gives the same result', async () => {
    const a = await runSimulation(7);
    const b = await runSimulation(7);
    expect(a).toEqual(b);
  });

  it('exercises the hard cases (chaos is actually happening)', async () => {
    let dupes = 0;
    let lostAcks = 0;
    let drift = 0;
    let negative = 0;
    let voids = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { stats } = await runSimulation(seed);
      dupes += stats.duplicateDeliveries;
      lostAcks += stats.lostAcks;
      drift += stats.driftWarnings;
      negative += stats.negativeStockLines;
      voids += stats.voids;
    }
    expect(dupes).toBeGreaterThan(0);
    expect(lostAcks).toBeGreaterThan(0);
    expect(drift).toBeGreaterThan(0);
    expect(negative).toBeGreaterThan(0); // two tills selling the last unit raises a flag
    expect(voids).toBeGreaterThan(0);
  });

  it(`N devices with random offline periods converge across ${SEEDS} seeds`, async () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = await runSimulation(seed);
      if (!r.ok) bad.push(`seed ${seed}: ${r.failures.slice(0, 3).join(' | ')}`);
    }
    // A failing seed must be committed as a regression fixture (see SEED_FIXTURES below).
    expect(bad).toEqual([]);
  }, 60_000 + SEEDS * 1_000);

  it('longer runs with more devices still converge', async () => {
    for (const seed of [101, 102, 103]) {
      const r = await runSimulation(seed, { devices: 10, steps: 1500 });
      expect(r.failures).toEqual([]);
    }
  }, 60_000);

  it('survives very lossy networks', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = await runSimulation(seed, { ackLoss: 0.8, pullLoss: 0.7 });
      expect(r.failures).toEqual([]);
    }
  });

  it('regression fixtures: previously failing seeds stay fixed', async () => {
    const SEED_FIXTURES: number[] = [];
    for (const seed of SEED_FIXTURES) {
      expect((await runSimulation(seed)).failures).toEqual([]);
    }
  });
});

describe('negative control: the simulator can fail', () => {
  /** Order-dependent on purpose: it drops a void that arrives before its sale. */
  const broken = {
    ...stockProjection,
    apply(state: StockState, e: NdekoEvent): StockState {
      const p = e.payload as { saleId?: string };
      if (
        e.type === 'SALE_VOIDED' &&
        p.saleId !== undefined &&
        state.sales[p.saleId] === undefined
      ) {
        return state; // held void forgotten
      }
      return stockProjection.apply(state, e);
    },
  };

  it('flags a projection that loses held voids', async () => {
    let caught = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = await runSimulation(seed, { stockProjection: broken });
      if (!r.ok) caught++;
    }
    expect(caught).toBeGreaterThan(0);
  });

  it('the broken projection really is order-dependent', () => {
    const void_ = {
      id: '01900000-0000-7000-8000-000000000001',
      orgId: 'o',
      branchId: 'b',
      deviceId: 'd',
      seq: 1,
      hlc: '1700000000000-0000-d',
      type: 'SALE_VOIDED',
      schemaV: 1,
      payload: { saleId: 's', reason: 'r' },
      createdAt: 0,
    } as const satisfies NdekoEvent;
    expect(foldEvents(broken, [void_])).not.toEqual(foldEvents(stockProjection, [void_]));
  });
});
