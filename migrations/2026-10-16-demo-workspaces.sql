BEGIN;
SELECT pg_advisory_xact_lock(716724, 1);
CREATE TABLE IF NOT EXISTS public.merhav_demo_workspaces (
  workspace_id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object')
);
COMMIT;
