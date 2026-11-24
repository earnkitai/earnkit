/**
 * v3.8 E6r: while `auto_live` is off for normal traffic, a normal program add (no check fields, not the owner or a
 * test-preview caller) keeps main's approval path, so no add gets stuck: it is held, the owner is emailed an approve
 * link, the link's confirm page opens and approving puts the program live. Also the preview-caller check itself.
 * Deleted with the approval path in the follow-up PR (land when auto_live is on for everyone).
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import type { Mailer } from './mail';
import { getProgram } from './programs';
import { approveGet, approvePost, writePost } from './programs-api';
import { PENDING_SUBJECT } from './programs-pending';
import { upsertBuilder } from '../v6/builders';
import { previewCaller } from '../v6/preview-caller';
import { cookieName, createSession } from '../v6/sessions';

after(() => sql().end());

const TOKEN = 'w'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
const ENDS = `${new Date().getUTCFullYear() + 1}-03-15T23:59:00Z`;

let mails: Parameters<Mailer>[0][] = [];
const mailer: Mailer = async (m) => {
  mails.push(m);
};
const probe = async () => {};

beforeEach(() => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  process.env.EARNKIT_AUTH_SECRET = 's'.repeat(40);
  process.env.RESEND_API_KEY = 're_test';
  delete process.env.EARNKIT_FLAGS;
  mails = [];
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_AUTH_SECRET;
  delete process.env.RESEND_API_KEY;
});

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

test('auto_live off: a normal add is held, emails the approve link, and the link confirms and applies it', async () => {
  let pageRead = false;
  const res = await writePost(
    new Request('https://earnkit.com/api/programs/write', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', program: program('aw-normal') }),
    }),
    {
      mailer,
      probe,
      readPage: async () => {
        pageRead = true;
        return '';
      },
    },
  );
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 202, JSON.stringify(body));
  assert.equal(body.result, 'pending');
  assert.equal(body.owner_emailed, true);
  assert.equal(pageRead, false);
  assert.equal(await getProgram('aw-normal'), null);

  assert.equal(mails.length, 1);
  assert.equal(mails[0]!.subject, PENDING_SUBJECT);
  const link = /https:\/\/\S+\/api\/programs\/approve\?t=\S+/.exec(mails[0]!.text)?.[0];
  assert.ok(link, mails[0]!.text);
  const url = new URL(link);
  const confirm = await approveGet(new Request(`https://earnkit.com${url.pathname}${url.search}`));
  assert.equal(confirm.status, 200);
  assert.match(await confirm.text(), /Approve this program\?/);

  const approved = await approvePost(new Request(`https://earnkit.com${url.pathname}${url.search}`, { method: 'POST' }), { probe });
  assert.equal(approved.status, 200);
  assert.equal((await getProgram('aw-normal'))?.source, 'api');
  // Single use, as on main.
  assert.equal((await approvePost(new Request(`https://earnkit.com${url.pathname}${url.search}`, { method: 'POST' }), { probe })).status, 409);
});

const cookieFor = async (login: string, githubId: number, testReason: string | null) => {
  const b = await upsertBuilder({ github_id: githubId, login, name: null, avatar_url: null }, new Date());
  if (testReason) await sql()`INSERT INTO people (builder_id, test_reason, test_reason_source) VALUES (${b.id}, ${testReason}, 'test') ON CONFLICT (builder_id) DO UPDATE SET test_reason = EXCLUDED.test_reason`;
  const { token } = await createSession(b.id, new Date());
  return new Request('https://earnkit.com/api/programs/write', { method: 'POST', headers: { cookie: `${cookieName()}=${token}` } });
};

test('previewCaller: the owner logins and test-preview people are preview callers; a normal builder and no session are not', async () => {
  assert.equal(await previewCaller(await cookieFor('jenil04', 9_640_001, null)), true);
  assert.equal(await previewCaller(await cookieFor('jenilt', 9_640_002, null)), true);
  for (const [i, reason] of (['test', 'persona', 'dogfood', 'owner'] as const).entries())
    assert.equal(await previewCaller(await cookieFor(`aw-${reason}`, 9_640_010 + i, reason)), true, reason);
  assert.equal(await previewCaller(await cookieFor('aw-normal-builder', 9_640_020, null)), false);
  assert.equal(await previewCaller(await cookieFor('aw-repro', 9_640_021, 'repro')), false);
  assert.equal(await previewCaller(new Request('https://earnkit.com/api/programs/write', { method: 'POST' })), false);
  assert.equal(await previewCaller(new Request('https://earnkit.com/x', { headers: { cookie: `${cookieName()}=not-a-session` } })), false);
});
