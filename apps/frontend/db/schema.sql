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

-- v2.3: whether entries get a token at submission (encouraged/allowed launch by default; off: never).
ALTER TABLE programs ADD COLUMN IF NOT EXISTS token_policy text NOT NULL DEFAULT 'encouraged'
  CHECK (token_policy IN ('encouraged', 'allowed', 'off'));

-- v2.3: the token proposed or launched for this entry, and what happened.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_name   text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_symbol text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_status text
  CHECK (token_status IN ('skipped', 'gate_failed', 'pending', 'launched', 'failed'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_note   text;

-- v2.3 Ruling 12: one launched or pending token per repo across EarnKit. token_repo_key is the
-- normalized repo (campaigns.ts normalizeRepoUrl), set when a launch is claimed. Existing rows have
-- NULL (never conflicts); a released claim sets token_url back to NULL, leaving the index.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_repo_key text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_token_repo_key
  ON projects (token_repo_key) WHERE token_url IS NOT NULL;

-- v2.4 money first ------------------------------------------------------------------------------
-- When a program last became active. "New" alerts use it, not created_at, so going live is news
-- (audit C12). Set by upsertProgram; programs active before v2.4 count from created_at.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS opened_at timestamptz;
UPDATE programs SET opened_at = created_at WHERE opened_at IS NULL AND status = 'active';

-- v2.5: up to 3 short ideas drawn from the program's stated focus or its published winners, and
-- proof a submission is a public page on a known host (e.g. a DoraHacks BUIDL), when it is.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS ideas text[] NOT NULL DEFAULT '{}';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS submission_proof jsonb;

-- One installation per OAuth client (spec §5): client_key = first 32 hex of sha256(client_id), set
-- only for client ids carrying a registration nonce (v2.4+). Installations from before v2.4, and
-- tokens of pre-v2.4 client ids, keep NULL and keep working by token.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS client_key text;
CREATE UNIQUE INDEX IF NOT EXISTS installations_client_key
  ON installations (client_key) WHERE client_key IS NOT NULL;

-- Alerts (spec §4): what this installation was last told, and the one-time daily-check offer.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS alerts_checked_at timestamptz;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS alert_state jsonb;          -- {"top": {"<project id>": true}}
ALTER TABLE installations ADD COLUMN IF NOT EXISTS fee_alerted_usd numeric;    -- fees last shown, USD
ALTER TABLE installations ADD COLUMN IF NOT EXISTS schedule_offered_at timestamptz;

-- Every wallet an installation has used (entries, creator wallets, named in list_programs):
-- its wins and fees show for them too, even from a new connection (spec §5).
CREATE TABLE IF NOT EXISTS installation_wallets (
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  wallet          text NOT NULL,                       -- lowercase
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, wallet)
);
CREATE INDEX IF NOT EXISTS installation_wallets_wallet ON installation_wallets (wallet);
INSERT INTO installation_wallets (installation_id, wallet)
  SELECT id, lower(payout_wallet) FROM installations WHERE payout_wallet IS NOT NULL
  ON CONFLICT DO NOTHING;

-- Token retry (spec §6, audit C14): the creator wallet given at record_submission or used by a
-- launch. launch_token reuses it; token-fee reads (FeeLocker) use it.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS creator_wallet text;

-- Entry proof and scoring v2 (spec §2, §3).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deployers text[];      -- each entered contract's deployer, lowercase
ALTER TABLE projects ADD COLUMN IF NOT EXISTS score_error text;      -- the last scoring failure; NULL once scored
ALTER TABLE projects ADD COLUMN IF NOT EXISTS code_share real;       -- share of direct txs carrying EarnKit's Builder Code
CREATE TABLE IF NOT EXISTS entry_wallets (
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wallet     text NOT NULL,                                      -- lowercase
  kind       text NOT NULL CHECK (kind IN ('eoa', 'smart')),
  PRIMARY KEY (project_id, wallet)
);
CREATE INDEX IF NOT EXISTS entry_wallets_wallet ON entry_wallets (wallet);
-- Alerts and standings look entries up by payout wallet in any case (M10).
CREATE INDEX IF NOT EXISTS projects_payout_wallet_lower ON projects (lower(payout_wallet));

-- The automatic lifecycle of EarnKit campaigns (spec §3): the final score, review vetoes, and an
-- idempotent payout (the signed transfer is stored before it is broadcast).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS score_final boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS score_attempted_at timestamptz; -- when scoring last started on it: oldest attempt goes first, so a slow entry cannot starve the rest
ALTER TABLE projects ADD COLUMN IF NOT EXISTS final_attempts integer NOT NULL DEFAULT 0; -- failed full-budget final reads; the 3rd freezes the last score, flagged partial
ALTER TABLE projects ADD COLUMN IF NOT EXISTS vetoed_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS veto_reason text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS payout_status text;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_payout_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_payout_status_check
  CHECK (payout_status IN ('sending', 'paid', 'refused'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prize_raw_tx text;   -- the signed transfer until it is mined
CREATE TABLE IF NOT EXISTS campaign_runs (
  program_id   text PRIMARY KEY REFERENCES programs(id),
  state        text NOT NULL DEFAULT 'running'
               CHECK (state IN ('running', 'review', 'paying', 'paid')),
  frozen_at    timestamptz,
  review_until timestamptz,
  note         text,                                   -- shown on the campaign page (e.g. wallet short)
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- v2.4 fix round 1: the payout terms (token, symbol, decimals, amount_each, winners, min_score),
-- frozen when the review opens; payouts pay only these. A transfer that reverts twice refuses its entry.
ALTER TABLE campaign_runs ADD COLUMN IF NOT EXISTS terms jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS payout_reverts integer NOT NULL DEFAULT 0;
-- v2.4 fix round 2: when a send was first answered "nonce too low". The row stays 'sending'; a run
-- 30+ min later clears it only if there is no receipt and the mined nonce is past the transfer's.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS payout_stale_at timestamptz;
-- Pay steps that failed in a row (PAY_FAILED); 6 make the cron answer 503 so the owner is emailed.
-- Any pay step that completes resets it.
ALTER TABLE campaign_runs ADD COLUMN IF NOT EXISTS pay_failures integer NOT NULL DEFAULT 0;

-- Token fees waiting in Clanker's FeeLocker (WETH), per creator wallet, cached 6 h (spec §4).
CREATE TABLE IF NOT EXISTS token_fees (
  wallet   text PRIMARY KEY,                           -- lowercase
  weth     text NOT NULL,                              -- wei, decimal string
  usd      numeric NOT NULL,
  read_at  timestamptz NOT NULL
);

-- v2.5 builder bonus (spec §3) ------------------------------------------------------------------
-- The launched coin's token address (lowercase), set when tokens.fun confirms the launch. Coins
-- launched before v2.5 keep NULL: their split has no builder bonus slot.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS coin_address text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_coin_address ON projects (coin_address) WHERE coin_address IS NOT NULL;
-- When EarnKit last sent collectRewards for this coin itself (only in a round's last 24 h).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS coin_collected_at timestamptz;

-- Submission proof (spec §3, Eligibility #3): the external program's own public page for this
-- entry (record_submission's external_submission_url, for a program with submission_proof), and
-- when EarnKit last confirmed it links the entry's repo or live site. A failed or re-checked
-- proof keeps the url and clears ok_at; the cron re-checks a failure daily until the round ends.
-- bonus_eligible is never stored: it's coin_address IS NOT NULL AND submission_proof_ok_at IS NOT
-- NULL (projects.ts bonusEligible), so it can never go stale against either column.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS submission_proof_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS submission_proof_ok_at timestamptz;
-- Fix round 1 (Ruling 11): the last time the cron (or record_submission) attempted this entry's
-- proof, pass or fail, so the daily re-check of a failure never re-fetches within 24h.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS submission_proof_checked_at timestamptz;

-- One builder bonus round: a windowed program's window, or a rolling program's UTC month
-- (key "<program id>:YYYY-MM"). Created 'open' by the first deposit booked to it.
CREATE TABLE IF NOT EXISTS bonus_rounds (
  round_key    text PRIMARY KEY,
  program_id   text NOT NULL REFERENCES programs(id),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  state        text NOT NULL DEFAULT 'open'
               CHECK (state IN ('open', 'frozen', 'review', 'paying', 'paid', 'empty')),
  review_until timestamptz,
  terms        jsonb
);

-- Traction score (spec §3, lib/earnkit/traction.ts). One daily probe of each entry's live link
-- (live product = ok days / days in the round so far).
CREATE TABLE IF NOT EXISTS live_checks (
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day        date NOT NULL,
  ok         boolean NOT NULL,
  PRIMARY KEY (project_id, day)
);
-- Each eligible entry's signals per round per UTC day: read at most once a day (GitHub, Blockscout,
-- users), with the groups that failed (retried alone), the window end they cover (ends_at = final),
-- and the round's score and rank from them. No trading volume: it never counts.
CREATE TABLE IF NOT EXISTS bonus_scores (
  round_key   text NOT NULL REFERENCES bonus_rounds(round_key),
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day         date NOT NULL,
  signals     jsonb NOT NULL,
  failed      text[] NOT NULL DEFAULT '{}',
  through     timestamptz NOT NULL,
  score       double precision,
  rank        integer,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_key, project_id, day)
);
-- Fix round 1 (Ruling 12): commit days are built up read by read. Each commit SHA an entry's daily
-- read sees for the first time is kept with that read's day (never recomputed from commit dates),
-- and its author's login when it is a linked account 30+ days old then (contributors).
CREATE TABLE IF NOT EXISTS bonus_commits (
  round_key  text NOT NULL REFERENCES bonus_rounds(round_key),
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha        text NOT NULL,
  day        date NOT NULL,
  login      text,
  PRIMARY KEY (round_key, project_id, sha)
);
-- GitHub accounts' creation times (lowercase login), kept across days so an account is read once.
CREATE TABLE IF NOT EXISTS github_users (
  login      text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
-- Ruling 13b: an external entry's normalized repo (campaigns.ts normalizeRepoUrl). Not unique: a
-- later entry of the same repo in the same program is recorded but never bonus-eligible.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bonus_repo_key text;
CREATE INDEX IF NOT EXISTS projects_bonus_repo_key ON projects (program_id, bonus_repo_key) WHERE bonus_repo_key IS NOT NULL;
-- Fix round 2 (Ruling 15): patterns the review page shows next to a score, e.g.
-- 'single_commit_streak' (7+ days in a row with exactly one new commit each). Never scored.
ALTER TABLE bonus_scores ADD COLUMN IF NOT EXISTS review_flags text[] NOT NULL DEFAULT '{}';
-- Fix round 3 (Ruling 16): when the coin launched. An entry counts in a round only if its coin
-- launched and its proof checked out before the round's end. Coins recorded before this column
-- count from their entry's submission.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS coin_launched_at timestamptz;
UPDATE projects SET coin_launched_at = submitted_at WHERE coin_address IS NOT NULL AND coin_launched_at IS NULL;

-- Each WETH deposit the FeeLocker stored for the bonus wallet (its StoreTokens log), attributed to
-- a coin and booked to that coin's open round, or to the Safe. Idempotent on (tx_hash, log_index).
CREATE TABLE IF NOT EXISTS bonus_ledger (
  tx_hash      text NOT NULL,
  log_index    integer NOT NULL,
  coin         text,                                   -- lowercase; NULL when no coin was attributable
  round_key    text REFERENCES bonus_rounds(round_key),
  destination  text NOT NULL CHECK (destination IN ('round', 'safe')),
  amount_wei   numeric NOT NULL CHECK (amount_wei >= 0),
  block_number bigint,
  block_time   timestamptz NOT NULL,
  sweep_id     integer,                                -- the sweep reserving it ('safe' only)
  swept_tx     text,                                   -- the mined transfer to the Safe
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tx_hash, log_index),
  CHECK ((destination = 'round') = (round_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bonus_ledger_round ON bonus_ledger (round_key) WHERE round_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS bonus_ledger_unswept ON bonus_ledger (destination) WHERE swept_tx IS NULL;
CREATE INDEX IF NOT EXISTS bonus_ledger_coin_time ON bonus_ledger (coin, block_time);

-- WETH sent from the bonus (payout) wallet to the Safe. The transfer is signed and stored before it
-- is broadcast (v2.4 payout pattern); at most one sweep is unfinished at a time.
CREATE TABLE IF NOT EXISTS bonus_sweeps (
  id          serial PRIMARY KEY,
  amount_wei  numeric NOT NULL CHECK (amount_wei > 0),
  to_wallet   text NOT NULL,
  status      text CHECK (status IN ('sending', 'paid')),
  tx_hash     text,
  raw_tx      text,
  stale_at    timestamptz,
  reverts     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  paid_at     timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS bonus_sweeps_one_open ON bonus_sweeps ((true)) WHERE status IS DISTINCT FROM 'paid';

-- Where the StoreTokens index has read up to: the last block read, and that block's time.
CREATE TABLE IF NOT EXISTS bonus_cursor (
  id          text PRIMARY KEY,                        -- 'weth'
  block       bigint NOT NULL,
  block_time  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Fix round 1: index steps that failed in a row (6 make the cron answer 503). The row may exist
-- before any block was read (a failing first run), so block is nullable: NULL = no cursor yet.
ALTER TABLE bonus_cursor ADD COLUMN IF NOT EXISTS index_failures integer NOT NULL DEFAULT 0;
ALTER TABLE bonus_cursor ALTER COLUMN block DROP NOT NULL;

-- v2.5 Task 7: round lifecycle and WETH payouts (lib/earnkit/bonus-payout.ts). A round freezes
-- (final scores, deposit index past its end), opens a 48 h review with its payout amounts frozen
-- in `terms`, then pays its winners in WETH from the bonus wallet; with no eligible entry it is
-- 'empty' and its bookings become the Safe's. `note` and `pay_failures` work as campaign_runs'.
ALTER TABLE bonus_rounds ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE bonus_rounds ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE bonus_rounds ADD COLUMN IF NOT EXISTS pay_failures integer NOT NULL DEFAULT 0;
-- An empty round's bookings move to the Safe and keep their round_key (where they came from), so
-- a 'safe' row may name a round; a 'round' row always does.
ALTER TABLE bonus_ledger DROP CONSTRAINT IF EXISTS bonus_ledger_check;
ALTER TABLE bonus_ledger DROP CONSTRAINT IF EXISTS bonus_ledger_round_named;
ALTER TABLE bonus_ledger ADD CONSTRAINT bonus_ledger_round_named CHECK (destination <> 'round' OR round_key IS NOT NULL);
-- Ruling 17: the owner's veto of an entry in one round's review (public reason).
CREATE TABLE IF NOT EXISTS bonus_vetoes (
  round_key  text NOT NULL REFERENCES bonus_rounds(round_key),
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reason     text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_key, project_id)
);
-- Each round's frozen ranking (every eligible entry, from finalRanking, when the review opens) and
-- its payouts: the place a winner takes (0 = first) and its frozen amount, the WETH transfer signed
-- and stored before it is broadcast (v2.4 payout rules), paid_at once mined. alerts.ts
-- paidBonusWins reads the paid rows (round_key, project_id, rank, amount_wei, tx_hash, paid_at).
CREATE TABLE IF NOT EXISTS bonus_payouts (
  id              serial PRIMARY KEY,
  round_key       text NOT NULL REFERENCES bonus_rounds(round_key),
  project_id      integer NOT NULL REFERENCES projects(id),
  rank            integer NOT NULL,
  score           double precision NOT NULL,
  wallet          text,                                -- the entry's creator_wallet (Ruling 14), lowercase
  installation_id integer,
  flags           text[] NOT NULL DEFAULT '{}',        -- review flags and failed sources at the freeze
  slot            integer,                             -- the payout place its transfer takes
  amount_wei      numeric,                             -- that place's frozen amount
  status          text CHECK (status IN ('sending', 'paid', 'refused')),
  tx_hash         text,
  raw_tx          text,
  stale_at        timestamptz,
  reverts         integer NOT NULL DEFAULT 0,
  paid_at         timestamptz,
  UNIQUE (round_key, project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bonus_payouts_one_per_place ON bonus_payouts (round_key, slot) WHERE tx_hash IS NOT NULL;
-- Fix round 1 (Ruling 18): a round with flagged entries waits on the owner (503) once; when.
ALTER TABLE bonus_rounds ADD COLUMN IF NOT EXISTS flagged_notified_at timestamptz;
-- Freeze-side steps that failed in a row (6 make the cron answer 503); a freeze step that completes resets it.
ALTER TABLE bonus_rounds ADD COLUMN IF NOT EXISTS freeze_failures integer NOT NULL DEFAULT 0;

-- v2.5 final fix wave (2026-10-05). Additive and idempotent: safe on a database holding v2.4 rows
-- (production has no v2.5 rows yet).
-- Ruling 23: when an ended round's final scoring failure was reported to the owner (503, once).
ALTER TABLE bonus_rounds ADD COLUMN IF NOT EXISTS score_error_notified_at timestamptz;

-- v2.6 §4: every program has a builder bonus unless its file says builder_bonus: false. Additive
-- and idempotent: safe on a database holding v2.5 rows (every existing row defaults to true).
ALTER TABLE programs ADD COLUMN IF NOT EXISTS builder_bonus boolean NOT NULL DEFAULT true;
-- v2.6 §3: how an entry's submission counts for the builder bonus. submission_proof_ok_at stays
-- "counts since"; NULL basis with submission_proof_ok_at set is a v2.5 checked page ('page').
ALTER TABLE projects ADD COLUMN IF NOT EXISTS submission_basis text;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_submission_basis_check;
ALTER TABLE projects ADD CONSTRAINT projects_submission_basis_check
  CHECK (submission_basis IN ('page', 'unverified_page', 'confirmed'));
-- v2.6 Ruling 5 (plan): when the builder confirmed the submission at record_submission.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS submission_confirmed_at timestamptz;

-- v2.7 §2: program guide facts from programs/*.json. Each fact carries its own source_url inside
-- the JSON. Additive and idempotent: v2.6 rows get an empty past_rounds and NULLs.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS logo jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS past_rounds jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS focus jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS best_bet text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS difficulty_override jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS winners_per_round integer;

-- v2.7.1: the program's total prize pool in USD, only when its own source states one (the hero's
-- "$X open right now" and each card's big line). Additive: existing rows get NULL.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS pool_usd numeric;
-- v2.7.1 review: the smallest award when the source states a range ("$5,000 to $100,000"), and
-- where the pool is stated when that isn't source_url. Additive: existing rows get NULL.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS min_award_usd numeric;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS pool_source_url text;

-- v2.8 Ruling 13 (plan): a program not tied to one chain fits any repo. Additive.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS any_chain boolean NOT NULL DEFAULT false;
-- v2.8 Ruling C5: the award is an investment ("up to $1M investment"), not a prize. Additive.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS investment boolean NOT NULL DEFAULT false;
-- v2.8.1 §B8 (fix round 1): entering needs a repo or a live product (program file needs_repo);
-- NULL when unknown (sponsor campaigns). Additive.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS needs_repo boolean;

-- v2.8 Rulings 1-3 (plan): the confirmation step and bonus eligibility. Additive.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS confirm_choice text;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_confirm_choice_check;
ALTER TABLE projects ADD CONSTRAINT projects_confirm_choice_check CHECK (confirm_choice IN ('go', 'skip'));
-- v2.8 Ruling C11: a token link the builder typed on an older entry, kept when "go" at the
-- confirmation step makes way for EarnKit's token. Never shown as EarnKit's token or on a public page.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS own_token_url text;
-- The first time the entry's answers and links were complete (the v2.7 C7 gate, now on eligibility).
-- The one backfill: every token launched before v2.8 passed C7 or predates it. This file runs
-- before EVERY deploy, so the backfill runs only in the run that creates the column: run again, it
-- would mark v2.8 entries whose token launched while incomplete as complete (Ruling 2's gate).
DO $$
BEGIN
  -- 'projects'::regclass resolves the table exactly as the ALTER and UPDATE below do (search_path).
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'projects'::regclass AND attname = 'complete_at' AND NOT attisdropped
  ) THEN
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS complete_at timestamptz;
    UPDATE projects SET complete_at = coin_launched_at WHERE complete_at IS NULL AND coin_launched_at IS NOT NULL;
  END IF;
END $$;

-- v2.8 Ruling 6 (plan): the builder's answers per project and field kind, for this installation
-- only. Never read by a public page, stats, an admin page or a log.
CREATE TABLE IF NOT EXISTS answer_bank (
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  project_key     text NOT NULL,
  kind            text NOT NULL,
  answer          text NOT NULL CHECK (length(answer) <= 4096),
  program_id      text NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, project_key, kind)
);
-- v2.8 Part D.5: the final answers and the check result, stored on the entry at confirmation.
-- Same privacy rule as answer_bank: no public or admin page reads it.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS application jsonb;
-- v2.8 Part D.4: the judging criteria a program's source states (programs/*.json judging).
ALTER TABLE programs ADD COLUMN IF NOT EXISTS judging jsonb;
-- v2.8 Part E: the submit kit. Additive.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS submit_host text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS submit_api boolean NOT NULL DEFAULT false;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS form jsonb;

-- v2.8 Part G: what happened to each entry. Additive. Self-reports never count in stats.
CREATE TABLE IF NOT EXISTS entry_outcomes (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  program_id  text NOT NULL REFERENCES programs(id),
  round_label text NOT NULL,
  result      text NOT NULL CHECK (result IN ('won', 'placed', 'finalist', 'not_selected', 'unknown')),
  prize_usd   numeric,
  source_url  text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  basis       text NOT NULL CHECK (basis IN ('announcement', 'self_reported')),
  UNIQUE (project_id, round_label, basis)
);
ALTER TABLE programs ADD COLUMN IF NOT EXISTS results jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS outcome_asked_at timestamptz;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS fit_chains text[] NOT NULL DEFAULT '{}';

-- v2.8.1 §A1: when the current launch claim (token_url = 'pending') was taken, so the cron (hourly)
-- can alert the owner about a launch still pending after 10 minutes. Additive; NULL on claims taken
-- before v2.8.1 (the cron counts those as old).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_claimed_at timestamptz;
-- v2.8.1 fix round 1: claims from before v2.8.1 take the migration's time (so they count as stuck
-- 10 minutes after it, once, instead of at once). Only rows still without a time; a no-op after.
UPDATE projects SET token_claimed_at = now() WHERE token_url = 'pending' AND token_claimed_at IS NULL;
-- v2.8.1 fix round 1: set when a launch was released after the tool had already replied
-- "launching" (the builder hasn't seen it): the next call reads it instead of relaunching, and clears it.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_released_at timestamptz;
-- v2.8.1 fix round 1 (§A2): the exact name and ticker the confirmation's Yes line showed, per entry
-- (this agent, program and project: the normalized repo, else "name:<name>"; the entry row may not
-- exist yet). "go" launches exactly this pair; anything else is shown again first. Additive.
CREATE TABLE IF NOT EXISTS token_offers (
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  program_id      text NOT NULL,
  entry_key       text NOT NULL,
  offered_name    text NOT NULL,
  offered_ticker  text NOT NULL,
  offered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, program_id, entry_key)
);

-- v2.8.1 §E17: the installation came from a hosted agent client (Grok Bot, Muse, a known hosted
-- redirect host; oauth.ts isSharedClient), where one registration may serve many users: saved
-- answers are reused only after a yes/no that names them, the remembered wallet is never suggested,
-- and the per-agent launch floor is higher. Additive; FALSE for installations made before v2.8.1.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS shared_client boolean NOT NULL DEFAULT false;
-- v2.8.1 §E18: linked to this earlier installation (its group's root) after the builder's yes and
-- the proof line (identity.ts); the MCP route acts as the root. NULL: not linked (its own root).
ALTER TABLE installations ADD COLUMN IF NOT EXISTS builder_id integer REFERENCES installations(id);
CREATE INDEX IF NOT EXISTS installations_builder_id ON installations (builder_id) WHERE builder_id IS NOT NULL;
-- v2.8.1 §E18: the pickup offer shown to this installation ({"offered": [root ids], "repo", "entries"})
-- and the groups the builder said no to ({"declined": [root ids]}). Never shown publicly.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS pickup jsonb;
-- v2.8.1 §E18: matching a stated GitHub user or wallet against earlier installations.
CREATE INDEX IF NOT EXISTS installations_github_user ON installations (lower(github_user)) WHERE github_user IS NOT NULL;

-- v2.8.1 §D, T5 fix round 1: the rollover reads (bonus-rounds.ts rolloverPrograms, the near-end
-- collect's prefilter) find a repo's entries across programs by bonus_repo_key alone.
-- Additive and idempotent.
CREATE INDEX IF NOT EXISTS projects_bonus_repo_key_any ON projects (bonus_repo_key) WHERE bonus_repo_key IS NOT NULL;

-- v2.9 A5: link and contract checks, cached: a pass 24 h, a failure 1 h (verify.ts cacheFresh).
-- key: url:<canonical url> or getcode:<chain>:<lowercase address>.
CREATE TABLE IF NOT EXISTS url_checks (
  key        text PRIMARY KEY,
  ok         boolean NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
-- v2.10 item 14 (R5): why a check failed (`note`: the error phrase a live link's page shows) and a
-- count (`n`: a cached transaction count, item 7). Both NULL on existing rows.
ALTER TABLE url_checks ADD COLUMN IF NOT EXISTS n integer;
ALTER TABLE url_checks ADD COLUMN IF NOT EXISTS note text;
-- v2.9 A5: when an entry step last found the live link loading / a contract with code on the
-- program's needs_contract chain (NULL: not verified). entryMissing reads them (token-launch.ts).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS live_verified_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_verified_at timestamptz;
-- v2.9 A5: the chain whose mainnet must hold a deployed contract for the live link to count
-- (program file needs_contract; Arc Microgrants: 'arc'). NULL: none.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS needs_contract text;

-- v2.9 A2: the repo's own real-product signals for this version (young, original, readme, contract
-- candidates from its files), cached with its chains (repo-cache.ts). The builder-dependent ones
-- (owned, active, deployed) are never cached (Pre-flight P6). NULL: read before v2.9.
ALTER TABLE github_repo_facts ADD COLUMN IF NOT EXISTS product jsonb;
-- v2.10 R10: a repo fact row read through the App (private), never shown on public pages.
ALTER TABLE github_repo_facts ADD COLUMN IF NOT EXISTS via_app boolean NOT NULL DEFAULT false;
-- v2.9 A2: the lowest product score a repo needs for a matched row (program file
-- min_product_score; a16z: 5). 0: no floor.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS min_product_score int NOT NULL DEFAULT 0;

-- v2.9 A3: what the builder told EarnKit about programs (lowers eligibility only).
CREATE TABLE IF NOT EXISTS builder_program_status (
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  program_id      text NOT NULL,
  -- v2.9 B9 (Ruling G6): '' on the installation's own memory; on a shared (hosted) client, the
  -- GitHub-verified login the statement was made under.
  login           text NOT NULL DEFAULT '',
  status          text NOT NULL CHECK (status IN ('applied', 'not_interested')),
  round_label     text,
  at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, login, program_id)
);
-- v2.9 A3: what the builder told EarnKit about a repo (repo_key: owner/repo or name:<name>).
CREATE TABLE IF NOT EXISTS builder_repo_facts (
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  repo_key        text NOT NULL,
  mainnet_chains  text[] NOT NULL DEFAULT '{}',
  testnet_chains  text[] NOT NULL DEFAULT '{}',
  live_url        text,
  has_users       boolean,
  not_mine        boolean NOT NULL DEFAULT false,
  at              timestamptz NOT NULL DEFAULT now(),
  -- v2.9 B9 (Ruling G6): as builder_program_status.login.
  login           text NOT NULL DEFAULT '',
  PRIMARY KEY (installation_id, login, repo_key)
);

-- v2.9 A7: up to 5 compact facts of the builder's best owned repos, for alerts with no GitHub call.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS fit_repos jsonb NOT NULL DEFAULT '[]';
-- v2.10 item 15: the deadline line, once per entry per UTC day: { "<project id>": "YYYY-MM-DD" }.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS deadline_shown jsonb;
-- v2.9 A8: what matching showed, one row per (installation, program, repo) per UTC day.
CREATE TABLE IF NOT EXISTS match_shown (
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  program_id      text NOT NULL,
  repo_key        text NOT NULL,
  status          text NOT NULL,
  product_score   integer,
  row_level       text NOT NULL,
  day             date NOT NULL,
  PRIMARY KEY (installation_id, program_id, repo_key, day)
);
ALTER TABLE programs ADD COLUMN IF NOT EXISTS match_floor integer;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS match_precision numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS product_score integer;
-- v2.10 R10 (Pre-flight P4): the entry's repo is known private (read through the App): public pages
-- show the project name only, and tokens.fun never gets the repo URL.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_private boolean NOT NULL DEFAULT false;
-- v2.10 item 6: the repo's traction score (0 to 10) as matching showed it; null on older rows.
ALTER TABLE match_shown ADD COLUMN IF NOT EXISTS traction smallint;

-- v2.9 B9 (Ruling G6): builder memory is keyed by login too (a database made before the column).
ALTER TABLE builder_program_status ADD COLUMN IF NOT EXISTS login text NOT NULL DEFAULT '';
ALTER TABLE builder_repo_facts ADD COLUMN IF NOT EXISTS login text NOT NULL DEFAULT '';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'builder_program_status'::regclass AND i.indisprimary AND a.attname = 'login') THEN
    ALTER TABLE builder_program_status DROP CONSTRAINT builder_program_status_pkey;
    ALTER TABLE builder_program_status ADD PRIMARY KEY (installation_id, login, program_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'builder_repo_facts'::regclass AND i.indisprimary AND a.attname = 'login') THEN
    ALTER TABLE builder_repo_facts DROP CONSTRAINT builder_repo_facts_pkey;
    ALTER TABLE builder_repo_facts ADD PRIMARY KEY (installation_id, login, repo_key);
  END IF;
END $$;

-- v2.9 B9: one-time sign-in links (Ruling 5). Only the sha256 of the nonce is stored.
CREATE TABLE IF NOT EXISTS github_verify_nonces (
  nonce_hash      text PRIMARY KEY,
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  project_id      integer REFERENCES projects(id) ON DELETE CASCADE,
  repo_key        text NOT NULL,
  purpose         text NOT NULL CHECK (purpose IN ('entry', 'pickup', 'host')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);
CREATE INDEX IF NOT EXISTS github_verify_nonces_project ON github_verify_nonces (project_id) WHERE project_id IS NOT NULL;
-- v2.9 B9: a passed GitHub ownership check (Ruling 6). The GitHub token is never stored.
CREATE TABLE IF NOT EXISTS github_verifications (
  id                 serial PRIMARY KEY,
  repo_key           text NOT NULL,
  login              text NOT NULL,
  installation_id    integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  project_id         integer REFERENCES projects(id) ON DELETE CASCADE,
  account_created_at timestamptz NOT NULL,
  public_repos       integer NOT NULL,
  verified_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS github_verifications_repo ON github_verifications (repo_key, installation_id);
-- v2.9 B9 (Pre-flight P11): the nonce's purpose, and when a single-use (shared client host) check was used.
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'entry';
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS used_at timestamptz;
-- v2.9 B9 (Ruling G9): on a shared client, the sha256 of the one-time code the builder pastes to the agent.
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS code_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS github_verifications_code ON github_verifications (code_hash) WHERE code_hash IS NOT NULL;
-- v2.9 B9 (Ruling G11): the fee wallet and ticker the confirm page showed; an entry sign-in proves a
-- launch to exactly that wallet.
ALTER TABLE github_verify_nonces ADD COLUMN IF NOT EXISTS wallet text;
ALTER TABLE github_verify_nonces ADD COLUMN IF NOT EXISTS symbol text;
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS wallet text;
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS symbol text;
-- v2.10 item 7b (R8): the App's nonce purpose; the login the OAuth hop proved, read by the setup URL.
ALTER TABLE github_verify_nonces DROP CONSTRAINT IF EXISTS github_verify_nonces_purpose_check;
ALTER TABLE github_verify_nonces ADD CONSTRAINT github_verify_nonces_purpose_check CHECK (purpose IN ('entry', 'pickup', 'host', 'app', 'claim')); -- v2.12.1 T7: 'claim' here too, or a rerun fails on claim rows
ALTER TABLE github_verify_nonces ADD COLUMN IF NOT EXISTS login text;
-- v2.10 Pre-flight P3: the account facts of that sign-in, for the setup URL's verification row (its
-- NOT NULL columns). NULL until an `app` nonce's OAuth hop passes.
ALTER TABLE github_verify_nonces ADD COLUMN IF NOT EXISTS account_created_at timestamptz;
ALTER TABLE github_verify_nonces ADD COLUMN IF NOT EXISTS public_repos integer;
-- v2.10 item 7b: how a verification was made ('oauth' sign-in or the read-only 'app'), and the App installation.
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'oauth';
ALTER TABLE github_verifications ADD COLUMN IF NOT EXISTS github_installation_id bigint;
-- v2.10 fix round 1 (concern 4): a per-link random seed; the nonce is HMAC(EARNKIT_AUTH_SECRET, seed),
-- so an open link can be shown again instead of minting a new one (the nonce itself is never stored).
ALTER TABLE github_verify_nonces ADD COLUMN IF NOT EXISTS seed text;
CREATE INDEX IF NOT EXISTS github_verify_nonces_open ON github_verify_nonces (installation_id, repo_key, purpose) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS github_verify_nonces_expires ON github_verify_nonces (expires_at);
-- v2.10 Ruling H6: when GitHub last said a repo is public (a read without an App token answering
-- private: false), by normalized repo key. Public pages show a repo URL only within 7 days of it.
CREATE TABLE IF NOT EXISTS repo_public_reads (
  repo_key text PRIMARY KEY,
  read_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS repo_public_reads_read_at ON repo_public_reads (read_at);

-- v2.9 B10: the builder said skip to a token offer for this repo; at 2 it is never offered again.
-- Ruling G12: `login` is the builder ('' off shared clients, the verified login on one); `offers`
-- holds the offers already counted, so a retried skip counts once.
CREATE TABLE IF NOT EXISTS token_declines (
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  login           text NOT NULL DEFAULT '',
  repo_key        text NOT NULL,
  count           integer NOT NULL DEFAULT 1,
  offers          text[] NOT NULL DEFAULT '{}',
  last_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, login, repo_key)
);

-- v2.9 Ruling G14: when the first reply (list_programs) showed this token offer; later offers in the
-- entry flow then leave out "40%". Kept when a later offer replaces the pair.
ALTER TABLE token_offers ADD COLUMN IF NOT EXISTS first_reply_at timestamptz;

-- v2.9 D16: each EarnKit token's creator and MINI fee recipients, read once from its locker.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fee_recipients jsonb;
-- v2.9 D18: claims sent by the hourly cron. An ops log, never revenue (revenue stays tokens.fun's fee_events).
CREATE TABLE IF NOT EXISTS fee_claims (
  tx_hash text PRIMARY KEY,
  owner   text NOT NULL,
  role    text NOT NULL CHECK (role IN ('safe', 'bonus', 'creator', 'mini')),
  weth    numeric NOT NULL,
  gas_wei numeric NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);

-- v2.9 C12-C14: hosted static sites on <slug>.earnkit.com (one per repo, 3 per GitHub account).
CREATE TABLE IF NOT EXISTS hosted_sites (
  slug            text PRIMARY KEY,
  login           text NOT NULL,
  repo_key        text NOT NULL UNIQUE,
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  bytes           bigint NOT NULL,
  files           integer NOT NULL,
  status          text NOT NULL,
  flags           text[] NOT NULL DEFAULT '{}',
  deployed_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz
);
-- Fix round 1: `deploying` (reserved under the lock before any R2 write) and `failed` (never published).
ALTER TABLE hosted_sites DROP CONSTRAINT IF EXISTS hosted_sites_status_check;
ALTER TABLE hosted_sites ADD CONSTRAINT hosted_sites_status_check
  CHECK (status IN ('live', 'review', 'killed', 'ended', 'deploying', 'failed'));
-- I4: when the hourly cron last looked at a rolling site's programs (it rotates through all of them).
ALTER TABLE hosted_sites ADD COLUMN IF NOT EXISTS expiry_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS hosted_sites_login ON hosted_sites (lower(login));
CREATE TABLE IF NOT EXISTS host_deploys (
  id         serial PRIMARY KEY,
  login      text NOT NULL,
  slug       text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS host_deploys_login_at ON host_deploys (lower(login), at);
-- Fix round 1 (I2, I3): every deploy is a row before its first R2 write: its keys as they are written
-- (`written`), its bytes (counted toward 8 GB until published or cleaned), and where it is.
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS repo_key text;
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live'
  CHECK (status IN ('deploying', 'live', 'review', 'failed', 'cleaned'));
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS files integer NOT NULL DEFAULT 0;
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS flags text[] NOT NULL DEFAULT '{}';
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS written text[] NOT NULL DEFAULT '{}';
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS done_at timestamptz;
CREATE INDEX IF NOT EXISTS host_deploys_open ON host_deploys (slug, status) WHERE status IN ('deploying', 'review', 'failed');
-- One-time upload URLs (only the sha256 of the token is stored).
CREATE TABLE IF NOT EXISTS host_upload_tokens (
  token_hash      text PRIMARY KEY,
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  login           text NOT NULL,
  repo_key        text NOT NULL,
  slug            text NOT NULL,
  project         text NOT NULL,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);
-- Fix round 1 (review M2): a link takes at most 5 upload attempts.
ALTER TABLE host_upload_tokens ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
-- v2.9: free-tier counters with hard caps (free-tier.ts): r2Writes per month, resend per day and month.
CREATE TABLE IF NOT EXISTS free_tier_usage (
  name   text NOT NULL,
  period text NOT NULL,
  used   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (name, period)
);

-- v2.9 E19: the weekly email, opt-in only (digest.ts). Never shown publicly. Ruling G21: one
-- subscription per installation (login ''), and on a shared client one per GitHub-verified login.
-- A row with no email is a question asked (or answered no); opted in always has an email.
CREATE TABLE IF NOT EXISTS digest_subscriptions (
  installation_id    integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  login              text NOT NULL DEFAULT '',
  email              text CHECK (length(email) <= 254),
  asked_at           timestamptz,
  opted_in_at        timestamptz,
  unsubscribed_at    timestamptz,
  last_sent_at       timestamptz,
  last_considered_at timestamptz,
  PRIMARY KEY (installation_id, login),
  CHECK (opted_in_at IS NULL OR email IS NOT NULL)
);
ALTER TABLE installations ADD COLUMN IF NOT EXISTS digest_asked_at timestamptz;
-- v2.10 item 4 (Task 9 fix round 2, I-a): the wallet the confirm line showed with the pair (null when
-- it asked for one). confirm with project_id launches only the pair and wallet shown (Ruling G13).
ALTER TABLE token_offers ADD COLUMN IF NOT EXISTS offered_wallet text;

-- v2.10 item 13: contracts EarnKit deployed for builders (the deployer holds no rights after).
-- Pre-flight P16: the row is reserved (tx_hash '') inside the transaction that counts the
-- builder's last 30 days, before anything is sent; it gets the hash right after the send.
-- builder_key (fix round 1, I6): the verified login, else 'installation:<id>' (a shared client
-- without a login: the repo key); the per-builder limits count by it.
CREATE TABLE IF NOT EXISTS contract_deploys (
  id              serial PRIMARY KEY,
  installation_id integer NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  login           text,
  builder_key     text NOT NULL,
  repo_key        text NOT NULL,
  chain           text NOT NULL CHECK (chain IN ('arc', 'base')),
  tx_hash         text NOT NULL,
  address         text,
  status          text NOT NULL CHECK (status IN ('sent', 'deployed', 'reverted', 'unknown')),
  owner_ok        boolean,
  -- fix round 2 (N2): the constructor created contracts; this builder_key deploys no more.
  blocked         boolean NOT NULL DEFAULT false,
  cost_micro_usd  bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_deploys_owner_flag ON contract_deploys (created_at) WHERE owner_ok = false OR status = 'unknown';
CREATE INDEX IF NOT EXISTS contract_deploys_builder ON contract_deploys (builder_key, created_at);
-- v2.11 T3: the wallet the builder named as owner, and the block the deploy landed in (the deployed
-- event's proof, and where T11's usage checks start). Additive and nullable: rows from before have
-- neither (the backfill leaves them null; T11 reads the block from the receipt).
ALTER TABLE contract_deploys ADD COLUMN IF NOT EXISTS owner_wallet text;
ALTER TABLE contract_deploys ADD COLUMN IF NOT EXISTS block bigint;
-- v2.11 T3 review M1: the stored code differed from the simulation (the builder was told not to use
-- it); the deployed event says so, so usage checks and the metric can leave it out.
ALTER TABLE contract_deploys ADD COLUMN IF NOT EXISTS code_differs boolean NOT NULL DEFAULT false;
-- v2.11 T3 review M5: record_submission's rows per entry (the backfill and the C10 EXISTS checks).
CREATE INDEX IF NOT EXISTS submissions_project ON submissions (project_id);

-- v2.11 spec 6: the builder event log. One row per thing a builder shipped (built, deployed,
-- hosted, entered, submitted, won, lost, usage_check), with its public proof. Nothing reads it for
-- scoring yet; it exists so nothing is lost. No FKs: deleting an installation, program or project
-- never removes history. dedupe_key makes every write idempotent (ON CONFLICT DO NOTHING).
-- Writes are off until EARNKIT_EVENT_LOG=on (lib/earnkit/events.ts), which waits for the /terms
-- disclosure (v2.11 T12).
CREATE TABLE IF NOT EXISTS builder_events (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL CHECK (type IN ('built','deployed','hosted','entered','submitted','won','lost','usage_check')),
  github_login    text,                 -- lowercased, only from a verified source
  login_basis     text CHECK (login_basis IN ('signin','app','proof_line','repo_owner')),
  installation_id integer,
  wallet          text,                 -- lowercased 0x address the builder gave
  repo_key        text,                 -- owner/repo, lowercased
  program_id      text,
  project_id      integer,
  chain           text,
  proof_tx        text,                 -- tx hash
  proof_url       text,                 -- live link, repo, submission or results URL
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key      text NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS builder_events_login ON builder_events (github_login, at);
CREATE INDEX IF NOT EXISTS builder_events_due ON builder_events (type, at) WHERE type = 'deployed';

-- Append-only: UPDATE, DELETE and TRUNCATE raise. The one exception is the owner-run redaction
-- script (v2.11 T12, scripts/events-redact.mts). Inside one transaction it runs
--   SELECT set_config('earnkit.events_redact', 'on:' || txid_current(), true);
-- and then UPDATEs one builder's rows. The trigger accepts only a value bound to the current
-- transaction id, so a session-level SET or a connection option ('on', or a stale 'on:<old txid>')
-- never opens the table. Under redaction an UPDATE may only null github_login and wallet and change
-- detail (blank the twist); every other column must stay as it was. DELETE and TRUNCATE are never
-- allowed. This guards against app code paths, not a hostile role: on a single database role the
-- app owns the table and could drop the trigger, so app code must never touch the setting
-- (events.test.ts scans lib/ and app/ for it).
CREATE OR REPLACE FUNCTION builder_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_LEVEL = 'ROW' AND TG_OP = 'UPDATE'
     AND coalesce(current_setting('earnkit.events_redact', true), '') = 'on:' || txid_current()::text THEN
    IF (NEW.id, NEW.at, NEW.type, NEW.dedupe_key, NEW.login_basis, NEW.installation_id, NEW.repo_key,
        NEW.program_id, NEW.project_id, NEW.chain, NEW.proof_tx, NEW.proof_url)
       IS DISTINCT FROM
       (OLD.id, OLD.at, OLD.type, OLD.dedupe_key, OLD.login_basis, OLD.installation_id, OLD.repo_key,
        OLD.program_id, OLD.project_id, OLD.chain, OLD.proof_tx, OLD.proof_url)
       OR (NEW.github_login IS DISTINCT FROM OLD.github_login AND NEW.github_login IS NOT NULL)
       OR (NEW.wallet IS DISTINCT FROM OLD.wallet AND NEW.wallet IS NOT NULL) THEN
      RAISE EXCEPTION 'builder_events is append-only (redaction may only null github_login and wallet and change detail)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'builder_events is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'builder_events_no_change' AND tgrelid = 'builder_events'::regclass) THEN
    CREATE TRIGGER builder_events_no_change BEFORE UPDATE OR DELETE ON builder_events
      FOR EACH ROW EXECUTE FUNCTION builder_events_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'builder_events_no_truncate' AND tgrelid = 'builder_events'::regclass) THEN
    CREATE TRIGGER builder_events_no_truncate BEFORE TRUNCATE ON builder_events
      FOR EACH STATEMENT EXECUTE FUNCTION builder_events_append_only();
  END IF;
END $$;

-- v2.11 T11 (concern 4): failed usage-check runs in a row per deployed event. Not part of the
-- append-only log (a counter, cleared when a check passes); after 5 in a row the deploy is skipped
-- for 7 days (events.ts usageChecks), so a contract that can never be read never blocks newer ones.
CREATE TABLE IF NOT EXISTS usage_check_failures (
  deployed_event_id bigint PRIMARY KEY,   -- builder_events.id of the deployed event (no FK, like the log)
  failures          integer NOT NULL,
  last_failed_at    timestamptz NOT NULL
);

-- v2.11 plan S6 and the fresh pick: one build at a time per installation, and when the fresh
-- build was last offered. Additive; NULL for every existing installation.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS fresh_offer_at timestamptz;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS build jsonb;

-- v2.11 T5 (spec 2): the program file's fresh_build ({ "starter": "<starters.ts id>" }), set by the
-- owner only; NULL for a program without one. Additive.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS fresh_build jsonb;

-- v2.11 T9 (plan S9, decision 2): how an upload link's GitHub login was proven. 'signin' (the v2.9
-- host sign-in, or 'app'), or 'proof_line': off a shared client, this agent's earnkit.txt line in
-- the builder's own User account's repo plus a public account read (github-verify.ts githubUser).
-- The upload re-checks the gate the same way, and the hosted event carries it. Additive; every
-- existing row is a sign-in.
ALTER TABLE host_upload_tokens ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'signin'
  CHECK (basis IN ('signin', 'app', 'proof_line'));
ALTER TABLE host_deploys ADD COLUMN IF NOT EXISTS basis text NOT NULL DEFAULT 'signin'
  CHECK (basis IN ('signin', 'app', 'proof_line'));
-- v2.11 T9 security fix (I1): who GitHub says pushed this installation's earnkit.txt line into the
-- repo (the push's authenticated actor), lowercase; NULL when unknown or proven by sign-in. A login
-- is only ever recorded from it when it is the repo's owner (github-verify.ts proofLineLogin).
ALTER TABLE contract_deploys ADD COLUMN IF NOT EXISTS line_owner text;
CREATE INDEX IF NOT EXISTS contract_deploys_repo_day ON contract_deploys (repo_key, created_at);
CREATE INDEX IF NOT EXISTS contract_deploys_wallet_day ON contract_deploys (owner_wallet, created_at);
-- v2.11 final fix wave (security re-review 4, F1): the build path's starter, set at reservation only
-- when the artifact is exactly that starter's bytecode (NULL for every v2.10 deploy and every
-- existing row). A deploy left unconfirmed is settled later only for this starter and build wallet.
ALTER TABLE contract_deploys ADD COLUMN IF NOT EXISTS starter text;
-- v2.11 T9 security fix R4 (b): when EarnKit first showed an installation the earnkit.txt line for a
-- repo; a commit dated before it is never that builder's own writing of the line. Additive.
CREATE TABLE IF NOT EXISTS proof_line_issues (
  installation_id integer NOT NULL,
  repo_key        text NOT NULL,
  first_at        timestamptz NOT NULL,
  PRIMARY KEY (installation_id, repo_key)
);

-- v2.12 (spec 1 to 6, 10): the verified builder score. Additive. Keys are the person's group root,
-- COALESCE(installations.builder_id, installations.id) (plan R1); no FKs, like the event log, so
-- history outlives an installation. Nothing writes these until EARNKIT_BUILDER_SCORE=on.
CREATE TABLE IF NOT EXISTS builder_profiles (
  builder_id       integer PRIMARY KEY,
  x_handle         text CHECK (x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
  fallback_handle  text,                         -- verified GitHub login, else short wallet 0xabcd…1234
  github_login     text,                         -- the proven login (plan R4); a data source, never the name
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,40}$'),
  hidden           boolean NOT NULL DEFAULT false,
  held             boolean NOT NULL DEFAULT false,
  twitter_prefill  text,                         -- GitHub twitter_username: prefill only, never shown or scored
  card_offered_at  timestamptz,
  x_asked_at       timestamptz,
  first_find_at    timestamptz NOT NULL DEFAULT now(),
  empty_checked_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- v2.12 T6 review: one login, one person (no two profiles share a GitHub login).
CREATE UNIQUE INDEX IF NOT EXISTS builder_profiles_github_login ON builder_profiles (lower(github_login)) WHERE github_login IS NOT NULL;
CREATE TABLE IF NOT EXISTS profile_slug_history (
  old_slug   text PRIMARY KEY,
  builder_id integer NOT NULL,
  moved_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS builder_sources (
  id            bigserial PRIMARY KEY,
  builder_id    integer NOT NULL,
  -- An open enum (spec 2): v2.13's Stripe is one more value here.
  kind          text NOT NULL CHECK (kind IN ('repo','site','package_npm','package_pypi','contract','merged_pr')),
  ref           text NOT NULL,                  -- owner/repo, origin URL, package name, chain:address, PR URL
  project_key   text NOT NULL,                  -- groups a repo, its site, package and contract
  proof         text CHECK (proof IN ('github_signin','proof_line','repo_owner','deployer','deploy_wallet','earnkit_txt','dns_txt','repo_link')),
  state         text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','verified','rejected')),
  reject_reason text,
  proposed_by   text NOT NULL CHECK (proposed_by IN ('agent','server')),
  last_read_day date,                           -- the read queue's key (oldest first)
  created_at    timestamptz NOT NULL DEFAULT now(),
  verified_at   timestamptz,
  UNIQUE (builder_id, kind, ref)
);
-- v2.12 T5 review: a verified contract's onchain deployer (another person's repo_link by it is refused).
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS deployer text;
CREATE INDEX IF NOT EXISTS builder_sources_due ON builder_sources (last_read_day NULLS FIRST, id) WHERE state = 'verified';
-- v2.12 post-push audit: a typed wallet proves no contract. Revoke any contract verified that way
-- (idempotent; matches nothing once applied, and nothing at all where discovery never ran).
UPDATE builder_sources SET state = 'rejected', reject_reason = 'wallet_unproven'
  WHERE kind = 'contract' AND proof = 'deploy_wallet' AND state <> 'rejected';
CREATE TABLE IF NOT EXISTS source_readings (
  id        bigserial PRIMARY KEY,
  source_id bigint NOT NULL,
  day       date NOT NULL,
  signals   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ok        boolean NOT NULL,
  error     text,
  at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, day)
);
CREATE TABLE IF NOT EXISTS builder_scores (
  id          bigserial PRIMARY KEY,
  builder_id  integer NOT NULL,
  day         date NOT NULL,
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  percentile  real NOT NULL CHECK (percentile BETWEEN 0 AND 100),
  parts       jsonb NOT NULL,                   -- each part's points and raw, unscaled inputs
  top_outcome jsonb NOT NULL,
  formula     text NOT NULL,
  calibration text NOT NULL,
  held        boolean NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (builder_id, day)
);
-- The owner's release of a held day (app/admin/scores): a row, never an UPDATE of builder_scores.
CREATE TABLE IF NOT EXISTS score_releases (
  builder_id  integer NOT NULL,
  day         date NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (builder_id, day)
);
-- Plan R7: each person's public score and live percentile, rebuilt every run in one pass.
CREATE TABLE IF NOT EXISTS builder_ranks (
  builder_id  integer PRIMARY KEY,
  score       smallint NOT NULL,
  percentile  real NOT NULL,
  computed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS discovery_queue (
  builder_id integer PRIMARY KEY,
  reason     text NOT NULL,                     -- first_find | wallet | signin | local_repo
  queued_at  timestamptz NOT NULL DEFAULT now(),
  done_at    timestamptz,
  attempts   integer NOT NULL DEFAULT 0
);
-- Same append-only rule as builder_events, with no redaction door (readings hold public signals only; the profile and source tables, which name a login, handle or repo, are mutable and listed by scripts/events-redact.mts).
CREATE OR REPLACE FUNCTION v212_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['source_readings', 'builder_scores'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_no_change' AND tgrelid = t::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION v212_append_only()', t || '_no_change', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_no_truncate' AND tgrelid = t::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION v212_append_only()', t || '_no_truncate', t);
    END IF;
  END LOOP;
END $$;
-- v2.12 spec 10: the event log's types. The inline CHECK is named builder_events_type_check; adding
-- a CHECK only scans rows (no row trigger fires), so the append-only trigger is untouched.
ALTER TABLE builder_events DROP CONSTRAINT IF EXISTS builder_events_type_check;
ALTER TABLE builder_events ADD CONSTRAINT builder_events_type_check CHECK (type IN (
  'built','deployed','hosted','entered','submitted','won','lost','usage_check',
  'source_proposed','source_verified','source_rejected','reading_taken','score_computed','score_held',
  'profile_empty','profile_hidden','profile_shown','card_offered','x_added','card_shared','score_viewed','x_cleared',
  -- v2.12.2: the v2.12.1 types here too, or a rerun fails on v2.12.1 rows before the later re-add.
  'identity_given','page_claimed','x_renamed','wallet_proven','refreshed','use_tracked','builder_code_issued',
  'coin_offered','coin_answered','page_ready_shown','news_shown',
  -- v2.13: in every re-add, or a rerun fails on v2.13 rows before the later re-add (schema-rerun.test.ts).
  'shipped_code','went_live','users_up','update_posted','update_hidden','raising_on','raising_off',
  -- v2.13.4 (R1, R6): an agent joined a page from the claim page's one button; one was detached again.
  'page_joined','page_detached',
  -- v2.14 (T5, S2): an installation bound to an X account by the fallback link's paste code.
  'signed_in_by_code',
  -- v3.1 one-tap posts: a post for X drafted; its short link's first tap.
  'post_drafted','post_tapped'));
-- v2.12 T7 review: the consent line is marked shown as the reply goes out (shown once, never lost).
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS consent_shown_at timestamptz;
-- v2.12 T7 review: an X handle claim refused because another profile shows it (GitHub's
-- twitter_username is self-declared); open while the holder still shows it, for the owner.
CREATE TABLE IF NOT EXISTS x_handle_conflicts (
  handle   text NOT NULL,                       -- lowercase
  holder   integer NOT NULL,
  claimant integer NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (handle, holder, claimant)
);
-- v2.12 spec 9: programs an agent can't complete (programs:sync derives it; the file may override).
ALTER TABLE programs ADD COLUMN IF NOT EXISTS agent_completable boolean NOT NULL DEFAULT true;
-- v2.12 T10 review: each project's numbers behind a score row (key, users, money_usd, first_outcome_at),
-- written at scoring time so the public profile shows the scorer's own numbers without re-reading
-- the whole system. Additive; NULL on rows scored before it.
ALTER TABLE builder_scores ADD COLUMN IF NOT EXISTS projects jsonb;
-- Scoring and clarity (fix round 1): whether the day's score was ranked, so the review hold never measures a
-- jump from a day the builder was unranked (no confirmed project with a repo reading). Additive; NULL on older rows.
ALTER TABLE builder_scores ADD COLUMN IF NOT EXISTS ranked boolean;

-- v2.12 spec 9: sponsor campaigns archived (archive/sponsor-campaigns/). Kept, never dropped; no writes
-- while EARNKIT_SPONSOR_CAMPAIGNS is off.
COMMENT ON TABLE sponsor_campaigns IS 'archived v2.12';
COMMENT ON TABLE sponsor_verifications IS 'archived v2.12';
COMMENT ON TABLE chain_checks IS 'archived v2.12';

-- v2.12 spec 9: the program files' starters archived (archive/starters/). Kept, never dropped; no writes
-- while EARNKIT_STARTER_REGISTRY is off (a track's delete still cascades to its starter rows).
COMMENT ON TABLE starters IS 'archived v2.12';

-- v2.12.1 (where you stand). Additive. Keys are the person's group root as in v2.12 (plan R1).
-- Nothing writes these while EARNKIT_BUILDER_SCORE is off.
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS x_user_id text;          -- immutable X user id (Sign in with X)
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS x_name text;             -- X display name, the page's top line
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS x_avatar_url text;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS reported_github text;    -- agent-reported, never proof, never merges
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS page_ready_shown_at timestamptz;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS standing_seen jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS card_moments jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS base_builder_code text;
-- What the agent last reported (names and few words per project; T5 writes it, T4 reads names from it),
-- and how the GitHub login was proven (signin, app, proof_line, x_match; T5 and T7).
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS identity jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS github_basis text;
CREATE UNIQUE INDEX IF NOT EXISTS builder_profiles_x_user ON builder_profiles (x_user_id) WHERE x_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS builder_profiles_claimed_handle ON builder_profiles (lower(x_handle)) WHERE x_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS claim_codes (
  code_hash  text PRIMARY KEY,                  -- sha256 of the deterministic claim code
  builder_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_codes_builder ON claim_codes (builder_id);
CREATE TABLE IF NOT EXISTS x_oauth_states (
  state_hash    text PRIMARY KEY,
  builder_id    integer NOT NULL,
  code_verifier text NOT NULL,
  csrf_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz
);
-- v2.12.1 T6: the state is bound to its claim code too (the code's sha256), and is deleted on use.
ALTER TABLE x_oauth_states ADD COLUMN IF NOT EXISTS code_hash text;
-- T6 fix round 1: an old slug that was a claimed X handle (a rename); only these redirect at /<name> (90 days).
ALTER TABLE profile_slug_history ADD COLUMN IF NOT EXISTS handle_rename boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS person_wallets (
  wallet     text PRIMARY KEY CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  builder_id integer NOT NULL,
  proven_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS person_wallets_builder ON person_wallets (builder_id);
CREATE TABLE IF NOT EXISTS builder_live (
  builder_id  integer PRIMARY KEY,
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  parts       jsonb NOT NULL,
  ranked      boolean NOT NULL,
  shipped     integer NOT NULL,
  people      integer NOT NULL,
  formula     text NOT NULL,
  calibration text NOT NULL,
  pending     jsonb,                            -- a held rescore waiting for the owner
  computed_at timestamptz NOT NULL,
  read_at     timestamptz                       -- the last on-demand refresh (10-minute guard)
);
CREATE INDEX IF NOT EXISTS builder_live_rank ON builder_live (score DESC) WHERE ranked;
CREATE TABLE IF NOT EXISTS builder_projects (
  builder_id         integer NOT NULL,
  project_key        text NOT NULL,
  name               text NOT NULL,
  what               text,
  link               text,
  kind               text NOT NULL CHECK (kind IN ('app','package','contract','coin','code')),
  confirmed          boolean NOT NULL,
  shipped            boolean NOT NULL,
  tracked            boolean NOT NULL DEFAULT true,
  people             integer NOT NULL DEFAULT 0,
  people_week        integer NOT NULL DEFAULT 0,
  money_usd          numeric NOT NULL DEFAULT 0,
  has_coin           boolean NOT NULL DEFAULT false,
  sends_tx           boolean NOT NULL DEFAULT false,
  tagged             boolean NOT NULL DEFAULT false,
  untracked_contract text,
  last_active_at     timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (builder_id, project_key)
);
CREATE TABLE IF NOT EXISTS source_live (
  source_id bigint PRIMARY KEY,
  signals   jsonb NOT NULL,
  ok        boolean NOT NULL,
  read_at   timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS read_usage (
  day      date NOT NULL,
  provider text NOT NULL,
  reads    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);
-- v2.12.1 T4 fix round 3: a v2 release publishes exactly the reviewed live score. NULL (v1 and
-- before): the day's history row as it is. Set: only a history row with this score is public, and
-- the released score is the next days' hold baseline (builder-score.ts publicRow, person-score.ts).
ALTER TABLE score_releases ADD COLUMN IF NOT EXISTS score smallint;
-- v2.12.1 T4 fix round 4: every score released for the day (a second release that day names a new
-- score; a history row public under an earlier one stays public). `score` stays the newest (baseline).
ALTER TABLE score_releases ADD COLUMN IF NOT EXISTS scores smallint[] NOT NULL DEFAULT '{}';
-- v2.12.1 T4 fix round 1: the person's ring weights (anti-farming ringWeights: partners' accounts and
-- the cluster cap), computed by the cron's score step so an on-demand refresh never scans everyone.
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS ring jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS coin_moments (
  builder_id  integer NOT NULL,
  project_key text NOT NULL,
  moment      text NOT NULL CHECK (moment IN ('built_live','countable','first_five','has_people')),
  offered_at  timestamptz NOT NULL DEFAULT now(),
  answer      text CHECK (answer IN ('yes','no')),
  answered_at timestamptz,
  project_id  integer,
  PRIMARY KEY (builder_id, project_key)
);
-- v2.12.1 T10 fix round 1: the wallet the coin line showed (NULL: it asked for one). A yes naming
-- another wallet re-shows the line with it, stored here; only a yes to the wallet shown launches.
ALTER TABLE coin_moments ADD COLUMN IF NOT EXISTS wallet text;
-- New source kind (coin) and proofs (x_match, wallet_signed, earnkit_hosted). Inline CHECKs carry
-- Postgres' default names; re-adding a CHECK scans rows only.
ALTER TABLE builder_sources DROP CONSTRAINT IF EXISTS builder_sources_kind_check;
ALTER TABLE builder_sources ADD CONSTRAINT builder_sources_kind_check
  CHECK (kind IN ('repo','site','package_npm','package_pypi','contract','merged_pr','coin'));
ALTER TABLE builder_sources DROP CONSTRAINT IF EXISTS builder_sources_proof_check;
ALTER TABLE builder_sources ADD CONSTRAINT builder_sources_proof_check
  CHECK (proof IN ('github_signin','proof_line','repo_owner','deployer','deploy_wallet','earnkit_txt','dns_txt','repo_link','x_match','wallet_signed','earnkit_hosted','proof_branch','github_app'));
ALTER TABLE github_verify_nonces DROP CONSTRAINT IF EXISTS github_verify_nonces_purpose_check;
ALTER TABLE github_verify_nonces ADD CONSTRAINT github_verify_nonces_purpose_check CHECK (purpose IN ('entry', 'pickup', 'host', 'app', 'claim'));
ALTER TABLE builder_events DROP CONSTRAINT IF EXISTS builder_events_type_check;
ALTER TABLE builder_events ADD CONSTRAINT builder_events_type_check CHECK (type IN (
  'built','deployed','hosted','entered','submitted','won','lost','usage_check',
  'source_proposed','source_verified','source_rejected','reading_taken','score_computed','score_held',
  'profile_empty','profile_hidden','profile_shown','card_offered','x_added','card_shared','score_viewed','x_cleared',
  'identity_given','page_claimed','x_renamed','wallet_proven','refreshed','use_tracked','builder_code_issued',
  'coin_offered','coin_answered','page_ready_shown','news_shown',
  -- v2.13: in every re-add, or a rerun fails on v2.13 rows before the later re-add (schema-rerun.test.ts).
  'shipped_code','went_live','users_up','update_posted','update_hidden','raising_on','raising_off',
  -- v2.13.4 (R1, R6): an agent joined a page from the claim page's one button; one was detached again.
  'page_joined','page_detached',
  -- v2.14 (T5, S2): an installation bound to an X account by the fallback link's paste code.
  'signed_in_by_code',
  -- v3.1 one-tap posts: a post for X drafted; its short link's first tap.
  'post_drafted','post_tapped'));
-- Spec S7 (plan): the internal program a coin-only entry belongs to. Closed, so nothing lists it.
INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, token_policy, builder_bonus, agent_completable)
VALUES ('earnkit-coin', 'EarnKit', 'Your coin', 'A coin for a project the builder already has (v2.12.1 step 3b).',
  'https://earnkit.com', 'https://earnkit.com', 'None', '', 'closed', 'allowed', 'encouraged', false, true)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE builder_events DROP CONSTRAINT IF EXISTS builder_events_login_basis_check;
ALTER TABLE builder_events ADD CONSTRAINT builder_events_login_basis_check CHECK (login_basis IN ('signin','app','proof_line','repo_owner','x_match'));
-- v2.12.1 T5 fix round 1: a proven tie (a GitHub sign-in, an X claim) to a person another group
-- already is joins only after that group's own yes (a sign-in link can be completed by anyone it
-- was sent to). Keyed by installation ids; the tie names its kind only, never the login or X id.
CREATE TABLE IF NOT EXISTS pending_joins (
  installation_id integer NOT NULL,             -- the installation that proved the tie (the joining side)
  target          integer NOT NULL,             -- the group root that already holds it (answers the yes)
  tie             text NOT NULL CHECK (tie IN ('github_login','x_user_id')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, target)
);
CREATE INDEX IF NOT EXISTS pending_joins_target ON pending_joins (target);
-- v2.12.1 T5 fix round 2: a pending join merges only after a yes from both groups' agents, each asked
-- once (asked_at) in its next find or score reply; either no deletes the row.
ALTER TABLE pending_joins ADD COLUMN IF NOT EXISTS target_yes boolean;
ALTER TABLE pending_joins ADD COLUMN IF NOT EXISTS joiner_yes boolean;
ALTER TABLE pending_joins ADD COLUMN IF NOT EXISTS target_asked_at timestamptz;
ALTER TABLE pending_joins ADD COLUMN IF NOT EXISTS joiner_asked_at timestamptz;
-- A GitHub login proven by 2+ unlinked groups is contested: it confirms nothing for any of them except
-- the group whose confirmed X is the one the GitHub profile lists, or the group the owner rules for
-- here (/admin/scores). builder_id is an installation of that group (read through its root).
CREATE TABLE IF NOT EXISTS login_contest_rulings (
  login      text PRIMARY KEY CHECK (login = lower(login)),
  builder_id integer NOT NULL,
  ruled_at   timestamptz NOT NULL DEFAULT now()
);
-- v2.12.1 T7: a wallet signature from the claim page is used once (the hash of its link token and
-- wallet), so a captured signature can never be replayed. Rows over a day old are swept as it is used.
CREATE TABLE IF NOT EXISTS wallet_proof_uses (
  use_hash text PRIMARY KEY,
  used_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_proof_uses_used ON wallet_proof_uses (used_at);
-- v2.12.1 final fix wave: an X account whose handle the owner cleared (/admin/scores "Clear X handle")
-- claims no page again, from any installation, until the owner releases it (claim.ts claimLink,
-- codeTarget and bindX refuse it; profiles.ts clearXHandle and releaseXClear).
CREATE TABLE IF NOT EXISTS x_owner_clears (
  x_user_id  text PRIMARY KEY,
  builder_id integer NOT NULL,
  cleared_at timestamptz NOT NULL DEFAULT now()
);

-- v2.13 (the Bench). Additive. Nothing writes these while EARNKIT_BENCH is off.
-- The one project (spec R1): its builder_projects key, set once (plan B2). The weekly-update yes (R5)
-- and whether the agent scheduled the weekly task (plan B10).
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS main_project_key text;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS updates_on_at timestamptz;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS updates_scheduled_at timestamptz;
-- The ship log: one row per project and ISO week (week = its Monday). text NULL: a week with facts
-- and no update (plan B8). hidden: the builder's hide; feed_hidden: the owner's feed:hide.
CREATE TABLE IF NOT EXISTS project_updates (
  id          bigserial PRIMARY KEY,
  builder_id  integer NOT NULL,
  project_key text NOT NULL,
  week        date NOT NULL CHECK (extract(isodow FROM week) = 1),
  text        text CHECK (text IS NULL OR char_length(text) <= 280),
  facts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  points      integer NOT NULL DEFAULT 0,
  pinned      boolean NOT NULL DEFAULT false,
  hidden      boolean NOT NULL DEFAULT false,
  feed_hidden boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  UNIQUE (project_key, week)
);
CREATE INDEX IF NOT EXISTS project_updates_builder ON project_updates (builder_id, week DESC);
CREATE INDEX IF NOT EXISTS project_updates_feed ON project_updates (week, points DESC) WHERE NOT hidden AND NOT feed_hidden;
-- Computed by the rescore (T4): chains the project is on (base, robinhood, arc), the streak, weeks
-- shipping in the last 52, and those weeks themselves for the profile's grid (plan B7).
ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS chains text[] NOT NULL DEFAULT '{}';
ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS streak integer NOT NULL DEFAULT 0;
ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS weeks_shipping integer NOT NULL DEFAULT 0;
ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS ship_weeks text[] NOT NULL DEFAULT '{}';
-- Scoring and clarity R18 fix 1: the profile grid's weeks, commit weeks only (ship_weeks also counts deploys and sites).
ALTER TABLE builder_projects ADD COLUMN IF NOT EXISTS commit_weeks text[] NOT NULL DEFAULT '{}';
-- Raising (R8): set on the yes, cleared on "stop raising"; the coin's launch tx and chain (tokens.fun's txHash, chainId).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS raising_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS coin_tx text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS coin_chain_id integer;
-- A program's pitch for the no-project reply (spec "2b", plan B12): { who, for } from its program file.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS pitch jsonb;
-- The fifth week in a row is a coin moment too (spec "Optional: raise"). Re-added once only.
ALTER TABLE coin_moments DROP CONSTRAINT IF EXISTS coin_moments_moment_check;
ALTER TABLE coin_moments ADD CONSTRAINT coin_moments_moment_check
  CHECK (moment IN ('built_live','countable','first_five','has_people','streak_five','first_week'));
-- v2.13.1 O1 (owner ruling, proof branch): the one project's proof is a temporary branch
-- earnkit-<code> the agent pushes to the exact repo (no file, no commit). The code is never stored:
-- it is HMAC(EARNKIT_AUTH_SECRET, seed), and only its sha256 is kept to find it (as claim_codes).
-- One hour, single use, at most one code a day per person. `checked_at`: GitHub is read at most once
-- a minute per code. `told_at`: the agent was told to delete the branch. Rows over 7 days old go.
CREATE TABLE IF NOT EXISTS proof_branches (
  code_hash   text PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  seed        text NOT NULL,
  builder_id  integer NOT NULL,
  repo_key    text NOT NULL,
  issued_at   timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  checked_at  timestamptz,
  used_at     timestamptz,
  told_at     timestamptz
);
CREATE INDEX IF NOT EXISTS proof_branches_person ON proof_branches (builder_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS proof_branches_open ON proof_branches (expires_at) WHERE used_at IS NULL;
-- v2.13.1 O1 fix round 2: a proof_branch confirmation keeps GitHub's numeric repo id and owner, so a
-- coin launch (and discovery) can tell the same repo from a re-created key. Additive.
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS gh_repo_id bigint;
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS gh_owner text;
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS gh_owner_type text;
-- v2.13.1 O2 fix round 1 (ruling 2): a code closed because the one project changed (B6). Its key
-- may get a new code at once (the 5-a-day cap still holds), and the agent is told once to delete any
-- branch it pushed. Additive.
ALTER TABLE proof_branches ADD COLUMN IF NOT EXISTS closed_at timestamptz;
-- v2.13.1 O5 N4: when a cheap read of the repo itself (GitHub's /repos/{key}, at the switch or the
-- branch check) last said it is public. The page names a repo by it until a newer reading says
-- otherwise, so a public repo never shows as "Private project" while its full read waits. Additive.
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS public_at timestamptz;

-- v2.13.2 (2): the Safe's own WETH deposits in Clanker's FeeLocker from EarnKit coins (both splits:
-- v2.5's 4 slots and v2.13's 3), indexed by the bonus ledger under the Bench flag (bonus-ledger.ts
-- indexSafeFees; its cursor is bonus_cursor 'safe'). Accrued, never claimed; /api/stats reads it for
-- fees_to_safe_eth. A deposit is attributed to its coin as the bonus index does (bonusDeposits).
CREATE TABLE IF NOT EXISTS safe_fees (
  tx_hash      text NOT NULL,                          -- lowercase
  log_index    integer NOT NULL,
  coin         text NOT NULL,                          -- lowercase, an EarnKit coin when booked
  amount_wei   numeric NOT NULL CHECK (amount_wei >= 0),
  block_number bigint,
  block_time   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS safe_fees_coin ON safe_fees (coin, tx_hash);

-- v2.13.4 R1: after X sign-in on the claim page, an X account that already has a page is offered one
-- button on the same page ("Add this agent to your page ..."). This holds that one offer: one use, 15
-- minutes, bound to the browser that signed in (the claim cookie's csrf hash) and to its claim code.
-- Only hashes of the offer token and csrf are kept; X's own token is never stored.
CREATE TABLE IF NOT EXISTS x_join_offers (
  offer_hash   text PRIMARY KEY,
  builder_id   integer NOT NULL,                        -- the installation the claim code named (the joining side)
  target       integer NOT NULL,                        -- the group root whose page holds this X account
  x_user_id    text NOT NULL,
  x_handle     text NOT NULL,
  x_name       text,
  x_avatar_url text,
  csrf_hash    text NOT NULL,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL
);

-- v2.13.4 R6: the R1 page names the joining agent: its client name as registered (dynamic client
-- registration's client_name, cleaned), kept on the installation. Additive.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS client_name text;
-- v2.13.4 R6, R7: every R1 join. The page's other installations are asked, each until it answers
-- (`answers`: installation id -> 'yes' | 'no'), "A new agent was added to your page on <date>. If that
-- wasn't you, want me to remove it?"; a yes detaches the joined installations back to their own group
-- (`from_root`). For 24 hours from joined_at the members are on probation: they may only post updates.
CREATE TABLE IF NOT EXISTS page_joins (
  id          bigserial PRIMARY KEY,
  root        integer NOT NULL,                       -- the page's group root when it joined
  from_root   integer NOT NULL,                       -- the joining group's own root before the join
  members     integer[] NOT NULL,                     -- the installations that joined
  x_user_id   text NOT NULL,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  answers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligible    integer[] NOT NULL DEFAULT '{}',          -- R8: the page's installations at join time (who may answer)
  detached_at timestamptz,
  detached_by integer
);
CREATE INDEX IF NOT EXISTS page_joins_root ON page_joins (root) WHERE detached_at IS NULL;
ALTER TABLE page_joins ADD COLUMN IF NOT EXISTS eligible integer[] NOT NULL DEFAULT '{}';
-- v2.13.4 R6: which installation posted an update, so a detached agent's updates can be hidden and a
-- probationary agent never overwrites another installation's update. Additive.
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS posted_by integer;
-- v2.13.4 R7: the installation that last asked for the claim link (the R1 page names it). Additive.
ALTER TABLE claim_codes ADD COLUMN IF NOT EXISTS minted_by integer;
-- v2.13.4 (scan: stale consent): a pending join's yes is bound to the page's root at ask time and to both
-- sides' facts then (identity.ts joinStamp); it is used only while they still match, under 24 hours.
ALTER TABLE pending_joins ADD COLUMN IF NOT EXISTS target_root integer;
ALTER TABLE pending_joins ADD COLUMN IF NOT EXISTS joiner_stamp text;
ALTER TABLE pending_joins ADD COLUMN IF NOT EXISTS target_stamp text;
-- v2.14 One account (spec 1): X is the account, at install. The token's installation is bound to the X user
-- id at the token exchange (from the signed code, never from agent input); the person is the page holding it.
-- installations.x_user_id is written only at the token exchange or by the paste code (x-install.ts
-- attachToX), and by the v2.14 bind migration below; cleared by events-redact.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS x_user_id text;
CREATE INDEX IF NOT EXISTS installations_x_user ON installations (x_user_id) WHERE x_user_id IS NOT NULL;
-- One pending X sign-in: the install's authorize request (oauth: client_id, redirect_uri, state,
-- code_challenge) or a fallback link's (installation_id, T5). One use, 15 minutes, bound to the browser that
-- started it (sha256 of its __Host-eki- cookie). X's own token is never stored.
CREATE TABLE IF NOT EXISTS x_signins (
  state_hash      text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  purpose         text NOT NULL CHECK (purpose IN ('install', 'link')),
  oauth           jsonb,
  installation_id integer,
  code_verifier   text NOT NULL,
  csrf_hash       text NOT NULL,
  expires_at      timestamptz NOT NULL
);
-- The fallback sign-in link (T5): the link code is derived from `seed` with the secret; only its hash and the paste code's hash are looked up.
CREATE TABLE IF NOT EXISTS x_signin_links (
  link_hash        text PRIMARY KEY CHECK (link_hash ~ '^[0-9a-f]{64}$'),
  seed             text,                               -- the link code is HMAC(EARNKIT_AUTH_SECRET, seed): shown again, never stored
  installation_id  integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  x_user_id        text,
  x_handle         text,
  x_name           text,
  x_avatar_url     text,
  paste_hash       text,
  paste_expires_at timestamptz,
  used_at          timestamptz
);
CREATE INDEX IF NOT EXISTS x_signin_links_installation ON x_signin_links (installation_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS x_signin_links_paste ON x_signin_links (paste_hash) WHERE paste_hash IS NOT NULL;
-- T5 fix round 1: the expired-row cleanups (newSignin, signInLink) use these; the link a 'link' sign-in opened.
CREATE INDEX IF NOT EXISTS x_signins_expires ON x_signins (expires_at);
CREATE INDEX IF NOT EXISTS x_signin_links_expires ON x_signin_links (expires_at);
ALTER TABLE x_signins ADD COLUMN IF NOT EXISTS link_hash text;
-- v2.14 (T6, spec 2): the read-only GitHub App is the only proof of a repo (repo-proof.ts): `github_app` sources are
-- checked once a day (appCheckStep) that GitHub still names an App installation for the repo; this is when.
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS app_checked_at timestamptz;
-- T6 fix round 2: when the daily check last tried (any answer), so unanswered rows go behind the others.
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS app_tried_at timestamptz;
-- v2.14 spec 3: the ship log writes itself: the week's cleaned PR and commit titles (ship-titles.ts), and the
-- builder's choice to show a private repo's titles (facts only by default). Additive.
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS titles text[] NOT NULL DEFAULT '{}';
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS ship_titles_at timestamptz;
-- v2.14 spec 4 (T4 carried to T9): the first Bench reply after an X bind (at install or by the paste code) starts
-- with "Signed in as @<handle>.", once, so a builder notices a wrong account. attachToX sets it; the reply clears it.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS x_signed_in_unseen boolean NOT NULL DEFAULT false;
-- v2.14 bind:start
-- Preflight S4 (v2.14 T7): v2.13.4's notices and detach are gone, so a one-click join nobody on the page answered
-- would otherwise become permanent (and be bound below). First, as answerNotice's detach did: the members of every
-- page_joins row still attached with no answer from an installation that was on the page before it (`eligible`) go
-- back to their own former group (from_root a root again, the others pointing to it), only while still on that
-- page and not bound to an X account; the moved ones' updates since the join are hidden; the row is stamped detached. No
-- deletes; a rerun finds no open row (a no-op). A real owner gets the agent back by signing in with X once.
WITH open_join AS (
  SELECT j.id, j.from_root, j.members, j.joined_at, COALESCE(r.builder_id, r.id) AS page
  FROM page_joins j JOIN installations r ON r.id = j.root
  WHERE j.detached_at IS NULL AND NOT EXISTS (SELECT 1 FROM unnest(j.eligible) e WHERE j.answers ? e::text)
), roots AS (
  UPDATE installations i SET builder_id = NULL
  FROM open_join o
  WHERE i.id = o.from_root AND i.id = ANY(o.members) AND i.builder_id = o.page AND i.x_user_id IS NULL
  RETURNING i.id
), others AS (
  -- The other members go back under from_root only when it is a root again (moved above, or already one), so no
  -- group nests under a non-root.
  UPDATE installations i SET builder_id = o.from_root
  FROM open_join o
  WHERE i.id = ANY(o.members) AND i.id <> o.from_root AND i.builder_id = o.page AND i.x_user_id IS NULL
    AND (o.from_root IN (SELECT id FROM roots)
      OR EXISTS (SELECT 1 FROM installations f WHERE f.id = o.from_root AND f.builder_id IS NULL))
  RETURNING i.id
), moved AS (
  SELECT id FROM roots UNION SELECT id FROM others
), hidden AS (
  -- Only the updates of installations actually moved off the page.
  UPDATE project_updates u SET hidden = true
  FROM open_join o
  WHERE u.builder_id = o.page AND u.posted_by = ANY(o.members) AND u.posted_by IN (SELECT id FROM moved)
    AND u.created_at >= o.joined_at
  RETURNING u.id
)
UPDATE page_joins j SET detached_at = now() FROM open_join o WHERE j.id = o.id;
-- Migration (spec 1): every installation of a claimed page (its group) is bound to that X account. Shared
-- clients never are; unclaimed groups stay anonymous until they sign in. Fills only NULLs: a rerun is a no-op.
UPDATE installations i SET x_user_id = p.x_user_id
FROM builder_profiles p
WHERE p.builder_id = COALESCE(i.builder_id, i.id) AND p.x_user_id IS NOT NULL AND p.x_handle IS NOT NULL
  AND i.x_user_id IS NULL AND NOT i.shared_client;
-- v2.14 bind:end
-- Scoring and clarity (Task 2, R3): Originality, a separate 0 to 100 value per main project (originality.ts). The
-- project's text is never stored: only its hash, its vector (384 numbers, all-MiniLM-L6-v2), the score and the
-- nearest list (other projects by key only, ideas by their public text). Additive; a rerun is a no-op.
CREATE TABLE IF NOT EXISTS project_embeddings (
  project_key text PRIMARY KEY,
  builder_id  integer NOT NULL,
  text_hash   text,
  desc_hash   text,
  embedding   real[],
  originality smallint CHECK (originality BETWEEN 0 AND 100),
  nearest     jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed_at timestamptz,
  checked_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS project_embeddings_builder ON project_embeddings (builder_id);
-- The known public ideas' vectors (programs/ideas/known-ideas.json), embedded once, keyed by the idea's text hash.
CREATE TABLE IF NOT EXISTS known_idea_embeddings (
  text_hash   text PRIMARY KEY,
  idea        text NOT NULL,
  embedding   real[] NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
-- Launch ready L6: the ISO week ('2026-W43') whose weekly moment this installation was shown (the first find or
-- score of a new week leads with last week's Shipping and rank). Claimed once per week by one UPDATE ... RETURNING.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS moment_week text;
-- Weekly updates: the week's work in one short paragraph (week-summary.ts), written by the weekly job from the week's
-- PR and commit titles. The builder's own note stays in `text`. Additive.
ALTER TABLE project_updates ADD COLUMN IF NOT EXISTS summary text;

-- v3 Stage 1: points, the default program. One row per approved week with facts; never ranked.
CREATE TABLE IF NOT EXISTS builder_points (
  builder_id integer NOT NULL,
  week       date NOT NULL CHECK (EXTRACT(isodow FROM week) = 1),
  points     integer NOT NULL CHECK (points >= 0),
  rank       integer,
  total      integer,
  via        text NOT NULL CHECK (via IN ('share', 'connect', 'email')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (builder_id, week)
);

-- v3 Stage 2: upcoming programs (listed, never a fit, never counted in the money total).
-- v3.1: this add allows 'unlisted' too (the last add's values), so a rerun over unlisted rows passes.
ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_status_check;
ALTER TABLE programs ADD CONSTRAINT programs_status_check CHECK (status IN ('active', 'closed', 'upcoming', 'unlisted'));
ALTER TABLE programs ADD COLUMN IF NOT EXISTS opens_note text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS in_person boolean NOT NULL DEFAULT false;

-- v3 Stage 2 (spec 5.3): an application's outcome, as the builder tells it (self-reported, never public), and when its
-- one outcome question was asked (14 days after the program's deadline).
ALTER TABLE builder_program_status DROP CONSTRAINT IF EXISTS builder_program_status_status_check;
ALTER TABLE builder_program_status ADD CONSTRAINT builder_program_status_status_check CHECK (status IN ('applied','not_interested','accepted','funded','rejected'));
ALTER TABLE builder_program_status ADD COLUMN IF NOT EXISTS asked_at timestamptz;

-- v3 Stage 2 Task 3 (spec 5.3 Route 2): backing is offered once, after the first approved week (moment 'first_week').
-- The earlier re-add (above) lists it too: schema.sql reruns whole before every deploy (schema-rerun.test.ts).
ALTER TABLE coin_moments DROP CONSTRAINT IF EXISTS coin_moments_moment_check;
ALTER TABLE coin_moments ADD CONSTRAINT coin_moments_moment_check
  CHECK (moment IN ('built_live','countable','first_five','has_people','streak_five','first_week'));

-- v3 Stage 2: backers (distinct wallets that received a coin, excluding the pool, the locker and zero) and creator fees paid.
-- backers.ts indexBackers reads each launched Base coin's Transfer logs from its cursor (start: the launch block);
-- earned.ts indexCreatorFees reads, per creator wallet (cursor in bonus_cursor 'creator_fees:<wallet>', one per wallet, not per coin), the FeeLocker's
-- StoreTokens deposits attributed to the wallet's EarnKit coins (creator_deposits, as bonusDeposits attributes the Safe's)
-- and its ClaimTokens claims (token WETH); a claim is credited per coin (creator_fees, one row per claim and coin) only up
-- to those coins' deposits not yet credited, so a claim of another coin's fees never counts. Additive; a rerun is a no-op.
CREATE TABLE IF NOT EXISTS coin_backers (coin text NOT NULL, wallet text NOT NULL, first_block bigint NOT NULL, PRIMARY KEY (coin, wallet));
CREATE TABLE IF NOT EXISTS coin_backer_cursor (coin text PRIMARY KEY, block bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS creator_fees (tx_hash text NOT NULL, log_index integer NOT NULL, coin text NOT NULL, wallet text NOT NULL, amount_wei numeric NOT NULL, block_number bigint NOT NULL, block_time timestamptz NOT NULL, PRIMARY KEY (tx_hash, log_index, coin));
CREATE TABLE IF NOT EXISTS creator_deposits (tx_hash text NOT NULL, log_index integer NOT NULL, coin text NOT NULL, wallet text NOT NULL, amount_wei numeric NOT NULL, block_number bigint NOT NULL, PRIMARY KEY (tx_hash, log_index));
CREATE INDEX IF NOT EXISTS creator_deposits_wallet ON creator_deposits (wallet, block_number);
CREATE INDEX IF NOT EXISTS creator_fees_coin ON creator_fees (coin);
-- v3 Stage 2 Task 4 fix round 2: a database that ran the first version of creator_fees (key (tx_hash, log_index), one
-- row per claim, never capped at the EarnKit coins' deposits) moves to the per-coin key, and its uncapped rows and
-- cursors ('creator_fees:<coin>') are cleared so the next run credits again under the cap. Only when the old key is
-- found; a rerun is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creator_fees_pkey' AND conrelid = 'creator_fees'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%coin%'
  ) THEN
    ALTER TABLE creator_fees DROP CONSTRAINT creator_fees_pkey;
    DELETE FROM creator_fees;
    DELETE FROM bonus_cursor WHERE id LIKE 'creator_fees:%';
    ALTER TABLE creator_fees ADD CONSTRAINT creator_fees_pkey PRIMARY KEY (tx_hash, log_index, coin);
  END IF;
END $$;

-- v3.1: whether a repo carries Base Builder Codes (ERC-8021), read through the read-only App, once a day.
CREATE TABLE IF NOT EXISTS repo_builder_codes (repo_key text PRIMARY KEY, found boolean NOT NULL, checked_at timestamptz NOT NULL);

-- v3.1: an unlisted program (off-thesis) keeps its row for old entries; nothing lists, matches, counts or guides it.
ALTER TABLE programs DROP CONSTRAINT IF EXISTS programs_status_check;
ALTER TABLE programs ADD CONSTRAINT programs_status_check CHECK (status IN ('active', 'closed', 'upcoming', 'unlisted'));

-- v3.1: when EarnKit first saw a backer (the Monday email's new backers); rows from before v3.1 are never new.
ALTER TABLE coin_backers ADD COLUMN IF NOT EXISTS first_seen_at timestamptz;
UPDATE coin_backers SET first_seen_at = 'epoch' WHERE first_seen_at IS NULL;
ALTER TABLE coin_backers ALTER COLUMN first_seen_at SET DEFAULT now();
ALTER TABLE coin_backers ALTER COLUMN first_seen_at SET NOT NULL;

-- v3.1 Highlights: the file a found Builder Code is in (the item links to it on GitHub), and a verified contract's
-- onchain creation time (Blockscout, read once when discovery verifies it; "First deployed"). Both nullable: rows
-- from before stay null until the next check or verification fills them.
ALTER TABLE repo_builder_codes ADD COLUMN IF NOT EXISTS path text;
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS deployed_at timestamptz;

-- v3.1 Highlights fix round 1: every Builder Codes attempt (success or failure) per repo, so a repo that keeps failing
-- waits a day like a checked one (replaces the in-process backoff) and never holds a slot of the cron's daily batch;
-- and when a verified contract's creation time was last asked of Blockscout (the bounded backfill of deployed_at).
CREATE TABLE IF NOT EXISTS repo_builder_codes_attempts (repo_key text PRIMARY KEY, attempted_at timestamptz NOT NULL);
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS origin_read_at timestamptz;

-- v3.1 one-tap posts (design 3): a drafted post for X behind earnkit.com/<handle>/post/<code>. The tap counts only a
-- number (no IP, no user agent); visits and x_visits count page opens carrying ?m=<code>. moment_key names the one
-- moment (weekly:<project>:<week>, won:<program>, ...) for the cooldowns; asked: the builder asked for it (else offered);
-- proof_url: the public page that verified an accepted, funded or won moment (owner ruling 3). card: the moment's
-- facts frozen when drafted. Additive; a rerun is a no-op.
CREATE TABLE IF NOT EXISTS post_drafts (
  code         text PRIMARY KEY CHECK (code ~ '^[a-z2-7]{10}$'),
  builder_id   integer NOT NULL,
  project_key  text,
  moment       text NOT NULL,
  moment_key   text NOT NULL,
  shape        text NOT NULL,
  text         text NOT NULL CHECK (char_length(text) <= 240),
  card         jsonb NOT NULL DEFAULT '{}',
  week         date,
  asked        boolean NOT NULL DEFAULT false,
  proof_url    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  taps         integer NOT NULL DEFAULT 0,
  first_tap_at timestamptz,
  visits       integer NOT NULL DEFAULT 0,
  x_visits     integer NOT NULL DEFAULT 0,
  said_posted  boolean
);
CREATE INDEX IF NOT EXISTS post_drafts_builder ON post_drafts (builder_id, created_at DESC);

-- v3.1 one-tap posts, fix round (owner ruling 3): the program's own X accounts, from its file (program-file.ts x_handles).
-- A post on one of them proves an outcome; none listed: no X post is proof for that program.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS x_handles text[] NOT NULL DEFAULT '{}';
-- v3.1 one-tap posts, fix round: when the builder said they applied (kept through a later accepted or funded), so an
-- outcome post needs an application told before it (post-moments.ts hasEntry), never the outcome's own row.
ALTER TABLE builder_program_status ADD COLUMN IF NOT EXISTS applied_at timestamptz;
UPDATE builder_program_status SET applied_at = at WHERE status = 'applied' AND applied_at IS NULL;

-- v3.1 final review 1: the program's own proof hosts (program-file.ts proof_hosts, owner-reviewed, never derived from
-- its listing or submission page). A page there or on a subdomain may prove an outcome; none and no x_handles: no link is proof.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS proof_hosts text[] NOT NULL DEFAULT '{}';
-- v3.1 final review 4: page opens counted per post per day, capped (post-drafts.ts VISIT_DAY_CAP); no IP or user agent
-- is stored. visit_day: the UTC day day_visits counts.
ALTER TABLE post_drafts ADD COLUMN IF NOT EXISTS visit_day date;
ALTER TABLE post_drafts ADD COLUMN IF NOT EXISTS day_visits integer NOT NULL DEFAULT 0;

-- Owner batch fix round (2026-10-23): a verified earnkit_txt site's earnkit.txt is fetched again on its daily read
-- (sources.ts recheckSite). proof_misses: consecutive days the profile code was missing or the fetch failed (the
-- run's deadline never counts); one success resets it; at SITE_PROOF_MISSES_MAX the proof is revoked.
-- proof_checked_day: the day of the last check, so a day counts once. Additive.
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS proof_misses smallint NOT NULL DEFAULT 0;
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS proof_checked_day date;
-- Fix wave (4, security ruling): consecutive days the earnkit.txt re-check was exempt (a transport failure while the
-- site was up); at SITE_PROOF_EXEMPT_MAX in a row the day counts as a miss. Additive.
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS proof_exempt_days smallint NOT NULL DEFAULT 0;
-- Owner batch last fix wave (E): when a site's earnkit.txt proof was lost (sources.ts recheckSite). Such a site is read
-- for 60 days (so the code coming back re-proves it), then no longer; the agent can propose it again. Additive.
ALTER TABLE builder_sources ADD COLUMN IF NOT EXISTS proof_lost_at timestamptz;

-- v3.1 wallet proof (owner-approved 2026-10-23): a proven wallet's first Base transaction, read once by discovery
-- (Blockscout's txlist, oldest first) for the profile's "On Base since" line; base_since_read_at retries a wallet
-- with no transaction yet a week later.
ALTER TABLE person_wallets ADD COLUMN IF NOT EXISTS base_since timestamptz;
ALTER TABLE person_wallets ADD COLUMN IF NOT EXISTS base_since_read_at timestamptz;
-- v3.1 wallet proof fix round (security): the reward recipient is the wallet with the newest recipient_at. The first
-- proof sets it; replacing it needs a fresh X sign-in (wallet_x_checks); a wallet proven without one counts for
-- contracts only (recipient_at NULL). Backfill: each person's first proven wallet, as coin fees used before.
ALTER TABLE person_wallets ADD COLUMN IF NOT EXISTS recipient_at timestamptz;
UPDATE person_wallets w SET recipient_at = w.proven_at WHERE w.recipient_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM person_wallets o WHERE o.builder_id = w.builder_id AND o.recipient_at IS NOT NULL)
  AND w.wallet = (SELECT f.wallet FROM person_wallets f WHERE f.builder_id = w.builder_id ORDER BY f.proven_at, f.wallet LIMIT 1);
-- A signing link (its use hash) whose page passed an X sign-in as the same person (x_user_id), 30 minutes.
CREATE TABLE IF NOT EXISTS wallet_x_checks (
  use_hash   text PRIMARY KEY,
  builder_id integer NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
-- The wallet page's X sign-in rides the v2.14 X sign-in rows (purpose 'wallet').
ALTER TABLE x_signins DROP CONSTRAINT IF EXISTS x_signins_purpose_check;
ALTER TABLE x_signins ADD CONSTRAINT x_signins_purpose_check CHECK (purpose IN ('install', 'link', 'wallet'));
-- v3.1 wallet proof security follow-up: an X check belongs to the browser that signed in (its __Host-ekwx- cookie holds
-- a random secret; only its sha256 is kept here). A check without it (rows from before) never counts.
ALTER TABLE wallet_x_checks ADD COLUMN IF NOT EXISTS browser_hash text;

-- v3.1 owner people view (owner ask 2026-10-23): signals that help the owner spot people who may farm, private to the
-- owner (jenil.ai reads owner_people as earnkit_ro). Never shown, scored or ranked. Additive.
-- The X account's creation time and followers, written at each Sign in with X (x-install.ts bindXIn); no backfill.
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS x_created_at timestamptz;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS x_followers integer;
ALTER TABLE builder_profiles ADD COLUMN IF NOT EXISTS x_checked_at timestamptz;
-- The same two carried by a fallback link's sign-in until its paste code binds (x-link.ts).
ALTER TABLE x_signin_links ADD COLUMN IF NOT EXISTS x_created_at timestamptz;
ALTER TABLE x_signin_links ADD COLUMN IF NOT EXISTS x_followers integer;
-- A proven wallet's history (people-signals.ts, the daily cron): its first Base transaction and who first sent to it
-- (lowercase); a wallet with none yet is read again a week later.
ALTER TABLE person_wallets ADD COLUMN IF NOT EXISTS first_tx_at timestamptz;
ALTER TABLE person_wallets ADD COLUMN IF NOT EXISTS funder text;
ALTER TABLE person_wallets ADD COLUMN IF NOT EXISTS signals_checked_at timestamptz;
-- v3.1 GTM W1, referral attribution (measure only, no rewards): the builder whose page (/<handle>, where a one-tap
-- post's link lands) the installing browser came from (ref-cookie.ts, a 30-day first-party cookie), stored once at the
-- token exchange (installations.ts noteReferral). Never shown publicly, never trusted beyond counting. Additive; added
-- before owner_people, whose last column (referred_installs) counts them, the builder's own excluded.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS ref_builder_id integer;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS ref_at timestamptz;
CREATE INDEX IF NOT EXISTS installations_ref_builder ON installations (ref_builder_id) WHERE ref_builder_id IS NOT NULL;
-- v4.0 Task 10: installs that came from a named source (tokens.fun: ?ref=tokensfun), never a builder; first one stays.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS ref_source text;
-- One row per profile. The wallet is the reward recipient (newest recipient_at), else the newest proven one;
-- funded_by_slug is another profile that proved the wallet's funder. Runs with the owner's rights, so earnkit_ro sees
-- only these columns (no emails, tokens or IPs). installation_ids: test installs live in an env var SQL can't read.
CREATE OR REPLACE VIEW owner_people AS
SELECT p.builder_id, p.slug, p.hidden,
  COALESCE((SELECT array_agg(i.id ORDER BY i.id) FROM installations i WHERE (i.builder_id = p.builder_id OR (i.id = p.builder_id AND i.builder_id IS NULL))), '{}'::int[]) AS installation_ids,
  p.x_handle, p.x_user_id IS NOT NULL AS x_proven, p.x_created_at, p.x_followers,
  p.github_login, g.created_at AS gh_created_at,
  w.wallet, w.recipient_at IS NOT NULL AS wallet_recipient, w.proven_at AS wallet_proven_at, w.first_tx_at AS wallet_first_tx_at,
  w.funder AS wallet_funder,
  (SELECT o.slug FROM person_wallets fw JOIN builder_profiles o ON o.builder_id = fw.builder_id
    WHERE fw.wallet = w.funder AND fw.builder_id <> p.builder_id) AS funded_by_slug,
  COALESCE(pt.total, 0)::int AS points_total, COALESCE(pt.weeks, 0)::int AS points_weeks, pt.last_week AS last_points_week,
  p.created_at AS joined_at,
  (SELECT max(i.last_seen_at) FROM installations i WHERE (i.builder_id = p.builder_id OR (i.id = p.builder_id AND i.builder_id IS NULL))) AS last_seen_at,
  (SELECT count(*) FROM installations r WHERE r.ref_builder_id = p.builder_id AND COALESCE(r.builder_id, r.id) <> p.builder_id)::int AS referred_installs,
  -- v3.1 owner tracker (owner ask 2026-10-23), appended only: the one project, its repo and site, the public score and
  -- rank, the streak, the coin, programs and reach, for jenil.ai /people's views. Owner-only; private repo names are fine.
  p.x_name, p.x_avatar_url, p.main_project_key,
  left(COALESCE(rn.name, mp.name, p.main_project_key), 60) AS project_name,
  rp.repo AS main_repo, rp.private AS repo_private, st.url AS site_url,
  lv.score AS shipping_score, lv.rank AS shipping_rank, lv.total AS rank_total,
  sk.streak AS streak_weeks, sk.weeks_12 AS commit_weeks_12, sk.last_week AS last_commit_week, ap.last_week AS last_approved_week,
  GREATEST(
    (SELECT max(i.last_seen_at) FROM installations i WHERE (i.builder_id = p.builder_id OR (i.id = p.builder_id AND i.builder_id IS NULL))),
    (ap.last_week + 7)::timestamptz, sk.last_week::timestamptz) AS last_activity_at,
  cn.symbol AS coin_symbol, cn.url AS coin_url, cn.address AS coin_address,
  COALESCE((SELECT count(*) FROM coin_backers cb WHERE cb.coin = cn.address), 0)::int AS coin_backers,
  (SELECT sum(f.amount_wei) / 1e18 FROM creator_fees f WHERE f.coin IN (
    SELECT lower(x.coin_address) FROM projects x JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND x.coin_address IS NOT NULL)) AS creator_fees_eth,
  pg.applied AS programs_applied, pg.accepted AS programs_accepted, pg.won AS programs_won,
  COALESCE(p.standing_seen->'checkin'->>'answer' = 'yes', false) AS checkin_on,
  EXISTS (SELECT 1 FROM digest_subscriptions d JOIN installations i ON i.id = d.installation_id
    WHERE (i.builder_id = p.builder_id OR (i.id = p.builder_id AND i.builder_id IS NULL))
      AND d.opted_in_at IS NOT NULL AND d.unsubscribed_at IS NULL) AS email_opted_in
FROM builder_profiles p
LEFT JOIN github_users g ON g.login = lower(p.github_login)
LEFT JOIN LATERAL (
  SELECT wallet, recipient_at, proven_at, first_tx_at, funder FROM person_wallets
  WHERE builder_id = p.builder_id ORDER BY recipient_at DESC NULLS LAST, proven_at DESC, wallet LIMIT 1) w ON true
LEFT JOIN LATERAL (
  SELECT sum(points) AS total, count(*) AS weeks, max(week) AS last_week FROM builder_points WHERE builder_id = p.builder_id) pt ON true
-- The one project's row (main_project_key), its builder-given name (identity.projects matched by repo or live link, as
-- project-name.ts refKey), its verified repo (private per the newest reading unless a newer cheap read said public, as
-- page-data.ts) and its verified site (any proof but dns_txt, which confirms nothing).
LEFT JOIN LATERAL (
  SELECT b.name, b.commit_weeks, b.link, b.confirmed FROM builder_projects b
  WHERE b.builder_id = p.builder_id AND lower(b.project_key) = lower(p.main_project_key) LIMIT 1) mp ON true
LEFT JOIN LATERAL (
  SELECT e->>'name' AS name FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.identity->'projects') = 'array' THEN p.identity->'projects' ELSE '[]'::jsonb END) e
  WHERE p.main_project_key IS NOT NULL AND jsonb_typeof(e) = 'object' AND jsonb_typeof(e->'name') = 'string' AND btrim(e->>'name') <> ''
    AND lower(p.main_project_key) IN (
      regexp_replace(regexp_replace(lower(btrim(COALESCE(e->>'repo', ''))), '^(https?://)?(www[.])?(github[.]com/)?', ''), '/+$', ''),
      regexp_replace(regexp_replace(lower(btrim(COALESCE(e->>'live_url', ''))), '^(https?://)?(www[.])?', ''), '/+$', ''))
  LIMIT 1) rn ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(s.repo, CASE WHEN lower(p.main_project_key) ~ '^[a-z0-9][a-z0-9-]*/[a-z0-9._-]+$' THEN lower(p.main_project_key) END) AS repo,
    CASE WHEN s.public_at IS NOT NULL AND s.public_at > COALESCE(s.read_at, '-infinity'::timestamptz) THEN false
      WHEN s.priv IS NULL THEN NULL ELSE s.priv = 'true'::jsonb END AS private
  FROM (SELECT 1) one
  LEFT JOIN LATERAL (
    SELECT regexp_replace(lower(btrim(r.ref)), '^(https?://)?(www[.])?github[.]com/', '') AS repo, r.public_at, n.at AS read_at, n.signals->'private' AS priv
    FROM builder_sources r
    LEFT JOIN LATERAL (
      SELECT x.signals, x.at FROM (
        (SELECT q.signals, q.day::timestamptz AS at FROM source_readings q WHERE q.source_id = r.id ORDER BY q.day DESC LIMIT 1)
        UNION ALL (SELECT v.signals, v.read_at FROM source_live v WHERE v.source_id = r.id)
      ) x ORDER BY x.at DESC LIMIT 1) n ON true
    WHERE r.builder_id = p.builder_id AND r.kind = 'repo' AND r.state = 'verified' AND lower(r.project_key) = lower(p.main_project_key)
    ORDER BY (regexp_replace(lower(btrim(r.ref)), '^(https?://)?(www[.])?github[.]com/', '') = lower(p.main_project_key)) DESC, r.id LIMIT 1) s ON true
  WHERE p.main_project_key IS NOT NULL) rp ON true
LEFT JOIN LATERAL (
  SELECT s.ref AS url FROM builder_sources s
  WHERE s.builder_id = p.builder_id AND s.kind = 'site' AND s.state = 'verified' AND s.proof IS DISTINCT FROM 'dns_txt'
    AND lower(s.project_key) = lower(p.main_project_key)
  ORDER BY s.verified_at DESC NULLS LAST, s.id DESC LIMIT 1) st ON true
-- The public score and rank (person-score.ts listedRanked: the live Shipping calibration, not pending, a claimed shown
-- page): 1 + those listed higher, of all listed. Owner approximation: it skips the Bench's confirmed-project check.
LEFT JOIN LATERAL (
  SELECT l.score::int AS score,
    1 + (SELECT count(*) FROM builder_live z JOIN builder_profiles zp ON zp.builder_id = z.builder_id
      WHERE z.ranked AND z.calibration = 'v2-shipping' AND z.pending IS NULL AND zp.x_user_id IS NOT NULL AND zp.x_handle IS NOT NULL
        AND NOT zp.hidden AND NOT zp.held AND z.score > l.score)::int AS rank,
    (SELECT count(*) FROM builder_live z JOIN builder_profiles zp ON zp.builder_id = z.builder_id
      WHERE z.ranked AND z.calibration = 'v2-shipping' AND z.pending IS NULL AND zp.x_user_id IS NOT NULL AND zp.x_handle IS NOT NULL
        AND NOT zp.hidden AND NOT zp.held)::int AS total
  FROM builder_live l
  WHERE l.builder_id = p.builder_id AND l.ranked AND l.calibration = 'v2-shipping' AND l.pending IS NULL
    AND p.x_user_id IS NOT NULL AND p.x_handle IS NOT NULL AND NOT p.hidden AND NOT p.held) lv ON true
-- The streak (site-streak.ts gridWeeks/weeks.ts streakOf, without the live reading's current week): the one project's
-- rescored commit weeks and its shown ship-log weeks with checked commits; weeks in a row ending this UTC week, or last
-- week while this one has none. weeks_12: those weeks among the last 12 (this one included).
LEFT JOIN LATERAL (
  SELECT COALESCE(array_agg(DISTINCT d), '{}'::date[]) AS weeks FROM (
    SELECT to_date(c, 'IYYY-"W"IW') AS d FROM unnest(COALESCE(mp.commit_weeks, '{}'::text[])) c WHERE c ~ '^[0-9]{4}-W[0-9]{2}$'
    UNION ALL
    SELECT u.week FROM project_updates u
    WHERE u.builder_id = p.builder_id AND lower(u.project_key) = lower(p.main_project_key) AND NOT u.hidden
      AND u.facts->'shipped_code'->'n' > '0'::jsonb AND u.week >= (now() AT TIME ZONE 'UTC')::date - 400) x) cw ON true
LEFT JOIN LATERAL (
  SELECT (SELECT min(k) FROM generate_series(0, 60) k WHERE NOT ((s.start - 7 * k) = ANY(cw.weeks)))::int AS streak,
    (SELECT count(*) FROM unnest(cw.weeks) d WHERE d > s.this_week - 84 AND d <= s.this_week)::int AS weeks_12,
    (SELECT max(d) FROM unnest(cw.weeks) d) AS last_week
  FROM (SELECT t.this_week, CASE WHEN t.this_week = ANY(cw.weeks) THEN t.this_week ELSE t.this_week - 7 END AS start
    FROM (SELECT date_trunc('week', now() AT TIME ZONE 'UTC')::date AS this_week) t) s) sk ON true
LEFT JOIN LATERAL (
  SELECT max(u.week) AS last_week FROM project_updates u
  WHERE u.builder_id = p.builder_id AND u.facts->'approved' = 'true'::jsonb) ap ON true
-- The coin (raising.ts raisingCoin's read): the group's launched entry coin on the one project first, else the newest.
LEFT JOIN LATERAL (
  SELECT x.token_symbol AS symbol, x.token_url AS url, lower(x.coin_address) AS address
  FROM projects x JOIN installations i ON i.id = x.installation_id
  WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND x.token_symbol IS NOT NULL AND x.token_url ~ '^https://'
    AND x.token_status = 'launched'
  ORDER BY (x.token_repo_key = 'github.com/' || lower(p.main_project_key)
    OR lower(x.repo_url) IN (lower('https://github.com/' || p.main_project_key), lower('https://github.com/' || p.main_project_key || '/'))) DESC NULLS LAST,
    x.coin_launched_at DESC NULLS LAST, x.id DESC LIMIT 1) cn ON true
-- Programs (distinct program ids): applied, the builder's applied/accepted/funded/rejected statements and entries
-- (projects, the internal coin program left out); accepted, accepted or funded or an outcome won, placed or finalist;
-- won, funded or won or placed.
LEFT JOIN LATERAL (
  SELECT count(DISTINCT a.program_id) FILTER (WHERE a.k >= 1)::int AS applied,
    count(DISTINCT a.program_id) FILTER (WHERE a.k >= 2)::int AS accepted,
    count(DISTINCT a.program_id) FILTER (WHERE a.k >= 3)::int AS won
  FROM (
    SELECT s.program_id, CASE s.status WHEN 'funded' THEN 3 WHEN 'accepted' THEN 2 ELSE 1 END AS k
    FROM builder_program_status s JOIN installations i ON i.id = s.installation_id
    WHERE (i.builder_id = p.builder_id OR (i.id = p.builder_id AND i.builder_id IS NULL)) AND s.status <> 'not_interested'
    UNION ALL
    SELECT x.program_id, COALESCE((SELECT max(CASE WHEN o.result IN ('won', 'placed') THEN 3 WHEN o.result = 'finalist' THEN 2 ELSE 1 END)
      FROM entry_outcomes o WHERE o.project_id = x.id), 1)
    FROM projects x JOIN installations i ON i.id = x.installation_id
    WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND x.program_id <> 'earnkit-coin') a) pg ON true;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'earnkit_ro') THEN GRANT SELECT ON owner_people TO earnkit_ro; END IF; END $$;

-- v3.1 Highlights competence (2026-10-25): the contracts a proven wallet (person_wallets) created itself, per chain
-- (wallet-chains.ts WALLET_CHAINS, read by discovery through alchemy.ts alchemyWalletContracts). counts: not a token
-- (decimals() and totalSupply() do not both answer) and used (another address sent it a transaction); Highlights
-- counts only those. A re-read upserts.
CREATE TABLE IF NOT EXISTS wallet_contracts (
  chain      text NOT NULL,
  address    text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  wallet     text NOT NULL CHECK (wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz,
  counts     boolean NOT NULL DEFAULT false,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, address)
);
CREATE INDEX IF NOT EXISTS wallet_contracts_wallet ON wallet_contracts (wallet);

-- v3.1 Used by (2026-10-27): the Builder Code strings written in an App-proven repo (builder-code.ts codesFromText: a
-- hex data-suffix literal decoded, or a codes: ['...'] array), kept with the daily scan; null for a check before this.
ALTER TABLE repo_builder_codes ADD COLUMN IF NOT EXISTS codes text[];
-- v3.1 Used by: how many people used what a builder built in the last 30 days, one row per builder, source and UTC day
-- (used-by.ts, the cron's daily step). contracts: distinct outside senders to the builder's counted contracts (Alchemy,
-- any WALLET_CHAINS chain); builder_code: distinct senders of transactions carrying the builder's Base Builder Code (the
-- CDP SQL API, one query a day for everyone). returning: those active in 2 or more ISO weeks; capped: a contract's read
-- stopped at its page cap (the title says "N+"); href: the proof link; chains: where the users were (the sub's label).
-- Highlights reads the newest day per source, at most 3 days old.
CREATE TABLE IF NOT EXISTS app_usage (
  builder_id integer NOT NULL,
  source     text NOT NULL CHECK (source IN ('contracts', 'builder_code')),
  day        date NOT NULL,
  users      integer NOT NULL CHECK (users >= 0),
  "returning" integer NOT NULL CHECK ("returning" >= 0),
  capped     boolean NOT NULL DEFAULT false,
  href       text,
  chains     text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (builder_id, source, day)
);

-- v3.1 Used by, security review (2026-10-27): a Builder Code counts for a builder only when Base's Builder Codes
-- registry (0x000000BC7E6457e610fe52Dcc0ca5b3ce59C8E80, payoutAddress(code)) pays one of their signature-proven
-- wallets (person_wallets); a code in repo text is only a candidate (anyone can paste a popular app's code). One row per
-- candidate: told (the builder named it through tell) or found by the repo scan; payout the registry's answer
-- (lowercase, null when unregistered); owned the verdict; verified_at the last registry read (at most daily). A failed
-- read keeps the previous verdict and never grants one.
CREATE TABLE IF NOT EXISTS builder_code_claims (
  code        text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,64}$'),
  builder_id  integer NOT NULL,
  told        boolean NOT NULL DEFAULT false,
  payout      text CHECK (payout ~ '^0x[0-9a-f]{40}$'),
  owned       boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, builder_id)
);

-- v4 (2026-10-28): one token per builder and per X account (builder-token.ts). The row is the launch claim:
-- 'declined' is the builder's no (kept forever), 'launching' the claim while tokens.fun mints, 'launched' the token,
-- 'unknown' an answer that might have minted (never retried; the owner settles it).
CREATE TABLE IF NOT EXISTS builder_tokens (
  builder_id   integer PRIMARY KEY,
  x_user_id    text NOT NULL UNIQUE,
  status       text NOT NULL CHECK (status IN ('declined', 'launching', 'launched', 'unknown')),
  name         text,
  symbol       text,
  wallet       text CHECK (wallet IS NULL OR wallet ~ '^0x[0-9a-f]{40}$'),
  coin_address text UNIQUE CHECK (coin_address IS NULL OR coin_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash      text,
  told_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
