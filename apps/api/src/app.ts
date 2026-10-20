import fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import type { SyncDatabase } from './db/store';
import { MemorySyncStore } from './db/memory';
import type { Device, PushRequest, PullRequestQuery, RegisterDeviceInput } from './types';

declare module 'fastify' {
  interface FastifyRequest {
    device?: Device;
  }
}

export interface BuildAppOptions {
  db?: SyncDatabase;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = fastify({
    logger: false,
  });

  const db: SyncDatabase = options.db ?? new MemorySyncStore();

  // Register CORS
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Health check
  app.get('/health', async () => {
    return { status: 'ok', time: new Date().toISOString() };
  });

  // Register device
  app.post<{ Body: RegisterDeviceInput }>('/devices/register', async (req, reply) => {
    const { orgId, branchCode, deviceCode } = req.body || {};
    if (!orgId || !branchCode || !deviceCode) {
      return reply.status(400).send({
        error: 'Missing required fields: orgId, branchCode, deviceCode are required',
      });
    }

    try {
      const output = await db.registerDevice({ orgId, branchCode, deviceCode });
      return reply.status(201).send(output);
    } catch (err: unknown) {
      return reply.status(500).send({
        error: err instanceof Error ? err.message : 'Registration failed',
      });
    }
  });

  // Auth preHandler for sync routes
  const authenticateDevice = async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return reply.status(401).send({ error: 'Empty bearer token' });
    }

    const device = await db.getDeviceByToken(token);
    if (!device) {
      return reply.status(401).send({ error: 'Unauthorized: invalid device token' });
    }

    req.device = device;
  };

  // Push endpoint: POST /sync/push
  app.post<{ Body: PushRequest }>(
    '/sync/push',
    { preHandler: authenticateDevice },
    async (req, reply) => {
      const device = req.device;
      if (!device) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const body = req.body;
      if (!body || !Array.isArray(body.events)) {
        return reply.status(400).send({ error: 'Invalid payload: events array expected' });
      }

      try {
        const result = await db.pushEvents(device.orgId, device.id, body.events);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Push failed',
        });
      }
    },
  );

  // Pull endpoint: GET /sync/pull
  app.get<{ Querystring: PullRequestQuery }>(
    '/sync/pull',
    { preHandler: authenticateDevice },
    async (req, reply) => {
      const device = req.device;
      if (!device) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const since = req.query.since ? Number(req.query.since) : 0;
      const limit = req.query.limit ? Number(req.query.limit) : 500;

      if (Number.isNaN(since) || since < 0) {
        return reply.status(400).send({ error: 'Invalid since parameter: must be >= 0' });
      }
      if (Number.isNaN(limit) || limit <= 0) {
        return reply.status(400).send({ error: 'Invalid limit parameter: must be > 0' });
      }

      try {
        const result = await db.pullEvents(device.orgId, device.id, since, limit);
        return reply.status(200).send(result);
      } catch (err: unknown) {
        return reply.status(500).send({
          error: err instanceof Error ? err.message : 'Pull failed',
        });
      }
    },
  );

  return app;
}
