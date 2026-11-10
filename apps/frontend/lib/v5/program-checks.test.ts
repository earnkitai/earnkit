import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programProblems } from './program-checks';
import { programFixture } from './fixtures/program';

test('L1f-1 (v6.1.14): open_source needs a rule naming open source code, and defaults to false', () => {
  const NOW = new Date('2026-11-11T00:00:00Z');
  assert.equal(programFixture({ id: 'p-default' }).open_source, false);
  assert.deepEqual(programProblems(programFixture({ id: 'p-os', open_source: true, rules: ['The project must carry an OSI-approved open source license.'] }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-os-rule', open_source: true, eligibility: [{ kind: 'rule', note: 'code under a free/libre license' }] }), NOW), []);
  assert.deepEqual(programProblems(programFixture({ id: 'p-bare', open_source: true }), NOW), ['open_source: true needs a rule naming open source code or its license']);
});
