import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FIELD, manifestStep, manifestUrl, wantsManifest } from './funding-manifest';
import { ProgramFile } from './program-file';
import type { RepoFacts } from './repo-facts';
import { EMPTY_RECORD, mergeRecord } from '../v6/record';

const NOW = new Date('2026-11-04T12:00:00Z');
const floss = ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/floss-fund-zerodha.json'), 'utf8')));
const READ: RepoFacts = {
  name: 'Quill', description: 'A Markdown editor.', repo_url: 'https://github.com/Acme/Quill', repo_url_basis: 'code', live_url_basis: null, demo_url_basis: null,
  public: true, as_reported: false, live_url: null, demo_url: null, chains: [], contracts: [], builder_codes: false, integrations: [], users: true,
  first_commit_at: null, last_commit_at: null, readme_excerpt: null, homepage: null, license: 'Apache-2.0', topics: ['markdown', 'Editor!', 'desktop-app'],
};

test('L38-1 (v6.1.18 Task 11): the manifest step is built from the record and the read, nulls named, never invented', () => {
  assert.equal(wantsManifest(floss), true);
  assert.ok(floss.submission_requirements.some((r) => r.key === MANIFEST_FIELD));
  assert.deepEqual(floss.setup, []);
  assert.equal(manifestUrl('https://github.com/Acme/Quill.git'), 'https://raw.githubusercontent.com/Acme/Quill/HEAD/funding.json');
  assert.equal(manifestUrl('https://gitlab.com/acme/quill'), null);
  const record = mergeRecord(EMPTY_RECORD, { person: { name: 'Ada Lovelace', email: 'ada@example.com' } }, 'builder', NOW).record;
  const step = manifestStep(floss, READ, { record, projectId: null, verifiedUsage: null })!;
  const m = step.files[0].json;
  assert.deepEqual([m.entity.type, m.entity.name, m.entity.email, m.entity.description], ['individual', 'Ada Lovelace', 'ada@example.com', 'Maintainer of Quill.']);
  assert.deepEqual([m.projects[0].guid, m.projects[0].licenses, m.projects[0].tags], ['quill', ['spdx:Apache-2.0'], ['markdown', 'desktop-app']]);
  assert.deepEqual(m.funding.plans[0].amount, 10_000);
  assert.deepEqual(step.fill, []);
  // A company in the record is the entity.
  const org = mergeRecord(record, { company: { name: 'Acme Labs' } }, 'builder', NOW).record;
  const o = manifestStep(floss, READ, { record: org, projectId: null, verifiedUsage: null })!.files[0].json.entity;
  assert.deepEqual([o.type, o.name, o.description], ['organisation', 'Acme Labs', 'The team behind Quill.']);
  // No step: the file is already in the repo, the repo was not read, or it is not on GitHub.
  assert.equal(manifestStep(floss, { ...READ, funding_json_url: 'https://raw.githubusercontent.com/Acme/Quill/HEAD/funding.json' }, null), null);
  assert.equal(manifestStep(floss, { ...READ, as_reported: true }, null), null);
  assert.equal(manifestStep(floss, { ...READ, repo_url: 'https://gitlab.com/acme/quill' }, null), null);
  // An unrecognized license is not written: the agent fills it.
  assert.ok(manifestStep(floss, { ...READ, license: 'NOASSERTION' }, null)!.fill.includes('projects[0].licenses'));
});
