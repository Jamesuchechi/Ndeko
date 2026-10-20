/**
 * Shared EventStore contract. Every adapter (memory, dexie, sqlite-wasm) must
 * pass these tests: `runEventStoreContract('dexie', () => new DexieEventStore(...))`.
 */
import { formatHlc, uuidv7, type NdekoEvent } from '@ndeko/core';
import { describe, expect, it } from 'vitest';
import type { EventStoreFactory } from './types';

let counter = 0;
export function makeEvent(over: Partial<NdekoEvent> = {}): NdekoEvent {
  const seq = counter++;
  return {
    id: uuidv7(),
    orgId: 'org1',
    branchId: 'br1',
    deviceId: 'dev1',
    seq,
    hlc: formatHlc(1_700_000_000_000 + seq, 0, 'dev1'),
    type: 'STOCK_RECEIVED',
    schemaV: 1,
    payload: { productId: 'p1', qty: 1000 },
    createdAt: 1_700_000_000_000 + seq,
    ...over,
  };
}

export function runEventStoreContract(name: string, create: EventStoreFactory): void {
  describe(`EventStore contract: ${name}`, () => {
    it('starts empty', async () => {
      const s = await create();
      expect(await s.count()).toBe(0);
      expect(await s.pendingCount()).toBe(0);
      expect(await s.getPullCursor()).toBe(0);
      expect(await s.readSince(0, 10)).toEqual({ events: [], nextCursor: 0 });
    });

    it('append stores a pending event and returns true', async () => {
      const s = await create();
      const e = makeEvent();
      expect(await s.append(e)).toBe(true);
      expect(await s.get(e.id)).toEqual(e);
      expect(await s.pendingCount()).toBe(1);
      expect((await s.pending(10)).map((x) => x.id)).toEqual([e.id]);
    });

    it('append is idempotent by id', async () => {
      const s = await create();
      const e = makeEvent();
      await s.append(e);
      expect(await s.append(e)).toBe(false);
      expect(await s.count()).toBe(1);
    });

    it('does not let callers mutate stored events', async () => {
      const s = await create();
      const e = makeEvent({ payload: { productId: 'p1', qty: 1000 } });
      await s.append(e);
      (e.payload as { qty: number }).qty = 9;
      const stored = await s.get(e.id);
      expect((stored?.payload as { qty: number }).qty).toBe(1000);
    });

    it('appendRemote dedupes, counts new events and stores them acknowledged', async () => {
      const s = await create();
      const a = makeEvent({ deviceId: 'dev2' });
      const b = makeEvent({ deviceId: 'dev2' });
      expect(await s.appendRemote([a, b, a])).toBe(2);
      expect(await s.appendRemote([a])).toBe(0);
      expect(await s.count()).toBe(2);
      expect(await s.pendingCount()).toBe(0);
    });

    it('appendRemote does not acknowledge an existing pending local event', async () => {
      const s = await create();
      const e = makeEvent();
      await s.append(e);
      expect(await s.appendRemote([e])).toBe(0);
      expect(await s.pendingCount()).toBe(1);
    });

    it('pending returns oldest first, respects the limit, skips acked and remote', async () => {
      const s = await create();
      const [a, b, c] = [makeEvent(), makeEvent(), makeEvent()] as [
        NdekoEvent,
        NdekoEvent,
        NdekoEvent,
      ];
      await s.append(a);
      await s.appendRemote([makeEvent({ deviceId: 'dev2' })]);
      await s.append(b);
      await s.append(c);
      await s.markAcked([a.id], 7);
      expect((await s.pending(10)).map((x) => x.id)).toEqual([b.id, c.id]);
      expect((await s.pending(1)).map((x) => x.id)).toEqual([b.id]);
      expect(await s.pendingCount()).toBe(2);
    });

    it('markAcked is idempotent and ignores unknown ids', async () => {
      const s = await create();
      const e = makeEvent();
      await s.append(e);
      await s.markAcked([e.id, 'does-not-exist'], 1);
      await s.markAcked([e.id], 2);
      expect(await s.pendingCount()).toBe(0);
    });

    it('readSince returns events in arrival order, not HLC order', async () => {
      const s = await create();
      const late = makeEvent({ deviceId: 'dev2', hlc: formatHlc(1_600_000_000_000, 0, 'dev2') });
      const first = makeEvent();
      await s.append(first);
      await s.appendRemote([late]); // older HLC but arrived later
      const r = await s.readSince(0, 10);
      expect(r.events.map((x) => x.id)).toEqual([first.id, late.id]);
      expect(r.nextCursor).toBe(2);
    });

    it('readSince pages and resumes from the returned cursor', async () => {
      const s = await create();
      const all = Array.from({ length: 5 }, () => makeEvent());
      for (const e of all) await s.append(e);
      const p1 = await s.readSince(0, 2);
      const p2 = await s.readSince(p1.nextCursor, 2);
      const p3 = await s.readSince(p2.nextCursor, 2);
      const p4 = await s.readSince(p3.nextCursor, 2);
      expect([...p1.events, ...p2.events, ...p3.events].map((x) => x.id)).toEqual(
        all.map((x) => x.id),
      );
      expect(p3.events).toHaveLength(1);
      expect(p4).toEqual({ events: [], nextCursor: 5 });
    });

    it('readSince cursor stays stable when new events arrive afterwards', async () => {
      const s = await create();
      await s.append(makeEvent());
      const r1 = await s.readSince(0, 10);
      const later = makeEvent();
      await s.appendRemote([later]);
      const r2 = await s.readSince(r1.nextCursor, 10);
      expect(r2.events.map((x) => x.id)).toEqual([later.id]);
    });

    it('pull cursor persists and never moves backwards', async () => {
      const s = await create();
      await s.setPullCursor(10);
      await s.setPullCursor(4);
      expect(await s.getPullCursor()).toBe(10);
      await s.setPullCursor(11);
      expect(await s.getPullCursor()).toBe(11);
    });

    it('get returns undefined for an unknown id', async () => {
      const s = await create();
      expect(await s.get('nope')).toBeUndefined();
    });
  });
}
