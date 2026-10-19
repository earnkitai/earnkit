import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { EVENT_LOG_FLAG } from './events';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub, type FakeCommit, type FakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { logCards } from './bench-data';
import { BACKFILL_PER_RUN, BACKFILL_TRIES_A_DAY, backfillMondays, backfillOnConnect, backfillStep, weeklyFactsStep } from './week-facts';
import { setShipTitles } from './updates';
import { attachToX } from './x-install';

/**
 * Scoring and clarity R13: the ship log's last 3 finished weeks are written at the first App connect from the
 * repo's commits, in the weekly job's format (week-facts.ts writeWeek); the hourly catch-up (backfillStep)
 * finishes what the connect's budget left. Dates are relative to the real now (the connect reads at now).
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env[EVENT_LOG_FLAG] = 'on';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
/** The three backfilled Mondays, newest first (lastFinishedMonday first). */
const MONDAYS = backfillMondays(new Date());
/** A cron time in this same week that is never before the weekly job's Monday slot (so all 3 weeks are the catch-up's). */
const cronNow = () => {
  const d = new Date();
  if (d.getUTCDay() === 1 && d.getUTCHours() < 15) d.setUTCHours(16);
  return d;
};
/** A commit on `monday` + `day` days at noon UTC. */
const on = (monday: string, day: number, sha: string, message: string): FakeCommit =>
  ({ sha, message, date: new Date(Date.parse(`${monday}T12:00:00Z`) + day * DAY).toISOString(), login: 'maya' });

let nextX = 0;
/** A signed-in person whose agent named `key` (find), then the App installed on it (appProof, proveByApp). */
async function connect(handle: string, key: string, repo: Partial<FakeGitHub['repos'][string]> & { commits: FakeCommit[] }, gh?: (base: FakeGitHub) => FakeGitHub) {
  const t = `ek_bf_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `97${RUN}${++nextX}`, username: `${handle}${RUN}`.slice(0, 15), name: handle, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false };
  await mcpCall(ctx, 'find', { identity: { project: { name: key.split('/')[1], repo: `https://github.com/${key}` } } });
  const base = fakeGitHub({ [key]: { id: Number(`8${RUN}${nextX}`), owner: `${handle}${RUN}`, installation: 300 + nextX, pulls: [], ...repo } });
  const f = gh ? gh(base) : base;
  const proof = await installApp({ builderId: c.id, repoKey: key, login: `${handle}${RUN}`, gh: f });
  assert.equal((proof as { ok?: boolean }).ok, true, JSON.stringify(proof));
  return { id: c.id, key, gh: base, f };
}
type Row = { week: string; facts: Record<string, unknown>; titles: string[] };
const rows = async (id: number) => (await sql()<Row[]>`
  SELECT week::text AS week, facts, titles FROM project_updates WHERE builder_id = ${id} AND week IN ${sql()(MONDAYS)} ORDER BY week DESC`);
const events = async (key: string) => (await sql()<{ n: number }[]>`
  SELECT count(*)::int AS n FROM builder_events WHERE type = 'shipped_code' AND repo_key = ${key.toLowerCase()}`)[0].n;
const titleCalls = (gh: FakeGitHub) => gh.calls.filter((c) => /\/commits\?|\/pulls\?/.test(c.path)).length;

test('B1 connect with commits in each of the last 3 finished weeks: 3 rows, facts and titles, in the weekly job\'s format; run twice, nothing doubles', db, async () => {
  const key = `maya${RUN}/recipes`;
  const commits = [
    on(MONDAYS[2], 1, 'a', 'feat: add the shopping list'), on(MONDAYS[2], 2, 'b', 'Fix the oven timer'),
    on(MONDAYS[1], 2, 'c', 'Add dark mode'),
    on(MONDAYS[0], 1, 'd', 'Ship the share card'), on(MONDAYS[0], 3, 'e', 'v1.2.3'),
  ];
  const p = await connect('maya', key, { private: false, commits });
  const got = await rows(p.id);
  assert.deepEqual(got.map((r) => r.week), MONDAYS);
  assert.deepEqual(got.map((r) => (r.facts.shipped_code as { n: number } | undefined)?.n), [2, 1, 2]);
  assert.ok(got.every((r) => r.facts.checked === true && r.facts.titles_read === true), JSON.stringify(got));
  assert.deepEqual(got.map((r) => r.titles), [['Ship the share card'], ['Add dark mode'], ['Fix the oven timer', 'Add the shopping list']]);
  // The streak chip on the newest week: 3 weeks in a row.
  assert.deepEqual(got[0].facts.streak, { w: 3 });
  assert.equal(await events(key), 3);
  // The card the ship log shows, the weekly job's chips.
  assert.deepEqual(logCards(got.map((r) => ({ ...r, text: null })), 'Recipes')[0].chips, ['2 commits', '3 weeks in a row']);

  // Exactly the weekly job's row for the newest week (only the backfill's titles_read marker added).
  const kept = got[0];
  await sql()`DELETE FROM project_updates WHERE builder_id = ${p.id} AND week = ${MONDAYS[0]}`;
  const monday15 = new Date(Date.parse(`${MONDAYS[0]}T15:30:00Z`) + 7 * DAY);
  await weeklyFactsStep(monday15, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  const weekly = (await rows(p.id))[0];
  assert.deepEqual({ ...kept.facts, titles_read: undefined }, { ...weekly.facts, titles_read: undefined });
  assert.deepEqual(kept.titles, weekly.titles);

  // Re-running: a second connect (a re-prove: not the first proof, no backfill), the backfill and the catch-up.
  const before = p.gh.calls.length;
  const again = await installApp({ builderId: p.id, repoKey: key, login: `maya${RUN}`, gh: p.gh });
  assert.equal((again as { ok?: boolean }).ok, true);
  assert.equal(titleCalls({ ...p.gh, calls: p.gh.calls.slice(before) } as FakeGitHub), 0, 'a re-prove reads no titles');
  await backfillOnConnect(p.id, key, new Date(), { deadline: Date.now() + 8_000, ghFetch: p.gh });
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 0, rows: 0 });
  const after2 = await rows(p.id);
  assert.equal(after2.length, 3);
  assert.deepEqual(after2.map((r) => r.titles), [['Ship the share card'], ['Add dark mode'], ['Fix the oven timer', 'Add the shopping list']]);
  assert.equal(await events(key), 3, 'no event twice');
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM project_updates WHERE lower(project_key) = ${key} AND week IN ${sql()(MONDAYS)}`;
  assert.equal(n, 3);
});

test('B2 a finished week without commits gets no entry (the Started card stays)', db, async () => {
  const key = `nell${RUN}/gaps`;
  const p = await connect('nell', key, { private: false, commits: [on(MONDAYS[0], 1, 'a', 'Add search'), on(MONDAYS[2], 1, 'b', 'Add login')] });
  const got = await rows(p.id);
  const gap = got.find((r) => r.week === MONDAYS[1]);
  assert.equal(gap?.facts.shipped_code, undefined, 'no commits, no shipped code');
  assert.deepEqual(gap?.titles, []);
  const cards = logCards(got.map((r) => ({ ...r, text: null })), 'Gaps');
  assert.deepEqual(cards.map((c) => c.week), [MONDAYS[0], MONDAYS[2]]);
  // The Started row (this week) is still there.
  const [started] = await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${p.id} AND facts ? 'started'`;
  assert.ok(started);
  // The catch-up has nothing to do for it.
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 0, rows: 0 });
});

test('B3 a private repo is facts only: no titles read, and the catch-up never comes back for them', db, async () => {
  const key = `owen${RUN}/secret`;
  const p = await connect('owen', key, { private: true, commits: [on(MONDAYS[0], 1, 'a', 'Add billing'), on(MONDAYS[1], 1, 'b', 'Add plans')] });
  const got = await rows(p.id);
  assert.deepEqual(got.filter((r) => r.facts.shipped_code).map((r) => r.week), [MONDAYS[0], MONDAYS[1]]);
  assert.ok(got.every((r) => r.titles.length === 0));
  assert.equal(titleCalls(p.gh), 0, 'the private repo\'s commits and PRs were never read for titles');
  assert.ok(got.filter((r) => r.facts.shipped_code).every((r) => r.facts.titles_read === true));
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 0, rows: 0 });
});

test('B4 a budget-starved connect: titles cut, or no time left at all; the hourly catch-up fills the rest, once', db, async () => {
  // Titles fail at connect (the commits and PRs calls error): the facts are written, the titles wait.
  const key = `pia${RUN}/cut`;
  const commits = [on(MONDAYS[0], 1, 'a', 'Add export'), on(MONDAYS[1], 1, 'b', 'Add import'), on(MONDAYS[2], 1, 'c', 'Add sync')];
  let cut = true;
  const p = await connect('pia', key, { private: false, commits }, (base) => Object.assign((async (input: RequestInfo | URL, init?: RequestInit) =>
    cut && /\/(commits|pulls)\?/.test(String(input)) ? new Response('{}', { status: 502 }) : base(input, init)) as typeof fetch, { calls: base.calls, repos: base.repos }));
  let got = await rows(p.id);
  assert.equal(got.filter((r) => r.facts.shipped_code).length, 3);
  assert.ok(got.every((r) => r.titles.length === 0 && r.facts.titles_read === undefined), JSON.stringify(got));
  cut = false;
  const cron = await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.f });
  assert.deepEqual(cron, { people: 1, rows: 3 });
  got = await rows(p.id);
  assert.deepEqual(got.map((r) => r.titles), [['Add export'], ['Add import'], ['Add sync']]);
  assert.equal(await events(key), 3);
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.f }), { people: 0, rows: 0 });

  // No budget left at all: nothing is written at connect; the catch-up writes all 3 weeks.
  const key2 = `quin${RUN}/late`;
  const q = await connect('quin', key2, { private: false, commits: commits.map((c) => ({ ...c, sha: `q${c.sha}` })) });
  // As if the connect had had no time left for it (its rows removed; events are append-only and deduped).
  await sql()`DELETE FROM project_updates WHERE builder_id = ${q.id} AND week IN ${sql()(MONDAYS)}`;
  assert.deepEqual(await backfillOnConnect(q.id, key2, new Date(), { deadline: Date.now(), ghFetch: q.gh }), { rows: 0, done: false });
  assert.equal((await rows(q.id)).length, 0);
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [q.id], ghFetch: q.gh }), { people: 1, rows: 3 });
  assert.equal((await rows(q.id)).filter((r) => r.facts.shipped_code && r.titles.length === 1).length, 3);
  assert.equal(await events(key2), 3, 'the dedupe keys keep one event a week');
});

test('B5 anti-backdating: no entry for a week before the repo existed; an unverified reading writes nothing until a read verifies it', db, async () => {
  // Created in the middle week: the oldest week's commits are backdated.
  const key = `rhea${RUN}/young`;
  const p = await connect('rhea', key, {
    private: false, created: `${MONDAYS[1]}T08:00:00Z`,
    commits: [on(MONDAYS[2], 1, 'a', 'Old work'), on(MONDAYS[1], 1, 'b', 'Start'), on(MONDAYS[0], 1, 'c', 'More')],
  });
  const got = await rows(p.id);
  assert.deepEqual(got.filter((r) => r.facts.shipped_code).map((r) => r.week), [MONDAYS[0], MONDAYS[1]]);
  assert.equal(got.find((r) => r.week === MONDAYS[2])?.facts.shipped_code, undefined);

  // The push check fails at connect: the reading is unverified, so no week is written (and the catch-up waits).
  const key2 = `sami${RUN}/unchecked`;
  const q = await connect('sami', key2, { private: false, pushes: null, commits: [on(MONDAYS[0], 1, 'a', 'Add a'), on(MONDAYS[1], 1, 'b', 'Add b')] });
  assert.equal((await rows(q.id)).length, 0);
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [q.id], ghFetch: q.gh }), { people: 0, rows: 0 });
  // A later read verifies it (GitHub's push record answers): the catch-up writes the weeks.
  await sql()`UPDATE source_live SET signals = signals || '{"pushes_checked": true}'::jsonb
    WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${q.id} AND kind = 'repo')`;
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [q.id], ghFetch: q.gh }), { people: 1, rows: 3 });
  assert.deepEqual((await rows(q.id)).filter((r) => r.facts.shipped_code).map((r) => r.week), [MONDAYS[0], MONDAYS[1]]);
});

/** The weekly job's run for MONDAYS[0]: this week's Monday at 15:30 UTC. */
const weeklyNow = () => new Date(Date.parse(`${MONDAYS[0]}T15:30:00Z`) + 7 * DAY);
const dropRows = (id: number) => sql()`DELETE FROM project_updates WHERE builder_id = ${id} AND week IN ${sql()(MONDAYS)}`;
const liveSignals = (id: number, patch: Record<string, unknown>) => sql()`UPDATE source_live SET signals = signals || ${sql().json(patch as never)}
  WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${id} AND kind = 'repo')`;

test('F1 fix round 1: one week rule for both paths: the weekly job writes no shipped_code for a week before the repo existed', db, async () => {
  // Created this week: last week's commits are backdated (pushed, so the reading is verified).
  const created = new Date(Math.min(Date.now(), Date.parse(`${MONDAYS[0]}T00:00:00Z`) + 7 * DAY + 1000)).toISOString();
  const key = `tara${RUN}/fresh`;
  const p = await connect('tara', key, { private: false, created, commits: [on(MONDAYS[0], 1, 'a', 'Backdated')] });
  assert.equal((await rows(p.id)).find((r) => r.week === MONDAYS[0])?.facts.shipped_code, undefined, 'the backfill');
  await dropRows(p.id);
  await weeklyFactsStep(weeklyNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  const w = (await rows(p.id)).find((r) => r.week === MONDAYS[0]);
  assert.equal(w?.facts.checked, true);
  assert.equal(w?.facts.shipped_code, undefined, 'the weekly job');
});

test('F2 fix round 1: a week in commit_counts but not in commit_weeks (the stats endpoint lagging) on a verified reading still gets shipped_code', db, async () => {
  const key = `umar${RUN}/lag`;
  const p = await connect('umar', key, { private: false, commits: [on(MONDAYS[0], 1, 'a', 'Add a'), on(MONDAYS[1], 1, 'b', 'Add b'), on(MONDAYS[2], 1, 'c', 'Add c')] });
  await liveSignals(p.id, { commit_weeks: [], pushes_checked: true });
  await dropRows(p.id);
  await backfillOnConnect(p.id, key, new Date(), { deadline: Date.now() + 8_000, ghFetch: p.gh });
  assert.deepEqual((await rows(p.id)).map((r) => (r.facts.shipped_code as { n: number } | undefined)?.n), [1, 1, 1]);
  await dropRows(p.id);
  await weeklyFactsStep(weeklyNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh });
  assert.deepEqual((await rows(p.id))[0].facts.shipped_code, { n: 1 });
});

test('F3 fix round 1: titles_read only after a titles call answered: a token that came back null leaves the week for the catch-up', db, async () => {
  const key = `vera${RUN}/gone`;
  const p = await connect('vera', key, { private: false, commits: [on(MONDAYS[0], 1, 'a', 'Add a')] });
  await dropRows(p.id);
  // GitHub names no installation for the repo now: appTokenFor is null, no titles call is made.
  const noInstall = ((input: RequestInfo | URL, init?: RequestInit) =>
    /\/installation$/.test(new URL(String(input)).pathname) ? Promise.resolve(new Response('{}', { status: 404 })) : p.gh(input, init)) as typeof fetch;
  await backfillOnConnect(p.id, key, new Date(), { deadline: Date.now() + 8_000, ghFetch: noInstall });
  const w = (await rows(p.id)).find((r) => r.week === MONDAYS[0])!;
  assert.deepEqual([w.facts.shipped_code, w.titles, w.facts.titles_read], [{ n: 1 }, [], undefined]);
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 1, rows: 1 });
  assert.deepEqual((await rows(p.id)).find((r) => r.week === MONDAYS[0])!.titles, ['Add a']);
});

test('F4 fix round 1: a private repo\'s weeks: turning titles on clears titles_read, so the catch-up reads the titles once', db, async () => {
  const key = `wade${RUN}/hidden`;
  const p = await connect('wade', key, { private: true, commits: [on(MONDAYS[0], 1, 'a', 'Add invoices'), on(MONDAYS[1], 1, 'b', 'Add taxes')] });
  assert.ok((await rows(p.id)).filter((r) => r.facts.shipped_code).every((r) => r.facts.titles_read === true && r.titles.length === 0));
  await setShipTitles(p.id, { titles: true }, new Date());
  assert.ok((await rows(p.id)).every((r) => r.facts.titles_read === undefined));
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 1, rows: 2 });
  const got = await rows(p.id);
  assert.deepEqual(got.filter((r) => r.facts.shipped_code).map((r) => r.titles), [['Add invoices'], ['Add taxes']]);
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 0, rows: 0 });
});

test('F5 fix round 1: on a Monday before 15:00 UTC the catch-up leaves the newest week to the weekly job', db, async () => {
  const key = `xena${RUN}/early`;
  const p = await connect('xena', key, { private: false, commits: [on(MONDAYS[0], 1, 'a', 'Add a'), on(MONDAYS[1], 1, 'b', 'Add b'), on(MONDAYS[2], 1, 'c', 'Add c')] });
  await dropRows(p.id);
  const mondayMorning = new Date(Date.parse(`${MONDAYS[0]}T10:00:00Z`) + 7 * DAY);
  assert.deepEqual(await backfillStep(mondayMorning, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 1, rows: 2 });
  assert.deepEqual((await rows(p.id)).map((r) => r.week), [MONDAYS[1], MONDAYS[2]]);
  const afternoon = new Date(Date.parse(`${MONDAYS[0]}T15:30:00Z`) + 7 * DAY);
  assert.deepEqual(await backfillStep(afternoon, { deadline: Date.now() + 20_000, only: [p.id], ghFetch: p.gh }), { people: 1, rows: 1 });
  assert.deepEqual((await rows(p.id)).map((r) => r.week), MONDAYS);
});

test('F6 fix round 1: the catch-up takes BACKFILL_PER_RUN projects a run and tries one at most BACKFILL_TRIES_A_DAY times a day', db, async () => {
  const ids: number[] = [];
  for (let i = 0; i <= BACKFILL_PER_RUN; i++) {
    const p = await connect(`cap${i}x`, `cap${i}x${RUN}/many`, { private: false, commits: [on(MONDAYS[0], 1, 'a', 'Add a')] });
    await dropRows(p.id);
    ids.push(p.id);
  }
  const first = await backfillStep(cronNow(), { deadline: Date.now() + 60_000, only: ids });
  assert.equal(first.people, BACKFILL_PER_RUN);
  // Titles keep failing (no ghFetch: never read): each try counts; after BACKFILL_TRIES_A_DAY the project rests till tomorrow.
  const one = [ids[0]];
  let tries = 1;
  while (tries < BACKFILL_TRIES_A_DAY) {
    assert.equal((await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: one })).people, 1);
    tries++;
  }
  assert.deepEqual(await backfillStep(cronNow(), { deadline: Date.now() + 20_000, only: one }), { people: 0, rows: 0 });
});
