import type { NdekoEvent } from '@ndeko/core';

export interface Org {
  id: string;
  name: string;
  createdAt: string;
}

export interface Branch {
  id: string;
  orgId: string;
  code: string;
  name: string;
  createdAt: string;
}

export interface Device {
  id: string;
  orgId: string;
  branchId: string;
  code: string;
  deviceToken: string;
  createdAt: string;
  lastSeenAt?: string | null;
}

export interface RegisterDeviceInput {
  orgId: string;
  branchCode: string;
  deviceCode: string;
}

export interface RegisterDeviceOutput {
  deviceId: string;
  deviceToken: string;
  orgId: string;
  branchId: string;
  branchCode: string;
  deviceCode: string;
}

export interface PushResult {
  id: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  error?: string;
}

export interface PushRequest {
  events: NdekoEvent[];
}

export interface PushResponse {
  results: PushResult[];
  highestServerSeq: number;
}

export interface PullRequestQuery {
  since?: string | number;
  limit?: string | number;
}

export interface PullResponse {
  events: NdekoEvent[];
  nextCursor: number;
  hasMore: boolean;
}
