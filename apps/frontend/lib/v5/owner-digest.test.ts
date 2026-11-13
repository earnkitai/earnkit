import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import type { Mailer } from './mail';
import { dailyOwnerText, digestKey, sendOwnerDigest } from './owner-digest';
import { runHealth, type LinkCheck } from './health';
import { cimdFixture } from './fixtures/cimd';
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
test('L30-14, L44-12: with no daily run for 27 hours the digest names the gap first; 26 hours exactly, or 26 h 16 min, is no gap; none stored is no gap', async () => {
  const { runGap, GAP_HOURS } = await import('./owner-digest');
  const H = 3_600_000;
  assert.equal(GAP_HOURS, 26);
  assert.equal(runGap(null, NOW), null);
  assert.equal(runGap(new Date(NOW.getTime() - 26 * H), NOW), null);
  // v6.1.19 (L44-12): over 26 hours in true hours, rounded to the nearest: 26 h 16 min is 26, no line; 27 h 40 min is 28.
  assert.equal(runGap(new Date(NOW.getTime() - 26 * H - 1), NOW), null);
  assert.equal(runGap(new Date(NOW.getTime() - 26 * H - 16 * 60_000), NOW), null);
  assert.deepEqual(runGap(new Date(NOW.getTime() - 26 * H - 31 * 60_000), NOW), { hours: 27, last: new Date(NOW.getTime() - 26 * H - 31 * 60_000) });
  assert.deepEqual(runGap(new Date(NOW.getTime() - 27 * H - 40 * 60_000), NOW)?.hours, 28);
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

test('L30-18, L35-18, L44-13, L44-20: from the stored rows, a saved entry that no longer reads is named by id; an upcoming program at its start with no form is under Programs to fix by title', async () => {
  const db = sql();
  await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
  await upsertProgram(programFixture({ id: 'od-parse' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'od-form', title: 'Form Later Grants', status: 'upcoming', opens_note: 'Opens Nov 1.', starts_at: '2026-11-01T00:00:00Z', submission_requirements: [] }), 'file', NOW);
  await db`UPDATE programs SET file = jsonb_set(file, '{title}', '7'::jsonb) WHERE id = 'od-parse'`;
  try {
    // No run passed anything: the digest reads the programs table.
    assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
    const text = sent[0].text;
    assert.ok(text.includes([
      'Programs the run could not read',
      '- od-parse: its saved entry no longer reads, so it is not checked; correct the entry.',
      '',
      'Programs to fix',
      '- Form Later Grants: its start date passed but it has no form questions, so it stays upcoming; add them.',
    ].join('\n')), text);
    assert.doesNotMatch(text, /od-form/);
    for (const line of text.split('\n').filter((l) => l.startsWith('- '))) {
      assert.match(line, /\.$/);
      assert.doesNotMatch(line, /[\u2014\u2013]|submission_requirements|starts_at|\.json|programs\//);
    }
    // The same day, the same list: sent once.
    assert.equal(await sendOwnerDigest(NOW, mailer), 'none');
  } finally {
    await db`DELETE FROM programs WHERE id IN ('od-parse', 'od-form')`;
    await db`DELETE FROM owner_digests`;
  }
});

test("L18-5c: the digest's applications block counts the previous UTC day's sends, stays the same within the day, and adds nothing for a day with 0", async () => {
  // The pure block: most sends first; the title on one line.
  const block = dailyOwnerText('2026-12-20', [], { closed: [], failing: [], changed: [] }, {
    sent: 3, agent: 1, drafted: 1, reported: 1, total: 7,
    byProgram: [{ id: 'od-b', title: 'Beta  Prize', sent: 1 }, { id: 'od-a', title: 'Alpha Grants', sent: 2 }],
  });
  // v6.1.19 (L44-18): each program by its title and `sent`.
  assert.equal(block, 'EarnKit programs: 2026-12-20\n\n3 sent yesterday: 1 by agents, 1 drafted here, 1 from outside. 7 to date.\n- Alpha Grants: 2 sent\n- Beta Prize: 1 sent\n');
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
    // L42-2: an outside win (a builder row with no send time) yesterday counts in neither number.
    await ins(`i:${ib.id}`, ib.id, 'od-e', 'won', y(6), null, 'builder', 'Outside', 'app_od8');
    // L42-1: a result yesterday on a send from November is not a send yesterday (it counts to date).
    await ins(`i:${ia.id}`, ia.id, 'od-f', 'won', y(7), new Date('2026-11-02T00:00:00Z'), 'agent', 'Older', 'app_od9');
    const day = new Date('2026-12-20T06:15:00Z');
    const want = 'EarnKit programs: 2026-12-20\n\n4 sent yesterday: 2 by agents, 1 drafted here, 1 from outside. 6 to date.\n- Alpha Grants: 2 sent\n- Beta Prize: 1 sent\n- Delta Fund: 1 sent\n';
    assert.equal(await sendOwnerDigest(day, mailer), 'sent');
    assert.equal(sent[0].text, want);
    // A send today changes neither yesterday's block nor the all-time number: the same-day rerun builds the same hash.
    await ins(`i:${ia.id}`, ia.id, 'od-c2', 'applied', new Date('2026-12-20T07:00:00Z'), new Date('2026-12-20T07:00:00Z'), 'agent', 'Today', 'app_od6');
    assert.equal(await sendOwnerDigest(new Date('2026-12-20T09:00:00Z'), mailer), 'none');
    assert.equal(sent.length, 1);
    // Two days on with no digest between (none on Dec 21 or 22): v6.1.19 (L44-9) the Dec 20 send no digest reported is
    // carried in. Before, it was never reported.
    assert.equal(await sendOwnerDigest(new Date('2026-12-23T06:15:00Z'), mailer), 'sent');
    assert.equal(sent[1].text, 'EarnKit programs: 2026-12-23\n\n0 sent yesterday (and 1 on Dec 20, missed). 7 to date.\n');
    // The next day, nothing new: nothing to say.
    assert.equal(await sendOwnerDigest(new Date('2026-12-24T06:15:00Z'), mailer), 'none');
    assert.equal(sent.length, 2);
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

test('L39-5, L44-6, L44-8: a closed form has its own block, `{title}: the form says it is closed, {age} ({url})`; failing links carry their age and (not listed)', () => {
  const text = dailyOwnerText('2026-11-12', [], {
    closed: [], changed: [],
    failing: [{ id: 'b', title: 'Beta', url: 'https://beta.example/apply', days: 0 }, { id: 'c', title: 'Gamma', url: 'https://gamma.example/', days: 13, unlisted: true }],
    formsClosed: [
      { id: 'a', title: 'Alpha Grants', url: 'https://alpha.example/form', on: 'form', days: 4 },
      { id: 'd', title: 'Delta', url: 'https://delta.example/about', on: 'source', days: 1 },
      { id: 'e', title: 'Eps', url: 'https://eps.example/form', on: 'form', days: 0 },
      { id: 'f', title: 'Phi', url: 'https://phi.example/form', on: 'form', round: true, days: 0 },
    ],
  })!;
  assert.ok(text.includes([
    'Links that did not load',
    '- Beta: down since today (https://beta.example/apply)',
    '- Gamma (not listed): down 13 days (https://gamma.example/)',
    '',
    'Forms that say they are closed',
    '- Alpha Grants: the form says it is closed, 4 days (https://alpha.example/form)',
    '- Delta: the page says it is closed, 1 day (https://delta.example/about)',
    '- Eps: the form says it is closed, since today (https://eps.example/form)',
    '- Phi: the form says one round is closed (https://phi.example/form); check it.',
  ].join('\n')), text);
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
  assert.match(text, /Forms that say they are closed\n- Shut Form Grants: the form says it is closed, since today \(https:\/\/shut\.example\/form\)/);
  assert.doesNotMatch(text, /Open Form Grants/);
});

test('v6.1.18 final fix (M1): an upcoming program whose form says it is closed is not listed; an active one is', async () => {
  await sql()`DELETE FROM programs WHERE id LIKE 'od-%'`;
  await upsertProgram(programFixture({ id: 'od-soon', title: 'Next Round Grants', status: 'upcoming', opens_note: 'Round 3 opens in January.', starts_at: '2027-01-15T00:00:00Z', source_url: 'https://soon.example/about', submission_url: 'https://soon.example/form' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'od-shut2', title: 'Shut Now Grants', source_url: 'https://shut2.example/about', submission_url: 'https://shut2.example/form' }), 'file', NOW);
  const link: LinkCheck = async (u) => ({ ok: true, page: u.endsWith('/form') ? CLOSED_FORM : '<p>About the grants.</p>' });
  await runHealth(NOW, { link });
  const [soon] = await sql()`SELECT submit_closed FROM program_health WHERE program_id = 'od-soon'`;
  assert.equal(soon?.submit_closed, true, 'the upcoming form was read as closed');
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  const text = sent[0]!.text;
  assert.match(text, /- Shut Now Grants: the form says it is closed, since today \(https:\/\/shut2\.example\/form\)/);
  assert.doesNotMatch(text, /Next Round Grants/);
});

test('L39-5 fix round 1: a forms.gle-style link that redirects to a closed form on another host is in the closed forms block', async () => {
  await sql()`DELETE FROM programs`;
  await upsertProgram(programFixture({ id: 'od-gle', title: 'Gle Form Grants', source_url: 'https://gle.example/about', submission_url: 'https://forms.gle/xyz' }), 'file', NOW);
  const site = cimdFixture((u) => (u.hostname === 'forms.gle'
    ? { status: 302, location: 'https://docs.google.com/forms/d/e/y/viewform', body: '' }
    : { status: 200, contentType: 'text/html', body: u.hostname === 'docs.google.com' ? CLOSED_FORM : '<p>About the grants.</p>' }));
  const run = await runHealth(NOW, { resolve: site.resolve, transport: site.transport });
  assert.deepEqual([run.stale, run.failed], [[], []]);
  assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
  assert.match(sent[0]!.text, /Forms that say they are closed\n- Gle Form Grants: the form says it is closed, since today \(https:\/\/forms\.gle\/xyz\)/);
});

test('L42-7: the digest line', () => {
  const health = { closed: [], failing: [], changed: [] };
  const text = dailyOwnerText('2026-11-13', [], health, { sent: 6, agent: 3, drafted: 2, reported: 1, total: 8, byProgram: [{ id: 'futo', title: 'FUTO Microgrants', sent: 6 }] })!;
  assert.ok(text.includes('6 sent yesterday: 3 by agents, 2 drafted here, 1 from outside. 8 to date.\n- FUTO Microgrants: 6 sent'));
  assert.doesNotMatch(text, /[\u2014\u2013]/);
});

// v6.1.19 Task 6 (lane 44): the digest, round 3.
const resetDigest = async () => {
  await sql()`DELETE FROM owner_digests`;
  await sql()`DELETE FROM cron_state`;
};

test('L44-2, L44-11: an outside win is a result, never a send on any day, and a further payment is a result once more, never a send', async () => {
  const { record } = await import('./ledger');
  const db = sql();
  await resetDigest();
  await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
  for (const [id, title] of [['od-out', 'Outside Grants'], ['od-won', 'Won Prize'], ['od-no', 'No Fund'], ['od-bare', 'Bare Award']])
    await upsertProgram(programFixture({ id, title, max_award_usd: 10_000 }), 'file', new Date('2026-11-01T00:00:00Z'));
  const [inst] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('od-l44') RETURNING id`;
  const owner = `i:${inst.id}`;
  const at = (s: string) => new Date(s);
  try {
    // Sent Nov 2; results on Nov 10: a $5,000 win, a rejection, a win with no amount; an outside $2,000 win.
    for (const id of ['od-won', 'od-no', 'od-bare']) {
      const r = await record(owner, id, 'applied', { installationId: inst.id, now: at('2026-11-02T10:00:00Z') });
      assert.equal(r.ok, true, JSON.stringify(r));
    }
    await db`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-10', ${at('2026-11-10T06:15:00Z')})`;
    assert.equal((await record(owner, 'od-won', 'won', { installationId: inst.id, amount_usd: 5000, now: at('2026-11-10T09:00:00Z') })).ok, true);
    assert.equal((await record(owner, 'od-no', 'rejected', { installationId: inst.id, now: at('2026-11-10T10:00:00Z') })).ok, true);
    // A win kept with no amount (a program's screen that gave none).
    await db`INSERT INTO application_history (owner, installation_id, program_id, status, at, source) VALUES (${owner}, ${inst.id}, 'od-bare', 'won', ${at('2026-11-10T11:00:00Z')}, 'screen')`;
    const out = await record(owner, 'od-out', 'won', { installationId: inst.id, amount_usd: 2000, outsideWin: true, now: at('2026-11-10T12:00:00Z') });
    assert.equal(out.ok && out.outside, true);
    assert.equal(await sendOwnerDigest(at('2026-11-11T06:15:00Z'), mailer), 'sent');
    assert.equal(sent[0].text, 'EarnKit programs: 2026-11-11\n\nResults: won at Bare Award; $2,000 won at Outside Grants; $5,000 won at Won Prize; No Fund said no.\n');
    // A further payment a week later: a result again, still no send.
    assert.equal((await record(owner, 'od-out', 'won', { installationId: inst.id, amount_usd: 500, payment: { key: 'od-pay-1' }, now: at('2026-11-17T12:00:00Z') })).ok, true);
    assert.equal(await sendOwnerDigest(at('2026-11-18T06:15:00Z'), mailer), 'sent');
    assert.equal(sent[1].text, 'EarnKit programs: 2026-11-18\n\nResults: $500 won at Outside Grants.\n');
    assert.doesNotMatch(sent.map((m) => m.text).join('\n'), /sent yesterday|\bi:\d|od-l44/);
  } finally {
    await db`DELETE FROM application_history WHERE owner = ${owner}`;
    await db`DELETE FROM applications WHERE owner = ${owner}`;
    await db`DELETE FROM installations WHERE id = ${inst.id}`;
    await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
    await resetDigest();
  }
});

// Final fix round (I1): the Results block counts only results that stand.
const resultsCase = async (name: string, steps: (rec: (status: 'won' | 'rejected', o: Record<string, unknown>) => Promise<unknown>) => Promise<void>) => {
  const { record } = await import('./ledger');
  const db = sql();
  await resetDigest();
  await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
  await upsertProgram(programFixture({ id: 'od-i1', title: 'Stand Grants', max_award_usd: 10_000 }), 'file', new Date('2026-11-01T00:00:00Z'));
  const [inst] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${'od-i1-' + name}) RETURNING id`;
  const owner = `i:${inst.id}`;
  try {
    assert.equal((await record(owner, 'od-i1', 'applied', { installationId: inst.id, now: new Date('2026-11-02T10:00:00Z') })).ok, true);
    await db`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-10', ${new Date('2026-11-10T06:15:00Z')})`;
    let hour = 8;
    await steps(async (status, o) => {
      const r = await record(owner, 'od-i1', status, { installationId: inst.id, now: new Date(`2026-11-10T${String(++hour).padStart(2, '0')}:00:00Z`), ...o });
      assert.equal(r.ok, true, JSON.stringify(r));
      return r;
    });
    assert.equal(await sendOwnerDigest(new Date('2026-11-11T06:15:00Z'), mailer), 'sent');
    return sent.at(-1)!.text;
  } finally {
    await db`DELETE FROM application_history WHERE owner = ${owner}`;
    await db`DELETE FROM applications WHERE owner = ${owner}`;
    await db`DELETE FROM installations WHERE id = ${inst.id}`;
    await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
    await resetDigest();
  }
};

test('final fix I1: a screen win of another amount kept beside the builder\'s win is not counted', async () => {
  const text = await resultsCase('beside', async (rec) => {
    await rec('won', { amount_usd: 5000 });
    assert.equal(((await rec('won', { amount_usd: 6000, fromScreen: true })) as { beside?: true }).beside, true);
  });
  assert.equal(text, 'EarnKit programs: 2026-11-11\n\nResults: $5,000 won at Stand Grants.\n');
});

test('final fix I1: a screen rejection kept beside a win is not reported as said no', async () => {
  const text = await resultsCase('reject', async (rec) => {
    await rec('won', { amount_usd: 5000 });
    assert.equal(((await rec('rejected', { fromScreen: true })) as { beside?: true }).beside, true);
  });
  assert.equal(text, 'EarnKit programs: 2026-11-11\n\nResults: $5,000 won at Stand Grants.\n');
  assert.doesNotMatch(text, /said no/);
});

test('final fix I1: a correction that replaced an older amount counts the new amount once, a further payment adds', async () => {
  const text = await resultsCase('corrected', async (rec) => {
    await rec('won', { amount_usd: 5000 });
    assert.equal(((await rec('won', { amount_usd: 6000 })) as { corrected?: true }).corrected, true);
    await rec('won', { amount_usd: 500, payment: { key: 'od-i1-pay' } });
  });
  assert.equal(text, 'EarnKit programs: 2026-11-11\n\nResults: $6,500 won at Stand Grants.\n');
});

test('L44-9: sends on days no digest went out are carried into the next line; at most 14 days back', async () => {
  const db = sql();
  await resetDigest();
  const [inst] = await db<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES ('od-l44m') RETURNING id`;
  const send = (program: string, at: string) => db`INSERT INTO applications (owner, installation_id, program_id, status, at, sent_at, submitted_by, title, application_id)
    VALUES (${`i:${inst.id}`}, ${inst.id}, ${program}, 'applied', ${new Date(at)}, ${new Date(at)}, 'agent', ${program}, ${`app_l44${program}`})`;
  try {
    // The last digest went out Nov 9 (it covered Nov 8). Nov 9 and 10 had no digest; today is Nov 12.
    await db`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-09', ${new Date('2026-11-09T06:15:00Z')})`;
    await send('od-m1', '2026-11-08T12:00:00Z');
    await send('od-m2', '2026-11-09T12:00:00Z');
    for (const p of ['od-m3', 'od-m4', 'od-m5']) await send(p, '2026-11-10T12:00:00Z');
    for (const p of ['od-m6', 'od-m7']) await send(p, '2026-11-11T12:00:00Z');
    assert.equal(await sendOwnerDigest(new Date('2026-11-12T06:15:00Z'), mailer), 'sent');
    assert.ok(sent[0].text.includes('2 sent yesterday: 2 by agents, 0 drafted here, 0 from outside (and 1 on Nov 9, 3 on Nov 10, missed). 7 to date.\n- od-m6: 1 sent\n- od-m7: 1 sent'), sent[0].text);
    // The same day: the same body.
    assert.equal(await sendOwnerDigest(new Date('2026-11-12T09:00:00Z'), mailer), 'none');
    // A last digest 20 days back carries only the 14 days before today.
    await db`DELETE FROM owner_digests`;
    await db`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-10-23', ${new Date('2026-10-23T06:15:00Z')})`;
    await send('od-m0', '2026-10-25T12:00:00Z');
    assert.equal(await sendOwnerDigest(new Date('2026-11-12T06:15:00Z'), mailer), 'sent');
    assert.match(sent[1].text, /\(and 1 on Nov 8, 1 on Nov 9, 3 on Nov 10, missed\)\. 8 to date\./);
  } finally {
    await db`DELETE FROM applications WHERE installation_id = ${inst.id}`;
    await db`DELETE FROM installations WHERE id = ${inst.id}`;
    await resetDigest();
  }
});

test('L44-10: after a day whose link check failed with no digest, the next digest opens with that day and the days it covers', async () => {
  const db = sql();
  await resetDigest();
  try {
    await db`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-11', ${new Date('2026-11-11T06:15:00Z')})`;
    await db`INSERT INTO cron_state (id, last_run_at, last_check_failed_at) VALUES (true, ${new Date('2026-11-11T06:15:00Z')}, ${new Date('2026-11-12T06:15:00Z')})`;
    assert.equal(await sendOwnerDigest(new Date('2026-11-13T06:20:00Z'), mailer), 'sent');
    assert.equal(sent[0].text.split('\n\n')[1], 'The link check failed on Nov 12; this digest covers two days.');
    // A failure on a day a digest already went out (a rerun after it) says nothing.
    await resetDigest();
    await db`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-12', ${new Date('2026-11-12T06:15:00Z')})`;
    await db`INSERT INTO cron_state (id, last_run_at, last_check_failed_at) VALUES (true, ${new Date('2026-11-12T06:15:00Z')}, ${new Date('2026-11-12T07:15:00Z')})`;
    assert.equal(await sendOwnerDigest(new Date('2026-11-13T06:15:00Z'), mailer), 'none');
    // A failure today: the digest is today's, no line.
    await db`UPDATE cron_state SET last_check_failed_at = ${new Date('2026-11-13T05:00:00Z')}`;
    assert.equal(await sendOwnerDigest(new Date('2026-11-13T06:15:00Z'), mailer), 'none');
  } finally {
    await resetDigest();
  }
});

test('L44-7, L44-8: one round closed is named on its first day only; a failing link off the builders\' list reads (not listed) with its age', async () => {
  const db = sql();
  await resetDigest();
  await db`DELETE FROM programs`;
  await upsertProgram(programFixture({ id: 'od-round', title: 'Round Grants', source_url: 'https://round.example/about', submission_url: 'https://round.example/form' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'od-dead', title: 'Dead Grants', source_url: 'https://dead.example/about', submission_url: 'https://dead.example/form' }), 'file', NOW);
  const link: LinkCheck = async (u) => (u.startsWith('https://dead.') ? { ok: false, why: '4xx' }
    : { ok: true, page: u.endsWith('/form') ? '<p>Round 1 applications are closed. Round 2 is open now: apply below.</p>' : '<p>About</p>' });
  try {
    await runHealth(NOW, { link });
    assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
    assert.ok(sent[0].text.includes('Forms that say they are closed\n- Round Grants: the form says one round is closed (https://round.example/form); check it.'), sent[0].text);
    assert.ok(sent[0].text.includes('- Dead Grants: down since today (https://dead.example/about)'), sent[0].text);
    // Thirteen days on: the round line is gone; the dead program has left the list.
    await db`UPDATE program_health SET first_failed_at = ${new Date(NOW.getTime() - 13 * 86_400_000)} WHERE program_id = 'od-dead'`;
    await db`UPDATE programs SET stale_since = ${new Date(NOW.getTime() - 13 * 86_400_000)} WHERE id = 'od-dead'`;
    const later = new Date(NOW.getTime() + 86_400_000);
    await runHealth(later, { link });
    assert.equal(await sendOwnerDigest(later, mailer), 'sent');
    assert.doesNotMatch(sent[1].text, /Round Grants/);
    assert.ok(sent[1].text.includes('- Dead Grants (not listed): down 14 days (https://dead.example/about)'), sent[1].text);
  } finally {
    await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
    await resetDigest();
  }
});

// v6.1.19 Task 6 fix round 1.
test('fix round 1 (I1): the round line never comes back on a later day when a down source link pulls the program in', async () => {
  const db = sql();
  await resetDigest();
  await db`DELETE FROM programs`;
  await upsertProgram(programFixture({ id: 'od-r4', title: 'Round Four Grants', source_url: 'https://r4.example/about', submission_url: 'https://r4.example/form' }), 'file', NOW);
  const form = '<p>Round 1 applications are closed. Round 2 is open now: apply below.</p>';
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
  try {
    await runHealth(NOW, { link: async (u) => ({ ok: true, page: u.endsWith('/form') ? form : '<p>About</p>' }) });
    assert.equal(await sendOwnerDigest(NOW, mailer), 'sent');
    assert.match(sent[0].text, /one round is closed/);
    await runHealth(day(3), { link: async (u) => (u.endsWith('/about') ? { ok: false, why: '4xx' } : { ok: true, page: form }) });
    assert.equal(await sendOwnerDigest(day(3), mailer), 'sent');
    assert.match(sent[1].text, /Links that did not load\n- Round Four Grants: down since today \(https:\/\/r4\.example\/about\)/);
    assert.doesNotMatch(sent[1].text, /one round is closed|Forms that say/);
  } finally {
    await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
    await resetDigest();
  }
});

test('fix round 1 (I2): ages count UTC days: a run 5 seconds earlier the next day reads 1 day, not since today', async () => {
  const db = sql();
  await resetDigest();
  await db`DELETE FROM programs`;
  await upsertProgram(programFixture({ id: 'od-age', title: 'Age Grants', source_url: 'https://age.example/about', submission_url: 'https://age.example/form' }), 'file', NOW);
  const first = new Date('2026-11-04T06:15:05Z');
  const next = new Date('2026-11-05T06:15:00Z');
  const link: LinkCheck = async (u) => (u.endsWith('/about') ? { ok: false, why: '4xx' } : { ok: true, page: '<p>Applications are closed.</p>' });
  try {
    await runHealth(first, { link });
    await runHealth(next, { link });
    assert.equal(await sendOwnerDigest(next, mailer), 'sent');
    assert.ok(sent[0].text.includes('- Age Grants: down 1 day (https://age.example/about)'), sent[0].text);
    assert.ok(sent[0].text.includes('- Age Grants: the form says it is closed, 1 day (https://age.example/form)'), sent[0].text);
  } finally {
    await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
    await resetDigest();
  }
});

test('fix round 2: a round that began on a day no digest covered is named once in the next digest, not again the day after', async () => {
  const db = sql();
  await resetDigest();
  await db`DELETE FROM programs`;
  await upsertProgram(programFixture({ id: 'od-rd', title: 'Round Day Grants', source_url: 'https://rd.example/about', submission_url: 'https://rd.example/form' }), 'file', NOW);
  const link: LinkCheck = async (u) => ({ ok: true, page: u.endsWith('/form') ? '<p>Round 1 applications are closed. Round 2 is open now: apply below.</p>' : '<p>About</p>' });
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
  try {
    // A digest went out the day before D; on D the walk sees the round but no digest goes out.
    await db`INSERT INTO owner_digests (day, sent_at) VALUES ('2026-11-03', ${new Date('2026-11-03T06:15:00Z')})`;
    await runHealth(NOW, { link });
    await runHealth(day(1), { link });
    assert.equal(await sendOwnerDigest(day(1), mailer), 'sent');
    assert.equal(sent[0].text.match(/Round Day Grants: the form says one round is closed \(https:\/\/rd\.example\/form\); check it\./g)?.length, 1, sent[0].text);
    await runHealth(day(2), { link });
    assert.equal(await sendOwnerDigest(day(2), mailer), 'none');
    assert.equal(sent.length, 1);
  } finally {
    await db`DELETE FROM programs WHERE id LIKE 'od-%'`;
    await resetDigest();
  }
});
