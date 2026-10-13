import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { EVENT_TYPES } from './events';
import { archiveFlag, builderScoreEnabled } from './builder-score-flag';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const V212_EVENTS = ['source_proposed', 'source_verified', 'source_rejected', 'reading_taken', 'score_computed', 'score_held',
  'profile_empty', 'profile_hidden', 'profile_shown', 'card_offered', 'x_added', 'card_shared', 'score_viewed', 'x_cleared'];
// A fresh person key per run: builder_scores is append-only and builder_profiles keys on it, so a
// fixed key would make every later run of this file fail (below every other v2.12 test's range).
const freshId = () => 2_000_000_000 + Math.floor(Math.random() * 90_000_000);

test('1.1 the flags are off unless exactly "on"', () => {
  assert.equal(builderScoreEnabled({}), false);
  assert.equal(builderScoreEnabled({ EARNKIT_BUILDER_SCORE: 'true' }), false);
  assert.equal(builderScoreEnabled({ EARNKIT_BUILDER_SCORE: 'on' }), true);
  assert.equal(archiveFlag('SPONSOR_CAMPAIGNS', {}), false);
  assert.equal(archiveFlag('TOOL_ALIASES', { EARNKIT_TOOL_ALIASES: 'on' }), true);
});

test('1.2 events.ts lists every v2.12 event type, after the v2.11 ones', () => {
  assert.deepEqual(EVENT_TYPES.slice(8, 8 + V212_EVENTS.length), V212_EVENTS);
});

test('1.3 the CHECK accepts every v2.12 type and still refuses an unknown one', dbTest, async () => {
  const tag = `v212-${process.pid}-${Date.now()}`;
  for (const type of V212_EVENTS)
    await sql()`INSERT INTO builder_events (type, dedupe_key) VALUES (${type}, ${`${tag}:${type}`})`;
  await assert.rejects(sql()`INSERT INTO builder_events (type, dedupe_key) VALUES ('nope', ${`${tag}:nope`})`, /check constraint/);
});

test('1.4 source_readings and builder_scores are append-only', dbTest, async () => {
  const id = freshId();
  const [s] = await sql()<{ id: string }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by)
    VALUES (${id}, 'site', ${`https://t${Date.now()}.example`}, 'p', 'server') RETURNING id`;
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${s.id}, '2026-10-12', '{}', true)`;
  await assert.rejects(sql()`UPDATE source_readings SET ok = false WHERE source_id = ${s.id}`, /append-only/);
  await assert.rejects(sql()`DELETE FROM source_readings WHERE source_id = ${s.id}`, /append-only/);
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, '2026-10-12', 10, 0, '{}', '{}', 'v1', 'v1-launch', false)`;
  await assert.rejects(sql()`UPDATE builder_scores SET score = 99 WHERE builder_id = ${id}`, /append-only/);
  await assert.rejects(sql()`DELETE FROM builder_scores WHERE builder_id = ${id}`, /append-only/);
  await assert.rejects(
    sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
      VALUES (${id}, '2026-10-12', 11, 0, '{}', '{}', 'v1', 'v1-launch', false)`,
    /duplicate key/,
  );
});

test('1.5 builder_sources: one row per (person, kind, ref); kind, proof and state are enums', dbTest, async () => {
  const id = freshId();
  const ref = `owner/r${Date.now()}`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'repo', ${ref}, ${ref}, 'agent')`;
  await assert.rejects(sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'repo', ${ref}, ${ref}, 'agent')`, /duplicate key/);
  await assert.rejects(sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by) VALUES (${id}, 'stripe', 'x', 'x', 'agent')`, /check constraint/);
  await assert.rejects(sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, proof) VALUES (${id}, 'site', 'y', 'y', 'agent', 'vibes')`, /check constraint/);
});

test('1.6 builder_profiles: x_handle and slug shapes, slug unique; programs.agent_completable defaults true', dbTest, async () => {
  const [a, b, c] = [freshId(), freshId(), freshId()];
  const slug = `t${Date.now()}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${a}, ${slug})`;
  await assert.rejects(sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${b}, ${slug})`, /duplicate key/);
  await assert.rejects(sql()`UPDATE builder_profiles SET x_handle = 'has space' WHERE builder_id = ${a}`, /check constraint/);
  await assert.rejects(sql()`INSERT INTO builder_profiles (builder_id, slug) VALUES (${c}, 'Upper')`, /check constraint/);
  const [col] = await sql()<{ d: string }[]>`
    SELECT column_default AS d FROM information_schema.columns WHERE table_name = 'programs' AND column_name = 'agent_completable'`;
  assert.equal(col.d, 'true');
});
