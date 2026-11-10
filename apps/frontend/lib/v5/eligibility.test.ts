import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { codeChecked, evaluate, exists, keywordHit, lookedAgain, names, ruleItem, unlikely, type Gap } from './eligibility';
import { readmeExcerpt, repoFacts, type RepoFacts } from './repo-facts';
import { parseProject } from './project-input';
import { ProgramFile, eligibilityOf } from './program-file';
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
/** The keywords on a catalog file's rules. */
const eligibilityKeywords = (slug: string) => eligibilityOf(fromFile(slug).file).flatMap((i) => i.keywords ?? []);

async function factsOf(slug: string, over: Record<string, unknown> = {}): Promise<RepoFacts> {
  const rec = replayFetch(slug);
  const r = parseProject({ name: 'App', description: 'An app.', repo_url: `https://github.com/${rec.repo}`, ...over });
  assert.ok(r.ok);
  return repoFacts(r.project, { gh: rec.fetch, now: NOW });
}

test('EarnKit vs Base: ready with builder codes and users, else the builder codes gap', async () => {
  const base = fromFile('base-builder-grants');
  // The report stands where no repo was read (private); a public read that finds none beats it (v6.1.9).
  const ready = evaluate(base, await factsOf('earnkit', { live_url: 'https://earnkit.com', builder_codes: true, users: true, private: true, chains: [{ chain: 'base', mainnet: true, contract: '0x' + 'a'.repeat(40) }] }), new Set(), NOW);
  assert.equal(ready.status, 'ready', JSON.stringify(ready));
  const reported = evaluate(base, await factsOf('earnkit', { live_url: 'https://earnkit.com', builder_codes: true, users: true }), new Set(), NOW);
  assert.deepEqual([reported.status, reported.gaps[0]?.kind], ['gap', 'builder_codes']);
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

test('O3 (v6.1.10, Review Focus 4): no first-commit date asks when the work started, never a refusal; a date or the builder\'s word settles it', async () => {
  const p = toRow(programFixture({ id: 'p', existing_work: 'new_work_only', starts_at: '2026-10-01T00:00:00Z' }));
  const item = 'new_work_after:2026-10-01T00:00:00Z';
  const f = { ...(await factsOf('earnkit')), first_commit_at: null };
  const v = evaluate(p, f, new Set(), NOW);
  assert.equal(v.status, 'gap', JSON.stringify(v));
  assert.deepEqual(v.gaps, [{ kind: 'new_work_after', item, what: 'tell me when you started this', effort: 'minutes', agent_can: false }]);
  assert.equal(codeChecked(item), false);
  assert.equal(evaluate(p, f, new Set([item]), NOW).status, 'ready');
  assert.equal(evaluate(p, { ...f, first_commit_at: '2026-10-20T00:00:00Z' }, new Set(), NOW).status, 'ready');
  const before = evaluate(p, { ...f, first_commit_at: '2026-09-01T00:00:00Z' }, new Set(), NOW);
  assert.deepEqual([before.status, before.reason], ['no', 'needs work started after 2026-10-01']);
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

test('L1e-6 fix round 1 (v6.1.13, T3-R1): a needs_repo grant for existing code is one step, code in a repo, from an idea or an empty repo; a repo with code or a live link has none', async () => {
  const futo = fromFile('futo-microgrants');
  const parsed = parseProject({ name: 'Rent Split', description: 'An idea: an app that splits rent.' });
  assert.ok(parsed.ok);
  const idea = await repoFacts(parsed.project, { now: NOW });
  const empty = await factsOf('empty-repo');
  for (const facts of [idea, empty]) {
    const v = evaluate(futo, facts, new Set(), NOW);
    assert.deepEqual([v.status, v.reason, v.gaps.map((g) => [g.kind, g.item, g.what])], ['gap', null, [['repo', 'repo', 'code in a repo'], ['rule', ruleItem('open source software from a small or early-stage project'), 'open source software from a small or early-stage project']]]);
  }
  // The builder's word is not the read: "repo" marked done is re-checked, and the step stays.
  assert.equal(codeChecked('repo'), true);
  assert.equal(evaluate(futo, idea, new Set(['repo']), NOW).gaps[0].kind, 'repo');
  const code = { ...(await factsOf('nextjs-dashboard')), chains: [] };
  assert.ok(!evaluate(futo, code, new Set(), NOW).gaps.some((g) => g.kind === 'repo'));
  assert.ok(!evaluate(futo, { ...idea, live_url: 'https://rentsplit.app' }, new Set(), NOW).gaps.some((g) => g.kind === 'repo'));
  // Hackathons are exempt.
  const qnx = fromFile('qnx-global-hackathon-2026');
  assert.ok(!evaluate(qnx, idea, new Set(), NOW).gaps.some((g) => g.kind === 'repo'));
});

test('B20c, B20d (v6.1.9, Review Focus 1, fix rounds 1 and 2): the users question needs a project that exists (code read, a live link, private, or reads paused); repo-less, unread or empty is not a fit for a used program', async () => {
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
  // A repo read with code, a live link given, or a private repo (the builder's word) keeps the question.
  const code = { ...(await factsOf('nextjs-dashboard')), chains: [] };
  assert.deepEqual(evaluate(floss, code, new Set(), NOW).gaps.map((g) => g.what), ['tell me if real people use it']);
  const live = { ...idea, live_url: 'https://rentsplit.app' };
  assert.deepEqual(evaluate(floss, live, new Set(), NOW).gaps.map((g) => g.what), ['tell me if real people use it']);
  const pp = parseProject({ name: 'Billing Core', description: 'Usage-based billing.', repo_url: 'https://github.com/acme-private/billing-core', private: true });
  assert.ok(pp.ok);
  const priv = await repoFacts(pp.project, { now: NOW });
  assert.deepEqual([priv.as_reported, priv.notes], [true, ['private']]);
  // L1f-1 (v6.1.14): FLOSS/fund is open source, so the private repo is a step from it too, never ready.
  assert.deepEqual(evaluate(floss, priv, new Set(), NOW).gaps.map((g) => g.what), ['a public repo', 'tell me if real people use it']);
  assert.deepEqual(evaluate(usersOnly, priv, new Set(), NOW).gaps.map((g) => g.what), ['tell me if real people use it']);
  assert.equal(evaluate(usersOnly, { ...priv, users: true }, new Set(), NOW).status, 'ready');
  assert.equal(evaluate(floss, { ...priv, users: true }, new Set(), NOW).status, 'gap');
  assert.equal(evaluate(floss, { ...empty, live_url: 'https://x.dev', users: true }, new Set(), NOW).status, 'ready');
  // B20d (fix round 2): reads paused for the day keeps the builder's word; a repo link that was not read (a 404 or a
  // failed read) does not exist for the question.
  const named = { ...idea, repo_url: 'https://github.com/a/b' };
  assert.deepEqual(evaluate(floss, { ...named, notes: ['paused'] }, new Set(), NOW).gaps.map((g) => g.what), ['tell me if real people use it']);
  assert.deepEqual(evaluate(floss, { ...named, notes: ['unread'], users: true }, new Set(), NOW).reason, 'needs a product people use');
  // I4 (final review): a repo-less project with a mainnet contract (reported) exists; a testnet one does not.
  const pc = parseProject({ name: 'Vault', description: 'A closed-source vault.', chains: [{ chain: 'base', mainnet: true, contract: '0x1111111111111111111111111111111111111111' }] });
  assert.ok(pc.ok);
  const contracted = await repoFacts(pc.project, { now: NOW });
  assert.equal(contracted.repo_url, null);
  assert.equal(contracted.contracts.length, 1);
  assert.equal(exists(contracted), true);
  assert.deepEqual(evaluate(usersOnly, contracted, new Set(), NOW).gaps.map((g) => g.what), ['tell me if real people use it']);
  assert.equal(exists({ ...contracted, chains: contracted.chains.map((c) => ({ ...c, mainnet: false })) }), false);
  // A program that asks for no users is unchanged.
  assert.equal(evaluate(toRow(programFixture({ id: 'p-none', tag: undefined, eligibility: [] })), idea, new Set(), NOW).status, 'ready');
});

test('N-5 (v6.1.9): code-checked items are re-read, each said as the thing the read looks for; the builder\'s word is not', () => {
  for (const item of ['chain:base', 'contract_on:base', 'builder_codes', 'live_product', 'integration:x']) assert.equal(codeChecked(item), true, item);
  for (const item of ['demo_video', 'users', 'feature:x', 'rule:0123abcd']) assert.equal(codeChecked(item), false, item);
  const g = (kind: Gap['kind'], item: string, chain?: string): Gap => ({ kind, item, what: 'x', effort: 'hours', agent_can: false, ...(chain ? { details: { chain } } : {}) });
  const gaps = [g('chain', 'chain:base', 'base'), g('contract_on', 'contract_on:base', 'base'), g('builder_codes', 'builder_codes'), g('live_product', 'live_product'), g('demo_video', 'demo_video')];
  assert.deepEqual(lookedAgain(gaps, new Set(['chain:base', 'contract_on:base', 'builder_codes', 'live_product', 'demo_video'])),
    ['the contract on Base', 'a contract on Base', 'Base Builder Codes in the app', 'a live link']);
  assert.deepEqual(lookedAgain(gaps, new Set()), []);
});

test('L1c-2 (v6.1.10): a rule with keywords is unlikely unless the project names one, as a whole word or phrase, in its name, description, README or topics', async () => {
  const vr = fromFile('meta-vr-start-competition-2026');
  const facts = (over: Partial<RepoFacts>): RepoFacts => ({ ...(await0), ...over });
  const await0 = await repoFacts({ name: 'x', description: '' }, { now: NOW });
  const gapsOf = (f: RepoFacts, done = new Set<string>()) => evaluate(vr, f, done, NOW).gaps;
  const idea = facts({ name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' });
  assert.equal(unlikely(vr, idea, gapsOf(idea)), true);
  for (const f of [
    facts({ name: 'Rent Split', description: 'A hands-first game for Meta Quest 3' }),
    facts({ name: 'QUEST runner', description: 'x' }),
    facts({ name: 'x', description: 'y', readme_excerpt: 'Built for Oculus headsets.' }),
    facts({ name: 'x', description: 'y', topics: ['vr', 'unity'] }),
  ]) assert.equal(unlikely(vr, f, gapsOf(f)), false, f.description + (f.readme_excerpt ?? ''));
  // Whole words only: "Conquest" and "vram" name no keyword.
  const near = facts({ name: 'Conquest', description: 'A vram profiler' });
  assert.equal(unlikely(vr, near, gapsOf(near)), true);
  // The rule confirmed (a yes): no rule left to judge, so not unlikely.
  const rule = gapsOf(idea).find((g) => g.kind === 'rule')!.item;
  assert.equal(unlikely(vr, idea, gapsOf(idea, new Set([rule]))), false);
  // A program whose rules carry no keywords (a licence rule) is never unlikely.
  const futo = fromFile('futo-microgrants');
  const code = facts({ name: 'Rent Split', description: 'An app that splits rent', repo_url: 'https://github.com/a/rent' });
  assert.equal(unlikely(futo, code, evaluate(futo, code, new Set(), NOW).gaps), false);
  // L1e-2 (v6.1.13): a person rule may name who it is for: Thiel is unlikely for the idea, likely for a student.
  const thiel = fromFile('thiel-fellowship');
  assert.equal(unlikely(thiel, idea, evaluate(thiel, idea, new Set(), NOW).gaps), true);
  const student = facts({ name: 'micrograd', description: 'My student side project: a tiny scalar autograd engine' });
  assert.equal(keywordHit(thiel, student, evaluate(thiel, student, new Set(), NOW).gaps), true);
  // Fix round 1 (T3-R3): the project's own chains count as its words: Avalanche on Avalanche is a hit, no prose needed.
  const ava = fromFile('avalanche-team1-mini-grants');
  const onAva = facts({ name: 'Pay', description: 'Payments for shops', chains: [{ chain: 'avalanche', mainnet: true, basis: 'reported' } as never] });
  assert.equal(keywordHit(ava, onAva, evaluate(ava, onAva, new Set(), NOW).gaps), true);
  const offAva = facts({ name: 'Pay', description: 'Payments for shops' });
  assert.equal(unlikely(ava, offAva, evaluate(ava, offAva, new Set(), NOW).gaps), true);
  // Fix round 1 (T3-R2): no number and no "fellowship": a team of 22 and a fellowship-named project are no hit.
  for (const [name, description] of [['Acme', 'A team of 22 building billing for B2B APIs'], ['Fellowship Finder', 'Find a research fellowship near you']]) {
    const f = facts({ name, description });
    assert.equal(keywordHit(thiel, f, evaluate(thiel, f, new Set(), NOW).gaps), false, description);
  }
  // A phrase matches as a phrase: "mini app" for Farcaster.
  const fc = fromFile('farcaster-developer-rewards');
  const fcRule: Gap[] = [{ kind: 'rule', item: ruleItem('a Farcaster Mini App'), what: 'a Farcaster Mini App', effort: 'hours', agent_can: false }];
  assert.equal(unlikely(fc, facts({ name: 'Tipper', description: 'A Mini App for tipping' }), fcRule), false);
  assert.equal(unlikely(fc, facts({ name: 'Tipper', description: 'A mini tipping app' }), fcRule), true);
});

test('C3 (v6.1.13): keywords inside links, code blocks and inline code are not the project naming them', async () => {
  const vr = fromFile('meta-vr-start-competition-2026');
  const base = await repoFacts({ name: 'x', description: '' }, { now: NOW });
  const facts = (over: Partial<RepoFacts>): RepoFacts => ({ ...base, ...over });
  const gapsOf = (f: RepoFacts) => evaluate(vr, f, new Set(), NOW).gaps;
  for (const f of [
    facts({ name: 'Log viewer', description: 'Reads logs. See https://x.example/quest and www.quest.example/docs' }),
    facts({ name: 'Log viewer', description: 'Reads logs. Install with `npm i quest-cli`.' }),
    facts({ name: 'Log viewer', description: 'Reads logs.\n```\nquest run\n```' }),
    facts({ name: 'https://quest.example', description: 'Reads logs.' }),
    facts({ name: 'Log viewer', description: 'Reads logs.', readme_excerpt: 'Reads logs. See http://x.example/oculus for more.' }),
  ]) {
    assert.equal(unlikely(vr, f, gapsOf(f)), true, f.name + ' ' + f.description + ' ' + (f.readme_excerpt ?? ''));
    assert.equal(keywordHit(vr, f, gapsOf(f)), false);
  }
  // Prose next to a link still counts.
  const prose = facts({ name: 'Log viewer', description: 'A Quest game. See https://x.example/docs' });
  assert.equal(keywordHit(vr, prose, gapsOf(prose)), true);
  // The README excerpt drops inline code spans, so a package name in backticks is never read as prose.
  assert.equal(readmeExcerpt('Reads logs. Install with `npm i quest-cli` today.'), 'Reads logs. Install with today.');
});

test('L1c-2 final (v6.1.10): the keyword matcher takes punctuation as a boundary, a hyphen as a space, and a phrase only whole', () => {
  // Punctuation next to the keyword is a boundary.
  assert.equal(names('a game for meta (quest) headsets', 'quest'), true);
  assert.equal(names('vr, ar and xr', 'vr'), true);
  assert.equal(names('"Oculus"', 'oculus'), true);
  // A hyphen reads as a space, on either side.
  assert.equal(names('a farcaster mini-app for tips', 'mini app'), true);
  assert.equal(names('a hands first demo', 'hands-first'), true);
  // A phrase at a word boundary, at the start, the end, and next to a line break.
  assert.equal(names('v4 hook for limit orders', 'v4 hook'), true);
  assert.equal(names('a uniswap v4 hook', 'v4 hook'), true);
  assert.equal(names('readme\natlassian forge app', 'atlassian forge'), true);
  // Not inside a longer word, and not the words apart.
  assert.equal(names('a uniswap v4 hooked bot', 'v4 hook'), false);
  assert.equal(names('xv4 hook', 'v4 hook'), false);
  assert.equal(names('a mini tipping app', 'mini app'), false);
  assert.equal(names('a miniapp', 'mini app'), false);
  // A React hook is not Uniswap, and a Foundry repo is not Codegeist.
  const uni = ['uniswap', 'v4 hook', 'uniswap hook'];
  assert.equal(uni.some((k) => names('A React hook for forms', k)), false);
  const codegeist = eligibilityKeywords('codegeist-2026');
  assert.equal(codegeist.some((k) => names('Run forge build and forge test to deploy the vault.', k)), false);
  assert.equal(codegeist.some((k) => names('An Atlassian Forge app for Jira', k)), true);
  // Meta's models are not the VR competition.
  const vr = eligibilityKeywords('meta-vr-start-competition-2026');
  assert.equal(vr.some((k) => names('Fine-tunes meta-llama by Meta AI', k)), false);
});

/** v6.1.14 L1f-1: the catalog programs whose rule is an open source license or open source software. */
const OPEN_SOURCE = [
  'floss-fund-zerodha', 'futo-microgrants', 'github-secure-open-source-fund', 'herodevs-sustainability-fund', 'kiroween-2026',
  'neon-open-source-program', 'nlnet-open-call', 'paypal-ai-hackathon', 'qnx-global-hackathon-2026', 'sovereign-tech-fund',
];
const PUBLIC_GAP = ['repo', 'repo:public', 'a public repo', 'make the repo public'];
const gapRow = (g: Gap) => [g.kind, g.item, g.what, g.setup];

test('L1f-1 (v6.1.14, Review Focus 6): a private repo is never ready for an open source program: its one step is a public repo', async () => {
  for (const f of OPEN_SOURCE) assert.equal(fromFile(f).file.open_source, true, f);
  assert.equal(fromFile('base-builder-grants').file.open_source, false);
  const floss = fromFile('floss-fund-zerodha');
  const parsed = parseProject({ name: 'Billing Core', description: 'Usage-based billing engine for B2B APIs', repo_url: 'https://github.com/acme-private/billing-core', private: true, users: true });
  assert.ok(parsed.ok);
  const hidden = await repoFacts(parsed.project, { now: NOW });
  assert.equal(hidden.private, true);
  const v = evaluate(floss, hidden, new Set(), NOW);
  assert.deepEqual([v.status, v.gaps.map(gapRow)], ['gap', [PUBLIC_GAP]]);
  // HeroDevs too: the public repo before its license rule.
  const hero = evaluate(fromFile('herodevs-sustainability-fund'), hidden, new Set(), NOW);
  assert.deepEqual(hero.gaps.map((g) => g.item).slice(0, 1), ['repo:public']);
  // The agent's word alone (no repo link) is a private repo too.
  const noLink = parseProject({ name: 'Billing Core', description: 'Billing', private: true, users: true, live_url: 'https://billing.example' });
  assert.ok(noLink.ok);
  assert.deepEqual(evaluate(floss, await repoFacts(noLink.project, { now: NOW }), new Set(), NOW).gaps.map(gapRow), [PUBLIC_GAP]);
  // Public: no such gap; a program with no open source rule never asks it.
  const open = { ...hidden, private: undefined, notes: [], public: true, as_reported: false };
  assert.equal(evaluate(floss, open, new Set(), NOW).status, 'ready');
  assert.ok(!evaluate(toRow(programFixture({ id: 'p-closed', tag: undefined })), hidden, new Set(), NOW).gaps.some((g) => g.item === 'repo:public'));
});

test('L1f-3 (v6.1.14): an archived repo is never asked the users question: its one step is the archive, told the live repo', async () => {
  const facts = await factsOf('archived-dashboard');
  assert.ok(facts.notes?.includes('archived'));
  const v = evaluate(fromFile('floss-fund-zerodha'), facts, new Set(), NOW);
  assert.deepEqual([v.status, v.gaps.map(gapRow)], ['gap', [['repo', 'repo:archived', 'the repo is archived', 'tell me the live repo']]]);
  assert.ok(!v.gaps.some((g) => g.kind === 'users'));
  // A live repo gets the users question as before.
  const live = evaluate(fromFile('floss-fund-zerodha'), { ...facts, notes: [] }, new Set(), NOW);
  assert.deepEqual(live.gaps.map((g) => g.item), ['users']);
});

test('M1 (v6.1.14 fix round 1): a repo the read finds private is private, never gone: FLOSS/fund is never ready for it, fresh or cached', async () => {
  const floss = fromFile('floss-fund-zerodha');
  const turned = (slug: string) => replayFetch(slug, (u, b) => (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(u) ? b.replace('"private":false', '"private":true') : b));
  const pp = (repo: string) => {
    const r = parseProject({ name: 'App', description: 'An app.', repo_url: `https://github.com/${repo}`, users: true, live_url: 'https://app.example' });
    assert.ok(r.ok);
    return r.project;
  };
  // A fresh read.
  const fresh = turned('nextjs-dashboard');
  const f = await repoFacts(pp(fresh.repo), { gh: fresh.fetch, now: NOW });
  assert.deepEqual([f.private, f.notes], [true, ['private']]);
  assert.deepEqual(evaluate(floss, f, new Set(), NOW).gaps.map((g) => g.item), ['repo:public']);
  // A cached public row the re-check (two hours on) finds private.
  await sql()`DELETE FROM repo_cache`;
  const pub = replayFetch('nextjs-dashboard');
  assert.equal(evaluate(floss, await repoFacts(pp(pub.repo), { gh: pub.fetch, now: NOW }), new Set(), NOW).status, 'ready');
  const later = new Date(NOW.getTime() + 2 * 3_600_000);
  const c = await repoFacts(pp(pub.repo), { gh: turned('nextjs-dashboard').fetch, now: later });
  assert.deepEqual([c.private, c.notes], [true, ['private']]);
  assert.notEqual(evaluate(floss, c, new Set(), later).status, 'ready');
});
