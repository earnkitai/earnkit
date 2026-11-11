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
-- The source page's normalized text (up to 64 KB): a change is under 80% of its words shared.
ALTER TABLE program_health ADD COLUMN IF NOT EXISTS body_text text;

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
-- The last find's gaps: program_id to the first gap's what; track started reads it.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS last_gaps jsonb;
-- The find before the last one: an agent's send under standing approval puts last_find_at back to it, so the night
-- routine's own find never takes the overnight report from the builder (v6.1.9).
ALTER TABLE installations ADD COLUMN IF NOT EXISTS prev_find_at timestamptz;
-- v6.1.16 (Task 5, L19-5): the resource the token was issued for (EARNKIT_URL + /mcp; NULL before v6.1.16, accepted),
-- and when a reused authorization code revoked it (L19-4; /mcp refuses a revoked installation).
ALTER TABLE installations ADD COLUMN IF NOT EXISTS audience text;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
-- v6.1.16 (Task 5, L19-8): registered OAuth clients; the client_id is 128 random bits, never derived from metadata.
-- Task 16: `used_at` is its first code exchange; the daily run sweeps one registered over 30 days ago that never exchanged one.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     text PRIMARY KEY,
  redirect_uris text[] NOT NULL,
  client_name   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE oauth_clients ADD COLUMN IF NOT EXISTS used_at timestamptz;
-- v6.1.16 (Task 5, L19-4): each exchanged authorization code (its nonce) and the token it gave; a second exchange
-- revokes that token. The daily cron sweeps rows over a day old (codes live 5 minutes).
CREATE TABLE IF NOT EXISTS oauth_codes_spent (
  nonce      text PRIMARY KEY,
  token_hash text NOT NULL,
  at         timestamptz NOT NULL
);

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

-- v6.1: a builder is a GitHub account; installations link to one through a one-time code, and a
-- browser session (its token's hash) signs them in to /me.
CREATE TABLE IF NOT EXISTS builders (
  id                serial PRIMARY KEY,
  github_id         bigint NOT NULL UNIQUE,
  login             text NOT NULL,
  name              text,
  avatar_url        text,
  record            jsonb NOT NULL DEFAULT '{}',
  record_updated_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE installations ADD COLUMN IF NOT EXISTS builder_id int;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS linked_at timestamptz;
-- v6.1.7 B10: set when the builder unlinks it on /me; the next find says so once and clears it.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS unlinked_at timestamptz;
-- v6.1.8 C51: why it was unlinked: 'unlinked' on /me, 'deleted' with the account; cleared with unlinked_at.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS unlinked_reason text;
CREATE TABLE IF NOT EXISTS link_codes (
  code            text PRIMARY KEY,
  installation_id int NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);
CREATE INDEX IF NOT EXISTS link_codes_installation ON link_codes (installation_id);
-- The live code is recomputed from its nonce (with EARNKIT_AUTH_SECRET), so a link shown once keeps working.
ALTER TABLE link_codes ADD COLUMN IF NOT EXISTS nonce text;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   text PRIMARY KEY,
  builder_id   int NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- The ledger's owner: 'b:<builder>' once linked, else 'i:<installation>'. installation_id stays the
-- writing installation. Duplicates per owner are merged (the newest kept) before the unique indexes.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS owner text;
ALTER TABLE application_history ADD COLUMN IF NOT EXISTS owner text;
ALTER TABLE gaps_done ADD COLUMN IF NOT EXISTS owner text;
UPDATE applications SET owner = 'i:' || installation_id WHERE owner IS NULL;
UPDATE application_history SET owner = 'i:' || installation_id WHERE owner IS NULL;
UPDATE gaps_done SET owner = 'i:' || installation_id WHERE owner IS NULL;
DO $$
DECLARE t text; has_null boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['applications', 'application_history', 'gaps_done'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE owner IS NULL)', t) INTO has_null;
    IF NOT has_null THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN owner SET NOT NULL', t);
    END IF;
  END LOOP;
END $$;
DELETE FROM applications a USING applications b
WHERE a.owner = b.owner AND a.program_id = b.program_id AND (a.at < b.at OR (a.at = b.at AND a.ctid < b.ctid));
CREATE UNIQUE INDEX IF NOT EXISTS applications_owner_program ON applications (owner, program_id);
CREATE INDEX IF NOT EXISTS application_history_owner ON application_history (owner, program_id, at DESC);
-- v6.1.10 (L1c-1): a done step belongs to one project, keyed by projectKeyOf (repo link, else name:, else ''). Rows from
-- before stay at '' (the old global step). The project's index replaces the owner's, so a rerun merges only true repeats.
ALTER TABLE gaps_done ADD COLUMN IF NOT EXISTS project_key text NOT NULL DEFAULT '';
DELETE FROM gaps_done a USING gaps_done b
WHERE a.owner = b.owner AND a.project_key = b.project_key AND a.program_id = b.program_id AND a.item = b.item
  AND (a.at < b.at OR (a.at = b.at AND a.ctid < b.ctid));
CREATE UNIQUE INDEX IF NOT EXISTS gaps_done_owner_project_item ON gaps_done (owner, project_key, program_id, item);
DROP INDEX IF EXISTS gaps_done_owner_item;
-- The owner indexes replace the per-installation keys (an installation's stray i: row and its b: row may share a program).
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_pkey;
ALTER TABLE gaps_done DROP CONSTRAINT IF EXISTS gaps_done_pkey;
-- The last find's project, so a track without one keeps its steps with it.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS last_project_key text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS submitted_by text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS fields_used text[];
ALTER TABLE applications ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS claimed_by int;
-- Sent under the builder's standing approval (policy.auto_apply on when it was tracked).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS auto_applied boolean NOT NULL DEFAULT false;
-- The program's title when it was sent, so a result still reads once the program leaves the catalog (v6.1.7).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS title text;
-- When the application was sent: set on applied, never rewritten by a result; the nightly limit counts it (v6.1.9).
ALTER TABLE applications ADD COLUMN IF NOT EXISTS sent_at timestamptz;
-- Auto rows from before v6.1.9: the send's own time, from the history's last applied row, else `at` while still applied.
UPDATE applications a SET sent_at = COALESCE(
  (SELECT max(h.at) FROM application_history h WHERE h.owner = a.owner AND h.program_id = a.program_id AND h.status = 'applied'),
  CASE WHEN a.status = 'applied' THEN a.at END)
WHERE a.sent_at IS NULL AND a.auto_applied;

-- The owner's daily digest: the day it covered and when it was sent; the next digest starts there.
CREATE TABLE IF NOT EXISTS owner_digests (
  day     text PRIMARY KEY,
  sent_at timestamptz NOT NULL
);
-- v6.1.16 (Task 16): the hash of the last body sent that day, so the same body is never mailed twice and a changed one
-- goes under a new idempotency key.
ALTER TABLE owner_digests ADD COLUMN IF NOT EXISTS body_hash text;

-- v6 evidence read once per repo (code, team, depth with its pushed_at) and per contract (onchain rows);
-- used for 7 days, a repo only while pushed_at is unchanged. Partial reads are never stored.
CREATE TABLE IF NOT EXISTS evidence_cache (
  key       text PRIMARY KEY,                        -- "repo:<owner/name>" or "contract:<chain>:<address>"
  kind      text NOT NULL,                           -- repo | contract
  rows      jsonb NOT NULL,
  pushed_at text,
  read_at   timestamptz NOT NULL
);

-- v6.1 screen: the builders the owner marked as a program's reviewers, their jobs, each applicant's
-- placement and public rows, and the program's outcomes. No pitch is stored: it is compared at job
-- creation and dropped. `deployers` holds the contracts' deployer addresses for the counts across programs.
CREATE TABLE IF NOT EXISTS program_reviewers (
  program_id text NOT NULL,
  builder_id int NOT NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  contact    text,
  PRIMARY KEY (program_id, builder_id)
);
CREATE TABLE IF NOT EXISTS screen_jobs (
  id              text PRIMARY KEY,
  program_id      text NOT NULL,
  builder_id      int NOT NULL,
  installation_id int NOT NULL,
  created_at      timestamptz NOT NULL,
  thresholds      jsonb,
  total           int NOT NULL,
  done            int NOT NULL DEFAULT 0,
  finished_at     timestamptz,
  expires_at      timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS screen_applicants (
  job_id              text NOT NULL,
  ref                 text NOT NULL,
  name                text NOT NULL,
  repo_key            text,
  repo_url            text,
  live_url            text,
  contracts           jsonb NOT NULL DEFAULT '[]',
  applied_at          timestamptz,
  identical_pitch     int NOT NULL DEFAULT 0,
  shared_contributors int NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'queued',
  tier                text,
  flags               jsonb,
  because             jsonb,
  line                text,
  rows                jsonb,
  deployers           text[] NOT NULL DEFAULT '{}',
  read_at             timestamptz,
  error               text,
  PRIMARY KEY (job_id, ref)
);
-- A worker takes an applicant ('reading', taken_at) before reading it; one taken over 30 minutes ago is free again.
ALTER TABLE screen_applicants ADD COLUMN IF NOT EXISTS taken_at timestamptz;
-- Reads worth a retry (a timeout, a rate limit) go back to the queue; the third is final.
ALTER TABLE screen_applicants ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS screen_jobs_created ON screen_jobs (created_at);
-- v6.1.16 (Task 16): what the last run that reached the job read of it, and how many of its rows that run left for
-- the next when it stopped at its deadline (the results reply then says "{n} of {m} read today; the rest tomorrow.").
ALTER TABLE screen_jobs ADD COLUMN IF NOT EXISTS last_run_read int NOT NULL DEFAULT 0;
ALTER TABLE screen_jobs ADD COLUMN IF NOT EXISTS last_run_left int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS screen_applicants_repo ON screen_applicants (repo_key, read_at);
CREATE INDEX IF NOT EXISTS screen_applicants_status ON screen_applicants (status, job_id);
CREATE INDEX IF NOT EXISTS screen_applicants_deployers ON screen_applicants USING gin (deployers);
CREATE TABLE IF NOT EXISTS screen_outcomes (
  job_id     text NOT NULL,
  ref        text NOT NULL,
  outcome    text NOT NULL,
  amount_usd numeric,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, ref)
);
-- v6.1.14 (L13-1): the application's own id, given to the builder's agent when it tracked the send. A screen outcome
-- reaches a ledger only through it (never by repo): the applicant row carries it, the outcome goes to that row's owner.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS application_id text;
CREATE UNIQUE INDEX IF NOT EXISTS applications_application_id ON applications (application_id) WHERE application_id IS NOT NULL;
ALTER TABLE screen_applicants ADD COLUMN IF NOT EXISTS application_id text;
-- v6.1.14 (Task 8, the round 3 security follow-up): a requeued row names the exact earlier row it supersedes, a row of
-- a screen of the same program carrying the same application id (checked when queued). The blind flag is gone.
ALTER TABLE screen_applicants ADD COLUMN IF NOT EXISTS requeue_job_id text;
ALTER TABLE screen_applicants ADD COLUMN IF NOT EXISTS requeue_ref text;
-- v6.1.14 (L15-18): a program's screens and outcomes belong to the program; a reviewer's delete leaves them, unowned.
ALTER TABLE screen_jobs ALTER COLUMN builder_id DROP NOT NULL;
-- v6.1.14 (T8-F1): a further payment of a win carries its caller's key, kept once per application (a repeat is a no-op).
ALTER TABLE application_history ADD COLUMN IF NOT EXISTS payment_key text;
CREATE INDEX IF NOT EXISTS application_history_payment ON application_history (owner, program_id, payment_key) WHERE payment_key IS NOT NULL;
-- v6.1.16 (L16-1, L16-2): a won or rejected over a different result replaces it as a correction; its history row says so.
ALTER TABLE application_history ADD COLUMN IF NOT EXISTS corrected boolean NOT NULL DEFAULT false;
-- v6.1.16 (L17-2): who wrote the history row, 'screen' (a program's outcome) or 'builder' (an agent's track); NULL before.
ALTER TABLE application_history ADD COLUMN IF NOT EXISTS source text;
-- T8-F2: a stable order for paging a screen's results (the order the rows were queued in).
ALTER TABLE screen_applicants ADD COLUMN IF NOT EXISTS seq bigserial;
-- T8-F1: the further-payment keys a screen outcome has added, so a retried one adds nothing.
ALTER TABLE screen_outcomes ADD COLUMN IF NOT EXISTS payment_keys text[] NOT NULL DEFAULT '{}';
-- v6.1.14 (L15-15): a win's amount as the program gave it (cents, another currency) beside the whole US dollars kept in
-- amount_usd (rounded down; NULL for another currency, which is never converted).
ALTER TABLE screen_outcomes ADD COLUMN IF NOT EXISTS amount_given numeric;
ALTER TABLE screen_outcomes ADD COLUMN IF NOT EXISTS currency text;
-- v6.1.13 (Task 1 review I1): the project as the agent reported it at its last find, per owner and project key
-- (projectKeyOf), so a send under standing approval is never judged on less than the find was.
CREATE TABLE IF NOT EXISTS project_reports (
  owner       text NOT NULL,
  project_key text NOT NULL,
  report      jsonb NOT NULL,
  at          timestamptz NOT NULL,
  PRIMARY KEY (owner, project_key)
);
-- v6.1.14 (L13-7): whether standing approval was on at this installation's last find with a project, so an agent's
-- send after the builder turned it off says so.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS last_find_auto boolean;
