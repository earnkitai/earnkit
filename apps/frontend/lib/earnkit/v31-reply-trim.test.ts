import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { avalanche, dropAvalanche, fitsFor, person } from './fixtures/find';
import { computeScoreV2 } from './score-v2';
import { isoWeekOf, lastFinishedMonday } from './weeks';
import { profileData } from './bench-data';
import { approveWeek } from './weekly-moment';
import { POINTS_LINE, pointsTotal } from './points';
import { SHIP_ASK, benchReply, type BenchView } from './bench-reply';

/**
 * v3.1 F4: the ranked reply loses words (the owner: "too many words"). No why sentence, no Originality, no points
 * total; the upcoming line only when the reply names no fit. The page and the points ledger keep theirs. Task 16: the
 * one points line a step earns ("Ship code this week: up to +100 points") is the owner's approved copy.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
after(async () => {
  mock.timers.reset();
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const ctxOf = (id: number, matchProjects: unknown = NO_MATCH) => ({ installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: matchProjects as never });

/** A ranked builder with a page, three weeks of code (so a why sentence exists) and a `streak`-week streak. */
async function ranked(tag: string, streak = 0) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, seen: { connect_done: '2026-09-01T00:00:00.000Z' }, projects: [{ key, name: 'App', confirmed: true, streak }] });
  const now = new Date();
  const s = computeScoreV2({ ships: [], commitWeeks: [0, 1, 2].map((i) => isoWeekOf(new Date(now.getTime() - i * 7 * 86_400_000))) }, now);
  await sql()`UPDATE builder_live SET score = ${s.score}, parts = ${sql().json(s.parts as never)} WHERE builder_id = ${id}`;
  return { id, key, handle };
}

test('(a) a ranked reply has no why sentence, no Originality and no points total', db, async () => {
  const me = await ranked('rta');
  await sql()`INSERT INTO project_embeddings (project_key, builder_id, originality, nearest, checked_at) VALUES (${me.key}, ${me.id}, 72, '[]'::jsonb, now())`;
  const monday = lastFinishedMonday(new Date());
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${me.id}, ${me.key}, ${monday}, ${sql().json({ checked: true, shipped_code: { n: 2 } } as never)})`;
  await approveWeek(me.id, me.key, monday, new Date());
  const s = show(await mcpCall(ctxOf(me.id), 'find', {}));
  // v4.7.1 T1: the standing is v4.7's paragraph, never "App · 1 week in a row".
  assert.match(s, /^Score \d+\. 1 week shipping\. /m, s);
  // v4.3: with no fit, Base's grant reply (its money and gap, then its question); it carries no ship line.
  assert.match(s, /\nBase Builder Grants: \$5,000, rolling\. [^\n]+\n\n(?:Also open: [^\n]+\n\n)?Want [^\n]*\?$/, s);
  assert.doesNotMatch(s, /Code in \d+ of the last 12 weeks/, s);
  assert.doesNotMatch(s, /Originality/, s);
  assert.doesNotMatch(s, /Points:/, s);
  assert.doesNotMatch(s, /\$EARN/, s);
  assert.ok(links(s).length <= 1, s);
  assert.ok(questions(s) <= 1, s);
  assert.doesNotMatch(s, /—/);
  // The page keeps both: the why and Originality.
  const d = (await profileData(me.id, new Date()))!;
  assert.match(d.why ?? '', /^Code in 3 of the last 12 weeks/);
  assert.equal(d.originality, 72);
  // The score reply too.
  const sc = show(await mcpCall(ctxOf(me.id), 'score', {}));
  assert.doesNotMatch(sc, /Code in \d+ of the last 12 weeks|Originality|Points:/, sc);
});

test('(a) benchReply: the ranked reply is the standing, the question and the points line (no why, Originality or total)', () => {
  const v: BenchView = {
    state: 'ranked', variant: null, project: { key: 'maya/recipes', name: 'Recipes', confirmed: true, live: true, weeks: 6 }, rank: null, streak: 0,
    handle: 'maya', link: null, target: null, fund: [], due: [], ask: { kind: 'ship', project_key: 'maya/recipes', line: SHIP_ASK }, held: null,
  };
  const s = benchReply(v);
  // v4.7 T4: the ship ask's why (no streak yet) in place of the ship line.
  assert.equal(s, `Recipes is on EarnKit.\n\nShipping this week starts your streak and lifts your score.\n\n${SHIP_ASK}`);
  assert.ok(!s.includes(POINTS_LINE(100)), s);
});

test('(b) a program that is not open is never a reply line, fit or no fit (owner 2026-10-23)', db, async () => {
  // A 4-week streak and no fit: the upcoming line is the money line (Task 16: after the standing, before the question).
  const lone = await ranked('rtb', 4);
  // 2026-10-22: Base's grant steps take the money line's place while offered; a no brings the upcoming line back.
  const q = show(await mcpCall(ctxOf(lone.id), 'find', {}));
  assert.doesNotMatch(q, / not open yet\. /, q);
  await mcpCall(ctxOf(lone.id), 'tell', { move_up: { kind: 'qualify', project_key: lone.key, answer: 'no' } });
  const s = show(await mcpCall(ctxOf(lone.id), 'find', {}));
  assert.doesNotMatch(s, /not open yet|not announced/, s);
  // A 4-week streak and a fit: no upcoming line.
  const ava = await avalanche();
  const fit = await ranked('rtc', 4);
  const t = show(await mcpCall(ctxOf(fit.id, async () => ({ checked: 1, scored: 1, fits: fitsFor(ava.id, fit.key) })), 'find', {}));
  assert.ok(t.includes(ava.title), t);
  assert.doesNotMatch(t, / not open yet\. /, t);
});

test('(c) builder_points still gets its row on approval', db, async () => {
  const me = await ranked('rtd');
  const monday = lastFinishedMonday(new Date());
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${me.id}, ${me.key}, ${monday}, ${sql().json({ checked: true, shipped_code: { n: 1 } } as never)})`;
  assert.equal(await approveWeek(me.id, me.key, monday, new Date()), true);
  const rows = await sql()<{ points: number }[]>`SELECT points FROM builder_points WHERE builder_id = ${me.id}`;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].points > 0);
  assert.equal(await pointsTotal(me.id), rows[0].points);
  assert.equal((await profileData(me.id, new Date()))?.points, rows[0].points, 'the page keeps the points');
  assert.doesNotMatch(show(await mcpCall(ctxOf(me.id), 'find', {})), /Points:/);
});
