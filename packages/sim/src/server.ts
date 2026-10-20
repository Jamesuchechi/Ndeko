import type { NdekoEvent } from '@ndeko/core';
import { parseEvent } from '@ndeko/schemas';

export interface PushResult {
  readonly id: string;
  readonly status: 'accepted' | 'duplicate' | 'rejected';
  readonly reason?: string;
}

/**
 * In-process stand-in for the sync API (ARCHITECTURE.md section 7):
 * validates per event, dedupes on id, assigns `server_seq`, and pages by it.
 */
export class SimServer {
  private readonly log: { readonly serverSeq: number; readonly event: NdekoEvent }[] = [];
  private readonly ids = new Set<string>();
  rejected = 0;

  get head(): number {
    return this.log.length;
  }

  get count(): number {
    return this.log.length;
  }

  push(events: readonly NdekoEvent[]): PushResult[] {
    return events.map((event): PushResult => {
      if (this.ids.has(event.id)) return { id: event.id, status: 'duplicate' };
      const parsed = parseEvent(event);
      if (!parsed.ok) {
        this.rejected++;
        return { id: event.id, status: 'rejected', reason: parsed.error };
      }
      this.ids.add(event.id);
      // Store the original, not the upcast copy: history is never rewritten.
      this.log.push({ serverSeq: this.log.length + 1, event: structuredClone(event) });
      return { id: event.id, status: 'accepted' };
    });
  }

  /**
   * Events from OTHER devices after `cursor`, scanning at most `limit` log entries.
   * `nextCursor` advances over entries scanned, including the caller's own.
   */
  pull(
    cursor: number,
    limit: number,
    excludeDeviceId: string,
  ): { events: NdekoEvent[]; nextCursor: number } {
    const scanned = this.log.slice(cursor, cursor + limit);
    return {
      events: scanned
        .filter((r) => r.event.deviceId !== excludeDeviceId)
        .map((r) => structuredClone(r.event)),
      nextCursor: cursor + scanned.length,
    };
  }
}
