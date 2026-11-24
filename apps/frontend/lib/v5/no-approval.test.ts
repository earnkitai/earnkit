/**
 * v3.8 decision 25 (H5): no person approves a program add. The owner approval email, the signed approve link, its
 * confirm page and app/api/programs/approve are deleted; this test fails if any of them returns. (`/me/approve` is the
 * builder approving their own answers, not a program approval, and is not matched.) The automated lane (auto_live,
 * Growth's check fields, the owner or a test caller through main's flag preview) goes live or is refused; it is never held.
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sql } from './db';
import { getProgram } from './programs';
import * as programsApi from './programs-api';
import * as programsPending from './programs-pending';
import { writePost } from './programs-api';
import { withFlagPreview } from './flags';
import { upsertBuilder } from '../v6/builders';
import { withSessionFlags } from '../v6/flag-preview';
import { cookieName, createSession } from '../v6/sessions';

after(() => sql().end());

const FRONTEND = join(import.meta.dirname, '..', '..');
const TOKEN = 'n'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
const ENDS = `${new Date().getUTCFullYear() + 1}-03-15T23:59:00Z`;
const year = new Date(ENDS).getUTCFullYear();

/** Every source file under app/ and lib/, tests and fixtures left out. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'fixtures' || name === 'node_modules' ? [] : sources(p);
    return /\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : [];
  });
}

/** What an owner approval path is made of. */
const BANNED: [RegExp, string][] = [
  [/programs\/approve/, 'the approve route'],
  [/program-approve/, 'the approve link signature'],
  [/\bapprove(Url|Token|Target|Expiry)\b/, 'the signed approve link'],
  [/\bAPPROVE_(TEXT|TTL_DAYS)\b/, 'the approve confirm page'],
  [/\b(mailPending|pendingMailText|PENDING_SUBJECT)\b/, 'the owner approval email'],
  [/\bowner_emailed\b/, 'the owner approval email'],
  [/program write waits for|waits for the owner|approve it here|Approve this program/i, 'owner approval copy'],
];

test('app/api/programs/approve does not exist', () => {
  assert.equal(existsSync(join(FRONTEND, 'app', 'api', 'programs', 'approve')), false);
});

test('the write API exports nothing that approves a program', () => {
  const names = [...Object.keys(programsApi), ...Object.keys(programsPending)].filter((n) => /approve/i.test(n));
  assert.deepEqual(names, []);
});

test('no source file carries an owner approval path', () => {
  const hits = sources(join(FRONTEND, 'app'))
    .concat(sources(join(FRONTEND, 'lib')))
    .flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return BANNED.filter(([re]) => re.test(text)).map(([, what]) => `${relative(FRONTEND, file)}: ${what}`);
    });
  assert.deepEqual(hits, []);
});

beforeEach(() => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  process.env.EARNKIT_AUTH_SECRET = 's'.repeat(40);
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_AUTH_SECRET;
  delete process.env.EARNKIT_FLAGS;
});

/** A new program on a site no curated program anchors: the held lane would hold it. */
const program = (id: string) => ({
  id,
  organizer: `Org ${id}`,
  title: 'Builder Grants',
  description: 'Grants for builders.',
  source_url: `https://${id}.org/grants`,
  submission_url: `https://${id}.org/apply`,
  reward: 'Up to $10,000 per grant',
  starts_at: null,
  ends_at: ENDS,
  status: 'active',
  verified_at: TODAY,
  existing_work: 'allowed',
  setup: [],
  each_time: [],
  chains: ['base'],
  summary: 'Up to $10,000',
  rules: [],
  category: 'grant',
  needs_repo: true,
  max_award_usd: 10000,
  submission_requirements: [
    { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
  ],
});
const page = (id: string) =>
  `<html><body><p>Each team gets up to $10,000 in funding.</p><p>Applications close March 15, ${year}.</p><a href="https://${id}.org/apply">Apply</a></body></html>`;
const CHECK = {
  amount_quote: 'up to $10,000 in funding',
  deadline_quote: `Applications close March 15, ${year}.`,
  found_by_query: 'base grants',
  found_by_source: 'x:@someorg',
};

const send = async (id: string, extra: Record<string, unknown>, preview = false) => {
  const res = await withFlagPreview(preview, () => writePost(
    new Request('https://earnkit.com/api/programs/write', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', program: program(id), ...extra }),
    }),
    { probe: async () => {}, readPage: async () => page(id) },
  ));
  const pending = await sql()`SELECT 1 FROM program_writes WHERE program_id = ${id} AND result = 'pending'`;
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, pending: pending.length };
};

const assertNoApproval = (out: Awaited<ReturnType<typeof send>>) => {
  assert.notEqual(out.status, 202, JSON.stringify(out.json));
  assert.notEqual(out.json.result, 'pending');
  assert.equal('owner_emailed' in out.json, false);
  assert.equal(out.pending, 0);
};

test('auto_live on: a write main would hold goes live with never held', async () => {
  process.env.EARNKIT_FLAGS = 'auto_live';
  const out = await send('na-flag', CHECK);
  assertNoApproval(out);
  assert.equal(out.json.result, 'created');
  assert.equal((await getProgram('na-flag'))?.source, 'api');
});

test("auto_live off, Growth's writer sends the check's fields: live through the check, no approval", async () => {
  const out = await send('na-growth', CHECK);
  assertNoApproval(out);
  assert.equal(out.json.result, 'created');
});

test('auto_live off, the owner or a test-preview caller: live through the check, no approval', async () => {
  const out = await send('na-preview', CHECK, true);
  assertNoApproval(out);
  assert.equal(out.json.result, 'created');
});

test('the automated lane refuses a write that fails the check: still never held or mailed', async () => {
  const missing = await send('na-missing', {}, true);
  assertNoApproval(missing);
  assert.equal(missing.status, 400);
  const wrong = await send('na-wrong', { ...CHECK, amount_quote: 'up to $99,000 in funding' });
  assertNoApproval(wrong);
  assert.equal(wrong.status, 400);
  assert.equal(await getProgram('na-wrong'), null);
});

const cookieFor = async (login: string, githubId: number, testReason: string | null) => {
  const b = await upsertBuilder({ github_id: githubId, login, name: null, avatar_url: null }, new Date());
  if (testReason) await sql()`INSERT INTO people (builder_id, test_reason, test_reason_source) VALUES (${b.id}, ${testReason}, 'test') ON CONFLICT (builder_id) DO UPDATE SET test_reason = EXCLUDED.test_reason`;
  const { token } = await createSession(b.id, new Date());
  return `${cookieName()}=${token}`;
};

/** Status of a write with no check fields, run as the route runs it (in the session's flag context). 400 = automated lane refused it (no quotes); 202 = held. */
const laneFor = async (cookie: string | null, id: string): Promise<number> => {
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const request = new Request('https://earnkit.com/api/programs/write', { method: 'POST', headers, body: JSON.stringify({ action: 'upsert', program: program(id) }) });
  return (await withSessionFlags(request, () => writePost(request, { probe: async () => {}, readPage: async () => '' }))).status;
};

test("the route's flag context: owner and test sessions take the automated lane, a normal builder and no session do not", async () => {
  assert.equal(await laneFor(await cookieFor('jenil04', 9_640_001, null), 'na-owner-login'), 400);
  assert.equal(await laneFor(await cookieFor('jenilt', 9_640_002, null), 'na-owner-login2'), 400);
  for (const [i, reason] of (['test', 'persona', 'dogfood', 'owner'] as const).entries())
    assert.equal(await laneFor(await cookieFor(`na-${reason}`, 9_640_010 + i, reason), `na-lane-${reason}`), 400, reason);
  assert.equal(await laneFor(await cookieFor('na-normal-builder', 9_640_020, null), 'na-lane-normal'), 202);
  assert.equal(await laneFor(await cookieFor('na-repro', 9_640_021, 'repro'), 'na-lane-repro'), 202);
  assert.equal(await laneFor(null, 'na-lane-none'), 202);
  assert.equal(await laneFor(`${cookieName()}=not-a-session`, 'na-lane-bad'), 202);
});
