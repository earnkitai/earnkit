import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from './db';
import { getProgram } from './programs';
import { findProgramsDir } from './programs-api';
import { runHealth } from './health';
import { programFixture } from './fixtures/program';
import { readProgramFiles, syncFiles } from './programs-sync';
import { watchCatalogRevalidation } from './programs-read';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
function dirWith(...programs: ReturnType<typeof programFixture>[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ek-sync-'));
  for (const p of programs) writeFileSync(join(dir, `${p.id}.json`), JSON.stringify(p));
  return dir;
}

test('an active file past its ends_at is synced as closed with one warning; a live one stays active', async () => {
  const dir = dirWith(
    programFixture({ id: 's-expired', ends_at: '2026-11-02T07:59:59Z' }),
    programFixture({ id: 's-live', ends_at: '2026-12-01T00:00:00Z' }),
  );
  const r = await syncFiles(dir, NOW);
  assert.deepEqual(r.invalid, []);
  assert.deepEqual(r.warnings, ['Warning: s-expired.json is active but ends_at has passed; synced as closed. Set "status": "closed".']);
  assert.equal((await getProgram('s-expired'))!.file.status, 'closed');
  assert.equal((await getProgram('s-live'))!.file.status, 'active');
  // A second deploy does not reopen it.
  const again = await syncFiles(dir, new Date(NOW.getTime() + 86_400_000));
  assert.ok(again.written.includes('s-expired.json: unchanged'), again.written.join(', '));
  assert.equal((await getProgram('s-expired'))!.file.status, 'closed');
});

test('the check reads the same warning and still passes', () => {
  const r = readProgramFiles(dirWith(programFixture({ id: 's-check', ends_at: '2026-11-01T00:00:00Z' })), NOW);
  assert.deepEqual(r.invalid, []);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.programs[0].p.status, 'closed');
});

test('an invalid file writes nothing', async () => {
  const dir = dirWith(programFixture({ id: 's-ok' }));
  writeFileSync(join(dir, 's-bad.json'), '{');
  const r = await syncFiles(dir, NOW);
  assert.equal(r.invalid.length, 1);
  assert.deepEqual(r.written, []);
  assert.equal(await getProgram('s-ok'), null);
});

test('L21-16 (v6.1.16): the check refuses an in-person file without its city', () => {
  const r = readProgramFiles(dirWith(programFixture({ id: 's-ip', in_person: true }), programFixture({ id: 's-ip-city', in_person: true, city: 'Eugene' })), NOW);
  assert.deepEqual(r.invalid, ['s-ip.json is not valid:\n  - city: an in-person program names its city (from its description or rules)']);
  assert.deepEqual(r.programs.map((x) => x.f), ['s-ip-city.json']);
});

test('L22-13 (v6.1.16): a sync that writes expires every catalog surface once (revalidateCatalog)', async () => {
  let n = 0;
  watchCatalogRevalidation(() => n++);
  try {
    await syncFiles(dirWith(programFixture({ id: 's-reval', ends_at: '2026-12-01T00:00:00Z' })), NOW);
    assert.equal(n, 1);
  } finally {
    watchCatalogRevalidation(null);
  }
});

// v6.1.16 Task 16 fix round 1 (I1): the sync moves a file by the daily run's own date rule.
const catalogDir = (...ids: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'ek-sync-cat-'));
  for (const id of ids) copyFileSync(join(findProgramsDir()!, `${id}.json`), join(dir, `${id}.json`));
  return dir;
};
const NL = 'nlnet-open-call';
const AR = 'arbitrum-open-house-sao-paulo';
const statusAt = (iso: string) => {
  const r = readProgramFiles(catalogDir(NL, AR), new Date(iso));
  assert.deepEqual(r.invalid, []);
  return { s: Object.fromEntries(r.programs.map(({ p }) => [p.id, p.status])), r };
};

test('I1: through the file reader, nlnet-open-call closes after Jan 3; arbitrum-open-house-sao-paulo stays upcoming at its start (no requirements) and closes after Mar 1', () => {
  const before = statusAt('2027-01-03T10:59:59Z');
  assert.deepEqual(before.s, { [NL]: 'upcoming', [AR]: 'upcoming' });
  assert.deepEqual(before.r.warnings, []);
  const jan = statusAt('2027-01-04T00:00:00Z');
  assert.deepEqual(jan.s, { [NL]: 'closed', [AR]: 'upcoming' });
  assert.deepEqual(jan.r.warnings, [`Warning: ${NL}.json is upcoming but ends_at has passed; synced as closed. Set "status": "closed" and remove opens_note.`]);
  assert.equal(jan.r.programs.find(({ p }) => p.id === NL)!.p.opens_note, undefined);
  const feb = statusAt('2027-02-09T00:00:00Z');
  assert.deepEqual(feb.s, { [NL]: 'closed', [AR]: 'upcoming' });
  assert.ok(feb.r.warnings.includes(`Warning: ${AR}.json is upcoming and starts_at has passed, but it has no submission requirements; synced as upcoming. Add them.`));
  assert.deepEqual(statusAt('2027-03-02T00:00:00Z').s, { [NL]: 'closed', [AR]: 'closed' });
});

test('I1: an upcoming file past starts_at with requirements syncs as active, opens_note dropped', () => {
  const r = readProgramFiles(dirWith(programFixture({ id: 's-opens', status: 'upcoming', opens_note: 'Opens Nov 1.', starts_at: '2026-11-01T00:00:00Z' })), NOW);
  assert.equal(r.programs[0].p.status, 'active');
  assert.equal(r.programs[0].p.opens_note, undefined);
  assert.deepEqual(r.warnings, ['Warning: s-opens.json is upcoming but starts_at has passed; synced as active. Set "status": "active" and remove opens_note.']);
});

test('I1: a deploy after the run closed nlnet-open-call and opened a program answers unchanged and writes no change row', async () => {
  const dir = catalogDir(NL);
  writeFileSync(join(dir, 's-run-open.json'), JSON.stringify(programFixture({ id: 's-run-open', status: 'upcoming', opens_note: 'Opens Jan 2.', starts_at: '2027-01-02T00:00:00Z', ends_at: '2027-06-01T00:00:00Z' })));
  await sql()`DELETE FROM programs WHERE id = ANY(${[NL, 's-run-open']})`;
  await syncFiles(dir, new Date('2026-12-01T00:00:00Z'));
  await sql()`DELETE FROM programs WHERE NOT (id = ANY(${[NL, 's-run-open']}))`;
  const r = await runHealth(new Date('2027-01-03T11:00:00Z'), { link: async () => ({ ok: true }) });
  assert.deepEqual([r.closed, r.opened], [[NL], ['s-run-open']]);
  const rows = async () => (await sql()`SELECT count(*)::int AS n FROM program_changes WHERE program_id = ANY(${[NL, 's-run-open']})`)[0].n as number;
  const n = await rows();
  const again = await syncFiles(dir, new Date('2027-01-04T00:00:00Z'));
  assert.deepEqual(again.written.sort(), [`${NL}.json: unchanged`, 's-run-open.json: unchanged']);
  assert.equal(await rows(), n);
  assert.equal((await getProgram(NL))!.file.status, 'closed');
  assert.equal((await getProgram('s-run-open'))!.file.status, 'active');
});
