import { test } from 'node:test';
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
