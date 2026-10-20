# Ndekọ

> _Ndekọ_ is Igbo for a record or register, which is what the event log is. Written with the dot under the ọ in prose; the repo, packages and URLs use plain ASCII `ndeko`.

**An offline-first shop OS for small retailers.** Point of sale, inventory, customer credit and multi-branch stock that keep working when the power or the network goes out, then sync cleanly when they come back.

Small retailers in Nigeria lose sales and trust in their numbers every time connectivity drops. Ndekọ treats the device as the source of truth: every sale, receipt and stock movement is recorded locally first, as an immutable event, and synced later. Offline is the normal case, not an error state.

---

## Status

Pre-alpha. See [`TODO.md`](./TODO.md) for the roadmap and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for design decisions.

## Features

**Phase 1 (local core)**

- POS screen with product search and barcode scanning
- Cash and credit sales, receipts (view and print)
- Stock receive and adjust, append-only stock ledger
- Works with no server and no network

**Phase 2 (sync)**

- Event-log sync across devices and branches
- Idempotent replay, safe to retry any request
- Visible sync status ("3 pending")

**Phase 3 and beyond**

- Customer credit balances and repayments
- End-of-day cash-up, low-stock alerts, supplier purchase orders
- Multi-branch stock transfers, roles (owner, manager, cashier)
- Paystack and POS-terminal reconciliation, WhatsApp receipts

## How it works, in one paragraph

Every user action becomes an **event** (`SALE_RECORDED`, `STOCK_RECEIVED`, ...) appended to a local log. Current stock, balances and reports are **projections** computed from that log. Devices sync by exchanging events, never state. Because events are immutable, uniquely identified and ordered by a hybrid logical clock, merging is mostly a set union, and two tills selling the last unit never overwrite each other.

## Tech stack

| Layer         | Choice                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| Client        | React + Vite PWA, TypeScript (strict)                                                     |
| Local storage | SQLite-WASM on OPFS, with an IndexedDB (Dexie) fallback, behind an `EventStore` interface |
| Server        | Fastify sync API on Postgres (Supabase-hosted to start)                                   |
| Validation    | Zod, one schema per event type and version                                                |
| IDs           | UUIDv7                                                                                    |
| Money         | Integer kobo, never floats                                                                |
| Tests         | Vitest, plus a deterministic multi-device convergence simulator                           |

## Repository layout

```
ndeko/
├── apps/
│   ├── web/            # PWA: POS, inventory, reports
│   └── api/            # Sync server (push/pull, auth, device registry)
├── packages/
│   ├── core/           # Events, HLC, projection engine. Pure TS, no I/O
│   ├── schemas/        # Zod schemas + versioned event upcasters
│   ├── projections/    # Stock and products projections
│   ├── store/          # EventStore adapters: memory, dexie, sqlite-wasm
│   └── sim/            # Convergence simulator (N devices, random offline)
├── ARCHITECTURE.md
├── TODO.md
└── README.md
```

## Getting started

Prerequisites: Node.js 20.19+ and pnpm 9+.

```bash
git clone git@github.com:Jamesuchechi/ndeko.git
cd ndeko
pnpm install
cp apps/api/.env.example apps/api/.env   # Phase 2 only
pnpm dev                                  # starts the web app
```

The web app runs fully offline from Phase 1; the API is only needed once sync lands.

## Scripts

| Command          | Description                                |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | Run the web app in dev mode                |
| `pnpm build`     | Build all packages and apps                |
| `pnpm test`      | Run unit tests                             |
| `pnpm test:sim`  | Run the convergence simulator (many seeds) |
| `pnpm lint`      | ESLint                                     |
| `pnpm typecheck` | `tsc --noEmit` across the workspace        |

## Principles

1. **Never reject a completed sale.** Reality already happened; reconcile afterwards.
2. **Never edit history.** Corrections are new events.
3. **Money is integers.** Quantities are integer milli-units.
4. **Projections must be order-independent.** If two devices apply the same events in any order, they must reach the same state.
5. **Secrets stay out of git.** Commit `.env.example` only.

## License

MIT
