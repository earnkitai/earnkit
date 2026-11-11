import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programProblems } from './program-checks';
import { apiTextProblems } from './api-text';
import { programFixture } from './fixtures/program';

test('L1f-1 (v6.1.14): open_source needs a rule naming open source code, and defaults to false', () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  assert.equal(programFixture({ id: 'p-default' }).open_source, false);
  assert.deepEqual(programProblems(programFixture({ id: 'p-os', open_source: true, rules: ['The project must carry an OSI-approved open source license.'] }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-os-rule', open_source: true, eligibility: [{ kind: 'rule', note: 'code under a free/libre license' }] }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-bare', open_source: true }), NOW), ['open_source: true needs a rule naming open source code or its license']);
});

test('#12 (v6.1.15): a money line needs a number or "Amount not stated"; the whole catalog passes', async () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  assert.deepEqual(programProblems(programFixture({ id: 'p-words', summary: 'milestone grants · rolling' }), NOW), [
    'summary: the money "milestone grants" needs a number or "Amount not stated"',
  ]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-stated', summary: 'Milestone grants, amount not stated · rolling' }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-stated-cap', summary: 'Amount not stated, set by milestone budget · rolling' }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-number', summary: 'Up to 100% of the audit cost · rolling' }), NOW), []);
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ProgramFile } = await import('./program-file');
  const dir = join(import.meta.dirname, '../../../../programs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 52, `${files.length}`);
  for (const f of files) assert.deepEqual(programProblems(ProgramFile.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))), NOW), [], f);
});

test('lane 22 (v6.1.15 fix round 1, I1): a money line in K or M is refused; full figures pass', () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  const full = (piece: string) => `summary: the money "${piece}" must be in full figures ("$100,000", never "$100K" or "$1M")`;
  assert.deepEqual(programProblems(programFixture({ id: 'p-k', summary: '$500K investment · rolling' }), NOW), [full('$500K investment')]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-m', summary: 'up to $1M · rolling' }), NOW), [full('up to $1M')]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-arb', summary: 'Incentives, plus 200K ARB · rolling' }), NOW), [full('Incentives, plus 200K ARB')]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-full', summary: '$500,000 investment · rolling' }), NOW), []);
});

test('Task 1 N1 (v6.1.15 fix round 1, M3): the program write lints a requirement\'s need text', () => {
  const base = programFixture({ id: 'p-need' });
  const req = base.submission_requirements[0];
  assert.deepEqual(apiTextProblems({ ...base, submission_requirements: [{ ...req, need: 'Kiro write-up' }] }).filter((p) => p.includes('.need')), []);
  const bad = apiTextProblems({ ...base, submission_requirements: [{ ...req, need: 'Kiro\u202ewrite-up' }] });
  assert.ok(bad.some((p) => p.startsWith('submission_requirements.0.need:')), JSON.stringify(bad));
});
