import { buildApp } from './app';
import { PgSyncStore } from './db/pg';
import { MemorySyncStore } from './db/memory';
import type { SyncDatabase } from './db/store';

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '0.0.0.0';

let db: SyncDatabase;
if (process.env.DATABASE_URL) {
  console.warn(`Connecting to PostgreSQL via DATABASE_URL...`);
  db = new PgSyncStore(process.env.DATABASE_URL);
} else {
  console.warn(`No DATABASE_URL provided. Running with in-memory sync store.`);
  db = new MemorySyncStore();
}

const app = buildApp({ db });

async function start() {
  try {
    const address = await app.listen({ port, host });
    console.warn(`Ndekọ Sync API listening on ${address}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

const shutdown = async () => {
  console.warn('Shutting down Ndekọ Sync API...');
  await app.close();
  if (db.close) {
    await db.close();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
