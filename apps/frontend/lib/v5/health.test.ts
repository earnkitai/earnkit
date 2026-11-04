import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { probeProgram, runHealth } from './health';
import { programFixture } from './fixtures/program';
import { listOpenPrograms, upsertProgram } from './programs';
import { HttpStatusError, RedirectError, SafeFetchError, type Probe } from './safe-fetch';

after(() => sql().end());

const DAY = 86_400_000;
const D1 = new Date('2026-11-04T06:15:00Z');
const D2 = new Date(D1.getTime() + DAY);
const D3 = new Date(D1.getTime() + 2 * DAY);
const ok: Probe = async () => {};
const failOn = (bad: string): Probe => async (u) => {
  if (u === bad) throw new SafeFetchError('down');
};
const page = (html: string) => async () => html;
const row = async (id: string) => (await sql()`SELECT * FROM program_health WHERE program_id = ${id}`)[0]!;
const stale = async (id: string) => (await sql()`SELECT stale_since FROM programs WHERE id = ${id}`)[0]!.stale_since as Date | null;

test('probeProgram: 2xx, 3xx, 401, 403, 429 are ok; 404, 5xx and network errors are not', async () => {
  const p = programFixture({ id: 'h-probe' });
  const answer = (e: Error | null): Probe => async () => {
    if (e) throw e;
  };
  for (const e of [null, new RedirectError(301, '/x'), new HttpStatusError(401), new HttpStatusError(403), new HttpStatusError(429)]) {
    const h = await probeProgram(p, { probe: answer(e), page: page('<p>a</p>'), now: D1 });
    assert.equal(h.source_ok, true);
    assert.equal(h.submit_ok, true);
  }
  for (const e of [new HttpStatusError(404), new HttpStatusError(503), new SafeFetchError('no answer within 5 s')]) {
    const h = await probeProgram(p, { probe: answer(e), page: page('<p>a</p>'), now: D1 });
    assert.equal(h.source_ok, false);
    assert.equal(h.submit_ok, false);
  }
});

test('probeProgram: the text ignores whitespace and markup; changed needs stored text that shares under 80% of the words', async () => {
  const p = programFixture({ id: 'h-hash' });
  const a = await probeProgram(p, { probe: ok, page: page('<p>Apply  now</p>'), now: D1 });
  const b = await probeProgram(p, { probe: ok, page: page('<div>Apply\n now</div>'), now: D1, prevText: a.body_text });
  assert.equal(a.changed, false);
  assert.match(a.body_hash!, /^[0-9a-f]{64}$/);
  assert.equal(a.body_text, 'apply now');
  assert.equal(b.body_hash, a.body_hash);
  assert.equal(b.changed, false);
  const c = await probeProgram(p, { probe: ok, page: page('<p>Closed</p>'), now: D1, prevText: a.body_text });
  assert.equal(c.changed, true);
});

const GRANT_PAGE = (amount: string) =>
  `<h1>Builder Grants</h1><p>We fund teams shipping onchain apps. Grants of up to ${amount} go to live products with real users.
   Apply on the form; we review every application within four weeks and reply by email.</p>`;

test('one changed number is not a change; a rewritten page is', async () => {
  const p = programFixture({ id: 'h-words' });
  const a = await probeProgram(p, { probe: ok, page: page(GRANT_PAGE('$5,000')), now: D1 });
  const number = await probeProgram(p, { probe: ok, page: page(GRANT_PAGE('$10,000')), now: D1, prevText: a.body_text });
  assert.notEqual(number.body_hash, a.body_hash);
  assert.equal(number.changed, false);
  const rewritten = await probeProgram(p, {
    probe: ok, page: page('<h1>Builder Grants</h1><p>The program is paused while we plan the next season. Follow us for news.</p>'), now: D1, prevText: a.body_text,
  });
  assert.equal(rewritten.changed, true);
});

test('a changed page is listed, never stale', async () => {
  await upsertProgram(programFixture({ id: 'h-nostale', source_url: 'https://nostale.example/a' }), 'file', D1);
  await runHealth({ probe: ok, page: page(GRANT_PAGE('$5,000')), now: D1 });
  const r = await runHealth({ probe: ok, page: page('<p>Something else entirely now</p>'), now: D2 });
  assert.ok(r.changed.includes('h-nostale'));
  assert.ok(!r.stale.includes('h-nostale'));
  assert.equal(await stale('h-nostale'), null);
});

test('a failure today is not stale; failing two days running is stale; a clean day clears it', async () => {
  const p = programFixture({ id: 'h-stale', source_url: 'https://stale.example/grants' });
  await upsertProgram(p, 'file', D1);
  const deps = (now: Date, probe: Probe) => ({ probe, page: page('<p>x</p>'), now });
  const bad = failOn('https://stale.example/grants');

  const r1 = await runHealth(deps(D1, bad));
  assert.ok(!r1.stale.includes('h-stale'));
  assert.equal((await row('h-stale')).fail_days, 1);
  assert.equal(await stale('h-stale'), null);

  await runHealth(deps(D1, bad)); // same day again: no double count
  assert.equal((await row('h-stale')).fail_days, 1);

  const r2 = await runHealth(deps(D2, bad));
  assert.ok(r2.stale.includes('h-stale'));
  assert.equal((await row('h-stale')).fail_days, 2);
  assert.equal((await stale('h-stale'))?.toISOString(), D2.toISOString());
  assert.ok((await listOpenPrograms(D2)).some((x) => x.id === 'h-stale'));
  assert.ok(!(await listOpenPrograms(new Date(D2.getTime() + 15 * DAY))).some((x) => x.id === 'h-stale'));

  await runHealth(deps(D3, bad)); // first-time only: stale_since keeps D2
  assert.equal((await stale('h-stale'))?.toISOString(), D2.toISOString());

  await runHealth(deps(new Date(D3.getTime() + DAY), ok));
  assert.equal((await row('h-stale')).fail_days, 0);
  assert.equal(await stale('h-stale'), null);
});

test('a passed ends_at closes an active program and records the status change', async () => {
  await upsertProgram(programFixture({ id: 'h-ended', ends_at: '2026-11-01T00:00:00Z' }), 'file', D1);
  await upsertProgram(programFixture({ id: 'h-future', ends_at: '2026-12-01T00:00:00Z' }), 'file', D1);
  const r = await runHealth({ probe: ok, page: page('<p>x</p>'), now: D1 });
  assert.ok(r.closed.includes('h-ended'));
  assert.ok(!r.closed.includes('h-future'));
  assert.equal((await sql()`SELECT status FROM programs WHERE id = 'h-ended'`)[0]!.status, 'closed');
  assert.deepEqual((await sql()`SELECT fields FROM program_changes WHERE program_id = 'h-ended'`).map((c) => c.fields), [['status']]);
});

test('a page change sets changed_at; a failing probe never stops the walk; limit and order hold', async () => {
  await upsertProgram(programFixture({ id: 'h-page', source_url: 'https://page.example/a' }), 'file', D1);
  await runHealth({ probe: ok, page: page('<p>one</p>'), now: D1 });
  assert.equal((await row('h-page')).changed_at, null);
  const r = await runHealth({ probe: ok, page: page('<p>two</p>'), now: D2 });
  assert.ok(r.changed.includes('h-page'));
  assert.equal((await row('h-page')).changed_at.toISOString(), D2.toISOString());

  const throwing: Probe = async () => {
    throw new Error('boom');
  };
  const r2 = await runHealth({ probe: throwing, page: page('x'), now: D3 });
  assert.ok(r2.checked > 1);

  const before = (await row('h-page')).checked_at as Date;
  const r3 = await runHealth({ probe: ok, page: page('<p>two</p>'), now: new Date(D3.getTime() + DAY) }, 1);
  assert.equal(r3.checked, 1);
  const rows = await sql()`SELECT program_id FROM program_health ORDER BY checked_at ASC`;
  assert.ok(before.getTime() > 0 && rows.length > 1);
});
