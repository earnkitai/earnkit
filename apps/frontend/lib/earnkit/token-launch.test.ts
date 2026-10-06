import { test } from 'node:test';
process.env.EARNKIT_AUTH_SECRET = 'launch-test-secret';
import assert from 'node:assert/strict';
import type { ProgramRow } from './programs';
import { RateLimitError } from './rate-limit';
import { EARNINGS_LINE, LaunchError, TOKEN_TERMS, type TokenOutcome } from './tokens';
import { RecordSubmissionInput } from './projects';
import { legacyTokenLineCode, tokenLineFor } from './token-gate';
import { TOKEN_FOOTNOTE, coinRow, tokenFootnote, tokenRow, walletLine } from './entry-text';
import {
  NON_BASE_NO_BONUS,
  LaunchTokenInput,
  decideToken,
  hasBuilderBonus,
  launchToken,
  submissionToken,
  tokenAfterSubmission,
  tokenProposalBlock,
  type FlowProject,
  type TokenFlowDeps,
} from './token-launch';

test('decideToken', () => {
  const base = { policy: 'encouraged' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW' };
  assert.deepEqual(decideToken(base), { action: 'launch', name: 'Chain Kits', symbol: 'CKIT' });
  assert.equal(decideToken({ ...base, choice: 'skip' }).action, 'skip');
  assert.match((decideToken({ ...base, policy: 'off' }) as { note: string }).note, /doesn't allow tokens/);
  assert.match((decideToken({ ...base, confirmed: false }) as { note: string }).note, /builder_confirmed/);
  assert.match((decideToken({ ...base, existingTokenUrl: 'https://tokens.fun/coin/0x1' }) as { note: string }).note, /already has a token/);
  assert.match((decideToken({ ...base, wallet: null }) as { note: string }).note, /creator wallet/);
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
  // A pending launch reads as in progress, not as a token.
  assert.match((decideToken({ ...base, existingTokenUrl: 'pending' }) as { note: string }).note, /in progress/);
});

test('decideToken: checks run in order', () => {
  const base = { policy: 'encouraged' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW' };
  // policy before skip; skip before an existing token; existing token before confirmation.
  assert.match((decideToken({ ...base, policy: 'off', choice: 'skip' }) as { note: string }).note, /doesn't allow tokens/);
  assert.equal(decideToken({ ...base, choice: 'skip', existingTokenUrl: 'https://x' }).action, 'skip');
  assert.match((decideToken({ ...base, confirmed: false, existingTokenUrl: 'https://x' }) as { note: string }).note, /already has a token/);
  // confirmation before edits; edits before the wallet.
  assert.match((decideToken({ ...base, confirmed: false, choice: { symbol: 'USDC' } }) as { note: string }).note, /builder_confirmed/);
  assert.match((decideToken({ ...base, wallet: null, choice: { symbol: 'USDC' } }) as { note: string }).note, /symbol/);
  // An edit's problem is named even when there is no proposal to fall back on.
  assert.match((decideToken({ ...base, proposal: null, choice: { symbol: 'USDC' } }) as { note: string }).note, /symbol: USDC/);
});

test('decideToken: at submission only an explicit ticker launches', () => {
  const base = { policy: 'encouraged' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW', needsSymbol: true };
  for (const choice of [undefined, {}, { name: 'Chain Kits' }, { symbol: '  ' }]) {
    const d = decideToken({ ...base, choice });
    assert.equal(d.action, 'skip');
    assert.match((d as { note: string }).note, /exactly as shown to the builder/);
  }
  assert.deepEqual(decideToken({ ...base, choice: { symbol: 'ckit' } }), { action: 'launch', name: 'Chain Kits', symbol: 'CKIT' });
  // Unconfirmed reads as unconfirmed, and an existing token as a token, before the ticker rule.
  assert.match((decideToken({ ...base, confirmed: false }) as { note: string }).note, /builder_confirmed/);
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
    `${coinRow({ symbol: 'CHAIN', hasBonus: false })}\n\n${walletLine({ wallet: '0xW', remembered: false, hasBonus: false })}\n\n${tokenFootnote('0xW')}`,
  );
  assert.ok(TOKEN_FOOTNOTE.includes(TOKEN_TERMS.agreement) && TOKEN_FOOTNOTE.includes(TOKEN_TERMS.risks));
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
    `${coinRow({ symbol: 'CHAIN', hasBonus: true })}\n\n${walletLine({ wallet: '0xW', remembered: false, hasBonus: true })}\n\n${tokenFootnote('0xW')}`,
  );
  assert.match(b.say_to_builder, /skip: no coin, no builder bonus/);
  // Ruling 10: a remembered wallet says so on the wallet line.
  const r = await tokenProposalBlock({ program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', remembered: true }, free);
  assert.match(r!.say_to_builder, /\(yours from last time\) — or tell me another\./);
  // Campaigns keep v2.4's token row.
  const camp = { ...bonusProgram, campaign: { kind: 'earnkit' } } as unknown as ProgramRow;
  const c = await tokenProposalBlock({ program: camp, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, free);
  assert.equal(c!.say_to_builder, `${tokenRow('CHAIN', false)}\n\n${tokenFootnote('0xW')}`);
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
  assert.equal(b.say_to_builder, "no builder bonus: this repo's coin is entered in Arc Microgrants");
  assert.match(b.note, /don't pass token/);
  // A repo without a coin keeps the default row; a failed lookup never fails the block.
  const fresh = await tokenProposalBlock(
    { program: bonusProgram, installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW', repoUrl: 'https://github.com/acme/new' },
    { ...free, repoCoin },
  );
  assert.equal(fresh?.repo_coin_program, null);
  assert.match(fresh!.say_to_builder, /skip: no coin, no builder bonus/);
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
  assert.equal(b.say_to_builder, `${coinRow({ symbol: 'CHAIN', hasBonus: false })}\n\nWhich wallet should get your coin's fees?\n\n${TOKEN_FOOTNOTE}`);
});

test('tokenProposalBlock: no proposal asks the builder to pick one', async () => {
  const b = await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, { check: async () => false, available: () => true });
  assert.ok(b);
  assert.equal(b.proposed, null);
  assert.equal(
    b.say_to_builder,
    `${coinRow({ symbol: null, hasBonus: false })}\n\n${walletLine({ wallet: '0xW', remembered: false, hasBonus: false })}\n\n${tokenFootnote('0xW')}`,
  );
  assert.match(b.note, /taken/);
});

// The flow, with the database replaced by an in-memory store.
const WALLET = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
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
      rememberedWallet: async () => WALLET,
      repoToken: async (_id, key) => repoTokens.get(key) ?? null,
      updateLinks: async (id, inst, l) => { links.push({ id, inst, ...l }); },
      saveCreatorWallet: async (id, inst, w) => { saved.push({ id, inst, w }); },
    },
    ...extra,
  };
  return { deps, writes, deploys, calls, links, repoTokens, project, saved };
}

const CONFIRMED = { name: 'Chain Kits', symbol: 'CHAIN' };

test('v2.6 Ruling 18: at submission with no wallet anywhere, the coin is skipped with no_wallet and nothing deploys', async () => {
  const h = harness();
  h.deps.store!.rememberedWallet = async () => null;
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(out.status, 'skipped');
  assert.equal(out.no_wallet, true);
  assert.equal(h.deploys.length, 0);
  assert.equal(h.calls.length, 0, 'no gate reads, no launch counted');
  assert.deepEqual(h.writes.map((w) => (w as { status: string }).status), ['skipped']);
  // launch_token without a wallet fails, without the submission marker.
  const l = harness();
  l.deps.store!.rememberedWallet = async () => null;
  const failed = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', ...CONFIRMED }, 1, l.deps);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.no_wallet, undefined);
});

test('tokenAfterSubmission: the confirmed name and ticker launch on Base with the remembered wallet', async () => {
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h.deploys.length, 1);
  assert.deepEqual(
    { ...h.deploys[0], image: undefined },
    { projectId: 7, installationId: 1, name: 'Chain Kits', symbol: 'CHAIN', creatorWallet: WALLET, image: undefined, imageUrl: undefined, builderX: undefined, chain: 'base', repoUrl: 'https://github.com/acme/kit', liveUrl: 'https://kit.acme.dev' },
  );
  assert.equal(h.deploys[0].image, null);
});

test('tokenAfterSubmission: skip, unconfirmed and no explicit ticker store the proposal as skipped', async () => {
  for (const [choice, confirmed, re] of [
    ['skip', true, /no token/],
    [CONFIRMED, false, /builder_confirmed/],
    [undefined, true, /exactly as shown to the builder/],
    [{ name: 'Chain Kits' }, true, /exactly as shown to the builder/],
  ] as const) {
    const h = harness();
    const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice, confirmed }, h.deps);
    assert.equal(out.status, 'skipped');
    assert.match(out.note ?? '', re);
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
  assert.match(out.note ?? '', /earnkit\.txt/);
  assert.deepEqual(h.writes, [{ id: 7, status: 'gate_failed', note: out.note, name: 'Chain Kits', symbol: 'KITS' }]);
  assert.equal(h.deploys.length, 0);
});

test('tokenAfterSubmission: bad image data or a launch error is a failed outcome, not a throw', async () => {
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { ...CONFIRMED, image_data: 'data:text/plain;base64,aGk=' }, confirmed: true }, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /image_data/);
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
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
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
    [{ status: 'missing' }, new RegExp(`proof you can push to github\\.com/acme/kit.*"${LINE}"`)],
    // A wallet line alone (copied or not) proves nothing.
    [{ status: 'ok', text: `payout_wallet: ${WALLET}\ntoken: OTHER 0123456789` }, new RegExp(`Add the line "${LINE}" to earnkit\\.txt`)],
    // Another agent's line for the same repo (copied from the public file).
    [{ status: 'ok', text: `payout_wallet: ${WALLET}\n${tokenLineFor(2, 'https://github.com/acme/kit')}` }, new RegExp(`Add the line "${LINE}"`)],
    [{ status: 'error', message: 'it answered 500' }, /couldn't read earnkit\.txt/],
  ] as const) {
    const h = harness();
    h.deps.gate!.owner = async () => { h.calls.push('owner'); return got; };
    const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
    assert.equal(out.status, 'gate_failed');
    assert.match(out.note ?? '', re);
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
  const l = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true }), 1, h2.deps);
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
  assert.match(none.note ?? '', /exactly as shown to the builder/);
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
  await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, live_url: 'https://kit2.acme.dev' }), 1, h2.deps);
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

test('submission with an explicit ticker looks up no proposal', async () => {
  let checked = 0;
  const h = harness({}, { check: async () => { checked++; return true; } });
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { symbol: 'KITS' }, confirmed: true }, h.deps);
  assert.equal(checked, 0);
  assert.equal(h.deploys[0].name, 'Chain Kits');
});

test('submissionToken: an error after the deploy started says to check tokens.fun', async () => {
  const errLog = console.error;
  console.error = () => {};
  try {
    const h = harness({}, { deploy: async () => { throw new Error('db write after deploy failed'); } });
    const out = await submissionToken({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
    assert.equal(out.status, 'failed');
    assert.match(out.note ?? '', /check tokens\.fun before retrying/);
  } finally {
    console.error = errLog;
  }
});

const launchInput = (extra: object = {}) =>
  LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, ...extra });

test('LaunchTokenInput: only project_id and builder_confirmed are required; chain defaults to base', () => {
  assert.equal(launchInput().chain, 'base');
  assert.throws(() => LaunchTokenInput.parse({ project_id: 7 }));
  assert.throws(() => LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, extra: 1 }));
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
  for (const url of ['https://tokens.fun/coin/0x1', 'pending']) {
    const h = harness({ token_url: url });
    const out = await launchToken(launchInput(), 1, h.deps);
    assert.equal(out.status, 'failed');
    assert.match(out.note ?? '', url === 'pending' ? /in progress/ : /already has a token/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.deploys.length, 0);
  }
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
  assert.match(refused.note ?? '', /^repo_url: a campaign entry's repo/);
  assert.equal(c.links.length, 0);
  // Nor can any recorded entry's repo (the builder bonus keys entries by it); the same repo is fine.
  const e = harness();
  const swapped = await launchToken(launchInput({ repo_url: 'https://github.com/acme/other' }), 1, e.deps);
  assert.equal(swapped.status, 'failed');
  assert.match(swapped.note ?? '', /can't change once recorded; record a new entry for a different repo/);
  assert.equal(e.links.length, 0);
  const bad = await launchToken(launchInput({ live_url: 'ftp://x.dev' }), 1, harness().deps);
  assert.equal(bad.status, 'failed');
  assert.match(bad.note ?? '', /^live_url: /);
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
  h.deps.store!.rememberedWallet = async () => null;
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
  assert.doesNotMatch(b!.say_to_builder, /this repo's coin is entered in/);
});

test('residual m6: a non-Base coin on a program with a builder bonus never implies the bonus', async () => {
  const h = harness({ has_bonus: true });
  const out = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, chain: 'robinhood', ...CONFIRMED }), 1, h.deps);
  assert.equal(out.status, 'launched');
  assert.ok(out.note?.endsWith(NON_BASE_NO_BONUS), out.note);
  // Base, or a program without a bonus: no such note.
  const base = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, ...CONFIRMED }), 1, harness({ has_bonus: true }).deps);
  assert.ok(!(base.note ?? '').includes(NON_BASE_NO_BONUS));
  const plain = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, chain: 'robinhood', ...CONFIRMED }), 1, harness().deps);
  assert.ok(!(plain.note ?? '').includes(NON_BASE_NO_BONUS));  // No coin launched (gate failed): the note never mentions "this coin".
  const g = harness({ has_bonus: true });
  g.deps.gate!.owner = async () => ({ status: 'missing' });
  const gated = await launchToken(LaunchTokenInput.parse({ project_id: 7, builder_confirmed: true, chain: 'robinhood', ...CONFIRMED }), 1, g.deps);
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
  assert.match(renamed.note ?? '', new RegExp(`Add the line "${tokenLines()}"`));
});
