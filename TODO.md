# TODO

Legend: `[ ]` todo, `[x]` done. Each phase ends with a **Definition of done**; do not start the next phase until it holds.

## Phase 0: Foundations (days 1-3)

- [x] Create pnpm workspace: `apps/web`, `apps/api`, `packages/{core,schemas,store,sim}`
- [x] TypeScript strict, shared `tsconfig.base.json`
- [x] ESLint + Prettier + `pnpm typecheck`
- [x] Vitest wired for all packages
- [ ] CI: lint, typecheck, test on every push
- [x] `.env.example` committed, `.env` gitignored, single lockfile (`pnpm-lock.yaml`)
- [x] Decide product name: Ndekọ

**Done when:** a fresh clone runs `pnpm install && pnpm test` green.

## Phase 1: Local core (weeks 1-2)

**Domain and storage**

- [ ] Event envelope type (done in core) + zod schemas with `schemaV`
- [x] UUIDv7 generation
- [x] HLC implementation with unit tests (local tick, remote merge, drift guard)
- [ ] `EventStore` interface + `memory` adapter
- [ ] `dexie` adapter passing the shared `EventStore` contract tests
- [ ] Projection engine (pure fold) with snapshots
- [x] Money (integer kobo) and quantity (milli-unit) helpers, single rounding rule

**Products and stock**

- [ ] `PRODUCT_UPSERTED` + products screen (add, edit, archive)
- [ ] Barcode field + lookup
- [ ] `STOCK_RECEIVED` and `STOCK_ADJUSTED` (reason required)
- [ ] Stock levels projection and stock ledger view per product

**Selling**

- [ ] POS screen: search, barcode scan (`BarcodeDetector` with ZXing fallback), cart
- [ ] Cash sale and credit sale (customer required for credit)
- [ ] `SALE_RECORDED` and `SALE_VOIDED`
- [ ] Offline-safe receipt numbers (`branch-device-counter`)
- [ ] Receipt view and browser print
- [ ] Daily sales summary

**Platform**

- [ ] PWA manifest + service worker, installable, fully usable offline
- [ ] `navigator.storage.persist()` request
- [ ] Encrypted JSON backup export and import
- [ ] Till PIN lock

**Done when:** with network disabled, a cashier can receive stock, sell, void, print a receipt and see correct stock, and a backup restores identical state.

## Phase 2: Sync (weeks 3-4)

**Server**

- [ ] Postgres schema: `events`, `devices`, `branches`, `orgs`, `memberships`
- [ ] `POST /sync/push` with per-event results, `ON CONFLICT (id) DO NOTHING`
- [ ] `GET /sync/pull?since=&limit=` using `server_seq`
- [ ] Device registration and token auth
- [ ] Org scoping + RLS isolation test (org A cannot read org B)

**Client**

- [ ] Sync client: batching, exponential backoff with jitter, resumable cursor
- [ ] Pending count and sync status indicator in the UI
- [ ] Apply remote events through the same projection path as local ones
- [ ] Held-void handling (void arrives before its sale)
- [ ] Clock-drift warning in the UI

**Verification**

- [ ] `packages/sim`: N devices, seeded RNG, random offline periods, reordering and duplication
- [ ] Convergence assertion: identical projections on all devices
- [ ] Run 1,000+ seeds in CI; commit failing seeds as fixtures
- [ ] Two-tills-last-unit scenario raises a reconciliation flag

**Done when:** the simulator passes thousands of seeds and two real phones converge after one has been offline for a day.

## Phase 3: Retail depth (weeks 5-6)

- [ ] Customers: profile, credit limit, running balance
- [ ] `PAYMENT_RECEIVED` and customer statement
- [ ] Reconciliation inbox for negative stock and flagged events
- [ ] End-of-day cash-up (`DAY_CLOSED`: expected vs counted cash)
- [ ] Low-stock thresholds and alerts
- [ ] Suppliers and purchase orders
- [ ] Reports: sales by day/product/cashier, margin, stock valuation, aged credit
- [ ] CSV export for every report

**Done when:** a shop owner can run a full trading day, close it, and trust the report totals against a manual count.

## Phase 4: Multi-branch and roles (weeks 7+)

- [ ] Branches, device-to-branch assignment
- [ ] Roles: owner, manager, cashier; enforce on client and server
- [ ] Stock transfers (`SENT` / `RECEIVED` handshake, in-transit stock)
- [ ] Audit report: voids, adjustments, price changes by user
- [ ] Owner dashboard across branches
- [ ] Snapshot and compaction for long-lived logs
- [ ] SQLite-WASM (OPFS) adapter behind `EventStore`, behind a worker

**Done when:** two branches trade independently offline, transfer stock, and the owner sees consolidated numbers.

## Later

- [ ] Paystack and POS-terminal reconciliation
- [ ] WhatsApp receipts
- [ ] Supplier price history and reorder suggestions
- [ ] Loyalty and discounts
- [ ] Accounting exports
- [ ] Billing: seats and branches

## Open questions

- [x] Final product name: Ndekọ (working name)
- [ ] First pilot shop (real user for Phase 1 feedback)
- [ ] Receipt printing: browser print vs Bluetooth thermal printer support
- [ ] Hosting target for the sync API
- [ ] Pricing model (per branch, per seat, or flat)
