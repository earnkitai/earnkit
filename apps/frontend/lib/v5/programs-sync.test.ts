import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from './db';
import { getProgram } from './programs';
import { programFixture } from './fixtures/program';
import { readProgramFiles, syncFiles } from './programs-sync';

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
