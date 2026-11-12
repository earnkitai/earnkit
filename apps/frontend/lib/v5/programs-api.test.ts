import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import type { Mailer } from './mail';
import { getProgram, upsertProgram } from './programs';
import { programFixture } from './fixtures/program';
import { record } from './ledger';
import { secretMatches } from './http';
import { programsListGet, watchCatalogRevalidation } from './programs-read';
import { approveExpiry, approveToken, pendingMailText, revertExpiry, revertToken } from './programs-pending';
import { applicationsGet, parseSince, programsApiOn, approveGet, approvePost, programsChanged, revertGet, revertPost, writePost, writesGet } from './programs-api';

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

test('a change to min_tier, sign_in or submit on a live program waits for approval', async () => {
  const p = body({ id: 'api-tier', title: 'Tier Grants' });
  await write(p);
  await approve('api-tier');
  sent = [];
  for (const [field, value] of [['min_tier', 'live'], ['sign_in', 'google'], ['submit', 'builder']] as const) {
    const res = await write({ ...p, [field]: value });
    assert.equal(res.status, 202, field);
    assert.equal(res.json.result, 'pending', field);
  }
  assert.equal((await getProgram('api-tier'))?.file.min_tier, undefined);
  assert.equal(sent.length, 3);
  assert.equal((await approve('api-tier')).status, 200);
  assert.equal((await getProgram('api-tier'))?.file.submit, 'builder');
});

test('the API cannot set reviewers_contact', async () => {
  const res = await write(body({ id: 'api-rev', reviewers_contact: 'a@b.co' }));
  assert.equal(res.status, 400);
  assert.deepEqual(res.json.problems, ["reviewers_contact: the API can't set reviewers_contact; the owner adds it by file"]);
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

test('a write that only changes form.url off the curated sites is pending; approving applies it', async () => {
  const p = body({
    id: 'api-form-url',
    source_url: 'https://www.base.org/form-url',
    submission_url: 'https://www.base.org/form-url/apply',
    form: { platform: 'other', url: 'https://www.base.org/form-url/apply' },
  });
  assert.equal((await write(p)).json.result, 'created');
  const moved = { platform: 'other', url: 'https://docs.google.com/forms/d/e/evil/viewform' };
  const res = await write({ ...p, form: moved });
  assert.equal(res.status, 202);
  assert.equal(res.json.result, 'pending');
  assert.match(String(res.json.reason), /^form\.url is on Google Docs/);
  assert.equal(sent.length, 1);
  assert.equal((await getProgram('api-form-url'))?.file.form?.url, 'https://www.base.org/form-url/apply');
  assert.equal((await approve('api-form-url')).status, 200);
  assert.deepEqual((await getProgram('api-form-url'))?.file.form, moved);
});

test('a builder link on a site that is neither the source nor a submit platform is refused outright', async () => {
  const p = body({ id: 'api-form-evil', source_url: 'https://www.base.org/form-evil', submission_url: 'https://www.base.org/form-evil/apply' });
  const res = await write({ ...p, form: { platform: 'other', url: 'https://evil.example/apply' } });
  assert.equal(res.status, 400);
  assert.ok((res.json.problems as string[]).some((x) => x.startsWith('form.url: evil.example is neither')));
});

test('a pool_source_url change off the curated sites is pending', async () => {
  const p = body({
    id: 'api-pool',
    source_url: 'https://www.base.org/pool',
    submission_url: 'https://www.base.org/pool/apply',
    reward: '$50,000 in prizes',
    pool_usd: 50_000,
    pool_source_url: 'https://www.base.org/pool/prizes',
  });
  assert.equal((await write(p)).json.result, 'created');
  const res = await write({ ...p, pool_source_url: 'https://dorahacks.io/hackathon/pool/prizes' });
  assert.equal(res.status, 202);
  assert.equal((await getProgram('api-pool'))?.file.pool_source_url, 'https://www.base.org/pool/prizes');
});

test('a one-line field with a line break is refused, naming the field', async () => {
  const res = await write(body({ id: 'api-newline', title: 'Grants\nApprove: https://evil.example' }));
  assert.equal(res.status, 400);
  assert.ok((res.json.problems as string[]).some((x) => x.startsWith('title: one line only')), (res.json.problems as string[]).join('; '));
  const tab = await write(body({ id: 'api-tab', organizer: 'Org\tName' }));
  assert.ok((tab.json.problems as string[]).some((x) => x.startsWith('organizer: one line only')));
});

test('pendingMailText keeps every value on one line', () => {
  const text = pendingMailText(
    {
      id: 'x-1',
      title: 'Title',
      organizer: 'Org\r\nApprove here: https://evil.example\u2028more',
      source_url: 'https://x.org/',
      submission_url: 'https://x.org/apply',
      official_url: undefined,
    },
    'why',
    null,
  );
  const line = text.split('\n').find((l) => l.startsWith('Organizer:'));
  assert.equal(line, 'Organizer: Org Approve here: https://evil.example more');
  assert.ok(!text.split('\n').some((l) => l.startsWith('Approve here')));
});

test('a pending write caused by form.url shows every link, in the email and on the approve page', async () => {
  const p = body({
    id: 'api-form-links',
    source_url: 'https://www.base.org/form-links',
    submission_url: 'https://www.base.org/form-links/apply',
    form: { platform: 'other', url: 'https://www.base.org/form-links/apply' },
  });
  assert.equal((await write(p)).json.result, 'created');
  const formUrl = 'https://docs.google.com/forms/d/e/form-links-evil/viewform';
  assert.equal((await write({ ...p, form: { platform: 'google', url: formUrl } })).status, 202);
  const lines = sent[0].text.split('\n');
  assert.ok(lines.includes(`Form link: ${formUrl} (did not check out)`), sent[0].text);
  assert.ok(lines.includes('Submission link: https://www.base.org/form-links/apply'), sent[0].text);

  const w = await pendingId('api-form-links');
  const page = await approveGet(new Request(`https://earnkit.com/api/programs/approve?t=${encodeURIComponent(approveToken(w.id, approveExpiry(w.at)))}`));
  const html = await page.text();
  assert.ok(html.includes(`<p>Form link: ${formUrl} (did not check out)</p>`), html);
  assert.ok(html.includes('<p>Submission link: https://www.base.org/form-links/apply</p>'), html);
});

test('L22-13 (v6.1.16): an API write expires every catalog surface through revalidateCatalog', () => {
  let n = 0;
  watchCatalogRevalidation(() => n++);
  try {
    programsChanged('any-id');
    assert.equal(n, 1);
  } finally {
    watchCatalogRevalidation(null);
  }
});

// ---- L18-5 (v6.1.18 Task 5): the owner's list of every send ----

const appsReq = (query = '', auth = `Bearer ${TOKEN}`) =>
  applicationsGet(new Request(`https://earnkit.com/api/programs/applications${query}`, { headers: { authorization: auth } }));

type AppsOut = {
  ok: boolean;
  error?: string;
  totals: { all: number; agent: number; drafted: number; reported: number; auto: number; by_program: { program_id: string; title: string; sent: number }[] };
  rows: Record<string, unknown>[];
};

/**
 * Sends for L18-5, removed by `cleanSends`: an agent's (an unlinked installation), a builder's drafted on EarnKit (a `b:`
 * owner, a start before it), and a builder's reported from outside (an `i:` owner on an installation linked to a
 * builder, no start). A claim is not a send.
 */
const seedSends = async () => {
  const db = sql();
  const [b] = await db<{ id: number }[]>`INSERT INTO builders (github_id, login) VALUES (918273, 'l185-login') RETURNING id`;
  const [b2] = await db<{ id: number }[]>`INSERT INTO builders (github_id, login) VALUES (918274, 'l185-linked') RETURNING id`;
  const [ia] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name) VALUES ('l185-a', 'Claude Code') RETURNING id`;
  const [ib] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, builder_id) VALUES ('l185-b', 'Cursor', ${b.id}) RETURNING id`;
  const [ic] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, builder_id) VALUES ('l185-c', 'Codex', ${b2.id}) RETURNING id`;
  const t1 = new Date('2030-01-02T10:00:00Z');
  const t2 = new Date('2030-01-03T10:00:00Z');
  const t3 = new Date('2030-01-05T10:00:00Z');
  await db`INSERT INTO applications (owner, installation_id, program_id, status, at, sent_at, submitted_by, auto_applied, title, application_id, fields_used)
    VALUES (${'i:' + ia.id}, ${ia.id}, 'l185-alpha', 'applied', ${t1}, ${t1}, 'agent', true, 'Alpha Grants', 'app_l185a', ${['name', 'url']})`;
  await db`INSERT INTO application_history (owner, installation_id, program_id, status, at) VALUES (${'b:' + b.id}, ${ib.id}, 'l185-beta', 'started', ${t1})`;
  await db`INSERT INTO applications (owner, installation_id, program_id, status, at, sent_at, submitted_by, auto_applied, title, application_id, amount_usd)
    VALUES (${'b:' + b.id}, ${ib.id}, 'l185-beta', 'won', ${new Date('2030-01-04T10:00:00Z')}, ${t2}, 'builder', false, 'Beta Prize', 'app_l185b', 500)`;
  await db`INSERT INTO applications (owner, installation_id, program_id, status, at, sent_at, submitted_by, title, application_id)
    VALUES (${'i:' + ic.id}, ${ic.id}, 'l185-alpha', 'applied', ${t3}, ${t3}, 'builder', 'Alpha Grants', 'app_l185d')`;
  await db`INSERT INTO applications (owner, installation_id, program_id, status, at, title, application_id)
    VALUES (${'i:' + ia.id}, ${ia.id}, 'l185-gamma', 'started', ${t2}, 'Gamma', 'app_l185c')`;
  // An unmarked send (submitted_by null) is the agent's (L29-23).
  const t0 = new Date('2030-01-01T10:00:00Z');
  await db`INSERT INTO applications (owner, installation_id, program_id, status, at, sent_at, title, application_id)
    VALUES (${'i:' + ia.id}, ${ia.id}, 'l185-delta', 'applied', ${t0}, ${t0}, 'Delta Fund', 'app_l185e')`;
  return { ia: ia.id, ib: ib.id, ic: ic.id };
};
const cleanSends = async () => {
  const db = sql();
  await db`DELETE FROM application_history WHERE program_id LIKE 'l185-%'`;
  await db`DELETE FROM applications WHERE application_id LIKE 'app_l185%'`;
  await db`DELETE FROM installations WHERE token_hash LIKE 'l185-%'`;
  await db`DELETE FROM builders WHERE github_id IN (918273, 918274)`;
};

test('L18-5: 404 while the API is off, 401 on a wrong token, 200 with totals and rows for an agent send, a drafted and a reported builder send, the builder named by login and no email', async () => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  assert.equal((await appsReq()).status, 404);
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  assert.equal((await appsReq('', 'Bearer wrong')).status, 401);
  const { ia, ib, ic } = await seedSends();
  try {
    const res = await appsReq('?since=2030-01-01T00:00:00Z');
    assert.equal(res.status, 200);
    const raw = await res.text();
    const out = JSON.parse(raw) as AppsOut;
    assert.equal(out.ok, true);
    assert.deepEqual(out.totals, {
      all: 4, agent: 2, drafted: 1, reported: 1, auto: 1,
      by_program: [
        { program_id: 'l185-alpha', title: 'Alpha Grants', sent: 2 },
        { program_id: 'l185-beta', title: 'Beta Prize', sent: 1 },
        { program_id: 'l185-delta', title: 'Delta Fund', sent: 1 },
      ],
    });
    assert.equal(out.totals.agent + out.totals.drafted + out.totals.reported, out.totals.all);
    assert.deepEqual(out.rows, [
      {
        // An `i:` owner on a linked installation: the linked builder's login (fix round 1, ruling 3).
        application_id: 'app_l185d', program_id: 'l185-alpha', title: 'Alpha Grants', status: 'applied', submitted_by: 'builder', auto_applied: false,
        sent_at: '2030-01-05T10:00:00.000Z', at: '2030-01-05T10:00:00.000Z', builder: 'l185-linked', agent: 'Codex', fields_used: 0, amount_usd: null, through_earnkit: false, reported: true,
      },
      {
        application_id: 'app_l185b', program_id: 'l185-beta', title: 'Beta Prize', status: 'won', submitted_by: 'builder', auto_applied: false,
        sent_at: '2030-01-03T10:00:00.000Z', at: '2030-01-04T10:00:00.000Z', builder: 'l185-login', agent: 'Cursor', fields_used: 0, amount_usd: 500, through_earnkit: true, reported: false,
      },
      {
        // An `i:` owner on an unlinked installation: no builder.
        application_id: 'app_l185a', program_id: 'l185-alpha', title: 'Alpha Grants', status: 'applied', submitted_by: 'agent', auto_applied: true,
        sent_at: '2030-01-02T10:00:00.000Z', at: '2030-01-02T10:00:00.000Z', builder: null, agent: 'Claude Code', fields_used: 2, amount_usd: null, through_earnkit: true, reported: false,
      },
      {
        // Unmarked: the agent's (L42-9: listed as 'agent', the stored null stays), so through EarnKit.
        application_id: 'app_l185e', program_id: 'l185-delta', title: 'Delta Fund', status: 'applied', submitted_by: 'agent', auto_applied: false,
        sent_at: '2030-01-01T10:00:00.000Z', at: '2030-01-01T10:00:00.000Z', builder: null, agent: 'Claude Code', fields_used: 0, amount_usd: null, through_earnkit: true, reported: false,
      },
    ]);
    // Never an email, a sign-in code or an installation id (the rows' keys are exactly the ones above).
    assert.doesNotMatch(raw, /@|installation|"owner"|"i:|"b:/);
    assert.ok(ia > 0 && ib > 0 && ic > 0);
  } finally {
    await cleanSends();
  }
});

test('L18-5b: since filters the rows only (totals stay all time), limit caps at 500, a bad since is 400 "since: an ISO date"', async () => {
  await seedSends();
  try {
    const all = (await (await appsReq()).json()) as AppsOut;
    const later = (await (await appsReq('?since=2030-01-03T00:00:00Z')).json()) as AppsOut;
    assert.deepEqual(later.rows.map((r) => r.application_id), ['app_l185d', 'app_l185b']);
    assert.deepEqual(later.totals, all.totals, 'totals are all time whatever since says');
    assert.ok(all.totals.all >= 4);
    const one = (await (await appsReq('?since=2030-01-01T00:00:00Z&limit=1')).json()) as AppsOut;
    assert.deepEqual(one.rows.map((r) => r.application_id), ['app_l185d']);
    assert.equal(one.totals.all, all.totals.all, 'the totals count every send, not the page');
    assert.equal((await appsReq('?limit=9999')).status, 200);
    assert.deepEqual(await (await appsReq('?limit=0')).json(), { ok: false, error: 'limit: 1 to 500' });
    const bad = await appsReq('?since=yesterday');
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { ok: false, error: 'since: an ISO date' });
    const { APPLICATIONS_MAX } = await import('./programs-api');
    assert.equal(APPLICATIONS_MAX, 500);
  } finally {
    await cleanSends();
  }
});

// ---- v6.1.19 Task 1 (lane 42): the owner's count tells the truth ----

test('L42-3: a token with a trailing newline turns the API on and accepts the right bearer', async () => {
  process.env.EARNKIT_PROGRAMS_TOKEN = `${TOKEN}\n`;
  assert.equal(programsApiOn(), true);
  assert.equal((await appsReq()).status, 200);
  assert.equal((await appsReq('', 'Bearer wrong')).status, 401);
  // 31 characters and a newline is still too short: the length rule reads the trimmed token.
  process.env.EARNKIT_PROGRAMS_TOKEN = `${'p'.repeat(31)}\n`;
  assert.equal(programsApiOn(), false);
});

test('L42-3: secretMatches trims the secret and reads its length trimmed', () => {
  const secret = 'c'.repeat(40);
  assert.equal(secretMatches(secret, `${secret}\n`), true);
  assert.equal(secretMatches(secret, `  ${secret} \r\n`), true);
  assert.equal(secretMatches('c'.repeat(31), `${'c'.repeat(31)}\n`), false);
  assert.equal(secretMatches('wrong', `${secret}\n`), false);
});

test('L42-4, L42-8: parseSince', () => {
  assert.equal(parseSince('2026-02-30'), null);
  assert.equal(parseSince('2026-11-12T24:00'), null);
  assert.equal(parseSince('2026-11-12T10:60'), null);
  assert.equal(parseSince('2026-13-01'), null);
  assert.equal(parseSince('yesterday'), null);
  assert.equal(parseSince('2026-11-12T10:00')!.toISOString(), '2026-11-12T10:00:00.000Z');
  assert.equal(parseSince('2026-11-12T10:00+05:30')!.toISOString(), '2026-11-12T04:30:00.000Z');
  assert.equal(parseSince('2026-11-12')!.toISOString(), '2026-11-12T00:00:00.000Z');
  assert.equal(parseSince('2026-11-12T10:00:30.250Z')!.toISOString(), '2026-11-12T10:00:30.250Z');
  assert.equal(parseSince('2024-02-29')!.toISOString(), '2024-02-29T00:00:00.000Z');
});

test('L42-4: since=2026-02-30 is 400 "since: an ISO date"', async () => {
  const bad = await appsReq('?since=2026-02-30');
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { ok: false, error: 'since: an ISO date' });
});

test('L42-6, L42-2: agent is the installation that recorded the send, not the one that recorded its result; an outside win is undated, reported and listed last', async () => {
  const db = sql();
  const at = new Date('2030-02-01T10:00:00Z');
  await upsertProgram(programFixture({ id: 'l42-send', title: 'L42 Send', max_award_usd: 5000 }), 'file', at);
  await upsertProgram(programFixture({ id: 'l42-outside', title: 'L42 Outside', max_award_usd: 5000 }), 'file', at);
  const [b] = await db<{ id: number }[]>`INSERT INTO builders (github_id, login) VALUES (918420, 'l42-login') RETURNING id`;
  const [ia] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, builder_id) VALUES ('l42-a', 'Claude Code', ${b.id}) RETURNING id`;
  const [ib] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, builder_id) VALUES ('l42-b', 'Cursor', ${b.id}) RETURNING id`;
  const owner = `b:${b.id}`;
  try {
    assert.equal((await record(owner, 'l42-send', 'applied', { installationId: ia.id, submitted_by: 'agent', now: at })).ok, true);
    assert.equal((await record(owner, 'l42-send', 'won', { installationId: ib.id, amount_usd: 100, now: new Date('2030-02-03T10:00:00Z') })).ok, true);
    // The outside win is recorded after the send, so a sort by `at` alone would list it first.
    const out = await record(owner, 'l42-outside', 'won', { installationId: ib.id, amount_usd: 100, outsideWin: true, now: new Date('2030-02-05T10:00:00Z') });
    assert.equal(out.ok && out.outside, true);
    const res = (await (await appsReq('?since=2030-02-01T00:00:00Z')).json()) as AppsOut;
    const rows = res.rows.filter((r) => String(r.program_id).startsWith('l42-'));
    assert.deepEqual(rows.map((r) => [r.program_id, r.agent, r.sent_at, r.reported, r.submitted_by]), [
      ['l42-send', 'Claude Code', '2030-02-01T10:00:00.000Z', false, 'agent'],
      ['l42-outside', 'Cursor', null, true, 'builder'],
    ]);
    assert.equal(res.rows.at(-1)!.program_id, 'l42-outside', 'an undated row is listed last');
    // since: an undated row is kept by its `at` (it has no other date); a dated one by its send time.
    const later = (await (await appsReq('?since=2030-02-02T00:00:00Z')).json()) as AppsOut;
    assert.deepEqual(later.rows.map((r) => r.program_id), ['l42-outside']);
  } finally {
    await db`DELETE FROM application_history WHERE program_id LIKE 'l42-%'`;
    await db`DELETE FROM applications WHERE program_id LIKE 'l42-%'`;
    await db`DELETE FROM installations WHERE token_hash IN ('l42-a', 'l42-b')`;
    await db`DELETE FROM builders WHERE github_id = 918420`;
  }
});
