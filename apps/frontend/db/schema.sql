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
ALTER TABLE programs DROP COLUMN IF EXISTS verified_at;
ALTER TABLE programs DROP COLUMN IF EXISTS builder_steps;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE installations ADD COLUMN IF NOT EXISTS programs_checked_at timestamptz;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS campaign jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS payout_wallet text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contracts text[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS score integer;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS scored_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prize_tx text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS prize_paid_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_image bytea;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS token_image_type text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS installation_id integer REFERENCES installations(id);
