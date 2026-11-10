import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('an app on another chain vs a chain_required Base program is a gap', async () => {
  const v = evaluate(toRow(programFixture({ id: 'p', chain_required: true })), await factsOf('nextjs-dashboard', { chains: [{ chain: 'arbitrum', mainnet: true }] }), new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.equal(v.gaps[0].what, 'deploy the contract on Base');
});

test('C54: a project with no chain reported and none in the code is not a fit for a chain or contract program, never a gap', async () => {
  const f = await factsOf('nextjs-dashboard');
  assert.deepEqual(f.chains, []);
  const chain = evaluate(toRow(programFixture({ id: 'p', chain_required: true, chains: ['arc'] })), f, new Set(), NOW);
  assert.deepEqual([chain.status, chain.gaps, chain.reason], ['no', [], 'needs a contract on Arc']);
  const contract = evaluate(toRow(programFixture({ id: 'q', eligibility: [{ kind: 'contract_on', value: 'base' }] })), f, new Set(), NOW);
  assert.deepEqual([contract.status, contract.reason], ['no', 'needs a contract on Base']);
  // A testnet chain is a chain: the gaps stay.
  const testnet = { ...f, chains: [{ chain: 'base', mainnet: false, basis: 'reported' as const }] };
  assert.equal(evaluate(toRow(programFixture({ id: 'p', chain_required: true, chains: ['arc'] })), testnet, new Set(), NOW).status, 'gap');
  // A program with no chain item is unchanged.
  assert.equal(evaluate(toRow(programFixture({ id: 'r' })), f, new Set(), NOW).status, 'ready');
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
});

test('users: not reported is a gap only the builder can answer; false is no; true or done clears it', async () => {
  const q = toRow(programFixture({ id: 'q', eligibility: [{ kind: 'users' }] }));
  const unknown = await factsOf('earnkit');
  assert.equal(unknown.users, null);
  const u = evaluate(q, unknown, new Set(), NOW);
  assert.equal(u.status, 'gap');
  assert.deepEqual(u.gaps, [{ kind: 'users', item: 'users', what: 'tell me if real people use it', effort: 'hours', agent_can: false }]);
  assert.equal(evaluate(q, unknown, new Set(['users']), NOW).status, 'ready');
  assert.equal(evaluate(q, await factsOf('earnkit', { users: true }), new Set(), NOW).status, 'ready');
  const no = evaluate(q, await factsOf('earnkit', { users: false }), new Set(), NOW);
  assert.equal(no.status, 'no');
  assert.equal(no.gaps[0].what, 'real users first');
  assert.equal(no.gaps[0].effort, 'weeks');
});

test('EarnKit vs Base with users not reported: one change away, the builder codes and the users question', async () => {
  const v = evaluate(fromFile('base-builder-grants'), await factsOf('earnkit', { live_url: 'https://earnkit.com' }), new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.deepEqual(v.gaps.map((g) => g.kind).sort(), ['builder_codes', 'users']);
});

test('verifiable kinds ignore done; three gaps is no', async () => {
  const p = toRow(programFixture({ id: 'p', eligibility: [{ kind: 'builder_codes' }, { kind: 'demo_video' }, { kind: 'feature', value: 'x y' }] }));
  const v = evaluate(p, await factsOf('earnkit'), new Set(['builder_codes']), NOW);
  assert.equal(v.status, 'no');
  assert.equal(v.gaps.length, 3);
});

test('long shot text', async () => {
  const f = await factsOf('earnkit');
  // 3.3 (v6.1.8): prizes only for a hackathon (a pool, or a reward in prizes); any other long shot is about selection.
  assert.equal(evaluate(toRow(programFixture({ id: 'p', tag: 'long shot' })), f, new Set(), NOW).long_shot, 'many apply, few are taken');
  assert.equal(evaluate(toRow(programFixture({ id: 'p', tag: 'long shot', reward: '$50,000 in prizes', summary: '$50,000 in prizes' })), f, new Set(), NOW).long_shot, 'few prizes for many entries');
  assert.equal(evaluate(toRow(programFixture({ id: 'p', tag: 'long shot', pool_usd: 20000, reward: '$20,000 in prizes' })), f, new Set(), NOW).long_shot, 'few prizes for many entries');
  assert.equal(evaluate(fromFile('thiel-fellowship'), f, new Set(), NOW).long_shot, 'many apply, few are taken');
  assert.equal(evaluate(fromFile('meta-vr-start-competition-2026'), f, new Set(), NOW).long_shot, 'few prizes for many entries');
  assert.equal(evaluate(toRow(programFixture({ id: 'p', investment: true })), f, new Set(), NOW).long_shot, 'an investment program with no stated amount');
  // R20 (v6.1.6): investment or in person, the odds are about selection, not prizes.
  assert.equal(evaluate(toRow(programFixture({ id: 'p', tag: 'long shot', investment: true, category: 'investment', max_award_usd: 500000 })), f, new Set(), NOW).long_shot, 'many apply, few are taken');
  assert.equal(evaluate(toRow(programFixture({ id: 'p', tag: 'long shot', in_person: true })), f, new Set(), NOW).long_shot, 'many apply, few are taken');
  assert.equal(evaluate(toRow(programFixture({ id: 'p' })), f, new Set(), NOW).long_shot, null);
});

test('done never clears chain, contract_on, builder_codes or live_product', async () => {
  const p = toRow(programFixture({ id: 'p', eligibility: [{ kind: 'chain', value: 'arc' }, { kind: 'contract_on', value: 'arc' }] }));
  const f = await factsOf('nextjs-dashboard', { chains: [{ chain: 'base', mainnet: true }] });
  assert.deepEqual(evaluate(p, f, new Set(['chain:arc', 'contract_on:arc']), NOW).gaps.map((g) => g.kind), ['chain', 'contract_on']);
  const q = toRow(programFixture({ id: 'q', eligibility: [{ kind: 'builder_codes' }, { kind: 'live_product' }] }));
  const noLive = { ...f, live_url: null };
  assert.deepEqual(evaluate(q, noLive, new Set(['builder_codes', 'live_product']), NOW).gaps.map((g) => g.kind), ['builder_codes', 'live_product']);
});

test('a testnet-only chain does not meet a Base chain_required program', async () => {
  const f = { ...(await factsOf('nextjs-dashboard')), chains: [{ chain: 'base', mainnet: false, basis: 'reported' as const }] };
  const v = evaluate(toRow(programFixture({ id: 'p', chain_required: true })), f, new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.equal(v.gaps[0].what, 'deploy the contract on Base');
});

test('two unmet chain items give one gap naming the first', async () => {
  const p = toRow(programFixture({ id: 'p', chain_required: true, chains: ['arc', 'base'] }));
  const v = evaluate(p, await factsOf('nextjs-dashboard', { chains: [{ chain: 'monad', mainnet: true }] }), new Set(), NOW);
  assert.equal(v.gaps.length, 1);
  assert.equal(v.gaps[0].item, 'chain:arc');
});

test('a contract counts only when its chain is also mainnet', async () => {
  const f = { ...(await factsOf('nextjs-dashboard')), contracts: [{ chain: 'base', address: `0x${'1'.repeat(40)}` }], chains: [{ chain: 'base', mainnet: false, basis: 'reported' as const }] };
  const p = toRow(programFixture({ id: 'p', eligibility: [{ kind: 'contract_on', value: 'base' }] }));
  assert.equal(evaluate(p, f, new Set(), NOW).status, 'gap');
  f.chains[0].mainnet = true;
  assert.equal(evaluate(p, f, new Set(), NOW).status, 'ready');
});

test('integration: met when the code uses it, else a days gap the agent can do with a docs link', async () => {
  const p = toRow(programFixture({ id: 'p-int', eligibility: [{ kind: 'integration', value: 'smart_wallet' }] }));
  const facts = await factsOf('earnkit', { live_url: 'https://earnkit.com' });
  assert.equal(evaluate(p, { ...facts, integrations: ['smart_wallet'] }, new Set(), NOW).status, 'ready');
  const v = evaluate(p, { ...facts, integrations: [] }, new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.deepEqual(v.gaps, [
    { kind: 'integration', item: 'integration:smart_wallet', what: 'add Smart Wallet', effort: 'days', agent_can: true, details: { docs: 'https://docs.base.org/smart-wallet' } },
  ]);
});

test('a rule is a confirmation gap: alone it is one answer away, confirmed once with its item (v6.1.6, R18a)', async () => {
  const f = await factsOf('earnkit');
  const note = 'a clear open source license on the repo';
  const p = toRow(programFixture({ id: 'p', tag: undefined, eligibility: [{ kind: 'rule', note }] }));
  const v = evaluate(p, f, new Set(), NOW);
  assert.equal(v.status, 'gap');
  const item = `rule:${createHash('sha256').update(note).digest('hex').slice(0, 8)}`;
  assert.deepEqual(v.gaps, [{ kind: 'rule', item, what: note, effort: 'hours', agent_can: false }]);
  assert.deepEqual(v.rules, [note]);
  const done = evaluate(p, f, new Set([item]), NOW);
  assert.equal(done.status, 'ready');
  assert.deepEqual(done.rules, [note]);
  assert.deepEqual(evaluate(toRow(programFixture({ id: 'p' })), f, new Set(), NOW).rules, []);
});

test('a rule beside a real gap: the real gap first, then the rule, in one gap verdict (v6.1.6)', async () => {
  const f = await factsOf('earnkit');
  const p = toRow(programFixture({ id: 'p', tag: undefined, eligibility: [{ kind: 'rule', note: 'y' }, { kind: 'demo_video' }, { kind: 'rule', note: 'x' }] }));
  const v = evaluate(p, f, new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.deepEqual(v.gaps.map((g) => [g.kind, g.what]), [['demo_video', 'a demo video'], ['rule', 'y'], ['rule', 'x']]);
  assert.deepEqual(v.rules, ['y', 'x']);
});

test('rules count toward neither the two-gap limit nor the weeks refusal (v6.1.6)', async () => {
  const f = await factsOf('earnkit');
  const three = toRow(programFixture({ id: 'p', tag: undefined, eligibility: [{ kind: 'rule', note: 'a' }, { kind: 'rule', note: 'b' }, { kind: 'rule', note: 'c' }, { kind: 'demo_video' }] }));
  const v = evaluate(three, f, new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.equal(v.gaps.length, 4);
  const real = toRow(programFixture({ id: 'p', tag: undefined, eligibility: [{ kind: 'rule', note: 'a' }, { kind: 'demo_video' }, { kind: 'feature', value: 'x y' }, { kind: 'builder_codes' }] }));
  assert.equal(evaluate(real, f, new Set(), NOW).status, 'no');
});

test('feature with a value still gaps (v6.1.6)', async () => {
  const v = evaluate(toRow(programFixture({ id: 'p', tag: undefined, eligibility: [{ kind: 'feature', value: 'an AI agent' }] })), await factsOf('earnkit'), new Set(), NOW);
  assert.equal(v.status, 'gap');
  assert.deepEqual(v.gaps.map((g) => g.item), ['feature:an AI agent']);
  assert.deepEqual(v.rules, []);
});

test('C1 (v6.1.8 final fix, B20b): a used bar on a chainless project is the users question, implied when the program has no users item', async () => {
  const p = toRow(programFixture({ id: 'p-used', min_tier: 'used', tag: undefined }));
  assert.ok(!(p.file.eligibility ?? []).some((i) => i.kind === 'users'));
  const chainless = { ...(await factsOf('nextjs-dashboard')), chains: [] };
  const ask = evaluate(p, chainless, new Set(), NOW);
  assert.equal(ask.status, 'gap');
  assert.deepEqual(ask.gaps.map((g) => [g.item, g.what]), [['users', 'tell me if real people use it']]);
  // Confirmed through track gap_done with item 'users', or users: true on the project.
  assert.equal(evaluate(p, chainless, new Set(['users']), NOW).status, 'ready');
  assert.equal(evaluate(p, { ...chainless, users: true }, new Set(), NOW).status, 'ready');
  // A project with a chain keeps the bar (find's tierGate), so no users question is added.
  const onBase = { ...chainless, chains: [{ chain: 'base', mainnet: true, basis: 'reported' as const }] };
  assert.equal(evaluate(p, onBase, new Set(), NOW).status, 'ready');
  // A live or building bar adds nothing.
  assert.equal(evaluate(toRow(programFixture({ id: 'p-live', min_tier: 'live', tag: undefined })), chainless, new Set(), NOW).status, 'ready');
});

test('B20c (v6.1.9, Review Focus 1): the users question needs a project that exists; a repo-less or empty project is not a fit for a used program', async () => {
  const floss = fromFile('floss-fund-zerodha');
  const usersOnly = toRow(programFixture({ id: 'p-users', tag: undefined, eligibility: [{ kind: 'users' }] }));
  const parsed = parseProject({ name: 'Rent Split', description: 'An idea: an app that splits rent.' });
  assert.ok(parsed.ok);
  const idea = await repoFacts(parsed.project, { now: NOW });
  const empty = await factsOf('empty-repo');
  assert.deepEqual(empty.notes, ['empty']);
  for (const facts of [idea, empty, { ...idea, users: true }, { ...empty, users: true }]) {
    for (const p of [floss, usersOnly]) {
      const v = evaluate(p, facts, new Set(['users']), NOW);
      assert.deepEqual([v.status, v.reason, v.gaps], ['no', 'needs a product people use', []], p.id);
    }
  }
  // A repo read with code, or a live link given, keeps the question.
  const code = { ...(await factsOf('nextjs-dashboard')), chains: [] };
  assert.deepEqual(evaluate(floss, code, new Set(), NOW).gaps.map((g) => g.what), ['tell me if real people use it']);
  const live = { ...idea, live_url: 'https://rentsplit.app' };
  assert.deepEqual(evaluate(floss, live, new Set(), NOW).gaps.map((g) => g.what), ['tell me if real people use it']);
  assert.equal(evaluate(floss, { ...empty, live_url: 'https://x.dev', users: true }, new Set(), NOW).status, 'ready');
  // A program that asks for no users is unchanged.
  assert.equal(evaluate(toRow(programFixture({ id: 'p-none', tag: undefined, eligibility: [] })), idea, new Set(), NOW).status, 'ready');
});
