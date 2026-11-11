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

test('FR-6 (v6.1.15): rules and eligibility notes in K or M are refused; the catalog\'s rules are in full figures', () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  assert.deepEqual(programProblems(programFixture({ id: 'p-rule-k', rules: ['Deal: up to $1M on a SAFE.'] }), NOW), ['rules.0: money must be in full figures ("$100,000", never "$100K")']);
  assert.deepEqual(programProblems(programFixture({ id: 'p-note-k', eligibility: [{ kind: 'users', note: 'at least $1M in balances' }] }), NOW), ['eligibility.0.note: money must be in full figures ("$100,000", never "$100K")']);
  assert.deepEqual(programProblems(programFixture({ id: 'p-rule-full', rules: ['Deal: up to $1,000,000 on a SAFE.'] }), NOW), []);
});

test('L21-2 (v6.1.16): a closed program carries no open-window sentence; the same file active passes', () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  const rules = ['Applications are open until Dec 6.', 'Winners are named in January.'];
  assert.deepEqual(programProblems(programFixture({ id: 'p-closed-open', status: 'closed', summary: 'Up to $5,000', rules }), NOW), [
    'status: a closed program carries no open-window sentence: "Applications are open until Dec 6."',
  ]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-active-open', status: 'active', rules }), NOW), []);
  assert.deepEqual(
    programProblems(programFixture({ id: 'p-closed-desc', status: 'closed', summary: 'Up to $5,000', description: 'A grant. Apply now on the portal.' }), NOW),
    ['status: a closed program carries no open-window sentence: "Apply now on the portal."'],
  );
  assert.deepEqual(programProblems(programFixture({ id: 'p-closed-past', status: 'closed', summary: 'Up to $5,000', rules: ['SR008 applications ran October 12 to November 1, 2026, 11:59 PM PT.'] }), NOW), []);
});

test('fix round 1 (v6.1.16): a closed program carries no present rolling sentence and no rolling summary; the past passes', () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  const rules = ['Rolling: proposals are reviewed on a rolling basis and there is no fixed deadline.'];
  assert.deepEqual(programProblems(programFixture({ id: 'p-closed-rolling', status: 'closed', summary: 'Up to $5,000', rules }), NOW), [
    'status: a closed program carries no rolling-window sentence: "Rolling: proposals are reviewed on a rolling basis and there is no fixed deadline."',
  ]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-closed-nofixed', status: 'closed', summary: 'Up to $5,000', description: 'A grant. There is no fixed deadline.' }), NOW), [
    'status: a closed program carries no rolling-window sentence: "There is no fixed deadline."',
  ]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-active-rolling', status: 'active', rules }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-closed-past', status: 'closed', summary: 'Up to $5,000', rules: ['Proposals were reviewed on a rolling basis, with no fixed deadline.'] }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-closed-summary', status: 'closed', summary: 'Up to $5,000 · rolling' }), NOW), ['summary: a closed program is not rolling']);
});

test('L1h-1 (v6.1.16): K or M in a description, reward, past round or todo is refused (any case); a requirement label is the program\'s own', async () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  const msg = (path: string) => `${path}: money must be in full figures ("$100,000", never "$100K")`;
  const round = { label: 'Round one: $325k to 9 projects', source_url: 'https://example.org/r' };
  assert.deepEqual(programProblems(programFixture({ id: 'p-d', description: 'Invests $100K per team.' }), NOW), [msg('description')]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-r', reward: 'Up to 2M ARB' }), NOW), [msg('reward')]);
  assert.deepEqual(programProblems(programFixture({ id: 'p-p', past_rounds: [round] }), NOW), [msg('past_rounds.0.label')]);
  const req = { key: 'path', label: 'What is the path to $10M?', type: 'text', required: true, from: 'builder', kind: 'what_next', todo: 'your path to $10M' } as const;
  assert.deepEqual(programProblems(programFixture({ id: 'p-t', submission_requirements: [req] }), NOW), [msg('submission_requirements.0.todo')]);
  // The program's own question keeps its wording.
  assert.deepEqual(programProblems(programFixture({ id: 'p-l', submission_requirements: [{ ...req, todo: 'your path to $10,000,000' }] }), NOW), []);
  // The whole catalog passes.
  const { readProgramFiles } = await import('./programs-sync');
  const { findProgramsDir } = await import('./programs-api');
  assert.deepEqual(readProgramFiles(findProgramsDir()!, NOW).invalid, []);
});
