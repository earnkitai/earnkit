import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { install } from './fixtures/find';
import { ensureProfile } from './profiles';
import { bindX } from './x-install';
import { isoWeekOf } from './weeks';

/**
 * v3.1 owner tracker (owner ask 2026-10-23): owner_people's appended columns for jenil.ai /people (the one project, its
 * repo and site, the public score and rank, the streak, the coin, programs and reach).
 */
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const hex = (n: number) => randomBytes(n).toString('hex');
const DAY = 86_400_000;

const TRACKER_COLUMNS = [
  'x_name', 'x_avatar_url', 'main_project_key', 'project_name', 'main_repo', 'repo_private', 'site_url',
  'shipping_score', 'shipping_rank', 'rank_total', 'streak_weeks', 'commit_weeks_12', 'last_commit_week', 'last_approved_week',
  'last_activity_at', 'coin_symbol', 'coin_url', 'coin_address', 'coin_backers', 'creator_fees_eth',
  'programs_applied', 'programs_accepted', 'programs_won', 'checkin_on', 'email_opted_in',
];

test('schema: the tracker columns come after referred_installs in the one owner_people definition', () => {
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  const view = schema.slice(schema.indexOf('CREATE OR REPLACE VIEW owner_people'), schema.indexOf('GRANT SELECT ON owner_people'));
  let at = view.indexOf('AS referred_installs,');
  assert.ok(at > 0, 'referred_installs keeps its place');
  for (const c of TRACKER_COLUMNS.slice(3)) {
    const i = view.indexOf(`AS ${c}`);
    assert.ok(i > at, `${c} is appended in order`);
    at = i;
  }
});

test('owner_people: every tracker column, with the one project, repo, site, rank, streak, coin, programs and reach', db, async () => {
  const now = new Date();
  const id = await install();
  await ensureProfile(id, now);
  const handle = `ot_${hex(4)}`;
  assert.ok((await bindX(id, { id: `8${Date.now() % 1e9}${Math.floor(Math.random() * 1e6)}`, username: handle, name: 'Tracker Person', avatar: 'https://pbs.twimg.com/a.jpg' }, now)).ok);
  const repo = `ot-${hex(3)}/app`;
  await sql()`UPDATE builder_profiles SET main_project_key = ${repo},
    identity = jsonb_build_object('projects', jsonb_build_array(jsonb_build_object('name', 'Given Name', 'repo', ${`https://github.com/${repo}/`}::text))),
    standing_seen = standing_seen || '{"checkin":{"answer":"yes","at":"2026-10-20T00:00:00Z"}}'::jsonb
    WHERE builder_id = ${id}`;
  const lastWeek = (k: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ((now.getUTCDay() + 6) % 7) * DAY - 7 * k * DAY);
  const monday = (k: number) => lastWeek(k).toISOString().slice(0, 10);
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, commit_weeks)
    VALUES (${id}, ${repo}, 'app', 'app', true, true, ${[isoWeekOf(lastWeek(1)), isoWeekOf(lastWeek(2)), 'junk']})`;
  // Week 3 has checked commits (counts), week 4 is hidden (does not), week 5 is approved but has none.
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, hidden) VALUES
    (${id}, ${repo}, ${monday(3)}::date, '{"shipped_code":{"n":2}}'::jsonb, false),
    (${id}, ${repo}, ${monday(4)}::date, '{"shipped_code":{"n":2}}'::jsonb, true),
    (${id}, ${repo}, ${monday(5)}::date, '{"approved":true}'::jsonb, false),
    (${id}, ${repo}, ${monday(2)}::date, '{"approved":true,"approved_via":"auto"}'::jsonb, false)`;
  const [src] = await sql()<{ id: string }[]>`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
    VALUES (${id}, 'repo', ${`https://github.com/${repo}`}, ${repo}, 'github_app', 'verified', 'server') RETURNING id`;
  await sql()`INSERT INTO source_readings (source_id, day, signals, ok) VALUES (${src.id}, current_date - 1, '{"private":true}'::jsonb, true)`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by, verified_at) VALUES
    (${id}, 'site', 'https://dns.example', ${repo}, 'dns_txt', 'verified', 'server', now()),
    (${id}, 'site', 'https://app.example', ${repo}, 'earnkit_txt', 'verified', 'server', now() - interval '1 day')`;
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at)
    VALUES (${id}, 100, '{}'::jsonb, true, 1, 0, 'v2', 'v2-shipping', now())`;
  const coin = `0x${hex(20)}`;
  const [entry] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, coin_address)
    VALUES ('earnkit-coin', 'app', ${`https://github.com/${repo}`}, ${`github.com/${repo}`}, ${id}, 'OTK', 'launched', 'https://tokens.fun/t/otk', ${coin.toUpperCase().replace('0X', '0x')}) RETURNING id`;
  await sql()`INSERT INTO coin_backers (coin, wallet, first_block) VALUES (${coin}, ${`0x${hex(20)}`}, 1), (${coin}, ${`0x${hex(20)}`}, 2)`;
  await sql()`INSERT INTO creator_fees (tx_hash, log_index, coin, wallet, amount_wei, block_number, block_time)
    VALUES (${`0x${hex(32)}`}, 0, ${coin}, ${`0x${hex(20)}`}, 250000000000000000, 1, now())`;
  const prog = (k: string) => `ot-${k}-${hex(3)}`;
  const [applied, accepted, won] = [prog('a'), prog('b'), prog('c')];
  for (const p of [applied, accepted, won]) {
    await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
      VALUES (${p}, 'Org', 'T', 'D', 'https://x.example', 'https://x.example', 'R', 'S', 'active', 'allowed')`;
  }
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES
    (${id}, ${applied}, 'applied'), (${id}, ${accepted}, 'accepted'), (${id}, ${prog('n')}, 'not_interested')`;
  const [w] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id) VALUES (${won}, 'app', ${id}) RETURNING id`;
  await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis) VALUES (${w.id}, ${won}, 'r1', 'won', 'self_reported')`;
  await sql()`INSERT INTO digest_subscriptions (installation_id, email, opted_in_at) VALUES (${id}, 'a@b.example', now())`;
  await sql()`UPDATE installations SET last_seen_at = now() - interval '3 days' WHERE id = ${id}`;

  const [r] = await sql()<Record<string, unknown>[]>`SELECT * FROM owner_people WHERE builder_id = ${id}`;
  for (const c of TRACKER_COLUMNS) assert.ok(c in r, `has ${c}`);
  assert.equal(r.x_name, 'Tracker Person');
  assert.equal(r.main_project_key, repo);
  assert.equal(r.project_name, 'Given Name', 'the builder-given name wins over the row name');
  assert.equal(r.main_repo, repo);
  assert.equal(r.repo_private, true);
  assert.equal(r.site_url, 'https://app.example', 'a dns_txt site confirms nothing');
  assert.equal(r.shipping_score, 100);
  assert.equal(r.shipping_rank, 1);
  assert.ok((r.rank_total as number) >= 1);
  assert.equal(r.streak_weeks, 3, 'weeks 1 and 2 committed, week 3 checked; the hidden week 4 ends it');
  assert.equal(r.commit_weeks_12, 3);
  assert.equal(new Date(r.last_commit_week as Date).toISOString().slice(0, 10), monday(1));
  // v4.10.3 final fix (F7): EarnKit's automatic add (the newer week) is no builder approval.
  assert.equal(new Date(r.last_approved_week as Date).toISOString().slice(0, 10), monday(5));
  const seen = (await sql()<{ t: Date }[]>`SELECT last_seen_at AS t FROM installations WHERE id = ${id}`)[0].t;
  assert.equal((r.last_activity_at as Date).getTime(), Math.max(seen.getTime(), lastWeek(1).getTime(), lastWeek(4).getTime()));
  assert.deepEqual([r.coin_symbol, r.coin_url, r.coin_address, r.coin_backers], ['OTK', 'https://tokens.fun/t/otk', coin, 2]);
  assert.equal(Number(r.creator_fees_eth), 0.25);
  assert.deepEqual([r.programs_applied, r.programs_accepted, r.programs_won], [3, 2, 1], 'the coin program is no application');
  assert.deepEqual([r.checkin_on, r.email_opted_in], [true, true]);
  assert.ok(entry.id);

  // A profile with nothing: nulls and zeros, never an error.
  const bare = await install();
  await ensureProfile(bare, now);
  const [b] = await sql()<Record<string, unknown>[]>`SELECT * FROM owner_people WHERE builder_id = ${bare}`;
  assert.deepEqual(
    [b.project_name, b.main_repo, b.repo_private, b.site_url, b.shipping_score, b.shipping_rank, b.streak_weeks, b.commit_weeks_12, b.coin_symbol, b.coin_backers, b.creator_fees_eth, b.programs_applied, b.checkin_on, b.email_opted_in],
    [null, null, null, null, null, null, 0, 0, null, 0, null, 0, false, false],
  );
});
