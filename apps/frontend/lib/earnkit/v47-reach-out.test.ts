import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { ALERT_HOUR_UTC, alertBody, alertEvents, alertFooter, pickAlert, runAlertMail, type AlertEvent } from './alert-mail';
import { digestBody, EMAIL_QUESTION, resendMailer, type DigestFacts, type Mailer } from './digest';
import { periodKey } from './free-tier';
import { SERVER_INSTRUCTIONS } from './mcp';
import { CONTACT_EMAIL } from './policy';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { codesSettled } from './bench-find';

/**
 * v4.7 T5 (EarnKit speaks first): the alert emails (alert-mail.ts), the email ask, reply-to, the Monday standing and the
 * session-start instruction. Review Focus 5: an event is never mailed twice; the day cap holds with the digest first;
 * an unsubscribed address gets nothing. Never a real email: every mailer here is fake.
 */
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v47-reach-out-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await dropRunPrograms();
  await sql().end();
});

const DAY = 86_400_000;
const BANNED = /—|\bcoins?\b|\bpoints?\b/i;

const closing = (o: Partial<Extract<AlertEvent, { kind: 'closing' }>> = {}): AlertEvent =>
  ({ kind: 'closing', key: 'closing:base-builder-grants:2026-11-01', program: 'Base Builder Grants', day: 'Nov 1', amount: '$5,000', draft: true, ...o });
const accepted = (o: Partial<Extract<AlertEvent, { kind: 'accepted' }>> = {}): AlertEvent =>
  ({ kind: 'accepted', key: 'accepted:base-batches', program: 'Base Batches', link: 'https://earnkit.com/me/post/abcdefghij', ...o });
const fresh = (o: Partial<Extract<AlertEvent, { kind: 'new' }>> = {}): AlertEvent =>
  ({ kind: 'new', key: 'new:arc-grants', program: 'Arc Grants', amount: '$10,000', when: 'closes Nov 18', project: 'recipe-kit', ...o });

test('alert emails: exact subject and body for each kind (exact copy)', () => {
  assert.deepEqual(alertBody(closing()), {
    subject: 'Base Builder Grants closes Nov 1',
    text: 'Base Builder Grants closes Nov 1, $5,000.\n\nYour draft is ready in your agent.',
  });
  assert.deepEqual(alertBody(closing({ draft: false })), {
    subject: 'Base Builder Grants closes Nov 1',
    text: 'Base Builder Grants closes Nov 1, $5,000.\n\nAsk your agent to draft it.',
  });
  assert.equal(alertBody(closing({ amount: null })).text.split('\n')[0], 'Base Builder Grants closes Nov 1.');
  assert.deepEqual(alertBody(accepted()), {
    subject: 'You got into Base Batches',
    text: 'You got into Base Batches.\n\nYour post is ready to share: https://earnkit.com/me/post/abcdefghij',
  });
  assert.deepEqual(alertBody(fresh()), {
    subject: 'New: Arc Grants, $10,000',
    text: 'Arc Grants opened, $10,000, closes Nov 18.\n\nrecipe-kit fits it. Ask your agent to draft it.',
  });
  assert.deepEqual(alertBody(fresh({ amount: null, when: 'rolling' })), {
    subject: 'New: Arc Grants',
    text: 'Arc Grants opened, rolling.\n\nrecipe-kit fits it. Ask your agent to draft it.',
  });
  for (const e of [closing(), closing({ draft: false }), accepted(), fresh()]) {
    const b = alertBody(e);
    assert.doesNotMatch(`${b.subject}\n${b.text}`, BANNED);
    assert.doesNotMatch(b.text, /0x[0-9a-f]{40}|revenue|key/i);
  }
});

test('the highest event goes first: accepted > closing > new', () => {
  assert.equal(pickAlert([fresh(), closing(), accepted()])?.kind, 'accepted');
  assert.equal(pickAlert([fresh(), closing()])?.kind, 'closing');
  assert.equal(pickAlert([fresh()])?.kind, 'new');
  assert.equal(pickAlert([]), null);
});

test('the email ask is the exact copy', () => {
  assert.equal(EMAIL_QUESTION, 'Want deadline alerts and a Monday summary by email? Reply with the address.');
});

test('the instructions start with the session-start line and stay under 800 characters', () => {
  assert.ok(
    SERVER_INSTRUCTIONS.startsWith(
      'Call find at the start of every session, before the builder asks, and whenever they ask about money, grants or where they stand. If the builder asked something,',
    ),
  );
  assert.ok(SERVER_INSTRUCTIONS.length < 800, String(SERVER_INSTRUCTIONS.length));
});

test('Resend gets reply_to: CONTACT_EMAIL', async () => {
  const real = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await resendMailer('re_test')({ to: 'a@b.co', from: 'EarnKit <digest@earnkit.com>', subject: 's', text: 't', headers: {}, idempotencyKey: 'k' });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(body!.reply_to, CONTACT_EMAIL);
  assert.equal(CONTACT_EMAIL, 'j@earnkit.com');
});

test('the Monday digest leads with the standing paragraph; the standing alone never makes an email', () => {
  const f: DigestFacts = { week: null, handle: null, money: ['Base closes in 2 days. Your draft is one yes away.'], newPrograms: [], wins: [], deadlines: [] };
  const standing = 'Score 77 · #1 of 40 builders. 6 weeks shipping in a row. No grants won yet.';
  assert.ok(digestBody({ ...f, standing })!.text.startsWith(`${standing}\n\nBase closes in 2 days.`));
  assert.equal(digestBody({ ...f, money: [], standing }), null);
});

// ---- the run (database) ----

const RUN = `${process.pid}-${randomBytes(3).toString('hex')}`;
/** A Tuesday at ALERT_HOUR_UTC, far from other files' days (each file has its own database anyway). */
const T0 = new Date(Date.UTC(2031, 0, 7, ALERT_HOUR_UTC, 5));
const at = (days: number) => new Date(T0.getTime() + days * DAY);

/** An installation (its own builder) with an opted-in subscription, not due a digest this week unless `digestDue`. */
async function subscriber(o: { unsubscribed?: boolean; digestDue?: boolean } = {}) {
  const [i] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v47ro-${RUN}-${randomBytes(6).toString('hex')}`}) RETURNING id`;
  await sql()`
    INSERT INTO digest_subscriptions (installation_id, login, email, asked_at, opted_in_at, unsubscribed_at, last_sent_at)
    VALUES (${i.id}, '', ${`b${i.id}@example.com`}, now(), ${new Date('2026-10-01')}, ${o.unsubscribed ? new Date('2026-10-02') : null},
      ${o.digestDue ? null : new Date('2099-01-01')})`;
  return i.id;
}
type Sent = Parameters<Mailer>[0];
const recorder = () => {
  const sent: Sent[] = [];
  const mail: Mailer = async (m) => {
    sent.push(m);
  };
  return { sent, mail };
};
const fixed = (events: AlertEvent[]) => async () => events;
const sentRows = async (id: number) => (await sql()<{ event_key: string }[]>`SELECT event_key FROM alert_mail_sent WHERE builder_id = ${id} ORDER BY sent_at`).map((r) => r.event_key);
const setDayUsed = async (d: Date, used: number) => {
  await sql()`DELETE FROM free_tier_usage WHERE name IN ('resendDay', 'resendMonth')`;
  if (used > 0) await sql()`INSERT INTO free_tier_usage (name, period, used) VALUES ('resendDay', ${periodKey('day', d)}, ${used})`;
};

test('one email a builder a day, the highest first; an event is never sent twice across runs', { skip: db.skip }, async () => {
  await setDayUsed(T0, 0);
  const id = await subscriber();
  const events = fixed([fresh(), closing(), accepted()]);
  const { sent, mail } = recorder();
  const r1 = await runAlertMail(at(0), { mail, events, only: [id], force: true });
  assert.equal(r1.sent, 1);
  assert.equal(sent[0].subject, 'You got into Base Batches');
  assert.equal(sent[0].to, `b${id}@example.com`);
  assert.ok(sent[0].text.includes('\n\nDeadline alerts and a Monday summary. Unsubscribe: https://earnkit.com/api/digest/unsubscribe?t='));
  assert.ok(sent[0].headers['List-Unsubscribe']?.startsWith('<https://earnkit.com/api/digest/unsubscribe?t='));
  assert.equal(sent[0].idempotencyKey, `alert-${id}-accepted:base-batches`);
  // Same day, a later run: nothing more.
  assert.equal((await runAlertMail(new Date(at(0).getTime() + 30 * 60_000), { mail, events, only: [id], force: true })).sent, 0);
  // Next days: closing, then new, then nothing (each event once).
  await runAlertMail(at(1), { mail, events, only: [id], force: true });
  await runAlertMail(at(2), { mail, events, only: [id], force: true });
  assert.equal((await runAlertMail(at(3), { mail, events, only: [id], force: true })).sent, 0);
  assert.deepEqual(sent.map((m) => m.subject), ['You got into Base Batches', 'Base Builder Grants closes Nov 1', 'New: Arc Grants, $10,000']);
  assert.deepEqual(await sentRows(id), ['accepted:base-batches', 'closing:base-builder-grants:2026-11-01', 'new:arc-grants']);
});

test('two runs at once send one email', { skip: db.skip }, async () => {
  await setDayUsed(T0, 0);
  const id = await subscriber();
  const { sent, mail } = recorder();
  const slow: Mailer = async (m) => {
    await new Promise((r) => setTimeout(r, 50));
    await mail(m);
  };
  const [a, b] = await Promise.all([
    runAlertMail(at(0), { mail: slow, events: fixed([closing()]), only: [id], force: true }),
    runAlertMail(at(0), { mail: slow, events: fixed([closing()]), only: [id], force: true }),
  ]);
  assert.equal(a.sent + b.sent, 1);
  assert.equal(sent.length, 1);
});

test('an unsubscribed address gets nothing', { skip: db.skip }, async () => {
  await setDayUsed(T0, 0);
  const id = await subscriber({ unsubscribed: true });
  const { sent, mail } = recorder();
  assert.equal((await runAlertMail(at(0), { mail, events: fixed([accepted()]), only: [id], force: true })).sent, 0);
  assert.equal(sent.length, 0);
  assert.deepEqual(await sentRows(id), []);
});

test('the day budget holds after the digest: every digest still due keeps its slot', { skip: db.skip }, async () => {
  const d = at(5);
  const id = await subscriber();
  const due = await subscriber({ digestDue: true });
  const { sent, mail } = recorder();
  // 99 used today, one digest still due: 99 + 1 alert + 1 digest would cross 100.
  await setDayUsed(d, 99);
  const r = await runAlertMail(d, { mail, events: fixed([closing()]), only: [id], force: true });
  assert.equal(r.sent, 0);
  assert.equal(r.capped, true);
  // The digest went: the last slot is the alert's.
  await sql()`UPDATE digest_subscriptions SET last_sent_at = ${d} WHERE installation_id = ${due}`;
  assert.equal((await runAlertMail(d, { mail, events: fixed([closing()]), only: [id], force: true })).sent, 1);
  const [u] = await sql()<{ used: number }[]>`SELECT used FROM free_tier_usage WHERE name = 'resendDay' AND period = ${periodKey('day', d)}`;
  assert.equal(u.used, 100);
  // Full: nothing more, for anyone.
  const other = await subscriber();
  assert.equal((await runAlertMail(d, { mail, events: fixed([closing()]), only: [other], force: true })).capped, true);
  assert.equal(sent.length, 1);
});

test('a failed send stores no sent row; the next run sends it', { skip: db.skip }, async () => {
  await setDayUsed(T0, 0);
  const id = await subscriber();
  const failing: Mailer = async () => {
    throw new Error('boom');
  };
  const r = await runAlertMail(at(0), { mail: failing, events: fixed([closing()]), only: [id], force: true });
  assert.equal(r.sent, 0);
  assert.deepEqual(await sentRows(id), []);
  const { sent, mail } = recorder();
  assert.equal((await runAlertMail(at(0), { mail, events: fixed([closing()]), only: [id], force: true })).sent, 1);
  assert.equal(sent[0].subject, 'Base Builder Grants closes Nov 1');
});

test('outside ALERT_HOUR_UTC, and without RESEND_API_KEY and no mailer, nothing runs', { skip: db.skip }, async () => {
  const id = await subscriber();
  const { sent, mail } = recorder();
  assert.equal((await runAlertMail(new Date(T0.getTime() - 3_600_000), { mail, events: fixed([closing()]), only: [id] })).sent, 0);
  assert.equal((await runAlertMail(T0, { events: fixed([closing()]), only: [id], force: true })).sent, 0);
  assert.equal(sent.length, 0);
});

test('alertEvents reads a closing entry (draft ready) and an accepted outcome post', { skip: db.skip }, async () => {
  const now = new Date();
  const base = committedProgram('base-builder-grants');
  const ends = new Date(now.getTime() + 2 * DAY);
  const pid = `v47-ro-${process.pid}-close`;
  const p = ProgramFile.parse({ ...base, id: pid, title: `Close ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  const id = await subscriber();
  await sql()`
    INSERT INTO projects (program_id, name, installation_id, confirmed_at, application)
    VALUES (${pid}, 'kit', ${id}, now(), ${sql().json({ answers: { what: 'A recipe planner on Base with 40 weekly users.' } } as never)})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, x_handle) VALUES (${id}, ${`v47ro${id}`}, ${`ro${id}`.slice(0, 15)})`;
  await sql()`
    INSERT INTO post_drafts (code, builder_id, moment, moment_key, shape, text, proof_url, created_at, expires_at)
    VALUES ('abcdefghij', ${id}, 'accepted', ${`accepted:${pid}`}, 'outcome', 'In.', 'https://x.com/base/status/1', ${new Date(now.getTime() - 3_600_000)},
      ${new Date(now.getTime() + 30 * DAY)})`;
  const events = await alertEvents(id, now);
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(ends);
  assert.deepEqual(events.find((e) => e.kind === 'closing'), {
    kind: 'closing', key: `closing:${pid}:${ends.toISOString().slice(0, 10)}`, program: p.title, day, amount: '$5,000', draft: true,
  });
  const acc = events.find((e) => e.kind === 'accepted');
  assert.equal(acc?.key, `accepted:${pid}`);
  assert.equal(alertBody(acc!).subject, `You got into ${p.title}`);
  assert.match(alertBody(acc!).text, /Your post is ready to share: https:\/\/earnkit\.com\/.+\/post\/abcdefghij$/);
  assert.equal(pickAlert(events)?.kind, 'accepted');
  // A told "applied" leaves the closing entry out.
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, at) VALUES (${id}, '', ${pid}, 'applied', now())`;
  assert.equal((await alertEvents(id, now)).some((e) => e.kind === 'closing'), false);
});

test('the footer names both emails and has no banned words', () => {
  assert.doesNotMatch(alertFooter('https://earnkit.com/x'), BANNED);
});

test('alertEvents: a program opened within NEW_FIT_DAYS that a remembered repo fits is one new-fit event; an older one is none', { skip: db.skip }, async () => {
  const now = new Date();
  const tipjar = {
    key: 'alice/tipjar', name: 'TipJar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz',
    created_at: '2026-01-01T00:00:00Z', chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } },
    product: { score: 6, tier: 'product', missing: [] }, live_verified: true, said: null,
  };
  const [i] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, fit_repos) VALUES (${`v47ro-new-${RUN}`}, ${sql().json([tipjar] as never)}) RETURNING id`;
  const ids = [`v47-ro-${process.pid}-fresh`, `v47-ro-${process.pid}-old`];
  const program = (id: string, title: string, opened: Date) => sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, chains, opened_at, ends_at, max_award_usd)
    VALUES (${id}, 'o', ${title}, 'd', 'https://x', 'https://x', 'up to $10,000', 'up to $10,000', 'active', 'allowed', '{base}', ${opened},
      ${new Date(now.getTime() + 20 * DAY)}, 10000)`;
  await program(ids[0], `Fresh Grant ${RUN}`, new Date(now.getTime() - 2 * DAY));
  await program(ids[1], `Old Grant ${RUN}`, new Date(now.getTime() - 30 * DAY));
  const mine = (await alertEvents(i.id, now)).filter((e) => e.kind === 'new' && ids.some((id) => e.key === `new:${id}`));
  assert.equal(mine.length, 1);
  const e = mine[0] as Extract<AlertEvent, { kind: 'new' }>;
  assert.equal(e.key, `new:${ids[0]}`);
  assert.equal(e.program, `Fresh Grant ${RUN}`);
  assert.equal(e.project, 'TipJar');
  assert.equal(e.amount, '$10,000');
  assert.match(e.when, /^closes [A-Z][a-z]{2} \d{1,2}$/);
  assert.equal(alertBody(e).subject, `New: Fresh Grant ${RUN}, $10,000`);
});

test('R16: one score per email: with the standing on top, the week block and the subject carry none', () => {
  const week = {
    lines: ['Your week is ready, Maya. You shipped. Nice work.', '', 'Shipping score: 82, up 4', 'Streak: 5 weeks'],
    standing: { score: 82, rank: 3, total: 40 }, approveUrl: 'https://earnkit.com/api/week?t=a', hideUrl: 'https://earnkit.com/api/week?t=h', approved: true,
  };
  const b = digestBody({ standing: 'Score 85 · #2 of 40 builders. 5 weeks shipping in a row.', week, handle: null, money: [], newPrograms: [], wins: [], deadlines: [] })!;
  assert.equal(b.subject, 'Your week on EarnKit');
  assert.equal((`${b.subject}\n${b.text}`.match(/\bScore \d+|Shipping (?:score: )?\d+/gi) ?? []).length, 1, b.text);
  assert.ok(b.text.includes('Streak: 5 weeks'));
  // No standing (a shared client's subscription): the week keeps its own score, still the only one.
  const w = digestBody({ week, handle: null, money: [], newPrograms: [], wins: [], deadlines: [] })!;
  assert.match(w.text, /Shipping score: 82, up 4/);
});

test('fix round 1: a group with an unbound hosted member gets no alert (C2, sharedGroup)', { skip: db.skip }, async () => {
  await setDayUsed(T0, 0);
  const id = await subscriber();
  await sql()`INSERT INTO installations (token_hash, shared_client, builder_id) VALUES (${`v47ro-host-${RUN}-${id}`}, true, ${id})`;
  const { sent, mail } = recorder();
  assert.equal((await runAlertMail(at(0), { mail, events: fixed([closing()]), only: [id], force: true })).sent, 0);
  assert.equal(sent.length, 0);
  // Bound to X, the hosted member is a person: the group gets its alert.
  await sql()`UPDATE installations SET x_user_id = ${`x-${RUN}-${id}`} WHERE builder_id = ${id}`;
  assert.equal((await runAlertMail(at(0), { mail, events: fixed([closing()]), only: [id], force: true })).sent, 1);
});

test('fix round 1: an unsubscribe anywhere in the group stops the person\'s alerts', { skip: db.skip }, async () => {
  await setDayUsed(T0, 0);
  const id = await subscriber();
  const [m] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, builder_id) VALUES (${`v47ro-m-${RUN}-${id}`}, ${id}) RETURNING id`;
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email, asked_at, opted_in_at, unsubscribed_at)
    VALUES (${m.id}, '', 'other@example.com', now(), ${new Date('2026-10-01')}, ${new Date('2026-10-03')})`;
  const { sent, mail } = recorder();
  assert.equal((await runAlertMail(at(0), { mail, events: fixed([closing()]), only: [id], force: true })).sent, 0);
  assert.equal(sent.length, 0);
});

test('fix round 1: the month keeps room for next Monday\'s digests (every opted-in subscription)', { skip: db.skip }, async () => {
  const d = at(9);
  const id = await subscriber();
  // None due this week (that room is the day test's): only next Monday's digests are held here.
  await sql()`UPDATE digest_subscriptions SET last_sent_at = '2099-01-01'`;
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM digest_subscriptions WHERE opted_in_at IS NOT NULL AND unsubscribed_at IS NULL`;
  await sql()`DELETE FROM free_tier_usage WHERE name IN ('resendDay', 'resendMonth')`;
  // Exactly the alert plus every subscription's next digest would cross 3,000 by one.
  await sql()`INSERT INTO free_tier_usage (name, period, used) VALUES ('resendMonth', ${periodKey('month', d)}, ${3000 - n})`;
  const { mail } = recorder();
  assert.equal((await runAlertMail(d, { mail, events: fixed([closing()]), only: [id], force: true })).capped, true);
  await sql()`UPDATE free_tier_usage SET used = ${3000 - n - 1} WHERE name = 'resendMonth'`;
  assert.equal((await runAlertMail(d, { mail, events: fixed([closing()]), only: [id], force: true })).sent, 1);
});

test('fix round 1: a program declined within 30 days never arrives as a new fit', { skip: db.skip }, async () => {
  const now = new Date();
  const tipjar = {
    key: 'alice/tipjar', name: 'TipJar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz',
    created_at: '2026-01-01T00:00:00Z', chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } },
    product: { score: 6, tier: 'product', missing: [] }, live_verified: true, said: null,
  };
  const [i] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, fit_repos) VALUES (${`v47ro-dec-${RUN}`}, ${sql().json([tipjar] as never)}) RETURNING id`;
  const pid = `v47-ro-${process.pid}-declined`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, chains, opened_at, ends_at, max_award_usd)
    VALUES (${pid}, 'o', ${`Declined Grant ${RUN}`}, 'd', 'https://x', 'https://x', 'up to $10,000', 'up to $10,000', 'active', 'allowed', '{base}',
      ${new Date(now.getTime() - DAY)}, ${new Date(now.getTime() + 20 * DAY)}, 10000)`;
  const mine = async () => (await alertEvents(i.id, now)).filter((e) => e.key === `new:${pid}`);
  assert.equal((await mine()).length, 1, 'a fit before the no');
  await sql()`INSERT INTO builder_profiles (builder_id, slug, standing_seen) VALUES (${i.id}, ${`v47rodec${i.id}`},
    ${sql().json({ declined: { [`apply:${pid}`]: new Date(now.getTime() - 2 * DAY).toISOString() } } as never)})`;
  assert.equal((await mine()).length, 0, 'declined 2 days ago');
  await sql()`UPDATE builder_profiles SET standing_seen = ${sql().json({ declined: { [`apply:${pid}`]: new Date(now.getTime() - 31 * DAY).toISOString() } } as never)} WHERE builder_id = ${i.id}`;
  assert.equal((await mine()).length, 1, 'the no is over 30 days old');
});
