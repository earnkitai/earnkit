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
import { attachToX } from './x-install';

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

async function provenPerson(handle: string, key: string, priv: boolean, extra: FakeCommit[] = []) {
  const t = `ek_log_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `96${RUN}${handle.length}${handle.charCodeAt(0)}`, username: `${handle}${RUN}`.slice(0, 15), name: handle, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false };
  await mcpCall(ctx, 'find', { identity: { project: { name: key.split('/')[1], repo: `https://github.com/${key}` } } });
  const gh = fakeGitHub({ [key]: { id: Number(`7${RUN}`) + handle.length, owner: `${handle}${RUN}`, installation: 90 + handle.length, private: priv, commits: [...commits(), ...extra], pulls: [] } });
  await installApp({ builderId: c.id, repoKey: key, login: `${handle}${RUN}`, gh });
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
  const key = `rosa${RUN}/hushproj`; // a handle whose X id (length, first letter) no other test shares
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
  // A week with nothing else to show (no checked facts here) has no card at all once its titles are hidden.
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
