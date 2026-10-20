/**
 * Projection engine. See ARCHITECTURE.md section 6.
 *
 * A projection is a pure fold `(state, event) -> state`. Invariant: for the
 * fields a projection owns, applying the same SET of events in any order must
 * give the same state. Additive data sums deltas; last-writer-wins data carries
 * the HLC of its last write.
 */
import type { NdekoEvent } from './event';

export interface Projection<S> {
  /** Stable identifier, used as the snapshot key. */
  readonly name: string;
  /** Bump when the state shape or fold logic changes; older snapshots are then discarded. */
  readonly version: number;
  /** A fresh empty state. Must return a new object each call. */
  init(): S;
  /**
   * Fold one event. May mutate and return `state` (avoids O(n^2) copying), but must
   * be deterministic and must not touch anything outside `state`.
   * State must be plain JSON (no Map, Set, Date, class instances) so it can be snapshotted.
   */
  apply(state: S, event: NdekoEvent): S;
}

/** Anything that can be read in arrival order. `EventStore` satisfies this structurally. */
export interface EventSource {
  readSince(
    cursor: number,
    limit: number,
  ): Promise<{ readonly events: NdekoEvent[]; readonly nextCursor: number }>;
}

/** A persisted projection state plus how far into the source log it includes. */
export interface Snapshot<S> {
  readonly projection: string;
  readonly version: number;
  /** Local arrival cursor (see EventStore.readSince). Replay resumes after it. */
  readonly cursor: number;
  readonly state: S;
}

/** Fold a list of events into a state. Pure helper for tests, the simulator and one-off reports. */
export function foldEvents<S>(
  projection: Projection<S>,
  events: Iterable<NdekoEvent>,
  initial: S = projection.init(),
): S {
  let state = initial;
  for (const e of events) state = projection.apply(state, e);
  return state;
}

const DEFAULT_BATCH = 500;

/**
 * Keeps a projection up to date against an event source, incrementally.
 * Resume from a snapshot to avoid replaying the whole log.
 */
export class ProjectionRunner<S> {
  private current: S;
  private cursorValue: number;

  constructor(
    private readonly projection: Projection<S>,
    snapshot?: Snapshot<S>,
  ) {
    if (
      snapshot !== undefined &&
      snapshot.projection === projection.name &&
      snapshot.version === projection.version
    ) {
      // Clone so the runner never aliases a caller-owned (or stored) snapshot.
      this.current = structuredClone(snapshot.state);
      this.cursorValue = snapshot.cursor;
    } else {
      this.current = projection.init();
      this.cursorValue = 0;
    }
  }

  get state(): S {
    return this.current;
  }

  get cursor(): number {
    return this.cursorValue;
  }

  /** Apply every event that arrived since the last call. Returns how many were applied. */
  async catchUp(source: EventSource, batch: number = DEFAULT_BATCH): Promise<number> {
    let applied = 0;
    for (;;) {
      const { events, nextCursor } = await source.readSince(this.cursorValue, batch);
      for (const e of events) this.current = this.projection.apply(this.current, e);
      applied += events.length;
      this.cursorValue = nextCursor;
      if (events.length === 0) return applied;
    }
  }

  /** Apply events directly (e.g. a just-appended local event) without reading the source. */
  applyDirect(events: Iterable<NdekoEvent>): void {
    this.current = foldEvents(this.projection, events, this.current);
  }

  /**
   * Capture the current state. Only valid for resuming through `catchUp`: do not
   * mix `applyDirect` with snapshots, or the cursor will not match the state.
   */
  snapshot(): Snapshot<S> {
    return {
      projection: this.projection.name,
      version: this.projection.version,
      cursor: this.cursorValue,
      state: structuredClone(this.current),
    };
  }
}
