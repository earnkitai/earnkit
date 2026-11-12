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
-- v6.1.17 Task 3 (L30-9): when the current run of failures began (null while the links load); stale at 20 hours of
-- failing, never by counting UTC dates.
ALTER TABLE program_health ADD COLUMN IF NOT EXISTS first_failed_at timestamptz;
-- v6.1.18 (L39-5): the submission page answered but its text says it is closed; the owner's digest lists it.
ALTER TABLE program_health ADD COLUMN IF NOT EXISTS submit_closed boolean NOT NULL DEFAULT false;
-- v6.1.17 Task 3 (L30-14): one row, the last daily run that finished (answered 200); /api/stats shows it and the
-- owner's digest names a gap over 26 hours.
CREATE TABLE IF NOT EXISTS cron_state (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_run_at timestamptz NOT NULL
);
-- Fix round 1 (M2): the gap belongs to the UTC day. When a run crosses into a new day, `prev_run_at` keeps the last
-- run before it and `day_first_at` this day's first run, so a second run that day measures the same gap.
ALTER TABLE cron_state ADD COLUMN IF NOT EXISTS prev_run_at timestamptz, ADD COLUMN IF NOT EXISTS day_first_at timestamptz;

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
-- v6.1.16 (Task 9, L23-1): the programs a find's standing-approval line named and when, so the next find a day later
-- says which were not sent. L23-16: the hash of the last project find's program ids and when, for "Nothing new since".
ALTER TABLE installations ADD COLUMN IF NOT EXISTS promised jsonb, ADD COLUMN IF NOT EXISTS promised_at timestamptz, ADD COLUMN IF NOT EXISTS last_list_hash text, ADD COLUMN IF NOT EXISTS last_list_at timestamptz;
-- v6.1.16 (Task 9, L23-4): the day each installation last showed a program's results question (at most once a day each).
CREATE TABLE IF NOT EXISTS outcome_asks (installation_id bigint NOT NULL, owner text NOT NULL, program_id text NOT NULL, asked_on date NOT NULL, PRIMARY KEY (installation_id, program_id));
-- v6.1.18 Task 4 (L18-4, L36-1): which installation asked whether a builder-sent form went out, and on which day; asked
-- again after SENT_ASK_EVERY_DAYS.
CREATE TABLE IF NOT EXISTS sent_asks (installation_id bigint NOT NULL, owner text NOT NULL, program_id text NOT NULL, asked_on date NOT NULL, PRIMARY KEY (installation_id, program_id));
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
-- v6.1.19 L43-4: what the builder typed into a /me form that was refused, kept 15 minutes so the page shows it again.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS draft jsonb, ADD COLUMN IF NOT EXISTS draft_at timestamptz;

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
-- v6.1.16 Task 14 (L28-4): an application is keyed by (owner, program, project key), no longer (owner, program). The
-- project column comes first so a fresh database and one with the old index both dedupe and index the same way: only
-- true repeats of one project are merged, and the old index (one row per owner and program) is dropped for good.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS project_id text;
DELETE FROM applications a USING applications b
WHERE a.owner = b.owner AND a.program_id = b.program_id AND COALESCE(a.project_id, '') = COALESCE(b.project_id, '')
  AND (a.at < b.at OR (a.at = b.at AND a.ctid < b.ctid));
DROP INDEX IF EXISTS applications_owner_program;
CREATE UNIQUE INDEX IF NOT EXISTS applications_owner_program_project ON applications (owner, program_id, (COALESCE(project_id, '')));
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
-- v6.1.16 (L22-1 to L22-3): a win's money by currency ({"USD": 3500.5, "EUR": 2000}), cents kept, never converted;
-- amount_usd keeps the US dollar part for the readers that sum dollars (stats, the cap). Backfilled from amount_usd.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS amounts jsonb;
UPDATE applications SET amounts = jsonb_build_object('USD', amount_usd) WHERE amounts IS NULL AND amount_usd IS NOT NULL;
ALTER TABLE application_history ADD COLUMN IF NOT EXISTS amount numeric, ADD COLUMN IF NOT EXISTS currency text;
-- v6.1.16 (L22-3): a screen outcome's money by currency, in place of the single amount_given/currency pair (kept
-- readable for one release, dropped in v6.1.17).
ALTER TABLE screen_outcomes ADD COLUMN IF NOT EXISTS amounts jsonb;
-- v6.1.16 Task 11 (L24-2): the kind of the last Say this installation's find offered (apply, look_again, draft, rule,
-- do, stop), so "Your yes stands" is said only after an apply offer.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS last_offer text, ADD COLUMN IF NOT EXISTS last_offer_at timestamptz;
-- v6.1.16 Task 11 (L24-4): a builder's hold on a started claim; the agent must not send while it is set.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS held_at timestamptz;
-- v6.1.16 Task 15 (L29-15): the last project find's program ids by the number the builder sees, so track takes "3".
ALTER TABLE installations ADD COLUMN IF NOT EXISTS last_list jsonb;
-- v6.1.16 Task 15 (L29-11): what the next send needs from the builder (at most two), from the last linked project find.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS next_needs jsonb;
-- v6.1.16 Task 12 (L26-10): the lookups that grow with installations and applications use an index: a builder's agents
-- (/me, deleteBuilder, an outcome's own-application check) and a program's applications; a program's screens (Task 4).
CREATE INDEX IF NOT EXISTS installations_builder ON installations (builder_id) WHERE builder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS applications_program ON applications (program_id);
CREATE INDEX IF NOT EXISTS screen_jobs_program ON screen_jobs (program_id);
-- v6.1.16 Task 14 (L28-1, L28-6): an application's repo (the canonical repo key, `canonicalRepoLink`) and GitHub's repo
-- id, so one application exists per repo key per program across builders and a renamed repo keeps its application.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS repo_key text, ADD COLUMN IF NOT EXISTS repo_id bigint;
CREATE INDEX IF NOT EXISTS applications_program_repo ON applications (program_id, repo_key) WHERE repo_key IS NOT NULL;
-- A row keyed by a record project id ('mono-web', before v6.1.16) is keyed by that project's repo key when it has one
-- (record repo links are github.com links, so lower case without a trailing slash or .git is canonicalRepoLink's form).
UPDATE applications a SET project_id = k.key
FROM (
  -- Fix round 1 (N2): one row per owner, program and key (the newest), so two record ids on one repo never collide.
  SELECT DISTINCT ON (a2.owner, a2.program_id, lower(regexp_replace(regexp_replace(p->>'repo_url', '/+$', ''), '(\.git)+$', '', 'i')))
    a2.ctid AS row_id, lower(regexp_replace(regexp_replace(p->>'repo_url', '/+$', ''), '(\.git)+$', '', 'i')) AS key
  FROM applications a2 JOIN builders b ON a2.owner = 'b:' || b.id, jsonb_array_elements(COALESCE(b.record->'projects', '[]'::jsonb)) p
  WHERE a2.project_id IS NOT NULL AND a2.project_id NOT LIKE 'https://%' AND a2.project_id NOT LIKE 'name:%'
    AND p->>'id' = a2.project_id AND COALESCE(p->>'repo_url', '') LIKE 'https://github.com/%'
  ORDER BY a2.owner, a2.program_id, lower(regexp_replace(regexp_replace(p->>'repo_url', '/+$', ''), '(\.git)+$', '', 'i')), a2.at DESC
) k
WHERE a.ctid = k.row_id AND NOT EXISTS (
  SELECT 1 FROM applications c WHERE c.owner = a.owner AND c.program_id = a.program_id AND COALESCE(c.project_id, '') = k.key);
-- The backfill: a row keyed by a repo link (projectKeyOf writes it canonical) carries it as its repo key.
UPDATE applications SET repo_key = project_id WHERE repo_key IS NULL AND project_id LIKE 'https://%';
-- v6.1.16 Task 14 (L28-3, L28-1): a builder-submitted send kept under the project's name only names the repo it was
-- kept off (not theirs, or another account's application), so a screen row for that repo never reaches it.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS off_repo text;
-- v6.1.16 Task 14 (L28-10): the builder an installation was unlinked from, so its later calls still see what that
-- builder sent (read only) and never send it twice. Cleared when it links again.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS former_builder_id int;
-- v6.1.16 Task 14 fix round 1 (FR-5): a history row names its application's project key, so two projects of one builder
-- on one program never share a further payment's key or the /me paid-more flag. Backfilled where the owner holds one
-- application for the program (the only one it can be); a rerun changes nothing.
ALTER TABLE application_history ADD COLUMN IF NOT EXISTS project_id text;
UPDATE application_history h SET project_id = a.project_id
FROM applications a
WHERE h.project_id IS NULL AND a.project_id IS NOT NULL AND a.owner = h.owner AND a.program_id = h.program_id
  AND NOT EXISTS (SELECT 1 FROM applications b WHERE b.owner = a.owner AND b.program_id = a.program_id AND b.ctid <> a.ctid);
-- v6.1.16.1 Task 2 (L35-2): an application's project identity: GitHub's repo id when known ('gh:{id}'), else the repo
-- key, else the folded name key; one row per owner, program and identity. Backfilled from repo_id, repo_key, else
-- project_id. Of two rows of one owner and program that would share an identity, only the one that went furthest
-- (a result, then a send, then the earliest) takes it; the other keeps NULL. A rerun changes nothing. The old
-- (owner, program, project key) index stays for one release.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS identity text;
UPDATE applications a SET identity = k.identity
FROM (
  SELECT ctid AS row_id, owner, program_id, COALESCE('gh:' || repo_id::text, repo_key, project_id) AS identity,
    row_number() OVER (PARTITION BY owner, program_id, COALESCE('gh:' || repo_id::text, repo_key, project_id)
      ORDER BY (CASE status WHEN 'won' THEN 5 WHEN 'rejected' THEN 4 WHEN 'no_result' THEN 3 WHEN 'applied' THEN 2 ELSE 1 END) DESC, at) AS n
  FROM applications WHERE identity IS NULL AND COALESCE('gh:' || repo_id::text, repo_key, project_id) IS NOT NULL
) k
WHERE a.ctid = k.row_id AND k.n = 1
  AND NOT EXISTS (SELECT 1 FROM applications c WHERE c.owner = a.owner AND c.program_id = a.program_id AND c.identity = k.identity);
CREATE UNIQUE INDEX IF NOT EXISTS applications_owner_program_identity ON applications (owner, program_id, identity) WHERE identity IS NOT NULL;
-- v6.1.16.1 Task 2 (L35-5): a client ID metadata document read good, so a fresh process or another instance serves it
-- without a fetch (the in-process cache stays the fast path).
CREATE TABLE IF NOT EXISTS cimd_documents (url text PRIMARY KEY, document jsonb NOT NULL, fetched_at timestamptz NOT NULL);
