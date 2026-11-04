import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile, eligibilityOf } from './program-file';
import { programFixture } from './fixtures/program';

const DIR = join(import.meta.dirname, '..', '..', '..', '..', 'programs');
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, unknown>;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

test('every programs/*.json parses', () => {
  assert.ok(files.length > 0);
  for (const f of files) {
    const r = ProgramFile.safeParse(read(f));
    assert.ok(r.success, `${f}: ${r.success ? '' : JSON.stringify(r.error.issues)}`);
  }
});

test('an unknown chain fails; any_chain lists none', () => {
  const base = programFixture({ id: 'chain-test' });
  assert.equal(ProgramFile.safeParse({ ...base, chains: ['foo'] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, chains: ['solana'] }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, chains: [], any_chain: true }).success, true);
  assert.equal(ProgramFile.safeParse({ ...base, chains: [] }).success, false);
});

test('status unlisted fails', () => {
  const base = programFixture({ id: 'status-test' });
  assert.equal(ProgramFile.safeParse({ ...base, status: 'unlisted' }).success, false);
});

test('eligibilityOf base-builder-grants: its explicit four items', () => {
  const p = ProgramFile.parse(read('base-builder-grants.json'));
  assert.deepEqual(eligibilityOf(p), [{ kind: 'live_product' }, { kind: 'chain', value: 'base' }, { kind: 'builder_codes' }, { kind: 'users' }]);
});

test('eligibilityOf circle-developer-grants: derived, live product then chain arc', () => {
  const p = ProgramFile.parse(read('circle-developer-grants.json'));
  assert.equal(p.eligibility, undefined);
  assert.deepEqual(eligibilityOf(p), [{ kind: 'live_product' }, { kind: 'chain', value: 'arc' }]);
});

test('eligibilityOf: an explicit list wins; derived items for contract, new work and in person', () => {
  const explicit = programFixture({ id: 'e1', eligibility: [{ kind: 'users', note: '100 users' }] });
  assert.deepEqual(eligibilityOf(explicit), [{ kind: 'users', note: '100 users' }]);
  const derived = programFixture({
    id: 'e2',
    chains: ['arc'],
    needs_contract: 'arc',
    existing_work: 'new_work_only',
    starts_at: '2026-10-01T00:00:00Z',
    in_person: true,
  });
  assert.deepEqual(eligibilityOf(derived), [
    { kind: 'contract_on', value: 'arc' },
    { kind: 'new_work_after', value: '2026-10-01T00:00:00Z' },
    { kind: 'in_person' },
  ]);
});

test('a form.fields map round-trips', () => {
  const form = { platform: 'google' as const, url: 'https://docs.google.com/forms/d/e/x/viewform', fields: { project_name: 'entry.123' } };
  const p = programFixture({ id: 'form-test', form });
  assert.deepEqual(ProgramFile.parse(JSON.parse(JSON.stringify(p))).form, form);
  const bz = ProgramFile.parse(read('base-builder-grants.json'));
  assert.equal(bz.form?.platform, 'google');
  assert.equal(bz.form?.fields?.email, 'entry.567744978');
});

test('a required item without a todo, or any item without a kind, fails', () => {
  const base = programFixture({ id: 'req-test' });
  const [r] = base.submission_requirements;
  assert.equal(ProgramFile.safeParse({ ...base, submission_requirements: [{ ...r, todo: undefined }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, submission_requirements: [{ ...r, kind: undefined }] }).success, false);
  assert.equal(ProgramFile.safeParse({ ...base, submission_requirements: [{ ...r, required: false, todo: undefined }] }).success, true);
});

test('unknown keys are stripped', () => {
  const p = ProgramFile.parse({ ...programFixture({ id: 'strip-test' }), x_handles: ['base'], campaign: {} });
  assert.equal('x_handles' in p, false);
  assert.equal('campaign' in p, false);
});
