-- Guarantee AT MOST ONE in-flight execution per buyback config.
--
-- The workers/routes pre-check for an in-flight execution before inserting, but
-- that check-then-insert has a race window: two concurrent /check calls (or a
-- scan racing a manual check) could both pass the check and create two
-- executions for the same config, which would then swap/burn the same wallet in
-- parallel. This adds a DB-level backstop.
--
-- A partial UNIQUE index (only over the in-flight statuses) permits any number
-- of COMPLETED/FAILED rows but at most one active row per config. The insert
-- sites catch the resulting unique violation (P2002) and treat it as
-- "already in flight".
--
-- Step 1 first resolves any PRE-EXISTING duplicate in-flight rows (keeping the
-- most recent per config, failing the older ones) so CREATE UNIQUE INDEX cannot
-- fail on legacy data and block the deploy.

-- ---- buyback_executions (per-agent flow) ----
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY buyback_config_id
    ORDER BY started_at DESC
  ) AS rn
  FROM buyback_executions
  WHERE status IN ('QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING')
)
UPDATE buyback_executions e
SET status = 'FAILED',
    last_error = 'superseded_duplicate_inflight',
    completed_at = NOW()
FROM ranked
WHERE e.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "buyback_executions_one_inflight"
  ON "buyback_executions" ("buyback_config_id")
  WHERE status IN ('QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING');

-- ---- shared_split_executions (shared-split flow) ----
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY config_id
    ORDER BY started_at DESC
  ) AS rn
  FROM shared_split_executions
  WHERE status IN ('QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING')
)
UPDATE shared_split_executions e
SET status = 'FAILED',
    last_error = 'superseded_duplicate_inflight',
    completed_at = NOW()
FROM ranked
WHERE e.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "shared_split_executions_one_inflight"
  ON "shared_split_executions" ("config_id")
  WHERE status IN ('QUEUED', 'WITHDRAWING', 'SWAPPING', 'BURNING', 'RETRYING');
