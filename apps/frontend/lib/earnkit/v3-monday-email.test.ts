import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { person, withEnv } from './fixtures/find';
import { periodKey } from './free-tier';
import { LIVE_CALIBRATION_V2 } from './score-calibration';
import { openShare } from './weekly-moment';
import { pointsTotal } from './points';
import { isoWeekOf } from './weeks';
import {
  DIGEST_HOUR_UTC,
  EMAIL_NOTE,
  EMAIL_ON,
  EMAIL_QUESTION,
  digestBody,
  emailQuestionFor,
  sendDigests,
  weekStart,
  type DigestFacts,
  type Mailer,
} from './digest';
import { WEEK_TEXT, weekGet, weekPost, weekTarget, weekToken, weekUrl, weekVerify } from './week-links';
import { WEEKLY_HOUR_UTC } from './week-facts';

/**
 * v3 Stage 1 Task 6 (spec 5.4): the Monday email is the moment. Last week's lines, then Looks right and Hide links
 * that work without the agent (GET shows, only POST acts), sent once the weekly job wrote the week; the address is
 * asked once after activation.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'monday-email-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// Monday Oct 12, 16:15 UTC: after the weekly job's hour and the email's. Last finished week: Oct 5.
const MONDAY = Date.parse('2026-10-12T16:15:00Z');
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
const LAST = '2026-10-05';
const ON = { RESEND_API_KEY: 're_test_never_used' };

/** A ranked person with a ranked day last week and, unless `checked: false`, the weekly job's row for it. */
async function builder(tag: string, o: { checked?: boolean } = {}) {
  const key = `${tag}${RUN}/app`;
  const handle = `${tag}${RUN}`.slice(0, 15);
  const id = await person({ main: key, claimed: handle, ranked: true, projects: [{ key, name: 'App', confirmed: true }] });
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held, ranked)
    VALUES (${id}, '2026-10-11', 40, 0, '{}'::jsonb, '{}'::jsonb, 'v2', ${LIVE_CALIBRATION_V2}, false, true)`;
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
  const secret = 's3cret';
  const t = weekToken({ builderId: 42, key: 'Lee/TipJar', monday: LAST, action: 'approve' }, secret);
  assert.doesNotMatch(t, /tipjar|lee/i, 'the token never names the repo');
  assert.match(t, /^42\.2026-10-05\.approve\.[A-Za-z0-9_-]{43}$/);
  const parts = weekTarget(t, secret)!;
  assert.deepEqual({ ...parts, mac: undefined }, { builderId: 42, monday: LAST, action: 'approve', mac: undefined });
  assert.equal(weekVerify(parts, 'lee/tipjar', secret), true, 'the key is matched case-insensitively');
  assert.equal(weekVerify(parts, 'lee/other', secret), false, 'another repo');
  assert.equal(weekVerify(parts, 'lee/tipjar', 'other'), false, 'another secret');
  // Changing the id, the week or the action, or one character of the mac, breaks it.
  for (const bad of [t.replace(/^42/, '43'), t.replace('2026-10-05', '2026-09-28'), t.replace('approve', 'hide'), `${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`]) {
    const p = weekTarget(bad, secret);
    assert.ok(p === null || !weekVerify(p, 'lee/tipjar', secret), bad);
  }
  for (const junk of ['', 'x', '42.2026-10-06.approve.' + 'a'.repeat(43), '42.2026-10-05.delete.' + 'a'.repeat(43), `0.${LAST}.hide.${'a'.repeat(43)}`])
    assert.equal(weekTarget(junk, secret), null, junk);
  assert.equal(weekTarget(t, ''), null, 'no secret');
  assert.match(weekUrl({ builderId: 42, key: 'lee/tipjar', monday: LAST, action: 'hide' }), /^https:\/\/earnkit\.com\/api\/week\?t=42\.2026-10-05\.hide\./);
  assert.equal(DIGEST_HOUR_UTC, 16);
  assert.ok(DIGEST_HOUR_UTC > WEEKLY_HOUR_UTC, 'the email goes after the weekly job');
  assert.equal(weekStart(new Date('2026-10-12T15:59:00Z')).toISOString(), '2026-10-05T16:00:00.000Z');
  assert.equal(weekStart(new Date('2026-10-12T16:00:00Z')).toISOString(), '2026-10-12T16:00:00.000Z');
});

test('(b) digestBody with a week leads with the moment and both links', () => {
  const base: DigestFacts = { newPrograms: [], wins: [], deadlines: [], week: null, handle: null };
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
  const done = digestBody({ ...base, week: { ...week, approved: true } })!;
  assert.doesNotMatch(done.text, /Looks right|Hide this week|https:/);
  for (const x of [b, both, done]) {
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
    assert.equal(m.subject, 'Your week on EarnKit: Shipping 40 · #1 of 1 builder');
    assert.ok(m.text.startsWith('Last week you finished at Shipping 40, #1.'), m.text);
    assert.match(m.text, /\n\nLooks right: https:\/\/earnkit\.com\/api\/week\?t=\S+\nHide this week: https:\/\/earnkit\.com\/api\/week\?t=\S+/);
    assert.ok(!m.text.includes(me.key.split('/')[0]!), 'no link names the repo');
    assert.match(m.text, /Unsubscribe: https:\/\/earnkit\.com\/api\/digest\/unsubscribe\?t=/);
    const approve = m.text.match(/Looks right: (\S+)/)![1]!;
    const t = new URL(approve).searchParams.get('t')!;
    assert.deepEqual({ ...weekTarget(t)!, mac: '' }, { builderId: me.id, monday: LAST, action: 'approve', mac: '' });
    assert.equal(weekVerify(weekTarget(t)!, me.key), true);
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
    assert.match(body, /Last week you finished at Shipping 40, #1\./);
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
    assert.match(sent[0]!.text, /^Last week you finished/);
  }),
);

test('(f) the connect yes asks for the address once; tell weekly_email yes with an address subscribes', db, () =>
  withEnv(ON, async () => {
    assert.equal(EMAIL_QUESTION, 'Want the Monday summary by email? Reply with the address.');
    assert.equal(emailQuestionFor('a@b.co'), 'Want the Monday summary by email at a@b.co?');
    assert.equal(EMAIL_ON, 'Done. Every Monday, once your week is written.');
    await freshBoard();
    const me = await builder('mef');
    // Backfill-style weeks to confirm at connect.
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES
      (${me.id}, ${me.key}, '2026-09-28', ${sql().json({ checked: true, shipped_code: { n: 2 } } as never)})`;
    await mcpCall(ctx(me.id), 'find', {});
    const yes = await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'connect', project_key: me.key, answer: 'yes' } });
    const s = show(yes);
    assert.ok(s.endsWith(`\n${EMAIL_QUESTION}`), s);
    assert.equal(questions(s), 1, s);
    assert.match(String(yes.reply?.agent_note ?? ''), new RegExp(EMAIL_NOTE.replace(/[.']/g, '.')));
    // Asked once: a share yes later asks nothing.
    await openShare(me.id, { key: me.key, week: LAST, shown_week: isoWeekOf(new Date()) });
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
    await openShare(me.id, { key: me.key, week: LAST, shown_week: isoWeekOf(new Date()) });
    const yes = await mcpCall(ctx(me.id), 'tell', { move_up: { kind: 'share', project_key: me.key, answer: 'yes' } });
    const s = show(yes);
    assert.equal(s, `Thanks. Last week is confirmed.\n${EMAIL_QUESTION}`);
    assert.equal(questions(s), 1);
    assert.match(String(yes.reply?.agent_note ?? ''), /weekly_email/);
    // Without the email on, nothing is asked.
    await withEnv({ RESEND_API_KEY: undefined }, async () => {
      const other = await builder('meg2');
      await openShare(other.id, { key: other.key, week: LAST, shown_week: isoWeekOf(new Date()) });
      assert.equal(show(await mcpCall(ctx(other.id), 'tell', { move_up: { kind: 'share', project_key: other.key, answer: 'yes' } })), 'Thanks. Last week is confirmed.');
    });
  }),
);
