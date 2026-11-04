import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import type { Mailer } from './mail';
import { getProgram } from './programs';
import { programsListGet } from './programs-read';
import { approveExpiry, approveToken, revertExpiry, revertToken } from './programs-pending';
import { approveGet, approvePost, revertGet, revertPost, writePost, writesGet } from './programs-api';

after(() => sql().end());

const TOKEN = 'p'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);

let sent: Parameters<Mailer>[0][] = [];
const mailer: Mailer = async (m) => {
  sent.push(m);
};
const probe = async () => {};

beforeEach(() => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  process.env.EARNKIT_AUTH_SECRET = 's'.repeat(40);
  process.env.RESEND_API_KEY = 're_test';
  sent = [];
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_AUTH_SECRET;
  delete process.env.RESEND_API_KEY;
});

/**
 * A valid program body for the API, on its own site (`<id>.org`) that no curated program shares
 * (an approved API program anchors its own site, so each test program gets a fresh one).
 */
const body = (over: Record<string, unknown> & { id: string }) => ({
  organizer: 'Unknown Org',
  title: 'Unknown Grants',
  description: 'Grants for builders.',
  source_url: `https://${over.id}.org/grants`,
  submission_url: `https://${over.id}.org/apply`,
  reward: 'Up to $5,000 per grant',
  starts_at: null,
  ends_at: null,
  status: 'active',
  verified_at: TODAY,
  existing_work: 'allowed',
  setup: [],
  each_time: [],
  chains: ['base'],
  summary: 'Up to $5,000 · rolling',
  rules: [],
  category: 'grant',
  needs_repo: true,
  max_award_usd: 5000,
  submission_requirements: [
    { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
  ],
  ...over,
});

const post = (payload: unknown, auth = `Bearer ${TOKEN}`) =>
  new Request('https://earnkit.com/api/programs/write', {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

const write = async (program: Record<string, unknown>) => {
  const res = await writePost(post({ action: 'upsert', program }), { mailer, probe });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const pendingId = async (programId: string): Promise<{ id: string; at: Date }> => {
  const [w] = await sql()<{ id: string; at: Date }[]>`
    SELECT id, at FROM program_writes WHERE program_id = ${programId} AND result = 'pending' ORDER BY id DESC LIMIT 1`;
  return w!;
};

const approve = async (programId: string) => {
  const w = await pendingId(programId);
  const t = encodeURIComponent(approveToken(w.id, approveExpiry(w.at)));
  return approvePost(new Request(`https://earnkit.com/api/programs/approve?t=${t}`, { method: 'POST' }), { probe });
};

const listed = async () => {
  const res = await programsListGet(new Request('https://earnkit.com/api/programs'));
  return ((await res.json()) as { programs: { id: string; submission_url: string }[] }).programs;
};

test('the API is 404 without the token set, 401 with a wrong one', async () => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  assert.equal((await writePost(post({ action: 'upsert', program: {} }))).status, 404);
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  assert.equal((await writePost(post({ action: 'upsert', program: {} }, 'Bearer wrong'))).status, 401);
});

test('a body over 256 KB is 413; not JSON is 400', async () => {
  const big = new Request('https://earnkit.com/api/programs/write', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body: 'x'.repeat(256 * 1024 + 1),
  });
  assert.equal((await writePost(big)).status, 413);
  const bad = new Request('https://earnkit.com/api/programs/write', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{' });
  assert.equal((await writePost(bad)).status, 400);
});

test('a new program on an unknown site is 202 pending and emails the owner once', async () => {
  const p = body({ id: 'api-new-unknown' });
  const first = await write(p);
  assert.equal(first.status, 202);
  assert.equal(first.json.result, 'pending');
  assert.equal(first.json.owner_emailed, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /api-new-unknown/);
  assert.match(sent[0].text, /\/api\/programs\/approve\?t=/);
  assert.equal(await getProgram('api-new-unknown'), null);

  const again = await write(p);
  assert.equal(again.status, 202);
  assert.equal(again.json.result, 'pending');
  assert.equal(sent.length, 1);
});

test('a program on a curated site for its chains goes live at once', async () => {
  const p = body({
    id: 'api-base-live',
    source_url: 'https://www.base.org/grants-new',
    submission_url: 'https://www.base.org/grants-new/apply',
  });
  const res = await write(p);
  assert.equal(res.status, 200);
  assert.equal(res.json.result, 'created');
  assert.equal(res.json.live, true);
  assert.equal(sent.length, 0);
  assert.equal((await getProgram('api-base-live'))?.source, 'api');
  assert.equal((await write(p)).json.result, 'unchanged');
});

test('a write with chains: [solana] is accepted', async () => {
  const res = await write(body({ id: 'api-solana', chains: ['solana'] }));
  assert.equal(res.json.ok, true);
  assert.ok([200, 202].includes(res.status));
});

test('an unknown chain slug is refused with the schema message', async () => {
  const res = await write(body({ id: 'api-bad-chain', chains: ['notachain'] }));
  assert.equal(res.status, 400);
  assert.deepEqual(res.json.problems, ['chains.0: not a known chain (chains.ts)']);
});

test('an Optimism URL is accepted', async () => {
  const res = await write(
    body({
      id: 'api-optimism',
      chains: ['optimism'],
      source_url: 'https://atlas.optimism.io/missions',
      submission_url: 'https://atlas.optimism.io/missions/apply',
    }),
  );
  assert.equal(res.json.ok, true);
  assert.ok([200, 202].includes(res.status));
});

test('a curated id is 409', async () => {
  const res = await write(body({ id: 'base-builder-grants' }));
  assert.equal(res.status, 409);
  assert.deepEqual(res.json.problems, ['base-builder-grants is curated by EarnKit; send a new id or ask the owner']);
});

test('logo and unknown fields are refused', async () => {
  const res = await write(body({ id: 'api-logo', logo: { path: 'programs/api-logo.svg', source_url: 'https://api-logo.org/logo' }, color: 'red' }));
  assert.equal(res.status, 400);
  assert.deepEqual(res.json.problems, [
    "logo: the API can't set logo; the owner adds it by file",
    'color: not a program field',
  ]);
});

test('form.fields with an id that is not a requirement key is refused', async () => {
  const res = await write(body({ id: 'api-form-extra', form: { platform: 'google', fields: { nope: 'entry.1' } } }));
  assert.equal(res.status, 400);
  assert.deepEqual(res.json.problems, ['(program): form.fields key "nope" is not a submission requirement key']);
});

test('a link in a text field and a submission link off-site are refused', async () => {
  const res = await write(
    body({ id: 'api-links', description: 'See evil.com for more.', submission_url: 'https://other-site.org/apply' }),
  );
  assert.equal(res.status, 400);
  const problems = res.json.problems as string[];
  assert.ok(problems.some((x) => x.startsWith('description:')), problems.join('; '));
  assert.ok(problems.some((x) => x.startsWith('submission_url: other-site.org is neither')), problems.join('; '));
});

test('a link that does not load is refused', async () => {
  const res = await writePost(post({ action: 'upsert', program: body({ id: 'api-dead' }) }), {
    mailer,
    probe: async () => {
      throw new Error('answered 404');
    },
  });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { problems: string[] }).problems[0], /^source_url: doesn't load/);
});

test('form change waits for approval', async () => {
  const p = body({ id: 'api-form', title: 'Form Grants' });
  assert.equal((await write(p)).json.result, 'pending');
  const approved = await approve('api-form');
  assert.equal(approved.status, 200);
  assert.equal((await getProgram('api-form'))?.file.form, undefined);
  assert.equal((await listed()).find((x) => x.id === 'api-form')?.submission_url, 'https://api-form.org/apply');
  sent = [];

  const form = { platform: 'google', url: 'https://docs.google.com/forms/d/e/abc/viewform', fields: { project_name: 'entry.123' } };
  const res = await write({ ...p, form });
  assert.equal(res.status, 202);
  assert.equal(res.json.result, 'pending');
  assert.equal(sent.length, 1);
  assert.equal((await listed()).find((x) => x.id === 'api-form')?.submission_url, 'https://api-form.org/apply');
  assert.equal((await getProgram('api-form'))?.file.form, undefined);

  const page = await approveGet(
    new Request(`https://earnkit.com/api/programs/approve?t=${encodeURIComponent(approveToken((await pendingId('api-form')).id, approveExpiry((await pendingId('api-form')).at)))}`),
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form method="post"/);
  assert.equal((await getProgram('api-form'))?.file.form, undefined);

  assert.equal((await approve('api-form')).status, 200);
  assert.deepEqual((await getProgram('api-form'))?.file.form, form);
});

test('a change outside the link, chains and form on a live program goes live at once', async () => {
  const p = body({ id: 'api-reward', title: 'Reward Grants' });
  await write(p);
  await approve('api-reward');
  const res = await write({ ...p, reward: 'Up to $8,000 per grant', max_award_usd: 8000 });
  assert.equal(res.status, 200);
  assert.equal(res.json.result, 'updated');
  assert.equal((await getProgram('api-reward'))?.file.max_award_usd, 8000);
});

test('an approve link is single use, and a bad token changes nothing', async () => {
  await write(body({ id: 'api-once', title: 'Once Grants' }));
  const w = await pendingId('api-once');
  const t = encodeURIComponent(approveToken(w.id, approveExpiry(w.at)));
  const req = (token: string) => new Request(`https://earnkit.com/api/programs/approve?t=${token}`, { method: 'POST' });
  assert.equal((await approvePost(req(t), { probe })).status, 200);
  assert.equal((await approvePost(req(t), { probe })).status, 409);
  const bad = await approvePost(req(`${t.slice(0, -2)}xx`), { probe });
  assert.equal(bad.status, 400);
});

const appliedWrite = async (programId: string, result: string) => {
  const [w] = await sql()<{ id: string; at: Date }[]>`
    SELECT id, at FROM program_writes WHERE program_id = ${programId} AND action = 'upsert' AND result = ${result} ORDER BY id DESC LIMIT 1`;
  return w!;
};
const revertReq = (w: { id: string; at: Date }, method = 'POST') =>
  new Request(`https://earnkit.com/api/programs/revert?t=${encodeURIComponent(revertToken(w.id, revertExpiry(w.at)))}`, { method });

test('revert puts the program back as it was before that write, once', async () => {
  const p = body({ id: 'api-revert', title: 'Revert Grants' });
  await write(p);
  await approve('api-revert');
  await write({ ...p, reward: 'Up to $9,000 per grant', max_award_usd: 9000 });
  const w = await appliedWrite('api-revert', 'updated');

  const page = await revertGet(revertReq(w, 'GET'));
  assert.equal(page.status, 200);
  assert.equal((await getProgram('api-revert'))?.file.max_award_usd, 9000);

  assert.equal((await revertPost(revertReq(w))).status, 200);
  assert.equal((await getProgram('api-revert'))?.file.max_award_usd, 5000);
  assert.equal((await revertPost(revertReq(w))).status, 409);
});

test('reverting the write that created a program closes it', async () => {
  await write(body({ id: 'api-revert-new', title: 'New Revert Grants' }));
  await approve('api-revert-new');
  const w = await appliedWrite('api-revert-new', 'created');
  assert.equal((await revertPost(revertReq(w))).status, 200);
  assert.equal((await getProgram('api-revert-new'))?.file.status, 'closed');
  assert.ok(!(await listed()).some((x) => x.id === 'api-revert-new'));
});

test('close: an api program closes; a curated one is 409', async () => {
  await write(body({ id: 'api-close', source_url: 'https://www.base.org/close-me', submission_url: 'https://www.base.org/close-me/apply' }));
  const res = await writePost(post({ action: 'close', id: 'api-close', reason: 'the round ended' }), { mailer, probe });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { result: string }).result, 'closed');
  assert.equal((await getProgram('api-close'))?.file.status, 'closed');
  const curated = await writePost(post({ action: 'close', id: 'base-builder-grants', reason: 'no' }), { mailer, probe });
  assert.equal(curated.status, 409);
});

test('writesGet: the audit rows without bodies, and the pending writes', async () => {
  await write(body({ id: 'api-writes', title: 'Writes Grants' }));
  const res = await writesGet(new Request('https://earnkit.com/api/programs/writes', { headers: { authorization: `Bearer ${TOKEN}` } }));
  assert.equal(res.status, 200);
  const out = (await res.json()) as { writes: Record<string, unknown>[]; pending: Record<string, unknown>[] };
  assert.ok(out.writes.length > 0);
  assert.ok(out.writes.every((w) => !('body' in w)));
  assert.equal(out.pending.find((w) => w.program_id === 'api-writes')?.title, 'Writes Grants');
});
