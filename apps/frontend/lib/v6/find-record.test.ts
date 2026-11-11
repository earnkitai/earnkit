import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { notNever, outsideApproval, pickProject } from './find-record';
import { EMPTY_RECORD, mergeRecord } from './record';
import type { ProgramRow } from '../v5/programs';
import type { Gap } from '../v5/eligibility';

const row = (id: string, title: string) => ({ id, file: { title } }) as unknown as ProgramRow;

test('programs to skip match the title or the slug, any case, with spaces trimmed (lane 5, 3.27)', () => {
  const rec = { ...EMPTY_RECORD, policy: { ...EMPTY_RECORD.policy, never: ['  base builder grants ', 'Z-FELLOWS'] } };
  const keep = notNever(rec);
  assert.equal(keep(row('base-builder-grants', 'Base Builder Grants')), false);
  assert.equal(keep(row('z-fellows', 'Z Fellows')), false);
  assert.equal(keep(row('thiel-fellowship', 'Thiel Fellowship')), true);
  assert.equal(notNever({ ...EMPTY_RECORD, policy: { ...EMPTY_RECORD.policy, never: [''] } })(row('a', 'A')), true);
});

test('C41: the record project is picked by project_id, repo or name; another project is never stood in', () => {
  const r = mergeRecord(EMPTY_RECORD, { projects: [
    { id: 'one', name: 'Project One', repo_url: 'https://github.com/a/one' },
    { id: 'two', name: 'Project Two' },
  ] }, 'builder', new Date('2026-11-06T12:00:00Z')).record;
  assert.equal(pickProject(r, 'two', null)?.id, 'two');
  assert.equal(pickProject(r, undefined, 'https://github.com/A/one/')?.id, 'one');
  assert.equal(pickProject(r, undefined, null, ' project two ')?.id, 'two');
  assert.equal(pickProject(r, undefined, null, 'Project Three'), null);
  assert.equal(pickProject(r, undefined, null), null);
});

test('N5 (v6.1.9): the category reason is a lower-case plural mid-sentence', () => {
  const rec = { ...EMPTY_RECORD, policy: { ...EMPTY_RECORD.policy, auto_apply: true, agent_may_submit: true, categories: ['hackathon' as const] } };
  const of = (category: string) => ({ id: category, file: { title: category, category, needs: [], submission_requirements: [] } }) as unknown as ProgramRow;
  assert.equal(outsideApproval(rec, of('bounty')), 'bounties are not in your categories');
  assert.equal(outsideApproval(rec, of('grant')), 'grants are not in your categories');
  assert.equal(outsideApproval(rec, of('investment')), 'investments are not in your categories');
  assert.equal(outsideApproval(rec, of('hackathon')), null);
});

test('L12-7 (v6.1.14): with no tier, a building bar on an own-chain or keyword-hit program asks for code in a repo; any other stays no fit', async () => {
  const { gateFor } = await import('./find-record');
  const { NEEDS_CODE } = await import('../v5/eligibility');
  const prog = (id: string, over: Record<string, unknown>) => ({ id, file: { title: id, min_tier: 'building', chains: [], any_chain: true, eligibility: [], ...over } }) as unknown as ProgramRow;
  const facts = { name: 'Tips', description: 'Tipping on Solana', readme_excerpt: null, topics: [], chains: [{ chain: 'solana', mainnet: true }], public: false, as_reported: true, live_url: null, repo_url: null, notes: [] } as never;
  const rule: Gap = { kind: 'rule', item: 'rule:x', what: 'x', effort: 'hours', agent_can: false };
  const gate = gateFor(null, facts);
  const own = gate({ program_id: 'own', status: 'gap', gaps: [rule], reason: null, long_shot: null, rules: [] }, prog('own', { chains: ['solana'], any_chain: false }));
  assert.equal(own.status, 'gap');
  assert.deepEqual(own.gaps, [NEEDS_CODE, rule]);
  // A ready own-chain program: the code is its one step.
  assert.deepEqual(gate({ program_id: 'own', status: 'ready', gaps: [], reason: null, long_shot: null, rules: [] }, prog('own', { chains: ['solana'], any_chain: false })).gaps, [NEEDS_CODE]);
  // Another real change, a higher bar, or neither own chain nor a keyword hit: no fit, as before.
  const feature: Gap = { kind: 'feature', item: 'feature:y', what: 'y', effort: 'days', agent_can: false };
  assert.equal(gate({ program_id: 'own', status: 'gap', gaps: [feature, rule], reason: null, long_shot: null, rules: [] }, prog('own', { chains: ['solana'], any_chain: false })).status, 'no');
  assert.equal(gate({ program_id: 'own', status: 'ready', gaps: [], reason: null, long_shot: null, rules: [] }, prog('own', { chains: ['solana'], any_chain: false, min_tier: 'live' })).status, 'no');
  assert.equal(gate({ program_id: 'any', status: 'gap', gaps: [rule], reason: null, long_shot: null, rules: [] }, prog('any', {})).status, 'no');
});

test('#6 (v6.1.15): the tier gap takes the builder form from the stored line, one full stop; the fallback is unchanged', async () => {
  const { tierGate } = await import('./find-record');
  const { builderLine } = await import('./tier-words');
  const { place } = await import('./tiers');
  const { contract, evidence, liveRows, NOW } = await import('./fixtures/evidence-builder');
  const e = evidence({ live: liveRows({ url: 'https://a.example', url_ok: true }), onchain: [contract({ tx_90d: 9, senders_90d: 4, funded_senders_90d: 4, funded_sample: 4 })] });
  const line = builderLine(place(e, { identical_pitch: 0, shared_contributors: 0 }, undefined, NOW));
  const prog = { id: 'base-builder-grants', file: { title: 'Base Builder Grant Program', min_tier: 'used', chains: ['base'], eligibility: [] } } as unknown as ProgramRow;
  const ready = { program_id: 'base-builder-grants', status: 'ready' as const, gaps: [], reason: null, long_shot: null, rules: [] };
  const g = tierGate(ready, prog, 'live', line, true).gaps[0] as Gap;
  assert.equal(g.what, 'about 25 outside users in 90 days; I count 4');
  assert.equal(`Base Builder Grant Program, up to $5,000: ${g.what}.`, 'Base Builder Grant Program, up to $5,000: about 25 outside users in 90 days; I count 4.');
  assert.doesNotMatch(g.what, /deployer|senders|mainnet/);
  assert.equal((tierGate(ready, prog, 'live', undefined, true).gaps[0] as Gap).what, 'the project reading as used');
});

test('L23-14 (v6.1.16) and the controller ruling: a failed re-read keeps the stored tier within 14 days and for its own repo only, never bumping the read time', async () => {
  const { sql } = await import('../v5/db');
  const { recordSide, READ_GRACE_DAYS, EVIDENCE_NOT_READ } = await import('./find-record');
  const { readStoredRecord, saveRecord, upsertBuilder } = await import('./builders');
  const { evidence } = await import('./fixtures/evidence-builder');
  assert.equal(READ_GRACE_DAYS, 14);
  const NOW = new Date('2026-11-20T12:00:00Z');
  const REPO = 'https://github.com/lane23/t1';
  const failed = async () => evidence({ notes: ['not read: private or missing'] });
  const b = await upsertBuilder({ github_id: 923_014, login: 'l23t1', name: null, avatar_url: null }, NOW);
  const stored = (daysAgo: number, repo_url: string | null = REPO) => ({
    ...EMPTY_RECORD,
    projects: [{ id: 't1', name: 'T1', repo_url: REPO, answers: {}, evidence_read_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
      last_tier: { tier: 'building', line: 'Your project is building.', read_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), ...(repo_url ? { repo_url } : {}) } }],
  });
  const facts = { repo_url: REPO, name: 'T1', contracts: [] } as never;
  const side = async () => recordSide({ builderId: b.id, now: NOW, projectId: 't1', facts, read: failed });
  // Read 10 days ago from this repo: the tier and its date stand, said so.
  await saveRecord(b.id, stored(10) as never, NOW);
  const kept = await side();
  assert.deepEqual([kept.tier, kept.summary?.line, kept.problems], ['building', 'I could not read your repo today; using what I read on Nov 10.', [EVIDENCE_NOT_READ]]);
  const readAt = (await readStoredRecord(b.id)).record.projects[0].evidence_read_at;
  assert.equal(readAt, new Date(NOW.getTime() - 10 * 86_400_000).toISOString(), 'a failed read never bumps evidence_read_at');
  // Past the 14 days: unverified, the plain line.
  await saveRecord(b.id, stored(15) as never, NOW);
  const old = await side();
  assert.deepEqual([old.tier, old.summary?.line], ['unverified', 'I could not read your repo today.']);
  // A tier read from another repo (or none named): unverified too.
  await saveRecord(b.id, stored(2, 'https://github.com/lane23/other') as never, NOW);
  assert.deepEqual([(await side()).tier, (await side()).summary?.line], ['unverified', 'I could not read your repo today.']);
  await saveRecord(b.id, stored(2, null) as never, NOW);
  assert.equal((await side()).tier, 'unverified');
  await sql()`DELETE FROM builders WHERE id = ${b.id}`;
});

test('Task 9 fix round 1 (M2): a reader that throws gets the same bound: kept within 14 days for its repo, else unverified; the read time never moves', async () => {
  const { sql } = await import('../v5/db');
  const { recordSide, EVIDENCE_NOT_READ } = await import('./find-record');
  const { readStoredRecord, saveRecord, upsertBuilder } = await import('./builders');
  const NOW = new Date('2026-11-20T12:00:00Z');
  const REPO = 'https://github.com/lane23/throws';
  const b = await upsertBuilder({ github_id: 923_015, login: 'l23throw', name: null, avatar_url: null }, NOW);
  const stored = (daysAgo: number) => ({
    ...EMPTY_RECORD,
    projects: [{ id: 't2', name: 'T2', repo_url: REPO, answers: {}, evidence_read_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
      last_tier: { tier: 'building', line: 'Your project is building.', read_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), repo_url: REPO } }],
  });
  const side = () => recordSide({ builderId: b.id, now: NOW, projectId: 't2', facts: { repo_url: REPO, name: 'T2', contracts: [] } as never, read: async () => { throw new Error('down'); } });
  await saveRecord(b.id, stored(10) as never, NOW);
  const kept = await side();
  assert.deepEqual([kept.tier, kept.summary?.line, kept.problems], ['building', 'I could not read your repo today; using what I read on Nov 10.', [EVIDENCE_NOT_READ]]);
  assert.equal((await readStoredRecord(b.id)).record.projects[0].evidence_read_at, new Date(NOW.getTime() - 10 * 86_400_000).toISOString());
  await saveRecord(b.id, stored(15) as never, NOW);
  const old = await side();
  assert.deepEqual([old.tier, old.summary?.line, old.problems], ['unverified', 'I could not read your repo today.', [EVIDENCE_NOT_READ]]);
  assert.equal((await readStoredRecord(b.id)).record.projects[0].evidence_read_at, new Date(NOW.getTime() - 15 * 86_400_000).toISOString());
  await sql()`DELETE FROM builders WHERE id = ${b.id}`;
});

after(async () => (await import('../v5/db')).sql().end());
