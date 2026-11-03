import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person, withEnv } from './fixtures/find';
import { pathQuiet } from './fixtures/wallet-step';
import { periodKey } from './free-tier';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { oldShareOffer } from './fixtures/old-share';
import { pointsTotal } from './points';
import { isoWeekOf, lastFinishedMonday } from './weeks';
import {
  DIGEST_HOUR_UTC,
  EMAIL_NOTE,
  EMAIL_ON,
  EMAIL_QUESTION,
  digestBody,
  sendDigests,
  weekStart,
  type DigestFacts,
  type Mailer,
} from './digest';
import { SEEN_FIELD, WEEK_TEXT, summaryHash, weekGet, weekLinkLive, weekPost, weekTarget, weekToken, weekUrl, weekVerify } from './week-links';
import { profileData } from './bench-data';
import { feedWeeks, rankFeed } from './feed';
import { WEEKLY_HOUR_UTC } from './week-facts';

/**
 * v3 Stage 1 Task 6 (spec 5.4): the Monday email is the moment. Last week's lines, then Looks right and Hide links
 * that work without the agent (GET shows, only POST acts), sent once the weekly job wrote the week; the address is
 * asked once after activation.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'monday-email-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// A fixed clock (mock.timers: every new Date() in this file and the code under test is MONDAY, whatever the real
// date): Monday Oct 12, 16:15 UTC, after the weekly job's hour and the email's. Every week below is derived from it;
// MONDAY_EMAIL_NOW (a Monday after 16:00 UTC) runs the file at another date.
const MONDAY = Date.parse(process.env.MONDAY_EMAIL_NOW || '2026-10-12T16:15:00Z');
mock.timers.enable({ apis: ['Date'], now: MONDAY });
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const ctx = (id: number) => ({ installationId: id, ownInstallationId: id, sharedClient: false, matchProjects: NO_MATCH });
const show = (r: Awaited<ReturnType<typeof mcpCall>>) => String(r.reply?.show_to_builder ?? '');
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const freshBoard = () => sql()`UPDATE builder_profiles SET hidden = true`;
const DAY_MS = 86_400_000;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
/** The last finished week, the one before (still live) and the one before that (expired); the running week. */
const LAST = lastFinishedMonday(new Date(MONDAY));
const BEFORE = ymd(Date.parse(`${LAST}T00:00:00Z`) - 7 * DAY_MS);
const EXPIRED = ymd(Date.parse(`${LAST}T00:00:00Z`) - 14 * DAY_MS);
const RUNNING = ymd(Date.parse(`${LAST}T00:00:00Z`) + 7 * DAY_MS);
/** Last week's Sunday: its ranked day. */
const LAST_SUNDAY = ymd(Date.parse(`${LAST}T00:00:00Z`) + 6 * DAY_MS);
const ON = { RESEND_API_KEY: 're_test_never_used' };

/** A ranked person with a ranked day last week and, unless `checked: false`, the weekly job's row for it. */
async function builder(tag: string, o: { checked?: boolean } = {}) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, projects: [{ key, name: 'App', confirmed: true }] });
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
    VALUES (${id}, ${LAST_SUNDAY}, 40, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true)`;
  const facts = o.checked === false ? { shipped_code: { n: 3 } } : { checked: true, shipped_code: { n: 3 } };
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, text)
    VALUES (${id}, ${key}, ${LAST}, ${sql().json(facts as never)}, 'Shipped the login fix.')`;
  return { id, key, handle };
}
async function subscribe(id: number, email: string) {
  await sql()`INSERT INTO digest_subscriptions (installation_id, email, asked_at, opted_in_at)
    VALUES (${id}, ${email}, ${new Date(MONDAY - 8 * 86_400_000)}, ${new Date(MONDAY - 7 * 86_400_000)})`;
}
const clearCounters = () =>
  sql()`DELETE FROM free_tier_usage WHERE (name = 'resendDay' AND period = ${periodKey('day', new Date(MONDAY))})
    OR (name = 'resendMonth' AND period = ${periodKey('month', new Date(MONDAY))})`;
const recorder = () => {
  const sent: Parameters<Mailer>[0][] = [];
  const mail: Mailer = async (m) => {
    sent.push(m);
  };
  return { sent, mail };
};
const row = async (id: number) =>
  (await sql()<{ facts: Record<string, unknown>; hidden: boolean }[]>`SELECT facts, hidden FROM project_updates WHERE builder_id = ${id} AND week = ${LAST}`)[0];
const req = (url: string, method = 'GET') => new Request(url, { method });
const html = (r: Response) => r.text();

test('(a) weekToken round trip and a tampered token', () => {
  assert.equal(Date.now(), MONDAY, 'the clock is fixed');
  assert.equal(new Date(MONDAY).getUTCDay(), 1);
  const secret = 's3cret';
  const t = weekToken({ builderId: 42, key: 'Lee/TipJar', monday: LAST, action: 'approve' }, secret);
  assert.doesNotMatch(t, /tipjar|lee/i, 'the token never names the repo');
  assert.match(t, new RegExp(`^42\\.${LAST}\\.approve\\.[A-Za-z0-9_-]{43}$`));
  const parts = weekTarget(t, secret)!;
  assert.deepEqual({ ...parts, mac: undefined }, { builderId: 42, monday: LAST, action: 'approve', mac: undefined });
  assert.equal(weekVerify(parts, 'lee/tipjar', secret), true, 'the key is matched case-insensitively');
  assert.equal(weekVerify(parts, 'lee/other', secret), false, 'another repo');
  assert.equal(weekVerify(parts, 'lee/tipjar', 'other'), false, 'another secret');
  // Changing the id, the week or the action, or one character of the mac, breaks it.
  for (const bad of [t.replace(/^42/, '43'), t.replace(LAST, BEFORE), t.replace('approve', 'hide'), `${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`]) {
    const p = weekTarget(bad, secret);
    assert.ok(p === null || !weekVerify(p, 'lee/tipjar', secret), bad);
  }
  for (const junk of ['', 'x', '42.2026-10-06.approve.' + 'a'.repeat(43), `42.${LAST}.delete.` + 'a'.repeat(43), `0.${LAST}.hide.${'a'.repeat(43)}`])
    assert.equal(weekTarget(junk, secret), null, junk);
  assert.equal(weekTarget(t, ''), null, 'no secret');
  assert.match(weekUrl({ builderId: 42, key: 'lee/tipjar', monday: LAST, action: 'hide' }), new RegExp(`^https://earnkit\\.com/api/week\\?t=42\\.${LAST}\\.hide\\.`));
  assert.equal(DIGEST_HOUR_UTC, 16);
  assert.ok(DIGEST_HOUR_UTC > WEEKLY_HOUR_UTC, 'the email goes after the weekly job');
  assert.equal(weekStart(new Date('2026-10-12T15:59:00Z')).toISOString(), '2026-10-05T16:00:00.000Z');
  assert.equal(weekStart(new Date('2026-10-12T16:00:00Z')).toISOString(), '2026-10-12T16:00:00.000Z');
});

test('(b) digestBody with a week leads with the moment and both links', () => {
  const base: DigestFacts = { money: [], newPrograms: [], wins: [], deadlines: [], week: null, handle: null };
  assert.equal(digestBody(base), null, 'no week and no sections');
  const week = {
    lines: ['Last week you finished at Shipping 40, #3.', 'Fixed the login loop'],
    standing: { score: 40, rank: 3, total: 12 },
    approveUrl: 'https://earnkit.com/api/week?t=a',
    hideUrl: 'https://earnkit.com/api/week?t=h',
    approved: false,
  };
  const b = digestBody({ ...base, week })!;
  assert.equal(b.subject, 'Your week on EarnKit: Shipping 40 · #3 of 12 builders');
  assert.equal(
    b.text,
    'Last week you finished at Shipping 40, #3.\nFixed the login loop\n\nLooks right: https://earnkit.com/api/week?t=a\nHide this week: https://earnkit.com/api/week?t=h',
  );
  const both = digestBody({ ...base, week, wins: [{ name: 'PayLink', program: 'Arc', prize_usd: 500 }] })!;
  assert.ok(both.text.startsWith(`${b.text}\n\nWon: PayLink in Arc, $500.`), both.text);
  assert.equal(both.subject, b.subject, 'the week leads the subject');
  // Already confirmed (by the agent): the lines stay, no links to act on.
  // v3.1 Task 12: the money lines come first, above the week.
  const money = digestBody({ ...base, week, money: ['Base Builder Grant Program is open (rolling), and your draft is one yes away.', '2 new backers this week.'] })!;
  assert.equal(money.text, `Base Builder Grant Program is open (rolling), and your draft is one yes away.\n2 new backers this week.\n\n${b.text}\n\nAsk your agent "What can I earn?" to start.`);
  assert.equal(money.subject, b.subject, 'the week still leads the subject');
  const done = digestBody({ ...base, week: { ...week, approved: true } })!;
  assert.doesNotMatch(done.text, /Looks right|Hide this week|https:/);
  for (const x of [b, both, money, done]) {
    assert.doesNotMatch(`${x.subject}\n${x.text}`, /\p{Extended_Pictographic}|—/u);
  }
});

test('(c) sendDigests mails the moment for a checked week', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    await clearCounters();
    const me = await builder('mec');
    await subscribe(me.id, `mec${me.id}@example.com`);
    const { sent, mail } = recorder();
    const r = await sendDigests(new Date(), { mail, only: [me.id] });
    assert.equal(r.sent, 1);
    const m = sent[0]!;
    // v3.1 F3: one ranked builder (under RANK_MIN_POOL): no rank in the subject or the moment.
    // v4.7 T5 (R16): the standing on top carries the one score, so the subject has none.
    assert.equal(m.subject, 'Your week on EarnKit');
    // v4.0 Task 7: the Monday block as plain lines (v4.7 T5: under the builder's standing paragraph).
    // Final review 9: a score of 0 is said as no part (the streak leads the standing).
    assert.match(m.text, /^(?:Score [1-9]\d*\. )?1 week shipping\. [^\n]*\n\nYour week is ready, /, m.text);
    // R16: one score figure per email: the standing's, never the week's "Shipping score" line.
    assert.doesNotMatch(m.text, /Shipping score/);
    // This fixture's score is 0, which is said as no part (final review 9): no score figure at all.
    assert.equal((`${m.subject}\n${m.text}`.match(/\bScore \d+|Shipping \d+/gi) ?? []).length, 0, m.text);
    assert.match(m.text, /\n\nLooks right: https:\/\/earnkit\.com\/api\/week\?t=\S+\nHide this week: https:\/\/earnkit\.com\/api\/week\?t=\S+/);
    // v4.0 Task 7: the greeting may use the builder's own handle (no X name), which this fixture shares with the repo owner.
    assert.ok(!(m.text.match(/https:\/\/\S+/g) ?? []).some((u) => u.includes(me.key.split('/')[0]!)), 'no link names the repo');
    assert.match(m.text, /Unsubscribe: https:\/\/earnkit\.com\/api\/digest\/unsubscribe\?t=/);
    const approve = m.text.match(/Looks right: (\S+)/)![1]!;
    const t = new URL(approve).searchParams.get('t')!;
    assert.deepEqual({ ...weekTarget(t)!, mac: '' }, { builderId: me.id, monday: LAST, action: 'approve', mac: '' });
    assert.equal(weekVerify(weekTarget(t)!, me.key), true);
  }),
);

test('(d2) v4.10.3 Task 3 fix round 2 (N2): the email page yes after the Monday reply\'s automatic add takes the week over (via email, a builder action)', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    const me = await builder('mea');
    const { approveWeek } = await import('./weekly-moment');
    assert.ok(await approveWeek(me.id, me.key, LAST, new Date(), 'auto', null));
    assert.equal((await row(me.id)).facts.approved_via, 'auto');
    const [auto] = await sql()<{ via: string }[]>`SELECT via FROM builder_points WHERE builder_id = ${me.id} AND week = ${LAST}`;
    assert.equal(auto.via, 'auto', 'fix round 2 (b): recorded as the automatic add');
    const approve = weekUrl({ builderId: me.id, key: me.key, monday: LAST, action: 'approve' });
    assert.match(await html(await weekPost(req(approve, 'POST'))), /Confirmed\./);
    assert.equal((await row(me.id)).facts.approved_via, 'email', 'the builder\'s own yes counts');
  }),
);

test('(d) GET /api/week changes nothing; POST approves with via email and awards points', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    const me = await builder('med');
    const approve = weekUrl({ builderId: me.id, key: me.key, monday: LAST, action: 'approve' });
    const page = await weekGet(req(approve));
    assert.equal(page.status, 200);
    const body = await html(page);
    assert.match(body, new RegExp(WEEK_TEXT.title));
    assert.match(body, /Last week you finished at Shipping 40\./);
    assert.match(body, /<form method="post"[^>]*>.*Looks right<\/button>/s);
    assert.ok(!body.includes(me.key), 'the page never names the repo');
    assert.equal((await row(me.id)).facts.approved, undefined, 'GET changed nothing');
    assert.equal(await pointsTotal(me.id), 0);
    const done = await weekPost(req(approve, 'POST'));
    assert.equal(done.status, 200);
    const doneBody = await html(done);
    assert.match(doneBody, /Confirmed\. Your page shows it\./);
    assert.ok(doneBody.includes(`https://earnkit.com/${me.handle}`), 'a link to the page');
    const r = await row(me.id);
    assert.equal(r.facts.approved, true);
    assert.equal(r.facts.approved_via, 'email');
    const pts = await pointsTotal(me.id);
    assert.ok(pts > 0, 'points for the week');
    const [p] = await sql()<{ via: string }[]>`SELECT via FROM builder_points WHERE builder_id = ${me.id} AND week = ${LAST}`;
    assert.equal(p.via, 'email');
    // Idempotent: again is the same page, nothing twice.
    const at = r.facts.approved_at;
    assert.match(await html(await weekPost(req(approve, 'POST'))), /Confirmed\./);
    assert.equal((await row(me.id)).facts.approved_at, at, 'the first approval stands');
    assert.equal(await pointsTotal(me.id), pts);
    // Hide: GET shows the button, POST hides.
    const hide = weekUrl({ builderId: me.id, key: me.key, monday: LAST, action: 'hide' });
    assert.match(await html(await weekGet(req(hide))), /Hide this week<\/button>/);
    assert.equal((await row(me.id)).hidden, false);
    assert.match(await html(await weekPost(req(hide, 'POST'))), /Hidden\. Your page no longer shows this week\./);
    assert.equal((await row(me.id)).hidden, true);
    assert.match(await html(await weekPost(req(hide, 'POST'))), /Hidden\./, 'idempotent');
    // A bad token: 400, nothing changes; a token for another repo (the main project changed) is not valid.
    for (const bad of [`${approve.slice(0, -2)}xx`, 'https://earnkit.com/api/week?t=nope', weekUrl({ builderId: me.id, key: 'someone/else', monday: LAST, action: 'hide' })]) {
      const g = await weekGet(req(bad));
      assert.equal(g.status, 400);
      assert.match(await html(g), /This link is not valid\./);
      assert.equal((await weekPost(req(bad, 'POST'))).status, 400);
    }
  }),
);

const post = (url: string, form: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
const seenIn = (body: string) => body.match(new RegExp(`name="${SEEN_FIELD}" value="([0-9a-f]{32})"`))?.[1] ?? null;

test('(d2) fix round: Looks right binds to the summary the page showed; changed since, it asks again; no summary shown binds none', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    const me = await builder('mesum');
    await sql()`UPDATE project_updates SET summary = 'Fixed the login loop.' WHERE builder_id = ${me.id} AND week = ${LAST}`;
    const approve = weekUrl({ builderId: me.id, key: me.key, monday: LAST, action: 'approve' });
    const body = await html(await weekGet(req(approve)));
    assert.match(body, /Fixed the login loop\./);
    const seen = seenIn(body);
    assert.equal(seen, summaryHash('Fixed the login loop.'), 'the form carries the shown summary\'s hash');
    // Changed after the page was opened: not approved, the page again with the new text.
    await sql()`UPDATE project_updates SET summary = 'Fixed the login loop and the timer.' WHERE builder_id = ${me.id} AND week = ${LAST}`;
    const again = await weekPost(post(approve, { [SEEN_FIELD]: seen! }));
    assert.equal(again.status, 409);
    const againBody = await html(again);
    assert.match(againBody, new RegExp(WEEK_TEXT.changed));
    assert.match(againBody, /Fixed the login loop and the timer\./);
    assert.equal((await row(me.id)).facts.approved, undefined, 'nothing approved');
    // The new page's hash approves, bound to the new text.
    assert.match(await html(await weekPost(post(approve, { [SEEN_FIELD]: seenIn(againBody)! }))), /Confirmed\./);
    assert.equal((await row(me.id)).facts.approved_summary, 'Fixed the login loop and the timer.');

    // No hash (an older page, or one that showed no summary): approved, bound to no text.
    const other = await builder('menos');
    await sql()`UPDATE project_updates SET summary = 'Added search.' WHERE builder_id = ${other.id} AND week = ${LAST}`;
    const link = weekUrl({ builderId: other.id, key: other.key, monday: LAST, action: 'approve' });
    assert.match(await html(await weekPost(post(link))), /Confirmed\./);
    assert.equal((await row(other.id)).facts.approved, true);
    assert.equal((await row(other.id)).facts.approved_summary, null, 'never bound to text the page did not show');
    // The week before last shows no summary, so its form carries no hash.
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts, summary)
      VALUES (${other.id}, ${other.key}, ${BEFORE}, '{"checked": true, "shipped_code": {"n": 2}}'::jsonb, 'Added filters.')`;
    const before = await html(await weekGet(req(weekUrl({ builderId: other.id, key: other.key, monday: BEFORE, action: 'approve' }))));
    assert.ok(!before.includes('Added filters.') && seenIn(before) === null);
    // A hash for text that is not stored is refused.
    assert.equal((await weekPost(post(weekUrl({ builderId: other.id, key: other.key, monday: BEFORE, action: 'approve' }), { [SEEN_FIELD]: summaryHash('Something else.') }))).status, 409);
  }),
);

test('(e) an unchecked week is pending: not sent, not considered', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    await clearCounters();
    const me = await builder('mee', { checked: false });
    await subscribe(me.id, `mee${me.id}@example.com`);
    const { sent, mail } = recorder();
    const r = await sendDigests(new Date(), { mail, only: [me.id] });
    assert.deepEqual(r, { sent: 0, skipped: 0, capped: false, pending: 1 });
    assert.equal(sent.length, 0);
    const [s] = await sql()<{ c: Date | null; s: Date | null }[]>`
      SELECT last_considered_at AS c, last_sent_at AS s FROM digest_subscriptions WHERE installation_id = ${me.id}`;
    assert.deepEqual(s, { c: null, s: null });
    // The weekly job writes the week: the next run sends it.
    await sql()`UPDATE project_updates SET facts = facts || '{"checked": true}'::jsonb WHERE builder_id = ${me.id} AND week = ${LAST}`;
    const later = await sendDigests(new Date(MONDAY + 3_600_000), { mail, only: [me.id] });
    assert.equal(later.sent, 1);
    assert.match(sent[0]!.text, /^(?:[^\n]*\n\n)?Your week is ready, /);
  }),
);

test('(f) the connect yes asks for the address once; tell weekly_email yes with an address subscribes', db, () =>
  withEnv(ON, async () => {
    assert.equal(EMAIL_QUESTION, 'Want deadline alerts and a Monday summary by email? Reply with the address.'); // v4.7 T5
    assert.equal(EMAIL_ON, "Done. You'll get deadline alerts and a Monday summary.");
    await freshBoard();
    const me = await builder('mef');
    // v4.8 Task 1: the connect offer is one of the older ranked asks, after the path has no program to name.
    await pathQuiet(me.id);
    // Backfill-style weeks to confirm at connect.
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES
      (${me.id}, ${me.key}, ${BEFORE}, ${sql().json({ checked: true, shipped_code: { n: 2 } } as never)})`;
    await mcpCall(ctx(me.id), 'find', {});
    const yes = await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } });
    const s = show(yes);
    // Task 16 step 4 with no Best fit: the email question, last.
    assert.ok(s.endsWith(`\n${EMAIL_QUESTION}`), s);
    assert.equal(questions(s), 1, s);
    // GTM W2: the email question is a move_up.
    assert.match(JSON.stringify(yes.reply?.move_up ?? {}), /"kind":"weekly_email".*call tell with weekly_email: \{ answer: 'yes', email \}/);
    void EMAIL_NOTE;
    // Asked once: a share yes later asks nothing.
    await oldShareOffer(me.id, { key: me.key, week: LAST, shown_week: isoWeekOf(new Date()) });
    const share = show(await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'share', project_key: me.key, answer: 'yes' } }));
    assert.doesNotMatch(share, /by email/, share);
    const sub = await mcpCall(ctx(me.id), 'tell', { weekly_email: { answer: 'yes', email: 'Me@Example.com' } });
    assert.equal(show(sub), EMAIL_ON);
    const [d] = await sql()<{ email: string; opted: boolean }[]>`
      SELECT email, opted_in_at IS NOT NULL AS opted FROM digest_subscriptions WHERE installation_id = ${me.id}`;
    assert.deepEqual(d, { email: 'me@example.com', opted: true });
  }),
);

test('(g) the first share yes asks for the address when it was never asked', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    const me = await builder('meg');
    await oldShareOffer(me.id, { key: me.key, week: LAST, shown_week: isoWeekOf(new Date()) });
    const yes = await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'share', project_key: me.key, answer: 'yes' } });
    const s = show(yes);
    assert.equal(s, `Thanks. Last week is on your page.\n${EMAIL_QUESTION}`);
    assert.equal(questions(s), 1);
    assert.match(JSON.stringify(yes.reply?.move_up ?? {}), /weekly_email/);
    // Without the email on, nothing is asked.
    await withEnv({ RESEND_API_KEY: undefined }, async () => {
      const other = await builder('meg2');
      await oldShareOffer(other.id, { key: other.key, week: LAST, shown_week: isoWeekOf(new Date()) });
      assert.equal(show(await mcpCall(ctx(other.id), 'tell', { move_up: { kind: 'share', project_key: other.key, answer: 'yes' } })).startsWith('Thanks. Last week is on your page.\n\n'), true);
    });
  }),
);

test('(h) fix round 1: Hide hides a facts-only week (no text): it leaves the profile log and the feed', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    const me = await builder('meh');
    await sql()`UPDATE project_updates SET text = NULL, summary = 'Fixed the login loop' WHERE builder_id = ${me.id} AND week = ${LAST}`;
    await rankFeed(new Date());
    const inLog = async () => (await profileData(me.id, new Date()))!.log.some((c) => c.week === LAST);
    const inFeed = async () => (await feedWeeks(new Date(), { only: [me.id] })).some((w) => w.monday === LAST && w.cards.length > 0);
    assert.equal(await inLog(), true, 'shown before');
    assert.equal(await inFeed(), true, 'in the feed before');
    const hide = weekUrl({ builderId: me.id, key: me.key.toUpperCase(), monday: LAST, action: 'hide' });
    assert.match(await html(await weekPost(req(hide, 'POST'))), /Hidden\. Your page no longer shows this week\./);
    assert.equal((await row(me.id)).hidden, true);
    assert.equal(await inLog(), false);
    assert.equal(await inFeed(), false);
  }),
);

test('(i) fix round 1: Looks right after Hide shows the week again', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    const me = await builder('mei');
    await weekPost(req(weekUrl({ builderId: me.id, key: me.key, monday: LAST, action: 'hide' }), 'POST'));
    assert.equal((await row(me.id)).hidden, true);
    assert.match(await html(await weekPost(req(weekUrl({ builderId: me.id, key: me.key, monday: LAST, action: 'approve' }), 'POST'))), /Confirmed\./);
    const r = await row(me.id);
    assert.deepEqual([r.hidden, r.facts.approved, r.facts.approved_via], [false, true, 'email']);
  }),
);

test('(j) fix round 1: a link older than the week before last has expired; nothing changes', db, () =>
  withEnv(ON, async () => {
    const now = new Date();
    assert.equal(weekLinkLive(LAST, now), true);
    assert.equal(weekLinkLive(BEFORE, now), true, 'the week before');
    assert.equal(weekLinkLive(EXPIRED, now), false);
    assert.equal(weekLinkLive(RUNNING, now), false, 'the running week');
    await freshBoard();
    const me = await builder('mej');
    const OLD = EXPIRED;
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${me.id}, ${me.key}, ${OLD}, ${sql().json({ checked: true, shipped_code: { n: 1 } } as never)})`;
    for (const action of ['approve', 'hide'] as const) {
      const url = weekUrl({ builderId: me.id, key: me.key, monday: OLD, action });
      for (const r of [await weekGet(req(url)), await weekPost(req(url, 'POST'))]) {
        assert.equal(r.status, 400);
        assert.match(await html(r), /This link has expired\./);
      }
    }
    const [old] = await sql()<{ facts: Record<string, unknown>; hidden: boolean }[]>`SELECT facts, hidden FROM project_updates WHERE builder_id = ${me.id} AND week = ${OLD}`;
    assert.deepEqual([old.facts.approved, old.hidden], [undefined, false]);
    assert.equal(await pointsTotal(me.id), 0);
  }),
);

test('v3.2: confirming last week offers its one-tap post (one draft, reused); the email of an approved week carries it', db, () =>
  withEnv(ON, async () => {
    await freshBoard();
    await clearCounters();
    const me = await builder('mepost');
    await sql()`UPDATE project_updates SET summary = 'Shipped the export button.' WHERE builder_id = ${me.id} AND week = ${LAST}`;
    const approve = weekUrl({ builderId: me.id, key: me.key, monday: LAST, action: 'approve' });
    const code = (b: string) => b.match(/href="[^"]*\/post\/([a-z2-7]{10})">Post it on X</)?.[1] ?? null;
    const form = { [SEEN_FIELD]: seenIn(await html(await weekGet(req(approve))))! };
    const first = await html(await weekPost(post(approve, form)));
    assert.match(first, /Confirmed\./);
    const c1 = code(first);
    assert.ok(c1, first);
    assert.equal(code(await html(await weekPost(post(approve, form)))), c1, 'the same draft, never a second one');
    await subscribe(me.id, `mepost${me.id}@example.com`);
    const { sent, mail } = recorder();
    assert.equal((await sendDigests(new Date(MONDAY + 3_600_000), { mail, only: [me.id] })).sent, 1);
    assert.match(sent[0]!.text, new RegExp(`Your post is ready to share: \\S+/post/${c1}\\n`));
    assert.doesNotMatch(sent[0]!.text, /Looks right/, 'approved: no approve link');
  }),
);
