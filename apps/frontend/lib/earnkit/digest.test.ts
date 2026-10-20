import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { periodKey } from './free-tier';
import {
  DIGEST_FROM_DEFAULT,
  EMAIL_QUESTION,
  askWeeklyEmail,
  cleanEmail,
  digestBody,
  digestDue,
  digestEnabled,
  digestFacts,
  cleanName,
  NAME_MAX,
  digestUnsubscribeGet,
  digestUnsubscribePost,
  MailError,
  sendDigests,
  unsubTarget,
  idempotencyKey,
  saveWeeklyEmail,
  unsubscribe,
  EMAIL_SIGN_IN,
  unsubToken,
  weekStart,
  type DigestFacts,
  type Mailer,
} from './digest';
import { runCron } from './cron';

process.env.EARNKIT_AUTH_SECRET ??= 'digest-test-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const at = (iso: string) => new Date(iso);
const DAY = 86_400_000;

// ---- pure

test('10.1 weekStart: Monday 16:00 UTC; just before it, the Monday before; Sunday is the past Monday', () => {
  // 2026-10-12 is a Monday.
  assert.equal(weekStart(at('2026-10-12T15:59:00Z')).toISOString(), '2026-10-05T16:00:00.000Z');
  assert.equal(weekStart(at('2026-10-12T16:00:00Z')).toISOString(), '2026-10-12T16:00:00.000Z');
  assert.equal(weekStart(at('2026-10-11T23:00:00Z')).toISOString(), '2026-10-05T16:00:00.000Z');
  assert.equal(weekStart(at('2026-10-13T02:00:00Z')).toISOString(), '2026-10-12T16:00:00.000Z');
  assert.equal(weekStart(at('2026-10-18T20:00:00Z')).toISOString(), '2026-10-12T16:00:00.000Z');
});

test('10.2 digestDue: opt-in, unsubscribe, sent or considered this week; P17: a new opt-in waits for Monday', () => {
  const now = at('2026-10-13T10:00:00Z'); // Tuesday; this week started Monday 16:00
  const base = { opted_in_at: at('2026-10-01T00:00:00Z'), unsubscribed_at: null, last_sent_at: null, last_considered_at: null };
  assert.equal(digestDue({ ...base, opted_in_at: null }, now), false, 'never opted in');
  assert.equal(digestDue({ ...base, unsubscribed_at: at('2026-10-02T00:00:00Z') }, now), false, 'unsubscribed');
  assert.equal(digestDue({ ...base, last_sent_at: at('2026-10-12T17:00:00Z') }, now), false, 'sent this week');
  assert.equal(digestDue({ ...base, last_sent_at: at('2026-10-05T17:00:00Z') }, now), true, 'sent last week');
  assert.equal(digestDue(base, now), true, 'never sent');
  assert.equal(digestDue({ ...base, last_considered_at: at('2026-10-12T16:30:00Z') }, now), false, 'an empty one this week');
  assert.equal(digestDue({ ...base, last_considered_at: at('2026-10-06T16:30:00Z') }, now), true, 'empty last week');
  // P17: opted in after this week's start (Tuesday): nothing until next Monday 16:00.
  const tuesday = { ...base, opted_in_at: at('2026-10-13T09:00:00Z') };
  assert.equal(digestDue(tuesday, now), false);
  assert.equal(digestDue(tuesday, at('2026-10-19T15:59:00Z')), false);
  assert.equal(digestDue(tuesday, at('2026-10-19T16:00:00Z')), true);
});

const noFacts: DigestFacts = { week: null, handle: null, newPrograms: [], wins: [], deadlines: [] };
const avalanche = { title: 'Avalanche Mini Grant', repo: 'TipJar', prize_usd: 10_000, ends_at: at('2026-11-02T23:59:00Z') };

test('10.3 digestBody: nothing is null; new programs, wins, then your deadlines; plain words only', () => {
  assert.equal(digestBody(noFacts), null);
  const one = digestBody({ ...noFacts, newPrograms: [avalanche] })!;
  assert.ok(one.text.startsWith('New: Avalanche Mini Grant fits TipJar, $10,000, closes Nov 2.'), one.text);
  assert.equal(one.subject, 'New: Avalanche Mini Grant fits TipJar');
  const all = digestBody({
    ...noFacts,
    newPrograms: [avalanche, { title: 'Rolling Grant', repo: 'Ledger', prize_usd: null, ends_at: null }],
    wins: [{ name: 'PayLink', program: 'Arc Microgrants', prize_usd: 500 }, { name: 'Quiet', program: 'Base Batches', prize_usd: null }],
    deadlines: [
      { program: 'Arc Microgrants', what: 'closes', at: at('2026-10-15T00:00:00Z') },
      { program: 'Base Batches', what: 'decision', at: at('2026-10-17T00:00:00Z') },
    ],
  })!;
  const lines = all.text.split('\n');
  assert.deepEqual(lines.slice(0, 6), [
    'New: Avalanche Mini Grant fits TipJar, $10,000, closes Nov 2.',
    'New: Rolling Grant fits Ledger.',
    'Won: PayLink in Arc Microgrants, $500.',
    'Won: Quiet in Base Batches.',
    'Your Arc Microgrants: closes Oct 15.',
    'Your Base Batches: results due Oct 17.',
  ]);
  const wins = digestBody({ ...noFacts, wins: [{ name: 'PayLink', program: 'Arc', prize_usd: 500 }] })!;
  assert.equal(wins.subject, 'Your EarnKit week');
  for (const b of [one, all, wins]) {
    const t = `${b.subject}\n${b.text}`;
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, 'no emoji');
    assert.doesNotMatch(t, /—/, 'no em dash');
    assert.doesNotMatch(t, /\bcoin|vault|clanker\b/i);
    assert.doesNotMatch(t, /list_programs|tell_earnkit|confirm_entry|record_submission|launch_token/);
  }
});

test('names other people read: at most 40 characters, no URLs, emails or @handles', () => {
  assert.equal(NAME_MAX, 40);
  assert.equal(cleanName('PayLink', 'x'), 'PayLink');
  assert.equal(cleanName('Next.js Tip Jar', 'x'), 'Next.js Tip Jar');
  assert.equal(cleanName('PayLink https://scam.example/claim?x=1 now', 'x'), 'PayLink now');
  assert.equal(cleanName('PayLink (www.free-money.xyz) by @alice', 'x'), 'PayLink by');
  assert.equal(cleanName('Mail me: bob@evil.co for airdrop', 'x'), 'Mail me: for airdrop');
  assert.equal(cleanName('claim at freeeth.io/now', 'x'), 'claim at');
  assert.equal(cleanName('@alice', 'An EarnKit builder'), 'An EarnKit builder');
  assert.equal(cleanName('https://x.co', 'An EarnKit builder'), 'An EarnKit builder');
  const long = cleanName('The Extremely Long Project Name That Keeps Going And Going', 'x');
  assert.ok(long.length <= 40, long);
  assert.equal(long, 'The Extremely Long Project Name That');
  assert.equal(cleanName('A'.repeat(60), 'x'), 'A'.repeat(40));
  // In the email itself: every builder-supplied name, in the lines and the subject.
  const b = digestBody({
    ...noFacts,
    newPrograms: [{ title: 'Avalanche Mini Grant', repo: 'tipjar https://evil.example @bob', prize_usd: null, ends_at: null }],
    wins: [{ name: 'Win big at claim-now.xyz, DM @scammer or x@y.com, the longest project name ever written', program: 'Arc', prize_usd: 500 }],
    deadlines: [],
  })!;
  const all = `${b.subject}\n${b.text}`;
  assert.doesNotMatch(all, /https?:|www\.|@|claim-now|evil\.example/);
  assert.equal(b.subject, 'New: Avalanche Mini Grant fits tipjar');
  const won = b.text.split('\n').find((l) => l.startsWith('Won: '))!;
  const name = won.slice('Won: '.length, won.indexOf(' in Arc'));
  assert.ok(name.length <= 40, name);
});

test('10.4 unsubToken round-trips; another id, another login or a changed character is null', () => {
  const secret = 's3cret';
  const t = unsubToken(42, secret);
  assert.deepEqual(unsubTarget(t, secret), { installationId: 42, login: '' });
  assert.equal(unsubTarget(t, 'other'), null, 'another secret');
  const other = unsubToken(43, secret);
  assert.equal(unsubTarget(`42.${other.split('.')[1]}`, secret), null, "another id's mac");
  const i = t.length - 3;
  const flipped = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
  assert.equal(unsubTarget(flipped, secret), null, 'a changed character');
  for (const bad of ['', '42', '42.', 'x.y', `0.${t.split('.')[1]}`, `${t}a`]) assert.equal(unsubTarget(bad, secret), null, bad);
  assert.equal(unsubTarget(t, undefined), null, 'no secret');
  assert.throws(() => unsubToken(1, ''));
  // Ruling G21: a shared client's login subscription has its own token; another login's mac never passes.
  const alice = unsubToken({ installationId: 42, login: 'Alice' }, secret);
  assert.match(alice, /^42\.alice\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(unsubTarget(alice, secret), { installationId: 42, login: 'alice' });
  const bob = unsubToken({ installationId: 42, login: 'bob' }, secret);
  assert.equal(unsubTarget(`42.alice.${bob.split('.')[2]}`, secret), null, "bob's mac for alice");
  assert.equal(unsubTarget(`42.${alice.split('.')[2]}`, secret), null, "alice's mac for the installation");
});

test('review I2: the Idempotency-Key names the subscription and the week', () => {
  const start = weekStart(at('2026-10-13T10:00:00Z'));
  assert.equal(idempotencyKey({ installationId: 7, login: '' }, start), 'digest-7-2026-10-12T16:00:00.000Z');
  assert.equal(idempotencyKey({ installationId: 7, login: 'alice' }, start), 'digest-7-alice-2026-10-12T16:00:00.000Z');
});

test('digestEnabled: only with RESEND_API_KEY; the default sender', () => {
  assert.equal(digestEnabled({}), false);
  assert.equal(digestEnabled({ RESEND_API_KEY: ' ', EARNKIT_AUTH_SECRET: 's' }), false);
  // Review minor: without the secret no unsubscribe link can be signed, so the feature stays off.
  assert.equal(digestEnabled({ RESEND_API_KEY: 're_x' }), false);
  assert.equal(digestEnabled({ RESEND_API_KEY: 're_x', EARNKIT_AUTH_SECRET: 's' }), true);
  assert.equal(DIGEST_FROM_DEFAULT, 'EarnKit <digest@earnkit.com>');
  assert.equal(EMAIL_QUESTION, 'Want the Monday summary by email? Reply with the address.');
});

test('cleanEmail: a plain address only', () => {
  assert.equal(cleanEmail(' Alice@Example.com '), 'alice@example.com');
  assert.equal(cleanEmail('not an email'), null);
  assert.equal(cleanEmail('a@b.co, c@d.co'), null);
  assert.equal(cleanEmail(`${'a'.repeat(250)}@b.co`), null);
});

// ---- DB-gated (a fake Mailer: nothing is ever sent)

/** A Monday 15:00 UTC far from today, different per test (free-tier counters start at zero). */
const monday = (n: number) => {
  const d = weekStart(new Date(Date.UTC(2090 + n, (process.pid % 10) + 1, 20, 12)));
  return new Date(d.getTime() + 3_600_000);
};
const clearCounters = (now: Date, more: Date[] = []) =>
  sql()`DELETE FROM free_tier_usage WHERE (name = 'resendDay' AND period IN ${sql()([now, ...more].map((d) => periodKey('day', d)))})
    OR (name = 'resendMonth' AND period IN ${sql()([now, ...more].map((d) => periodKey('month', d)))})`;

type Sent = Parameters<Mailer>[0];
const recorder = () => {
  const sent: Sent[] = [];
  const mail: Mailer = async (m) => {
    sent.push(m);
  };
  return { sent, mail };
};

/** `n` installations, each opted in a week before `now`, plus one announced win in the last 7 days (so no email is empty). */
async function setup(tag: string, n: number, now: Date) {
  const insts = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) SELECT ${tag} || '-' || g FROM generate_series(1, ${n}) g RETURNING id`;
  const ids = insts.map((i) => i.id);
  await sql()`
    INSERT INTO digest_subscriptions (installation_id, email, opted_in_at)
    SELECT id, 'b' || id || '@example.com', ${new Date(now.getTime() - 7 * DAY)}::timestamptz FROM unnest(${ids}::int[]) id`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${tag}, 'o', 'Win Program', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
  const [p] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id) VALUES (${tag}, 'PayLink', ${ids[0]}) RETURNING id`;
  await sql()`
    INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, captured_at)
    VALUES (${p.id}, ${tag}, 'R1', 'won', 500, 'announcement', ${new Date(now.getTime() - DAY)})`;
  return ids;
}
/** Another announced win, the day before `d` (so the week of `d` has something to say). */
const winBefore = (tag: string, d: Date) => sql()`
  INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, captured_at)
  SELECT id, ${tag}, ${d.toISOString()}, 'won', 200, 'announcement', ${new Date(d.getTime() - DAY)} FROM projects WHERE program_id = ${tag}`;
async function teardown(tag: string, ids: number[]) {
  await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
  await sql()`DELETE FROM programs WHERE id = ${tag}`;
  await sql()`DELETE FROM installations WHERE id = ANY(${ids}::int[])`;
}
const subs = (ids: number[]) => sql()<{ installation_id: number; last_sent_at: Date | null; unsubscribed_at: Date | null }[]>`
  SELECT installation_id, last_sent_at, unsubscribed_at FROM digest_subscriptions WHERE installation_id = ANY(${ids}::int[]) ORDER BY installation_id`;
const used = async (name: string, period: string) =>
  (await sql()<{ used: number }[]>`SELECT used FROM free_tier_usage WHERE name = ${name} AND period = ${period}`)[0]?.used ?? 0;

test('10.5 two runs at once send each due subscription once; a 429 or 500 keeps its cap slot and the next run sends it', db, async () => {
  const now = monday(0);
  const tag = `digest-105-${process.pid}-${Date.now()}`;
  await clearCounters(now);
  const ids = await setup(tag, 6, now);
  try {
    const { sent, mail } = recorder();
    const slow: Mailer = async (m) => {
      await new Promise((r) => setTimeout(r, 20));
      await mail(m);
    };
    const [a, b] = await Promise.all([sendDigests(now, { mail: slow, only: ids }), sendDigests(now, { mail: slow, only: ids })]);
    assert.equal(a.sent + b.sent, 6);
    assert.deepEqual(sent.map((m) => m.to).sort(), ids.map((id) => `b${id}@example.com`).sort(), 'each once');
    assert.ok((await subs(ids)).every((s) => s.last_sent_at?.getTime() === now.getTime()));
    assert.equal(await used('resendDay', periodKey('day', now)), 6);
    // A third run the same week sends nothing.
    assert.equal((await sendDigests(new Date(now.getTime() + 3_600_000), { mail, only: ids })).sent, 0);

    // Next week: the mailer fails for one address (500), then rate-limits (429).
    const next = new Date(now.getTime() + 7 * DAY);
    await clearCounters(next);
    await winBefore(tag, next);
    const failing = (status: number, who: string): Mailer => async (m) => {
      if (m.to === who) throw new MailError(status);
      sent.push(m);
    };
    const who = `b${ids[0]}@example.com`;
    const r500 = await sendDigests(next, { mail: failing(500, who), only: ids });
    assert.deepEqual(r500, { sent: 5, skipped: 1, capped: false });
    assert.equal((await subs(ids)).find((s) => s.installation_id === ids[0])!.last_sent_at!.getTime(), now.getTime(), 'last_sent_at unchanged');
    assert.equal(await used('resendDay', periodKey('day', next)), 6, 'the failed send kept its slot');
    const r429 = await sendDigests(new Date(next.getTime() + 3_600_000), { mail: failing(429, who), only: ids });
    assert.deepEqual(r429, { sent: 0, skipped: 0, capped: true });
    assert.equal(await used('resendDay', periodKey('day', next)), 7);
    const ok = await sendDigests(new Date(next.getTime() + 7_200_000), { mail, only: ids });
    assert.equal(ok.sent, 1);
    assert.equal(sent.at(-1)!.to, who);
    // Review I2: the retry carries the same Idempotency-Key as the failed tries (Resend dedupes it).
    assert.equal(sent.at(-1)!.idempotencyKey, `digest-${ids[0]}-${weekStart(next).toISOString()}`);
    assert.ok(sent.every((m) => m.idempotencyKey.startsWith(`digest-${ids.find((i) => m.to === `b${i}@example.com`)}-`)));
  } finally {
    await teardown(tag, ids);
    await clearCounters(now, [new Date(now.getTime() + 7 * DAY)]);
  }
});

test('10.6 150 due on one day: 100 sent and capped; the next day the other 50; a month at 2,990 sends 10 more at most', db, async () => {
  const now = monday(1);
  const tomorrow = new Date(now.getTime() + DAY);
  const tag = `digest-106-${process.pid}-${Date.now()}`;
  await clearCounters(now, [tomorrow]);
  const ids = await setup(tag, 150, now);
  try {
    const { sent, mail } = recorder();
    const first = await sendDigests(now, { mail, only: ids, budgetMs: 120_000 });
    assert.deepEqual(first, { sent: 100, skipped: 0, capped: true });
    assert.equal(await used('resendDay', periodKey('day', now)), 100);
    const later = await sendDigests(new Date(now.getTime() + 3_600_000), { mail, only: ids });
    assert.deepEqual(later, { sent: 0, skipped: 0, capped: true }, 'the rest of that day waits');
    const second = await sendDigests(tomorrow, { mail, only: ids, budgetMs: 120_000 });
    assert.deepEqual(second, { sent: 50, skipped: 0, capped: false });
    assert.equal(new Set(sent.map((m) => m.to)).size, 150);
    assert.equal(await used('resendMonth', periodKey('month', now)), 150);

    // The month: 2,990 used, so at most 10 more go out whatever is due.
    const week = new Date(now.getTime() + 7 * DAY);
    if (periodKey('month', week) === periodKey('month', now)) {
      await clearCounters(week);
      await winBefore(tag, week);
      await sql()`INSERT INTO free_tier_usage (name, period, used) VALUES ('resendMonth', ${periodKey('month', now)}, 2990)
        ON CONFLICT (name, period) DO UPDATE SET used = 2990`;
      const capped = await sendDigests(week, { mail, only: ids, budgetMs: 120_000 });
      assert.deepEqual(capped, { sent: 10, skipped: 0, capped: true });
      assert.equal(await used('resendMonth', periodKey('month', now)), 3000);
      assert.equal((await sendDigests(new Date(week.getTime() + DAY), { mail, only: ids })).sent, 0);
    } else assert.fail('pick a Monday whose next week is in the same month');
  } finally {
    await teardown(tag, ids);
    await clearCounters(now, [tomorrow, new Date(now.getTime() + 7 * DAY), new Date(now.getTime() + 8 * DAY)]);
  }
});

test('10.7 every mail carries List-Unsubscribe and one-click; a POST to it unsubscribes, idempotently, and no mail follows', db, async () => {
  const now = monday(2);
  const tag = `digest-107-${process.pid}-${Date.now()}`;
  await clearCounters(now);
  const ids = await setup(tag, 2, now);
  try {
    const { sent, mail } = recorder();
    await sendDigests(now, { mail, only: ids });
    assert.equal(sent.length, 2);
    for (const m of sent) {
      const id = ids.find((i) => m.to === `b${i}@example.com`)!;
      assert.match(m.headers['List-Unsubscribe'], /^<https:\/\/earnkit\.com\/api\/digest\/unsubscribe\?t=[^>]+>$/);
      assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(m.text.includes(m.headers['List-Unsubscribe'].slice(1, -1)), 'the link is in the text too');
      assert.equal(m.from, DIGEST_FROM_DEFAULT);
      assert.equal(new URL(m.headers['List-Unsubscribe'].slice(1, -1)).searchParams.get('t'), unsubToken(id));
    }
    const url = sent[0].headers['List-Unsubscribe'].slice(1, -1);
    const target = ids.find((i) => sent[0].to === `b${i}@example.com`)!;
    // GET only shows the confirm page (a link scanner unsubscribes nobody).
    const page = digestUnsubscribeGet(new Request(url));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form method="post"/);
    assert.equal((await subs([target]))[0].unsubscribed_at, null);
    const post = () => digestUnsubscribePost(new Request(url, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    assert.equal((await post()).status, 200);
    const first = (await subs([target]))[0].unsubscribed_at;
    assert.ok(first);
    assert.equal((await post()).status, 200, 'idempotent');
    assert.equal((await subs([target]))[0].unsubscribed_at!.getTime(), first.getTime());
    // A bad token changes nothing.
    assert.equal((await digestUnsubscribePost(new Request(`${url}x`, { method: 'POST' }))).status, 400);
    const next = new Date(now.getTime() + 7 * DAY);
    await clearCounters(next);
    await winBefore(tag, next);
    const before = sent.length;
    await sendDigests(next, { mail, only: ids });
    assert.deepEqual(sent.slice(before).map((m) => m.to), [`b${ids.find((i) => i !== target)}@example.com`]);
    await clearCounters(next);
  } finally {
    await teardown(tag, ids);
    await clearCounters(now);
  }
});

test('10.8 no opt-in, nothing sent; an empty week is never sent; without RESEND_API_KEY the cron never sends and the question is never asked', db, async () => {
  const now = monday(3);
  const next = new Date(now.getTime() + 7 * DAY);
  const tag = `digest-108-${process.pid}-${Date.now()}`;
  await clearCounters(now, [next]);
  const ids = await setup(tag, 2, now);
  const prevKey = process.env.RESEND_API_KEY;
  const noFees = async () => 0;
  try {
    const { sent, mail } = recorder();
    await sql()`UPDATE digest_subscriptions SET opted_in_at = NULL WHERE installation_id = ANY(${ids}::int[])`;
    assert.deepEqual(await sendDigests(now, { mail, only: ids }), { sent: 0, skipped: 0, capped: false });
    // Opted in, but nothing to say this week: considered, never sent, no cap slot used.
    await sql()`UPDATE digest_subscriptions SET opted_in_at = ${new Date(now.getTime() - 7 * DAY)} WHERE installation_id = ANY(${ids}::int[])`;
    await sql()`DELETE FROM entry_outcomes WHERE program_id = ${tag}`;
    assert.deepEqual(await sendDigests(now, { mail, only: ids }), { sent: 0, skipped: 2, capped: false });
    assert.deepEqual(await sendDigests(new Date(now.getTime() + 3_600_000), { mail, only: ids }), { sent: 0, skipped: 0, capped: false });
    assert.equal(sent.length, 0);
    assert.equal(await used('resendDay', periodKey('day', now)), 0);

    // Next week there is a win to report, but RESEND_API_KEY is unset: the cron skips the step.
    await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, captured_at)
      SELECT id, ${tag}, 'R2', 'won', 100, 'announcement', ${new Date(next.getTime() - DAY)} FROM projects WHERE program_id = ${tag}`;
    delete process.env.RESEND_API_KEY;
    const off = await runCron({ now: next, only: ['no-such-campaign'], deps: { digest: { mail, only: ids }, refreshFees: noFees } });
    assert.equal('digest' in off, false);
    assert.equal(sent.length, 0);
    assert.equal(await askWeeklyEmail(ids[0], { shared: false, email: 'a@b.co' }), null);
    const [row] = await sql()<{ asked: Date | null }[]>`SELECT digest_asked_at AS asked FROM installations WHERE id = ${ids[0]}`;
    assert.equal(row.asked, null);
    // With the key (and still a fake mailer), the cron runs the step.
    process.env.RESEND_API_KEY = 're_test_never_used';
    const on = await runCron({ now: next, only: ['no-such-campaign'], deps: { digest: { mail, only: ids }, refreshFees: noFees } });
    assert.deepEqual(on.digest, { sent: 2, skipped: 0, capped: false });
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    await teardown(tag, ids);
    await clearCounters(now, [next]);
  }
});

test('the question: once per installation, keeps the address unopted; never on a shared client', db, async () => {
  const tag = `digest-ask-${process.pid}-${Date.now()}`;
  const prevKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_test_never_used';
  const [a] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${tag}-a`}) RETURNING id`;
  const [s] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${`${tag}-s`}, true) RETURNING id`;
  try {
    assert.deepEqual(await askWeeklyEmail(a.id, { shared: false, email: 'a@b.co' }), {
      question: EMAIL_QUESTION,
      agent_note: "Pass the builder's answer to tell as weekly_email.",
    });
    assert.equal(await askWeeklyEmail(a.id, { shared: false, email: 'a@b.co' }), null, 'once');
    // v3 final review: asked again after EMAIL_REASK_DAYS while not opted in; never once opted in.
    await sql()`UPDATE installations SET digest_asked_at = now() - interval '31 days' WHERE id = ${a.id}`;
    assert.equal((await askWeeklyEmail(a.id, { shared: false, email: null }))?.question, EMAIL_QUESTION, 'asked again after 30 days');
    assert.equal(await askWeeklyEmail(a.id, { shared: false, email: null }), null, 'not twice in 30 days');
    await sql()`UPDATE installations SET digest_asked_at = now() - interval '31 days' WHERE id = ${a.id}`;
    await sql()`UPDATE digest_subscriptions SET opted_in_at = now() WHERE installation_id = ${a.id}`;
    assert.equal(await askWeeklyEmail(a.id, { shared: false, email: null }), null, 'opted in: never asked');
    await sql()`UPDATE digest_subscriptions SET opted_in_at = NULL WHERE installation_id = ${a.id}`;
    const [row] = await sql()<{ email: string; opted_in_at: Date | null }[]>`SELECT email, opted_in_at FROM digest_subscriptions WHERE installation_id = ${a.id}`;
    assert.deepEqual(row, { email: 'a@b.co', opted_in_at: null });
    // Ruling G21: a shared client is never asked and keeps nothing.
    assert.equal(await askWeeklyEmail(s.id, { shared: true, email: 'c@d.co' }), null);
    assert.equal((await sql()`SELECT 1 FROM digest_subscriptions WHERE installation_id = ${s.id}`).length, 0);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    await sql()`DELETE FROM installations WHERE id IN (${a.id}, ${s.id})`;
  }
});

test('digestFacts: new programs a remembered repo could win (the alert rule); your closing and decision dates; shared clients see only their own', db, async () => {
  const now = monday(4);
  const tag = `digest-facts-${process.pid}-${Date.now()}`;
  const tipjar = {
    key: 'alice/tipjar', name: 'TipJar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz',
    created_at: '2026-01-01T00:00:00Z', chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deployed' } },
    product: { score: 6, tier: 'product', missing: [] }, live_verified: true, said: null,
  };
  const [own] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, fit_repos) VALUES (${`${tag}-o`}, ${sql().json([tipjar] as never)}) RETURNING id`;
  const [shared] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client, fit_repos) VALUES (${`${tag}-s`}, true, ${sql().json([tipjar] as never)}) RETURNING id`;
  const program = (id: string, title: string, opened: Date, ends: Date | null, results: object | null = null) => sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, chains, opened_at, ends_at, max_award_usd, results)
    VALUES (${id}, 'o', ${title}, 'd', 'https://x', 'https://x', 'up to $10,000', 'up to $10,000', 'active', 'allowed', '{base}', ${opened}, ${ends}, 10000, ${results ? sql().json(results as never) : null})`;
  const ids = [`${tag}-new`, `${tag}-old`, `${tag}-hard`, `${tag}-in`];
  try {
    await program(ids[0], 'Fresh Grant', new Date(now.getTime() - 2 * DAY), new Date(now.getTime() + 20 * DAY));
    await program(ids[1], 'Old Grant', new Date(now.getTime() - 30 * DAY), null);
    // Closes in 2 days: under the alert rule's 3 days left, never alerted.
    await program(ids[2], 'Closing Grant', new Date(now.getTime() - DAY), new Date(now.getTime() + 2 * DAY));
    const decision = new Date(now.getTime() + 4 * DAY).toISOString().slice(0, 10);
    await program(ids[3], 'Entered Grant', new Date(now.getTime() - DAY), new Date(now.getTime() + 3 * DAY), { url: 'https://x', expected: decision });
    await sql()`INSERT INTO projects (program_id, name, installation_id) VALUES (${ids[3]}, 'TipJar', ${own.id})`;
    const [mineEntry] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id) VALUES (${ids[3]}, 'Mine', ${shared.id}) RETURNING id`;
    await sql()`INSERT INTO github_verifications (repo_key, login, installation_id, project_id, account_created_at, public_repos)
      VALUES ('me/mine', 'me', ${shared.id}, ${mineEntry.id}, '2020-01-01', 3)`;
    const sub = { opted_in_at: new Date(now.getTime() - 7 * DAY), unsubscribed_at: null, last_sent_at: new Date(now.getTime() - 7 * DAY), last_considered_at: null };
    const f = await digestFacts({ ...sub, installation_id: own.id, login: '', email: 'a@b.co', shared: false }, now);
    assert.deepEqual(f.newPrograms.map((p) => [p.title, p.repo, p.prize_usd]), [['Fresh Grant', 'TipJar', 10000]]);
    assert.deepEqual(f.deadlines.map((d) => [d.program, d.what]), [['Entered Grant', 'closes'], ['Entered Grant', 'decision']]);
    assert.equal(f.deadlines[1].at.toISOString().slice(0, 10), decision);
    // A hosted agent (G21): no repo lines; only the entries this subscription's login signed in for.
    const mine = await digestFacts({ ...sub, installation_id: shared.id, login: 'me', email: 'me@example.com', shared: true }, now);
    assert.deepEqual(mine.newPrograms, []);
    assert.equal(mine.deadlines.length, 2);
    const other = await digestFacts({ ...sub, installation_id: shared.id, login: 'someone', email: 'me@example.com', shared: true }, now);
    assert.deepEqual(other.deadlines, []);
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ANY(${ids})`;
    await sql()`DELETE FROM programs WHERE id = ANY(${ids})`;
    await sql()`DELETE FROM installations WHERE id IN (${own.id}, ${shared.id})`;
  }
});

test('review I2: three failed sends in a row stop the run, so an outage never burns the day', db, async () => {
  const now = monday(5);
  const tag = `digest-fail-${process.pid}-${Date.now()}`;
  await clearCounters(now);
  const ids = await setup(tag, 6, now);
  try {
    let calls = 0;
    const down: Mailer = async () => {
      calls++;
      throw new MailError(calls === 2 ? 0 : 503);
    };
    assert.deepEqual(await sendDigests(now, { mail: down, only: ids }), { sent: 0, skipped: 3, capped: false, stopped: true });
    assert.equal(calls, 3);
    assert.equal(await used('resendDay', periodKey('day', now)), 3, 'only 3 slots spent');
    assert.ok((await subs(ids)).every((s) => s.last_sent_at === null));
    // A success resets the count: fail, send, fail, fail, send... never three in a row.
    let n = 0;
    const flaky: Mailer = async () => {
      n++;
      if (n % 3 !== 2) throw new MailError(500);
    };
    const r = await sendDigests(new Date(now.getTime() + 3_600_000), { mail: flaky, only: ids });
    assert.equal(r.stopped, undefined);
    assert.equal(r.sent, 2);
  } finally {
    await teardown(tag, ids);
    await clearCounters(now);
  }
});

test('Ruling G21: on a shared install each login has its own subscription; one never changes another\'s; no login changes nothing', db, async () => {
  const prevKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_test_never_used';
  const now = monday(6);
  const tag = `digest-g21-${process.pid}-${Date.now()}`;
  const [s] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${tag}, true) RETURNING id`;
  const rows = async () =>
    (await sql()<{ login: string; email: string | null; opted: boolean; unsub: boolean }[]>`
      SELECT login, email, opted_in_at IS NOT NULL AS opted, unsubscribed_at IS NOT NULL AS unsub
      FROM digest_subscriptions WHERE installation_id = ${s.id} ORDER BY login`).map((r) => ({ ...r }));
  try {
    const shared = { shared: true };
    const week = new Date(now.getTime() - 7 * DAY);
    assert.equal((await saveWeeklyEmail(s.id, { answer: 'yes', email: 'a@x.co' }, { ...shared, login: 'alice' }, week)).show_to_builder, 'Done. Every Monday, once your week is written.');
    assert.equal((await saveWeeklyEmail(s.id, { answer: 'yes', email: 'b@x.co' }, { ...shared, login: 'Bob' }, week)).saved, true);
    assert.deepEqual(await rows(), [
      { login: 'alice', email: 'a@x.co', opted: true, unsub: false },
      { login: 'bob', email: 'b@x.co', opted: true, unsub: false },
    ]);
    // No code: nothing changes, whatever the answer.
    for (const w of [{ answer: 'no' as const }, { answer: 'yes' as const }, { answer: 'yes' as const, email: 'c@x.co' }])
      assert.deepEqual(await saveWeeklyEmail(s.id, w, { ...shared, login: null }), { show_to_builder: EMAIL_SIGN_IN, saved: false });
    // Bob's "no" ends Bob's only.
    await saveWeeklyEmail(s.id, { answer: 'no' }, { ...shared, login: 'bob' });
    assert.deepEqual(await rows(), [
      { login: 'alice', email: 'a@x.co', opted: true, unsub: false },
      { login: 'bob', email: null, opted: false, unsub: false },
    ]);
    // A plain yes from a login that never gave an address opts in nothing.
    assert.equal((await saveWeeklyEmail(s.id, { answer: 'yes' }, { ...shared, login: 'mallory' })).saved, false);
    assert.equal((await saveWeeklyEmail(s.id, { answer: 'yes' }, { ...shared, login: 'bob' })).saved, false, "bob's yes never reuses alice's address");
    // Each login's own email and unsubscribe link; one link never touches the other.
    await saveWeeklyEmail(s.id, { answer: 'yes', email: 'b@x.co' }, { ...shared, login: 'bob' }, week);
    await clearCounters(now);
    await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
      VALUES (${tag}, 'o', 'Win Program', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
    const [p] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id) VALUES (${tag}, 'PayLink', ${s.id}) RETURNING id`;
    await sql()`INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis, captured_at)
      VALUES (${p.id}, ${tag}, 'R1', 'won', 500, 'announcement', ${new Date(now.getTime() - DAY)})`;
    const { sent, mail } = recorder();
    assert.equal((await sendDigests(now, { mail, only: [s.id] })).sent, 2);
    const toAlice = sent.find((m) => m.to === 'a@x.co')!;
    const toBob = sent.find((m) => m.to === 'b@x.co')!;
    assert.notEqual(toAlice.headers['List-Unsubscribe'], toBob.headers['List-Unsubscribe']);
    assert.equal(toBob.idempotencyKey, `digest-${s.id}-bob-${weekStart(now).toISOString()}`);
    const bobUrl = toBob.headers['List-Unsubscribe'].slice(1, -1);
    assert.equal((await digestUnsubscribePost(new Request(bobUrl, { method: 'POST' }))).status, 200);
    assert.deepEqual((await rows()).map((r) => [r.login, r.unsub]), [['alice', false], ['bob', true]]);
    assert.equal(await unsubscribe({ installationId: s.id, login: 'alice' }), true);
  } finally {
    if (prevKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevKey;
    await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
    await sql()`DELETE FROM programs WHERE id = ${tag}`;
    await sql()`DELETE FROM installations WHERE id = ${s.id}`;
    await clearCounters(now);
  }
});
