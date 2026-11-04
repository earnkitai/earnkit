import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { evaluate } from './eligibility';
import { repoFacts, type RepoFacts } from './repo-facts';
import { parseProject } from './project-input';
import { ProgramFile } from './program-file';
import type { ProgramRow } from './programs';
import { replayFetch } from './fixtures/github';
import { programFixture } from './fixtures/program';

after(() => sql().end());
beforeEach(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const toRow = (file: ProgramRow['file']): ProgramRow => ({
  id: file.id, file, source: 'file', created_at: NOW, updated_at: NOW, verified_at: null, stale_since: null,
});
const fromFile = (slug: string) =>
  toRow(ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', `${slug}.json`), 'utf8'))));

async function factsOf(slug: string, over: Record<string, unknown> = {}): Promise<RepoFacts> {
  const rec = replayFetch(slug);
  const r = parseProject({ name: 'App', description: 'An app.', repo_url: `https://github.com/${rec.repo}`, ...over });
  assert.ok(r.ok);
  return repoFacts(r.project, { gh: rec.fetch, now: NOW });
}

test('EarnKit vs Base: ready with builder codes and users, else the builder codes gap', async () => {
  const base = fromFile('base-builder-grants');
  const ready = evaluate(base, await factsOf('earnkit', { live_url: 'https://earnkit.com', builder_codes: true, users: true }), new Set(), NOW);
  assert.equal(ready.status, 'ready');
  const v = evaluate(base, await factsOf('earnkit', { live_url: 'https://earnkit.com', users: true }), new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.equal(v.gaps.length, 1);
  assert.equal(v.gaps[0].kind, 'builder_codes');
  assert.equal(v.gaps[0].agent_can, true);
  assert.equal(v.gaps[0].effort, 'minutes');
  assert.equal(v.gaps[0].what, 'add Base Builder Codes to the app');
});

test('EarnKit vs Circle: deploy the contract on Arc', async () => {
  const v = evaluate(fromFile('circle-developer-grants'), await factsOf('earnkit', { live_url: 'https://earnkit.com' }), new Set(), NOW);
  assert.equal(v.status, 'gap');
  const g = v.gaps.find((x) => x.kind === 'chain');
  assert.ok(g);
  assert.equal(g.what, 'deploy the contract on Arc');
  assert.equal(g.details?.chain, 'arc');
  assert.equal(g.details?.rpc, 'https://rpc.mainnet.arc.io');
});

test('a Solana repo does not meet a Base chain item', async () => {
  const p = toRow(programFixture({ id: 'p', chain_required: true, tag: undefined }));
  const v = evaluate(p, await factsOf('saber-distributor'), new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.equal(v.gaps[0].kind, 'chain');
});

test('the no-chain app vs a chain_required Base program is a gap', async () => {
  const v = evaluate(toRow(programFixture({ id: 'p', chain_required: true })), await factsOf('nextjs-dashboard'), new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.equal(v.gaps[0].what, 'deploy the contract on Base');
});

test('the Base app meets a chain_required Base program', async () => {
  const v = evaluate(toRow(programFixture({ id: 'p', chain_required: true })), await factsOf('onchain-reaction'), new Set(), NOW);
  assert.equal(v.status, 'ready');
});

test('any one of several chains satisfies', async () => {
  const p = toRow(programFixture({ id: 'p', chain_required: true, chains: ['arc', 'base'] }));
  assert.equal(evaluate(p, await factsOf('onchain-reaction'), new Set(), NOW).status, 'ready');
});

test('reported-only project matches', async () => {
  const f = await factsOf('earnkit', { private: true, chains: [{ chain: 'base', mainnet: true }] });
  assert.equal(f.public, false);
  assert.equal(evaluate(toRow(programFixture({ id: 'p', chain_required: true })), f, new Set(), NOW).status, 'ready');
});

test('closed by deadline is never ready', async () => {
  const p = toRow(programFixture({ id: 'p', ends_at: '2026-11-03T12:00:00Z' }));
  assert.equal(evaluate(p, await factsOf('onchain-reaction'), new Set(), NOW).status, 'no');
});

test('new work only with a first commit before the start is no', async () => {
  const p = toRow(programFixture({ id: 'p', existing_work: 'new_work_only', starts_at: '2030-01-01T00:00:00Z' }));
  const v = evaluate(p, await factsOf('earnkit'), new Set(), NOW);
  assert.equal(v.status, 'no');
  assert.equal(v.reason, 'needs work started after 2030-01-01');
});

test('in person stays ready with the reason', async () => {
  const v = evaluate(toRow(programFixture({ id: 'p', in_person: true })), await factsOf('earnkit'), new Set(), NOW);
  assert.equal(v.status, 'ready');
  assert.equal(v.reason, 'in person');
});

test('demo video and feature gaps clear with done; users is weeks and no', async () => {
  const p = toRow(programFixture({ id: 'p', eligibility: [{ kind: 'demo_video' }, { kind: 'feature', value: 'an AI agent' }] }));
  const f = await factsOf('earnkit');
  const v = evaluate(p, f, new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.deepEqual(v.gaps.map((g) => [g.item, g.agent_can]), [['demo_video', false], ['feature:an AI agent', false]]);
  assert.equal(evaluate(p, f, new Set(['demo_video', 'feature:an AI agent']), NOW).status, 'ready');
  const u = evaluate(toRow(programFixture({ id: 'q', eligibility: [{ kind: 'users' }] })), f, new Set(['users']), NOW);
  assert.equal(u.status, 'no');
  assert.equal(u.gaps[0].what, 'real users first');
});

test('verifiable kinds ignore done; three gaps is no', async () => {
  const p = toRow(programFixture({ id: 'p', eligibility: [{ kind: 'builder_codes' }, { kind: 'demo_video' }, { kind: 'feature', value: 'x y' }] }));
  const v = evaluate(p, await factsOf('earnkit'), new Set(['builder_codes']), NOW);
  assert.equal(v.status, 'no');
  assert.equal(v.gaps.length, 3);
});

test('long shot text', async () => {
  const f = await factsOf('earnkit');
  assert.equal(evaluate(toRow(programFixture({ id: 'p', tag: 'long shot' })), f, new Set(), NOW).long_shot, 'few prizes for many entries');
  assert.equal(evaluate(toRow(programFixture({ id: 'p', investment: true })), f, new Set(), NOW).long_shot, 'an investment program with no stated amount');
  assert.equal(evaluate(toRow(programFixture({ id: 'p' })), f, new Set(), NOW).long_shot, null);
});
