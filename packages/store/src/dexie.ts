import type { NdekoEvent } from '@ndeko/core';
import Dexie, { type Table } from 'dexie';
import type { EventStore, ReadResult } from './types';

/**
 * IndexedDB booleans cannot be indexed, so `acked` is 0 | 1.
 * `localSeq` is an auto-increment key and is the local arrival order.
 */
interface EventRow {
  localSeq?: number;
  id: string;
  acked: 0 | 1;
  serverSeq: number | undefined;
  event: NdekoEvent;
}

interface MetaRow {
  key: string;
  value: number;
}

const PULL_CURSOR = 'pullCursor';

class NdekoDb extends Dexie {
  events!: Table<EventRow, number>;
  meta!: Table<MetaRow, string>;

  constructor(name: string, options?: ConstructorParameters<typeof Dexie>[1]) {
    super(name, options);
    this.version(1).stores({
      // ++localSeq: arrival order. &id: dedupe key. [acked+localSeq]: oldest pending first.
      events: '++localSeq, &id, [acked+localSeq]',
      meta: 'key',
    });
  }
}

/** IndexedDB-backed EventStore. Ships first; SQLite-WASM can replace it behind the same interface. */
export class DexieEventStore implements EventStore {
  private readonly db: NdekoDb;

  /**
   * @param name database name
   * @param options pass `{ indexedDB, IDBKeyRange }` to use a non-global implementation (tests)
   */
  constructor(name = 'ndeko-events', options?: ConstructorParameters<typeof Dexie>[1]) {
    this.db = new NdekoDb(name, options);
  }

  async append(event: NdekoEvent): Promise<boolean> {
    return this.insertMany([event], 0).then((n) => n === 1);
  }

  appendRemote(events: readonly NdekoEvent[]): Promise<number> {
    return this.insertMany(events, 1);
  }

  async readSince(cursor: number, limit: number): Promise<ReadResult> {
    const start = Math.max(0, cursor);
    const rows = await this.db.events.where('localSeq').above(start).limit(limit).toArray();
    const last = rows[rows.length - 1];
    return {
      events: rows.map((r) => r.event),
      nextCursor: last?.localSeq ?? start,
    };
  }

  async pending(limit: number): Promise<NdekoEvent[]> {
    const rows = await this.db.events
      .where('[acked+localSeq]')
      .between([0, Dexie.minKey], [0, Dexie.maxKey])
      .limit(limit)
      .toArray();
    return rows.map((r) => r.event);
  }

  pendingCount(): Promise<number> {
    return this.db.events
      .where('[acked+localSeq]')
      .between([0, Dexie.minKey], [0, Dexie.maxKey])
      .count();
  }

  async markAcked(ids: readonly string[], serverSeq: number): Promise<void> {
    if (ids.length === 0) return;
    await this.db.events
      .where('id')
      .anyOf([...ids])
      .modify((row) => {
        if (row.acked === 0) {
          row.acked = 1;
          row.serverSeq = serverSeq;
        }
      });
  }

  async getPullCursor(): Promise<number> {
    return (await this.db.meta.get(PULL_CURSOR))?.value ?? 0;
  }

  async setPullCursor(cursor: number): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const current = (await this.db.meta.get(PULL_CURSOR))?.value ?? 0;
      if (cursor > current) await this.db.meta.put({ key: PULL_CURSOR, value: cursor });
    });
  }

  async get(id: string): Promise<NdekoEvent | undefined> {
    return (await this.db.events.where('id').equals(id).first())?.event;
  }

  count(): Promise<number> {
    return this.db.events.count();
  }

  /** Release the connection. Used by tests and on app teardown. */
  close(): void {
    this.db.close();
  }

  /** Insert events that are not already present, in one transaction. Returns how many were new. */
  private insertMany(events: readonly NdekoEvent[], acked: 0 | 1): Promise<number> {
    return this.db.transaction('rw', this.db.events, async () => {
      let inserted = 0;
      for (const event of events) {
        if ((await this.db.events.where('id').equals(event.id).count()) > 0) continue;
        await this.db.events.add({ id: event.id, acked, serverSeq: undefined, event });
        inserted++;
      }
      return inserted;
    });
  }
}
