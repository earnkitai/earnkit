-- EarnKit schema. Idempotent: runs before every deploy (`pnpm predeploy`).

CREATE TABLE IF NOT EXISTS programs (
  id                      text PRIMARY KEY,           -- slug, e.g. "arc-microgrants"
  organizer               text NOT NULL,
  title                   text NOT NULL,
  description             text NOT NULL,
  source_url              text NOT NULL,
  submission_url          text NOT NULL,
  reward                  text NOT NULL,
  summary                 text NOT NULL,              -- short reward + deadline line builders see
  tag                     text,                       -- "long shot" | "needs a live product"
  starts_at               timestamptz,
  ends_at                 timestamptz,                -- NULL = rolling
  status                  text NOT NULL CHECK (status IN ('active', 'closed')),
  existing_work           text NOT NULL CHECK (existing_work IN ('allowed', 'new_work_only', 'unknown')),
  chains                  text[] NOT NULL DEFAULT '{}',
  setup                   text[] NOT NULL DEFAULT '{}', -- one-time builder-only steps
  each_time               text[] NOT NULL DEFAULT '{}', -- builder-only steps for every entry
  rules                   text[] NOT NULL DEFAULT '{}',
  submission_requirements jsonb NOT NULL DEFAULT '[]',
  campaign                jsonb,                       -- EarnKit's own campaigns only (prize, winners, metric)
  created_at              timestamptz NOT NULL DEFAULT now() -- when EarnKit added it ("new" alerts)
);

CREATE TABLE IF NOT EXISTS tracks (
  id           text PRIMARY KEY,                      -- "<program_id>/<track slug>"
  program_id   text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL,
  requirements text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS starters (
  id            serial PRIMARY KEY,
  program_id    text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  track_id      text REFERENCES tracks(id) ON DELETE CASCADE,
  title         text NOT NULL,
  what_to_build text NOT NULL,
  requirements  text[] NOT NULL DEFAULT '{}',
  build_context jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS installations (
  id           serial PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  programs_checked_at timestamptz                   -- last list_programs, for "since you last checked"
);

CREATE TABLE IF NOT EXISTS projects (
  id           serial PRIMARY KEY,
  program_id   text NOT NULL REFERENCES programs(id),
  name         text NOT NULL,
  description  text,
  repo_url     text,
  live_url     text,
  demo_url     text,
  token_url    text,                                 -- tokens.fun page once a token is launched
  installation_id integer REFERENCES installations(id), -- the agent that recorded it
  -- EarnKit campaigns only:
  payout_wallet text,                                   -- where the prize goes
  contracts    text[],                                  -- Base contracts that are scored
  score        integer,                                 -- latest metric value
  scored_at    timestamptz,
  prize_tx     text,                                    -- payout transaction once paid
  prize_paid_at timestamptz,
  token_image  bytea,                                   -- image uploaded for launch_token
  token_image_type text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id                      serial PRIMARY KEY,
  project_id              integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  submission_data         jsonb NOT NULL,
  external_submission_url text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Upgrades for the database created before 2026-09-28 (no-ops on a fresh one).
ALTER TABLE programs ALTER COLUMN ends_at DROP NOT NULL;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS tag text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS existing_work text NOT NULL DEFAULT 'unknown';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS chains text[] NOT NULL DEFAULT '{}';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS setup text[] NOT NULL DEFAULT '{}';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS each_time text[] NOT NULL DEFAULT '{}';
ALTER TABLE programs DROP COLUMN IF EXISTS key_requirement;
ALTER TABLE programs DROP COLUMN IF EXISTS builder_steps;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE installations ADD COLUMN IF NOT EXISTS programs_checked_at timestamptz;
-- v1.5 memory: the builder's GitHub (so later checks don't need it) and programs being prepared.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS github_user text;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS repos text[];
ALTER TABLE installations ADD COLUMN IF NOT EXISTS local_repos jsonb;  -- private/local repos as the agent reported them
ALTER TABLE installations ADD COLUMN IF NOT EXISTS working_on text[] NOT NULL DEFAULT '{}';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS verified_at date;   -- facts last checked against source_url
ALTER TABLE programs ADD COLUMN IF NOT EXISTS campaign jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS payout_wallet text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contracts text[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS score integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scored_at timestamptz;
-- v2.2 §5: true when the score read hit the 500-page cap (the oldest traffic in the window wasn't read).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS score_partial boolean NOT NULL DEFAULT false;
-- v2.2 §5 (T6 review I3): the window end a score covers; null for a provisional, cut-short read.
-- Final = covers ends_at and scored_at >= ends_at + 15 min (lib/earnkit/campaigns.ts scoreIsFinal).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scored_through timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prize_tx text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prize_paid_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_image bytea;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_image_type text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS installation_id integer REFERENCES installations(id);

-- v2.1 sponsor campaigns
ALTER TABLE programs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'file'; -- 'file' | 'sponsor'
ALTER TABLE programs ADD COLUMN IF NOT EXISTS max_award_usd numeric;  -- per-winner USD, when the source states it (tie-break)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prize_amount text;  -- what this winner got, token units
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prize_reason text;  -- the sponsor's public reason
-- One entry per repo per campaign, guaranteed by the database as well as by recordSubmission's
-- check: repo_key is the normalized repo link (campaigns.ts normalizeRepoUrl), set for campaign
-- entries only. Rows from before this have NULL and are skipped by the partial index.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_key text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_campaign_repo_key
  ON projects (program_id, repo_key) WHERE repo_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS sponsor_campaigns (
  ref             text PRIMARY KEY,                 -- 0x + 64 hex; bytes32 used onchain
  program_id      text REFERENCES programs(id),     -- set when live
  installation_id integer NOT NULL REFERENCES installations(id),
  sponsor_name    text NOT NULL,
  sponsor_url     text,
  draft           jsonb NOT NULL,                   -- title, what_to_build (theme before v2.2), criteria, chains, winners, existing_work, starts_at, ends_at
  token           text NOT NULL,
  token_symbol    text NOT NULL,
  token_decimals  integer NOT NULL,
  amount          text NOT NULL,                    -- decimal string in token units
  chain_id        integer NOT NULL,
  escrow_address  text,
  sponsor_wallet  text,                             -- bound at create (lowercase); only its deposit counts
  state           text NOT NULL DEFAULT 'draft'
                  CHECK (state IN ('draft', 'live', 'awarded', 'refunded', 'expired', 'taken_down', 'replaced')),
  award_plan      jsonb,                            -- [{entry_id, wallet, amount, reason}] as the sponsor sent it
  award_onchain   jsonb,                            -- [{wallet, amount, entry_id|null}] when the onchain award differs from the plan
  award_tx        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  funded_at       timestamptz,
  awarded_at      timestamptz
);
-- v2.2: funding and awards are read from the chain for the bound sponsor wallet, never from a
-- reported tx hash. The operator's pending fallback winners live beside the sponsor's plan.
ALTER TABLE sponsor_campaigns DROP COLUMN IF EXISTS fund_tx;
ALTER TABLE sponsor_campaigns ADD COLUMN IF NOT EXISTS fallback_plan jsonb;  -- [{entry_id, wallet, amount, reason}]
-- v2.2 §6 (T7): an unfunded draft can be replaced by a corrected one (create with replaces); the
-- old row becomes 'replaced' and points at its successor. Its ref is never published.
ALTER TABLE sponsor_campaigns ADD COLUMN IF NOT EXISTS replaced_by text;
ALTER TABLE sponsor_campaigns DROP CONSTRAINT IF EXISTS sponsor_campaigns_state_check;
ALTER TABLE sponsor_campaigns ADD CONSTRAINT sponsor_campaigns_state_check
  CHECK (state IN ('draft', 'live', 'awarded', 'refunded', 'expired', 'taken_down', 'replaced'));

-- v2.2 T2 fix: public chain checks are throttled. One row per ref: when it was last read from the
-- chain and what came back (reused for 15 s), and how far down the award-log search has got.
CREATE TABLE IF NOT EXISTS chain_checks (
  ref             text PRIMARY KEY,
  checked_at      timestamptz NOT NULL,
  result          jsonb,
  award_scan_hi   text                              -- next block to search down from (decimal)
);
-- Fixed-window request counters (e.g. POST /api/sponsor/[ref]/check per IP). Old windows are
-- deleted as new ones start.
CREATE TABLE IF NOT EXISTS rate_windows (
  key             text NOT NULL,
  window_start    timestamptz NOT NULL,
  count           integer NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- v2.2 §5: one sponsor-status scoring pass per campaign at a time (lib/earnkit/sponsor.ts
-- withScoringLock). A lease, claimed and released by single statements; expires on its own.
CREATE TABLE IF NOT EXISTS scoring_leases (
  program_id      text PRIMARY KEY,
  until           timestamptz NOT NULL
);

-- v2.2 §5: GitHub repo facts for matching, cached for an hour per (repo, pushed_at)
-- (lib/earnkit/repo-cache.ts). commits_since maps an ISO window start to "has commits since".
CREATE TABLE IF NOT EXISTS github_repo_facts (
  full_name       text NOT NULL,          -- lowercased owner/repo
  pushed_at       timestamptz NOT NULL,
  chains          jsonb NOT NULL,
  commits_since   jsonb NOT NULL DEFAULT '{}',
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (full_name, pushed_at)
);

-- v2.2 §3: sponsor domain verification, cached per (host, wallet): a pass for 24 h, a failure for
-- 1 h (lib/earnkit/sponsor-verify.ts). note says why a check failed (shown to the sponsor).
CREATE TABLE IF NOT EXISTS sponsor_verifications (
  host            text NOT NULL,                    -- sponsor_url's host, lowercase
  wallet          text NOT NULL,                    -- the sponsor wallet, lowercase
  verified        boolean NOT NULL,
  checked_at      timestamptz NOT NULL,
  note            text,
  PRIMARY KEY (host, wallet)
);
-- Track records are counted per sponsor wallet.
CREATE INDEX IF NOT EXISTS sponsor_campaigns_wallet ON sponsor_campaigns (sponsor_wallet);
-- v2.2 T4 fix: who made the award ('sponsor' | 'fallback' | 'off_plan') and every wallet it paid,
-- for the sponsor wallet's track record.
ALTER TABLE sponsor_campaigns ADD COLUMN IF NOT EXISTS award_source text;
ALTER TABLE sponsor_campaigns ADD COLUMN IF NOT EXISTS award_winners text[];
-- v2.2 §1 Builders: the payout wallet of this installation's last campaign entry (lowercase),
-- prefilled by prepare_submission with a confirm note.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS payout_wallet text;
-- v2.2 T5 fix 1: one entry per live link per campaign (campaigns.ts normalizeLiveUrl), and the
-- entered repo's GitHub dates at entry (shown to the sponsor: a fresh clone of an older project).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS live_key text;
-- v2.2 T9 (re-audit M5): a live link isn't proven, so uniqueness let anyone squat it. Duplicates
-- are allowed and flagged to the sponsor instead ("same live link as entry #N").
DROP INDEX IF EXISTS projects_campaign_live_key;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_created_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_pushed_at timestamptz;
