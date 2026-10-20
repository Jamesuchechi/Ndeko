/**
 * The seam between the app and the database. See ARCHITECTURE.md section 11.
 *
 * The store is a pure append-only log plus sync bookkeeping. Projections are NOT
 * computed here; they fold events read through `readSince` (see @ndeko/core).
 */
import type { NdekoEvent } from '@ndeko/core';

export interface ReadResult {
  readonly events: NdekoEvent[];
  /** Pass back to `readSince` to continue. Equals the input cursor when nothing new. */
  readonly nextCursor: number;
}

export interface EventStore {
  /**
   * Append a locally created event. It starts as pending (unacknowledged).
   * Idempotent: returns false and changes nothing if the id already exists.
   */
  append(event: NdekoEvent): Promise<boolean>;

  /**
   * Append events received from the server. They are already acknowledged.
   * Duplicates (by id) are ignored. Returns the number newly inserted.
   */
  appendRemote(events: readonly NdekoEvent[]): Promise<number>;

  /**
   * Read events in LOCAL ARRIVAL order after `cursor` (0 = from the start).
   *
   * Arrival order, not HLC order, is what makes incremental projection and
   * snapshots safe: a remote event with an old HLC can arrive late, and an
   * HLC watermark would skip it. Projections are commutative, so arrival order
   * is a valid fold order. The cursor is local and never sent to the server.
   */
  readSince(cursor: number, limit: number): Promise<ReadResult>;

  /** Locally created events not yet acknowledged, oldest first. */
  pending(limit: number): Promise<NdekoEvent[]>;

  /** Number of unacknowledged events. Drives the sync indicator. */
  pendingCount(): Promise<number>;

  /** Mark events acknowledged by the server. Unknown ids are ignored. Idempotent. */
  markAcked(ids: readonly string[], serverSeq: number): Promise<void>;

  /** Server pull cursor (`server_seq`). 0 before the first pull. */
  getPullCursor(): Promise<number>;
  /** Never moves backwards; a lower value is ignored. */
  setPullCursor(cursor: number): Promise<void>;

  get(id: string): Promise<NdekoEvent | undefined>;
  count(): Promise<number>;
}

/** Creates a fresh, empty store. Used by the shared contract tests. */
export type EventStoreFactory = () => Promise<EventStore> | EventStore;
