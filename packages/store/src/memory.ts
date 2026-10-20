import type { NdekoEvent } from '@ndeko/core';
import type { EventStore, ReadResult } from './types';

interface Row {
  readonly event: NdekoEvent;
  acked: boolean;
  serverSeq: number | undefined;
}

/** In-memory EventStore for tests and the simulator. Copies on write and read like a real DB. */
export class MemoryEventStore implements EventStore {
  /** Arrival order. Index + 1 is the local sequence number. */
  private readonly rows: Row[] = [];
  private readonly byId = new Map<string, Row>();
  private pullCursor = 0;

  append(event: NdekoEvent): Promise<boolean> {
    return Promise.resolve(this.insert(event, false));
  }

  appendRemote(events: readonly NdekoEvent[]): Promise<number> {
    let inserted = 0;
    for (const e of events) if (this.insert(e, true)) inserted++;
    return Promise.resolve(inserted);
  }

  readSince(cursor: number, limit: number): Promise<ReadResult> {
    const slice = this.rows.slice(Math.max(0, cursor), Math.max(0, cursor) + limit);
    return Promise.resolve({
      events: slice.map((r) => structuredClone(r.event)),
      nextCursor: Math.max(0, cursor) + slice.length,
    });
  }

  pending(limit: number): Promise<NdekoEvent[]> {
    const out: NdekoEvent[] = [];
    for (const r of this.rows) {
      if (out.length >= limit) break;
      if (!r.acked) out.push(structuredClone(r.event));
    }
    return Promise.resolve(out);
  }

  pendingCount(): Promise<number> {
    return Promise.resolve(this.rows.filter((r) => !r.acked).length);
  }

  markAcked(ids: readonly string[], serverSeq: number): Promise<void> {
    for (const id of ids) {
      const row = this.byId.get(id);
      if (row !== undefined && !row.acked) {
        row.acked = true;
        row.serverSeq = serverSeq;
      }
    }
    return Promise.resolve();
  }

  getPullCursor(): Promise<number> {
    return Promise.resolve(this.pullCursor);
  }

  setPullCursor(cursor: number): Promise<void> {
    if (cursor > this.pullCursor) this.pullCursor = cursor;
    return Promise.resolve();
  }

  get(id: string): Promise<NdekoEvent | undefined> {
    const row = this.byId.get(id);
    return Promise.resolve(row === undefined ? undefined : structuredClone(row.event));
  }

  count(): Promise<number> {
    return Promise.resolve(this.rows.length);
  }

  private insert(event: NdekoEvent, acked: boolean): boolean {
    if (this.byId.has(event.id)) return false;
    const row: Row = { event: structuredClone(event), acked, serverSeq: undefined };
    this.rows.push(row);
    this.byId.set(event.id, row);
    return true;
  }
}
