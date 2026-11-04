-- EarnKit schema. Idempotent: runs before every deploy (`pnpm predeploy`) and twice in tests.
-- Additive only: tables from earlier versions stay in production untouched and unread.

-- Programs. `file` is the whole record (lib/v5/program-file.ts); the other columns mirror it for queries.
CREATE TABLE IF NOT EXISTS programs (
  id            text PRIMARY KEY,                    -- slug, e.g. "arc-microgrants"
  file          jsonb,
  source        text NOT NULL DEFAULT 'file',        -- 'file' | 'api'
  category      text,                                -- grant | hackathon | investment | bounty
  status        text NOT NULL CHECK (status IN ('active', 'upcoming', 'closed')),
  ends_at       timestamptz,                         -- NULL = rolling
  max_award_usd numeric,
  verified_at   date,                                -- facts last checked against the source
  stale_since   timestamptz,                         -- set by the freshness probe
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE programs ADD COLUMN IF NOT EXISTS file jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'file';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS ends_at timestamptz;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS max_award_usd numeric;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS verified_at date;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS stale_since timestamptz;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE programs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- An existing table carries older columns, some NOT NULL; new rows write only the columns above.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'programs' AND is_nullable = 'NO'
      AND column_name NOT IN ('id', 'source', 'status', 'created_at', 'updated_at')
  LOOP
    EXECUTE format('ALTER TABLE programs ALTER COLUMN %I DROP NOT NULL', c);
  END LOOP;
END $$;

-- Statuses outside the three are closed; then rows without a record get one from their own columns
-- (nulls dropped, the dates kept in UTC; an older `form` shape is left out). A row that still does not parse is skipped by readers.
UPDATE programs SET status = 'closed' WHERE status NOT IN ('active', 'upcoming', 'closed');
UPDATE programs SET file =
  jsonb_strip_nulls(
    to_jsonb(programs) - ARRAY['file', 'source', 'created_at', 'updated_at', 'stale_since', 'opened_at', 'match_floor', 'match_precision', 'form']
  ) || jsonb_build_object(
    'starts_at', to_char((to_jsonb(programs) ->> 'starts_at')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ends_at', to_char((to_jsonb(programs) ->> 'ends_at')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE file IS NULL;
ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_status_check;
ALTER TABLE programs ADD CONSTRAINT programs_status_check CHECK (status IN ('active', 'upcoming', 'closed'));

-- One row per update that changed a field builders act on (lib/v5/programs.ts CHANGE_FIELDS).
CREATE TABLE IF NOT EXISTS program_changes (
  id         serial PRIMARY KEY,
  program_id text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  fields     text[] NOT NULL
);
CREATE INDEX IF NOT EXISTS program_changes_program ON program_changes (program_id, at DESC);

-- Every programs write API call, for the owner's audit: the action, the result and why. body is the
-- program as sent, never a secret.
CREATE TABLE IF NOT EXISTS program_writes (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  program_id text,
  action     text,
  result     text,
  reason     text,
  body       jsonb
);
CREATE INDEX IF NOT EXISTS program_writes_at ON program_writes (at DESC);

-- The daily freshness probe: each program's last check, and the days in a row it failed.
CREATE TABLE IF NOT EXISTS program_health (
  program_id text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  source_ok  boolean NOT NULL,
  submit_ok  boolean NOT NULL,
  body_hash  text,
  changed_at timestamptz,
  fail_days  int NOT NULL DEFAULT 0
);

-- One row per installed agent (its bearer token's hash).
CREATE TABLE IF NOT EXISTS installations (
  id           serial PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  client_key   text,
  client_name  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_find_at timestamptz
);
ALTER TABLE installations ADD COLUMN IF NOT EXISTS client_key text;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS last_find_at timestamptz;

-- Fixed-window request counters. Old windows are deleted as new ones start.
CREATE TABLE IF NOT EXISTS rate_windows (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- Public repo facts, kept 7 days.
CREATE TABLE IF NOT EXISTS repo_cache (
  repo       text PRIMARY KEY,                       -- "owner/name"
  facts      jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE repo_cache ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- The builder's ledger: where each application stands, and every change to it.
CREATE TABLE IF NOT EXISTS applications (
  installation_id int NOT NULL,
  program_id      text NOT NULL,
  status          text NOT NULL,
  amount_usd      numeric,
  note            text,
  at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, program_id)
);
ALTER TABLE applications ADD COLUMN IF NOT EXISTS asked_outcome_at timestamptz;
CREATE TABLE IF NOT EXISTS application_history (
  id              serial PRIMARY KEY,
  installation_id int NOT NULL,
  program_id      text NOT NULL,
  status          text NOT NULL,
  amount_usd      numeric,
  note            text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_history_by ON application_history (installation_id, program_id, at DESC);

-- Gap items the builder has closed for a program.
CREATE TABLE IF NOT EXISTS gaps_done (
  installation_id int NOT NULL,
  program_id      text NOT NULL,
  item            text NOT NULL,
  at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, program_id, item)
);
