import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryEventStore } from '@ndeko/store';
import { HlcClock, uuidv7, formatHlc, type NdekoEvent } from '@ndeko/core';
import { SyncClient } from './client';

describe('SyncClient', () => {
  let store: MemoryEventStore;
  let clock: HlcClock;
  let client: SyncClient;
  let storageMap: Map<string, string>;

  beforeEach(() => {
    storageMap = new Map();
    const mockLocalStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => storageMap.set(key, value),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
    };
    vi.stubGlobal('localStorage', mockLocalStorage);

    store = new MemoryEventStore();
    clock = new HlcClock({ deviceId: 'test-dev-1', now: () => 1700000000000 });
  });

  afterEach(() => {
    if (client) client.stop();
    vi.restoreAllMocks();
  });

  it('pushes pending events and marks them acked on success', async () => {
    // Append 1 pending event locally
    const e1: NdekoEvent = {
      id: uuidv7(),
      orgId: 'org1',
      branchId: 'b1',
      deviceId: 'test-dev-1',
      seq: 1,
      hlc: clock.tick(),
      type: 'PRODUCT_UPSERTED',
      schemaV: 1,
      payload: { productId: 'p1', name: 'Item 1' },
      createdAt: 1700000000000,
    };
    await store.append(e1);
    expect(await store.pendingCount()).toBe(1);

    // Mock fetch for push and pull
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/sync/push')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              results: [{ id: e1.id, status: 'accepted' }],
              highestServerSeq: 42,
            }),
        });
      }
      if (url.includes('/sync/pull')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              events: [],
              nextCursor: 0,
              hasMore: false,
            }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    client = new SyncClient(
      {
        serverUrl: 'http://localhost:8787',
        deviceToken: 'token_123',
      },
      store,
      clock,
    );

    await client.syncNow();

    expect(client.state.status).toBe('idle');
    expect(client.state.pendingCount).toBe(0);
    expect(await store.pendingCount()).toBe(0);
  });

  it('pulls remote events, advances cursor, and triggers projection callback', async () => {
    const remoteEvent: NdekoEvent = {
      id: uuidv7(),
      orgId: 'org1',
      branchId: 'b1',
      deviceId: 'remote-dev-2',
      seq: 5,
      hlc: formatHlc(1700000000500, 0, 'remote-dev-2'),
      type: 'PRODUCT_UPSERTED',
      schemaV: 1,
      payload: { productId: 'p2', name: 'Remote Item' },
      createdAt: 1700000000500,
    };

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/sync/push')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ results: [], highestServerSeq: 0 }),
        });
      }
      if (url.includes('/sync/pull')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              events: [remoteEvent],
              nextCursor: 10,
              hasMore: false,
            }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    client = new SyncClient(
      {
        serverUrl: 'http://localhost:8787',
        deviceToken: 'token_123',
      },
      store,
      clock,
    );

    const projectionCallback = vi.fn();
    client.onRemoteEvents(projectionCallback);

    await client.syncNow();

    expect(client.state.cursor).toBe(10);
    expect(await store.getPullCursor()).toBe(10);
    expect(projectionCallback).toHaveBeenCalledTimes(1);

    // Verify event is in store
    const read = await store.readSince(0, 10);
    expect(read.events).toHaveLength(1);
    expect(read.events[0]?.id).toBe(remoteEvent.id);
  });

  it('detects clock drift when remote event wall time is far in future', async () => {
    // Current time 1700000000000; remote event 1 hour ahead
    const driftedHlc = formatHlc(1700000000000 + 3600000, 0, 'bad-clock-dev');
    const remoteEvent: NdekoEvent = {
      id: uuidv7(),
      orgId: 'org1',
      branchId: 'b1',
      deviceId: 'bad-clock-dev',
      seq: 1,
      hlc: driftedHlc,
      type: 'PRODUCT_UPSERTED',
      schemaV: 1,
      payload: { productId: 'p3', name: 'Drifted Item' },
      createdAt: 1700000000000 + 3600000,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/sync/push')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ results: [], highestServerSeq: 0 }),
          });
        }
        if (url.includes('/sync/pull')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                events: [remoteEvent],
                nextCursor: 15,
                hasMore: false,
              }),
          });
        }
        return Promise.reject(new Error('Unknown url'));
      }),
    );

    client = new SyncClient(
      {
        serverUrl: 'http://localhost:8787',
        deviceToken: 'token_123',
      },
      store,
      clock,
    );

    await client.syncNow();

    expect(client.state.driftWarning).toBe(true);
  });

  it('handles server network failure gracefully with error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Failed to fetch: Connection refused')),
    );

    client = new SyncClient(
      {
        serverUrl: 'http://localhost:8787',
        deviceToken: 'token_123',
      },
      store,
      clock,
    );

    await client.syncNow();

    expect(client.state.status).toBe('error');
    expect(client.state.lastError).toContain('Connection refused');
  });
});
