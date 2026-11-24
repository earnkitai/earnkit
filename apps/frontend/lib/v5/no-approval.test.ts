/**
 * v3.8 decision 25 (H5), E6r: the automated lane never asks a person to approve a program add. Whatever puts a write in
 * that lane (`auto_live` on, Growth's writer sending the check's fields, the owner or a test-preview caller), the write
 * goes live or is refused: it is never held, never mailed and never gets an approve link.
 *
 * The old approval path (email, signed link, confirm page, app/api/programs/approve) still serves every other write
 * while auto_live is off for everyone (approval-while-off.test.ts). It lives only in LEGACY below; no other file may
 * carry it. The follow-up PR that deletes it empties LEGACY and adds the route-gone check back.
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sql } from './db';
import type { Mailer } from './mail';
import { getProgram } from './programs';
import { writePost } from './programs-api';
import { withFlagPreview } from './flags';

after(() => sql().end());

const FRONTEND = join(import.meta.dirname, '..', '..');
const TOKEN = 'n'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
const ENDS = `${new Date().getUTCFullYear() + 1}-03-15T23:59:00Z`;
const year = new Date(ENDS).getUTCFullYear();

/** The files that still hold the old approval path until auto_live is on for everyone. */
const LEGACY = ['app/api/programs/approve/route.ts', 'lib/v5/programs-api.ts', 'lib/v5/programs-pending.ts'];

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

test('no source file outside the legacy approval files carries an owner approval path', () => {
  const hits = sources(join(FRONTEND, 'app'))
    .concat(sources(join(FRONTEND, 'lib')))
    .filter((file) => !LEGACY.includes(relative(FRONTEND, file)))
    .flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return BANNED.filter(([re]) => re.test(text)).map(([, what]) => `${relative(FRONTEND, file)}: ${what}`);
    });
  assert.deepEqual(hits, []);
});

let mails: unknown[] = [];
const mailer: Mailer = async (m) => {
  mails.push(m);
};

beforeEach(() => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  process.env.EARNKIT_AUTH_SECRET = 's'.repeat(40);
  process.env.RESEND_API_KEY = 're_test';
  mails = [];
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_AUTH_SECRET;
  delete process.env.RESEND_API_KEY;
  delete process.env.EARNKIT_FLAGS;
});

/** A new program on a site no curated program anchors: main's lane would hold it and mail the owner. */
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
    { mailer, probe: async () => {}, readPage: async () => page(id) },
  ));
  const pending = await sql()`SELECT 1 FROM program_writes WHERE program_id = ${id} AND result = 'pending'`;
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, pending: pending.length };
};

const assertNoApproval = (out: Awaited<ReturnType<typeof send>>) => {
  assert.notEqual(out.status, 202, JSON.stringify(out.json));
  assert.notEqual(out.json.result, 'pending');
  assert.equal('owner_emailed' in out.json, false);
  assert.equal(out.pending, 0);
  assert.deepEqual(mails, []);
};

test('auto_live on: a write main would hold goes live with no approval, no email, no approve link', async () => {
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
