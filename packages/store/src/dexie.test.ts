import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { makeEvent, runEventStoreContract } from './contract';
import { DexieEventStore } from './dexie';

let n = 0;
const open = (name = `test-db-${n++}`) => new DexieEventStore(name, { indexedDB, IDBKeyRange });

runEventStoreContract('dexie', () => open());

describe('DexieEventStore persistence', () => {
  it('data and cursors survive closing and reopening the database', async () => {
    const name = `persist-${n++}`;
    const a = open(name);
    const e1 = makeEvent();
    const e2 = makeEvent();
    await a.append(e1);
    await a.append(e2);
    await a.markAcked([e1.id], 3);
    await a.setPullCursor(9);
    a.close();

    const b = open(name);
    expect(await b.count()).toBe(2);
    expect((await b.pending(10)).map((e) => e.id)).toEqual([e2.id]);
    expect(await b.getPullCursor()).toBe(9);
    const r = await b.readSince(0, 10);
    expect(r.events.map((e) => e.id)).toEqual([e1.id, e2.id]);
    // Local sequence keeps counting from where it left off.
    await b.append(makeEvent());
    expect((await b.readSince(r.nextCursor, 10)).events).toHaveLength(1);
    b.close();
  });

  it('concurrent appends of the same id insert exactly once', async () => {
    const s = open();
    const e = makeEvent();
    const results = await Promise.all([s.append(e), s.append(e), s.append(e)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await s.count()).toBe(1);
  });
});
