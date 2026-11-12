import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FIELD, MANIFEST_NOTE, manifestStep, manifestUrl, PLAN_STEP_USD, planAmount, wantsManifest } from './funding-manifest';
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
  // Final fix (I3): the name and email are always the builder's to confirm, filled or not.
  assert.deepEqual(step.fill, ['entity.name', 'entity.email']);
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

test('M6: planAmount rounds to $25,000 multiples within the ceiling', () => {
  const rec = (max_ask_usd: number) => ({ record: mergeRecord(EMPTY_RECORD, { policy: { max_ask_usd } }, 'builder', NOW).record, projectId: null, verifiedUsage: null });
  assert.deepEqual([floss.min_award_usd, floss.max_award_usd], [10_000, 100_000]);
  assert.equal(PLAN_STEP_USD, 25_000);
  assert.equal(planAmount(floss, rec(10_000)), 10_000);
  assert.equal(planAmount(floss, rec(12_000)), 25_000);
  assert.equal(planAmount(floss, rec(60_000)), 75_000);
  assert.equal(planAmount(floss, rec(100_000)), 100_000);
  assert.equal(planAmount(floss, rec(150_000)), 100_000);
  // A ceiling that is not a multiple: the largest multiple within it, never above.
  assert.equal(planAmount({ ...floss, max_award_usd: 90_000 }, rec(80_000)), 75_000);
});

test('Task 11 fix round 1 (I2, I3, M5, M8): the amount starts from the record within the award range; the builder may change it; no floor, no step', () => {
  const rec = (max_ask_usd?: number) => ({ record: mergeRecord(EMPTY_RECORD, max_ask_usd === undefined ? {} : { policy: { max_ask_usd } }, 'builder', NOW).record, projectId: null, verifiedUsage: null });
  assert.equal(planAmount(floss, null), 10_000);
  assert.equal(planAmount(floss, rec()), 10_000);
  assert.equal(planAmount(floss, rec(35_000)), 50_000);
  assert.equal(planAmount(floss, rec(2_000)), 10_000);
  assert.equal(planAmount(floss, rec(500_000)), 100_000);
  assert.equal(manifestStep(floss, READ, rec(35_000))!.files[0].json.funding.plans[0].amount, 50_000);
  assert.equal(manifestStep(floss, READ, null)!.files[0].json.funding.plans[0].amount, 10_000);
  // No award floor: no step, never the spec's "any amount" 0.
  assert.equal(planAmount({ ...floss, min_award_usd: undefined }, null), null);
  assert.equal(manifestStep({ ...floss, min_award_usd: undefined }, READ, null), null);
  // The version agrees with the schema.
  const m = manifestStep(floss, READ, null)!.files[0].json;
  assert.deepEqual([m.$schema, m.version], ['https://fundingjson.org/schema/v1.1.0.json', 'v1.1.0']);
  // The note: a starting amount and frequency the builder can change before the file is written, never their fact.
  assert.equal(MANIFEST_NOTE,
    'On yes, for a ready program with agent_step funding_manifest: write agent_step.files at those paths from the repo root ' +
    '(funding.json as the JSON, then the .well-known file), filling each null path in agent_step.fill from your sources (git config, ' +
    'the README, the GitHub profile; licenses as spdx:<id>, tags lower-case with dashes) or by asking the builder once, never ' +
    'inventing. The file is public: before writing it, tell the builder it names them as entity.name with the email ' +
    'entity.email (agent_step.fill always lists both) and let them change either. The plan\'s amount and yearly frequency ' +
    'are a starting value: before writing the file, tell the builder what it asks and let them change either; never ' +
    'present the amount as a fact about the builder. Commit and push, call track started for the ' +
    'program, then call find with its program_id: once the file is in the repo, funding_json_url carries agent_step.url to send.');
});
