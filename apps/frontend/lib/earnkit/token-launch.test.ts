import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProgramRow } from './programs';
import { EARNINGS_LINE, LaunchError, type TokenOutcome } from './tokens';
import { RecordSubmissionInput } from './projects';
import {
  LaunchTokenInput,
  decideToken,
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
const free = { check: async () => true };

test('tokenProposalBlock: null when tokens are off or there is no project name', async () => {
  assert.equal(await tokenProposalBlock({ program: program('off'), projectName: 'Chain Kits', creatorWallet: '0xW' }, free), null);
  assert.equal(await tokenProposalBlock({ program: program('encouraged'), creatorWallet: '0xW' }, free), null);
  assert.equal(await tokenProposalBlock({ program: program('encouraged'), projectName: '  ', creatorWallet: '0xW' }, free), null);
});

test('tokenProposalBlock: the proposal, earnings, terms and the line to show', async () => {
  const b = await tokenProposalBlock({ program: program('encouraged'), projectName: 'Chain Kits', creatorWallet: '0xW' }, free);
  assert.ok(b);
  assert.deepEqual(b.proposed, { name: 'Chain Kits', symbol: 'CHAIN', image: 'monogram' });
  assert.equal(b.chain, 'base');
  assert.equal(b.paired_with, 'WETH');
  assert.equal(b.creator_wallet, '0xW');
  assert.equal(b.earnings, EARNINGS_LINE('0xW'));
  assert.equal(b.policy, 'encouraged');
  assert.match(b.terms.agreement, /^https:\/\/tokens\.fun\//);
  assert.match(b.say_to_builder, /Chain Kits/);
  assert.match(b.say_to_builder, /\$CHAIN/);
  assert.match(b.say_to_builder, /no token/);
  assert.match(b.say_to_builder, /Base Batches/);
  assert.equal(b.note, undefined);
});

test('tokenProposalBlock: no wallet yet asks for one', async () => {
  const b = await tokenProposalBlock({ program: program('allowed'), projectName: 'Chain Kits', creatorWallet: null }, free);
  assert.ok(b);
  assert.equal(b.creator_wallet, null);
  assert.equal(b.earnings, EARNINGS_LINE('<your wallet>'));
  assert.equal(b.note, 'Ask the builder for the wallet that receives creator fees.');
});

test('tokenProposalBlock: no proposal asks the builder to pick one', async () => {
  const b = await tokenProposalBlock({ program: program('encouraged'), projectName: 'Chain Kits', creatorWallet: '0xW' }, { check: async () => false });
  assert.ok(b);
  assert.equal(b.proposed, null);
  assert.match(b.say_to_builder, /pick a name and ticker/);
  assert.match(b.note ?? '', /taken/);
});

// The flow, with the database replaced by an in-memory store.
const WALLET = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
function harness(p: Partial<FlowProject> = {}, extra: Partial<TokenFlowDeps> = {}) {
  const project: FlowProject = {
    id: 7, name: 'Chain Kits', repo_url: 'https://github.com/acme/kit', live_url: 'https://kit.acme.dev',
    payout_wallet: null, token_url: null, token_name: null, token_symbol: null,
    installation_id: 1, token_policy: 'encouraged', ...p,
  };
  const writes: unknown[] = [];
  const deploys: Parameters<NonNullable<TokenFlowDeps['deploy']>>[0][] = [];
  const deps: TokenFlowDeps = {
    check: async () => true,
    gate: { repo: async () => ({ fork: false, hasCommits: true }), probe: async () => {}, screen: async () => {} },
    deploy: async (a) => {
      deploys.push(a);
      return { status: 'launched', name: a.name, symbol: a.symbol, tokens_fun: 'https://tokens.fun/coin/0xT' } as TokenOutcome;
    },
    store: {
      load: async (id) => (id === project.id ? project : null),
      setStatus: async (id, s) => { writes.push({ id, ...s }); },
      rememberedWallet: async () => WALLET,
    },
    ...extra,
  };
  return { deps, writes, deploys };
}

const CONFIRMED = { name: 'Chain Kits', symbol: 'CHAIN' };

test('tokenAfterSubmission: the confirmed name and ticker launch on Base with the remembered wallet', async () => {
  const h = harness();
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(out.status, 'launched');
  assert.equal(h.deploys.length, 1);
  assert.deepEqual(
    { ...h.deploys[0], image: undefined },
    { projectId: 7, installationId: 1, name: 'Chain Kits', symbol: 'CHAIN', creatorWallet: WALLET, image: undefined, imageUrl: undefined, builderX: undefined, chain: 'base' },
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
  assert.deepEqual(h2.writes, [{ id: 7, status: 'skipped', note: out.note, name: 'Kit One', symbol: 'CHAIN' }]);
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
  const h = harness({ live_url: null });
  const out = await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { symbol: 'kits' }, confirmed: true }, h.deps);
  assert.equal(out.status, 'gate_failed');
  assert.match(out.note ?? '', /live link/);
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
  const h = harness({ payout_wallet: other });
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: CONFIRMED, confirmed: true }, h.deps);
  assert.equal(h.deploys[0].creatorWallet, other);
  const mine = '0x' + 'b'.repeat(40);
  const h2 = harness({ payout_wallet: other });
  await tokenAfterSubmission({ projectId: 7, installationId: 1, choice: { ...CONFIRMED, creator_wallet: mine }, confirmed: true }, h2.deps);
  assert.equal(h2.deploys[0].creatorWallet, mine);
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

test('launchToken: a bad X handle is a failed outcome', async () => {
  const h = harness();
  const out = await launchToken(launchInput({ builder_x: 'not a handle!' }), 1, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /X handle/);
  assert.equal(h.deploys.length, 0);
});
