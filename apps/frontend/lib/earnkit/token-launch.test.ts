import './fixtures/no-network-checks';
import { after, test } from 'node:test';
process.env.EARNKIT_AUTH_SECRET = 'launch-test-secret';
import assert from 'node:assert/strict';
import type { ProgramRow } from './programs';
import { LaunchError, type TokenOutcome } from './tokens';
import { RecordSubmissionInput } from './projects';
import { tokenLineFor } from './token-gate';
import { sql } from './db';
import {
  LAUNCHING,
  LAUNCH_STUCK,
  LaunchTokenInput,
  TECHNICAL_TERMS,
  decideToken,
  entryMissing,
  plainProblem,
  tickerTakenNote,
  launchToken,
  submissionToken,
  tokenAfterSubmission as tokenAfterSubmissionRaw,
  tokenProposalBlock,
  type FlowProject,
  type TokenFlowDeps,
} from './token-launch';

// The launch reads sharedGroup (the proof branch) from the database when one is set: close the pool after.
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('decideToken', () => {
  const base = { policy: 'encouraged' as const, choice: undefined, confirmed: true, existingTokenUrl: null, proposal: { name: 'Chain Kits', symbol: 'CKIT' }, wallet: '0xW' };
  assert.deepEqual(decideToken(base), { action: 'launch', name: 'Chain Kits', symbol: 'CKIT' });
  assert.equal(decideToken({ ...base, choice: 'skip' }).action, 'skip');
  assert.match((decideToken({ ...base, policy: 'off' }) as { note: string }).note, /doesn't allow tokens/);
  assert.match((decideToken({ ...base, confirmed: false }) as { agent_note: string }).agent_note, /Pass yes: true once the builder has seen the token row/);
  assert.match((decideToken({ ...base, existingTokenUrl: 'https://tokens.fun/coin/0x1' }) as { note: string }).note, /already has a token/);
  assert.match((decideToken({ ...base, wallet: null }) as { note: string }).note, /no wallet for the token's fees/);
  assert.match((decideToken({ ...base, wallet: null }) as { agent_note: string }).agent_note, /call confirm with project_id, yes: true and that wallet/);
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
  assert.match((decideToken({ ...base, confirmed: false, choice: { symbol: 'USDC' } }) as { agent_note: string }).agent_note, /Pass yes: true once the builder has seen the token row/);
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
  assert.match((decideToken({ ...base, confirmed: false }) as { agent_note: string }).agent_note, /Pass yes: true once the builder has seen the token row/);
});

const program = (policy: 'encouraged' | 'allowed' | 'off') =>
  ({ title: 'Base Batches', token_policy: policy, campaign: null }) as unknown as ProgramRow;
const free = { check: async () => true, available: () => true };

test('tokenProposalBlock: null when tokens are off or there is no project name', async () => {
  assert.equal(await tokenProposalBlock({ program: program('off'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, free), null);
  assert.equal(await tokenProposalBlock({ program: program('encouraged'), installationId: 1, creatorWallet: '0xW' }, free), null);
  assert.equal(await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: '  ', creatorWallet: '0xW' }, free), null);
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
  assert.match(b.note, /^Ask the builder for the wallet that receives creator fees\. /);
  assert.doesNotMatch(b.note, /payout_wallet:/);
});

test('v2.7 Ruling 16 (plan), C6: every ticker taken still proposes one never checked, with a note', async () => {
  const b = await tokenProposalBlock({ program: program('encouraged'), installationId: 1, projectName: 'Chain Kits', creatorWallet: '0xW' }, { check: async () => false, available: () => true });
  assert.ok(b);
  assert.ok(b.proposed.symbol);
  assert.match(b.note, /ticker not checked for duplicates/);
});

test('v2.7 Ruling 16 (plan): no project name: the repo name is the name; with neither, no block', async () => {
  const b = await tokenProposalBlock(
    { program: program('encouraged'), installationId: 1, creatorWallet: '0xW', repoUrl: 'https://github.com/a/tip-jar' },
    free,
  );
  assert.deepEqual(b?.proposed, { name: 'Tip Jar', symbol: 'TIP', image: 'mark' });
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
    // v2.10 item 12: no site or GitHub read; a test about the logo passes its own.
    logo: async () => null,
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

test('tokenAfterSubmission: skip, unconfirmed and no explicit ticker store the proposal as skipped', async () => {
  for (const [choice, confirmed, re] of [
    ['skip', true, /Call confirm with project_id and yes: true later/],
    [CONFIRMED, false, /Pass yes: true once the builder has seen the token row/],
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

test('launchToken: a refused edit is failed (launch_token was asked to launch)', async () => {
  const h = harness();
  const out = await launchToken(launchInput({ symbol: 'USDC' }), 1, h.deps);
  assert.equal(out.status, 'failed');
  assert.match(out.note ?? '', /USDC/);
  assert.equal((h.writes[0] as { status: string }).status, 'failed');
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
  assert.match(out.agent_note ?? '', /CHAIN is already used on tokens\.fun.*call confirm with project_id and yes: true \(it uses the stored KIT\)/);
  // The suggestion is stored, so "go" (launch_token with no changes) launches it.
  assert.deepEqual(h.writes.at(-1), { id: 7, status: 'skipped', note: out.note, name: 'Chain Kits', symbol: 'KIT' });
  // On launch_token, the same check fails the launch.
  const l = harness({}, { check: async (sym) => !taken.has(sym) });
  const failed = await launchToken({ project_id: 7, builder_confirmed: true, chain: 'base', creator_wallet: WALLET, ...CONFIRMED }, 1, l.deps);
  assert.equal(failed.status, 'failed');
  assert.equal(l.deploys.length, 0);
});

/** C7: Arc-like requirements: a live mainnet link and a repo (project fields), a description and a profile (answers). */
const ARC_REQS: FlowProject['requirements'] = [
  { key: 'live_deployment_url', label: 'Live deployment on Arc mainnet', todo: 'a live link on Arc mainnet', type: 'url', required: true, project_field: 'live_url', from: 'project' },
  { key: 'repo_url', label: 'Public repo', todo: 'a public repo link', type: 'url', required: true, project_field: 'repo_url', from: 'project' },
  { key: 'description', label: 'Short description', todo: 'a short description', type: 'text', required: true, from: 'project' },
  { key: 'builder_profile', label: 'Public builder profile', type: 'url', required: false, from: 'builder' },
];
const COMPLETE = { description: 'A tip jar for builders.' };

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
