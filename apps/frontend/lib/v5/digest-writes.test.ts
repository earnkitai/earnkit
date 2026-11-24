/**
 * v3.8 G-A (H4) items 8 and 9. The owner digest read lists the day's writes: programs the automated lane created live
 * (with auto_live off, Growth's writer sending the check's fields, and on through the owner/test flag preview), across
 * the owner's IST midnight, plus refusals and recorded handles. And recording a handle (or a confirmed write of the
 * same organizer) re-marks live new-organizer programs on that domain as confirmed.
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { withFlagPreview } from './flags';
import { getProgram } from './programs';
import { digestGet, writePost } from './programs-api';
import { agentMayAct } from './official-page';

after(() => sql().end());

const TOKEN = 'd'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
const ENDS = `${new Date().getUTCFullYear() + 1}-03-15T23:59:00Z`;
const year = new Date(ENDS).getUTCFullYear();

beforeEach(() => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_FLAGS;
});

const program = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organizer: `Org ${id}`,
  title: `Grants ${id}`,
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
  ...over,
});

const pageOf = (host: string) =>
  `<html><body><p>Each team gets up to $10,000 in funding.</p><p>Applications close March 15, ${year}.</p>
   <a href="https://${host}/apply">Apply now</a></body></html>`;
const CHECK = {
  amount_quote: 'up to $10,000 in funding',
  deadline_quote: `Applications close March 15, ${year}.`,
  found_by_query: 'grants 2027',
  found_by_source: 'x:@someorg',
};

const req = (path: string, body?: unknown) =>
  new Request(`https://earnkit.com${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const write = async (body: Record<string, unknown>) => {
  const res = await writePost(req('/api/programs/write', body), {
    probe: async () => {},
    readPage: async (url) => pageOf(new URL(url).hostname),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};
const upsert = (id: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  write({ action: 'upsert', program: program(id, over), ...CHECK, ...extra });

type Digest = { day: string; lines: string[]; changes: unknown[]; writes: { created: { program_id: string; write_id: string | null; labels: string[] }[]; refused: number; handles: string[]; confirmed: { program_id: string }[] } };
const digest = async (now?: Date) => (await (await digestGet(req('/api/programs/digest'), now)).json()) as Digest;

const createWriteId = async (id: string) =>
  (await sql()<{ id: string }[]>`SELECT id::text FROM program_writes WHERE program_id = ${id} AND result = 'created' ORDER BY id DESC LIMIT 1`)[0]!.id;

test('auto_live off: a program the automated lane created today is in the digest read, with its labels and write', async () => {
  const out = await upsert('dw-off');
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.result, 'created');
  const d = await digest();
  assert.ok(d.lines.includes('New live programs'), JSON.stringify(d.lines));
  assert.ok(d.lines.includes(`- Grants dw-off: new organizer (revert: write ${await createWriteId('dw-off')})`), JSON.stringify(d.lines));
  const c = d.writes.created.find((w) => w.program_id === 'dw-off');
  assert.deepEqual(c, { program_id: 'dw-off', title: 'Grants dw-off', write_id: await createWriteId('dw-off'), labels: ['new organizer'] });
});

test('auto_live on through the owner/test flag preview: the create is in the digest read too', async () => {
  const out = await withFlagPreview(true, () => upsert('dw-preview'));
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const d = await withFlagPreview(true, () => digest());
  assert.ok(d.writes.created.some((w) => w.program_id === 'dw-preview'));
  assert.ok(d.lines.some((l) => l.startsWith('- Grants dw-preview: new organizer')));
});

test('refused writes and recorded handles are counted in the digest, never with a body', async () => {
  const bad = await upsert('dw-refused', {}, { amount_quote: '$999,999 in prizes' });
  assert.equal(bad.status, 400);
  const h = await write({ action: 'handle', handle: '@dw_handle', profile_domain: 'dw-handle.org' });
  assert.equal(h.status, 200);
  const d = await digest();
  assert.ok(d.writes.refused >= 1);
  assert.ok(d.writes.handles.includes('@dw_handle dw-handle.org'));
  assert.ok(d.lines.some((l) => /^Writes since the last digest: \d+ refused/.test(l) && l.includes('@dw_handle dw-handle.org')), JSON.stringify(d.lines));
});

test("the owner's IST midnight: creates at 23:30 IST and 00:30 IST are both in the 7:30 IST read", async () => {
  await upsert('dw-ist-late');
  await upsert('dw-ist-early');
  // 23:30 IST on Nov 24 and 00:30 IST on Nov 25 (18:00Z and 19:00Z on Nov 24).
  await sql()`UPDATE program_writes SET at = '2026-11-24T18:00:00Z' WHERE program_id = 'dw-ist-late'`;
  await sql()`UPDATE program_writes SET at = '2026-11-24T19:00:00Z' WHERE program_id = 'dw-ist-early'`;
  // Jenil AI's 7:30 IST brief on Nov 25 (02:00Z).
  const d = await digest(new Date('2026-11-25T02:00:00Z'));
  assert.equal(d.day, '2026-11-25');
  const ids = d.writes.created.map((w) => w.program_id);
  assert.ok(ids.includes('dw-ist-late') && ids.includes('dw-ist-early'), JSON.stringify(ids));
  // A read just after IST midnight (00:45 IST, still Nov 24 in UTC) has both too.
  const ids2 = (await digest(new Date('2026-11-24T19:15:00Z'))).writes.created.map((w) => w.program_id);
  assert.ok(ids2.includes('dw-ist-late') && ids2.includes('dw-ist-early'), JSON.stringify(ids2));
});

test('a handle recorded after the program went live re-marks it confirmed; submit stays builder; info only kept', async () => {
  // fe-builders-challenge: live as new organizer, then @official_fe -> fe-lang.org is recorded.
  const fe = await upsert('dw-fe', { organizer: 'Argot Collective', source_url: 'https://dw-fe.org/contest/', submission_url: 'https://dw-fe.org/apply' });
  assert.equal(fe.json.organizer, 'new');
  // A second new-organizer program on the same domain whose link is off the page: information only stays.
  const info = await upsert('dw-fe-info', { organizer: 'Someone Else', source_url: 'https://www.dw-fe.org/other', submission_url: 'https://dw-fe.org/elsewhere' });
  assert.equal(info.json.info_only, true);
  // A new-organizer program on another domain is not touched.
  await upsert('dw-other');

  const h = await write({ action: 'handle', handle: '@official_dwfe', profile_domain: 'dw-fe.org' });
  assert.equal(h.status, 200);
  assert.deepEqual(h.json.confirmed, ['dw-fe', 'dw-fe-info']);

  const row = (await getProgram('dw-fe'))!;
  assert.equal(row.file.new_organizer, undefined);
  assert.equal(row.file.submit, 'builder', 'the writer\'s submit is not stored, so the builder still sends it');
  assert.equal(agentMayAct(row.file), true);
  const other = (await getProgram('dw-fe-info'))!;
  assert.equal(other.file.new_organizer, undefined);
  assert.equal(other.file.info_only, true);
  assert.equal(agentMayAct(other.file), false);
  assert.equal((await getProgram('dw-other'))!.file.new_organizer, true);

  const [w] = await sql()<{ action: string; result: string; reason: string }[]>`
    SELECT action, result, reason FROM program_writes WHERE program_id = 'dw-fe' ORDER BY id DESC LIMIT 1`;
  assert.deepEqual(w, { action: 'organizer', result: 'confirmed', reason: '@official_dwfe ties dw-fe.org' });
  const d = await digest();
  assert.ok(d.writes.confirmed.some((c) => c.program_id === 'dw-fe'));
  assert.ok(d.lines.includes('- Grants dw-fe: organizer confirmed (@official_dwfe ties dw-fe.org)'), JSON.stringify(d.lines));

  // Growth re-sending the same payload with no handle keeps it confirmed (the domain is tracked now).
  const again = await upsert('dw-fe', { organizer: 'Argot Collective', source_url: 'https://dw-fe.org/contest/', submission_url: 'https://dw-fe.org/apply' });
  assert.equal(again.json.organizer, 'confirmed', JSON.stringify(again.json));
});

test('a handle on a shared or platform host confirms nothing', async () => {
  const p = await upsert('dw-shared', { source_url: 'https://dw-shared.github.io/grants', submission_url: 'https://dw-shared.github.io/apply' });
  assert.equal(p.json.organizer, 'new');
  const h = await write({ action: 'handle', handle: '@dw_shared', profile_domain: 'github.io' });
  assert.deepEqual(h.json.confirmed, []);
  assert.equal((await getProgram('dw-shared'))!.file.new_organizer, true);
});

test('a confirmed write re-marks the same organizer\'s new-organizer program on that domain', async () => {
  const first = await upsert('dw-sib-a', { organizer: 'Sib Org', source_url: 'https://dw-sib.org/a', submission_url: 'https://dw-sib.org/apply' });
  assert.equal(first.json.organizer, 'new');
  await write({ action: 'handle', handle: '@dw_sib_other', profile_domain: 'dw-sib-elsewhere.org' });
  // A different organizer on the same domain is not tied by the sibling rule.
  const stranger = await upsert('dw-sib-x', { organizer: 'Stranger', source_url: 'https://dw-sib.org/x', submission_url: 'https://dw-sib.org/apply' });
  assert.equal(stranger.json.organizer, 'new');
  // The organizer's second program, confirmed by an evidence page on a confirmed domain.
  await write({ action: 'handle', handle: '@dw_sib', profile_domain: 'dw-sib-home.org' });
  const res = await writePost(
    req('/api/programs/write', {
      action: 'upsert',
      program: program('dw-sib-b', { organizer: 'Sib Org', source_url: 'https://dw-sib.org/b', submission_url: 'https://dw-sib.org/apply' }),
      ...CHECK, handle: 'dw_sib', evidence_url: 'https://dw-sib-home.org/news',
    }),
    { probe: async () => {}, readPage: async (u) => (u.includes('dw-sib-home') ? '<a href="https://dw-sib.org/b">ours</a>' : pageOf('dw-sib.org')) },
  );
  const out = (await res.json()) as Record<string, unknown>;
  assert.equal(out.organizer, 'confirmed', JSON.stringify(out));
  assert.equal((await getProgram('dw-sib-a'))!.file.new_organizer, undefined);
  assert.equal((await getProgram('dw-sib-x'))!.file.new_organizer, true);
});
