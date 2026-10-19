import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { EVENT_TYPES } from './events';
import { isReserved } from './reserved-routes';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const NEW_TYPES = ['shipped_code', 'went_live', 'users_up', 'update_posted', 'update_hidden', 'raising_on', 'raising_off'];

test('1.7 the new event types are listed in events.ts and in every builder_events_type_check', () => {
  for (const t of NEW_TYPES) assert.ok((EVENT_TYPES as readonly string[]).includes(t), t);
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  const adds = [...schema.matchAll(/ADD CONSTRAINT builder_events_type_check\s+CHECK \(([\s\S]*?)\)\);/g)];
  assert.ok(adds.length >= 2);
  for (const [, body] of adds) for (const t of NEW_TYPES) assert.ok(body.includes(`'${t}'`), `${t} in every re-add`);
});

test('1.8 /bench and /feed are reserved (no handle takes them)', () => {
  assert.equal(isReserved('bench'), true);
  assert.equal(isReserved('Feed'), true);
});

test('1.9 the v2.13 columns and project_updates exist; one row per project and week; week is a Monday; 280 characters', dbTest, async () => {
  const cols = async (t: string) => (await sql()<{ c: string }[]>`SELECT column_name AS c FROM information_schema.columns WHERE table_name = ${t}`).map((r) => r.c);
  for (const c of ['main_project_key', 'updates_on_at', 'updates_scheduled_at']) assert.ok((await cols('builder_profiles')).includes(c), c);
  for (const c of ['chains', 'streak', 'weeks_shipping', 'ship_weeks', 'commit_weeks']) assert.ok((await cols('builder_projects')).includes(c), c);
  for (const c of ['raising_at', 'coin_tx', 'coin_chain_id']) assert.ok((await cols('projects')).includes(c), c);
  for (const c of ['id', 'builder_id', 'project_key', 'week', 'text', 'facts', 'points', 'pinned', 'hidden', 'feed_hidden', 'created_at', 'edited_at'])
    assert.ok((await cols('project_updates')).includes(c), c);
  const key = `t1/${process.pid}-${Date.now()}`;
  await sql().begin(async (tx) => {
    await tx`INSERT INTO project_updates (builder_id, project_key, week, text) VALUES (1, ${key}, '2026-10-12', 'shipped')`;
    await assert.rejects(tx.savepoint((s) => s`INSERT INTO project_updates (builder_id, project_key, week) VALUES (1, ${key}, '2026-10-12')`), /duplicate|unique/i);
    throw new Error('rollback');
  }).catch((e: Error) => assert.equal(e.message, 'rollback'));
  await assert.rejects(sql()`INSERT INTO project_updates (builder_id, project_key, week) VALUES (1, ${key}, '2026-10-13')`, /check/i);
  await assert.rejects(sql()`INSERT INTO project_updates (builder_id, project_key, week, text) VALUES (1, ${key}, '2026-10-12', ${'x'.repeat(281)})`, /check/i);
  await sql().begin(async (tx) => {
    await tx`INSERT INTO coin_moments (builder_id, project_key, moment) VALUES (2100990000, ${key}, 'streak_five')`;
    throw new Error('rollback');
  }).catch((e: Error) => assert.equal(e.message, 'rollback'));
});
