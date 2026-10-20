import pg from 'pg';
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

const { Pool } = pg;

export class PgSyncStore implements SyncDatabase {
  private pool: pg.Pool;

  constructor(connectionStringOrConfig?: string | pg.PoolConfig) {
    if (typeof connectionStringOrConfig === 'string') {
      this.pool = new Pool({ connectionString: connectionStringOrConfig });
    } else if (connectionStringOrConfig) {
      this.pool = new Pool(connectionStringOrConfig);
    } else {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/ndeko',
      });
    }
  }

  async createOrg(id: string, name: string): Promise<Org> {
    const res = await this.pool.query<Org>(
      `INSERT INTO orgs (id, name)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name, created_at as "createdAt"`,
      [id, name],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to create org');
    return row;
  }

  async getOrg(id: string): Promise<Org | null> {
    const res = await this.pool.query<Org>(
      `SELECT id, name, created_at as "createdAt" FROM orgs WHERE id = $1`,
      [id],
    );
    return res.rows[0] ?? null;
  }

  async createBranch(id: string, orgId: string, code: string, name: string): Promise<Branch> {
    const res = await this.pool.query<Branch>(
      `INSERT INTO branches (id, org_id, code, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, org_id as "orgId", code, name, created_at as "createdAt"`,
      [id, orgId, code, name],
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to create branch');
    return row;
  }

  async getBranch(orgId: string, code: string): Promise<Branch | null> {
    const res = await this.pool.query<Branch>(
      `SELECT id, org_id as "orgId", code, name, created_at as "createdAt"
       FROM branches WHERE org_id = $1 AND code = $2`,
      [orgId, code],
    );
    return res.rows[0] ?? null;
  }

  async registerDevice(input: RegisterDeviceInput): Promise<RegisterDeviceOutput> {
    // Ensure org exists
    let org = await this.getOrg(input.orgId);
    if (!org) {
      org = await this.createOrg(input.orgId, `Org ${input.orgId}`);
    }

    // Ensure branch exists
    let branch = await this.getBranch(input.orgId, input.branchCode);
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

    const res = await this.pool.query<Device>(
      `INSERT INTO devices (id, org_id, branch_id, code, device_token, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (org_id, code) DO UPDATE
       SET device_token = EXCLUDED.device_token, last_seen_at = NOW()
       RETURNING id, org_id as "orgId", branch_id as "branchId", code,
                 device_token as "deviceToken", created_at as "createdAt"`,
      [deviceId, input.orgId, branch.id, input.deviceCode, deviceToken],
    );

    const dev = res.rows[0];
    if (!dev) throw new Error('Failed to register device');

    return {
      deviceId: dev.id,
      deviceToken: dev.deviceToken,
      orgId: dev.orgId,
      branchId: branch.id,
      branchCode: branch.code,
      deviceCode: dev.code,
    };
  }

  async getDeviceByToken(token: string): Promise<Device | null> {
    const res = await this.pool.query<Device>(
      `SELECT id, org_id as "orgId", branch_id as "branchId", code,
              device_token as "deviceToken", created_at as "createdAt",
              last_seen_at as "lastSeenAt"
       FROM devices WHERE device_token = $1`,
      [token],
    );
    return res.rows[0] ?? null;
  }

  async pushEvents(orgId: string, _deviceId: string, events: NdekoEvent[]): Promise<PushResponse> {
    const results: PushResult[] = [];
    let highestServerSeq = 0;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const raw of events) {
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

        // Tenant isolation check
        if (e.orgId !== orgId) {
          results.push({
            id: e.id,
            status: 'rejected',
            error: `Tenant isolation violation: event orgId (${e.orgId}) does not match authenticated orgId (${orgId})`,
          });
          continue;
        }

        // Idempotent insertion: ON CONFLICT (id) DO NOTHING
        const insertRes = await client.query<{ server_seq: string }>(
          `INSERT INTO events (id, org_id, branch_id, device_id, type, hlc, schema_v, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING server_seq`,
          [
            e.id,
            orgId,
            e.branchId || null,
            e.deviceId,
            e.type,
            e.hlc,
            e.schemaV,
            JSON.stringify(e.payload),
          ],
        );

        if (insertRes.rowCount && insertRes.rowCount > 0 && insertRes.rows[0]) {
          const sSeq = Number(insertRes.rows[0].server_seq);
          if (sSeq > highestServerSeq) {
            highestServerSeq = sSeq;
          }
          results.push({ id: e.id, status: 'accepted' });
        } else {
          results.push({ id: e.id, status: 'duplicate' });
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (highestServerSeq === 0) {
      const maxRes = await this.pool.query<{ max_seq: string }>(
        `SELECT COALESCE(MAX(server_seq), 0) as max_seq FROM events WHERE org_id = $1`,
        [orgId],
      );
      if (maxRes.rows[0]) {
        highestServerSeq = Number(maxRes.rows[0].max_seq);
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
    const maxItems = Math.min(Math.max(1, limit), 1000);
    // Fetch limit + 1 to determine hasMore
    const res = await this.pool.query<{
      id: string;
      org_id: string;
      branch_id: string;
      device_id: string;
      seq: number;
      hlc: string;
      type: NdekoEvent['type'];
      schema_v: number;
      payload: unknown;
      server_seq: string;
    }>(
      `SELECT id, org_id, branch_id, device_id, type, hlc, schema_v, payload, server_seq
       FROM events
       WHERE org_id = $1 AND server_seq > $2 AND device_id != $3
       ORDER BY server_seq ASC
       LIMIT $4`,
      [orgId, since, requestingDeviceId, maxItems + 1],
    );

    const hasMore = res.rows.length > maxItems;
    const items = res.rows.slice(0, maxItems);

    let nextCursor = since;
    const events: NdekoEvent[] = items.map((r) => {
      const sSeq = Number(r.server_seq);
      if (sSeq > nextCursor) {
        nextCursor = sSeq;
      }
      return {
        id: r.id,
        orgId: r.org_id,
        branchId: r.branch_id,
        deviceId: r.device_id,
        seq: sSeq, // use serverSeq or event original sequence
        hlc: r.hlc,
        type: r.type,
        schemaV: r.schema_v,
        payload: r.payload,
        createdAt: 0,
      };
    });

    return {
      events,
      nextCursor,
      hasMore,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
