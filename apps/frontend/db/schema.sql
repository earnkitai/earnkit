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
-- v2.9 A5: when an entry step last found the live link loading / a contract with code on the
-- program's needs_contract chain (NULL: not verified). entryMissing reads them (token-launch.ts).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS live_verified_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contract_verified_at timestamptz;
-- v2.9 A5: the chain whose mainnet must hold a deployed contract for the live link to count
-- (program file needs_contract; Arc Microgrants: 'arc'). NULL: none.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS needs_contract text;
