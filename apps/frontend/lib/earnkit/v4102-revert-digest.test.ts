import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { sql } from './db';
import type { Mailer } from './digest';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { API_FIELDS, API_REQUIREMENT_FIELDS } from './api-program-text';
import { approveTarget, approveToken } from './program-pending';
import { programApprovePost } from './program-approve';
import {
  REVERT_DIGEST_SUBJECT,
  REVERT_TTL_DAYS,
  changeLine,
  revertDigest,
  revertExpiry,
  revertTarget,
  revertToken,
} from './program-revert';
import { REVERT_TEXT, programRevertGet, programRevertPost } from './program-revert-page';
import { programsWritePost, type WriteDeps } from './programs-api';
import { runCron } from './cron';
import { CONTACT_EMAIL } from './policy';

/**
 * v4.10.2 Task 4 (R7, owner answer 3 "Live, with 1-click revert"): the owner's daily digest of the API's applied
 * writes to live programs (from the existing cron, at most once a UTC day, nothing on a quiet day), each with a signed
 * revert link (GET confirm page, POST acts, single use, 7 days). Reverting re-applies the previous applied body, or
 * closes a program the write created; only the latest applied write can be reverted. Fake secrets only.
 */

const db = { skip: !process.env.DATABASE_URL };
const PROGRAMS = join(import.meta.dirname, '../../../../programs');
const TOKEN = randomBytes(32).toString('hex');
const AUTH = `fake-auth-secret-${randomBytes(8).toString('hex')}`;
const today = new Date().toISOString().slice(0, 10);
const pid = process.pid;
const DAY = 86_400_000;
const ENV_KEYS = ['EARNKIT_PROGRAMS_TOKEN', 'EARNKIT_PROGRAMS_API', 'EARNKIT_AUTH_SECRET', 'RESEND_API_KEY', 'EARNKIT_URL'] as const;
const kept: Record<string, string | undefined> = {};

before(async () => {
  for (const m of ['log', 'warn', 'error'] as const) mock.method(console, m, () => {});
  if (process.env.DATABASE_URL) await sql()`UPDATE programs SET ends_at = '2099-12-31T07:59:59Z' WHERE id = 'a16z-speedrun'`;
  for (const k of ENV_KEYS) kept[k] = process.env[k];
  delete process.env.EARNKIT_PROGRAMS_API;
  delete process.env.EARNKIT_URL;
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  process.env.EARNKIT_AUTH_SECRET = AUTH;
  process.env.RESEND_API_KEY = 'fake-resend-key';
});

after(async () => {
  for (const k of ENV_KEYS) if (kept[k] === undefined) delete process.env[k];
  else process.env[k] = kept[k];
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql()`DELETE FROM program_writes WHERE program_id LIKE ${`%-${pid}`}`;
  await sql()`DELETE FROM owner_alerts WHERE kind = 'program-revert-digest'`;
  await sql().end();
});

type Mail = Parameters<Mailer>[0];
const mails: Mail[] = [];
let failMail = false;
const mailer: Mailer = async (m) => {
  if (failMail) throw new Error('fake send failure');
  mails.push(m);
};
const changed: string[] = [];
const deps: WriteDeps = { checkLink: async () => {}, programsDir: PROGRAMS, limit: async () => {}, mailer, onChange: (id) => changed.push(id) };

/** A valid API program that goes live at once (a16z-speedrun's fields, its own site as official_url). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiProgram = (id: string, o: Record<string, unknown> = {}): any => {
  const p = committedProgram('a16z-speedrun');
  const top = Object.fromEntries(Object.entries(p).filter(([k]) => (API_FIELDS as readonly string[]).includes(k)));
  top.submission_requirements = p.submission_requirements.map((r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => (API_REQUIREMENT_FIELDS as readonly string[]).includes(k))),
  );
  return { ...top, id, ends_at: null, verified_at: today, official_url: 'https://a16z.com/', ...o };
};
const send = async (program: Record<string, unknown>) => {
  const res = await programsWritePost(
    new Request('http://localhost/api/programs/write', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', program }),
    }),
    deps,
  );
  return (await res.json()) as { ok: boolean; result?: string };
};
const close = async (id: string) =>
  programsWritePost(
    new Request('http://localhost/api/programs/write', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'close', id, reason: 'ended' }),
    }),
    deps,
  );
const writes = (id: string) =>
  sql()<{ id: string; action: string; result: string; reason: string | null; body: Record<string, unknown> | null }[]>`
    SELECT id, action, result, reason, body FROM program_writes WHERE program_id = ${id} ORDER BY id`;
const row = async (id: string) =>
  (await sql()<{ title: string; status: string; ends_at: Date | null; reward: string }[]>`
    SELECT title, status, ends_at, reward FROM programs WHERE id = ${id}`)[0] ?? null;
/** A clean slate: no writes, no digest sent yet. */
const reset = async () => {
  mails.length = 0;
  failMail = false;
  await sql()`DELETE FROM program_writes`;
  await sql()`DELETE FROM owner_alerts WHERE kind = 'program-revert-digest'`;
};
/** The revert links in a digest, in order. */
const linksIn = (m: Mail) => [...m.text.matchAll(/https:\/\/earnkit\.com\/api\/programs\/revert\?t=(\S+)/g)].map((x) => decodeURIComponent(x[1]!));
const req = (token: string, method: 'GET' | 'POST') => new Request(`http://localhost/api/programs/revert?t=${encodeURIComponent(token)}`, { method });
const get = async (token: string, now?: Date) => {
  const r = await programRevertGet(req(token, 'GET'), now);
  return { status: r.status, text: await r.text(), headers: r.headers };
};
const post = async (token: string, now?: Date) => {
  const r = await programRevertPost(req(token, 'POST'), { programsDir: PROGRAMS, now, onChange: (id) => changed.push(id) });
  return { status: r.status, text: await r.text() };
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

// ---- the token (pure) ----

test('v4.10.2 T4: a revert token signs with its own prefix: never an approve token, and vice versa', () => {
  const exp = revertExpiry(new Date());
  const t = revertToken('42', exp, AUTH);
  assert.deepEqual(revertTarget(t, AUTH), { writeId: '42', expires: exp });
  assert.equal(approveTarget(t, AUTH), null, 'a revert token never approves');
  assert.equal(revertTarget(approveToken('42', exp, AUTH), AUTH), null, 'an approve token never reverts');
  assert.equal(revertTarget(t, 'another-secret'), null);
  assert.equal(revertTarget(t, ''), null, 'no secret: nothing is valid');
  const flipped = t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A');
  assert.equal(revertTarget(flipped, AUTH), null);
  assert.equal(revertTarget(`43${t.slice(2)}`, AUTH), null, 'another id');
  assert.throws(() => revertToken('42', exp, ''), /EARNKIT_AUTH_SECRET/);
  assert.equal(exp - Math.floor(Date.now() / 1000) <= REVERT_TTL_DAYS * 86_400, true);
  assert.equal(REVERT_TTL_DAYS, 7);
});

test('v4.10.2 T4: changeLine says what changed in one plain line', () => {
  const base = apiProgram('x-1', { title: 'Base Builder Grant', ends_at: '2026-11-30T23:59:59Z' });
  assert.equal(changeLine(null, base), 'New program: Base Builder Grant (x-1), deadline Nov 30');
  assert.equal(
    changeLine(base, { ...base, ends_at: '2026-12-15T23:59:59Z' }),
    'Base Builder Grant: deadline Nov 30 to Dec 15',
  );
  assert.equal(changeLine(base, { ...base, ends_at: null }), 'Base Builder Grant: deadline Nov 30 to rolling');
  assert.equal(
    changeLine(base, { ...base, reward: 'Up to $50K', submission_url: 'https://a16z.com/apply' }),
    `Base Builder Grant: reward "${base.reward}" to "Up to $50K"; submission link ${base.submission_url} to https://a16z.com/apply`,
  );
  assert.equal(changeLine(base, { ...base, title: 'Renamed' }), null, 'a title-only change is not listed');
});

// ---- the digest ----

test('v4.10.2 T4: the digest lists the live changes with a revert link each, once a UTC day at most', db, async () => {
  await reset();
  const a = `v4102-a-${pid}`;
  const b = `v4102-b-${pid}`;
  assert.equal((await send(apiProgram(a, { title: 'Alpha Grant', ends_at: '2099-11-30T23:59:59Z' }))).result, 'created');
  assert.equal((await send(apiProgram(b, { title: 'Beta Grant', ends_at: '2099-11-30T23:59:59Z' }))).result, 'created');
  const now = new Date();
  assert.equal((await send(apiProgram(b, { title: 'Beta Grant', ends_at: '2099-12-15T23:59:59Z' }))).result, 'updated');
  // A title-only change and a pending write are not in the digest.
  assert.equal((await send(apiProgram(a, { title: 'Alpha Grant, renamed', ends_at: '2099-11-30T23:59:59Z' }))).result, 'updated');
  assert.equal((await send(apiProgram(a, { title: 'Alpha Grant, renamed', ends_at: '2099-11-30T23:59:59Z', submission_url: 'https://forms.gle/abcdef', official_url: undefined }))).result, 'pending');
  mails.length = 0; // the pending write's own approve email

  assert.deepEqual(await revertDigest(now, mailer), { step: 'sent', changes: 3 });
  assert.equal(mails.length, 1);
  const m = mails[0]!;
  assert.equal(m.to, CONTACT_EMAIL);
  assert.equal(m.subject, REVERT_DIGEST_SUBJECT);
  assert.equal(m.idempotencyKey, `program-revert-digest:${now.toISOString().slice(0, 10)}`);
  assert.match(m.text, /New program: Alpha Grant \(v4102-a-\d+\), deadline Nov 30/);
  assert.match(m.text, /New program: Beta Grant \(v4102-b-\d+\), deadline Nov 30/);
  assert.match(m.text, /Beta Grant: deadline Nov 30 to Dec 15/);
  assert.doesNotMatch(m.text, /renamed|forms\.gle/);
  assert.doesNotMatch(m.text, /—/, 'never an em dash');
  // Alpha's create is still its latest live change that counts (the rename is later, but revert targets the latest
  // write): Alpha's create has no link; Beta's create was replaced by the update, so only the update has a link.
  assert.equal(linksIn(m).length, 1, m.text);
  assert.equal((m.text.match(/A later change replaced it/g) ?? []).length, 2, m.text);

  // The cron runs again the same day: nothing more.
  assert.equal((await send(apiProgram(b, { title: 'Beta Grant', ends_at: '2099-12-20T23:59:59Z' }))).result, 'updated');
  assert.deepEqual(await revertDigest(now, mailer), { step: 'sent_today' });
  assert.equal(mails.length, 1);
  // The next day: only the change made since the last digest.
  assert.deepEqual(await revertDigest(new Date(now.getTime() + DAY), mailer), { step: 'sent', changes: 1 });
  assert.equal(mails.length, 2);
  assert.match(mails[1]!.text, /Beta Grant: deadline Dec 15 to Dec 20/);
  assert.doesNotMatch(mails[1]!.text, /New program/);
  assert.equal(linksIn(mails[1]!).length, 1);
});

test('v4.10.2 T4: a quiet day sends nothing and keeps the day open; a failed send gives the day back', db, async () => {
  await reset();
  const now = new Date();
  assert.deepEqual(await revertDigest(now, mailer), { step: 'quiet' });
  assert.equal(mails.length, 0);
  assert.equal((await sql()`SELECT 1 FROM owner_alerts WHERE kind = 'program-revert-digest'`).length, 0);
  // A change later that day still goes out that day.
  assert.equal((await send(apiProgram(`v4102-q-${pid}`, { ends_at: '2099-11-30T23:59:59Z' }))).result, 'created');
  failMail = true;
  await assert.rejects(revertDigest(now, mailer), /fake send failure/);
  failMail = false;
  assert.deepEqual(await revertDigest(now, mailer), { step: 'sent', changes: 1 });
  assert.equal(mails.length, 1);
  // Without RESEND_API_KEY the step is off (and claims nothing).
  delete process.env.RESEND_API_KEY;
  try {
    assert.deepEqual(await revertDigest(new Date(now.getTime() + DAY), mailer), { step: 'off' });
  } finally {
    process.env.RESEND_API_KEY = 'fake-resend-key';
  }
});

test('v4.10.2 T4: the digest rides the existing cron (one step, no new schedule)', db, async () => {
  await reset();
  assert.equal((await send(apiProgram(`v4102-c-${pid}`, { ends_at: '2099-11-30T23:59:59Z' }))).result, 'created');
  const out = (await runCron({ only: [`v4102-none-${pid}`], deps: { refreshFees: async () => 0, revertDigest: { mail: mailer } } })) as { revert_digest?: unknown };
  assert.deepEqual(out.revert_digest, { step: 'sent', changes: 1 });
  assert.equal(mails.length, 1);
  const again = (await runCron({ only: [`v4102-none-${pid}`], deps: { refreshFees: async () => 0, revertDigest: { mail: mailer } } })) as { revert_digest?: unknown };
  assert.deepEqual(again.revert_digest, { step: 'sent_today' });
  assert.equal(mails.length, 1);
});

// ---- the revert ----

test('v4.10.2 T4: a revert restores the previous body, once; the replay does nothing; the next digest skips it', db, async () => {
  await reset();
  const id = `v4102-r-${pid}`;
  await send(apiProgram(id, { title: "Tom & Jerry's Grant", ends_at: '2099-11-30T23:59:59Z' }));
  const now = new Date();
  await revertDigest(new Date(now.getTime() - DAY), mailer); // the create went out yesterday
  mails.length = 0;
  assert.equal((await send(apiProgram(id, { title: "Tom & Jerry's Grant", ends_at: '2099-12-15T23:59:59Z', reward: 'Up to $1M' }))).result, 'updated');
  assert.deepEqual(await revertDigest(now, mailer), { step: 'sent', changes: 1 });
  const [t] = linksIn(mails[0]!);
  assert.ok(t, mails[0]!.text);

  // GET: a confirm page, nothing changes.
  const page = await get(t);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(esc("Tom & Jerry's Grant")), page.text);
  assert.ok(page.text.includes(REVERT_TEXT.button));
  assert.ok(page.text.includes(`action="/api/programs/revert?t=${encodeURIComponent(t)}"`), 'posts back to EarnKit only');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal((await row(id))?.reward, 'Up to $1M');

  changed.length = 0;
  const done = await post(t);
  assert.equal(done.status, 200, done.text);
  assert.ok(done.text.includes(REVERT_TEXT.reverted));
  const r = await row(id);
  assert.equal(r?.ends_at?.toISOString(), '2099-11-30T23:59:59.000Z');
  assert.notEqual(r?.reward, 'Up to $1M');
  assert.equal(r?.status, 'active');
  assert.deepEqual(changed, [id]);
  const ws = await writes(id);
  const last = ws.at(-1)!;
  assert.deepEqual([last.action, last.result], ['revert', 'reverted']);
  assert.match(last.reason ?? '', /^reverted write \d+$/);
  assert.equal((last.body as { ends_at: string }).ends_at, '2099-11-30T23:59:59Z', 'the revert row keeps the applied body');

  // Replay: nothing more.
  const again = await post(t);
  assert.equal(again.status, 409);
  assert.ok(again.text.includes(REVERT_TEXT.done));
  assert.equal((await writes(id)).length, ws.length);
  assert.equal((await get(t)).status, 409);
  // The next digest doesn't list the revert as an API change.
  mails.length = 0;
  assert.deepEqual(await revertDigest(new Date(now.getTime() + DAY), mailer), { step: 'quiet' });
});

test('v4.10.2 T4: reverting a create closes the program', db, async () => {
  await reset();
  const id = `v4102-new-${pid}`;
  await send(apiProgram(id, { ends_at: '2099-11-30T23:59:59Z' }));
  await revertDigest(new Date(), mailer);
  assert.match(mails[0]!.text, /Revert \(closes it\): https/);
  const [t] = linksIn(mails[0]!);
  const r = await post(t!);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.text.includes(REVERT_TEXT.closed));
  assert.equal((await row(id))?.status, 'closed');
  const last = (await writes(id)).at(-1)!;
  assert.deepEqual([last.action, last.result], ['revert', 'closed']);
});

test('v4.10.2 T4: a superseded write is refused plainly; a close in between counts as a later change', db, async () => {
  await reset();
  const id = `v4102-s-${pid}`;
  await send(apiProgram(id, { ends_at: '2099-11-30T23:59:59Z' }));
  await send(apiProgram(id, { ends_at: '2099-12-15T23:59:59Z' }));
  const [, first] = (await writes(id)).filter((w) => w.result === 'updated' || w.result === 'created');
  const t1 = revertToken(first!.id, revertExpiry(new Date()), AUTH);
  await send(apiProgram(id, { ends_at: '2099-12-20T23:59:59Z' }));
  const r = await post(t1);
  assert.equal(r.status, 409);
  assert.ok(r.text.includes(REVERT_TEXT.superseded), r.text);
  assert.equal((await row(id))?.ends_at?.toISOString(), '2099-12-20T23:59:59.000Z');
  assert.equal((await get(t1)).status, 409);

  // The latest update is revertable until the bot closes the program.
  const latest = (await writes(id)).at(-1)!;
  const t2 = revertToken(latest.id, revertExpiry(new Date()), AUTH);
  assert.equal((await get(t2)).status, 200);
  assert.equal((await close(id)).status, 200);
  assert.equal((await post(t2)).status, 409);
  assert.equal((await row(id))?.status, 'closed');
});

test('v4.10.2 T4: reverting a reopen restores the close in between', db, async () => {
  await reset();
  const id = `v4102-o-${pid}`;
  await send(apiProgram(id, { ends_at: '2099-11-30T23:59:59Z' }));
  await close(id);
  assert.equal((await send(apiProgram(id, { ends_at: '2099-12-15T23:59:59Z' }))).result, 'updated');
  const reopen = (await writes(id)).at(-1)!;
  const r = await post(revertToken(reopen.id, revertExpiry(new Date()), AUTH));
  assert.equal(r.status, 200, r.text);
  const after = await row(id);
  assert.equal(after?.status, 'closed');
  assert.equal(after?.ends_at?.toISOString(), '2099-11-30T23:59:59.000Z');
});

test('v4.10.2 T4: an expired, forged or approve-signed revert does nothing and says so plainly', db, async () => {
  await reset();
  const id = `v4102-x-${pid}`;
  await send(apiProgram(id, { ends_at: '2099-11-30T23:59:59Z' }));
  await send(apiProgram(id, { ends_at: '2099-12-15T23:59:59Z' }));
  const w = (await writes(id)).at(-1)!;
  const exp = revertExpiry(new Date());
  const t = revertToken(w.id, exp, AUTH);
  const late = new Date((exp + 1) * 1000);
  assert.equal((await get(t, late)).status, 410);
  const expired = await post(t, late);
  assert.equal(expired.status, 410);
  assert.ok(expired.text.includes(REVERT_TEXT.expired));
  for (const bad of [t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), approveToken(w.id, exp, AUTH), 'nope', `${w.id}.${exp}.${'A'.repeat(43)}`]) {
    const r = await post(bad);
    assert.equal(r.status, 400, bad);
    assert.ok(r.text.includes(REVERT_TEXT.bad));
  }
  // A revert token never approves.
  const ap = await programApprovePost(new Request(`http://localhost/api/programs/approve?t=${encodeURIComponent(t)}`, { method: 'POST' }), {
    checkLink: async () => {},
    programsDir: PROGRAMS,
  });
  assert.equal(ap.status, 400);
  // Without the secret every link fails closed.
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    assert.equal((await post(t)).status, 400);
  } finally {
    process.env.EARNKIT_AUTH_SECRET = AUTH;
  }
  assert.equal((await row(id))?.ends_at?.toISOString(), '2099-12-15T23:59:59.000Z');
  assert.equal((await writes(id)).filter((x) => x.action === 'revert').length, 0);
});

test('v4.10.2 T4: without EARNKIT_AUTH_SECRET the digest still goes, and says there are no revert links', db, async () => {
  await reset();
  await send(apiProgram(`v4102-n-${pid}`, { ends_at: '2099-11-30T23:59:59Z' }));
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    assert.deepEqual(await revertDigest(new Date(), mailer), { step: 'sent', changes: 1 });
  } finally {
    process.env.EARNKIT_AUTH_SECRET = AUTH;
  }
  assert.equal(linksIn(mails[0]!).length, 0);
  assert.match(mails[0]!.text, /EARNKIT_AUTH_SECRET is not set/);
  assert.doesNotMatch(mails[0]!.text, new RegExp(AUTH));
});
