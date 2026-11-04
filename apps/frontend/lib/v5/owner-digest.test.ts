import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import type { Mailer } from './mail';
import { dailyOwnerText, sendOwnerDigest } from './owner-digest';
import { runHealth } from './health';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';
import { SafeFetchError, type Probe } from './safe-fetch';

after(() => sql().end());

const NOW = new Date('2026-11-04T06:15:00Z');
let sent: Parameters<Mailer>[0][] = [];
const mailer: Mailer = async (m) => {
  sent.push(m);
};
beforeEach(() => {
  sent = [];
  process.env.RESEND_API_KEY = 're_test';
  process.env.EARNKIT_AUTH_SECRET = 's'.repeat(40);
  process.env.EARNKIT_URL = 'https://earnkit.test';
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EARNKIT_AUTH_SECRET;
  delete process.env.EARNKIT_URL;
});

test('dailyOwnerText: null when all four lists are empty', () => {
  assert.equal(dailyOwnerText('2026-11-04', [], { closed: [], failing: [], changed: [] }), null);
});

test('dailyOwnerText: lists each group in plain words, with revert links', () => {
  const text = dailyOwnerText(
    '2026-11-04',
    [{ id: 'a', title: 'Alpha Grants', fields: ['ends_at', 'max_award_usd', 'submission_requirements', 'submission_url'], revertUrl: 'https://earnkit.test/r?t=1' }],
    {
      closed: [{ id: 'b', title: 'Beta' }],
      failing: [{ id: 'c', title: 'Gamma', url: 'https://gamma.example/apply' }],
      changed: [{ id: 'd', title: 'Delta', url: 'https://delta.example/p' }],
    },
  )!;
  assert.match(text, /Beta/);
  assert.match(text, /Gamma.*https:\/\/gamma\.example\/apply/);
  assert.match(text, /Delta.*https:\/\/delta\.example\/p/);
  assert.match(text, /Alpha Grants: deadline, amount, requirements, submission link/);
  assert.match(text, /https:\/\/earnkit\.test\/r\?t=1/);
  assert.doesNotMatch(text, /—/);
});

test('sendOwnerDigest: nothing happened sends nothing', async () => {
  assert.equal(await sendOwnerDigest(NOW, mailer), 'none');
  assert.equal(sent.length, 0);
});

test('sendOwnerDigest: a page change appears, once per day, with the day key', async () => {
  await upsertProgram(programFixture({ id: 'od-page', title: 'Page Grants', source_url: 'https://od.example/p' }), 'file', NOW);
  await runHealth({ probe: async () => {}, page: async () => '<p>one</p>', now: new Date(NOW.getTime() - 86_400_000) });
  await runHealth({ probe: async () => {}, page: async () => '<p>two</p>', now: NOW });
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  assert.equal(sent.length, 2);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM owner_digests WHERE day = '2026-11-04'`)[0]!.n, 1);
  assert.equal(sent[0]!.idempotencyKey, 'owner-digest:2026-11-04');
  assert.equal(sent[1]!.idempotencyKey, sent[0]!.idempotencyKey);
  assert.equal(sent[0]!.subject, 'EarnKit programs: 2026-11-04');
  assert.match(sent[0]!.text, /Page Grants.*https:\/\/od\.example\/p/);
});

test('sendOwnerDigest: link failures, deadline closes and a revertable api change', async () => {
  const bad: Probe = async (u) => {
    if (u === 'https://od.example/dead') throw new SafeFetchError('down');
  };
  await upsertProgram(programFixture({ id: 'od-dead', title: 'Dead Link Grants', submission_url: 'https://od.example/dead' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'od-ended', title: 'Ended Grants', ends_at: '2026-11-01T00:00:00Z' }), 'file', NOW);
  const api = programFixture({ id: 'od-api', title: 'Api Grants' });
  await upsertProgram(api, 'api', NOW);
  await sql()`INSERT INTO program_writes (program_id, action, result, reason, body) VALUES ('od-api', 'upsert', 'created', '', ${sql().json(JSON.parse(JSON.stringify(api)))})`;
  await sql()`INSERT INTO program_writes (program_id, action, result, reason, body) VALUES ('od-api', 'upsert', 'updated', '', ${sql().json(JSON.parse(JSON.stringify({ ...api, ends_at: '2027-01-01T00:00:00Z' })))})`;
  await upsertProgram({ ...api, ends_at: '2027-01-01T00:00:00Z' }, 'api', NOW);
  await runHealth({ probe: bad, page: async () => '<p>x</p>', now: NOW });
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  const text = sent[0]!.text;
  assert.match(text, /Dead Link Grants.*https:\/\/od\.example\/dead/);
  assert.match(text, /Ended Grants/);
  assert.match(text, /Api Grants: deadline/);
  assert.match(text, /https:\/\/earnkit\.test\/api\/programs\/revert\?t=/);
  assert.doesNotMatch(text, /Ended Grants: status/);
});

test('sendOwnerDigest: no RESEND_API_KEY sends nothing and says none', async () => {
  delete process.env.RESEND_API_KEY;
  await upsertProgram(programFixture({ id: 'od-nokey', title: 'No Key Grants', source_url: 'https://nokey.example/p' }), 'file', NOW);
  await runHealth({ probe: async () => {}, page: async () => '<p>a</p>', now: new Date(NOW.getTime() - 3_600_000) });
  await runHealth({ probe: async () => {}, page: async () => '<p>b</p>', now: NOW });
  assert.equal(await sendOwnerDigest(NOW, mailer), 'none');
  assert.equal(sent.length, 0);
});

test('sendOwnerDigest: covers changes since the last digest, not the UTC day', async () => {
  const later = new Date('2026-11-06T06:15:00Z');
  const at = (iso: string) => new Date(iso);
  await upsertProgram(programFixture({ id: 'od-win-a', title: 'Covered Grants' }), 'file', at('2026-11-05T01:00:00Z'));
  await upsertProgram({ ...programFixture({ id: 'od-win-a', title: 'Covered Grants' }), ends_at: '2027-01-01T00:00:00Z' }, 'file', at('2026-11-05T05:00:00Z'));
  await upsertProgram(programFixture({ id: 'od-win-b', title: 'Evening Grants' }), 'file', at('2026-11-05T01:00:00Z'));
  await upsertProgram({ ...programFixture({ id: 'od-win-b', title: 'Evening Grants' }), ends_at: '2027-01-01T00:00:00Z' }, 'file', at('2026-11-05T20:00:00Z'));
  await sql()`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-05', '2026-11-05T06:15:00Z')`;
  assert.equal(await sendOwnerDigest(later, mailer), 'sent');
  assert.match(sent[0]!.text, /Evening Grants: deadline/);
  assert.doesNotMatch(sent[0]!.text, /Covered Grants/);
});

test('sendOwnerDigest: marks a missing secret and an old write on the change line', async () => {
  const when = new Date('2026-11-08T06:15:00Z');
  const api = programFixture({ id: 'od-rl', title: 'Link Grants' });
  await upsertProgram(api, 'api', new Date('2026-11-07T08:00:00Z'));
  const ins = (b: unknown, res: string) => sql()`INSERT INTO program_writes (program_id, action, result, reason, body) VALUES ('od-rl', 'upsert', ${res}, '', ${sql().json(JSON.parse(JSON.stringify(b)))})`;
  await ins(api, 'created');
  await ins({ ...api, ends_at: '2027-01-01T00:00:00Z' }, 'updated');
  await upsertProgram({ ...api, ends_at: '2027-01-01T00:00:00Z' }, 'api', new Date('2026-11-07T09:00:00Z'));
  await sql()`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-07', '2026-11-07T06:15:00Z')`;
  delete process.env.EARNKIT_AUTH_SECRET;
  assert.equal(await sendOwnerDigest(when, mailer), 'sent');
  assert.match(sent[0]!.text, /Link Grants: deadline \(no revert link\)/);
  // A file program has no applied write to revert.
  await upsertProgram(programFixture({ id: 'od-file', title: 'File Grants' }), 'file', new Date('2026-11-09T01:00:00Z'));
  await upsertProgram({ ...programFixture({ id: 'od-file', title: 'File Grants' }), ends_at: '2027-01-01T00:00:00Z' }, 'file', new Date('2026-11-09T02:00:00Z'));
  process.env.EARNKIT_AUTH_SECRET = 's'.repeat(40);
  sent = [];
  assert.equal(await sendOwnerDigest(new Date('2026-11-09T06:15:00Z'), mailer), 'sent');
  assert.match(sent[0]!.text, /File Grants: deadline \(not revertable\)/);
});
