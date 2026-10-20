import { parseEvent } from '@ndeko/schemas';
import { uuidv7, type NdekoEvent } from '@ndeko/core';
import type {
  Org,
  Branch,
  Device,
  RegisterDeviceInput,
  RegisterDeviceOutput,
  PushResponse,
  PushResult,
  PullResponse,
} from '../types';
import type { SyncDatabase } from './store';

interface StoredServerEvent {
  serverSeq: number;
  orgId: string;
  branchId: string;
  deviceId: string;
  event: NdekoEvent;
}

export class MemorySyncStore implements SyncDatabase {
  private orgs = new Map<string, Org>();
  private branches = new Map<string, Branch>(); // key: `${orgId}:${code}`
  private branchesById = new Map<string, Branch>();
  private devices = new Map<string, Device>(); // key: deviceId
  private devicesByToken = new Map<string, Device>(); // key: deviceToken
  private events: StoredServerEvent[] = [];
  private eventIds = new Set<string>(); // key: `${orgId}:${eventId}`
  private nextSeq = 1;

  async createOrg(id: string, name: string): Promise<Org> {
    const org: Org = {
      id,
      name,
      createdAt: new Date().toISOString(),
    };
    this.orgs.set(id, org);
    return org;
  }

  async getOrg(id: string): Promise<Org | null> {
    return this.orgs.get(id) ?? null;
  }

  async createBranch(id: string, orgId: string, code: string, name: string): Promise<Branch> {
    const branch: Branch = {
      id,
      orgId,
      code,
      name,
      createdAt: new Date().toISOString(),
    };
    this.branches.set(`${orgId}:${code}`, branch);
    this.branchesById.set(id, branch);
    return branch;
  }

  async getBranch(orgId: string, code: string): Promise<Branch | null> {
    return this.branches.get(`${orgId}:${code}`) ?? null;
  }

  async registerDevice(input: RegisterDeviceInput): Promise<RegisterDeviceOutput> {
    let org = this.orgs.get(input.orgId);
    if (!org) {
      org = await this.createOrg(input.orgId, `Org ${input.orgId}`);
    }

    let branch = this.branches.get(`${input.orgId}:${input.branchCode}`);
    if (!branch) {
      branch = await this.createBranch(
        uuidv7(),
        input.orgId,
        input.branchCode,
        `Branch ${input.branchCode}`,
      );
    }

    const deviceId = uuidv7();
    const deviceToken = `dt_${deviceId}_${Math.random().toString(36).substring(2, 15)}`;
    const device: Device = {
      id: deviceId,
      orgId: input.orgId,
      branchId: branch.id,
      code: input.deviceCode,
      deviceToken,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };

    this.devices.set(deviceId, device);
    this.devicesByToken.set(deviceToken, device);

    return {
      deviceId,
      deviceToken,
      orgId: input.orgId,
      branchId: branch.id,
      branchCode: branch.code,
      deviceCode: input.deviceCode,
    };
  }

  async getDeviceByToken(token: string): Promise<Device | null> {
    return this.devicesByToken.get(token) ?? null;
  }

  async pushEvents(orgId: string, deviceId: string, events: NdekoEvent[]): Promise<PushResponse> {
    const results: PushResult[] = [];
    let highestServerSeq = 0;

    for (const raw of events) {
      // 1. Validate envelope and payload schema via @ndeko/schemas
      const parsed = parseEvent(raw);
      if (!parsed.ok) {
        results.push({
          id: raw && typeof raw === 'object' && 'id' in raw ? String(raw.id) : 'unknown',
          status: 'rejected',
          error: parsed.error,
        });
        continue;
      }

      const e = parsed.event;

      // 2. Tenant isolation check: event orgId must match device's authenticated orgId
      if (e.orgId !== orgId) {
        results.push({
          id: e.id,
          status: 'rejected',
          error: `Tenant isolation violation: event orgId (${e.orgId}) does not match authenticated orgId (${orgId})`,
        });
        continue;
      }

      // 3. Deduplication: idempotent ON CONFLICT (id) DO NOTHING
      const dedupeKey = `${orgId}:${e.id}`;
      if (this.eventIds.has(dedupeKey)) {
        results.push({
          id: e.id,
          status: 'duplicate',
        });
        continue;
      }

      // 4. Ingest and assign server_seq
      const serverSeq = this.nextSeq++;
      this.eventIds.add(dedupeKey);
      this.events.push({
        serverSeq,
        orgId,
        branchId: e.branchId,
        deviceId: e.deviceId,
        event: e,
      });

      if (serverSeq > highestServerSeq) {
        highestServerSeq = serverSeq;
      }

      results.push({
        id: e.id,
        status: 'accepted',
      });
    }

    // If no new events were accepted in this batch, look up the highest existing serverSeq for this org
    if (highestServerSeq === 0) {
      for (let i = this.events.length - 1; i >= 0; i--) {
        const item = this.events[i];
        if (item && item.orgId === orgId) {
          highestServerSeq = item.serverSeq;
          break;
        }
      }
    }

    return {
      results,
      highestServerSeq,
    };
  }

  async pullEvents(
    orgId: string,
    requestingDeviceId: string,
    since: number,
    limit: number,
  ): Promise<PullResponse> {
    const matching: StoredServerEvent[] = [];

    for (const item of this.events) {
      if (item.orgId === orgId && item.serverSeq > since && item.deviceId !== requestingDeviceId) {
        matching.push(item);
      }
    }

    const maxItems = Math.min(Math.max(1, limit), 1000);
    const sliced = matching.slice(0, maxItems);
    const hasMore = matching.length > maxItems;

    let nextCursor = since;
    if (sliced.length > 0) {
      const last = sliced[sliced.length - 1];
      if (last) {
        nextCursor = last.serverSeq;
      }
    }

    return {
      events: sliced.map((s) => s.event),
      nextCursor,
      hasMore,
    };
  }

  async close(): Promise<void> {
    // No-op for in-memory
  }
}
