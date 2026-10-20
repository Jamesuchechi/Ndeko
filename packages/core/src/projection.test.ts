import { describe, expect, it } from 'vitest';
import type { NdekoEvent } from './event';
import { foldEvents, ProjectionRunner, type EventSource, type Projection } from './projection';

interface CountState {
  total: number;
}

const counter: Projection<CountState> = {
  name: 'counter',
  version: 1,
  init: () => ({ total: 0 }),
  apply(state, e) {
    state.total += (e.payload as { n: number }).n;
    return state;
  },
};

let i = 0;
const ev = (n: number): NdekoEvent => ({
  id: `id-${i++}`,
  orgId: 'o',
  branchId: 'b',
  deviceId: 'd',
  seq: i,
  hlc: String(i).padStart(13, '0') + '-0000-d',
  type: 'STOCK_RECEIVED',
  schemaV: 1,
  payload: { n },
  createdAt: 0,
});

function source(log: NdekoEvent[]): EventSource {
  return {
    readSince: (cursor, limit) => {
      const events = log.slice(cursor, cursor + limit);
      return Promise.resolve({ events, nextCursor: cursor + events.length });
    },
  };
}

describe('foldEvents', () => {
  it('folds from init and from a given state', () => {
    expect(foldEvents(counter, [ev(1), ev(2)]).total).toBe(3);
    expect(foldEvents(counter, [ev(5)], { total: 10 }).total).toBe(15);
  });
});

describe('ProjectionRunner', () => {
  it('catches up across multiple batches', async () => {
    const log = Array.from({ length: 7 }, () => ev(1));
    const r = new ProjectionRunner(counter);
    expect(await r.catchUp(source(log), 3)).toBe(7);
    expect(r.state.total).toBe(7);
    expect(r.cursor).toBe(7);
  });

  it('is incremental: a second catchUp applies only new events', async () => {
    const log = [ev(1), ev(2)];
    const r = new ProjectionRunner(counter);
    await r.catchUp(source(log));
    log.push(ev(10));
    expect(await r.catchUp(source(log))).toBe(1);
    expect(r.state.total).toBe(13);
  });

  it('resuming from a snapshot equals a full replay', async () => {
    const log = Array.from({ length: 20 }, (_, k) => ev(k + 1));
    const a = new ProjectionRunner(counter);
    await a.catchUp(source(log.slice(0, 12)));
    const snap = a.snapshot();

    const resumed = new ProjectionRunner(counter, snap);
    await resumed.catchUp(source(log));

    const full = new ProjectionRunner(counter);
    await full.catchUp(source(log));
    expect(resumed.state).toEqual(full.state);
    expect(resumed.cursor).toBe(20);
  });

  it('snapshots are isolated from later mutation', async () => {
    const r = new ProjectionRunner(counter);
    await r.catchUp(source([ev(1)]));
    const snap = r.snapshot();
    await r.catchUp(source([ev(1), ev(5)]));
    expect(snap.state.total).toBe(1);
    const resumed = new ProjectionRunner(counter, snap);
    await resumed.catchUp(source([ev(100)]));
    expect(snap.state.total).toBe(1);
  });

  it('discards a snapshot from a different projection version', async () => {
    const log = [ev(1), ev(2)];
    const old = { projection: 'counter', version: 0, cursor: 2, state: { total: 999 } };
    const r = new ProjectionRunner(counter, old);
    await r.catchUp(source(log));
    expect(r.state.total).toBe(3);
  });

  it('discards a snapshot for a different projection name', () => {
    const other = { projection: 'other', version: 1, cursor: 5, state: { total: 9 } };
    const r = new ProjectionRunner(counter, other);
    expect(r.state.total).toBe(0);
    expect(r.cursor).toBe(0);
  });
});
