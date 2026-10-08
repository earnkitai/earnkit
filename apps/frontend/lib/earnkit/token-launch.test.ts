import './fixtures/no-network-checks';
import { test } from 'node:test';
process.env.EARNKIT_AUTH_SECRET = 'launch-test-secret';
import assert from 'node:assert/strict';
import type { ProgramRow } from './programs';
import { RateLimitError } from './rate-limit';
import { EARNINGS_LINE, LaunchError, TOKEN_TERMS, type TokenOutcome } from './tokens';
import { RecordSubmissionInput } from './projects';
import { legacyTokenLineCode, tokenLineFor } from './token-gate';
import { COIN_FOOTNOTE, coinRow, tokenFootnote, tokenRow, walletLine } from './entry-text';
import {
  LAUNCHING,
  LAUNCH_STUCK,
  STILL_CHECKING_LAUNCH,
  NON_BASE_NO_BONUS,
  SKIPPED_ENTRY,
  LaunchTokenInput,
  TECHNICAL_TERMS,
  decideToken,
  entryMissing,
  hasBuilderBonus,
  plainProblem,
  tickerTakenNote,
  launchToken,
  submissionToken,
  tokenAfterSubmission as tokenAfterSubmissionRaw,
  tokenProposalBlock,
  type FlowProject,
  type TokenFlowDeps,
} from './token-launch';

test('decideToken', () => {
  const base = { policy: 'encouraged' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW' };
  assert.deepEqual(decideToken(base), { action: 'launch', name: 'Chain Kits', symbol: 'CKIT' });
  assert.equal(decideToken({ ...base, choice: 'skip' }).action, 'skip');
  assert.match((decideToken({ ...base, policy: 'off' }) as { note: string }).note, /doesn't allow tokens/);
  assert.match((decideToken({ ...base, confirmed: false }) as { agent_note: string }).agent_note, /builder_confirmed/);
  assert.match((decideToken({ ...base, existingTokenUrl: 'https://tokens.fun/coin/0x1' }) as { note: string }).note, /already has a token/);
  assert.match((decideToken({ ...base, wallet: null }) as { note: string }).note, /no wallet for the token's fees/);
  assert.match((decideToken({ ...base, wallet: null }) as { agent_note: string }).agent_note, /creator_wallet/);
  assert.equal((decideToken({ ...base, wallet: null }) as { code?: string }).code, 'no_wallet');
  // Builder edits replace the proposal and go through the same rules.
  assert.deepEqual(decideToken({ ...base, choice: { symbol: 'KITS' } }), { action: 'launch', name: 'Chain Kits', symbol: 'KITS' });
  assert.equal(decideToken({ ...base, choice: { symbol: 'USDC' } }).action, 'refuse');
  assert.equal(decideToken({ ...base, choice: { name: 'Coinbase Kit' } }).action, 'refuse');
  assert.equal(decideToken({ ...base, proposal: null }).action, 'refuse'); // no proposal and no edits
  assert.deepEqual(decideToken({ ...base, proposal: null, choice: { name: 'Kit One', symbol: 'KONE' } }), { action: 'launch', name: 'Kit One', symbol: 'KONE' });
});

test('decideToken: edits are uppercased and cleaned; every ticker must pass tickerProblem', () => {
  const base = { policy: 'allowed' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW' };
  assert.deepEqual(decideToken({ ...base, choice: { symbol: 'kits' } }), { action: 'launch', name: 'Chain Kits', symbol: 'KITS' });
  assert.deepEqual(decideToken({ ...base, choice: { name: '  Kit   One  ' } }), { action: 'launch', name: 'Kit One', symbol: 'CKIT' });
  // A stored or proposed ticker that isn't valid never reaches tokens.fun.
  assert.equal(decideToken({ ...base, proposal: { name: 'Chain Kits', symbol: 'TOOLONGTICKER' } }).action, 'refuse');
  assert.equal(decideToken({ ...base, choice: { symbol: 'K-1' } }).action, 'refuse');
  assert.equal(decideToken({ ...base, proposal: null, choice: { name: 'Kit One' } }).action, 'refuse');
  // An existing token is refused (a pending claim is answered before decideToken, pendingOutcome).
  assert.equal(decideToken({ ...base, existingTokenUrl: 'https://tokens.fun/coin/0x1' }).action, 'refuse');
});

test('decideToken: checks run in order', () => {
  const base = { policy: 'encouraged' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW' };
  // policy before skip; skip before an existing token; existing token before confirmation.
  assert.match((decideToken({ ...base, policy: 'off', choice: 'skip' }) as { note: string }).note, /doesn't allow tokens/);
  assert.equal(decideToken({ ...base, choice: 'skip', existingTokenUrl: 'https://x' }).action, 'skip');
  assert.match((decideToken({ ...base, confirmed: false, existingTokenUrl: 'https://x' }) as { note: string }).note, /already has a token/);
  // confirmation before edits; edits before the wallet.
  assert.match((decideToken({ ...base, confirmed: false, choice: { symbol: 'USDC' } }) as { agent_note: string }).agent_note, /builder_confirmed/);
  assert.match((decideToken({ ...base, wallet: null, choice: { symbol: 'USDC' } }) as { note: string }).note, /^Ticker: USDC/);
  // An edit's problem is named even when there is no proposal to fall back on.
  assert.match((decideToken({ ...base, proposal: null, choice: { symbol: 'USDC' } }) as { agent_note: string }).agent_note, /symbol: USDC/);
});

test('decideToken: at submission only an explicit ticker launches', () => {
  const base = { policy: 'encouraged' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW', needsSymbol: true };
  for (const choice of [undefined, {}, { name: 'Chain Kits' }, { symbol: '  ' }]) {
    const d = decideToken({ ...base, choice });
    assert.equal(d.action, 'skip');
    assert.match((d as { agent_note: string }).agent_note, /exactly as shown to the builder/);
  }
  assert.deepEqual(decideToken({ ...base, choice: { symbol: 'ckit' } }), { action: 'launch', name: 'Chain Kits', symbol: 'CKIT' });
  // Unconfirmed reads as unconfirmed, and an existing token as a token, before the ticker rule.
  assert.match((decideToken({ ...base, confirmed: false }) as { agent_note: string }).agent_note, /builder_confirmed/);
});

const program = (policy: 'encouraged' | 'allowed' | 'off') =>
  ({ title: 'Base Batches', token_policy: policy, campaign: null }) as unknown as ProgramRow;
const free = { check: async () => true, available: () => true };

test('tokenProposalBlock: null when tokens are off or there is no project name', async () => {
  assert.equal(await tokenProposalBlock({ program: program('off'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, free), null);
  assert.equal(await tokenProposalBlock({ program: program('encouraged'), installationId: 1, creatorWallet: '0xW' }, free), null);
  assert.equal(await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: '  ', creatorWallet: '0xW' }, free), null);
});

test('tokenProposalBlock: the proposal, earnings, terms and the line to show', async () => {
  const b = await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, free);
  assert.ok(b);
  assert.deepEqual(b.proposed, { name: 'Chain Kits', symbol: 'CHAIN', image: 'monogram' });
  assert.equal(b.chain, 'base');
  assert.equal(b.paired_with, 'WETH');
  assert.equal(b.creator_wallet, '0xW');
  assert.equal(b.earnings, EARNINGS_LINE('0xW'));
  assert.equal(b.policy, 'encouraged');
  assert.match(b.terms.agreement, /^https:\/\/tokens\.fun\//);
  // v2.6 §3: the coin row and the wallet line (one yes), with the terms under them; nothing more.
  // Ruling 14: the footnote names the fee wallet when it is known.
  assert.equal(
    b.say_to_builder,
    `${coinRow({ symbol: 'CHAIN', name: 'Chain Kits', hasBonus: false })}\n\n${walletLine({ wallet: '0xW', remembered: false, hasBonus: false })}\n\n${COIN_FOOTNOTE}`,
  );
  assert.ok(COIN_FOOTNOTE.includes(TOKEN_TERMS.agreement) && COIN_FOOTNOTE.includes(TOKEN_TERMS.risks));
  // Ruling 22: the agent is told to pass the confirmed wallet on record_submission.
  assert.match(b.note, /Pass the wallet the builder confirmed \(the wallet line\) as record_submission's payout_wallet\./);
  // v2.5 Task 8 / v2.6 Ruling 7: this program fixture has no status ('active' required), so no builder bonus.
  assert.equal(b.has_bonus, false);
  // Without a repo there is no token line yet; v2.6: never a wallet line for a coin.
  assert.match(b.note, /Pass the project's repo_url to get its earnkit\.txt token line\./);
  assert.doesNotMatch(b.note, /payout_wallet:/);
});

test('hasBuilderBonus: active, not opted out, not a campaign (v2.6 Ruling 7)', () => {
  assert.equal(hasBuilderBonus({ status: 'active', builder_bonus: true, campaign: null, submission_proof: null } as unknown as ProgramRow), true);
  assert.equal(hasBuilderBonus({ status: 'active', builder_bonus: false, campaign: null } as unknown as ProgramRow), false);
  assert.equal(hasBuilderBonus({ status: 'closed', builder_bonus: true, campaign: null } as unknown as ProgramRow), false);
  assert.equal(hasBuilderBonus({ status: 'active', builder_bonus: true, campaign: { kind: 'sponsor' } } as unknown as ProgramRow), false);
});

test('tokenProposalBlock: v2.5 Task 8, a program with a builder bonus marks the row and the block', async () => {
  const bonusProgram = { title: 'Arc Microgrants', token_policy: 'encouraged' as const, campaign: null, status: 'active', submission_proof: { kind: 'dorahacks' } } as unknown as ProgramRow;
  const b = await tokenProposalBlock({ program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, free);
  assert.ok(b);
  assert.equal(b.has_bonus, true);
  assert.equal(
    b.say_to_builder,
    `${coinRow({ symbol: 'CHAIN', name: 'Chain Kits', hasBonus: true })}\n\n${walletLine({ wallet: '0xW', remembered: false, hasBonus: true })}\n\n${COIN_FOOTNOTE}`,
  );
  assert.match(b.say_to_builder, /say skip for no token \(and no builder bonus\)/);
  // Ruling 10: a remembered wallet says so on the wallet line.
  const r = await tokenProposalBlock({ program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', remembered: true }, free);
  assert.match(r!.say_to_builder, /\(used last time\), or tell me another\./);
  // Campaigns keep v2.4's token row.
  const camp = { ...bonusProgram, campaign: { kind: 'earnkit' } } as unknown as ProgramRow;
  const c = await tokenProposalBlock({ program: camp, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, free);
  assert.equal(c!.say_to_builder, `${tokenRow('CHAIN', false, null, 'Chain Kits')}\n\n${tokenFootnote('0xW')}`);
});

test('Ruling 25 (I8): on a program with a builder bonus, a repo whose coin is entered elsewhere gets the no-bonus row', async () => {
  const bonusProgram = { title: "Crypto World's Fair Hackathon", token_policy: 'encouraged' as const, campaign: null, status: 'active', submission_proof: { host: 'colosseum.com' } } as unknown as ProgramRow;
  const asked: string[] = [];
  const repoCoin = async (key: string) => (asked.push(key), key === 'github.com/acme/kit' ? { program_id: 'arc-microgrants', title: 'Arc Microgrants' } : null);
  const b = await tokenProposalBlock(
    { program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', repoUrl: 'https://github.com/Acme/Kit/' },
    { ...free, repoCoin },
  );
  assert.ok(b);
  assert.deepEqual(asked, ['github.com/acme/kit'], 'looked up by the normalized repo');
  assert.equal(b.repo_coin_program, 'Arc Microgrants');
  assert.equal(b.say_to_builder, "no builder bonus: this repo's token is entered in Arc Microgrants");
  assert.match(b.note, /don't pass token/);
  // A repo without a coin keeps the default row; a failed lookup never fails the block.
  const fresh = await tokenProposalBlock(
    { program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', repoUrl: 'https://github.com/acme/new' },
    { ...free, repoCoin },
  );
  assert.equal(fresh?.repo_coin_program, null);
  assert.match(fresh!.say_to_builder, /say skip for no token \(and no builder bonus\)/);
  const err = console.error;
  console.error = () => {};
  try {
    const failed = await tokenProposalBlock(
      { program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', repoUrl: 'https://github.com/acme/kit' },
      { ...free, repoCoin: async () => { throw new Error('db down'); } },
    );
    assert.equal(failed?.repo_coin_program, null);
  } finally {
    console.error = err;
  }
});

test("tokenProposalBlock: with the repo known, this agent's own token line", async () => {
  const repoUrl = 'https://github.com/acme/kit';
  const b = await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', repoUrl }, free);
  assert.ok(b);
  const line = tokenLineFor(1, repoUrl)!;
  assert.match(line, /^token: [0-9a-f]{16}$/);
  assert.ok(!b.say_to_builder.includes(line));
  // v2.6 §3: the agent writes and pushes the one ticker-free line itself.
  assert.ok(b.note.includes(`Write the line "${line}" to earnkit.txt at the repo root (default branch) and push it yourself`), b.note);
  assert.ok(b.note.includes('never ask the builder to edit files'));
  assert.ok(b.note.includes('a new ticker needs no new line'));
  assert.doesNotMatch(b.note, /payout_wallet:|creator_wallet:/);
  // Another agent asking about the same repo is shown its own line, never this one.
  const other = await tokenProposalBlock({ program: program('encouraged'), installationId: 2, projectName: 'Chain Kits', creatorWallet: '0xW', repoUrl }, free);
  assert.ok(other && !other.note.includes(line) && other.note.includes(tokenLineFor(2, repoUrl)!));
  // Another proposed ticker (another project name) gets the same line: it is bound to the repo, not the ticker.
  const renamed = await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Orbit Tools', creatorWallet: '0xW', repoUrl }, free);
  assert.ok(renamed && renamed.proposed?.symbol !== b.proposed?.symbol && renamed.note.includes(`"${line}"`));
});

test('tokenProposalBlock: null when launches are not configured', async () => {
  assert.equal(
    await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, { check: free.check, available: () => false }),
    null,
  );
});

test('tokenProposalBlock: keeps the proposal note (ticker not checked)', async () => {
  const b = await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, { check: async () => null, available: () => true });
  assert.ok(b);
  assert.equal(b.proposed?.symbol, 'CHAIN');
  assert.match(b.note, /ticker not checked for duplicates\. /);
});

test('tokenProposalBlock: no wallet yet asks for one', async () => {
  const b = await tokenProposalBlock({ program: program('allowed'), installationId: 1, projectName: 'Chain Kits', creatorWallet: null }, free);
  assert.ok(b);
  assert.equal(b.creator_wallet, null);
  assert.equal(b.earnings, EARNINGS_LINE('<your wallet>'));
  assert.match(b.note, /^Ask the builder for the wallet that receives creator fees\. /);
  assert.doesNotMatch(b.note, /payout_wallet:/);
  assert.equal(b.say_to_builder, `${coinRow({ symbol: 'CHAIN', name: 'Chain Kits', hasBonus: false })}\n\nWhich wallet should get your token's fees?\n\n${COIN_FOOTNOTE}`);
});

test('v2.7 Ruling 16 (plan), C6: every ticker taken still proposes one never checked, with a note', async () => {
  const b = await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, { check: async () => false, available: () => true });
  assert.ok(b);
  assert.ok(b.proposed.symbol);
  assert.equal(
    b.say_to_builder,
    `${coinRow({ symbol: b.proposed.symbol, name: b.proposed.name, hasBonus: false })}\n\n${walletLine({ wallet: '0xW', remembered: false, hasBonus: false })}\n\n${COIN_FOOTNOTE}`,
  );
  assert.match(b.note, /ticker not checked for duplicates/);
});

test('v2.7 Ruling 16 (plan): no project name: the repo name is the name; with neither, no block', async () => {
  const b = await tokenProposalBlock(
    { program: program('encouraged'), installationId: 1, creatorWallet: '0xW', repoUrl: 'https://github.com/a/tip-jar' },
    free,
  );
  assert.deepEqual(b?.proposed, { name: 'Tip Jar', symbol: 'TIP', image: 'monogram' });
  assert.equal(await tokenProposalBlock({ program: program('encouraged'), installationId: 1, creatorWallet: '0xW' }, free), null);
});

test('v2.7 (Ruling 31): a name problem reads "Token name:" for the builder', () => {
  assert.deepEqual(plainProblem('name: bad'), { note: 'Token name: bad', agent_note: 'name: bad' });
});

// The flow, with the database replaced by an in-memory store.
const WALLET = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
/**
 * Ruling 30: record_submission's wallet is only the one given in the call (the agent echoes the
 * wallet line the builder confirmed). These tests give WALLET unless they pass givenWallet.
 */
const tokenAfterSubmission = (a: Parameters<typeof tokenAfterSubmissionRaw>[0], deps: TokenFlowDeps) =>
  tokenAfterSubmissionRaw({ givenWallet: WALLET, ...a }, deps);
// The repo's earnkit.txt carries installation 1's token line (v2.6: one line, any ticker).
const tokenLines = (repoUrl = 'https://github.com/acme/kit') => tokenLineFor(1, repoUrl)!;
function harness(p: Partial<FlowProject> = {}, extra: Partial<TokenFlowDeps> = {}) {
  const project: FlowProject = {
    id: 7, name: 'Chain Kits', repo_url: 'https://github.com/acme/kit', live_url: 'https://kit.acme.dev',
    payout_wallet: null, creator_wallet: null, token_url: null, token_name: null, token_symbol: null,
    installation_id: 1, token_policy: 'encouraged', ...p,
  };
  const writes: unknown[] = [];
  const saved: { id: number; inst: number; w: string }[] = [];
  const deploys: Parameters<NonNullable<TokenFlowDeps['deploy']>>[0][] = [];
  const calls: string[] = [];
  const links: unknown[] = [];
  const completed: number[] = [];
  const repoTokens = new Map<string, string>();
  const deps: TokenFlowDeps = {
    available: () => true,
    limit: async () => { calls.push('limit'); },
    check: async () => true,
    gate: {
      repo: async () => { calls.push('repo'); return { fork: false, hasCommits: true, aheadOfParent: null }; },
      owner: async (r) => {
        calls.push('owner');
        return { status: 'ok', text: tokenLines(`https://github.com/${r.owner}/${r.repo}`) };
      },
      screen: async () => {},
    },
    deploy: async (a) => {
      deploys.push(a);
      return { status: 'launched', name: a.name, symbol: a.symbol, tokens_fun: 'https://tokens.fun/coin/0xT' } as TokenOutcome;
    },
    store: {
      load: async (id) => (id === project.id ? project : null),
      setStatus: async (id, s) => { writes.push({ id, ...s }); },
      repoToken: async (_id, key) => repoTokens.get(key) ?? null,
      updateLinks: async (id, inst, l) => { links.push({ id, inst, ...l }); },
      saveCreatorWallet: async (id, inst, w) => { saved.push({ id, inst, w }); },
      markComplete: async (id) => { completed.push(id); },
    },
    ...extra,
  };
  return { deps, writes, deploys, calls, links, repoTokens, project, saved, completed };
}

const CONFIRMED = { name: 'Chain Kits', symbol: 'CHAIN' };

test('Ruling 22: the wallet given with the entry goes to the launch, never the remembered one', async () => {
  const GIVEN = '0x' + '5'.repeat(40);
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: GIVEN }, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h.deploys[0].creatorWallet, GIVEN);
  assert.deepEqual(h.saved, [{ id: 7, inst: 1, w: GIVEN }], 'kept on the project and remembered');
  // creator_wallet in the token object still wins, and must pass the one wallet rule (EIP-55).
  const bad = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a4';
  const h2 = harness();
  const refused = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { ...CONFIRMED, creator_wallet: bad }, confirmed: true }, h2.deps);
  assert.equal(refused.status, 'skipped');
  assert.match(refused.note ?? '', /creator_wallet: a 0x wallet address \(check it for typos\)/);
  assert.equal(h2.deploys.length, 0);
});

test('v2.6 Ruling 18: at submission with no wallet anywhere, the coin is skipped with no_wallet and nothing deploys', async () => {
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: null }, h.deps);
  assert.equal(out.status, 'skipped');
  assert.equal(out.no_wallet, true);
  assert.equal(h.deploys.length, 0);
  assert.equal(h.calls.length, 0, 'no gate reads, no launch counted');
  assert.deepEqual(h.writes.map((w) => (w as { status: string }).status), ['skipped']);
  // launch_token without a wallet fails, without the submission marker.
  const l = harness();
  const failed = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', ...CONFIRMED }, 1, l.deps);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.no_wallet, undefined);
});

test('tokenAfterSubmission: the confirmed name and ticker launch on Base with the wallet given in the call', async () => {
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h.deploys.length, 1);
  assert.deepEqual(
    { ...h.deploys[0], image: undefined },
    { projectId: 7, installationId: 1, name: 'Chain Kits', symbol: 'CHAIN', creatorWallet: WALLET, image: undefined, imageUrl: undefined, builderX: undefined, chain: 'base', repoUrl: 'https://github.com/acme/kit', liveUrl: 'https://kit.acme.dev', background: h.deploys[0].background },
  );
  assert.equal(h.deploys[0].image, null);
});

test('tokenAfterSubmission: skip, unconfirmed and no explicit ticker store the proposal as skipped', async () => {
  for (const [choice, confirmed, re] of [
    ['skip', true, /Call launch_token later/],
    [CONFIRMED, false, /builder_confirmed/],
    [undefined, true, /exactly as shown to the builder/],
    [{ name: 'Chain Kits' }, true, /exactly as shown to the builder/],
  ] as const) {
    const h = harness();
    const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice, confirmed }, h.deps);
    assert.equal(out.status, 'skipped');
    // Ruling 31: the technical instruction is the agent's; the note is plain.
    assert.match(out.agent_note ?? '', re);
    assert.doesNotMatch(out.note ?? '', TECHNICAL_TERMS);
    assert.equal(out.symbol, 'CHAIN');
    assert.deepEqual(h.writes, [{ id: 7, status: 'skipped', note: out.note, name: 'Chain Kits', symbol: 'CHAIN' }]);
    assert.equal(h.deploys.length, 0);
  }
});

test('tokenAfterSubmission: a ticker without a name takes the cleaned project name', async () => {
  const h = harness({ name: '  Chain   Kits ' });
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { symbol: 'kits' }, confirmed: true }, h.deps);
  assert.equal(h.deploys[0].name, 'Chain Kits');
  assert.equal(h.deploys[0].symbol, 'KITS');
});

test('tokenAfterSubmission: a skipped or refused launch keeps the builder\'s valid edits', async () => {
  const h = harness();
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { name: 'Kit One', symbol: 'kone' }, confirmed: false }, h.deps);
  assert.deepEqual(h.writes, [{ id: 7, status: 'skipped', note: (h.writes[0] as { note: string }).note, name: 'Kit One', symbol: 'KONE' }]);
  // A refused edit keeps the valid half and the proposal for the rest.
  const h2 = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { name: 'Kit One', symbol: 'USDC' }, confirmed: true }, h2.deps);
  assert.equal(out.status, 'skipped');
  assert.match(out.note ?? '', /USDC/);
  // With an explicit ticker no proposal is looked up, so the stored ticker is left as it was.
  assert.deepEqual(h2.writes, [{ id: 7, status: 'skipped', note: out.note, name: 'Kit One', symbol: undefined }]);
});

test('tokenAfterSubmission: a bad token field skips the token, never the entry', async () => {
  // The entry's input accepts any token object; the token flow checks it.
  const entry = RecordSubmissionInput.parse({
    program_id: 'p', project: { name: 'Chain Kits' }, submission_data: {},
    token: { symbol: 'CHAIN', image_url: 'http://kit.acme.dev/logo.png', builder_x: '', ticker: 'X' },
    builder_confirmed: true,
  });
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: entry.token, confirmed: true }, h.deps);
  assert.equal(out.status, 'skipped');
  assert.match(out.note ?? '', /^token: /);
  assert.match(out.note ?? '', /image_url/);
  assert.deepEqual(h.writes, [{ id: 7, status: 'skipped', note: out.note }]);
  assert.equal(h.deploys.length, 0);
});

test('tokenAfterSubmission: an existing token is skipped at submission and nothing is written', async () => {
  const h = harness({ token_url: 'https://tokens.fun/coin/0x1' });
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.deepEqual(out, { status: 'skipped', note: 'This project already has a token: https://tokens.fun/coin/0x1' });
  assert.equal(h.writes.length, 0);
  assert.equal(h.deploys.length, 0);
});

test('tokenAfterSubmission: a project of another installation throws', async () => {
  const h = harness({ installation_id: 2 });
  await assert.rejects(
    tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps),
    (e: unknown) => e instanceof LaunchError && /No project 7 recorded by you/.test(e.message),
  );
});

test('submissionToken: any error becomes a failed token, logged, never a throw', async () => {
  const h = harness();
  const logged: unknown[] = [];
  const errLog = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const out = await submissionToken(
      { projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true },
      { ...h.deps, store: { ...h.deps.store!, load: async () => { throw new Error('db down'); } } },
    );
    assert.deepEqual(out, { status: 'failed', note: 'EarnKit hit an error launching the token; say "launch the token" to retry.' });
    assert.equal((logged[0] as unknown[])[0], '[token]');
  } finally {
    console.error = errLog;
  }
});

test('tokenAfterSubmission: a failed gate is stored with the launch name and ticker', async () => {
  const h = harness();
  h.deps.gate!.owner = async () => ({ status: 'missing' });
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { symbol: 'kits' }, confirmed: true }, h.deps);
  assert.equal(out.status, 'gate_failed');
  assert.match(out.note ?? '', /short proof line/);
  assert.match(out.agent_note ?? '', /earnkit\.txt/);
  assert.deepEqual(h.writes, [{ id: 7, status: 'gate_failed', note: out.note, name: 'Chain Kits', symbol: 'KITS' }]);
  assert.equal(h.deploys.length, 0);
});

test('tokenAfterSubmission: bad image data or a launch error is a failed outcome, not a throw', async () => {
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { ...CONFIRMED, image_data: 'data:text/plain;base64,aGk=' }, confirmed: true }, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /image isn't usable/);
  assert.match(out.agent_note ?? '', /image_data/);
  assert.equal(h.deploys.length, 0);

  const h2 = harness({}, { deploy: async () => { throw new LaunchError('Token launches are not available right now.'); } });
  const out2 = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h2.deps);
  assert.equal(out2.status, 'failed');
  assert.match(out2.note ?? '', /not available/);
});

test('tokenAfterSubmission: the choice wallet beats the project wallet beats the remembered one', async () => {
  const other = '0x' + 'a'.repeat(40);
  // A campaign entry's payout wallet was proven at entry; earnkit.txt is still read for the token line.
  const h = harness({ payout_wallet: other });
  // Campaign entries give no separate wallet (record_submission passes none).
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: null }, h.deps);
  assert.equal(h.deploys[0].creatorWallet, other);
  assert.ok(h.calls.includes('owner'));
  // v2.6 §3: another creator wallet needs no creator_wallet line; the token line is the proof.
  const mine = '0x' + 'b'.repeat(40);
  const h2 = harness({ payout_wallet: other });
  h2.deps.gate!.owner = async () => ({ status: 'ok', text: `payout_wallet: ${other}\n${tokenLines()}` });
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { ...CONFIRMED, creator_wallet: mine }, confirmed: true }, h2.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h2.deploys[0].creatorWallet, mine);
});

test('ownership: a repo whose earnkit.txt is missing or lacks this agent\'s line gets no token', async () => {
  const LINE = tokenLines();
  for (const [got, re] of [
    [{ status: 'missing' }, new RegExp(`^earnkit\\.txt isn't on the default branch\\. Write the line "${LINE}" to earnkit\\.txt at the root of github\\.com/acme/kit on the default branch`)],
    // A wallet line alone (copied or not) proves nothing.
    [{ status: 'ok', text: `payout_wallet: ${WALLET}\ntoken: OTHER 0123456789` }, new RegExp(`"${LINE}"`)],
    // Another agent's line for the same repo (copied from the public file).
    [{ status: 'ok', text: `payout_wallet: ${WALLET}\n${tokenLineFor(2, 'https://github.com/acme/kit')}` }, new RegExp(`"${LINE}"`)],
    [{ status: 'error', message: 'it answered 500' }, /earnkit\.txt in github\.com\/acme\/kit: it answered 500/],
  ] as const) {
    const h = harness();
    h.deps.gate!.owner = async () => { h.calls.push('owner'); return got; };
    const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
    assert.equal(out.status, 'gate_failed');
    // Final review M7: the exact line is in the agent-only note; the note is plain builder words.
    assert.match(out.agent_note ?? '', re);
    assert.doesNotMatch(out.note ?? '', /\b(add|edit|create) (a |the )?file\b|\bpush it\b|earnkit\.txt|token:/i);
    assert.equal(h.deploys.length, 0);
    // Checked after the repo.
    assert.deepEqual(h.calls, ['repo', 'owner']);
  }
});

test('one token per repo: another entry of the repo with a token is refused before the gate', async () => {
  const h = harness();
  h.repoTokens.set('github.com/acme/kit', 'https://tokens.fun/coin/0x1');
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.deepEqual(out, { status: 'skipped', note: 'This repo already has a token: https://tokens.fun/coin/0x1', name: 'Chain Kits', symbol: 'CHAIN' });
  assert.deepEqual(h.calls, []);
  const h2 = harness({ repo_url: 'https://GitHub.com/Acme/Kit.git' });
  h2.repoTokens.set('github.com/acme/kit', 'pending');
  const l = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, creator_wallet: WALLET }), 1, h2.deps);
  assert.equal(l.status, 'failed');
  assert.match(l.note ?? '', /This repo already has a token launch in progress/);
  // A claim race lost inside deployToken reads the same way.
  const h3 = harness({}, { deploy: async () => ({ status: 'failed', note: 'This repo already has a token: https://tokens.fun/coin/0x2' }) });
  const raced = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h3.deps);
  assert.equal(raced.status, 'skipped');
});

test('launch limit: counted only right before a deploy; over it is a failed outcome', async () => {
  const h = harness({}, { limit: async () => { throw new RateLimitError('This agent has launched 3 tokens today, the daily limit.', 3600); } });
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /^This agent has launched 3 tokens today, the daily limit\. Try again in an hour\.$/);
  assert.equal(h.deploys.length, 0);
  // Not counted for skips or gate failures.
  for (const [p, choice] of [[{}, 'skip'], [{ repo_url: null }, CONFIRMED]] as const) {
    const h2 = harness(p);
    await tokenAfterSubmission({ projectId: 7, installationId: 1, choice, confirmed: true }, h2.deps);
    assert.ok(!h2.calls.includes('limit'));
  }
  const h3 = harness();
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h3.deps);
  assert.equal(h3.calls.at(-1), 'limit');
});

test('launches not configured: skipped before the gate, no checks', async () => {
  for (const run of [
    (h: ReturnType<typeof harness>) => tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps),
    (h: ReturnType<typeof harness>) => launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true }), 1, h.deps),
  ]) {
    const h = harness({}, { available: () => false });
    const out = await run(h);
    assert.deepEqual(out, { status: 'skipped', note: "Token launches aren't available right now.", name: undefined, symbol: undefined });
    assert.deepEqual(h.calls, []);
    assert.equal(h.deploys.length, 0);
  }
});

test('echoing token.proposed (with image) and a token: null are accepted', async () => {
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { ...CONFIRMED, image: 'monogram' }, confirmed: true }, h.deps);
  assert.equal(out.status, 'launched');
  const h2 = harness();
  const none = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: null, confirmed: true }, h2.deps);
  assert.match(none.agent_note ?? '', /exactly as shown to the builder/);
  // Any other unknown key is named.
  const h3 = harness();
  const bad = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { ...CONFIRMED, ticker: 'X' }, confirmed: true }, h3.deps);
  assert.equal(bad.status, 'skipped');
  assert.match(bad.note ?? '', /^token: .*ticker/);
  // builder_confirmed: anything but true is not confirmation (RecordSubmissionInput takes any value).
  const parsed = RecordSubmissionInput.parse({ program_id: 'p', project: { name: 'Kit' }, submission_data: {}, token: null, builder_confirmed: 'yes' });
  assert.equal(parsed.builder_confirmed, 'yes');
  assert.equal(parsed.token, null);
});

test('the claim is bound to the links the gate checked', async () => {
  const h = harness();
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(h.deploys[0].repoUrl, 'https://github.com/acme/kit');
  assert.equal(h.deploys[0].liveUrl, 'https://kit.acme.dev');
  assert.ok(h.calls.includes('owner'));
  // launch_token's overrides are what the gate checks and what deployToken binds the claim to.
  const h2 = harness();
  await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, creator_wallet: WALLET, live_url: 'https://kit2.acme.dev' }), 1, h2.deps);
  assert.equal(h2.deploys[0].liveUrl, 'https://kit2.acme.dev/');
  // deployToken finding the row changed (a concurrent launch_token) is reported as is; nothing is recorded.
  const h3 = harness({}, { deploy: async () => ({ status: 'failed', note: "The project's links changed during the launch; call launch_token again." }) });
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h3.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /links changed/);
  assert.equal(h3.writes.length, 0);
});

test('a token that is neither "skip" nor an object is skipped with a note', async () => {
  for (const choice of ['CHAIN', [], 42, true]) {
    const h = harness();
    const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice, confirmed: true }, h.deps);
    assert.equal(out.status, 'skipped');
    assert.match(out.note ?? '', /^token: pass "skip", or an object/);
    assert.equal(h.deploys.length, 0);
  }
  assert.equal(RecordSubmissionInput.parse({ program_id: 'p', project: { name: 'Kit' }, submission_data: {}, token: [] }).token instanceof Array, true);
});

test('submission with an explicit ticker looks up no proposal (C6: only the final check of that ticker)', async () => {
  const checked: string[] = [];
  const h = harness({}, { check: async (sym) => { checked.push(sym); return true; } });
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { symbol: 'KITS' }, confirmed: true }, h.deps);
  assert.deepEqual(checked, ['KITS']);
  assert.equal(h.deploys[0].name, 'Chain Kits');
});

test('submissionToken: an error after the deploy started says to check tokens.fun', async () => {
  const errLog = console.error;
  console.error = () => {};
  try {
    const h = harness({}, { deploy: async () => { throw new Error('db write after deploy failed'); } });
    const out = await submissionToken({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: WALLET }, h.deps);
    assert.equal(out.status, 'failed');
    assert.match(out.note ?? '', /check tokens\.fun before retrying/);
  } finally {
    console.error = errLog;
  }
});

// Ruling 28: launch_token never uses the remembered wallet, so these launches pass the builder's.
const launchInput = (extra: object = {}) =>
  LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, creator_wallet: WALLET, ...extra });

test('LaunchTokenInput: only project_id and builder_confirmed are required; chain defaults to base', () => {
  assert.equal(launchInput().chain, 'base');
  assert.throws(() => LaunchTokenInput.parse({ project_id: 7 }));
  assert.throws(() => LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, extra: 1 }));
});

test('v2.9 B10: LaunchTokenInput takes offer, decision and agent; exactly one of project_id or offer; skip needs no yes', () => {
  const offer = { program_id: 'arc-microgrants', repo_url: 'https://github.com/alice/tipjar', project_name: 'TipJar' };
  const go = LaunchTokenInput.parse({ offer, builder_confirmed: true, creator_wallet: WALLET, agent: { can_push: false } });
  assert.deepEqual([go.decision, go.project_id, go.agent], ['go', undefined, { can_push: false }]);
  assert.equal(LaunchTokenInput.parse({ offer, decision: 'skip' }).decision, 'skip');
  assert.equal(launchInput().decision, 'go');
  assert.throws(() => LaunchTokenInput.parse({ offer, project_id: 7, builder_confirmed: true }), /exactly one of project_id or offer/);
  assert.throws(() => LaunchTokenInput.parse({ builder_confirmed: true }), /exactly one of project_id or offer/);
  assert.throws(() => LaunchTokenInput.parse({ offer }), /builder_confirmed/);
  assert.throws(() => LaunchTokenInput.parse({ project_id: 7, decision: 'skip' }), /pass offer/);
  assert.throws(() => LaunchTokenInput.parse({ offer: { ...offer, extra: 1 }, builder_confirmed: true }));
});

test('v2.9 T12 journey 12.1 (regression): launch_token takes the agent object every other tool takes ({ browser, can_push })', () => {
  const offer = { program_id: 'arc-microgrants', repo_url: 'https://github.com/alice/tipjar', project_name: 'TipJar' };
  // The journey's Claude Code agent passed its usual agent object with the yes and got a ZodError.
  const go = LaunchTokenInput.parse({ offer, builder_confirmed: true, creator_wallet: WALLET, agent: { browser: true, can_push: true } });
  assert.deepEqual(go.agent, { browser: true, can_push: true });
  assert.throws(() => LaunchTokenInput.parse({ offer, builder_confirmed: true, agent: { can_push: true, other: 1 } }));
});

test('launchToken: not your project throws', async () => {
  const h = harness({ installation_id: 2 });
  await assert.rejects(launchToken(launchInput(), 1, h.deps), (e: unknown) => e instanceof LaunchError && /No project 7 recorded by you/.test(e.message));
  await assert.rejects(launchToken(launchInput({ project_id: 8 }), 1, h.deps), LaunchError);
});

test('launchToken: policy off is a skipped outcome', async () => {
  for (const token_url of [null, 'https://tokens.fun/coin/0x1']) {
    const h = harness({ token_policy: 'off', token_url });
    const out = await launchToken(launchInput(), 1, h.deps);
    assert.equal(out.status, 'skipped');
    assert.match(out.note ?? '', /doesn't allow tokens/);
    assert.equal(h.deploys.length, 0);
    // A project that already has a token keeps its status.
    assert.equal(h.writes.length, token_url ? 0 : 1);
  }
});

test('launchToken: an existing token is a failed outcome and nothing is overwritten', async () => {
  const h = harness({ token_url: 'https://tokens.fun/coin/0x1' });
  const out = await launchToken(launchInput(), 1, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /already has a token/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.deploys.length, 0);
});

test('v2.8.1 §A1, §A5: a launch in progress says "launching"; settled or past 10 minutes it says so plainly; never a second launch', async () => {
  const now = Date.now();
  for (const [p, launching] of [
    [{ token_claimed_at: new Date(now - 60_000) }, true],
    // The deploy answered without a clear result (its note is set): no polling.
    [{ token_claimed_at: new Date(now - 60_000), token_note: LAUNCH_STUCK }, false],
    [{ token_claimed_at: new Date(now - 11 * 60_000) }, false],
    // Final fix wave (M1): a pending claim with no time (taken by old code after the backfill) is
    // stuck, never "launching" forever.
    [{ token_claimed_at: null }, false],
  ] as const) {
    const h = harness({ token_url: 'pending', ...p });
    const out = await launchToken(launchInput(), 1, h.deps);
    assert.equal(out.status, 'pending');
    assert.equal(out.note, launching ? LAUNCHING : LAUNCH_STUCK);
    assert.equal(out.launching, launching ? true : undefined);
    assert.equal(h.writes.length, 0);
    assert.equal(h.deploys.length, 0);
    assert.ok(!h.calls.includes('limit') && !h.calls.includes('repo'));
  }
  assert.equal(LAUNCHING, 'Your token is launching. Ask me again in a minute for its link.');
  assert.doesNotMatch(LAUNCH_STUCK, /—|coin|Clanker/i);
});

test('launchToken: reuses the stored name and ticker, and passes the chain', async () => {
  const h = harness({ token_name: 'Kit One', token_symbol: 'KONE' });
  const out = await launchToken(launchInput({ chain: 'arbitrum' }), 1, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h.deploys[0].name, 'Kit One');
  assert.equal(h.deploys[0].symbol, 'KONE');
  assert.equal(h.deploys[0].chain, 'arbitrum');
});

test('launchToken: an invalid stored ticker falls back to the proposal', async () => {
  const h = harness({ token_name: 'Kit One', token_symbol: 'toolongticker' });
  await launchToken(launchInput(), 1, h.deps);
  assert.equal(h.deploys[0].name, 'Chain Kits');
  assert.equal(h.deploys[0].symbol, 'CHAIN');
});

test('launchToken: edits win over the stored proposal', async () => {
  const h = harness({ token_name: 'Kit One', token_symbol: 'KONE' });
  await launchToken(launchInput({ symbol: 'ktwo', builder_x: '@acme' }), 1, h.deps);
  assert.equal(h.deploys[0].name, 'Kit One');
  assert.equal(h.deploys[0].symbol, 'KTWO');
  assert.equal(h.deploys[0].builderX, '@acme');
});

test('launchToken: a refused edit is failed (launch_token was asked to launch)', async () => {
  const h = harness();
  const out = await launchToken(launchInput({ symbol: 'USDC' }), 1, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /USDC/);
  assert.equal((h.writes[0] as { status: string }).status, 'failed');
});

test('launchToken: live_url and repo_url overrides are cleaned, saved, then gated', async () => {
  // A repo link only fills in a missing one (v2.5 Ruling 16: a recorded repo never changes).
  const h = harness({ live_url: 'https://broken.acme.dev', repo_url: null });
  const out = await launchToken(launchInput({ live_url: 'kit-fixed.acme.dev', repo_url: 'https://github.com/acme/kit2' }), 1, h.deps);
  assert.equal(out.status, 'launched');
  assert.deepEqual(h.links, [{ id: 7, inst: 1, repo_url: 'https://github.com/acme/kit2', live_url: 'https://kit-fixed.acme.dev/' }]);
  // A campaign entry's repo can't change; a bad link is named.
  const c = harness({ payout_wallet: WALLET });
  const refused = await launchToken(launchInput({ repo_url: 'https://github.com/acme/other' }), 1, c.deps);
  assert.equal(refused.status, 'failed');
  assert.match(refused.note ?? '', /^A campaign entry's repo/);
  assert.match(refused.agent_note ?? '', /^repo_url: a campaign entry's repo/);
  assert.equal(c.links.length, 0);
  // Nor can any recorded entry's repo (the builder bonus keys entries by it); the same repo is fine.
  const e = harness();
  const swapped = await launchToken(launchInput({ repo_url: 'https://github.com/acme/other' }), 1, e.deps);
  assert.equal(swapped.status, 'failed');
  assert.match(swapped.note ?? '', /can't change once recorded; enter the other repo as a new entry/);
  assert.match(swapped.agent_note ?? '', /^repo_url: /);
  assert.equal(e.links.length, 0);
  const bad = await launchToken(launchInput({ live_url: 'ftp://x.dev' }), 1, harness().deps);
  assert.equal(bad.status, 'failed');
  assert.match(bad.note ?? '', /^The live link isn't usable: /);
  assert.match(bad.agent_note ?? '', /^live_url: /);
  // A campaign entry may fix its live link.
  const c2 = harness({ payout_wallet: WALLET, live_url: null });
  assert.equal((await launchToken(launchInput({ live_url: 'https://kit.acme.dev' }), 1, c2.deps)).status, 'launched');
});

test('launchToken: a bad X handle is a failed outcome', async () => {
  const h = harness();
  const out = await launchToken(launchInput({ builder_x: 'not a handle!' }), 1, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /X handle/);
  assert.equal(h.deploys.length, 0);
});

test('v2.4 token retry: the creator wallet given at record_submission is kept and launch_token reuses it', async () => {
  const mine = '0x' + 'd'.repeat(40);
  const h = harness();
  // First try: no earnkit.txt yet, so the gate fails; the wallet is still kept.
  h.deps.gate!.owner = async () => ({ status: 'missing' });
  const first = await tokenAfterSubmission(
    { projectId: 7, installationId: 1, choice: { ...CONFIRMED, creator_wallet: mine }, confirmed: true },
    h.deps,
  );
  assert.equal(first.status, 'gate_failed');
  assert.deepEqual(h.saved, [{ id: 7, inst: 1, w: mine }]);
  // The builder pushes earnkit.txt; launch_token without creator_wallet uses the kept wallet.
  h.project.creator_wallet = mine;
  h.deps.gate!.owner = async (r) => ({
    status: 'ok',
    text: `payout_wallet: ${mine}\n${tokenLines(`https://github.com/${r.owner}/${r.repo}`)}`,
  });
  const retry = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base' }, 1, h.deps);
  assert.equal(retry.status, 'launched');
  assert.equal(h.deploys[0].creatorWallet, mine);
});

test('v2.4: a launch keeps the wallet it used, so fee reads know the creator', async () => {
  const h = harness();
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(h.deploys.length, 1);
  assert.deepEqual(h.saved, [{ id: 7, inst: 1, w: WALLET }]);
});

test('residual m4: a repo whose coin is entered in this SAME program gets no Ruling 25 row', async () => {
  const bonusProgram = { id: 'arc-microgrants', title: 'Arc Microgrants', token_policy: 'encouraged' as const, campaign: null, status: 'active', submission_proof: { host: 'dorahacks.io' } } as unknown as ProgramRow;
  const b = await tokenProposalBlock(
    { program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', repoUrl: 'https://github.com/acme/kit' },
    { ...free, repoCoin: async () => ({ program_id: 'arc-microgrants', title: 'Arc Microgrants' }) },
  );
  assert.equal(b?.repo_coin_program, null);
  assert.doesNotMatch(b!.say_to_builder, /this repo's token is entered in/);
});

test('residual m6: a non-Base coin on a program with a builder bonus never implies the bonus', async () => {
  const h = harness({ has_bonus: true });
  const out = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, chain: 'robinhood', creator_wallet: WALLET, ...CONFIRMED }), 1, h.deps);
  assert.equal(out.status, 'launched');
  assert.ok(out.note?.endsWith(NON_BASE_NO_BONUS), out.note);
  // Base, or a program without a bonus: no such note.
  const base = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, creator_wallet: WALLET, ...CONFIRMED }), 1, harness({ has_bonus: true }).deps);
  assert.ok(!(base.note ?? '').includes(NON_BASE_NO_BONUS));
  const plain = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, chain: 'robinhood', creator_wallet: WALLET, ...CONFIRMED }), 1, harness().deps);
  assert.ok(!(plain.note ?? '').includes(NON_BASE_NO_BONUS));  // No coin launched (gate failed): the note never mentions "this coin".
  const g = harness({ has_bonus: true });
  g.deps.gate!.owner = async () => ({ status: 'missing' });
  const gated = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, chain: 'robinhood', creator_wallet: WALLET, ...CONFIRMED }), 1, g.deps);
  assert.equal(gated.status, 'gate_failed');
  assert.ok(!(gated.note ?? '').includes(NON_BASE_NO_BONUS), gated.note);
});

test('v2.6: a stored-proposal launch with an edited ticker uses the same line; no live link needed', async () => {
  // earnkit.txt holds only the one line pushed for the proposal ($CHAIN); the builder renames to $NEWT.
  const h = harness({ live_url: null, token_name: 'Chain Kits', token_symbol: 'CHAIN' });
  h.deps.gate!.owner = async () => { h.calls.push('owner'); return { status: 'ok', text: tokenLines() }; };
  const out = await launchToken(launchInput({ symbol: 'NEWT' }), 1, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h.deploys[0].symbol, 'NEWT');
  assert.equal(h.deploys[0].liveUrl, null);
  // A v2.5 line for the old ticker proves only that ticker (Ruling 1 (plan)).
  const legacy = `token: CHAIN ${legacyTokenLineCode(1, 'https://github.com/acme/kit', 'CHAIN')}`;
  const h2 = harness();
  h2.deps.gate!.owner = async () => ({ status: 'ok', text: legacy });
  assert.equal((await launchToken(launchInput(), 1, h2.deps)).status, 'launched');
  const h3 = harness();
  h3.deps.gate!.owner = async () => ({ status: 'ok', text: legacy });
  const renamed = await launchToken(launchInput({ symbol: 'NEWT' }), 1, h3.deps);
  assert.equal(renamed.status, 'gate_failed');
  assert.match(renamed.agent_note ?? '', new RegExp(`"${tokenLines()}"`));
});

test('Rulings 28 and 30: no remembered wallet anywhere; a launch with no wallet fails with plain words', async () => {
  // A no-wallet entry: launch_token without creator_wallet fails; nothing saved, deployed or gated.
  const h = harness();
  const out = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', ...CONFIRMED }, 1, h.deps);
  assert.equal(out.status, 'failed');
  // Ruling 31: the note is plain; the instruction with the tool and field is for the agent.
  assert.equal(out.note, "Not launched: no wallet for the token's fees yet.");
  assert.match(out.agent_note ?? '', /call launch_token with creator_wallet/);
  assert.equal(out.no_wallet, undefined, 'the submission marker is for record_submission only');
  assert.deepEqual(h.saved, [], 'nothing saved as the creator wallet');
  assert.equal(h.deploys.length, 0);
  assert.deepEqual(h.calls, [], 'no gate reads, no launch counted');
  // The entry's own wallet, or the call's creator_wallet, still launches.
  const own = harness({ creator_wallet: WALLET.toLowerCase() });
  assert.equal((await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base' }, 1, own.deps)).status, 'launched');
  assert.equal(own.deploys[0].creatorWallet, WALLET.toLowerCase());
  const mine = '0x' + 'e'.repeat(40);
  const given = harness();
  await launchToken(launchInput({ creator_wallet: mine }), 1, given.deps);
  assert.equal(given.deploys[0].creatorWallet, mine);
  // Ruling 30: at submission too, only the wallet given in the call (the echoed wallet line).
  const sub = harness();
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: mine }, sub.deps);
  assert.equal(sub.deploys[0].creatorWallet, mine);
  const none = harness();
  const skipped = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: null }, none.deps);
  assert.equal(skipped.no_wallet, true);
  assert.equal(none.deploys.length, 0);
});

test('C6: a final ticker found taken is never deployed; the builder gets the next suggestion, the agent the detail', async () => {
  const taken = new Set(['CHAIN']);
  const h = harness({}, { check: async (sym) => !taken.has(sym) });
  const out = await submissionToken({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: WALLET }, h.deps);
  assert.equal(h.deploys.length, 0, 'nothing deployed');
  assert.equal(out.status, 'skipped');
  assert.equal(out.note, tickerTakenNote('KIT'));
  assert.equal(out.note, 'That ticker is taken. Pick another, or say go for $KIT.');
  assert.doesNotMatch(out.note ?? '', TECHNICAL_TERMS);
  assert.match(out.agent_note ?? '', /CHAIN is already used on tokens\.fun.*call launch_token \(it uses the stored KIT\)/);
  // The suggestion is stored, so "go" (launch_token with no changes) launches it.
  assert.deepEqual(h.writes.at(-1), { id: 7, status: 'skipped', note: out.note, name: 'Chain Kits', symbol: 'KIT' });
  // On launch_token, the same check fails the launch.
  const l = harness({}, { check: async (sym) => !taken.has(sym) });
  const failed = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET, ...CONFIRMED }, 1, l.deps);
  assert.equal(failed.status, 'failed');
  assert.equal(l.deploys.length, 0);
});

test('C6: an unreachable ticker check (null) launches as in v2.3', async () => {
  const h = harness({}, { check: async () => null });
  const out = await submissionToken({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: WALLET }, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h.deploys[0].symbol, 'CHAIN');
});

/** C7: Arc-like requirements: a live mainnet link and a repo (project fields), a description and a profile (answers). */
const ARC_REQS: FlowProject['requirements'] = [
  { key: 'live_deployment_url', label: 'Live deployment on Arc mainnet', todo: 'a live link on Arc mainnet', type: 'url', required: true, project_field: 'live_url', from: 'project' },
  { key: 'repo_url', label: 'Public repo', todo: 'a public repo link', type: 'url', required: true, project_field: 'repo_url', from: 'project' },
  { key: 'description', label: 'Short description', todo: 'a short description', type: 'text', required: true, from: 'project' },
  { key: 'builder_profile', label: 'Public builder profile', type: 'url', required: false, from: 'builder' },
];
const COMPLETE = { description: 'A tip jar for builders.' };

test('v2.8 Ruling 2 (plan): record_submission with required items missing still launches; eligibility waits on the entry instead', async () => {
  const h = harness({ requirements: ARC_REQS, live_url: null, submission_data: {} });
  const out = await submissionToken({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: WALLET }, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(out.needs, undefined);
  assert.equal(h.deploys.length, 1);
  assert.doesNotMatch(out.note ?? '', /still needs/);
});

test('v2.8 Ruling 2 (plan): launch_token on an entry missing required items launches (no C7 gate), with no needs', async () => {
  const h = harness({ requirements: ARC_REQS, live_url: null, submission_data: {} });
  const out = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET }, 1, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(out.needs, undefined);
  assert.equal(h.deploys.length, 1);
  assert.deepEqual(h.completed, [], 'not complete: complete_at is not set');
});

test('v2.8 Ruling 2 (plan): launch_token marks a complete stored entry complete (an entry from before v2.8, or a link fixed here)', async () => {
  const h = harness({ requirements: ARC_REQS, live_url: null, submission_data: COMPLETE });
  await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET }, 1, h.deps);
  assert.deepEqual(h.completed, [], 'the live link is still missing');
  // The missing link given to launch_token completes the entry.
  const t = harness({ requirements: ARC_REQS, live_url: null, submission_data: COMPLETE });
  await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET, live_url: 'https://kit.acme.dev' }, 1, t.deps);
  assert.deepEqual(t.completed, [7]);
  // Launches off: the entry is still marked complete (it is about the entry, not the token).
  const off = harness({ requirements: ARC_REQS, submission_data: COMPLETE }, { available: () => false });
  await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET }, 1, off.deps);
  assert.deepEqual(off.completed, [7]);
});

test('v2.8 Ruling 3 (plan): launch_token on a skipped entry is refused; nothing deploys, nothing is written', async () => {
  const h = harness({ confirm_choice: 'skip', requirements: ARC_REQS, submission_data: COMPLETE });
  const out = await launchToken(
    { project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET, live_url: 'https://other.acme.dev' },
    1,
    h.deps,
  );
  assert.deepEqual(out, { status: 'failed', note: SKIPPED_ENTRY });
  assert.equal(SKIPPED_ENTRY, 'This entry was entered without a token.');
  assert.equal(h.deploys.length, 0);
  assert.deepEqual(h.calls, [], 'no gate read, no ticker check, no launch counted');
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.links, []);
  assert.deepEqual(h.saved, []);
  assert.deepEqual(h.completed, []);
  // record_submission's token step on a skipped entry launches nothing either.
  const r = harness({ confirm_choice: 'skip' });
  const sub = await submissionToken({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: WALLET }, r.deps);
  assert.equal(sub.note, SKIPPED_ENTRY);
  assert.equal(r.deploys.length, 0);
  // A "go" entry launches as before.
  const g = harness({ confirm_choice: 'go' });
  assert.equal((await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET }, 1, g.deps)).status, 'launched');
});

test('C7: entryMissing: no gate for campaign entries or without requirements; invalid values count as missing', () => {
  const p = harness({ requirements: ARC_REQS, live_url: null }).project;
  assert.deepEqual(entryMissing(p).map((m) => m.key), ['live_deployment_url', 'description']);
  assert.deepEqual(entryMissing({ ...p, campaign: true }), []);
  assert.deepEqual(entryMissing({ ...p, requirements: undefined }), []);
  assert.deepEqual(entryMissing({ ...p, live_url: 'https://kit.acme.dev', submission_data: COMPLETE }), []);
  // An invalid value counts as missing, with "(check it)".
  assert.deepEqual(entryMissing({ ...p, live_url: 'http://kit', submission_data: COMPLETE }).map((m) => m.todo), ['a live link on Arc mainnet (check it)']);
});

test('v2.9 A5 (P5): entryMissing reads the stored checks; withStoredChecks only for live_url programs', async () => {
  const { withStoredChecks } = await import('./token-launch');
  const p = { ...harness({ requirements: ARC_REQS }).project, live_url: 'https://kit.acme.dev', submission_data: COMPLETE };
  const at = new Date();
  const unverified = withStoredChecks(p, { live_verified_at: null, contract_verified_at: null, needs_contract: 'arc' });
  assert.deepEqual(unverified.verified, { live: false, contract: false, needsContract: 'arc' });
  assert.deepEqual(entryMissing(unverified).map((m) => m.key), ['live_deployment_url']);
  const noContract = withStoredChecks(p, { live_verified_at: at, contract_verified_at: null, needs_contract: 'arc' });
  assert.deepEqual(entryMissing(noContract).map((m) => m.key), ['live_deployment_url']);
  assert.deepEqual(entryMissing(withStoredChecks(p, { live_verified_at: at, contract_verified_at: at, needs_contract: 'arc' })), []);
  assert.deepEqual(entryMissing(withStoredChecks(p, { live_verified_at: at, contract_verified_at: null, needs_contract: null })), []);
  // A program without a live_url requirement is left as it is (v2.8.1).
  const noLive = { ...p, requirements: ARC_REQS.filter((r) => r.project_field !== 'live_url') };
  assert.equal(withStoredChecks(noLive, { live_verified_at: null, contract_verified_at: null, needs_contract: 'arc' }).verified, undefined);
  // `known` without checks falls back to the stored ones.
  assert.deepEqual(entryMissing(unverified, { project: { live_url: 'https://kit.acme.dev', name: 'Kit' }, answers: { description: 'A kit.' } }).map((m) => m.key).includes('live_deployment_url'), true);
});

test('C7: a "no token" on an entry that is not ready says no token, not the missing items', async () => {
  const h = harness({ requirements: ARC_REQS, live_url: null });
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: 'skip', confirmed: true }, h.deps);
  assert.equal(out.note, 'Not launched: the builder said no token.');
  // An entry that already has its token is told so, never the missing items.
  const t = harness({ requirements: ARC_REQS, live_url: null, token_url: 'https://tokens.fun/coin/0x1' });
  const has = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET }, 1, t.deps);
  assert.match(has.note ?? '', /already has a token/);
});

test('final review M8: a repo that already has its token is refused before any ticker check', async () => {
  const h = harness({}, { check: async () => { h.calls.push('check'); return false; } });
  h.repoTokens.set('github.com/acme/kit', 'https://tokens.fun/coin/0x1');
  const out = await submissionToken({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true, givenWallet: WALLET }, h.deps);
  assert.equal(out.status, 'skipped');
  assert.doesNotMatch(out.note ?? '', /ticker is taken/);
  assert.deepEqual(h.calls, [], 'no tokens.fun ticker check');
  assert.equal(h.deploys.length, 0);
});

test('v2.8.1 §A5: past the reply time, launch_token answers at once: "still checking" before the deploy, "launching" after; the flow runs on', async () => {
  // Slow repo checks: nothing sent when the reply time passes.
  const slowGate = harness();
  const repo = slowGate.deps.gate!.repo!;
  slowGate.deps.gate!.repo = async (o, r) => { await new Promise((res) => setTimeout(res, 150)); return repo(o, r); };
  const t0 = Date.now();
  const early = await launchToken(launchInput(), 1, slowGate.deps, Date.now() + 30);
  assert.ok(Date.now() - t0 < 140, 'replied before the checks ended');
  assert.equal(early.status, 'skipped');
  assert.equal(early.note, STILL_CHECKING_LAUNCH);
  assert.equal(slowGate.deploys.length, 0);
  await new Promise((res) => setTimeout(res, 250));
  assert.equal(slowGate.deploys.length, 1, 'the flow ran on and deployed');
  // A slow deploy: "launching".
  const slowDeploy = harness();
  const deploy = slowDeploy.deps.deploy!;
  slowDeploy.deps.deploy = async (a) => { await new Promise((res) => setTimeout(res, 150)); return deploy(a); };
  const mid = await launchToken(launchInput(), 1, slowDeploy.deps, Date.now() + 30);
  assert.deepEqual([mid.status, mid.note, mid.launching], ['pending', LAUNCHING, true]);
  await new Promise((res) => setTimeout(res, 250));
  // In time: the flow's own outcome.
  const fast = harness();
  assert.equal((await launchToken(launchInput(), 1, fast.deps, Date.now() + 5_000)).status, 'launched');
});
