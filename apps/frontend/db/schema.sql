-- EarnKit v1 schema. Idempotent: safe to run on every deploy (`pnpm db:migrate`).

CREATE TABLE IF NOT EXISTS programs (
  id                      text PRIMARY KEY,           -- slug, e.g. "base-batches-002"
  organizer               text NOT NULL,
  title                   text NOT NULL,
  description             text NOT NULL,
  source_url              text NOT NULL,
  submission_url          text NOT NULL,
  reward                  text NOT NULL,
  starts_at               timestamptz,
  ends_at                 timestamptz NOT NULL,
  status                  text NOT NULL CHECK (status IN ('active', 'closed')),
  rules                   text[] NOT NULL DEFAULT '{}',
  submission_requirements jsonb NOT NULL DEFAULT '[]'
);

-- Rolling programs (no deadline) have ends_at NULL.
ALTER TABLE programs ALTER COLUMN ends_at DROP NOT NULL;

-- Added after v1 launch: what decides fit, and whether already-built projects can be submitted.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS key_requirement text NOT NULL DEFAULT '';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS existing_work text NOT NULL DEFAULT 'unknown'
  CHECK (existing_work IN ('allowed', 'new_work_only', 'unknown'));

-- When the program's facts were last checked against official sources.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS verified_at date;

-- The steps only the builder can do (GitHub, hosting, wallet, logins, videos, personal info).
ALTER TABLE programs ADD COLUMN IF NOT EXISTS builder_steps jsonb NOT NULL DEFAULT '[]';

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
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id           serial PRIMARY KEY,
  program_id   text NOT NULL REFERENCES programs(id),
  name         text NOT NULL,
  description  text,
  repo_url     text,
  live_url     text,
  demo_url     text,
  token_url    text,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id                      serial PRIMARY KEY,
  project_id              integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  submission_data         jsonb NOT NULL,
  external_submission_url text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
