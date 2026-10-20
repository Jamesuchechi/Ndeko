-- Ndekọ Sync Service Schema
-- PostgreSQL DDL for events, devices, branches, orgs, memberships.
-- See ARCHITECTURE.md sections 7 and 12.

CREATE TABLE IF NOT EXISTS orgs (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id VARCHAR(36) PRIMARY KEY,
  org_id VARCHAR(36) NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code VARCHAR(16) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_branches_org_code UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS memberships (
  id VARCHAR(36) PRIMARY KEY,
  org_id VARCHAR(36) NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_memberships_org_user UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(36) PRIMARY KEY,
  org_id VARCHAR(36) NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  branch_id VARCHAR(36) NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  code VARCHAR(16) NOT NULL,
  device_token VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  CONSTRAINT uq_devices_org_code UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(36) PRIMARY KEY,
  server_seq BIGSERIAL NOT NULL,
  org_id VARCHAR(36) NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  branch_id VARCHAR(36) REFERENCES branches(id) ON DELETE SET NULL,
  device_id VARCHAR(36) NOT NULL,
  type VARCHAR(64) NOT NULL,
  hlc VARCHAR(64) NOT NULL,
  schema_v INTEGER NOT NULL,
  payload JSONB NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core sync indexes:
-- 1. Gap-free paging cursor for pull: (org_id, server_seq)
CREATE INDEX IF NOT EXISTS idx_events_org_server_seq ON events (org_id, server_seq);

-- 2. Logical ordering / deduplication & inspection by HLC: (org_id, hlc)
CREATE INDEX IF NOT EXISTS idx_events_org_hlc ON events (org_id, hlc);

-- 3. Device lookup by token
CREATE INDEX IF NOT EXISTS idx_devices_token ON devices (device_token);

-- Row-Level Security (RLS) setup (opt-in per environment)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- If current_setting('app.current_org_id', true) is set, isolate to that org:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'events_org_isolation'
  ) THEN
    CREATE POLICY events_org_isolation ON events
      USING (org_id = NULLIF(current_setting('app.current_org_id', true), ''))
      WITH CHECK (org_id = NULLIF(current_setting('app.current_org_id', true), ''));
  END IF;
END $$;
