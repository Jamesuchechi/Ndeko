import type { NdekoEvent } from '@ndeko/core';
import type {
  Org,
  Branch,
  Device,
  RegisterDeviceInput,
  RegisterDeviceOutput,
  PushResponse,
  PullResponse,
} from '../types';

export interface SyncDatabase {
  createOrg(id: string, name: string): Promise<Org>;
  getOrg(id: string): Promise<Org | null>;
  createBranch(id: string, orgId: string, code: string, name: string): Promise<Branch>;
  getBranch(orgId: string, code: string): Promise<Branch | null>;
  registerDevice(input: RegisterDeviceInput): Promise<RegisterDeviceOutput>;
  getDeviceByToken(token: string): Promise<Device | null>;
  pushEvents(orgId: string, deviceId: string, events: NdekoEvent[]): Promise<PushResponse>;
  pullEvents(
    orgId: string,
    requestingDeviceId: string,
    since: number,
    limit: number,
  ): Promise<PullResponse>;
  close?(): Promise<void>;
}
