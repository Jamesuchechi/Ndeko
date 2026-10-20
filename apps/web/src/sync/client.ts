import type { EventStore } from '@ndeko/store';
import type { HlcClock, NdekoEvent } from '@ndeko/core';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncClientConfig {
  serverUrl: string;
  deviceToken: string;
  batchSize?: number;
  pullLimit?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
}

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncTime: number | null;
  lastError: string | null;
  driftWarning: boolean;
  cursor: number;
}

export interface PushResponsePayload {
  results: Array<{
    id: string;
    status: 'accepted' | 'duplicate' | 'rejected';
    error?: string;
  }>;
  highestServerSeq: number;
}

export interface PullResponsePayload {
  events: NdekoEvent[];
  nextCursor: number;
  hasMore: boolean;
}

export class SyncClient {
  private config: SyncClientConfig;
  private store: EventStore;
  private clock: HlcClock;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight = false;
  private retryCount = 0;
  private listeners = new Set<(state: SyncState) => void>();
  private onRemoteEventsCallbacks = new Set<
    (events: readonly NdekoEvent[]) => Promise<void> | void
  >();

  public state: SyncState = {
    status: 'idle',
    pendingCount: 0,
    lastSyncTime: null,
    lastError: null,
    driftWarning: false,
    cursor: 0,
  };

  constructor(config: SyncClientConfig, store: EventStore, clock: HlcClock) {
    this.config = {
      batchSize: 50,
      pullLimit: 500,
      minIntervalMs: 4000,
      maxIntervalMs: 60000,
      ...config,
    };
    this.store = store;
    this.clock = clock;

    // Load initial cursor from store
    this.store.getPullCursor().then((c) => {
      this.state.cursor = c;
    });

    // Bind browser online/offline events if in browser
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.updateState({ status: 'idle', lastError: null });
        this.syncNow();
      });
      window.addEventListener('offline', () => {
        this.updateState({ status: 'offline' });
      });
    }
  }

  updateConfig(newConfig: Partial<SyncClientConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onRemoteEvents(callback: (events: readonly NdekoEvent[]) => Promise<void> | void): () => void {
    this.onRemoteEventsCallbacks.add(callback);
    return () => {
      this.onRemoteEventsCallbacks.delete(callback);
    };
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async syncNow(): Promise<void> {
    if (this.inFlight) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.performSync();
    if (this.running) {
      this.scheduleNext(this.calculateNextDelay());
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(async () => {
      await this.performSync();
      if (this.running) {
        this.scheduleNext(this.calculateNextDelay());
      }
    }, delayMs);
  }

  private calculateNextDelay(): number {
    const min = this.config.minIntervalMs ?? 4000;
    const max = this.config.maxIntervalMs ?? 60000;

    if (this.retryCount === 0) {
      return min;
    }

    // Exponential backoff: min * 2^(retryCount - 1) + jitter
    const exp = Math.min(max, min * Math.pow(2, this.retryCount - 1));
    const jitter = Math.random() * 1000;
    return Math.min(max, exp + jitter);
  }

  private async performSync(): Promise<void> {
    if (this.inFlight) return;

    // Check offline status
    if (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false
    ) {
      this.updateState({ status: 'offline' });
      return;
    }

    if (!this.config.deviceToken || !this.config.serverUrl) {
      return;
    }

    this.inFlight = true;
    this.updateState({ status: 'syncing' });

    try {
      // 1. Refresh pending count
      const pendingCount = await this.store.pendingCount();
      this.updateState({ pendingCount });

      // 2. Push local pending events
      const batchSize = this.config.batchSize ?? 50;
      const pendingEvents = await this.store.pending(batchSize);

      if (pendingEvents.length > 0) {
        const pushRes = await fetch(`${this.config.serverUrl}/sync/push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.deviceToken}`,
          },
          body: JSON.stringify({ events: pendingEvents }),
        });

        if (!pushRes.ok) {
          const errText = await pushRes.text();
          throw new Error(`Push failed HTTP ${pushRes.status}: ${errText}`);
        }

        const pushData: PushResponsePayload = await pushRes.json();
        const ackedIds = pushData.results
          .filter((r) => r.status === 'accepted' || r.status === 'duplicate')
          .map((r) => r.id);

        if (ackedIds.length > 0) {
          await this.store.markAcked(ackedIds, pushData.highestServerSeq);
        }

        const updatedPending = await this.store.pendingCount();
        this.updateState({ pendingCount: updatedPending });
      }

      // 3. Pull remote events
      const pullLimit = this.config.pullLimit ?? 500;
      const currentCursor = await this.store.getPullCursor();
      const pullRes = await fetch(
        `${this.config.serverUrl}/sync/pull?since=${currentCursor}&limit=${pullLimit}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.config.deviceToken}`,
          },
        },
      );

      if (!pullRes.ok) {
        const errText = await pullRes.text();
        throw new Error(`Pull failed HTTP ${pullRes.status}: ${errText}`);
      }

      const pullData: PullResponsePayload = await pullRes.json();

      let driftDetected = this.state.driftWarning;
      if (pullData.events.length > 0) {
        // Merge remote HLCs and check drift guard
        for (const re of pullData.events) {
          const res = this.clock.receive(re.hlc);
          if (res.drifted) {
            driftDetected = true;
          }
        }

        // Ingest into local store (pure appendRemote with UUIDv7 deduplication)
        await this.store.appendRemote(pullData.events);

        // Update cursor in store
        const nextCursor = pullData.nextCursor;
        await this.store.setPullCursor(nextCursor);

        this.updateState({
          cursor: nextCursor,
          driftWarning: driftDetected,
        });

        // Notify subscribers about new remote events to update projections
        for (const cb of this.onRemoteEventsCallbacks) {
          await cb(pullData.events);
        }
      }

      // Successful sync
      this.retryCount = 0;
      const finalPending = await this.store.pendingCount();
      this.updateState({
        status: 'idle',
        pendingCount: finalPending,
        lastSyncTime: Date.now(),
        lastError: null,
      });

      // If server indicated more events exist, trigger another pull immediately
      if (pullData.hasMore) {
        setTimeout(() => this.syncNow(), 50);
      }
    } catch (err: unknown) {
      this.retryCount++;
      const msg = err instanceof Error ? err.message : String(err);
      this.updateState({
        status: 'error',
        lastError: msg,
      });
    } finally {
      this.inFlight = false;
    }
  }
}
