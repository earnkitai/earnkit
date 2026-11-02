import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import type { Mailer } from './digest';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { API_FIELDS, API_REQUIREMENT_FIELDS, notWritableFields } from './api-program-text';
import { linkChecksOut, linkPlatformName, sameSite } from './submit-hosts';
import { APPROVE_TEXT, programApproveGet, programApprovePost } from './program-approve';
import { APPROVE_TTL_DAYS, approveExpiry, approveTarget, approveToken, PENDING_SUBJECT } from './program-pending';
import { programsWritePost, type WriteDeps } from './programs-api';
import { programWritesGet } from './programs-read';
import { CONTACT_EMAIL } from './policy';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';

/**
 * v4.10.1 Task 4 (R4, owner 2026-11-02 "Live if link checks out"): a new program, or a write that changes
 * submission_url, goes live only when its link checks out; else it is pending, the owner gets one email, and a signed
 * approve link (GET confirm page, POST approves, 7 days, single use) applies it. Fake secrets only.
 */

const db = { skip: !process.env.DATABASE_URL };
const PROGRAMS = join(import.meta.dirname, '../../../../programs');
const TOKEN = randomBytes(32).toString('hex');
const AUTH = `fake-auth-secret-${randomBytes(8).toString('hex')}`;
const RESEND = 'fake-resend-key';
const today = new Date().toISOString().slice(0, 10);
const pid = process.pid;
const ENV_KEYS = ['EARNKIT_PROGRAMS_TOKEN', 'EARNKIT_PROGRAMS_API', 'EARNKIT_AUTH_SECRET', 'RESEND_API_KEY', 'EARNKIT_URL'] as const;
const kept: Record<string, string | undefined> = {};

before(async () => {
  for (const m of ['log', 'warn', 'error'] as const) mock.method(console, m, () => {});
  // a16z-speedrun (curated, any chain) closed on 2026-11-02: pinned open in this file's database, as an anchor.
  if (process.env.DATABASE_URL) await sql()`UPDATE programs SET ends_at = '2099-12-31T07:59:59Z' WHERE id = 'a16z-speedrun'`;
  for (const k of ENV_KEYS) kept[k] = process.env[k];
  delete process.env.EARNKIT_PROGRAMS_API;
  delete process.env.EARNKIT_URL;
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  process.env.EARNKIT_AUTH_SECRET = AUTH;
  process.env.RESEND_API_KEY = RESEND;
});

after(async () => {
  for (const k of ENV_KEYS) if (kept[k] === undefined) delete process.env[k];
  else process.env[k] = kept[k];
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql()`DELETE FROM program_writes WHERE program_id LIKE ${`%-${pid}`}`;
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

/** A valid API program (a16z-speedrun with only the API's fields), rolling, checked today. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiProgram = (id: string, o: Record<string, unknown> = {}): any => {
  const p = committedProgram('a16z-speedrun');
  const top = Object.fromEntries(Object.entries(p).filter(([k]) => (API_FIELDS as readonly string[]).includes(k)));
  top.submission_requirements = p.submission_requirements.map((r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => (API_REQUIREMENT_FIELDS as readonly string[]).includes(k))),
  );
  return { ...top, id, ends_at: null, verified_at: today, ...o };
};
/** A Base program on `site` (source and submission there). */
const baseProgram = (id: string, site: string, o: Record<string, unknown> = {}) =>
  apiProgram(id, { chains: ['base'], any_chain: false, source_url: `https://${site}/grants`, submission_url: `https://${site}/apply`, ...o });

const send = async (program: Record<string, unknown>) => {
  const res = await programsWritePost(
    new Request('http://localhost/api/programs/write', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', program }),
    }),
    deps,
  );
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as { ok: boolean; result?: string; live?: boolean; reason?: string; problems?: string[] } };
};
const writes = (id: string) =>
  sql()<{ id: string; at: Date; result: string; reason: string | null; body: Record<string, unknown> | null }[]>`
    SELECT id, at, result, reason, body FROM program_writes WHERE program_id = ${id} ORDER BY id`;
const row = async (id: string) =>
  (await sql()<{ source: string; title: string; submission_url: string }[]>`SELECT source, title, submission_url FROM programs WHERE id = ${id}`)[0] ?? null;
const pendingOf = async (id: string) => (await writes(id)).filter((w) => w.result === 'pending');

/** The approve link's token from the owner's email. */
const tokenIn = (m: Mail) => {
  const link = /https:\/\/earnkit\.com\/api\/programs\/approve\?t=(\S+)/.exec(m.text);
  assert.ok(link, m.text);
  return decodeURIComponent(link[1]!);
};
const approveReq = (token: string, method: 'GET' | 'POST') =>
  new Request(`http://localhost/api/programs/approve?t=${encodeURIComponent(token)}`, { method });
const get = async (token: string, now?: Date) => {
  const r = await programApproveGet(approveReq(token, 'GET'), now);
  return { status: r.status, text: await r.text(), headers: r.headers };
};
const post = async (token: string, now?: Date) => {
  const r = await programApprovePost(approveReq(token, 'POST'), { checkLink: async () => {}, programsDir: PROGRAMS, now, onChange: (id) => changed.push(id) });
  return { status: r.status, text: await r.text() };
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');

// ---- the check (pure) ----

test('v4.10.1 T4: sameSite: a registrable domain matches its subdomains, never a lookalike', () => {
  assert.equal(sameSite('base.org', 'www.base.org'), true);
  assert.equal(sameSite('docs.base.org', 'base.org'), true, 'a subdomain');
  assert.equal(sameSite('sub.base.org', 'www.base.org'), true);
  assert.equal(sameSite('Base.ORG.', 'base.org'), true, 'normalized');
  assert.equal(sameSite('base-grants.org', 'base.org'), false, 'a lookalike');
  assert.equal(sameSite('base.org.evil.com', 'base.org'), false, 'a suffix trick');
  assert.equal(sameSite('evilbase.org', 'base.org'), false);
  assert.equal(sameSite('base.com', 'base.org'), false);
  // A multi-label public suffix: the name under it is the domain.
  assert.equal(sameSite('grants.example.co.uk', 'www.example.co.uk'), true);
  assert.equal(sameSite('example.co.uk', 'other.co.uk'), false);
  // The heuristic's guard: a country second-level suffix the list lacks matches only the exact host.
  assert.equal(sameSite('a.co.ke', 'b.co.ke'), false);
  assert.equal(sameSite('grants.example.co.ke', 'www.example.co.ke'), false, 'treated as a shared suffix: exact host only');
  assert.equal(sameSite('a.co.ke', 'a.co.ke'), true);
  // Shared hosting: the exact host only, and never a host whose owners differ by path.
  assert.equal(sameSite('org.github.io', 'org.github.io'), true);
  assert.equal(sameSite('evil.github.io', 'org.github.io'), false);
  assert.equal(sameSite('github.com', 'github.com'), false);
  assert.equal(sameSite('x.vercel.app', 'y.vercel.app'), false);
  // Bare labels never match.
  assert.equal(sameSite('localhost', 'localhost'), false);
});

test('v4.10.1 T4: linkChecksOut: form and hackathon platforms never check out on their own', () => {
  for (const host of ['forms.gle', 'docs.google.com', 'typeform.com', 'acme.typeform.com', 'tally.so', 'circle.questbook.app', 'questbook.app', 'airtable.com', 'dorahacks.io', 'x.devfolio.co', 'www.hackquest.io']) {
    assert.ok(linkPlatformName(host), host);
    assert.equal(linkChecksOut(host, [host, 'forms.gle', 'questbook.app']), false, host);
  }
  assert.equal(linkChecksOut('www.base.org', ['base.org']), true);
  assert.equal(linkChecksOut('base-grants.org', ['base.org']), false);
  assert.equal(linkChecksOut('www.base.org', []), false, 'no anchor, no check');
});

test('v4.10.1 T4: official_url is writable (checked, never stored), and must be a clean https URL', db, async () => {
  assert.deepEqual(notWritableFields({ official_url: 'https://base.org/' }), []);
  for (const bad of ['http://base.org/', 'https://1.2.3.4/', 'https://base.org./', 'https://base.org/#x', 42]) {
    const r = await send(baseProgram(`v4101-bad-${pid}`, 'base.org', { official_url: bad }));
    assert.equal(r.status, 400, String(bad));
    assert.ok(r.body.problems!.some((x) => x.startsWith('official_url')), JSON.stringify(r.body));
  }
  assert.equal(await row(`v4101-bad-${pid}`), null);
});

// ---- the write ----

test('v4.10.1 T4: a submission link on the official site goes live at once; nobody is emailed', db, async () => {
  const id = `v4101-live-${pid}`;
  mails.length = 0;
  const r = await send(apiProgram(id, { official_url: 'https://a16z.com/' }));
  assert.deepEqual([r.status, r.body.result, r.body.live], [200, 'created', true], r.text);
  assert.equal((await row(id))?.source, 'api');
  const [w] = await writes(id);
  assert.equal(w!.result, 'created');
  assert.equal('official_url' in w!.body!, false, 'official_url is never stored on the program');
  assert.equal(mails.length, 0);
});

test("v4.10.1 T4: a link on a live program's site for one of its chains goes live without official_url", db, async () => {
  // base-batches-005 (a curated Base program, upcoming) is on www.base.org.
  const id = `v4101-eco-${pid}`;
  mails.length = 0;
  const r = await send(baseProgram(id, 'www.base.org'));
  assert.deepEqual([r.status, r.body.result], [200, 'created'], r.text);
  // Another chain's sites don't count.
  const other = await send(baseProgram(`v4101-eco2-${pid}`, 'www.base.org', { chains: ['monad'] }));
  assert.deepEqual([other.status, other.body.result], [202, 'pending'], other.text);
  // A live program's form platform never counts (base-builder-grants submits on forms.gle).
  const form = await send(baseProgram(`v4101-eco3-${pid}`, 'docs.base.org', { submission_url: 'https://forms.gle/urqjBJYJjR6Vqqre6' }));
  assert.deepEqual([form.status, form.body.result], [202, 'pending'], form.text);
});

// Each test uses its own lookalike domain: an approved program is live, so its site is then an anchor for its chains.
test('v4.10.1 T4: a lookalike domain lands pending, emails the owner once, and a valid POST approves it', db, async () => {
  const id = `v4101-look-${pid}`;
  mails.length = 0;
  changed.length = 0;
  const program = baseProgram(id, 'base-grants.org', { official_url: 'https://www.base.org/', title: "Tom & Jerry's Base Grants" });
  const r = await send(program);
  assert.deepEqual([r.status, r.body.ok, r.body.result, r.body.live], [202, true, 'pending', false], r.text);
  assert.equal(r.body.reason, "submission_url base-grants.org is not on a curated program's site for its chains");
  assert.equal(await row(id), null, 'nothing reaches programs');
  assert.deepEqual(changed, [], 'no cache bust');
  assert.ok(!r.text.includes(AUTH) && !r.text.includes('approve'), 'the bot never sees the link or the secret');

  // One email, to the owner only, with the approve link.
  assert.equal(mails.length, 1);
  const [m] = mails;
  assert.equal(m!.to, CONTACT_EMAIL);
  assert.equal(m!.subject, PENDING_SUBJECT);
  const [w] = await pendingOf(id);
  assert.equal(m!.idempotencyKey, `program-pending:${w!.id}`);
  assert.ok(m!.text.includes('Submission link: https://base-grants.org/apply'));
  assert.ok(m!.text.includes('Official site: https://www.base.org/'));
  assert.ok(!m!.text.includes(AUTH) && !m!.text.includes('—'), 'no secret, no em dash');
  const token = tokenIn(m!);
  assert.deepEqual(approveTarget(token), { writeId: w!.id, expires: approveExpiry(w!.at) });

  // The bot resending the same body: still one pending write, still one email.
  const again = await send(program);
  assert.deepEqual([again.status, again.body.result], [202, 'pending']);
  assert.equal((await pendingOf(id)).length, 1);
  assert.equal(mails.length, 1);

  // GET /api/programs/writes shows it.
  const list = await programWritesGet(new Request('http://localhost/api/programs/writes', { headers: { authorization: `Bearer ${TOKEN}` } }));
  const listed = ((await list.json()) as { pending: { program_id: string; title: string; submission_url: string; expires_at: string; reason: string }[] }).pending;
  const mine = listed.find((p) => p.program_id === id);
  assert.ok(mine, 'pending is listed');
  assert.equal(mine.title, "Tom & Jerry's Base Grants");
  assert.equal(mine.submission_url, 'https://base-grants.org/apply');
  assert.equal(Date.parse(mine.expires_at), (approveExpiry(w!.at)) * 1000);

  // The confirm page changes nothing (a mail scanner opening the link approves nothing).
  const page = await get(token);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes(esc("Tom & Jerry's Base Grants")), 'the body is escaped text');
  assert.ok(!page.text.includes("Tom & Jerry's"));
  assert.ok(page.text.includes('https://base-grants.org/apply'));
  assert.ok(!page.text.includes('href="https://base-grants.org'), 'never a link to the pending site');
  const action = /<form method="post" action="([^"]+)">/.exec(page.text)?.[1];
  assert.equal(action, `/api/programs/approve?t=${encodeURIComponent(token)}`.replace(/&/g, '&amp;'), 'posts back to EarnKit only');
  assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy')!, /form-action 'self'/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(await row(id), null);
  assert.equal((await pendingOf(id)).length, 1);

  // The POST approves: live, the pending row is 'approved', the audit row says which write.
  const ok = await post(token);
  assert.deepEqual([ok.status, ok.text.includes(APPROVE_TEXT.approved)], [200, true]);
  assert.equal((await row(id))?.submission_url, 'https://base-grants.org/apply');
  assert.equal((await row(id))?.source, 'api');
  const after1 = await writes(id);
  assert.deepEqual(after1.map((x) => x.result), ['approved', 'created']);
  assert.equal(after1[1]!.reason, `approved write ${w!.id}`);
  assert.deepEqual(changed, [id]);

  // Replayed: nothing more happens (no second write, a plain page).
  const replay = await post(token);
  assert.deepEqual([replay.status, replay.text.includes(APPROVE_TEXT.done)], [409, true]);
  assert.equal((await get(token)).status, 409);
  assert.equal((await writes(id)).length, 2);
  assert.deepEqual(changed, [id]);
});

test('v4.10.1 T4: an expired or forged approval does nothing and says so plainly', db, async () => {
  const id = `v4101-forge-${pid}`;
  mails.length = 0;
  const r = await send(baseProgram(id, 'docs.base.org', { submission_url: 'https://tally.so/r/abc', official_url: 'https://base.org/' }));
  assert.deepEqual([r.status, r.body.result], [202, 'pending']);
  assert.equal(r.body.reason, 'submission_url is on Tally, a form, hosting or submit platform anyone can publish on');
  const token = tokenIn(mails[0]!);
  const [w] = await pendingOf(id);
  const exp = approveExpiry(w!.at);
  const late = new Date((exp + 1) * 1000);

  // Expired (day 7 is the last): 410 on both, nothing changes.
  assert.equal(exp - Math.floor(w!.at.getTime() / 1000), APPROVE_TTL_DAYS * 86_400);
  assert.equal((await get(token, late)).status, 410);
  const expired = await post(token, late);
  assert.deepEqual([expired.status, expired.text.includes(APPROVE_TEXT.expired)], [410, true]);

  const mac = (s: string, wid: string, e: number) => createHmac('sha256', s).update(`program-approve:v1:${wid}:${e}`).digest('base64url');
  const forged = [
    `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, // one changed character
    `${w!.id}.${exp + 86_400 * 30}.${token.split('.')[2]}`, // a later expiry under the old mac
    `${w!.id}.${exp}.${mac('another-fake-secret', w!.id, exp)}`, // another secret
    `${Number(w!.id) + 1}.${exp}.${token.split('.')[2]}`, // another write
    `${w!.id}.${exp}`, // no mac
    `${w!.id}.${exp}.${'A'.repeat(43)}x`, // too long
    '',
  ];
  for (const t of forged) {
    const g = await get(t);
    const p = await post(t);
    assert.deepEqual([g.status, p.status], [400, 400], t);
    assert.ok(p.text.includes(APPROVE_TEXT.bad));
    assert.ok(!p.text.includes(AUTH));
  }
  // Without the secret, no token checks out.
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    assert.equal(approveTarget(token), null);
    assert.equal((await post(token)).status, 400);
  } finally {
    process.env.EARNKIT_AUTH_SECRET = AUTH;
  }
  assert.equal(await row(id), null, 'nothing applied');
  assert.deepEqual((await writes(id)).map((x) => x.result), ['pending']);
  // The genuine token still works afterwards (forgeries never consume it).
  assert.equal((await post(token)).status, 200);
});

test("v4.10.1 T4: updates to a live program's other fields stay live; a new submission_url that doesn't check out waits, the old link stays", db, async () => {
  const id = `v4101-upd-${pid}`;
  mails.length = 0;
  const created = await send(apiProgram(id, { official_url: 'https://a16z.com/' }));
  assert.equal(created.body.result, 'created');
  // No official_url this time: the link is unchanged, so no check.
  const retitled = await send(apiProgram(id, { title: 'Speedrun, retitled' }));
  assert.deepEqual([retitled.status, retitled.body.result, retitled.body.live], [200, 'updated', true], retitled.text);
  assert.equal((await row(id))?.title, 'Speedrun, retitled');
  // A new link on the official site: live.
  const moved = await send(apiProgram(id, { title: 'Speedrun, retitled', submission_url: 'https://a16z.com/speedrun/apply', official_url: 'https://a16z.com/' }));
  assert.equal(moved.body.result, 'updated', moved.text);
  // A new link elsewhere: pending, and the live row keeps its last checked link.
  const away = await send(apiProgram(id, { title: 'Speedrun, retitled', submission_url: 'https://forms.gle/abcdef' }));
  assert.deepEqual([away.status, away.body.result], [202, 'pending']);
  assert.equal((await row(id))?.submission_url, 'https://a16z.com/speedrun/apply');
  assert.equal(mails.length, 1);
});

test('v4.10.1 T4: approving an older pending write after a newer write does nothing (superseded)', db, async () => {
  const id = `v4101-sup-${pid}`;
  mails.length = 0;
  await send(baseProgram(id, 'base-grants-sup.org', { official_url: 'https://www.base.org/' }));
  await send(baseProgram(id, 'base-grants-sup.org', { official_url: 'https://www.base.org/', title: 'Second try' }));
  assert.equal(mails.length, 2, 'a different body is a new pending write');
  const [older, newer] = [tokenIn(mails[0]!), tokenIn(mails[1]!)];
  const r = await post(older);
  assert.deepEqual([r.status, r.text.includes(APPROVE_TEXT.superseded)], [409, true]);
  assert.equal(await row(id), null);
  assert.equal((await post(newer)).status, 200);
  assert.equal((await row(id))?.title, 'Second try');
  assert.deepEqual((await writes(id)).map((x) => x.result), ['superseded', 'approved', 'created']);
});

test('v4.10.1 T4: an approval re-runs the checks; a link that no longer loads leaves it pending', db, async () => {
  const id = `v4101-chk-${pid}`;
  mails.length = 0;
  await send(baseProgram(id, 'base-grants-chk.org', { official_url: 'https://www.base.org/' }));
  const token = tokenIn(mails[0]!);
  const dead = await programApprovePost(approveReq(token, 'POST'), {
    checkLink: async () => {
      throw new Error('answered 404, not 2xx');
    },
    programsDir: PROGRAMS,
  });
  assert.equal(dead.status, 400);
  assert.ok((await dead.text()).includes(APPROVE_TEXT.refused));
  assert.deepEqual((await writes(id)).map((x) => x.result), ['pending']);
  assert.equal(await row(id), null);
});

test('v4.10.1 T4: the approve route is off with the API, and its token helpers sign with EARNKIT_AUTH_SECRET', db, async () => {
  process.env.EARNKIT_PROGRAMS_API = 'off';
  try {
    assert.equal((await programApproveGet(approveReq('1.2.x', 'GET'))).status, 404);
    assert.equal((await programApprovePost(approveReq('1.2.x', 'POST'))).status, 404);
  } finally {
    delete process.env.EARNKIT_PROGRAMS_API;
  }
  assert.throws(() => approveToken('1', 2, ''), /EARNKIT_AUTH_SECRET is not set/);
  const src = readFileSync(join(import.meta.dirname, 'program-pending.ts'), 'utf8');
  assert.match(src, /timingSafeEqual\(want, got\)/);
  const route = readFileSync(join(import.meta.dirname, '../../app/api/programs/approve/route.ts'), 'utf8');
  assert.match(route, /export const GET = \(request: Request\) => programApproveGet\(request\);/);
  assert.match(route, /export const POST = \(request: Request\) => programApprovePost\(request\);/);
});

test('v4.10.1 T4: without RESEND_API_KEY the write still waits (no mail), and without the secret the email says there is no link', db, async () => {
  const id = `v4101-nokey-${pid}`;
  mails.length = 0;
  delete process.env.RESEND_API_KEY;
  try {
    const r = await send(baseProgram(id, 'base-grants-nokey.org', { official_url: 'https://www.base.org/' }));
    assert.deepEqual([r.status, r.body.result], [202, 'pending']);
    assert.equal(mails.length, 0);
  } finally {
    process.env.RESEND_API_KEY = RESEND;
  }
  delete process.env.EARNKIT_AUTH_SECRET;
  try {
    await send(baseProgram(id, 'base-grants-nokey.org', { official_url: 'https://www.base.org/', title: 'No secret' }));
    assert.equal(mails.length, 1);
    assert.ok(mails[0]!.text.includes('EARNKIT_AUTH_SECRET is not set, so there is no approve link'));
    assert.ok(!mails[0]!.text.includes('/api/programs/approve'));
  } finally {
    process.env.EARNKIT_AUTH_SECRET = AUTH;
  }
});

// ---- fix round 1 (security review I1, automated findings a-c; controller ruling) ----

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
/** A row written straight to programs (no write API, so no link check): a fixture anchor candidate. */
const seed = async (id: string, source: 'file' | 'api', o: Record<string, unknown>) => {
  const p = ProgramFile.parse(apiProgram(id, { chains: ['tempo'], any_chain: false, ...o }));
  await upsertProgram(p, source);
  return p;
};

test('v4.10.1 T4 fix 1: an official_url lookalike is a hint only: official_url and submission on base-grants.org land pending', db, async () => {
  const id = `v4101-offlook-${pid}`;
  mails.length = 0;
  const r = await send(baseProgram(id, 'base-grants-off.org', { official_url: 'https://base-grants-off.org/' }));
  assert.deepEqual([r.status, r.body.result, r.body.live], [202, 'pending', false], r.text);
  assert.equal(r.body.reason, "submission_url base-grants-off.org is on official_url's site, but base-grants-off.org is not a curated program's site for its chains");
  assert.equal(await row(id), null);
  assert.equal(mails.length, 1);
  // official_url on a curated site still counts as the hint: a submission on its exact site goes live.
  const ok = await send(baseProgram(`v4101-offok-${pid}`, 'grants.base.org', { official_url: 'https://www.base.org/' }));
  assert.deepEqual([ok.status, ok.body.result], [200, 'created'], ok.text);
});

test('v4.10.1 T4 fix 1: an official_url on a shared, hosting or platform host is refused', db, async () => {
  for (const url of ['https://evil.vercel.app/', 'https://org.github.io/', 'https://forms.gle/x', 'https://acme.notion.site/', 'https://dorahacks.io/']) {
    const r = await send(baseProgram(`v4101-offshared-${pid}`, 'evil.vercel.app', { official_url: url }));
    assert.equal(r.status, 400, url);
    assert.ok(r.body.problems!.some((x) => x.startsWith('official_url:') && x.includes('shared or platform host')), `${url}: ${r.text}`);
  }
  assert.equal(await row(`v4101-offshared-${pid}`), null);
});

test("v4.10.1 T4 fix 1: an unchecked live API row never anchors its chains, nor does a live API row's source_url", db, async () => {
  // A live, fresh API row that went live without the owner (written before R4, or straight to the table).
  await seed(`v4101-unchk-${pid}`, 'api', { source_url: `https://src-${pid}.org/`, submission_url: `https://unchecked-${pid}.org/apply` });
  const r = await send(apiProgram(`v4101-unchk2-${pid}`, { chains: ['tempo'], any_chain: false, source_url: `https://unchecked-${pid}.org/`, submission_url: `https://unchecked-${pid}.org/b` }));
  assert.deepEqual([r.status, r.body.result], [202, 'pending'], r.text);
  // Approved by the owner (its current submission_url, its chains): its submission host anchors; its source host never.
  const approved = await seed(`v4101-appr-${pid}`, 'api', { source_url: `https://apsrc-${pid}.org/`, submission_url: `https://apsub-${pid}.org/apply` });
  await sql()`INSERT INTO program_writes (program_id, action, result, body) VALUES (${approved.id}, 'upsert', 'approved', ${sql().json(approved as never)})`;
  const viaSub = await send(apiProgram(`v4101-viasub-${pid}`, { chains: ['tempo'], any_chain: false, source_url: `https://apsub-${pid}.org/`, submission_url: `https://apsub-${pid}.org/two` }));
  assert.deepEqual([viaSub.status, viaSub.body.result], [200, 'created'], viaSub.text);
  const viaSrc = await send(apiProgram(`v4101-viasrc-${pid}`, { chains: ['tempo'], any_chain: false, source_url: `https://apsrc-${pid}.org/`, submission_url: `https://apsrc-${pid}.org/two` }));
  assert.deepEqual([viaSrc.status, viaSrc.body.result], [202, 'pending'], viaSrc.text);
  // Another chain: the approved row doesn't anchor it.
  const other = await send(apiProgram(`v4101-viaoth-${pid}`, { chains: ['monad'], any_chain: false, source_url: `https://apsub-${pid}.org/`, submission_url: `https://apsub-${pid}.org/three` }));
  assert.deepEqual([other.status, other.body.result], [202, 'pending'], other.text);
  // An approval of an older link doesn't vouch for a newer one written straight to the row.
  await sql()`UPDATE programs SET submission_url = ${`https://moved-${pid}.org/apply`} WHERE id = ${approved.id}`;
  const moved = await send(apiProgram(`v4101-viamov-${pid}`, { chains: ['tempo'], any_chain: false, source_url: `https://moved-${pid}.org/`, submission_url: `https://moved-${pid}.org/x` }));
  assert.deepEqual([moved.status, moved.body.result], [202, 'pending'], moved.text);
  // A stale approved API row (verified 20 days ago) no longer anchors.
  const stale = await seed(`v4101-stale-${pid}`, 'api', { verified_at: daysAgo(20), source_url: `https://stale-${pid}.org/`, submission_url: `https://stale-${pid}.org/apply` });
  await sql()`INSERT INTO program_writes (program_id, action, result, body) VALUES (${stale.id}, 'upsert', 'approved', ${sql().json(stale as never)})`;
  const viaStale = await send(apiProgram(`v4101-viastale-${pid}`, { chains: ['tempo'], any_chain: false, source_url: `https://stale-${pid}.org/`, submission_url: `https://stale-${pid}.org/x` }));
  assert.deepEqual([viaStale.status, viaStale.body.result], [202, 'pending'], viaStale.text);
});

test('v4.10.1 T4 fix 1: a closed or expired curated program never anchors; a live one does', db, async () => {
  await seed(`v4101-closed-${pid}`, 'file', { status: 'closed', source_url: `https://closed-${pid}.org/`, submission_url: `https://closed-${pid}.org/apply` });
  await seed(`v4101-expired-${pid}`, 'file', { source_url: `https://expired-${pid}.org/`, submission_url: `https://expired-${pid}.org/apply` });
  await sql()`UPDATE programs SET ends_at = now() - interval '1 day' WHERE id = ${`v4101-expired-${pid}`}`;
  await seed(`v4101-open-${pid}`, 'file', { source_url: `https://open-${pid}.org/`, submission_url: `https://open-${pid}.org/apply` });
  const at = (site: string, n: string) =>
    send(apiProgram(`v4101-${n}-w-${pid}`, { chains: ['tempo'], any_chain: false, source_url: `https://${site}-${pid}.org/`, submission_url: `https://${site}-${pid}.org/new` }));
  assert.equal((await at('closed', 'c')).body.result, 'pending', 'closed');
  assert.equal((await at('expired', 'e')).body.result, 'pending', 'past ends_at');
  assert.equal((await at('open', 'o')).body.result, 'created', 'a live curated program anchors');
});

test('v4.10.1 T4 fix 1: an anchor on a platform or shared host never counts (hackathon.monad.xyz never vouches for monad.xyz)', () => {
  assert.equal(linkChecksOut('monad.xyz', ['hackathon.monad.xyz']), false);
  assert.equal(linkChecksOut('evil.colosseum.com', ['colosseum.com']), false);
  assert.equal(linkChecksOut('www.base.org', ['forms.gle', 'www.base.org']), true);
  // The platform set covers every submit, hosting and shared host the code knows.
  for (const host of ['ethglobal.com', 'superteam.fun', 'gap.karmahq.xyz', 'taikai.network', 'app.akindo.io', 'evil.vercel.app', 'x.pages.dev', 'medium.com', 'mirror.xyz', 'colosseum.com'])
    assert.ok(linkPlatformName(host), host);
});

test('v4.10.1 T4 fix 1: changing chains on a live program re-runs the link check', db, async () => {
  const id = `v4101-chains-${pid}`;
  mails.length = 0;
  const created = await send(baseProgram(id, 'www.base.org', { submission_url: 'https://www.base.org/chains-test' }));
  assert.equal(created.body.result, 'created', created.text);
  // Monad has no curated program on base.org: the same link under a new chain waits.
  const moved = await send(baseProgram(id, 'www.base.org', { submission_url: 'https://www.base.org/chains-test', chains: ['monad'] }));
  assert.deepEqual([moved.status, moved.body.result], [202, 'pending'], moved.text);
  assert.deepEqual((await sql()<{ chains: string[] }[]>`SELECT chains FROM programs WHERE id = ${id}`)[0]!.chains, ['base'], 'the live row keeps its chains');
  // Adding a chain re-checks, and a curated Base site still checks out (one shared chain is enough).
  const added = await send(baseProgram(id, 'www.base.org', { submission_url: 'https://www.base.org/chains-test', chains: ['base', 'monad'] }));
  assert.deepEqual([added.status, added.body.result], [200, 'updated'], added.text);
  // The same chains in another order are no change.
  const same = await send(baseProgram(id, 'www.base.org', { submission_url: 'https://www.base.org/chains-test', chains: ['monad', 'base'] }));
  assert.equal(same.status, 200, same.text);
  assert.equal(mails.length, 1, 'only the monad-only write mailed');
});

test('v4.10.1 T4 fix 1: a failed owner email keeps the write pending, is recorded on the row, and the same write sent again retries it', db, async () => {
  const id = `v4101-mailfail-${pid}`;
  mails.length = 0;
  const program = baseProgram(id, 'base-grants-mail.org');
  failMail = true;
  let r;
  try {
    r = await send(program);
  } finally {
    failMail = false;
  }
  assert.deepEqual([r.status, r.body.result, (r.body as { owner_emailed?: boolean }).owner_emailed], [202, 'pending', false], r.text);
  let [w] = await pendingOf(id);
  assert.ok(w!.reason!.endsWith('; owner email not sent yet'), w!.reason!);
  assert.equal(mails.length, 0);
  const again = await send(program);
  assert.deepEqual([again.status, (again.body as { owner_emailed?: boolean }).owner_emailed], [202, true], again.text);
  assert.equal(mails.length, 1);
  assert.equal(mails[0]!.idempotencyKey, `program-pending:${w!.id}`, 'the same key: Resend never sends it twice');
  [w] = await pendingOf(id);
  assert.equal(w!.reason!.endsWith('; owner email not sent yet'), false);
  assert.equal((await pendingOf(id)).length, 1);
  await send(program);
  assert.equal(mails.length, 1, 'sent once: no third email');
});
