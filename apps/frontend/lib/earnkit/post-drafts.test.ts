import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { EVENT_LOG_FLAG, EVENT_TYPES } from './events';
import {
  ASKED_PER_DAY,
  CODE_PATTERN,
  DRAFTS_PER_WEEK,
  DRAFT_TTL_DAYS,
  OFFERED_PER_WEEK,
  PAST_OFFER_LIMIT,
  TAP_CAP,
  VISIT_CAP,
  VISIT_DAY_CAP,
  createDraft,
  draftByCode,
  newCode,
  noteVisit,
  recentDrafts,
  tapDraft,
  type NewDraft,
} from './post-drafts';

/**
 * v3.1 one-tap posts, Task 1 (design 3): the post_drafts store. Each draft is a row with a short code; the builder's tap
 * on earnkit.com/<handle>/post/<code> counts once per tap (no IP, no user agent), capped; a draft lives 14 days.
 */
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const flagBefore = process.env[EVENT_LOG_FLAG];
beforeEach(() => {
  process.env[EVENT_LOG_FLAG] = 'on';
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[EVENT_LOG_FLAG];
  else process.env[EVENT_LOG_FLAG] = flagBefore;
});

let next = 2_100_000_000 + (process.pid % 1000) * 1000;
const person = () => ++next;
const draft = (builderId: number, o: Partial<NewDraft> = {}): NewDraft => ({
  builderId,
  projectKey: 'maya/recipes',
  moment: 'weekly',
  momentKey: 'weekly:maya/recipes:2026-10-12',
  shape: 'name_week',
  text: 'Recipes, week 6: added offline mode and fixed several sync bugs.',
  week: '2026-10-12',
  asked: false,
  ...o,
});
const NOW = new Date('2026-10-20T16:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

test('newCode: 10 lowercase base32 characters, never the same twice', () => {
  const codes = new Set(Array.from({ length: 500 }, newCode));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, CODE_PATTERN);
  assert.equal(CODE_PATTERN.test('abcdefghij'), true);
  for (const bad of ['ABCDEFGHIJ', 'abcdefghi', 'abcdefghijk', 'abcdefgh01', '../etc/pa', 'abcdefghi!']) assert.equal(CODE_PATTERN.test(bad), false, bad);
});

test('the new event types are listed in events.ts and in every builder_events_type_check', () => {
  for (const t of ['post_drafted', 'post_tapped']) assert.ok((EVENT_TYPES as readonly string[]).includes(t), t);
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  const adds = [...schema.matchAll(/ADD CONSTRAINT builder_events_type_check\s+CHECK \(([\s\S]*?)\)\);/g)];
  assert.ok(adds.length >= 2);
  for (const [, body] of adds) for (const t of ['post_drafted', 'post_tapped']) assert.ok(body.includes(`'${t}'`), `${t} in every re-add`);
});

test('createDraft stores the row (14-day expiry, nothing tapped), records post_drafted once, and reads back by code', dbTest, async () => {
  const id = person();
  const r = await createDraft(draft(id, { card: { week: 6, summary: 'Added offline mode.' }, proofUrl: null }), NOW);
  assert.ok(r.ok);
  const row = await draftByCode(r.draft.code);
  assert.ok(row);
  assert.equal(row.builder_id, id);
  assert.equal(row.moment, 'weekly');
  assert.equal(row.moment_key, 'weekly:maya/recipes:2026-10-12');
  assert.equal(row.shape, 'name_week');
  assert.equal(row.text, 'Recipes, week 6: added offline mode and fixed several sync bugs.');
  assert.deepEqual(row.card, { week: 6, summary: 'Added offline mode.' });
  assert.equal(row.week, '2026-10-12');
  assert.equal(row.asked, false);
  assert.equal(row.taps, 0);
  assert.equal(row.first_tap_at, null);
  assert.equal(row.expires_at.getTime() - NOW.getTime(), DRAFT_TTL_DAYS * 86_400_000);
  assert.equal(DRAFT_TTL_DAYS, 14);
  const ev = await sql()`SELECT installation_id FROM builder_events WHERE dedupe_key = ${`post_drafted:${r.draft.code}`}`;
  assert.deepEqual(ev.map((e) => e.installation_id), [id]);
  assert.equal(await draftByCode('zzzzzzzzzz'), null);
  assert.equal(await draftByCode('not a code'), null, 'a malformed code is never read');
});

test('a draft over 240 characters or empty is refused before the database', dbTest, async () => {
  const id = person();
  assert.deepEqual(await createDraft(draft(id, { text: 'x'.repeat(241) }), NOW), { ok: false, reason: 'text' });
  assert.deepEqual(await createDraft(draft(id, { text: '   ' }), NOW), { ok: false, reason: 'text' });
  assert.equal((await recentDrafts(id)).length, 0);
});

test('limits: 1 offered draft a person per 7 days, 1 asked per 24 hours, 3 in all per 7 days', dbTest, async () => {
  assert.deepEqual([OFFERED_PER_WEEK, ASKED_PER_DAY, DRAFTS_PER_WEEK], [1, 1, 3]);
  const id = person();
  assert.ok((await createDraft(draft(id), at(0))).ok);
  assert.deepEqual(await createDraft(draft(id, { momentKey: 'coin_intro:0xabc', moment: 'coin_intro' }), at(1)), { ok: false, reason: 'offered_limit' });
  assert.deepEqual(await createDraft(draft(id), at(24 * 7 - 1)), { ok: false, reason: 'offered_limit' }, 'still inside the 7 days');
  // Asked drafts: one a day.
  assert.ok((await createDraft(draft(id, { asked: true, shape: 'change' }), at(2))).ok);
  assert.deepEqual(await createDraft(draft(id, { asked: true }), at(20)), { ok: false, reason: 'asked_limit' });
  assert.ok((await createDraft(draft(id, { asked: true, shape: 'this_week' }), at(27))).ok);
  // Three in 7 days: a third asked draft a day later is refused by the weekly cap.
  assert.deepEqual(await createDraft(draft(id, { asked: true }), at(52)), { ok: false, reason: 'week_limit' });
  // Past 7 days of the first: an offered draft is allowed again.
  assert.ok((await createDraft(draft(id, { momentKey: 'weekly:maya/recipes:2026-10-26', week: '2026-10-26' }), at(24 * 7 + 1))).ok);
  // Another person is never held by these.
  assert.ok((await createDraft(draft(person()), at(1))).ok);
});

test('controller ruling: went live, won and funded skip the one offered a week (a real win is never crowded out by a weekly); still 3 a week', dbTest, async () => {
  assert.deepEqual([...PAST_OFFER_LIMIT], ['went_live', 'won', 'funded']);
  const id = person();
  assert.ok((await createDraft(draft(id), at(0))).ok, 'an ordinary weekly offered first');
  assert.ok((await createDraft(draft(id, { momentKey: 'went_live:maya/recipes', moment: 'went_live', shape: 'live' }), at(1))).ok);
  assert.ok((await createDraft(draft(id, { momentKey: 'won:base-builder-grants', moment: 'won', shape: 'won' }), at(2))).ok);
  // Accepted is an ordinary offer: held by the weekly cap here anyway (3 in 7 days), and by the one offered a week alone.
  assert.deepEqual(await createDraft(draft(id, { momentKey: 'funded:arc', moment: 'funded', shape: 'funded' }), at(3)), { ok: false, reason: 'week_limit' });
  const other = person();
  assert.ok((await createDraft(draft(other), at(0))).ok);
  assert.deepEqual(await createDraft(draft(other, { momentKey: 'accepted:arc', moment: 'accepted', shape: 'accepted' }), at(1)), { ok: false, reason: 'offered_limit' });
  assert.ok((await createDraft(draft(other, { momentKey: 'funded:arc', moment: 'funded', shape: 'funded' }), at(2))).ok);
});

test('limits hold under ten drafts at once: exactly one offered draft is written', dbTest, async () => {
  const id = person();
  const rs = await Promise.all(Array.from({ length: 10 }, () => createDraft(draft(id), NOW)));
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.equal((await recentDrafts(id)).length, 1);
});

test('tapDraft counts each tap (no IP or user agent kept), stamps the first, records post_tapped once, and stops at the cap', dbTest, async () => {
  const id = person();
  const r = await createDraft(draft(id), NOW);
  assert.ok(r.ok);
  const code = r.draft.code;
  assert.deepEqual(await tapDraft(code, id, at(1)), { taps: 1 });
  assert.deepEqual(await tapDraft(code, id, at(2)), { taps: 2 });
  const row = (await draftByCode(code))!;
  assert.equal(row.first_tap_at?.getTime(), at(1).getTime(), 'the first tap is kept');
  const ev = await sql()`SELECT 1 FROM builder_events WHERE dedupe_key = ${`post_tapped:${code}`}`;
  assert.equal(ev.length, 1);
  // No column for who tapped.
  const cols = (await sql()<{ c: string }[]>`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'post_drafts'`).map((c) => c.c);
  for (const c of cols) assert.doesNotMatch(c, /ip|agent|ua$|referr|user/i, c);
  // Another builder's code, an unknown code and an expired code count nothing.
  assert.equal(await tapDraft(code, id + 1, at(3)), null);
  assert.equal(await tapDraft('zzzzzzzzzz', id, at(3)), null);
  assert.equal(await tapDraft(code, id, at(24 * DRAFT_TTL_DAYS + 1)), null);
  assert.equal((await draftByCode(code))!.taps, 2);
  // The cap: the counter stops at TAP_CAP (a link pasted somewhere busy), and the tap still answers.
  await sql()`UPDATE post_drafts SET taps = ${TAP_CAP - 1} WHERE code = ${code}`;
  assert.deepEqual(await tapDraft(code, id, at(4)), { taps: TAP_CAP });
  assert.deepEqual(await tapDraft(code, id, at(5)), { taps: TAP_CAP });
  assert.equal((await draftByCode(code))!.taps, TAP_CAP);
  assert.equal(TAP_CAP, 100);
});

test('noteVisit counts page opens with ?m, and from X apart, capped; never another builder\'s code', dbTest, async () => {
  const id = person();
  const r = await createDraft(draft(id), NOW);
  assert.ok(r.ok);
  const code = r.draft.code;
  assert.equal(await noteVisit(code, id, false), true);
  assert.equal(await noteVisit(code, id, true), true);
  assert.equal(await noteVisit(code, id + 1, true), false);
  let row = (await draftByCode(code))!;
  assert.deepEqual([row.visits, row.x_visits], [2, 1]);
  await sql()`UPDATE post_drafts SET visits = ${VISIT_CAP}, x_visits = ${VISIT_CAP} WHERE code = ${code}`;
  assert.equal(await noteVisit(code, id, true), false);
  row = (await draftByCode(code))!;
  assert.deepEqual([row.visits, row.x_visits], [VISIT_CAP, VISIT_CAP]);
});

test('final review 4: page opens count at most VISIT_DAY_CAP per post per UTC day (nothing about the visitor is kept)', dbTest, async () => {
  const id = person();
  const r = await createDraft(draft(id), NOW);
  assert.ok(r.ok);
  const code = r.draft.code;
  const day1 = new Date('2026-10-20T10:00:00Z');
  for (let i = 0; i < VISIT_DAY_CAP; i++) assert.equal(await noteVisit(code, id, i % 2 === 0, day1), true, String(i));
  assert.equal(await noteVisit(code, id, true, new Date('2026-10-20T23:59:00Z')), false, 'the day is full');
  let row = (await draftByCode(code))!;
  assert.deepEqual([row.visits, row.x_visits], [VISIT_DAY_CAP, VISIT_DAY_CAP / 2]);
  // The next day counts again.
  assert.equal(await noteVisit(code, id, true, new Date('2026-10-21T00:01:00Z')), true);
  row = (await draftByCode(code))!;
  assert.deepEqual([row.visits, row.x_visits], [VISIT_DAY_CAP + 1, VISIT_DAY_CAP / 2 + 1]);
  const [cols] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'post_drafts' AND (column_name ILIKE '%ip%' OR column_name ILIKE '%agent%' OR column_name ILIKE '%ua%')`;
  assert.equal(cols.n, 0, 'no IP or user agent column');
});

test('recentDrafts: newest first, with shape, text, moment, key and when tapped', dbTest, async () => {
  const id = person();
  await createDraft(draft(id, { shape: 'name_week', text: 'First.' }), at(0));
  await createDraft(draft(id, { shape: 'change', text: 'Second.', asked: true }), at(1));
  const rs = await recentDrafts(id);
  assert.deepEqual(rs.map((r) => [r.shape, r.text, r.asked]), [['change', 'Second.', true], ['name_week', 'First.', false]]);
  assert.equal(rs[0]!.moment_key, 'weekly:maya/recipes:2026-10-12');
});
