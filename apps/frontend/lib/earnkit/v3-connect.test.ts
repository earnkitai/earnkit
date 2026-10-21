import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person, withEnv } from './fixtures/find';
import { computeScoreV2 } from './score-v2';
import { isoWeekOf, mondayOf } from './weeks';
import { backfillMondays } from './week-facts';
import { readStats } from './stats';
import { pointsTotal } from './points';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { connectAsk, CONNECT_HEAD, CONNECT_RETRY, answerConnect, connectWeeks, connectDue, openConnect } from './connect-moment';
import { EMAIL_NOTE, EMAIL_QUESTION } from './digest';

/**
 * v3 Stage 1 Task 5 (spec 5.1): approve on connect. The first ranked reply after the App connects a repo shows the
 * backfilled weeks and asks one question; one yes approves them all (via 'connect', CONNECT_POINTS each) and activates.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// A Wednesday: the backfill's Mondays are Oct 5, Sep 28 and Sep 21.
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const ctx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: NO_MATCH });
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const freshBoard = () => sql()`UPDATE builder_profiles SET hidden = true`;
const seen = async (id: number) =>
  (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;

async function ranked(tag: string) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, projects: [{ key, name: 'App', confirmed: true }] });
  const now = new Date();
  const s = computeScoreV2({ ships: [], commitWeeks: [1, 2, 3].map((i) => isoWeekOf(new Date(now.getTime() - i * 7 * 86_400_000))) }, now);
  await sql()`UPDATE builder_live SET score = ${s.score}, parts = ${sql().json(s.parts as never)} WHERE builder_id = ${id}`;
  return { id, key, handle };
}
/** The three weeks backfillOnConnect writes: commits, checked, unapproved (a private repo's titles with them). */
async function backfilled(id: number, key: string) {
  for (const [i, monday] of backfillMondays(new Date()).entries())
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, titles)
      VALUES (${id}, ${key}, ${monday}, ${sql().json({ checked: true, shipped_code: { n: i + 2 } } as never)}, ${['Secret launch']}::text[])`;
}

test('(a) first ranked find after connect shows the last weeks and asks the connect question', db, async () => {
  await freshBoard();
  const me = await ranked('cna');
  await backfilled(me.id, me.key);
  const f = await mcpCall(ctx(me.id), 'find', {});
  const s = show(f);
  assert.ok(s.startsWith(`${CONNECT_HEAD(3)}\nWeek of Oct 5: 2 commits\nWeek of Sep 28: 3 commits\nWeek of Sep 21: 4 commits\n\nWhere you stand`), s);
  assert.equal(CONNECT_HEAD(3), 'Your last 3 weeks:');
  assert.equal(CONNECT_HEAD(1), 'Your last 1 week:');
  assert.ok(s.endsWith(`How to move up\n${connectAsk(me.handle)}`), s);
  assert.doesNotMatch(s, /Secret launch/, 'a private repo shows facts only');
  assert.doesNotMatch(s, /Last week you finished|Share your week|—/);
  assert.equal(links(s).length, 1, s);
  assert.ok(links(s)[0]!.startsWith(`https://earnkit.com/${me.handle}`), 'the link stays the page');
  assert.equal(questions(s), 1, s);
  const move = f.reply?.move_up as { kind: string; project_key: string; agent_note: string };
  assert.deepEqual([move.kind, move.project_key], ['connect', me.key]);
  assert.match(move.agent_note, /kind: 'connect'/);
  assert.ok((await seen(me.id)).connect_open, 'the offer is open');
  // Shown once: the next reply is the usual one.
  const again = show(await mcpCall(ctx(me.id), 'find', {}));
  assert.doesNotMatch(again, /Your last \d+ weeks?:/, again);
  assert.doesNotMatch(again, /Post these weeks to your public page/, again);
});

test('(b) yes approves all three with via connect, 30 points each, activation counts', db, async () => {
  await freshBoard();
  const me = await ranked('cnb');
  await backfilled(me.id, me.key);
  await sql()`UPDATE builder_sources SET proof = 'github_app' WHERE builder_id = ${me.id}`;
  await mcpCall(ctx(me.id), 'find', {});
  const before = await readStats(new Date());
  const yes = await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } });
  const s = show(yes);
  assert.equal(s, `Done. Your page is live: https://earnkit.com/${me.handle}`, 'no email line while the digest is off');
  assert.equal(links(s).length, 1, 'the page link is clickable');
  const rows = await sql()<{ via: string }[]>`SELECT facts->>'approved_via' AS via FROM project_updates WHERE builder_id = ${me.id} AND (facts->>'approved')::boolean`;
  assert.deepEqual(rows.map((r) => r.via), ['connect', 'connect', 'connect']);
  assert.equal(await pointsTotal(me.id), 90);
  const after = await readStats(new Date());
  assert.equal(after.activated - before.activated, 1);
  const st = await seen(me.id);
  assert.ok(st.connect_done && !st.connect_open);
});

test('(c) a second yes is "Okay."', db, async () => {
  await freshBoard();
  const me = await ranked('cnc');
  await backfilled(me.id, me.key);
  await mcpCall(ctx(me.id), 'find', {});
  assert.match(show(await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } })), /^Done\./);
  assert.equal(show(await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } })), 'Okay.');
  assert.equal(await pointsTotal(me.id), 90, 'nothing twice');
  // A no to a fresh offer approves nothing and closes it.
  const other = await ranked('cnc2');
  await backfilled(other.id, other.key);
  await mcpCall(ctx(other.id), 'find', {});
  assert.equal(show(await mcpCall(ctx(other.id), 'tell', { move_up: { kind: 'connect', project_key: other.key, answer: 'no' } })), 'Okay.');
  assert.equal(show(await mcpCall(ctx(other.id), 'tell', { move_up: { kind: 'connect', project_key: other.key, answer: 'yes' } })), 'Okay.');
  assert.equal((await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${other.id} AND facts ? 'approved'`).length, 0);
  assert.ok((await seen(other.id)).connect_done);
});

test('(d) a person with only a started row sees no connect lines', db, async () => {
  await freshBoard();
  const me = await ranked('cnd');
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts)
    VALUES (${me.id}, ${me.key}, ${backfillMondays(new Date())[0]}, ${sql().json({ checked: true, started: { live: false, weeks: 2 } } as never)})`;
  const s = show(await mcpCall(ctx(me.id), 'find', {}));
  assert.doesNotMatch(s, /Your last \d+ weeks?:/, s);
  assert.match(s, /How to move up\nShip code this week/, s);
  assert.ok(!(await seen(me.id)).connect_done, 'the backfill is not complete: the offer waits');
  // The backfill's other weeks arrive, checked with nothing to confirm: the next find closes the offer.
  for (const monday of backfillMondays(new Date()).slice(1))
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${me.id}, ${me.key}, ${monday}, ${sql().json({ checked: true } as never)})`;
  assert.doesNotMatch(show(await mcpCall(ctx(me.id), 'find', {})), /Your last \d+ weeks?:/);
  const st = await seen(me.id);
  assert.ok(st.connect_done && !st.connect_open, 'nothing to confirm: done');
});

test('(e) the weekly moment still shows the week after', db, async () => {
  await freshBoard();
  try {
    const me = await ranked('cne');
    await backfilled(me.id, me.key);
    await mcpCall(ctx(me.id), 'find', {});
    await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } });
    // Next Monday after the weekly job's hour: it wrote the week of Oct 12; the daily history ranked it.
    mock.timers.setTime(Date.parse('2026-10-19T16:00:00Z'));
    await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
      VALUES (${me.id}, '2026-10-18', 40, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true)`;
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts)
      VALUES (${me.id}, ${me.key}, '2026-10-12', ${sql().json({ checked: true, shipped_code: { n: 1 } } as never)})`;
    const s = show(await mcpCall(ctx(me.id), 'find', {}));
    assert.ok(s.startsWith('Last week you finished at Shipping 40, #1.'), s);
    assert.doesNotMatch(s, /Your last \d+ weeks?:/);
    assert.match(s, /Does last week look right\?$/);
  } finally {
    mock.timers.setTime(WEDNESDAY);
  }
});

test('(e2) same week as the connect yes: the next find never asks about the week just confirmed; the ask is the weekly target', db, async () => {
  await freshBoard();
  const me = await ranked('cng');
  await backfilled(me.id, me.key);
  // A ranked day last week, so the weekly moment has a week to show (the backfill's newest Monday, Oct 5).
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
    VALUES (${me.id}, '2026-10-11', 40, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true)`;
  assert.match(show(await mcpCall(ctx(me.id), 'find', {})), /^Your last 3 weeks:/);
  assert.match(show(await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } })), /^Done\./);
  const f = await mcpCall(ctx(me.id), 'find', {});
  const s = show(f);
  assert.doesNotMatch(s, /Your last \d+ weeks?:|Last week you finished|Share your week|Does last week look right\?/, s);
  assert.match(s, /How to move up\nShip code this week: \+\d+ points/, s);
  assert.equal((f.reply?.move_up as { kind: string }).kind, 'ship');
  assert.equal((await sql()<{ w: string | null }[]>`SELECT moment_week AS w FROM installations WHERE id = ${me.id}`)[0].w, isoWeekOf(new Date()), 'the week is claimed');
});

test('(f) with the weekly email on, the Done line carries the email question as the one question', db, async () => {
  await freshBoard();
  await withEnv({ RESEND_API_KEY: 'test-key', EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET ?? 'test-secret' }, async () => {
    const me = await ranked('cnf');
    await backfilled(me.id, me.key);
    await mcpCall(ctx(me.id), 'find', {});
    const yes = await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } });
    const s = show(yes);
    assert.equal(s, `Done. Your page is live: https://earnkit.com/${me.handle}\n${EMAIL_QUESTION}`);
    assert.equal(links(s).length, 1);
    assert.equal(questions(s), 1);
    assert.match(JSON.stringify(yes.reply), new RegExp(EMAIL_NOTE.replace(/[.']/g, '.')));
  });
});

test('(g) final review: an older stored week outside the backfill is listed and approved too', db, async () => {
  await freshBoard();
  const me = await ranked('cnh');
  await backfilled(me.id, me.key);
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts)
    VALUES (${me.id}, ${me.key}, '2026-09-14', ${sql().json({ checked: true, shipped_code: { n: 7 } } as never)})`;
  const s = show(await mcpCall(ctx(me.id), 'find', {}));
  assert.ok(s.startsWith(`${CONNECT_HEAD(4)}\nWeek of Oct 5: 2 commits\nWeek of Sep 28: 3 commits\nWeek of Sep 21: 4 commits\nWeek of Sep 14: 7 commits\n`), s);
  assert.match(show(await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } })), /^Done\./);
  const open = await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${me.id} AND NOT COALESCE((facts->>'approved')::boolean, false)`;
  assert.equal(open.length, 0, 'every week confirmed');
  assert.equal(await pointsTotal(me.id), 120);
});

test('(g2) the connect question names the page and the Feed, one https link, one question', db, async () => {
  await freshBoard();
  const me = await ranked('cng2');
  await backfilled(me.id, me.key);
  const s = show(await mcpCall(ctx(me.id), 'find', {}));
  assert.ok(s.endsWith(`How to move up\nPost these weeks to your public page? Yes puts them on earnkit.com/${me.handle} and the Feed.`), s);
  assert.doesNotMatch(s, /Yes posts them/, s);
  assert.equal(links(s).length, 1, s);
  assert.equal(questions(s), 1, s);
});

test('(h) final review: an empty read before the backfill completes leaves the offer due; the late rows are offered', db, async () => {
  await freshBoard();
  const me = await ranked('cni');
  const s = show(await mcpCall(ctx(me.id), 'find', {}));
  assert.doesNotMatch(s, /Your last \d+ weeks?:/, s);
  assert.equal(await connectDue(me.id), true, 'still due');
  await backfilled(me.id, me.key);
  assert.match(show(await mcpCall(ctx(me.id), 'find', {})), /^Your last 3 weeks:/);
});

test('(i) final review: a week whose approval fails stays open; the reply asks to retry and the next yes retries it', db, async () => {
  await freshBoard();
  const me = await ranked('cnj');
  await backfilled(me.id, me.key);
  const [good] = backfillMondays(new Date());
  // A stored week the database refuses (not a date): its approval throws.
  await openConnect(me.id, { key: me.key, weeks: [good!, 'not-a-date'] });
  const yes = { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } };
  const first = await mcpCall(ctx(me.id), 'tell', yes);
  assert.equal(show(first), CONNECT_RETRY);
  assert.doesNotMatch(show(first), /—/);
  assert.equal(questions(show(first)), 1);
  const move = first.reply?.move_up as { kind: string; project_key: string; agent_note: string };
  assert.deepEqual([move.kind, move.project_key], ['connect', me.key]);
  assert.match(move.agent_note, /kind: 'connect'/);
  const st = await seen(me.id);
  assert.deepEqual(st.connect_open, { key: me.key, weeks: ['not-a-date'] });
  assert.deepEqual(st.bench_ask, { kind: 'connect', key: me.key });
  assert.equal(st.connect_done, undefined, 'not done while a week is left');
  assert.equal(await connectDue(me.id), false, 'the open offer is the guard');
  // The week is still failing: a second yes asks again (it retried).
  assert.equal(show(await mcpCall(ctx(me.id), 'tell', yes)), CONNECT_RETRY);
  // Fixed and retried: the next yes approves the rest and closes it.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{connect_open,weeks}', ${sql().json([backfillMondays(new Date())[1]] as never)}::jsonb) WHERE builder_id = ${me.id}`;
  assert.match(show(await mcpCall(ctx(me.id), 'tell', yes)), /^Done\./);
  const end = await seen(me.id);
  assert.ok(end.connect_done);
  assert.equal(end.bench_ask, undefined, 'the ask is cleared once it lands');
});

test('(j) reward integrity: a running week is never listed or approved; a finished checked week still is', db, async () => {
  await freshBoard();
  const me = await ranked('cnk');
  const [finished] = backfillMondays(new Date());
  const running = mondayOf(new Date());
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES
    (${me.id}, ${me.key}, ${finished!}, ${sql().json({ checked: true, shipped_code: { n: 2 } } as never)}),
    (${me.id}, ${me.key}, ${running}, ${sql().json({ shipped_code: { n: 5 } } as never)})`;
  assert.deepEqual((await connectWeeks(me.id, me.key, new Date())).map((w) => w.monday), [finished]);
  // Stored in the offer anyway (an older offer): the running week is skipped, not an error.
  await openConnect(me.id, { key: me.key, weeks: [running, finished!] });
  assert.deepEqual(await answerConnect(me.id, me.key, 'yes', new Date()), { approved: 1, pending: 0 });
  const rows = await sql()<{ week: string; a: boolean }[]>`SELECT week::text, COALESCE((facts->>'approved')::boolean, false) AS a FROM project_updates WHERE builder_id = ${me.id}`;
  assert.deepEqual(rows.map((r) => [r.week, r.a]).sort(), [[finished, true], [running, false]].sort());
  assert.ok((await seen(me.id)).connect_done);
});
