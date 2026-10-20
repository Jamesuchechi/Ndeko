import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { uuidv7, formatHlc, type NdekoEvent } from '@ndeko/core';
import { buildApp } from './app';
import { MemorySyncStore } from './db/memory';
import type { RegisterDeviceOutput, PushResponse, PullResponse } from './types';

describe('Ndekọ Sync API', () => {
  let app: FastifyInstance;
  let db: MemorySyncStore;

  beforeEach(async () => {
    db = new MemorySyncStore();
    app = buildApp({ db });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns status ok', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.time).toBeDefined();
  });

  describe('Device registration & Auth', () => {
    it('rejects registration with missing fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: { orgId: 'org1' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('registers a device and returns deviceToken', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          orgId: 'org_test_1',
          branchCode: 'ABJ1',
          deviceCode: 'D1',
        },
      });
      expect(res.statusCode).toBe(201);
      const data: RegisterDeviceOutput = JSON.parse(res.body);
      expect(data.deviceId).toBeDefined();
      expect(data.deviceToken).toMatch(/^dt_/);
      expect(data.orgId).toBe('org_test_1');
      expect(data.branchCode).toBe('ABJ1');
      expect(data.deviceCode).toBe('D1');
    });

    it('rejects unauthenticated requests to /sync/push and /sync/pull', async () => {
      const pushRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        payload: { events: [] },
      });
      expect(pushRes.statusCode).toBe(401);

      const pullRes = await app.inject({
        method: 'GET',
        url: '/sync/pull',
      });
      expect(pullRes.statusCode).toBe(401);

      const badTokenRes = await app.inject({
        method: 'GET',
        url: '/sync/pull',
        headers: {
          authorization: 'Bearer bad_token_123',
        },
      });
      expect(badTokenRes.statusCode).toBe(401);
    });
  });

  describe('Push, Idempotency & Validation', () => {
    let dev1: RegisterDeviceOutput;

    beforeEach(async () => {
      const reg = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          orgId: 'org_retail_1',
          branchCode: 'LAG1',
          deviceCode: 'TILL1',
        },
      });
      dev1 = JSON.parse(reg.body);
    });

    it('accepts valid events and is idempotent on repeat push', async () => {
      const event1: NdekoEvent = {
        id: uuidv7(),
        orgId: dev1.orgId,
        branchId: dev1.branchId,
        deviceId: dev1.deviceId,
        seq: 1,
        hlc: formatHlc(1700000000000, 0, dev1.deviceId),
        type: 'PRODUCT_UPSERTED',
        schemaV: 1,
        payload: {
          productId: 'prod_milo',
          name: 'Nestle Milo 500g',
          priceKobo: 250000,
          costKobo: 210000,
          unit: 'each',
        },
        createdAt: 1700000000000,
      };

      // 1. First push: accepted
      const res1 = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${dev1.deviceToken}` },
        payload: { events: [event1] },
      });
      expect(res1.statusCode).toBe(200);
      const body1: PushResponse = JSON.parse(res1.body);
      expect(body1.results).toHaveLength(1);
      expect(body1.results[0]?.id).toBe(event1.id);
      expect(body1.results[0]?.status).toBe('accepted');
      expect(body1.highestServerSeq).toBeGreaterThan(0);

      // 2. Second push with same event: duplicate (idempotent ON CONFLICT DO NOTHING)
      const res2 = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${dev1.deviceToken}` },
        payload: { events: [event1] },
      });
      expect(res2.statusCode).toBe(200);
      const body2: PushResponse = JSON.parse(res2.body);
      expect(body2.results[0]?.status).toBe('duplicate');
    });

    it('rejects malformed and invalid event payloads', async () => {
      const invalidEvent = {
        id: 'not-a-uuidv7',
        orgId: dev1.orgId,
        branchId: dev1.branchId,
        deviceId: dev1.deviceId,
        seq: 1,
        hlc: 'bad-hlc',
        type: 'UNKNOWN_TYPE_HERE',
        schemaV: 1,
        payload: {},
        createdAt: 1700000000000,
      };

      const res = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${dev1.deviceToken}` },
        payload: { events: [invalidEvent] },
      });
      expect(res.statusCode).toBe(200);
      const body: PushResponse = JSON.parse(res.body);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.error).toBeDefined();
    });
  });

  describe('Pull, Pagination & Device Self-Exclusion', () => {
    let dev1: RegisterDeviceOutput;
    let dev2: RegisterDeviceOutput;

    beforeEach(async () => {
      const reg1 = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          orgId: 'org_shared',
          branchCode: 'ABJ1',
          deviceCode: 'D1',
        },
      });
      dev1 = JSON.parse(reg1.body);

      const reg2 = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          orgId: 'org_shared',
          branchCode: 'ABJ1',
          deviceCode: 'D2',
        },
      });
      dev2 = JSON.parse(reg2.body);
    });

    it('excludes pulling device own events and supports resumable cursor', async () => {
      // Dev1 pushes an event
      const e1: NdekoEvent = {
        id: uuidv7(),
        orgId: dev1.orgId,
        branchId: dev1.branchId,
        deviceId: dev1.deviceId,
        seq: 1,
        hlc: formatHlc(1700000000000, 0, dev1.deviceId),
        type: 'PRODUCT_UPSERTED',
        schemaV: 1,
        payload: {
          productId: 'prod_1',
          name: 'Item 1',
          priceKobo: 10000,
        },
        createdAt: 1700000000000,
      };

      await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${dev1.deviceToken}` },
        payload: { events: [e1] },
      });

      // 1. Dev1 pulls with since=0 -> should get 0 events (self-exclusion!)
      const pullSelf = await app.inject({
        method: 'GET',
        url: '/sync/pull?since=0',
        headers: { authorization: `Bearer ${dev1.deviceToken}` },
      });
      expect(pullSelf.statusCode).toBe(200);
      const selfBody: PullResponse = JSON.parse(pullSelf.body);
      expect(selfBody.events).toHaveLength(0);

      // 2. Dev2 pulls with since=0 -> should get e1 from Dev1
      const pullDev2 = await app.inject({
        method: 'GET',
        url: '/sync/pull?since=0',
        headers: { authorization: `Bearer ${dev2.deviceToken}` },
      });
      expect(pullDev2.statusCode).toBe(200);
      const dev2Body: PullResponse = JSON.parse(pullDev2.body);
      expect(dev2Body.events).toHaveLength(1);
      expect(dev2Body.events[0]?.id).toBe(e1.id);
      expect(dev2Body.nextCursor).toBeGreaterThan(0);

      // 3. Dev2 pulls with since=nextCursor -> should get 0 new events
      const pullNext = await app.inject({
        method: 'GET',
        url: `/sync/pull?since=${dev2Body.nextCursor}`,
        headers: { authorization: `Bearer ${dev2.deviceToken}` },
      });
      expect(pullNext.statusCode).toBe(200);
      const nextBody: PullResponse = JSON.parse(pullNext.body);
      expect(nextBody.events).toHaveLength(0);
    });
  });

  describe('Org Scoping & Tenant Isolation Test', () => {
    let devOrgA: RegisterDeviceOutput;
    let devOrgB: RegisterDeviceOutput;

    beforeEach(async () => {
      const regA = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          orgId: 'org_alpha',
          branchCode: 'MAIN',
          deviceCode: 'D_A',
        },
      });
      devOrgA = JSON.parse(regA.body);

      const regB = await app.inject({
        method: 'POST',
        url: '/devices/register',
        payload: {
          orgId: 'org_beta',
          branchCode: 'MAIN',
          deviceCode: 'D_B',
        },
      });
      devOrgB = JSON.parse(regB.body);
    });

    it('asserts Org B cannot read Org A events', async () => {
      // Org A pushes 2 events
      const eventA1: NdekoEvent = {
        id: uuidv7(),
        orgId: devOrgA.orgId,
        branchId: devOrgA.branchId,
        deviceId: devOrgA.deviceId,
        seq: 1,
        hlc: formatHlc(1700000000000, 0, devOrgA.deviceId),
        type: 'PRODUCT_UPSERTED',
        schemaV: 1,
        payload: {
          productId: 'prod_secret_a',
          name: 'Org A Secret Recipe',
          priceKobo: 500000,
        },
        createdAt: 1700000000000,
      };

      const eventA2: NdekoEvent = {
        id: uuidv7(),
        orgId: devOrgA.orgId,
        branchId: devOrgA.branchId,
        deviceId: devOrgA.deviceId,
        seq: 2,
        hlc: formatHlc(1700000000001, 0, devOrgA.deviceId),
        type: 'STOCK_RECEIVED',
        schemaV: 1,
        payload: {
          productId: 'prod_secret_a',
          qty: 100000,
          unitCostKobo: 300000,
        },
        createdAt: 1700000000001,
      };

      const pushRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${devOrgA.deviceToken}` },
        payload: { events: [eventA1, eventA2] },
      });
      expect(pushRes.statusCode).toBe(200);

      // Org B attempts to pull all events with since=0
      const pullRes = await app.inject({
        method: 'GET',
        url: '/sync/pull?since=0&limit=100',
        headers: { authorization: `Bearer ${devOrgB.deviceToken}` },
      });
      expect(pullRes.statusCode).toBe(200);
      const pullData: PullResponse = JSON.parse(pullRes.body);

      // Org B MUST NOT receive any events from Org A
      expect(pullData.events).toHaveLength(0);
      expect(pullData.events.find((e) => e.orgId === 'org_alpha')).toBeUndefined();
    });

    it('rejects an event if its orgId does not match the authenticated device orgId', async () => {
      // Device B tries to inject an event tagged with org_alpha
      const forgedEvent: NdekoEvent = {
        id: uuidv7(),
        orgId: 'org_alpha', // mismatch with devOrgB (org_beta)
        branchId: devOrgB.branchId,
        deviceId: devOrgB.deviceId,
        seq: 1,
        hlc: formatHlc(1700000000000, 0, devOrgB.deviceId),
        type: 'PRODUCT_UPSERTED',
        schemaV: 1,
        payload: {
          productId: 'prod_forged',
          name: 'Forged Product',
          priceKobo: 100,
        },
        createdAt: 1700000000000,
      };

      const pushRes = await app.inject({
        method: 'POST',
        url: '/sync/push',
        headers: { authorization: `Bearer ${devOrgB.deviceToken}` },
        payload: { events: [forgedEvent] },
      });
      expect(pushRes.statusCode).toBe(200);
      const body: PushResponse = JSON.parse(pushRes.body);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.error).toContain('Tenant isolation violation');
    });
  });
});
