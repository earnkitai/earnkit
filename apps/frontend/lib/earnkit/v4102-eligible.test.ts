import test from 'node:test';
import assert from 'node:assert/strict';
import { bestMove, type GapGrant, type MoveCtx, type MoveProgram } from './conversation';
import { committedProgram } from './fixtures/program-file';
import { ProgramFile } from './program-file';
import { readySet } from './ready-set';
import { readyNotEligibleLine, readyOpener } from './ready-copy';
import { notEligible } from './bench-find';
import { CHAINS, CHAIN_EXPLAINED, CHAIN_NAMES } from './chains';
import { chainOfId, detectChains } from './match';
import { gateFailures, type Reply } from './fixtures/converse';

/*
 * v4.10.2 Task 2 (R3, R4): a program whose rule requires a chain the project doesn't use is not eligible (program file
 * `chain_required`); Arbitrum is a chain, and the Arbitrum Open House is tagged with it.
 */
const NOW = new Date('2026-11-02T10:00:00Z');
const prog = (o: Partial<MoveProgram> & { id: string }): MoveProgram => ({
  title: o.id, amount: null, when: 'rolling', ends_at: null, zone: 'UTC', investment: false, max_usd: null, ...o,
});
const grant = (o: Partial<GapGrant> & { id: string }): GapGrant => ({ ...prog(o), gaps: [], gap: '', passed: false, doable: false, ...o });
const ctx = (o: Partial<MoveCtx> = {}): MoveCtx & { now: Date } => ({ now: NOW, fits: [], grants: [], investors: [], skip: new Set(), raised: new Set(), path: null, ...o });

test('R3: the committed Circle file is chain_required (its rule: Arc must be core); other files are not', () => {
  const circle = ProgramFile.parse(committedProgram('circle-developer-grants'));
  assert.equal(circle.chain_required, true);
  assert.deepEqual(circle.chains, ['arc']);
  assert.ok(circle.rules.some((r) => /Arc must be core/.test(r)));
  assert.equal(ProgramFile.parse(committedProgram('base-builder-grants')).chain_required, undefined);
});

test('R3: chain_required needs its chains (never with any_chain), and is a boolean', () => {
  const circle = committedProgram('circle-developer-grants');
  assert.equal(ProgramFile.safeParse({ ...circle, chain_required: 'yes' }).success, false);
  const any = ProgramFile.safeParse({ ...circle, chains: [], any_chain: true, min_product_score: 5, chain_required: true });
  assert.equal(any.success, false);
  assert.match(JSON.stringify(any.error?.issues), /chain_required/);
});

test('R3: notEligible is a chain_required card none of whose chains the project uses', () => {
  const card = { chains: ['arc' as const], any_chain: false, chain_required: true };
  assert.equal(notEligible(card, new Set(['base'])), true);
  assert.equal(notEligible(card, new Set()), true);
  assert.equal(notEligible(card, new Set(['base', 'arc'])), false);
  // A soft chain mismatch stays a long shot, never "not eligible".
  assert.equal(notEligible({ ...card, chain_required: false }, new Set(['base'])), false);
  assert.equal(notEligible({ chains: ['arc' as const], any_chain: false }, new Set(['base'])), false);
  assert.equal(notEligible({ chains: ['base' as const, 'arc' as const], any_chain: false, chain_required: true }, new Set(['base'])), false);
});

test('R3: a not-eligible grant never enters the ready set and is never the path\'s move, even closing within 48 hours', () => {
  const circle = grant({ id: 'circle', title: 'Circle Developer Grants', amount: '$5K to $100K', max_usd: 100_000, longShot: true, why: 'they look for apps on Arc', notEligible: true });
  const other = grant({ id: 'other', title: 'Other Grants', amount: 'up to $5,000', max_usd: 5_000 });
  assert.deepEqual(readySet(ctx({ grants: [circle, other] })).map((p) => p.id), ['other']);
  assert.deepEqual(readySet(ctx({ grants: [{ ...circle, notEligible: false }, other] })).map((p) => p.id), ['other', 'circle']);
  // bestMove: a no-gap grant closing within NOW_WINDOW_MS is "now"; a not-eligible one never is, nor with a gap.
  const soon = { ...circle, longShot: false, ends_at: new Date(NOW.getTime() + 10 * 3_600_000).toISOString() };
  assert.equal(bestMove(ctx({ grants: [soon] })).kind, 'quiet');
  assert.equal(bestMove(ctx({ grants: [{ ...soon, notEligible: false }] })).kind, 'now');
  assert.equal(bestMove(ctx({ grants: [{ ...soon, gaps: ['on Arc mainnet'], gap: 'x' }] })).kind, 'quiet');
  // Nor a fit or a picked path on it.
  const path = { stage: 'hook' as const, program_id: 'circle', at: NOW.toISOString(), picked: true as const };
  assert.equal(bestMove(ctx({ grants: [soon], path })).kind, 'quiet');
});

test('R3: the not-eligible line is one plain statement (no question), money-free, naming the chain', () => {
  assert.equal(readyNotEligibleLine([{ title: 'Circle Developer Grants', chains: ['arc'] }], 'EarnKit'),
    "Circle Developer Grants is only for an app on Arc, so it doesn't fit EarnKit yet.");
  assert.equal(readyNotEligibleLine([{ title: 'Two Grants', chains: ['arc', 'tempo'] }], 'EarnKit'),
    "Two Grants is only for an app on Arc or Tempo, so it doesn't fit EarnKit yet.");
  assert.equal(readyNotEligibleLine([], 'EarnKit'), null);
  const line = readyNotEligibleLine([{ title: 'Circle Developer Grants', chains: ['arc'] }, { title: 'Other Fund', chains: ['monad'] }], 'EarnKit')!;
  assert.equal(line, "Circle Developer Grants is only for an app on Arc, and Other Fund for an app on Monad, so they don't fit EarnKit yet.");
  assert.doesNotMatch(line, /\?/);
});

test('R3: the opener says the not-eligible line before the filled line; the one easy reply stays last and the gate passes', () => {
  const set = [{ id: 'a', title: 'Alpha Grants', amount: 'up to $5,000', max_usd: 5_000, kind: 'fit' as const, why: null, ends_at: null, zone: 'UTC', step: null, needs: null }];
  const text = readyOpener({ name: 'Jenil', set, worth: '$5K', page: 'earnkit.com/jenilt', hosted: false, now: NOW, asks: 0, notEligible: "Circle Developer Grants is only for an app on Arc, so it doesn't fit EarnKit yet." });
  const parts = text.split('\n\n');
  assert.equal(parts[2], "Circle Developer Grants is only for an app on Arc, so it doesn't fit EarnKit yet.", text);
  assert.match(parts[3], /^Every answer is filled/);
  const r: Reply = { turn: 0, session: 0, first: false, hook: false, tool: 'find', input: {}, show: text, said: ['opener'], reply: { move_up: { kind: 'ready', project_key: null } } } as Reply;
  assert.deepEqual(gateFailures([r]).filter((f) => f.rule === 'easy_reply' || f.rule === 'copy'), []);
});

test('R4: arbitrum is a chain (Arbitrum One 42161, Arbitrum Sepolia 421614), named "Arbitrum"', () => {
  assert.ok((CHAINS as readonly string[]).includes('arbitrum'));
  assert.equal(CHAIN_NAMES.arbitrum, 'Arbitrum');
  assert.equal(CHAIN_EXPLAINED.arbitrum, 'Arbitrum');
  assert.deepEqual(chainOfId(42161), { chain: 'arbitrum', mainnet: true });
  assert.deepEqual(chainOfId(421614), { chain: 'arbitrum', mainnet: false });
  assert.equal(detectChains([{ path: 'hardhat.config.ts', text: 'chainId: 42161' }]).arbitrum?.mainnet, true);
  assert.equal(ProgramFile.parse({ ...committedProgram('circle-developer-grants'), chains: ['arbitrum'], chain_required: undefined }).chains[0], 'arbitrum');
});

test('R4: the Arbitrum Open House is tagged arbitrum, matching its rule', () => {
  const p = ProgramFile.parse(committedProgram('arbitrum-open-house-sao-paulo'));
  assert.deepEqual(p.chains, ['arbitrum']);
  assert.ok(p.rules.some((r) => /deployed on an Arbitrum chain/.test(r)));
});
