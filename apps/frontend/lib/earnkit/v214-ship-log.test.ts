import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub, type FakeCommit } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { feedWeeks } from './feed';
import { profileData } from './bench-data';
import { weeklyFactsStep } from './week-facts';
import { weekOfMonday } from './weeks';
import { attachToX } from './x-install';
import { UPDATE_LINES } from './updates';

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const MONDAY_RUN = new Date('2026-10-19T15:30:00Z'); // the step's Monday; it writes the week of 2026-10-12
const WEEK = '2026-10-12';
const commits = (): FakeCommit[] => [
  { sha: 'a', message: 'feat: add the shopping list', date: '2026-10-13T09:00:00Z', login: 'maya' },
  { sha: 'b', message: 'Bump deps', date: '2026-10-14T09:00:00Z', login: 'dependabot[bot]', type: 'Bot' },
  { sha: 'c', message: "Merge branch 'main'", date: '2026-10-15T09:00:00Z', login: 'maya', parents: 2 },
  { sha: 'd', message: 'Fix the timer', date: '2026-10-16T09:00:00Z', login: 'maya' },
  { sha: 'e', message: 'v1.2.3', date: '2026-10-17T09:00:00Z', login: 'maya' },
  { sha: 'f', message: 'Old work', date: '2026-10-05T09:00:00Z', login: 'maya' },
];

let nextX = 0;
/**
 * An App-proven person. Fix round 1: each gets its own X id (a counter); `shipped` (default) gives the week a
 * shipped_code fact (a good live reading with the week's commit count), since titles are read only for such a week.
 */
async function provenPerson(handle: string, key: string, priv: boolean, extra: FakeCommit[] = [], o: { shipped?: boolean } = {}) {
  const t = `ek_log_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `96${RUN}${++nextX}`, username: `${handle}${RUN}`.slice(0, 15), name: handle, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false };
  await mcpCall(ctx, 'find', { identity: { project: { name: key.split('/')[1], repo: `https://github.com/${key}` } } });
  const gh = fakeGitHub({ [key]: { id: Number(`7${RUN}`) + handle.length, owner: `${handle}${RUN}`, installation: 90 + handle.length, private: priv, commits: [...commits(), ...extra], pulls: [] } });
  await installApp({ builderId: c.id, repoKey: key, login: `${handle}${RUN}`, gh });
  // The App connect already read the repo (R5); the week's count is set here either way (none: not shipped).
  await sql()`INSERT INTO source_live (source_id, signals, ok, read_at)
      SELECT id, ${sql().json({ commit_counts: o.shipped !== false ? { [weekOfMonday(WEEK)!]: 5 } : {}, private: priv } as never)}, true, now() FROM builder_sources
      WHERE builder_id = ${c.id} AND kind = 'repo' AND lower(ref) LIKE ${`%${key.toLowerCase()}`}
      ON CONFLICT (source_id) DO UPDATE SET signals = EXCLUDED.signals, ok = true, read_at = EXCLUDED.read_at`;
  return { id: c.id, ctx, gh };
}
const row = async (id: number) =>
  (await sql()<{ titles: string[]; facts: Record<string, unknown>; text: string | null }[]>`SELECT titles, facts, text FROM project_updates WHERE builder_id = ${id} AND week = ${WEEK}`)[0];

test('8.5 Monday: a public App-proven repo gets the week\'s titles, cleaned, with no yes and no agent', db, async () => {
  const p = await provenPerson('maya', `maya${RUN}/recipes`, false);
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  assert.deepEqual((await row(p.id)).titles, ['Fix the timer', 'Add the shopping list']);
});

test('8.6 a private repo is facts only, and its commits are not even read, until titles are on', db, async () => {
  const p = await provenPerson('nell', `nell${RUN}/secret`, true);
  p.gh.calls.length = 0;
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  assert.deepEqual((await row(p.id)).titles, []);
  assert.equal(p.gh.calls.filter((c) => /\/commits|\/pulls/.test(c.path)).length, 0);
  const on = await mcpCall(p.ctx, 'tell', { updates: { titles: true } });
  assert.match(String(on.reply?.show_to_builder), /titles/i);
  await sql()`DELETE FROM project_updates WHERE builder_id = ${p.id} AND week = ${WEEK}`;
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  assert.deepEqual((await row(p.id)).titles, ['Fix the timer', 'Add the shopping list']);
});

test('8.7 the agent\'s line is an addition (the filter applies); hide still hides; updates { on } is answered', db, async () => {
  const p = await provenPerson('owen', `owen${RUN}/tool`, false);
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  const bad = await mcpCall(p.ctx, 'tell', { update: { text: 'See https://evil.example' } });
  assert.match(String(bad.reply?.agent_note), /Links are allowed only/);
  const old = await mcpCall(p.ctx, 'tell', { updates: { on: true } });
  assert.match(String(old.reply?.show_to_builder), /writes itself every Monday/);
  assert.equal(old.reply?.schedule_weekly_update, undefined);
});

test('8.8 a project without the App gets no titles (facts only, as before)', db, async () => {
  const t = `ek_noapp_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  await attachToX(own, { id: `97${RUN}1`, username: `pia${RUN}`.slice(0, 15), name: 'Pia', avatar: null }, new Date());
  const gh = fakeGitHub({});
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [own], ghFetch: gh });
  assert.equal(gh.calls.length, 0);
});

/** On the feed: ranked and listed, the week's row given points (rankFeed's job, daily). */
async function onFeed(id: number) {
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at)
    VALUES (${id}, 50, '{}'::jsonb, true, 1, 0, 'v2', 'v2-launch', now()) ON CONFLICT (builder_id) DO UPDATE SET ranked = true`;
  await sql()`UPDATE project_updates SET points = 10 WHERE builder_id = ${id} AND week = ${WEEK}`;
}
const feedTitles = async (id: number) => (await feedWeeks(MONDAY_RUN, { only: [id] })).flatMap((w) => w.cards).find((c) => c.week === WEEK)?.titles;
const profileTitles = async (id: number) => (await profileData(id, MONDAY_RUN, { only: [id] }))?.log.find((c) => c.week === WEEK)?.titles;

test('8.9 S9: a private repo\'s titles show while titles are on (never one naming the repo); off hides stored ones at once, nothing deleted', db, async () => {
  const key = `rosa${RUN}/hushproj`;
  const p = await provenPerson('rosa', key, true, [{ sha: 'h', message: 'Ship hushproj dark mode', date: '2026-10-16T10:00:00Z', login: 'rosa' }]);
  await mcpCall(p.ctx, 'tell', { updates: { titles: true } });
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  assert.deepEqual((await row(p.id)).titles, ['Ship hushproj dark mode', 'Fix the timer', 'Add the shopping list'], 'stored as read');
  await onFeed(p.id);
  assert.deepEqual(await feedTitles(p.id), ['Fix the timer', 'Add the shopping list'], 'the feed never names the private repo');
  assert.deepEqual(await profileTitles(p.id), ['Fix the timer', 'Add the shopping list'], 'nor the profile');
  const cards = JSON.stringify([await feedWeeks(MONDAY_RUN, { only: [p.id] }), await profileData(p.id, MONDAY_RUN, { only: [p.id] })]);
  assert.ok(!/hushproj/i.test(cards), 'no card names it');
  const off = await mcpCall(p.ctx, 'tell', { updates: { titles: false } });
  assert.match(String(off.reply?.show_to_builder), /only the facts/);
  assert.deepEqual(await feedTitles(p.id), [], 'off: hidden from the feed');
  assert.deepEqual((await profileTitles(p.id)) ?? [], [], 'off: hidden from the profile');
  assert.equal((await row(p.id)).titles.length, 3, 'nothing deleted');
});

test('8.10 S9: a public repo\'s titles always show, titles on or not', db, async () => {
  const p = await provenPerson('pete', `pete${RUN}/garden`, false);
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  await onFeed(p.id);
  assert.deepEqual(await feedTitles(p.id), ['Fix the timer', 'Add the shopping list']);
  assert.deepEqual(await profileTitles(p.id), ['Fix the timer', 'Add the shopping list']);
  await mcpCall(p.ctx, 'tell', { updates: { titles: false } });
  assert.deepEqual(await feedTitles(p.id), ['Fix the timer', 'Add the shopping list']);
});

const facts = async (id: number) => (await row(id))?.facts ?? null;

test('8.13 fix round 1: a week with no shipped code reads no titles (facts still written)', db, async () => {
  const p = await provenPerson('quin', `quin${RUN}/quiet`, false, [], { shipped: false });
  p.gh.calls.length = 0;
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  assert.equal((await facts(p.id))?.checked, true);
  assert.deepEqual((await row(p.id)).titles, []);
  assert.equal(p.gh.calls.length, 0, 'not one GitHub call');
});

test('8.14 fix round 1: an error in the title block never stops the week\'s facts', db, async () => {
  const key = `tara${RUN}/boom`;
  const p = await provenPerson('tara', key, false);
  // A fetch that throws outright (not a rejected promise) on the week's commits.
  const boom = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/commits')) throw new Error('boom');
    return p.gh(input, init);
  }) as typeof fetch;
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: boom });
  const r = await row(p.id);
  assert.equal(r.facts.checked, true);
  assert.deepEqual(r.facts.shipped_code, { n: 5 });
  assert.deepEqual(r.titles, []);
});

test('8.15 fix round 1: a public repo not read public lately is checked with one GET /repos through the App client, then read', db, async () => {
  const key = `uma${RUN}/sunny`;
  const p = await provenPerson('uma', key, false);
  // No public evidence: no public_at, and the newest reading says nothing about privacy.
  await sql()`UPDATE builder_sources SET public_at = NULL WHERE builder_id = ${p.id} AND kind = 'repo'`;
  await sql()`UPDATE source_live l SET signals = l.signals - 'private' FROM builder_sources s WHERE s.id = l.source_id AND s.builder_id = ${p.id}`;
  p.gh.calls.length = 0;
  await weeklyFactsStep(MONDAY_RUN, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  assert.equal(p.gh.calls.filter((c) => c.path === `/repos/${key.toLowerCase()}`).length, 1, 'one visibility call');
  assert.ok(p.gh.calls.filter((c) => c.path === `/repos/${key.toLowerCase()}`).every((c) => /ghs_fake_/.test(c.auth ?? '')), 'with the installation token');
  assert.deepEqual((await row(p.id)).titles, ['Fix the timer', 'Add the shopping list']);
  const [s] = await sql()<{ at: Date | null }[]>`SELECT public_at AS at FROM builder_sources WHERE builder_id = ${p.id} AND kind = 'repo'`;
  assert.ok(s.at, 'public_at stamped');
});

test('8.16 fix round 1: titles on with no App-proven repo is the not-counted note, never "Done"', db, async () => {
  const t = `ek_noapp2_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  await attachToX(own, { id: `98${RUN}${++nextX}`, username: `vic${RUN}`.slice(0, 15), name: 'Vic', avatar: null }, new Date());
  const c = (await connectInstallation(t))!;
  const r = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: false }, 'tell', { updates: { titles: true } });
  assert.equal(r.reply?.show_to_builder, '');
  assert.match(String(r.reply?.agent_note), /isn't counted yet/);
  const [p] = await sql()<{ at: Date | null }[]>`SELECT ship_titles_at AS at FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.equal(p?.at ?? null, null);
});

test('8.17 fix round 1: a yes to a pre-v2.14 stored updates or post_update ask gets the ship log line and clears the ask', db, async () => {
  const p = await provenPerson('wes', `wes${RUN}/old`, false);
  for (const kind of ['updates', 'post_update']) {
    const key = `wes${RUN}/old`;
    await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json({ kind, key } as never)}::jsonb) WHERE builder_id = ${p.id}`;
    const r = await mcpCall(p.ctx, 'tell', { move_up: { kind, project_key: key, answer: 'yes' } });
    assert.equal(r.reply?.show_to_builder, UPDATE_LINES.auto, kind);
    const [s] = await sql()<{ ask: unknown }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${p.id}`;
    assert.equal(s.ask, null, `${kind}: cleared`);
  }
});

test('8.18 T9: titles on needs the main project\'s own repo App-proven, not any App-proven repo', db, async () => {
  const p = await provenPerson('xan', `xan${RUN}/proven`, false);
  await sql()`UPDATE builder_profiles SET main_project_key = ${`xan${RUN}/other`} WHERE builder_id = ${p.id}`;
  const r = await mcpCall(p.ctx, 'tell', { updates: { titles: true } });
  assert.equal(r.reply?.show_to_builder, '');
  assert.match(String(r.reply?.agent_note), /isn't counted yet/);
  await sql()`UPDATE builder_profiles SET main_project_key = ${`xan${RUN}/proven`} WHERE builder_id = ${p.id}`;
  assert.equal((await mcpCall(p.ctx, 'tell', { updates: { titles: true } })).reply?.show_to_builder, UPDATE_LINES.titlesOn);
});
