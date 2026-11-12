import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import type { Mailer } from './mail';
import { dailyOwnerText, digestKey, sendOwnerDigest } from './owner-digest';
import { runHealth, type LinkCheck } from './health';
import { programFixture } from './fixtures/program';
import { upsertProgram } from './programs';

after(() => sql().end());

const NOW = new Date('2026-11-04T06:15:00Z');
const pageOf = (html: string, dead: string[] = []): LinkCheck => async (u) => (dead.includes(u) ? { ok: false, why: '4xx' } : { ok: true, page: html });
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
  await runHealth(new Date(NOW.getTime() - 86_400_000), { link: pageOf('<p>one</p>') });
  await runHealth(NOW, { link: pageOf('<p>two</p>') });
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  // v6.1.16 Task 16: the same body is sent once a day; the key carries its hash.
  assert.equal(await sendOwnerDigest(NOW, mailer), 'none');
  assert.equal(sent.length, 1);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM owner_digests WHERE day = '2026-11-04'`)[0]!.n, 1);
  assert.equal(sent[0]!.idempotencyKey, digestKey('2026-11-04', sent[0]!.text));
  assert.match(sent[0]!.idempotencyKey, /^owner-digest:2026-11-04:[0-9a-f]{16}$/);
  assert.equal(sent[0]!.subject, 'EarnKit programs: 2026-11-04');
  assert.match(sent[0]!.text, /Page Grants.*https:\/\/od\.example\/p/);
});

test('sendOwnerDigest: link failures, deadline closes and a revertable api change', async () => {
  await upsertProgram(programFixture({ id: 'od-dead', title: 'Dead Link Grants', submission_url: 'https://od.example/dead' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'od-ended', title: 'Ended Grants', ends_at: '2026-11-01T00:00:00Z' }), 'file', NOW);
  const api = programFixture({ id: 'od-api', title: 'Api Grants' });
  await upsertProgram(api, 'api', NOW);
  await sql()`INSERT INTO program_writes (program_id, action, result, reason, body) VALUES ('od-api', 'upsert', 'created', '', ${sql().json(JSON.parse(JSON.stringify(api)))})`;
  await sql()`INSERT INTO program_writes (program_id, action, result, reason, body) VALUES ('od-api', 'upsert', 'updated', '', ${sql().json(JSON.parse(JSON.stringify({ ...api, ends_at: '2027-01-01T00:00:00Z' })))})`;
  await upsertProgram({ ...api, ends_at: '2027-01-01T00:00:00Z' }, 'api', NOW);
  await runHealth(NOW, { link: pageOf('<p>x</p>', ['https://od.example/dead']) });
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  const text = sent[0]!.text;
  assert.match(text, /Dead Link Grants.*https:\/\/od\.example\/dead/);
  assert.match(text, /Ended Grants/);
  assert.match(text, /Api Grants: deadline/);
  assert.match(text, /https:\/\/earnkit\.test\/api\/programs\/revert\?t=/);
  assert.doesNotMatch(text, /Ended Grants: status/);
});

test('sendOwnerDigest: no RESEND_API_KEY sends nothing and says mail off (L30-5)', async () => {
  delete process.env.RESEND_API_KEY;
  await upsertProgram(programFixture({ id: 'od-nokey', title: 'No Key Grants', source_url: 'https://nokey.example/p' }), 'file', NOW);
  await runHealth(new Date(NOW.getTime() - 3_600_000), { link: pageOf('<p>a</p>') });
  await runHealth(NOW, { link: pageOf('<p>b</p>') });
  assert.equal(await sendOwnerDigest(NOW, mailer), 'mail off');
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

test('v6.1.16 Task 16: two runs on one UTC day: the same body sends once, a changed body sends again under a new key', async () => {
  const day = new Date('2026-11-20T06:15:00Z');
  await upsertProgram(programFixture({ id: 'od-k1', title: 'Key One Grants' }), 'file', new Date('2026-11-19T01:00:00Z'));
  await upsertProgram({ ...programFixture({ id: 'od-k1', title: 'Key One Grants' }), ends_at: '2027-01-01T00:00:00Z' }, 'file', new Date('2026-11-20T01:00:00Z'));
  await sql()`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-19', '2026-11-19T06:15:00Z')`;
  assert.equal(await sendOwnerDigest(day, mailer), 'sent');
  assert.equal(await sendOwnerDigest(new Date('2026-11-20T07:00:00Z'), mailer), 'none');
  assert.equal(sent.length, 1);
  await upsertProgram(programFixture({ id: 'od-k2', title: 'Key Two Grants' }), 'file', new Date('2026-11-20T07:10:00Z'));
  await upsertProgram({ ...programFixture({ id: 'od-k2', title: 'Key Two Grants' }), ends_at: '2027-02-01T00:00:00Z' }, 'file', new Date('2026-11-20T07:20:00Z'));
  assert.equal(await sendOwnerDigest(new Date('2026-11-20T08:00:00Z'), mailer), 'sent');
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1]!.idempotencyKey, sent[0]!.idempotencyKey);
  assert.match(sent[1]!.text, /Key One Grants[\s\S]*Key Two Grants/);
});

test('v6.1.16 Task 16 (L30-1): a program the run opened at its start date is named in its own block, not again as a change', async () => {
  const at = new Date('2026-12-01T06:15:00Z');
  await upsertProgram(programFixture({ id: 'od-open', title: 'Opening Grants', status: 'upcoming', opens_note: 'Opens Dec 1.', starts_at: '2026-12-01T00:00:00Z' }), 'file', new Date('2026-11-29T00:00:00Z'));
  await sql()`DELETE FROM programs WHERE id <> 'od-open'`;
  const r = await runHealth(at, { link: pageOf('<p>x</p>') });
  assert.deepEqual(r.opened, ['od-open']);
  assert.equal(await sendOwnerDigest(at, mailer), 'sent');
  assert.match(sent[0]!.text, /Opened because the start date came\n- Opening Grants \(od-open\)/);
  assert.doesNotMatch(sent[0]!.text, /Opening Grants: status/);
});

// v6.1.17 Task 3 (L30-14, L30-18, L35-18, Review Focus 5).
test('L30-14: with no daily run for 27 hours the digest names the gap first; 26 hours exactly is no gap; none stored is no gap', async () => {
  const { runGap, GAP_HOURS } = await import('./owner-digest');
  const H = 3_600_000;
  assert.equal(GAP_HOURS, 26);
  assert.equal(runGap(null, NOW), null);
  assert.equal(runGap(new Date(NOW.getTime() - 26 * H), NOW), null);
  assert.deepEqual(runGap(new Date(NOW.getTime() - 26 * H - 1), NOW), { hours: 26, last: new Date(NOW.getTime() - 26 * H - 1) });
  await sql()`DELETE FROM cron_state`;
  assert.equal(await sendOwnerDigest(NOW, mailer), 'none');
  await sql()`INSERT INTO cron_state (id, last_run_at) VALUES (true, ${new Date(NOW.getTime() - 27 * H)})`;
  try {
    assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, 'EarnKit programs: 2026-11-04\n\nNo daily run finished for 27 hours before this one; the last was 2026-11-03 03:15 UTC.\n');
    await sql()`UPDATE cron_state SET last_run_at = ${new Date(NOW.getTime() - 24 * H)}`;
    assert.equal(await sendOwnerDigest(new Date(NOW.getTime() + 60_000), mailer), 'none');
  } finally {
    await sql()`DELETE FROM cron_state`;
  }
});

test('L30-18, L35-18: the programs the walk could not read are named with their fix, one line each, sentences with no field names', async () => {
  const { UNREADABLE_FIX } = await import('./health');
  const unreadable = [{ id: 'od-parse', fix: UNREADABLE_FIX.parse }, { id: 'od-form', fix: UNREADABLE_FIX.noForm }];
  assert.equal(await sendOwnerDigest(NOW, mailer, { unreadable }), 'sent');
  const text = sent[0].text;
  assert.ok(text.includes([
    'Programs the run could not read',
    '- od-parse: its saved entry no longer reads, so it is not checked; correct the entry.',
    '- od-form: its start date passed but it has no form questions, so it stays upcoming; add them.',
  ].join('\n')), text);
  for (const line of text.split('\n').filter((l) => l.startsWith('- od-'))) {
    assert.match(line, /\.$/);
    assert.doesNotMatch(line, /[—–]|submission_requirements|starts_at|\.json|programs\//);
  }
  // The same day, the same list: sent once.
  assert.equal(await sendOwnerDigest(NOW, mailer, { unreadable }), 'none');
  await sql()`DELETE FROM owner_digests`;
});

test("L18-5c: the digest's applications block counts the previous UTC day's sends, stays the same within the day, and adds nothing for a day with 0", async () => {
  // The pure block: most sends first; the title on one line.
  const block = dailyOwnerText('2026-12-20', [], { closed: [], failing: [], changed: [] }, {
    sent: 3, agent: 1, drafted: 1, reported: 1, total: 7,
    byProgram: [{ id: 'od-b', title: 'Beta  Prize', sent: 1 }, { id: 'od-a', title: 'Alpha Grants', sent: 2 }],
  });
  assert.equal(block, 'EarnKit programs: 2026-12-20\n\nApplications: 3 sent (1 by agents, 1 drafted here and sent by builders, 1 reported from outside); 7 all time.\n- Alpha Grants (od-a): 2\n- Beta Prize (od-b): 1\n');
  assert.equal(dailyOwnerText('2026-12-20', [], { closed: [], failing: [], changed: [] }, { sent: 0, agent: 0, drafted: 0, reported: 0, total: 7, byProgram: [] }), null);

  const db = sql();
  await db`DELETE FROM owner_digests`;
  await db`DELETE FROM cron_state`;
  const [b] = await db<{ id: number }[]>`INSERT INTO builders (github_id, login) VALUES (918300, 'od-builder') RETURNING id`;
  const [ia] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name) VALUES ('od-a', 'Claude Code') RETURNING id`;
  const [ib] = await db<{ id: number }[]>`INSERT INTO installations (token_hash, client_name, builder_id) VALUES ('od-b', 'Cursor', ${b.id}) RETURNING id`;
  const y = (h: number) => new Date(`2026-12-19T${String(h).padStart(2, '0')}:00:00Z`);
  const ins = (owner: string, inst: number, program: string, status: string, at: Date, sentAt: Date | null, by: string | null, title: string, id: string) =>
    db`INSERT INTO applications (owner, installation_id, program_id, status, at, sent_at, submitted_by, title, application_id)
      VALUES (${owner}, ${inst}, ${program}, ${status}, ${at}, ${sentAt}, ${by}, ${title}, ${id})`;
  try {
    // Yesterday (2026-12-19 UTC): an agent send, an unmarked one (the agent's), a drafted builder send (a start before it), a reported one; a claim is not a send.
    await ins(`i:${ia.id}`, ia.id, 'od-a', 'applied', y(1), y(1), 'agent', 'Alpha Grants', 'app_od1');
    await db`INSERT INTO application_history (owner, installation_id, program_id, status, at) VALUES (${`b:${b.id}`}, ${ib.id}, 'od-a', 'started', ${y(1)})`;
    await ins(`b:${b.id}`, ib.id, 'od-a', 'won', y(20), y(2), 'builder', 'Alpha Grants', 'app_od2');
    await ins(`i:${ib.id}`, ib.id, 'od-b', 'applied', y(23), y(23), 'builder', 'Beta Prize', 'app_od3');
    // Unmarked (submitted_by null): the agent's (L29-23).
    await ins(`i:${ia.id}`, ia.id, 'od-d', 'applied', y(5), y(5), null, 'Delta Fund', 'app_od7');
    await ins(`i:${ia.id}`, ia.id, 'od-b', 'started', y(4), null, null, 'Beta Prize', 'app_od4');
    // An older send counts all time only.
    await ins(`i:${ia.id}`, ia.id, 'od-c', 'applied', new Date('2026-11-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'), 'agent', 'Old', 'app_od5');
    const day = new Date('2026-12-20T06:15:00Z');
    const want = 'EarnKit programs: 2026-12-20\n\nApplications: 4 sent (2 by agents, 1 drafted here and sent by builders, 1 reported from outside); 5 all time.\n- Alpha Grants (od-a): 2\n- Beta Prize (od-b): 1\n- Delta Fund (od-d): 1\n';
    assert.equal(await sendOwnerDigest(day, mailer), 'sent');
    assert.equal(sent[0].text, want);
    // A send today changes neither yesterday's block nor the all-time number: the same-day rerun builds the same hash.
    await ins(`i:${ia.id}`, ia.id, 'od-c2', 'applied', new Date('2026-12-20T07:00:00Z'), new Date('2026-12-20T07:00:00Z'), 'agent', 'Today', 'app_od6');
    assert.equal(await sendOwnerDigest(new Date('2026-12-20T09:00:00Z'), mailer), 'none');
    assert.equal(sent.length, 1);
    // Two days on, no sends the day before: nothing to say.
    assert.equal(await sendOwnerDigest(new Date('2026-12-23T06:15:00Z'), mailer), 'none');
    assert.equal(sent.length, 1);
  } finally {
    await db`DELETE FROM application_history WHERE program_id LIKE 'od-%'`;
    await db`DELETE FROM applications WHERE application_id LIKE 'app_od%'`;
    await db`DELETE FROM installations WHERE token_hash IN ('od-a', 'od-b')`;
    await db`DELETE FROM builders WHERE github_id = 918300`;
    await db`DELETE FROM owner_digests`;
  }
});

// v6.1.18 Task 6a (L39-5): a submission page that says it is closed is in the failing block even when it answers 200.
const CLOSED_FORM = '<html><body><div>Base Builder Grant</div><div>Round 2 of Builder Grant Program is now closed. Please look out on X when we open up our Round 3 of applications.</div></body></html>';

test('L39-5: dailyOwnerText names a closed form as `{title}: the form says it is closed ({url})` in the failing block', () => {
  const text = dailyOwnerText('2026-11-12', [], {
    closed: [], changed: [],
    failing: [{ id: 'a', title: 'Alpha Grants', url: 'https://alpha.example/form', closed: true }, { id: 'b', title: 'Beta', url: 'https://beta.example/apply' }],
  })!;
  assert.match(text, /Links that did not load\n- Alpha Grants: the form says it is closed \(https:\/\/alpha\.example\/form\)\n- Beta: https:\/\/beta\.example\/apply/);
});

test('L39-5: the daily run reads the closed phrase on a submission page that answers 200; the digest lists it, never stale; an open form is not listed', async () => {
  await sql()`DELETE FROM programs WHERE id LIKE 'od-%'`;
  await upsertProgram(programFixture({ id: 'od-shut', title: 'Shut Form Grants', source_url: 'https://shut.example/about', submission_url: 'https://shut.example/form' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'od-openf', title: 'Open Form Grants', source_url: 'https://openf.example/about', submission_url: 'https://openf.example/form' }), 'file', NOW);
  const link: LinkCheck = async (u) => ({ ok: true, page: u === 'https://shut.example/form' ? CLOSED_FORM : '<p>Apply here. Applications are open.</p>' });
  const run = await runHealth(NOW, { link });
  assert.deepEqual(run.stale, []);
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  const text = sent[0]!.text;
  assert.match(text, /- Shut Form Grants: the form says it is closed \(https:\/\/shut\.example\/form\)/);
  assert.doesNotMatch(text, /Open Form Grants/);
});
