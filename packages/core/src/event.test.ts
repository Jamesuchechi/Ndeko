import { describe, expect, it } from 'vitest';
import { compareEvents, type NdekoEvent } from './event';

function ev(over: Partial<NdekoEvent>): NdekoEvent {
  return {
    id: 'id',
    orgId: 'o',
    branchId: 'b',
    deviceId: 'd1',
    seq: 1,
    hlc: '0001760000000000-0000-d1',
    type: 'SALE_RECORDED',
    schemaV: 1,
    payload: {},
    createdAt: 0,
    ...over,
  };
}

describe('compareEvents', () => {
  it('orders by hlc, then deviceId, then seq', () => {
    const early = ev({ hlc: '0001760000000000-0000-d1' });
    const late = ev({ hlc: '0001760000000001-0000-d1' });
    expect(compareEvents(early, late)).toBeLessThan(0);

    const a = ev({ deviceId: 'a' });
    const b = ev({ deviceId: 'b' });
    expect(compareEvents(a, b)).toBeLessThan(0);

    expect(compareEvents(ev({ seq: 1 }), ev({ seq: 2 }))).toBeLessThan(0);
  });

  it('is a stable total order', () => {
    const events = [ev({ seq: 3 }), ev({ seq: 1 }), ev({ seq: 2 })];
    expect(events.sort(compareEvents).map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});
