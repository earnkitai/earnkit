import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { dateStatus, PROBE_MS, PROBE_PARALLEL, probeProgram, runHealth, STALE_AFTER_MS, UNREADABLE_FIX, type LinkCheck } from './health';
import { programFixture } from './fixtures/program';
import { cimdFixture } from './fixtures/cimd';
import { ProgramFile } from './program-file';
import { findProgramsDir } from './programs-api';
import { listListedPrograms, listOpenPrograms, STALE_DAYS, upsertProgram } from './programs';
import type { ProbeResult } from './safe-fetch';

after(() => sql().end());

const DAY = 86_400_000;
const D1 = new Date('2026-11-04T06:15:00Z');
const D2 = new Date(D1.getTime() + DAY);
const D3 = new Date(D1.getTime() + 2 * DAY);
/** Every link loads `html`; the links in `dead` answer as given. */
const links = (html: string, dead: Record<string, ProbeResult> = {}): LinkCheck => async (u) => dead[u] ?? { ok: true, page: html };
const ok = links('<p>x</p>');
const row = async (id: string) => (await sql()`SELECT * FROM program_health WHERE program_id = ${id}`)[0]!;
const stale = async (id: string) => (await sql()`SELECT stale_since FROM programs WHERE id = ${id}`)[0]!.stale_since as Date | null;
const statusOf = async (id: string) => (await sql()`SELECT status FROM programs WHERE id = ${id}`)[0]!.status as string;
/** Only these programs are left in this file's database (the template holds the catalog). */
const only = async (...ids: string[]) => sql()`DELETE FROM programs WHERE NOT (id = ANY(${ids}))`;

test('PROBE_MS is 8 s per link and PROBE_PARALLEL 10 programs at once (Task 16)', () => {
  assert.equal(PROBE_MS, 8_000);
  assert.equal(PROBE_PARALLEL, 10);
});

test('probeProgram: an alive answer (with or without a redirect) is ok; 4xx, 5xx, dns, timeout and refused are not', async () => {
  const p = programFixture({ id: 'h-probe' });
  for (const r of [{ ok: true }, { ok: true, redirect: 'docs.google.com' }] as ProbeResult[]) {
    const h = await probeProgram(p, { link: async () => r, now: D1 });
    assert.equal(h.source_ok, true);
    assert.equal(h.submit_ok, true);
  }
  for (const why of ['4xx', '5xx', 'dns', 'timeout', 'refused'] as const) {
    const h = await probeProgram(p, { link: async () => ({ ok: false, why }), now: D1 });
    assert.equal(h.source_ok, false, why);
    assert.equal(h.submit_ok, false, why);
  }
  // A check that throws is dead; one that hangs is cut at the per-link bound.
  const thrown = await probeProgram(p, { link: async () => { throw new Error('boom'); }, now: D1 });
  assert.equal(thrown.source_ok, false);
  const t0 = Date.now();
  const hung = await probeProgram(p, { link: () => new Promise(() => {}), now: D1, probeMs: 30 });
  assert.equal(hung.source_ok, false);
  assert.ok(Date.now() - t0 < 1_000);
});

test('L30-10: one GET per link; the source page text comes from the probe, and one link serves both when they are the same', async () => {
  const seen: string[] = [];
  const check: LinkCheck = async (u) => (seen.push(u), { ok: true, page: '<p>Apply now</p>' });
  const h = await probeProgram(programFixture({ id: 'h-one', source_url: 'https://one.example/a', submission_url: 'https://one.example/b' }), { link: check, now: D1 });
  assert.deepEqual(seen.sort(), ['https://one.example/a', 'https://one.example/b']);
  assert.equal(h.body_text, 'apply now');
  seen.length = 0;
  await probeProgram(programFixture({ id: 'h-same', source_url: 'https://one.example/a', submission_url: 'https://one.example/a' }), { link: check, now: D1 });
  assert.deepEqual(seen, ['https://one.example/a']);
});

test('probeProgram: the text ignores whitespace and markup; changed needs stored text that shares under 80% of the words', async () => {
  const p = programFixture({ id: 'h-hash' });
  const a = await probeProgram(p, { link: links('<p>Apply  now</p>'), now: D1 });
  const b = await probeProgram(p, { link: links('<div>Apply\n now</div>'), now: D1, prevText: a.body_text });
  assert.equal(a.changed, false);
  assert.match(a.body_hash!, /^[0-9a-f]{64}$/);
  assert.equal(a.body_text, 'apply now');
  assert.equal(b.body_hash, a.body_hash);
  assert.equal(b.changed, false);
  const c = await probeProgram(p, { link: links('<p>Closed</p>'), now: D1, prevText: a.body_text });
  assert.equal(c.changed, true);
});

const GRANT_PAGE = (amount: string) =>
  `<h1>Builder Grants</h1><p>We fund teams shipping onchain apps. Grants of up to ${amount} go to live products with real users.
   Apply on the form; we review every application within four weeks and reply by email.</p>`;

test('one changed number is not a change; a rewritten page is', async () => {
  const p = programFixture({ id: 'h-words' });
  const a = await probeProgram(p, { link: links(GRANT_PAGE('$5,000')), now: D1 });
  const number = await probeProgram(p, { link: links(GRANT_PAGE('$10,000')), now: D1, prevText: a.body_text });
  assert.notEqual(number.body_hash, a.body_hash);
  assert.equal(number.changed, false);
  const rewritten = await probeProgram(p, {
    link: links('<h1>Builder Grants</h1><p>The program is paused while we plan the next season. Follow us for news.</p>'), now: D1, prevText: a.body_text,
  });
  assert.equal(rewritten.changed, true);
});

test('a changed page is listed, never stale', async () => {
  await upsertProgram(programFixture({ id: 'h-nostale', source_url: 'https://nostale.example/a' }), 'file', D1);
  await runHealth(D1, { link: links(GRANT_PAGE('$5,000')) });
  const r = await runHealth(D2, { link: links('<p>Something else entirely now</p>') });
  assert.ok(r.changed.includes('h-nostale'));
  assert.ok(!r.stale.includes('h-nostale'));
  assert.equal(await stale('h-nostale'), null);
});

test('a failure today is not stale; failing 24 hours later is stale; a clean day clears it', async () => {
  await upsertProgram(programFixture({ id: 'h-stale', source_url: 'https://stale.example/grants' }), 'file', D1);
  const bad = links('<p>x</p>', { 'https://stale.example/grants': { ok: false, why: '4xx' } });

  const r1 = await runHealth(D1, { link: bad });
  assert.ok(!r1.stale.includes('h-stale'));
  assert.equal((await row('h-stale')).fail_days, 1);
  assert.equal(await stale('h-stale'), null);

  await runHealth(D1, { link: bad }); // same day again: no double count
  assert.equal((await row('h-stale')).fail_days, 1);

  const r2 = await runHealth(D2, { link: bad });
  assert.ok(r2.stale.includes('h-stale'));
  assert.equal((await row('h-stale')).fail_days, 2);
  assert.equal((await stale('h-stale'))?.toISOString(), D2.toISOString());
  assert.ok((await listOpenPrograms(D2)).some((x) => x.id === 'h-stale'));
  assert.ok(!(await listOpenPrograms(new Date(D2.getTime() + 13 * DAY))).some((x) => x.id === 'h-stale'));

  await runHealth(D3, { link: bad }); // first-time only: stale_since keeps D2
  assert.equal((await stale('h-stale'))?.toISOString(), D2.toISOString());

  await runHealth(new Date(D3.getTime() + DAY), { link: ok });
  assert.equal((await row('h-stale')).fail_days, 0);
  assert.equal((await row('h-stale')).first_failed_at, null);
  assert.equal(await stale('h-stale'), null);
});

// v6.1.17 Task 3 (L30-9, Review Focus 5): stale by hours of failing, never by UTC dates.
test('L30-9: a link failing from 23:59 to 00:01 is not stale; one failing for 20 hours is, 19 h 59 min is not', async () => {
  const H = 3_600_000;
  assert.equal(STALE_AFTER_MS, 20 * H);
  assert.equal(STALE_DAYS, 12);
  await upsertProgram(programFixture({ id: 'h-mid', source_url: 'https://mid.example/a', submission_url: 'https://mid.example/a' }), 'file', D1);
  await only('h-mid');
  const bad = links('<p>x</p>', { 'https://mid.example/a': { ok: false, why: '5xx' } });
  const t0 = new Date('2026-11-30T23:59:00Z');
  const r1 = await runHealth(t0, { link: bad });
  assert.deepEqual(r1.stale, []);
  assert.equal((await row('h-mid')).first_failed_at.toISOString(), t0.toISOString());
  const r2 = await runHealth(new Date('2026-12-01T00:01:00Z'), { link: bad });
  assert.deepEqual(r2.stale, []);
  assert.equal((await row('h-mid')).fail_days, 2); // two UTC dates, yet not stale
  assert.equal(await stale('h-mid'), null);
  assert.equal((await row('h-mid')).first_failed_at.toISOString(), t0.toISOString());
  const r3 = await runHealth(new Date(t0.getTime() + 20 * H - 60_000), { link: bad });
  assert.deepEqual(r3.stale, []);
  const at20 = new Date(t0.getTime() + 20 * H);
  const r4 = await runHealth(at20, { link: bad });
  assert.deepEqual(r4.stale, ['h-mid']);
  assert.equal((await stale('h-mid'))?.toISOString(), at20.toISOString());
  // Within about two weeks of the first failure: listed 12 days after stale, gone 1 ms later.
  assert.ok((await listOpenPrograms(new Date(at20.getTime() + 12 * DAY))).some((x) => x.id === 'h-mid'));
  assert.ok(!(await listOpenPrograms(new Date(at20.getTime() + 12 * DAY + 1))).some((x) => x.id === 'h-mid'));
  assert.ok(at20.getTime() + 12 * DAY - t0.getTime() < 14 * DAY);
  // A clean check clears the start; the next failure starts again.
  await runHealth(new Date(t0.getTime() + 21 * H), { link: ok });
  assert.equal((await row('h-mid')).first_failed_at, null);
  const again = new Date(t0.getTime() + 22 * H);
  assert.deepEqual((await runHealth(again, { link: bad })).stale, []);
  assert.equal((await row('h-mid')).first_failed_at.toISOString(), again.toISOString());
});

test('a passed ends_at closes an active program and records the status change', async () => {
  await upsertProgram(programFixture({ id: 'h-ended', ends_at: '2026-11-01T00:00:00Z' }), 'file', D1);
  await upsertProgram(programFixture({ id: 'h-future', ends_at: '2026-12-01T00:00:00Z' }), 'file', D1);
  const r = await runHealth(D1, { link: ok });
  assert.ok(r.closed.includes('h-ended'));
  assert.ok(!r.closed.includes('h-future'));
  assert.equal(await statusOf('h-ended'), 'closed');
  assert.deepEqual((await sql()`SELECT fields FROM program_changes WHERE program_id = 'h-ended'`).map((c) => c.fields), [['status']]);
});

test('a page change sets changed_at; a failing check never stops the walk and is listed in failed only when it throws past the bound; limit and order hold', async () => {
  await upsertProgram(programFixture({ id: 'h-page', source_url: 'https://page.example/a' }), 'file', D1);
  await runHealth(D1, { link: links('<p>one</p>') });
  assert.equal((await row('h-page')).changed_at, null);
  const r = await runHealth(D2, { link: links('<p>two</p>') });
  assert.ok(r.changed.includes('h-page'));
  assert.equal((await row('h-page')).changed_at.toISOString(), D2.toISOString());

  const r2 = await runHealth(D3, { link: async () => { throw new Error('boom'); } });
  assert.ok(r2.checked > 1);

  const r3 = await runHealth(new Date(D3.getTime() + DAY), { link: links('<p>two</p>'), limit: 1 });
  assert.equal(r3.checked, 1);
});

// --- L30-2 (Review Focus 22): a redirect to another host is alive, never followed, and logged.

/** A site: the source page loads, the submission link answers 302 to docs.google.com. */
const redirectSite = () =>
  cimdFixture((url) =>
    url.pathname === '/apply'
      ? { status: 302, location: 'https://docs.google.com/forms/d/e/x/viewform?usp=sf_link', body: '' }
      : { status: 200, contentType: 'text/html', body: '<html><p>Grants for builders</p></html>' },
  );

test('L30-2: a 302 to another host stays listed and never goes stale over 20 daily runs; the target is never requested; the log names the host', async () => {
  const p = programFixture({ id: 'h-302', source_url: 'https://redir.example/grants', submission_url: 'https://redir.example/apply' });
  await upsertProgram(p, 'file', D1);
  await only('h-302');
  const site = redirectSite();
  const logged: string[] = [];
  const was = console.log;
  console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  try {
    for (let day = 0; day < 20; day++) {
      const before = site.requests.length;
      const r = await runHealth(new Date(D1.getTime() + day * DAY), { resolve: site.resolve, transport: site.transport });
      assert.deepEqual(r.stale, [], `day ${day + 1}`);
      assert.deepEqual(r.failed, []);
      // The link check: one request to each link, none to the redirect's target. Fix round 1 (L39-5): the closed-form
      // read then follows the submission link on its own (the link again, then the target).
      const day_ = site.requests.slice(before);
      assert.deepEqual(day_.slice(0, 2).sort(), ['https://redir.example/apply', 'https://redir.example/grants']);
      assert.deepEqual(day_.slice(2), ['https://redir.example/apply', 'https://docs.google.com/forms/d/e/x/viewform?usp=sf_link']);
    }
  } finally {
    console.log = was;
  }
  assert.equal((await row('h-302')).submit_closed, false);
  assert.equal((await row('h-302')).fail_days, 0);
  assert.equal(await stale('h-302'), null);
  assert.ok((await listOpenPrograms(new Date(D1.getTime() + 20 * DAY))).some((x) => x.id === 'h-302'));
  assert.equal(logged.filter((l) => l === '[health] h-302 redirects to docs.google.com').length, 20);
  assert.ok(logged.every((l) => !l.includes('usp=')));
});

test('L30-2: a 404, a 500, a name that does not resolve and a timeout each count as a failing day', async () => {
  const cases: [string, Parameters<typeof cimdFixture>[0], string?][] = [
    ['h-404', { status: 404, body: '' }],
    ['h-500', { status: 500, body: '' }],
    ['h-dns', { status: 200, body: '' }, 'dns'],
    ['h-slow', { stall: true }],
  ];
  for (const [id, answer, kind] of cases) {
    await upsertProgram(programFixture({ id, source_url: `https://${id}.example/a`, submission_url: `https://${id}.example/a` }), 'file', D1);
    await only(id);
    const site = cimdFixture(answer);
    const resolve = kind === 'dns' ? async () => [] : site.resolve;
    const r = await runHealth(D1, { resolve, transport: site.transport, probeMs: 50 });
    assert.equal(r.checked, 1, id);
    assert.equal((await row(id)).fail_days, 1, id);
    assert.equal((await row(id)).source_ok, false, id);
  }
});

// --- L30-1: status moves by date.

const catalog = (id: string) => ProgramFile.parse(JSON.parse(readFileSync(join(findProgramsDir()!, `${id}.json`), 'utf8')));

test('dateStatus: closes at ends_at (active or upcoming), opens an upcoming program at starts_at, else stays', () => {
  const at = (iso: string) => new Date(iso);
  const up = { status: 'upcoming' as const, starts_at: '2027-02-08T03:01:00Z', ends_at: '2027-03-01T02:59:00Z' };
  assert.equal(dateStatus(up, at('2027-02-08T03:00:59.999Z')), null);
  assert.equal(dateStatus(up, at('2027-02-08T03:01:00Z')), 'active');
  assert.equal(dateStatus(up, at('2027-03-01T02:59:00Z')), 'closed');
  assert.equal(dateStatus({ ...up, status: 'active' }, at('2027-02-10T00:00:00Z')), null);
  assert.equal(dateStatus({ ...up, status: 'active' }, at('2027-03-01T02:59:00Z')), 'closed');
  assert.equal(dateStatus({ ...up, status: 'closed' }, at('2027-03-02T00:00:00Z')), null);
  assert.equal(dateStatus({ status: 'upcoming', starts_at: null, ends_at: null }, at('2030-01-01T00:00:00Z')), null);
});

test('L30-1: two upcoming fixtures: one opens at starts_at, the other closes at ends_at, each with a status change row', async () => {
  const opens = programFixture({ id: 'h-up-open', status: 'upcoming', opens_note: 'Opens Dec 1.', starts_at: '2026-12-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' });
  const ends = programFixture({ id: 'h-up-end', status: 'upcoming', opens_note: 'Paused.', ends_at: '2026-12-01T00:00:00Z', submission_requirements: [] });
  await upsertProgram(opens, 'file', D1);
  await upsertProgram(ends, 'file', D1);
  await only('h-up-open', 'h-up-end');
  const before = new Date('2026-11-30T23:59:59.999Z');
  const r0 = await runHealth(before, { link: ok });
  assert.deepEqual([r0.opened, r0.closed], [[], []]);
  const at = new Date('2026-12-01T00:00:00Z');
  const r = await runHealth(at, { link: ok });
  assert.deepEqual(r.opened, ['h-up-open']);
  assert.deepEqual(r.closed, ['h-up-end']);
  assert.equal(await statusOf('h-up-open'), 'active');
  assert.equal(await statusOf('h-up-end'), 'closed');
  for (const id of ['h-up-open', 'h-up-end'])
    assert.deepEqual((await sql()`SELECT fields FROM program_changes WHERE program_id = ${id}`).map((c) => c.fields), [['status']], id);
  const file = (await sql()`SELECT file FROM programs WHERE id = 'h-up-open'`)[0]!.file as { opens_note?: string; status: string };
  assert.equal(file.status, 'active');
  assert.equal(file.opens_note, undefined);
  // A rerun the same moment changes nothing.
  const again = await runHealth(at, { link: ok });
  assert.deepEqual([again.opened, again.closed], [[], []]);
  assert.equal((await sql()`SELECT 1 FROM program_changes WHERE program_id = ANY(${['h-up-open', 'h-up-end']})`).length, 2);
});

test('L30-1: nlnet-open-call closes at its deadline (Jan 3, 12:00 CET); arbitrum-open-house-sao-paulo waits for its requirements at its start and closes at its end', async () => {
  const nlnet = catalog('nlnet-open-call');
  const arb = catalog('arbitrum-open-house-sao-paulo');
  await sql()`DELETE FROM programs WHERE id = ANY(${[nlnet.id, arb.id]})`;
  assert.equal(nlnet.ends_at, '2027-01-03T12:00:00+01:00');
  assert.deepEqual([arb.starts_at, arb.ends_at], ['2027-02-08T03:01:00Z', '2027-03-01T02:59:00Z']);
  await upsertProgram(nlnet, 'file', D1);
  await upsertProgram(arb, 'file', D1);
  await only(nlnet.id, arb.id);
  const run = (iso: string) => runHealth(new Date(iso), { link: ok });

  assert.deepEqual((await run('2027-01-03T10:59:59Z')).closed, []);
  assert.equal(await statusOf(nlnet.id), 'upcoming');
  assert.deepEqual((await run('2027-01-03T11:00:00Z')).closed, [nlnet.id]);
  assert.equal(await statusOf(nlnet.id), 'closed');
  assert.ok(!(await listListedPrograms(new Date('2027-01-04T00:00:00Z'))).some((x) => x.id === nlnet.id));

  assert.deepEqual((await run('2027-02-08T03:00:59Z')).failed, []);
  // At its start it has no requirements yet: it stays upcoming and the owner hears, every run, until the file has them.
  const start = await run('2027-02-08T03:01:00Z');
  assert.deepEqual(start.opened, []);
  assert.deepEqual(start.failed, []);
  assert.deepEqual(start.unreadable, [{ id: arb.id, fix: UNREADABLE_FIX.noForm }]);
  assert.equal(await statusOf(arb.id), 'upcoming');
  const end = await run('2027-03-01T02:59:00Z');
  assert.deepEqual([end.closed, end.failed, end.unreadable], [[arb.id], [], []]);
  assert.equal(await statusOf(arb.id), 'closed');

  // With its requirements published, it opens at its start.
  await sql()`DELETE FROM programs WHERE id = ${arb.id}`;
  await upsertProgram({ ...arb, submission_requirements: programFixture({ id: 'x' }).submission_requirements }, 'file', D1);
  const opened = await run('2027-02-09T00:00:00Z');
  assert.deepEqual([opened.opened, opened.failed], [[arb.id], []]);
  assert.equal(await statusOf(arb.id), 'active');
});

// --- L30-3 and the budget.

test('L30-3: a refused health write is listed in failed with the id, and the program still closes', async () => {
  for (const id of ['h-w1', 'h-w2', 'h-w3'])
    await upsertProgram(programFixture({ id, ends_at: '2026-11-04T06:00:00Z' }), 'file', D1);
  await only('h-w1', 'h-w2', 'h-w3');
  await sql().unsafe(`CREATE OR REPLACE FUNCTION h_refuse() RETURNS trigger AS $$ BEGIN
    IF NEW.program_id = 'h-w2' THEN RAISE EXCEPTION 'refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await sql().unsafe(`CREATE TRIGGER h_refuse BEFORE INSERT OR UPDATE ON program_health FOR EACH ROW EXECUTE FUNCTION h_refuse()`);
  const was = console.error;
  console.error = () => {};
  try {
    const r = await runHealth(D1, { link: ok });
    assert.deepEqual(r.closed, ['h-w1', 'h-w2', 'h-w3']);
    assert.equal(r.checked, 2);
    assert.deepEqual(r.failed.map((f) => [f.id, f.step]), [['h-w2', 'health']]);
    assert.equal(r.failed[0].error, 'db');
  } finally {
    console.error = was;
    await sql().unsafe('DROP TRIGGER h_refuse ON program_health');
  }
  assert.equal(await statusOf('h-w2'), 'closed');
});

test('budget: 52 programs whose links answer in 7.9 s (scaled 1:100) take about 6 rounds of 10 at once, never one by one', async () => {
  const ids = Array.from({ length: 52 }, (_, i) => `h-par-${String(i).padStart(2, '0')}`);
  for (const id of ids) await upsertProgram(programFixture({ id, source_url: `https://${id}.example/a`, submission_url: `https://${id}.example/b` }), 'file', D1);
  await only(...ids);
  let inFlight = 0;
  let most = 0;
  const slow: LinkCheck = async (u) => {
    const src = u.endsWith('/a');
    if (src) most = Math.max(most, ++inFlight);
    await new Promise((r) => setTimeout(r, 79));
    if (src) inFlight--;
    return { ok: true, page: '<p>x</p>' };
  };
  const t0 = Date.now();
  const r = await runHealth(D1, { link: slow, probeMs: 80 });
  const took = Date.now() - t0;
  assert.equal(r.checked, 52);
  assert.equal(most, 10);
  // 6 rounds of 79 ms is 474 ms (47 s at full scale); one by one, two links each, it would be over 8 s.
  assert.ok(took < 1_500, `took ${took} ms`);
});

test('budget: no probe starts that could not finish before the deadline; the dates still apply to every row', async () => {
  const ids = ['h-dl-1', 'h-dl-2', 'h-dl-3'];
  for (const id of ids) await upsertProgram(programFixture({ id, ends_at: '2026-11-04T06:00:00Z' }), 'file', D1);
  await only(...ids);
  let t = 0;
  let probes = 0;
  const r = await runHealth(D1, { link: async () => (probes++, { ok: true }), clock: () => t, deadline: 7_999, parallel: 1 });
  assert.equal(probes, 0);
  assert.equal(r.checked, 0);
  assert.deepEqual(r.closed, ids);
  t = 0;
  const r2 = await runHealth(D1, { link: async () => (probes++, { ok: true }), clock: () => t, deadline: 8_000, parallel: 1 });
  assert.equal(r2.checked, 0); // all three closed already: nothing listed
});

test('L30-18, L35-18: a stored row whose file no longer parses, and an upcoming program at its start with no form, are unreadable with their fix, never failed', async () => {
  await upsertProgram(programFixture({ id: 'h-parse' }), 'file', D1);
  await upsertProgram(programFixture({ id: 'h-cat', status: 'upcoming', opens_note: 'Opens Nov 1.', starts_at: '2026-11-01T00:00:00Z', submission_requirements: [] }), 'file', D1);
  await only('h-parse', 'h-cat');
  await sql()`UPDATE programs SET file = jsonb_set(file, '{title}', '7'::jsonb) WHERE id = 'h-parse'`;
  const logged: string[] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  let r;
  try {
    r = await runHealth(D1, { link: ok });
  } finally {
    console.error = was;
  }
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.unreadable, [
    { id: 'h-cat', fix: 'its start date passed but it has no form questions, so it stays upcoming; add them.' },
    { id: 'h-parse', fix: 'its saved entry no longer reads, so it is not checked; correct the entry.' },
  ]);
  for (const f of Object.values(UNREADABLE_FIX)) assert.match(f, /^[a-z][^—]*\.$/);
  assert.equal(await statusOf('h-cat'), 'upcoming');
  assert.ok(logged.includes('[health] h-parse unreadable: the program file does not parse'));
  assert.ok(logged.includes('[health] h-cat unreadable: opens today but has no submission requirements'));
});

test('L39-5 (v6.1.18): formSaysClosed reads the four closed phrases in any case; a submission page saying one is alive but submit_closed', async () => {
  const { formSaysClosed } = await import('./health');
  for (const t of ['Round 2 of Builder Grant Program is now closed.', 'APPLICATIONS ARE CLOSED', 'We are no longer accepting responses', 'This hackathon is Closed for Submissions.'])
    assert.equal(formSaysClosed(t), true, t);
  for (const t of ['Applications are open until Dec 1.', 'Closed Grant', 'Doors closed at 5 pm', ''])
    assert.equal(formSaysClosed(t), false, t);
  const p = programFixture({ id: 'h-shut', source_url: 'https://shut.example/a', submission_url: 'https://shut.example/form' });
  const page = (u: string) => (u.endsWith('/form') ? '<div>This form is no longer accepting responses.</div>' : '<p>Grants for builders.</p>');
  const h = await probeProgram(p, { link: async (u) => ({ ok: true, page: page(u) }), now: D1 });
  assert.equal(h.submit_ok, true);
  assert.equal(h.submit_closed, true);
  // The source page saying it does not count when the form is its own link.
  const h2 = await probeProgram(p, { link: async (u) => ({ ok: true, page: u.endsWith('/form') ? '<p>Apply</p>' : '<p>Round 1 is now closed.</p>' }), now: D1 });
  assert.equal(h2.submit_closed, false);
  // One link for both: its page is the form.
  const same = programFixture({ id: 'h-shut1', source_url: 'https://shut.example/form', submission_url: 'https://shut.example/form' });
  assert.equal((await probeProgram(same, { link: async (u) => ({ ok: true, page: page(u) }), now: D1 })).submit_closed, true);
  // Fix round 1: a redirect elsewhere is read by its own path (`landing`) and judged on the page it lands on.
  const away = { link: async (): Promise<ProbeResult> => ({ ok: true, redirect: 'docs.google.com' }), now: D1 };
  const landed = await probeProgram(p, { ...away, landing: async () => '<div>Round 2 is now closed.</div>' });
  assert.deepEqual([landed.submit_ok, landed.submit_closed, landed.redirects], [true, true, ['docs.google.com']]);
  assert.equal((await probeProgram(p, { ...away, landing: async () => '<p>Apply here.</p>' })).submit_closed, false);
  assert.equal((await probeProgram(p, { ...away, landing: async () => null })).submit_closed, false);
  // Stored by the walk, never stale.
  await upsertProgram(p, 'file', D1);
  await only('h-shut');
  const r = await runHealth(D1, { link: async (u) => ({ ok: true, page: page(u) }) });
  assert.deepEqual(r.stale, []);
  assert.equal((await row('h-shut')).submit_closed, true);
  await runHealth(D2, { link: ok });
  assert.equal((await row('h-shut')).submit_closed, false);
});

// v6.1.18 fix round 1 (L39-5): the closed-form read follows up to 3 https redirects on any host, each hop guarded.
const FORM_CLOSED = '<html><div>Round 2 of Builder Grant Program is now closed. Please look out on X.</div></html>';
/** forms.gle-style hops: `hops` maps a URL to its Location; anything else answers `page`. Hosts in `inside` resolve private. */
function hopSite(hops: Record<string, string>, page: string, inside: string[] = []) {
  const site = cimdFixture((u) => (hops[u.href] ? { status: 302, location: hops[u.href], body: '' } : { status: 200, contentType: 'text/html', body: page }));
  const resolve: typeof site.resolve = async (host, signal) => (inside.includes(host) ? [{ address: '10.0.0.5', family: 4 }] : site.resolve(host, signal));
  return { ...site, resolve };
}
const formProgram = (id: string, submission_url: string) => programFixture({ id, source_url: 'https://about.example/grants', submission_url });

test('L39-5 fix round 1: a forms.gle-style redirect to another host whose page says now closed is submit_closed; the link stays ok with its redirect', async () => {
  const site = hopSite({ 'https://forms.gle/abc': 'https://docs.google.com/forms/d/e/x/viewform' }, FORM_CLOSED);
  const h = await probeProgram(formProgram('h-gle', 'https://forms.gle/abc'), { resolve: site.resolve, transport: site.transport, now: D1 });
  assert.deepEqual([h.submit_ok, h.submit_closed, h.redirects], [true, true, ['docs.google.com']]);
  // The same chain to an open form is not flagged.
  const open = hopSite({ 'https://forms.gle/abc': 'https://docs.google.com/forms/d/e/x/viewform' }, '<p>Apply here.</p>');
  assert.equal((await probeProgram(formProgram('h-gle2', 'https://forms.gle/abc'), { resolve: open.resolve, transport: open.transport, now: D1 })).submit_closed, false);
});

test('L39-5 fix round 1: an http hop, a 4th redirect and a private address are not read; 3 redirects are', async () => {
  const run = async (hops: Record<string, string>, inside: string[] = []) => {
    const site = hopSite(hops, FORM_CLOSED, inside);
    const h = await probeProgram(formProgram('h-hops', 'https://a.example/1'), { resolve: site.resolve, transport: site.transport, now: D1 });
    return { h, site };
  };
  const http = await run({ 'https://a.example/1': 'http://b.example/form' });
  assert.deepEqual([http.h.submit_ok, http.h.submit_closed], [true, false]);
  assert.ok(!http.site.requests.some((u) => u.startsWith('http:')));
  const three = await run({ 'https://a.example/1': 'https://b.example/2', 'https://b.example/2': 'https://c.example/3', 'https://c.example/3': 'https://d.example/form' });
  assert.equal(three.h.submit_closed, true);
  const four = await run({ 'https://a.example/1': 'https://b.example/2', 'https://b.example/2': 'https://c.example/3', 'https://c.example/3': 'https://d.example/4', 'https://d.example/4': 'https://e.example/form' });
  assert.equal(four.h.submit_closed, false);
  assert.ok(!four.site.requests.includes('https://e.example/form'));
  const priv = await run({ 'https://a.example/1': 'https://inside.example/form' }, ['inside.example']);
  assert.deepEqual([priv.h.submit_ok, priv.h.submit_closed], [true, false]);
  assert.ok(!priv.site.requests.includes('https://inside.example/form'));
});
