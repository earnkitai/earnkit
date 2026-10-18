import './fixtures/no-network-checks';
import { randomBytes } from 'node:crypto';
import { after, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { BUILD_COIN_NOTE, BUILD_NO_LIVE_NOTE, BUILD_PENDING_NOTE, BUILD_WALLET_NOTE, NOTED_FOR_NOW, eligibilityLine, freshSwitches, withoutTokenLine, withoutBonusLine, WALLET_IGNORED, canBuild, listProgramsInput, matchRows, tools, handlers } from './tools';
import { aliasCall } from './aliases';
import { reportedGithubUser, reportedRepos } from './match-projects';
import { sql } from './db';
import { EntryError } from './campaigns';
import { earnkitTexts } from './campaign-text';
import { ProgramFile, type SubmissionRequirement } from './program-file';
import { PLAIN_FIX, PLAIN_NOTE, coachIntro, questionsFor } from './coach';
import { projectKey, readBank } from './answer-bank';
import { alsoProgramFacts, getProgramRow, upsertProgram } from './programs';
import { guideText, programGuide } from './guide';
import { rememberWallet, saveBuild, setWorkingOn } from './installations';
import { enteredProgramIds, hasProgramEntry } from './projects';
import { setSanctionsOracle } from './sanctions';
import { tokenLineFor } from './token-gate';
import type { DeployDeps } from './deploy';
import { freshLead, presentFirstMessage } from './present';
import { launchLimit, type TokenFlowDeps } from './token-launch';
import { fakeGitHub } from './fixtures/fake-github-branch';
import { offerKey, saveOffer } from './token-offers';
import { proposeToken } from './token-proposal';
import { LaunchError } from './tokens';
import { wonSource } from './stats';
import { EMAIL_NOTE, EMAIL_ON, EMAIL_QUESTION, EMAIL_SHARED_NOTE, EMAIL_SIGN_IN, emailQuestionFor } from './digest';
import { completeVerify, createVerifyLink, formatCode } from './github-verify';
import { committedProgram } from './fixtures/program-file';
import { dropPrograms, dropRunPrograms } from './fixtures/find';
import { TESTED_STARTERS, fileCards } from './fixtures/fresh-build';
import { BUILD_CHAT_ONLY, buildKit, twistQuestion } from './fresh-build';
import { STARTERS } from './starters';
import { ARC_TIPJAR_BYTECODE } from './fixtures/arc-tipjar-artifact';
import { eventsByKey, eventsOfInstallation, withEventLog } from './fixtures/events';
import { alsoQualifies, alsoText, type AlsoRow } from './also-qualifies';
import type { Chain } from './match';

// ---- v2.8.1 §B6: list_programs' input never fails on what an agent reports ----
test('v2.8.1 §B6: a wallet that is not 0x is ignored with a note; a 0x one is kept', () => {
  const W = '0x' + 'ab'.repeat(20);
  const kept = listProgramsInput({ wallet: ` ${W} ` });
  assert.deepEqual({ wallet: kept.wallet, walletNote: kept.walletNote }, { wallet: W, walletNote: null });
  for (const bad of ['vitalik.eth', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', '0x123', 42])
    assert.deepEqual(
      (({ wallet, walletNote }) => ({ wallet, walletNote }))(listProgramsInput({ wallet: bad })),
      { wallet: undefined, walletNote: WALLET_IGNORED },
      String(bad),
    );
  assert.equal(listProgramsInput({}).walletNote, null);
  assert.equal(listProgramsInput({ wallet: '' }).walletNote, null);
  assert.doesNotMatch(WALLET_IGNORED, /—|coin|Clanker/);
});

test('v2.8.1 §B6 (fix round 2): github_user, repos and agent_can_build are read leniently, never refused', () => {
  for (const [given, want] of [
    ['octocat', 'octocat'], ['@octocat', 'octocat'], [' https://github.com/octocat/ ', 'octocat'],
    ['github.com/octocat/tipjar', 'octocat'], ['not a user!!', undefined], [42, undefined], ['', undefined],
  ] as const)
    assert.equal(reportedGithubUser(given), want, String(given));
  assert.deepEqual(reportedRepos('acme/tipjar'), ['acme/tipjar']);
  assert.deepEqual(reportedRepos(['github.com/acme/tipjar', 5, 'not a repo', null, 'https://github.com/a/b.git']), [
    'https://github.com/acme/tipjar',
    'https://github.com/a/b.git',
  ]);
  assert.deepEqual(reportedRepos({ owner: 'acme' }), []);
  assert.equal(reportedRepos(Array(40).fill('a/b')).length, 30);
  for (const [given, want] of [
    [true, true], [false, false], ['true', true], ['false', false], ['yes', true], ['no', false], ['NO', false],
    [1, true], [0, false], ['maybe', true], [null, true], [undefined, true], [7, true],
  ] as const)
    assert.equal(canBuild(given), want, String(given));
  const i = listProgramsInput({ github_user: '@octocat', repos: ['nope'], agent_can_build: 'no' });
  assert.deepEqual([i.github_user, i.repos, i.agent_can_build], ['octocat', undefined, false]);
});

test('v2.8.1 §B6: list_programs input with any chain, dates without a timezone and a bare live link parses', () => {
  const i = listProgramsInput({
    local_repos: [
      { name: 'ethapp', chains: [{ chain: 'ethereum', mainnet: true }], last_commit_at: '2026-10-01', live_url: 'ethapp.xyz' },
      { name: 'tipjar', chains: ['base', 'optimism'], last_commit_at: '2026-10-01 09:00' },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(i.local_repos)), [
    { name: 'ethapp', chains: [], last_commit_at: '2026-10-01T00:00:00.000Z', live_url: 'https://ethapp.xyz' },
    { name: 'tipjar', chains: [{ chain: 'base', mainnet: true }], last_commit_at: '2026-10-01T09:00:00.000Z' },
  ]);
});

// Against the local database when configured.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
/** Task 17: an active campaign copy a test makes is gone (or closed) when the test ends, so no other file sees it later. */
const dropAfter = (tc: TestContext, ...ids: string[]) => tc.after(() => dropPrograms(ids));
// v2.10 item 2: the list_programs tests below read the v2.9 tables, which are behind "show more"
// (more: true); the short first reply is tested in 8.8.

/**
 * v2.8 Task 11: other dbTests leave stray active, curated, non-campaign programs behind, which
 * record_submission's "Also qualifies" (Ruling 29 (plan)) and find's tables would pick up, breaking
 * exact assertions. Task 17: this builder says "not interested" to every such program but `keep`
 * (their own memory, builder-memory.ts hiddenPrograms), never closing programs other files read.
 */
async function hideOthers(installationId: number, keep: string[]): Promise<void> {
  await sql()`
    INSERT INTO builder_program_status (installation_id, login, program_id, status)
    SELECT ${installationId}, '', id, 'not_interested' FROM programs
    WHERE status = 'active' AND source = 'file' AND campaign IS NULL AND id NOT IN ${sql()(keep)}
    ON CONFLICT (installation_id, login, program_id) DO NOTHING`;
}

test('v2.4 §2: a failed entry uses none of the daily 20; a recorded one uses one', dbTest, async (tc) => {
  const PAY = '0x' + 'a'.repeat(40);
  const C1 = '0x' + '1'.repeat(40);
  const f = committedProgram('earnkit-campaign-1-base');
  Object.assign(f, {
    id: `t4-limit-${process.pid}-${Date.now()}`,
    status: 'active',
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2099-01-01T00:00:00Z',
  });
  Object.assign(f, earnkitTexts(f));
  await upsertProgram(ProgramFile.parse(f));
  dropAfter(tc, f.id);
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t4-limit-${process.pid}-${Date.now()}`}) RETURNING id`;
  const used = async () =>
    (
      await sql()<{ n: number }[]>`
        SELECT coalesce(sum(count), 0)::int AS n FROM rate_windows WHERE key = ${`recordSubmission:${id}`}`
    )[0].n;
  let deployer = '0x' + 'e'.repeat(40);
  const ctx = {
    installationId: id,
    entryDeps: {
      status: async () => 'during' as const,
      repoFacts: async () => ({ fork: false, created_at: '2026-10-01T00:00:00Z', pushed_at: '2026-10-06T00:00:00Z' }),
      fetchFile: async () => ({ status: 'ok' as const, text: `payout_wallet: ${PAY}\n` }),
      deployer: { creationTx: async () => '0xabc', txSender: async () => deployer },
    },
  };
  const project = { name: 'Tip Jar', description: 'Tips for creators', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar.xyz' };
  const entry = {
    program_id: f.id,
    project,
    submission_data: { project_name: 'Tip Jar', description: 'Tips for creators', repo_url: project.repo_url, live_url: project.live_url, contracts: C1, payout_wallet: PAY },
    token: 'skip',
  };
  setSanctionsOracle({ chainId: async () => 8453, isSanctioned: async () => false });
  try {
    // Deployed by another wallet: refused, and the daily limit is untouched.
    await assert.rejects(handlers.record_submission(entry, ctx), EntryError);
    assert.equal(await used(), 0);
    deployer = PAY;
    const r = (await handlers.record_submission(entry, ctx)) as { recorded: boolean; show_to_builder?: string };
    assert.equal(r.recorded, true);
    assert.match(r.show_to_builder ?? '', /^\| Entered \| Tip Jar in /);
    assert.equal(await used(), 1);
  } finally {
    setSanctionsOracle(null);
  }
});

test('v2.4 §6 (audit C22): prepare_submission on a closed program has no token block', dbTest, async () => {
  const f = committedProgram('arc-microgrants');
  Object.assign(f, { id: `t9-closed-${process.pid}-${Date.now()}`, status: 'closed' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t9-closed-${process.pid}-${Date.now()}`}) RETURNING id`;
  const result = (await handlers.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar' } },
    { installationId: id },
  )) as Record<string, unknown>;
  assert.equal(result.warning, 'This program is closed or past its deadline.');
  assert.ok(!('token' in result));
});

test('I8: prepare_submission asks about the remembered payout wallet in full and never prefills it', dbTest, async (tc) => {
  const W = '0x' + 'b'.repeat(39) + '7';
  const f = committedProgram('earnkit-campaign-1-base');
  Object.assign(f, {
    id: `i8-wallet-${process.pid}-${Date.now()}`,
    status: 'active',
    starts_at: '2026-09-01T00:00:00Z',
    ends_at: '2099-01-01T00:00:00Z',
  });
  Object.assign(f, earnkitTexts(f));
  await upsertProgram(ProgramFile.parse(f));
  dropAfter(tc, f.id);
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`i8-${process.pid}-${Date.now()}`}, ${W}) RETURNING id`;
  const r = (await handlers.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar' } },
    { installationId: id },
  )) as { show_to_builder: string; payout_wallet_note?: string; missing: { key: string }[]; ready: boolean; sign_to_enter?: unknown };
  assert.match(r.show_to_builder, new RegExp(`Pay prizes to ${W}\\? It is the wallet from your last entry\\.`));
  assert.match(r.show_to_builder, /paid to your wallet by /);
  assert.match(r.payout_wallet_note ?? '', new RegExp(`^Pay prizes to ${W}\\? Confirm with the builder\\.`));
  assert.ok(r.missing.some((m) => m.key === 'payout_wallet'), 'still missing until the builder confirms');
  assert.equal(r.ready, false);
  // Once the builder confirms, the agent passes it: shown in full in the Prize row, no question.
  const ok = (await handlers.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar' }, answers: { payout_wallet: W } },
    { installationId: id },
  )) as { show_to_builder: string; payout_wallet_note?: string };
  assert.match(ok.show_to_builder, new RegExp(`paid to ${W} by `));
  assert.doesNotMatch(ok.show_to_builder, /Pay prizes to/);
  assert.equal(ok.payout_wallet_note, undefined);
});

after(async () => {
  // Task 17: this file's programs never outlive the run.
  if (process.env.DATABASE_URL) await dropRunPrograms();
  if (process.env.DATABASE_URL) await sql().end();
});

test('v2.8 Ruling 23 (plan): how_to_submit and sign_to_enter only for an open campaign; v2.8 Ruling 4: no submission link before the confirmation', dbTest, async (tc) => {
  const stamp = `${process.pid}-${Date.now()}`;
  const plain = committedProgram('arc-microgrants');
  Object.assign(plain, { id: `r23-plain-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(plain));
  const closed = committedProgram('earnkit-campaign-1-base');
  Object.assign(closed, { id: `r23-closed-${stamp}`, status: 'closed', starts_at: '2026-09-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  Object.assign(closed, earnkitTexts(closed));
  await upsertProgram(ProgramFile.parse(closed));
  const open = committedProgram('earnkit-campaign-1-base');
  Object.assign(open, { id: `r23-open-${stamp}`, status: 'active', starts_at: '2026-09-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  Object.assign(open, earnkitTexts(open));
  await upsertProgram(ProgramFile.parse(open));
  dropAfter(tc, plain.id, closed.id, open.id);
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`r23-${stamp}`}) RETURNING id`;
  const prep = async (program_id: string) =>
    (await handlers.prepare_submission({ program_id, project: { name: 'Tip Jar' } }, { installationId: id })) as Record<string, unknown>;
  const p = await prep(plain.id);
  assert.ok(!('how_to_submit' in p) && !('sign_to_enter' in p));
  assert.ok(!('submission_url' in p));
  const c = await prep(closed.id);
  assert.ok(!('how_to_submit' in c) && !('sign_to_enter' in c));
  assert.match(String((await prep(open.id)).how_to_submit), /This is an EarnKit campaign/);
});

// ---- v2.8 Task 8: the confirmation step (Part C, Rulings 1, 3, 4, 5, 7 (plan)). The kit comes only
// from confirm_entry, after the builder's yes or skip; the token launches on yes.
/**
 * v2.10 item 3: the program's guide (what won, what it wants, best bet; no bonus line), as the first
 * prepare_submission for it shows it before the rest. Exported-shaped for the tests below.
 */
async function guideFor(programId: string) {
  return guideText(programGuide(await getProgramRow(programId)));
}
/** v2.10 item 3: `text` starts with the program's guide; returns what follows it (the v2.9 screen). */
async function afterGuide(programId: string, text: string) {
  const g = await guideFor(programId);
  assert.ok(text.startsWith(`${g}\n\n`), text);
  return text.slice(g.length + 2);
}

async function confirmSetup(tag: string, o: { remembered?: string; check?: (s: string) => boolean; extra?: SubmissionRequirement[]; noOffer?: boolean; keepContract?: boolean; branch?: boolean } = {}) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants', { keepContract: o.keepContract });
  const p = { ...arc, id: `t8-${tag}-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', submission_requirements: [...arc.submission_requirements, ...(o.extra ?? [])] };
  await upsertProgram(ProgramFile.parse(p));
  const [{ id: inst }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`t8-${tag}-${stamp}`}, ${o.remembered ?? null}) RETURNING id`;
  const repo = `https://github.com/alice/t8-${tag}-${stamp}`;
  const calls = { gate: 0, deploy: 0, wallets: [] as string[] };
  const tokenDeps = {
    available: () => true,
    limit: async () => {},
    check: async (s: string) => (o.check ? o.check(s) : true),
    gate: {
      repo: async () => { calls.gate++; return { fork: false, hasCommits: true, aheadOfParent: null }; },
      owner: async () => ({ status: 'ok' as const, text: tokenLineFor(inst, repo)! }),
      // `branch` (v2.14 T3 fix round 1): the Bench proves a coin's repo by its proof branch, not the line.
      ...(o.branch && { branchProof: async () => ({ ok: true as const }) }),
      screen: async () => {},
    },
    // What the real deploy records (tokens.ts deployToken), so later calls see the row's token.
    deploy: async (d: { projectId: number; name: string; symbol: string; creatorWallet: string }) => {
      calls.deploy++;
      calls.wallets.push(d.creatorWallet);
      const url = `https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`;
      await sql()`UPDATE projects SET token_url = ${url}, token_status = 'launched', coin_address = ${'0x' + randomBytes(20).toString('hex')},
        coin_launched_at = now(), token_name = ${d.name}, token_symbol = ${d.symbol} WHERE id = ${d.projectId}`;
      return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: url };
    },
  } as unknown as TokenFlowDeps;
  const ctx = { installationId: inst, tokenDeps };
  const project = { name: 'Tip Jar', repo_url: repo, live_url: 'https://tipjar.xyz' };
  // v2.8.1 fix round 1: the Yes line the builder saw (prepare_submission or the offer stores it);
  // "go" launches exactly this pair.
  const offered = await proposeToken('Tip Jar', tokenDeps.check, repo);
  if (!o.noOffer) await saveOffer(inst, p.id, offerKey(repo, 'Tip Jar'), { name: offered.name, symbol: offered.symbol });
  const answers = { description: 'Tips for creators on Arc', builder_profile: 'https://github.com/alice' };
  const input = { program_id: p.id, project, answers };
  const rows = async () =>
    sql()<{ id: number; confirm_choice: string | null; confirmed_at: Date | null; complete_at: Date | null; submission_confirmed_at: Date | null; token_url: string | null }[]>`
      SELECT id, confirm_choice, confirmed_at, complete_at, submission_confirmed_at, token_url FROM projects WHERE installation_id = ${inst} ORDER BY id`;
  return { p, inst, repo, calls, ctx, input, project, answers, rows, offered };
}

/** Every key of a reply, at any depth. */
const keysOf = (v: unknown): string[] =>
  v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];

async function withTokenEnv<T>(fn: () => Promise<T>) {
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const secret = process.env.EARNKIT_AUTH_SECRET;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  process.env.EARNKIT_AUTH_SECRET ||= 'tools-test-secret';
  try {
    return await fn();
  } finally {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
}

const W8 = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
type Confirmed = { show_to_builder: string; project_id?: number; token?: { status: string; note?: string; fixable?: boolean; tokens_fun?: string; symbol?: string; agent_note?: string }; kit?: { show_to_builder: string; mode: string }; agent_note?: string; shown_wallet?: string };
const go = { builder_confirmed: true, decision: 'go' } as const;

test('8.12, v2.10 item 1: list_programs has one bonus line before the close, no token line, and never says "optional"', dbTest, async () => {
  const stray = await sql()<{ id: string }[]>`
    SELECT id FROM programs WHERE status = 'active' AND campaign->>'kind' = 'earnkit'`;
  if (stray.length) await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  try {
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash) VALUES (${`t8-list-${process.pid}-${Date.now()}`}) RETURNING id`;
    const r = (await handlers.list_programs({ more: true }, { installationId: id })) as { show_to_builder: string };
    // Ruling H8: at most one bonus line, the offered program's, right before the close.
    assert.ok((r.show_to_builder.match(/Builder bonus:/g)?.length ?? 0) <= 1, r.show_to_builder);
    if (r.show_to_builder.includes('Builder bonus:')) assert.match(r.show_to_builder, /\n\nBuilder bonus: [^\n]+\n\n[^\n]+$/);
    assert.doesNotMatch(r.show_to_builder, /Every entry gets a token/);
    assert.doesNotMatch(JSON.stringify(r), /optional/i);
  } finally {
    if (stray.length) await sql()`UPDATE programs SET status = 'active' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  }
});

test('final fix wave (M5): on a hosted agent the entry\'s stored wallet is never shown or suggested', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('sharedwallet', { remembered: W8 });
    const A = '0x' + 'a'.repeat(39) + '9';
    await sql()`INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, bonus_repo_key, creator_wallet)
      VALUES (${t.p.id}, 'Tip Jar', ${t.repo}, 'https://tipjar.xyz', ${t.inst}, ${t.repo.replace('https://', '')}, ${A})`;
    const ctx = { ...t.ctx, sharedClient: true };
    const prep = (await handlers.prepare_submission(t.input, ctx)) as { show_to_builder: string; shown_wallet?: string };
    assert.ok(!('shown_wallet' in prep), JSON.stringify(prep.shown_wallet));
    assert.doesNotMatch(prep.show_to_builder, /0xaaaa|0x1581/);
    const offer = (await handlers.confirm_entry(t.input, ctx)) as Confirmed;
    assert.ok(!('shown_wallet' in offer));
    assert.doesNotMatch(offer.show_to_builder, /0xaaaa|0x1581/);
    // "go" without a wallet: nothing launches and no wallet is suggested.
    const r = (await handlers.confirm_entry({ ...t.input, ...go }, ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 0);
    assert.ok(!('shown_wallet' in r));
    assert.doesNotMatch(r.show_to_builder, /0xaaaa|0x1581/);
  }));

// ---- v2.8 Task 9: the application coach and the answer bank (Part D, Rulings 6, 9, 26 (plan)) ----
/** Arc plus three fields only the builder can answer, as a richer form would ask. */
const COACH_EXTRA: SubmissionRequirement[] = [
  { key: 'traction', label: 'Traction', todo: 'your traction', type: 'text', required: true, from: 'builder', kind: 'traction' },
  { key: 'why_you', label: 'Why you', todo: 'why you', type: 'text', required: true, from: 'builder', kind: 'why_you' },
  { key: 'next', label: 'Use of the grant', todo: 'use of the grant', type: 'text', required: true, from: 'builder', kind: 'use_of_funds' },
];
const COACH_ANSWERS = {
  description: 'Tips for creators in USDC on Arc mainnet, with a deployed contract.',
  builder_profile: 'https://github.com/alice',
  traction: '120 creators got 900 tips in the first month.',
  why_you: 'I built two payment apps used by 5,000 people.',
  next: 'Ship a recurring tips contract in 6 weeks.',
};
type Coached = { show_to_builder: string; questions?: { keys: string[]; kind: string; text: string }[]; coach?: { fields: Record<string, unknown>[]; facts: Record<string, unknown>; from_bank: Record<string, string> }; fixes?: unknown[]; agent_note?: string; ready?: boolean };

test('9 coach: no builder answers on Arc: the three questions are the whole screen, the fields guidance for the agent, no offer', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('coach', { remembered: W8, extra: COACH_EXTRA });
    const r = (await handlers.prepare_submission({ ...t.input, answers: { description: COACH_ANSWERS.description, builder_profile: COACH_ANSWERS.builder_profile } }, t.ctx)) as Coached;
    const reqs = ProgramFile.parse(t.p).submission_requirements;
    const q = questionsFor({ reqs, answers: { description: 'x', builder_profile: 'x' }, first: true, project: 'Tip Jar' });
    // v2.10 item 3: the first prepare for the program: its guide, then the questions.
    const screen = await afterGuide(t.p.id, r.show_to_builder);
    assert.equal(screen, coachIntro(t.p.title, q));
    assert.equal(screen.split('\n')[1], '1. Who has used Tip Jar so far?');
    assert.equal(r.questions?.length, 3);
    assert.deepEqual(r.questions?.map((x) => x.kind), ['traction', 'why_you', 'use_of_funds']);
    assert.equal(r.coach?.fields.length, reqs.length);
    for (const f of r.coach!.fields) for (const k of ['key', 'kind', 'judges', 'pattern', 'limit_words']) assert.ok(k in f, k);
    assert.deepEqual(r.coach?.facts, { chains: ['arc'], live_url: 'https://tipjar.xyz/', repo_url: t.repo });
    assert.doesNotMatch(r.show_to_builder, /builder bonus|Ready|Wallet|Fees in WETH/);
    assert.ok(!('shown_wallet' in r) && !('token' in r) && !('token_line' in r));
    assert.match(r.agent_note ?? '', /Draft every field from the repo, onchain data and the builder's answers/);
    // No offer, and no kit, at any depth.
    for (const k of ['kit', 'submission_url', 'prefilled_url', 'paste']) assert.ok(!keysOf(r).includes(k), k);
  }));

test('10 Part E: confirm_entry on DoraHacks with a browser is still the paste list; the agent is told never to fill it', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('dora10');
    const r = (await handlers.confirm_entry({ ...t.input, ...go, wallet: W8, agent: { browser: true } }, t.ctx)) as Confirmed & { kit?: { mode: string; agent_steps?: string[] } };
    assert.equal(r.kit?.mode, 'copy_paste');
    assert.ok(!r.kit?.agent_steps);
    assert.match(r.agent_note ?? '', /terms ban automated use/);
  }));

test('11 Also qualifies: after confirm_entry "go" and record_submission on Arc, also_qualifies reuses the bank and the cached chains; never Arc; Task 8 carry excludes an entered one', dbTest, (tc) =>
  withTokenEnv(async () => {
    const t = await confirmSetup('also', { extra: COACH_EXTRA });
    // v2.8 Part E's Base fixture, cloned under a fresh id (already open and rolling, as committed).
    const other = { ...committedProgram('base-builder-grants'), id: `${t.p.id}-base`, title: `Also Base ${t.p.id}` };
    await upsertProgram(ProgramFile.parse(other));
    dropAfter(tc, other.id);

    // Isolate (hideOthers), again before each submit: stray rows other dbTests leave in this shared
    // database can't crowd the top MAX_ALSO rows.
    const hideStrays = () => hideOthers(t.inst, [t.p.id, other.id]);
    await hideStrays();
    const go1 = (await handlers.confirm_entry({ ...t.input, answers: COACH_ANSWERS, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.ok(go1.kit);
    const submit = async () => {
      await hideStrays();
      return (await handlers.record_submission(
        { program_id: t.p.id, project: t.project, submission_data: COACH_ANSWERS, builder_submitted: true },
        t.ctx,
      )) as { also_qualifies?: AlsoRow[]; show_to_builder: string };
    };

    // Uncached: chains fall back to Arc's own (arc only), so the Base-chain program doesn't fit.
    const r1 = await submit();
    assert.ok(!r1.also_qualifies?.some((x) => x.id === other.id));
    // No candidate fits yet (isolated to just t.p and other, and other needs base): the reply is
    // exactly the entered text, with no "Also qualifies" suffix at all. Captured for the full
    // joined-string check below (review fix round 1, item 4).
    const mainText = r1.show_to_builder;
    assert.ok(!r1.also_qualifies);

    // Cache the repo's chains as covering Base too: it now shows, via the cache (Ruling 29). v2.10
    // item 9: credited mainnets (a deploy config); a v2.9 row without basis reads as a mention.
    const full = t.repo.replace('https://github.com/', '');
    await sql()`
      INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES (
        ${full}, now(),
        ${sql().json({ arc: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' }, base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } })},
        '{}')`;
    // v2.9 T12 (G15 M1): Base needs a live product with real users; until the builder says the
    // repo has users, its row still needs them, so it is not offered.
    const unsaid = await submit();
    assert.ok(!unsaid.also_qualifies?.some((x) => x.id === other.id), JSON.stringify(unsaid.also_qualifies));
    await handlers.tell_earnkit({ repo_facts: [{ repo: full, has_users: true }] }, t.ctx);
    const r2 = await submit();
    assert.ok(!r2.also_qualifies?.some((x) => x.id === t.p.id), 'never the entered program itself');
    const row = r2.also_qualifies?.find((x) => x.id === other.id);
    assert.ok(row, 'the Base-chain program shows via the cached chains');

    // The wiring matches the pure function exactly, given the same bank, programs and entries.
    const bank = await readBank(t.inst, projectKey({ repo_url: t.repo, name: 'Tip Jar' }));
    // The programs this builder can see: every other one is hidden (hideStrays).
    const programs = (await alsoProgramFacts()).filter((p) => p.id === t.p.id || p.id === other.id);
    const enteredIds = await enteredProgramIds(t.inst, { repoUrl: t.repo, name: 'Tip Jar' });
    const args = { enteredProgramId: t.p.id, chains: ['arc', 'base'] as Chain[], programs, bank, answers: COACH_ANSWERS, hasLiveProduct: true, now: new Date() };
    const expectedRows = alsoQualifies({ ...args, enteredIds });
    assert.deepEqual(r2.also_qualifies, expectedRows);
    // confirmSetup's ctx.repoCoins always answers {} (so the token launch flow never sees this
    // repo as held elsewhere): the same stub makes coinIn null here, not the entered program.
    // Review fix round 1, item 4: the full joined string (mainText + "\n\n" + the block), not
    // just the tail, so a regression that glues the sections together would be caught.
    assert.equal(r2.show_to_builder, `${mainText}\n\n${alsoText(expectedRows)}`);

    // Reusing the bank cuts how much is left (usage_numbers, kind traction, is filled from Arc's).
    const unbanked = alsoQualifies({ ...args, enteredIds, bank: new Map() }).find((x) => x.id === other.id)!;
    assert.ok(row!.left < unbanked.left, 'reusing the bank cuts how much is left for the next program');

    // Task 8 carry: confirming Base too (skip, never submitted) still counts as entered; it is
    // never offered a second time.
    await handlers.confirm_entry(
      { program_id: other.id, project: t.project, answers: COACH_ANSWERS, builder_confirmed: true, decision: 'skip' },
      t.ctx,
    );
    const r3 = await submit();
    assert.ok(!r3.also_qualifies?.some((x) => x.id === other.id), 'already entered (confirmed, unsubmitted): never offered twice');
  }));

// ---- v2.8 Task 12, Part G, Ruling 30 (plan): the outcome question, asked once; the builder's answer.
test('12 list_programs: ask_outcome once after results are due; tell_earnkit (v2.9 A3) stores a self-report for the own entry only', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const due = { ...arc, id: `t12-due-${stamp}`, title: `Arc Due ${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', results: { url: arc.source_url, expected: '2026-01-01' } };
  const later = { ...arc, id: `t12-later-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', results: { url: arc.source_url, expected: '2099-01-01' } };
  await upsertProgram(ProgramFile.parse(due));
  await upsertProgram(ProgramFile.parse(later));
  const inst = async (tag: string) =>
    (await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t12-${tag}-${stamp}`}) RETURNING id`)[0].id;
  const mine = await inst('a');
  const other = await inst('b');
  const entry = async (program: string, installation: number, name: string, confirmed = false) =>
    (await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, confirmed_at, confirm_choice)
      VALUES (${program}, ${name}, ${installation}, ${confirmed ? new Date() : null}, ${confirmed ? 'go' : null}) RETURNING id`)[0].id;
  const tipjar = await entry(due.id, mine, 'TipJar');
  await entry(due.id, mine, 'Unsent', true); // confirmed, never submitted: never asked
  await entry(later.id, mine, 'TooEarly'); // results not due yet
  const theirs = await entry(due.id, other, 'Theirs');
  const ctx = { installationId: mine };
  type Listed = { ask_outcome?: { project_id: number; program_id: string; question: string; agent_note: string } };
  try {
    const first = (await handlers.list_programs({ more: true }, ctx)) as Listed;
    assert.deepEqual(first.ask_outcome && { ...first.ask_outcome, agent_note: undefined }, {
      project_id: tipjar,
      program_id: due.id,
      question: `Did TipJar win anything in Arc Due ${stamp}?`,
      agent_note: undefined,
    });
    assert.match(first.ask_outcome!.agent_note, /Then call tell with program_status/);
    assert.doesNotMatch(first.ask_outcome!.agent_note, /report_outcome/);
    // Asked once: not on the next call.
    const second = (await handlers.list_programs({ more: true }, ctx)) as Listed;
    assert.ok(!('ask_outcome' in second));
    // Ruling C21: list_programs takes no answer (it stays read-only); tell_earnkit stores it.
    await assert.rejects(handlers.list_programs({ more: true, report_outcome: { project_id: tipjar, result: 'won' } }, ctx));
    assert.ok(!('report_outcome' in tools));
    const saved = (await handlers.tell_earnkit(
      { program_status: [{ program_id: due.id, status: 'won', project_id: tipjar, prize_usd: 500 }] },
      ctx,
    )) as { saved: string[]; agent_note: string };
    assert.equal(saved.saved.length, 1);
    assert.match(saved.agent_note, /never shows publicly/);
    const rows = await sql()<{ basis: string; result: string; prize_usd: string }[]>`
      SELECT basis, result, prize_usd::text FROM entry_outcomes WHERE project_id = ${tipjar}`;
    assert.deepEqual([...rows], [{ basis: 'self_reported', result: 'won', prize_usd: '500' }]);
    // Another installation's entry: refused, nothing stored.
    await assert.rejects(
      handlers.tell_earnkit({ program_status: [{ program_id: due.id, status: 'won', project_id: theirs }] }, ctx),
      (err: Error) => err.constructor.name === 'NotFoundError',
    );
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM entry_outcomes WHERE project_id = ${theirs}`)[0].n, 0);
    // A self-report never alerts: the wins in the next reply come from announcements only.
    const next = (await handlers.list_programs({ more: true }, ctx)) as { show_to_builder: string };
    assert.doesNotMatch(next.show_to_builder, /you won \$500/);
  } finally {
    await sql()`DELETE FROM projects WHERE program_id IN (${due.id}, ${later.id})`;
    await sql()`DELETE FROM installations WHERE id IN (${mine}, ${other})`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id IN (${due.id}, ${later.id})`;
  }
});

// ---- v2.8.1 §B6, §B9: list_programs on real rows: odd agent input, and a returning builder.
test('v2.8.1 §B: list_programs takes any chain, a bare date and a non-0x wallet; a returning builder sees their entries first', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const p = { ...arc, id: `t3b-${stamp}`, title: `Arc Entered ${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(p));
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t3b-${stamp}`}) RETURNING id`;
  const ctx = { installationId: inst };
  type Listed = { show_to_builder: string; wallet_note?: string };
  await hideOthers(inst, [p.id]);
  try {
    const first = (await handlers.list_programs(
      {
        more: true,
        wallet: 'builder.eth',
        local_repos: [
          { name: 'ethapp', chains: [{ chain: 'ethereum', mainnet: true }], last_commit_at: '2026-10-01', live_url: 'ethapp.xyz' },
          { name: 'tipjar', chains: ['Base', 'optimism'], last_commit_at: '2026-10-01 09:00' },
        ],
      },
      ctx,
    )) as Listed;
    assert.equal(first.wallet_note, WALLET_IGNORED);
    assert.doesNotMatch(first.show_to_builder, /Your entries/);
    // A submitted entry (made by record_submission, no confirmation step): "Your entries" first, "entered".
    await sql()`INSERT INTO projects (program_id, name, installation_id) VALUES (${p.id}, 'TipJar', ${inst})`;
    const back = (await handlers.list_programs({ more: true }, ctx)) as Listed;
    assert.ok(back.show_to_builder.startsWith(`Your entries: ${p.title} (TipJar, submitted).\n\n`), back.show_to_builder);
    assert.match(back.show_to_builder, new RegExp(`\\| ${p.title} \\(entered\\) \\|`));
    assert.doesNotMatch(back.show_to_builder, new RegExp(`(start on|keep going on|new for) ${p.title}`));
    assert.ok(!('wallet_note' in back));
  } finally {
    await sql()`DELETE FROM projects WHERE program_id = ${p.id}`;
    await sql()`DELETE FROM installations WHERE id = ${inst}`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${p.id}`;
  }
});

// ---- v2.8 Task 12 review finding 3: a newly listed program is announced once per reply.
test('12 list_programs: a new fitting program shows exactly once (the alert), never again in Updates', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t12-new-${stamp}`}) RETURNING id`;
  const ctx = { installationId: inst };
  const base = committedProgram('base-builder-grants');
  // v2.9 A7: without the live-product tag, so a live, verified product repo could win it.
  const p = { ...base, id: `t12-new-${stamp}`, title: `Fresh Base ${stamp}`, status: 'active', form: undefined, tag: undefined };
  const repo = {
    key: 'alice/tipjar', name: 'tipjar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz', created_at: '2026-01-01T00:00:00Z',
    chains: { base: { mainnet: true, testnet: false, evidence: 'x', basis: 'deploy_config' } }, product: { score: 6, tier: 'product', missing: [] }, live_verified: true, said: null,
  };
  try {
    await handlers.list_programs({ more: true }, ctx); // the first check: quiet, marks every open program seen
    await sql()`UPDATE installations SET fit_repos = ${sql().json([repo] as never)} WHERE id = ${inst}`;
    await upsertProgram(ProgramFile.parse(p));
    const r = (await handlers.list_programs({ more: true }, ctx)) as { show_to_builder: string };
    const count = r.show_to_builder.split(`new: ${p.title}`).length - 1;
    assert.equal(count, 1, r.show_to_builder);
    assert.match(r.show_to_builder, new RegExp(`^Since you last checked: .*new: ${p.title} \\(up to \\$5,000\\)`));
  } finally {
    await sql()`DELETE FROM installations WHERE id = ${inst}`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${p.id}`;
  }
});

test('v2.8.1 §A4: EarnKit allows 10 launches per wallet per UTC day; the 11th says when to retry', dbTest, async () => {
  const wallet = '0x' + Math.random().toString(16).slice(2).padEnd(40, '7').slice(0, 40);
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${`tokenLaunch%`} AND key LIKE ${`%${wallet}`}`;
  // Different agents: the wallet's own limit, not the agent's.
  for (let i = 0; i < 10; i++) await launchLimit(900_000 + i, wallet);
  await assert.rejects(launchLimit(900_100, wallet), (err: unknown) => {
    assert.ok(err instanceof LaunchError);
    assert.match(err.message, /^Your token didn't launch: this wallet reached today's launch limit of 10\. Try again after 00:00 UTC\.$/);
    return true;
  });
  await sql()`DELETE FROM rate_windows WHERE key LIKE ${`%${wallet}`} OR key LIKE 'tokenLaunch:9001%' OR key LIKE 'tokenLaunch:9000%'`;
});

// ---- v2.8.1 §E17: hosted agent installs (shared_client).

test('v2.8.1 §E17: a hosted agent saved answers come back only as a named yes/no', dbTest, () =>
  withTokenEnv(async () => {
    const team = { key: 'team', label: 'Team', type: 'text', required: true, from: 'builder', kind: 'team' } as SubmissionRequirement;
    const t = await confirmSetup('shared-bank', { extra: [team] });
    await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id)
      VALUES (${t.inst}, ${projectKey({ repo_url: t.repo, name: 'Tip Jar' })}, 'team', 'Alice and Bob', 'other-program')`;
    const shared = (await handlers.prepare_submission(t.input, { ...t.ctx, sharedClient: true })) as { show_to_builder: string; ready: boolean; coach?: { from_bank?: unknown } };
    assert.match(shared.show_to_builder, /Use "Alice and Bob" again\?/);
    assert.equal(shared.ready, false, 'not filled until the builder says yes');
    const own = (await handlers.prepare_submission(t.input, t.ctx)) as { show_to_builder: string };
    assert.doesNotMatch(own.show_to_builder, /Use "Alice and Bob" again\?/, 'off a hosted agent the bank fills it as before');
  }));

test('v2.8.1 §E17 (T2 carry): a hosted agent launches past the 10-a-day agent floor; the wallet limit stays 10', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`shared-launch-${process.pid}-${Date.now()}`}, true) RETURNING id`;
  const wallets: string[] = [];
  for (let i = 0; i < 12; i++) {
    const w = '0x' + randomBytes(20).toString('hex');
    wallets.push(w);
    await launchLimit(id, w);
  }
  // A plain agent still stops at 10.
  const [{ id: plain }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`plain-launch-${process.pid}-${Date.now()}`}) RETURNING id`;
  for (let i = 0; i < 10; i++) await launchLimit(plain, '0x' + randomBytes(20).toString('hex'));
  await assert.rejects(launchLimit(plain, '0x' + randomBytes(20).toString('hex')), /this agent reached today's launch limit of 10\./);
  await sql()`DELETE FROM rate_windows WHERE key IN ${sql()([`tokenLaunchShared:${id}`, `tokenLaunch:${plain}`])}`;
});

test('1.11 v2.9 A5: a placeholder link is refused; a failed probe is one fix line, never complete', dbTest, () =>
  withTokenEnv(async () => {
    const { LIVE_FAILED_LINE, PLACEHOLDER_LINE } = await import('./verify');
    const t = await confirmSetup('a5');
    await assert.rejects(
      handlers.prepare_submission({ ...t.input, project: { ...t.project, live_url: 'https://example.com' } }, t.ctx),
      (err: unknown) => String((err as Error).message).includes(PLACEHOLDER_LINE),
    );
    let probes = 0;
    const live = `https://a5-${t.inst}.tipjar.xyz`;
    const ctx = {
      ...t.ctx,
      verifyDeps: {
        probe: async () => {
          probes++;
          throw new Error('no answer');
        },
      },
    };
    const input = { ...t.input, project: { ...t.project, live_url: live, contracts: [`0x${'a'.repeat(40)}`] } };
    const r = (await handlers.prepare_submission(input, ctx)) as {
      ready: boolean;
      show_to_builder: string;
      fixes: { text: string }[];
      missing: { key: string; problem?: string }[];
    };
    assert.equal(r.ready, false);
    assert.deepEqual(r.fixes.filter((f) => f.text === LIVE_FAILED_LINE).length, 1);
    assert.equal(r.show_to_builder.split(LIVE_FAILED_LINE).length - 1, 1);
    assert.deepEqual(r.missing.find((m) => m.key === 'live_deployment_url')?.problem, LIVE_FAILED_LINE);
    assert.equal(probes, 1);
    // The confirmation of that entry never sets complete_at (the failure is cached for the hour).
    await handlers.confirm_entry({ ...input, ...go, decision: 'skip' }, ctx);
    const [row] = await t.rows();
    assert.equal(row.complete_at, null);
    const [v] = await sql()<{ live_verified_at: Date | null }[]>`SELECT live_verified_at FROM projects WHERE id = ${row.id}`;
    assert.equal(v.live_verified_at, null);
  }));

test('2.6 v2.10 item 14: a live link that loads an error page is one fix line with the phrase; a plain failure keeps LIVE_FAILED_LINE', dbTest, () =>
  withTokenEnv(async () => {
    const { LIVE_FAILED_LINE } = await import('./verify');
    const { liveErrorLine } = await import('./placeholder');
    const { ErrorPageError } = await import('./safe-fetch');
    const LINE = 'Your live link loads but shows an error ("This page could not be found"). Fix it and tell me.';
    assert.equal(liveErrorLine('This page could not be found'), LINE);
    type Prep = { ready: boolean; show_to_builder: string; fixes: { text: string }[]; missing: { key: string; problem?: string }[] };
    const t = await confirmSetup('t2err');
    const ctx = {
      ...t.ctx,
      verifyDeps: {
        probe: async () => {
          throw new ErrorPageError('This page could not be found');
        },
      },
    };
    const input = { ...t.input, project: { ...t.project, live_url: `https://t2err-${t.inst}.tipjar.xyz` } };
    const r = (await handlers.prepare_submission(input, ctx)) as Prep;
    assert.equal(r.ready, false);
    assert.deepEqual(r.fixes.filter((f) => f.text === LINE).length, 1);
    assert.equal(r.fixes.some((f) => f.text === LIVE_FAILED_LINE), false);
    assert.equal(r.show_to_builder.split(LINE).length - 1, 1, r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /Live link didn't load/);

    const log = console.error;
    console.error = () => {};
    try {
      const d = await confirmSetup('t2down');
      const downCtx = { ...d.ctx, verifyDeps: { probe: async () => { throw new Error('no answer'); } } };
      const down = (await handlers.prepare_submission({ ...d.input, project: { ...d.project, live_url: `https://t2down-${d.inst}.tipjar.xyz` } }, downCtx)) as Prep;
      assert.equal(down.ready, false);
      assert.deepEqual(down.fixes.filter((f) => f.text === LIVE_FAILED_LINE).length, 1);
    } finally {
      console.error = log;
    }
  }));

// ---- v2.9 A2: at most 3 repos per program in matches ----

const scoredFit = (repo: string, score: number, program_id: string) => ({
  repo,
  repo_url: `https://github.com/alice/${repo}`,
  verdicts: [{ program_id, program: program_id, status: 'after_step' as const, missing: [], effort: 'none' as const, note: null }],
  product: { score, tier: (score >= 5 ? 'product' : 'project') as 'product' | 'project', missing: [] },
});
const fiveOnBase = [3, 6, 4, 5, 3].map((s, i) => scoredFit(`r${i}`, s, 'base-builder-grants'));

test('2.12 matches: at most 3 repos per program, highest product score first; an any_chain program shows one', () => {
  const rows = matchRows(fiveOnBase, new Set());
  // v2.10.1 B2: the polish-only score is no longer shown; with equal odds and traction it still breaks the tie.
  assert.deepEqual(rows.map((r) => r.repo), ['r1', 'r3', 'r2']);
  assert.ok(rows.every((r) => !('product_score' in r)));
  const a16z = matchRows([5, 6].map((s, i) => scoredFit(`a${i}`, s, 'a16z-speedrun')), new Set(['a16z-speedrun']));
  assert.deepEqual(a16z.map((r) => r.repo), ['a1']);
});

test('Ruling G6: on a shared client, one builder\'s statements never reach another; an outcome needs its project_id', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const arcId = `g6-arc-${stamp}`;
  const baseId = `g6-base-${stamp}`;
  await upsertProgram(ProgramFile.parse({ ...arc, id: arcId, title: `Arc G6 ${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' }));
  await upsertProgram(ProgramFile.parse({ ...arc, id: baseId, title: `Base G6 ${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' }));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`g6-shared-${stamp}`}, true) RETURNING id`;
  const [{ id: entry }] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id) VALUES (${arcId}, 'TipJar', ${id}) RETURNING id`;
  let given: { said?: Record<string, unknown> } | undefined;
  const ctx = {
    installationId: id,
    sharedClient: true,
    matchProjects: async (input: { said?: Record<string, unknown> }) => {
      given = input;
      return { checked: 1, scored: 1, fits: [scoredFit('tipjar', 6, arcId)] };
    },
  };
  type Told = { show_to_builder?: string; saved: string[]; agent_note: string };
  type Listed = { show_to_builder: string; matches: { program_id: string }[] };
  try {
    // Builder A, on the shared agent.
    const told = (await handlers.tell_earnkit(
      {
        program_status: [
          { program_id: arcId, status: 'not_interested' },
          { program_id: baseId, status: 'applied' },
        ],
        repo_facts: [{ repo: 'tipjar', not_mine: true }],
      },
      ctx,
    )) as Told;
    assert.equal(told.show_to_builder, 'Noted for now.');
    assert.deepEqual(told.saved, []);
    assert.doesNotMatch(told.show_to_builder!, /tell_earnkit|list_programs/);
    const rows = await sql()<{ n: number }[]>`
      SELECT (SELECT count(*) FROM builder_program_status WHERE installation_id = ${id})::int
        + (SELECT count(*) FROM builder_repo_facts WHERE installation_id = ${id})::int AS n`;
    assert.equal(rows[0].n, 0, 'nothing stored for the installation');
    // Builder B, on the same agent: none of A's statements apply.
    const b = (await handlers.list_programs({ more: true, local_repos: [{ name: 'tipjar', chains: ['arc'] }] }, ctx)) as Listed;
    assert.match(b.show_to_builder, new RegExp(`Arc G6 ${stamp}`));
    assert.doesNotMatch(b.show_to_builder, /applied outside EarnKit/);
    assert.ok(b.matches.some((m) => m.program_id === arcId));
    assert.equal(given?.said, undefined);
    // An outcome without its entry is refused (the newest entry may be another builder's); with it, stored.
    await assert.rejects(
      handlers.tell_earnkit({ program_status: [{ program_id: arcId, status: 'won' }] }, ctx),
      (err: Error) => err.constructor.name === 'NotFoundError' && /project_id/.test(err.message),
    );
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM entry_outcomes WHERE project_id = ${entry}`)[0].n, 0);
    const won = (await handlers.tell_earnkit({ program_status: [{ program_id: arcId, status: 'won', project_id: entry }] }, ctx)) as Told;
    assert.equal(won.show_to_builder, 'Noted for now.');
    assert.equal(won.saved.length, 1);
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM entry_outcomes WHERE project_id = ${entry}`)[0].n, 1);
  } finally {
    await sql()`DELETE FROM projects WHERE installation_id = ${id}`;
    await sql()`DELETE FROM installations WHERE id = ${id}`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id IN (${arcId}, ${baseId})`;
  }
});

// ---- Ruling G7: a shared client shows nothing the installation remembers ----

/** One shared installation with an Arc clone open (results due), for builders A and B. */
async function sharedInstall(tag: string) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const programId = `g7-${tag}-${stamp}`;
  await upsertProgram(ProgramFile.parse({
    ...arc, id: programId, title: `Arc G7 ${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z',
    results: { url: arc.source_url, expected: '2026-01-01' },
  }));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`g7-${tag}-${stamp}`}, true) RETURNING id`;
  const calls: unknown[] = [];
  const ctx = (shared = true) => ({
    installationId: id,
    sharedClient: shared,
    matchProjects: async (input: unknown) => {
      calls.push(input);
      return { checked: 1, scored: 1, fits: [] };
    },
  });
  const cleanup = async () => {
    await sql()`DELETE FROM projects WHERE installation_id = ${id}`;
    await sql()`DELETE FROM installations WHERE id = ${id}`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${programId}`;
  };
  return { id, programId, stamp, ctx, calls, cleanup };
}
type G7Listed = { show_to_builder: string; note: string; ask_outcome?: unknown; since_you_last_checked?: string };

test("Ruling G7 (1): on a shared client, builder A's reported repos are never matched for builder B", dbTest, async () => {
  const s = await sharedInstall('repos');
  try {
    await handlers.list_programs({ more: true, local_repos: [{ name: 'secret-a-app', chains: ['arc'] }] }, s.ctx());
    assert.equal(s.calls.length, 1);
    const b = (await handlers.list_programs({ more: true }, s.ctx())) as G7Listed;
    assert.equal(s.calls.length, 1, "B's call matched nothing (A's repos aren't B's)");
    assert.doesNotMatch(JSON.stringify(b), /secret-a-app/);
    assert.doesNotMatch(b.show_to_builder, /remember|shared|many builders/i);
    // Control: the same installation, not shared, does remember them.
    await handlers.list_programs({ more: true }, s.ctx(false));
    assert.equal(s.calls.length, 2);
  } finally {
    await s.cleanup();
  }
});

test("Ruling G7 (2): on a shared client, builder B is never asked about builder A's entry", dbTest, async () => {
  const s = await sharedInstall('ask');
  const [{ id: entry }] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id) VALUES (${s.programId}, 'SecretA', ${s.id}) RETURNING id`;
  try {
    const b = (await handlers.list_programs({ more: true }, s.ctx())) as G7Listed;
    assert.ok(!('ask_outcome' in b));
    assert.doesNotMatch(JSON.stringify(b), /SecretA/);
    const [row] = await sql()<{ outcome_asked_at: Date | null }[]>`SELECT outcome_asked_at FROM projects WHERE id = ${entry}`;
    assert.equal(row.outcome_asked_at, null, 'not marked asked');
    // Control: not shared, the question is asked.
    const own = (await handlers.list_programs({ more: true }, s.ctx(false))) as G7Listed;
    assert.ok(own.ask_outcome);
  } finally {
    await s.cleanup();
  }
});

test("Ruling G7 (3): on a shared client, builder B never sees A's entries, standing or alerts", dbTest, async () => {
  const s = await sharedInstall('entries');
  const [{ id: entry }] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id) VALUES (${s.programId}, 'SecretA', ${s.id}) RETURNING id`;
  await sql()`
    INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, source_url, captured_at, basis)
    VALUES (${entry}, ${s.programId}, 'r1', 'won', 500, 'https://example.org/winners', now(), 'announcement')`;
  try {
    const b = (await handlers.list_programs({ more: true }, s.ctx())) as G7Listed;
    assert.doesNotMatch(b.show_to_builder, /Your entries|Since you last checked|SecretA|you won/);
    const program = (await handlers.get_program({ program_id: s.programId }, s.ctx())) as { since_you_last_checked?: string };
    assert.ok(!('since_you_last_checked' in program));
    // Control: not shared, A's entry and win show.
    const own = (await handlers.list_programs({ more: true }, s.ctx(false))) as G7Listed;
    assert.match(own.show_to_builder, /Your entries: .*SecretA/);
    assert.match(own.show_to_builder, /you won/);
  } finally {
    await s.cleanup();
  }
});

// ---- v2.9 B9: Sign in with GitHub as ownership proof

async function withSignIn<T>(fn: () => Promise<T>): Promise<T> {
  const old = [process.env.GITHUB_OAUTH_CLIENT_ID, process.env.GITHUB_OAUTH_CLIENT_SECRET];
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
  try {
    return await fn();
  } finally {
    if (old[0] === undefined) delete process.env.GITHUB_OAUTH_CLIENT_ID;
    else process.env.GITHUB_OAUTH_CLIENT_ID = old[0];
    if (old[1] === undefined) delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    else process.env.GITHUB_OAUTH_CLIENT_SECRET = old[1];
  }
}
/** A passed sign-in for this entry and repo as `login` (the real callback path, GitHub faked); its code on a shared client. */
async function signInAs(installationId: number, projectId: number | null, repoUrl: string, login: string, wallet: string = W8) {
  const repoKey = repoUrl.replace(/^https:\/\/github\.com\//, '').toLowerCase();
  const link = await createVerifyLink({ installationId, projectId, repoKey, purpose: projectId ? 'entry' : 'pickup', wallet });
  const out = await completeVerify('code', new URL(link).searchParams.get('n')!, {
    exchange: async () => 'gho_x',
    user: async () => ({ login, created_at: '2020-01-01T00:00:00Z', public_repos: 3 }),
    repoPerms: async () => ({ push: true }),
  });
  assert.ok(out.ok);
  return (out as { code?: string }).code ? formatCode((out as { code: string }).code) : null;
}
test("G6/G7/G9: on a shared client, memory and entries follow the pasted code; a claimed GitHub user gets nothing", dbTest, () =>
  withSignIn(async () => {
    const s = await sharedInstall('g9mem');
    const repo = `https://github.com/alice/g9-${s.stamp}`;
    const [{ id: entry }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, installation_id, repo_url) VALUES (${s.programId}, 'AliceApp', ${s.id}, ${repo}) RETURNING id`;
    await sql()`INSERT INTO projects (program_id, name, installation_id) VALUES (${s.programId}, 'SecretB', ${s.id})`;
    try {
      const codeA = (await signInAs(s.id, entry, repo, 'alice'))!;
      const codeB = (await signInAs(s.id, null, `https://github.com/bob/b-${s.stamp}`, 'bob'))!;
      type Told = { show_to_builder?: string; saved: string[] };
      // With the code: kept under alice, and nothing to show the builder.
      const told = (await handlers.tell_earnkit(
        { program_status: [{ program_id: s.programId, status: 'not_interested' }], repo_facts: [{ repo: 'tipjar', not_mine: true }], signed_in: codeA },
        s.ctx(),
      )) as Told;
      assert.equal(told.show_to_builder, undefined);
      assert.equal(told.saved.length, 2);
      const rows = await sql()<{ login: string }[]>`
        SELECT login FROM builder_program_status WHERE installation_id = ${s.id}
        UNION ALL SELECT login FROM builder_repo_facts WHERE installation_id = ${s.id}`;
      assert.deepEqual(rows.map((r) => r.login), ['alice', 'alice']);
      const said = () => (s.calls.at(-1) as { said?: Record<string, unknown> }).said;
      const local = { local_repos: [{ name: 'tipjar', chains: ['arc'] }] };
      // Claiming alice's GitHub user without the code: nothing of hers.
      const claim = (await handlers.list_programs({ more: true, ...local, github_user: 'alice' }, s.ctx())) as G7Listed;
      assert.equal(said(), undefined, 'her statements are not applied');
      assert.doesNotMatch(claim.show_to_builder, /Your entries|AliceApp/);
      assert.ok(!('ask_outcome' in claim));
      // B's code: B's (empty) memory, never A's.
      const b = (await handlers.list_programs({ more: true, ...local, signed_in: codeB }, s.ctx())) as G7Listed;
      assert.equal(said(), undefined);
      assert.doesNotMatch(b.show_to_builder, /AliceApp|SecretB/);
      assert.ok(!('ask_outcome' in b));
      // A's code: her memory, her entry only, her outcome question.
      const a = (await handlers.list_programs({ more: true, ...local, signed_in: codeA }, s.ctx())) as G7Listed & { ask_outcome?: { project_id: number } };
      assert.deepEqual(said(), { 'name:tipjar': { mainnet: [], testnet: [], live_url: null, has_users: null, not_mine: true } });
      assert.match(a.show_to_builder, /Your entries: .*AliceApp/);
      assert.doesNotMatch(a.show_to_builder, /SecretB/);
      assert.equal(a.ask_outcome?.project_id, entry);
      // An expired code: nothing.
      await sql()`UPDATE github_verifications SET code_expires_at = now() - interval '1 second' WHERE installation_id = ${s.id} AND login = 'alice'`;
      const late = (await handlers.tell_earnkit({ program_status: [{ program_id: s.programId, status: 'not_interested' }], signed_in: codeA }, s.ctx())) as Told;
      assert.equal(late.show_to_builder, 'Noted for now.');
    } finally {
      await sql()`DELETE FROM github_verifications WHERE installation_id = ${s.id}`;
      await s.cleanup();
    }
  }));

test("G10 (fix round 2): on Grok Bot, user B's record_submission never launches on A's proven repo; no wallet is kept on the entry; A's code launches", dbTest, () =>
  withTokenEnv(() =>
    withSignIn(async () => {
      const t = await confirmSetup('g10rec');
      await sql()`UPDATE installations SET shared_client = true WHERE id = ${t.inst}`;
      // The repo carries the agent's own proof line (A pushed it): confirmSetup's default reader.
      const ctx = { ...t.ctx, sharedClient: true };
      const WB = '0x3333333333333333333333333333333333333333';
      const rec = (wallet: string, signed_in?: string) =>
        handlers.record_submission(
          {
            program_id: t.p.id,
            project: { ...t.project, description: 'Tips for creators on Arc' },
            submission_data: t.answers,
            payout_wallet: wallet,
            token: { name: t.offered.name, symbol: t.offered.symbol },
            builder_confirmed: true,
            ...(signed_in && { signed_in }),
          },
          ctx,
        ) as Promise<{ project_id: number; token?: { status: string } }>;
      const b = await rec(WB);
      assert.notEqual(b.token?.status, 'launched');
      assert.equal(t.calls.deploy, 0);
      const [row] = await sql()<{ creator_wallet: string | null }[]>`SELECT creator_wallet FROM projects WHERE id = ${b.project_id}`;
      assert.equal(row.creator_wallet, null, 'B\'s wallet is not kept on the entry');
      // A signs in for this entry (with W8); B, without A's code, still gets nothing.
      const codeA = await signInAs(t.inst, b.project_id, t.repo, 'alice');
      assert.notEqual((await rec(WB)).token?.status, 'launched');
      assert.notEqual((await rec(W8)).token?.status, 'launched', 'the right wallet but no code');
      assert.equal(t.calls.deploy, 0);
      // A, with the code and the wallet the sign-in was made for: launched.
      assert.equal((await rec(W8, codeA!)).token?.status, 'launched');
      assert.deepEqual(t.calls.wallets, [W8]);
    }),
  ));

// ---- v2.10 items 5 and 15: the token pitched once, at confirm; the deadline line in replies

/** Another copy of the setup's program (same installation and repo), titled `title`. */
async function extraProgram(t: Awaited<ReturnType<typeof confirmSetup>>, suffix: string, title: string) {
  const p = { ...t.p, id: `${t.p.id}-${suffix}`, title };
  await upsertProgram(ProgramFile.parse(p));
  return p;
}

test('7.9 v2.10 item 15 (Review Focus 5): the deadline line starts prepare_submission\'s reply; never on a shared client without a code; with one, only that login\'s entries', dbTest, () =>
  withTokenEnv(() =>
    withSignIn(async () => {
      const t = await confirmSetup('t7dead');
      const soon = await extraProgram(t, 'soon', 'Soon Grants');
      const skip = { builder_confirmed: true, decision: 'skip' } as const;
      // Two unsubmitted entries (confirmed, never submitted): Arc's and Soon Grants'.
      const a = (await handlers.confirm_entry({ ...t.input, ...skip }, t.ctx)) as Confirmed;
      await handlers.confirm_entry({ ...t.input, program_id: soon.id, ...skip }, t.ctx);
      await sql()`UPDATE programs SET ends_at = now() + interval '50 hours' WHERE id = ${t.p.id}`;
      await sql()`UPDATE programs SET ends_at = now() + interval '26 hours' WHERE id = ${soon.id}`;
      const prep = async (ctx: object, extra: object = {}) =>
        ((await handlers.prepare_submission({ ...t.input, ...extra }, ctx as typeof t.ctx)) as { show_to_builder: string }).show_to_builder;
      const reset = () => sql()`UPDATE installations SET deadline_shown = NULL WHERE id = ${t.inst}`;
      // Non-shared: the soonest first, once a day.
      const first = await prep(t.ctx);
      assert.ok(first.startsWith("Soon Grants closes tomorrow; your entry isn't submitted.\n\n"), first);
      const again = await prep(t.ctx);
      assert.ok(again.startsWith("Arc Microgrants closes in 2 days; your entry isn't submitted.\n\n"), again);
      assert.doesNotMatch(await prep(t.ctx), /closes (today|tomorrow|in \d days)/);
      // Shared, no code: nothing (G7).
      await reset();
      const shared = { ...t.ctx, sharedClient: true };
      assert.doesNotMatch(await prep(shared), /closes (today|tomorrow|in \d days)/);
      // Shared, alice's code for the Arc entry only: Arc's line, never Soon Grants'.
      await sql()`UPDATE installations SET shared_client = true WHERE id = ${t.inst}`;
      const code = await signInAs(t.inst, a.project_id!, t.repo, 'alice');
      assert.ok(code);
      const signed = await prep(shared, { signed_in: code });
      assert.ok(signed.startsWith("Arc Microgrants closes in 2 days; your entry isn't submitted.\n\n"), signed);
      assert.doesNotMatch(signed, /Soon Grants closes/);
    }),
  ));

test('8.15 prepare_submission host: true: the sign-in link, then a 15-minute upload URL; never in builder text; off without R2', dbTest, async () => {
  const env = {
    R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKID', R2_SECRET_ACCESS_KEY: 's'.repeat(40), R2_BUCKET: 'sites',
    GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret',
  };
  const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const restore = () => {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  const s = `${process.pid}${Date.now().toString(36)}`;
  const f = committedProgram('arc-microgrants');
  Object.assign(f, { id: `t8-host-${s}`, status: 'closed' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t8-host-${s}`}) RETURNING id`;
  const login = `hzt${s}`;
  const repo = `https://github.com/${login}/tipjar`;
  const call = () =>
    handlers.prepare_submission({ program_id: f.id, project: { name: 'TipJar', repo_url: repo }, host: true }, { installationId: id }) as Promise<
      Record<string, unknown> & { host: Record<string, string>; show_to_builder: string }
    >;
  const toolNames = /\b(list_programs|get_program|prepare_submission|confirm_entry|record_submission|launch_token|tell_earnkit|upload_url)\b/;
  try {
    Object.assign(process.env, env);
    const first = await call();
    assert.match(first.host.sign_in_url, /\/github\/verify\?n=/);
    assert.match(first.host.show_to_builder, /^One click to prove TipJar is yours, then it goes live: https:\/\/\S+\/github\/verify\?n=/);
    assert.doesNotMatch(first.host.show_to_builder, toolNames);
    const [nonce] = await sql()<{ purpose: string }[]>`
      SELECT purpose FROM github_verify_nonces WHERE installation_id = ${id} AND repo_key = ${`${login}/tipjar`}`;
    assert.equal(nonce.purpose, 'host');

    await sql()`
      INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
      VALUES (${`${login}/tipjar`}, ${login}, ${id}, '2020-01-01', 3, 'host')`;
    const before = Date.now();
    const second = await call();
    assert.match(second.host.upload_url, /\/api\/host\/upload\?t=[A-Za-z0-9_-]{43}$/);
    const expires = new Date(second.host.expires_at).getTime();
    assert.ok(Math.abs(expires - (before + 15 * 60_000)) < 10_000, '15 minutes on');
    assert.match(second.host.agent_note, /POST the built site as one zip/);
    assert.ok(!JSON.stringify(second.show_to_builder).includes(second.host.upload_url));
    assert.doesNotMatch(second.show_to_builder, toolNames);
    assert.equal('show_to_builder' in second.host, false, 'nothing for the builder with an upload URL');
    restore();
    for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[k];
    process.env.GITHUB_OAUTH_CLIENT_ID = 'id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'secret';
    const off = await call();
    assert.deepEqual(off.host, { unavailable: 'Hosting is not available right now.' });
    const none = (await handlers.prepare_submission({ program_id: f.id, project: { name: 'TipJar', repo_url: repo } }, { installationId: id })) as Record<string, unknown>;
    assert.equal('host' in none, false, 'no host block unless asked');
  } finally {
    restore();
  }
});

// ---- v2.9 E19, Ruling 13 (Pre-flight P16): the weekly email question, once per installation.
const EMAIL_FIELD: SubmissionRequirement = {
  key: 'email', label: 'Contact email', todo: 'your email', type: 'email', required: false, from: 'builder', kind: 'contact',
};
async function withResend<T>(fn: () => Promise<T>, on = true): Promise<T> {
  const prev = process.env.RESEND_API_KEY;
  if (on) process.env.RESEND_API_KEY = 're_test_never_used';
  else delete process.env.RESEND_API_KEY;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prev;
  }
}
const subscription = async (inst: number) =>
  (await sql()<{ email: string; opted: boolean }[]>`
    SELECT email, opted_in_at IS NOT NULL AS opted FROM digest_subscriptions WHERE installation_id = ${inst}`)[0] ?? null;
const skip = { builder_confirmed: true, decision: 'skip' } as const;

test('10.9 the first recorded entry asks once; a plain yes uses that entry\'s email', dbTest, () =>
  withTokenEnv(() =>
    withResend(async () => {
      const t = await confirmSetup('email', { extra: [EMAIL_FIELD] });
      const answers = { ...t.answers, email: 'Alice@Example.com' };
      const first = (await handlers.confirm_entry({ ...t.input, answers, ...skip }, t.ctx)) as Confirmed;
      assert.ok(first.kit);
      assert.ok(first.show_to_builder.endsWith(`\n\n${EMAIL_QUESTION}`), first.show_to_builder);
      assert.ok(!first.show_to_builder.includes('alice@example.com'), 'a non-shared question names no address');
      assert.ok(first.agent_note!.endsWith(EMAIL_NOTE));
      assert.equal(EMAIL_NOTE, "Pass the builder's answer to tell as weekly_email.");
      // The second entry (and the same one again) never asks.
      const project = { ...t.project, name: 'Tip Jar Two', repo_url: `${t.repo}-two` };
      const second = (await handlers.confirm_entry({ ...t.input, project, answers, ...skip }, t.ctx)) as Confirmed;
      assert.ok(second.kit);
      assert.ok(!second.show_to_builder.includes(EMAIL_QUESTION));
      assert.ok(!(second.agent_note ?? '').includes('weekly_email'));
      assert.deepEqual(await subscription(t.inst), { email: 'alice@example.com', opted: false }, 'kept, not opted in');
      const yes = (await handlers.tell_earnkit({ weekly_email: { answer: 'Yes' } }, t.ctx)) as { show_to_builder: string; saved: string[] };
      assert.equal(yes.show_to_builder, EMAIL_ON);
      assert.deepEqual(yes.saved, ['weekly email: on']);
      assert.deepEqual(await subscription(t.inst), { email: 'alice@example.com', opted: true });
      const no = (await handlers.tell_earnkit({ weekly_email: { answer: 'no' } }, t.ctx)) as { show_to_builder: string };
      assert.equal(no.show_to_builder, 'No weekly email.');
      // The address goes; the row stays, so the question is never asked again.
      assert.deepEqual(await subscription(t.inst), { email: null, opted: false });

    }),
  ));

test('10.9, Ruling G21: a hosted agent asks once per signed-in login, never without a code; each login changes only its own subscription', dbTest, () =>
  withTokenEnv(() =>
    withSignIn(() =>
      withResend(async () => {
        const s = await confirmSetup('email-shared', { extra: [EMAIL_FIELD] });
        await sql()`UPDATE installations SET shared_client = true WHERE id = ${s.inst}`;
        const sctx = { ...s.ctx, sharedClient: true };
        // No code: no question, and a weekly_email answer changes nothing.
        const none = (await handlers.confirm_entry({ ...s.input, answers: { ...s.answers, email: 'bob@example.com' }, ...skip }, sctx)) as Confirmed;
        assert.ok(none.kit);
        assert.ok(!none.show_to_builder.includes('by email'));
        for (const w of [{ answer: 'yes', email: 'bob@example.com' }, { answer: 'no' }]) {
          const r = (await handlers.tell_earnkit({ weekly_email: w }, sctx)) as { show_to_builder: string; saved: string[]; agent_note: string };
          assert.equal(r.show_to_builder, EMAIL_SIGN_IN);
          assert.deepEqual(r.saved, []);
          assert.match(r.agent_note, /signed_in/);
        }
        assert.equal(await subscription(s.inst), null);
        const subs = async () =>
          (await sql()<{ login: string; email: string | null; opted: boolean }[]>`
            SELECT login, email, opted_in_at IS NOT NULL AS opted FROM digest_subscriptions WHERE installation_id = ${s.inst} ORDER BY login`).map((r) => ({ ...r }));

        // Alice signs in: her entry's typed address is named; her plain yes uses it.
        const codeA = (await signInAs(s.inst, null, s.repo, 'alice'))!;
        const projA = { ...s.project, name: 'Tip Jar A', repo_url: `${s.repo}-a` };
        const a = (await handlers.confirm_entry({ ...s.input, project: projA, answers: { ...s.answers, email: 'alice@example.com' }, signed_in: codeA, ...skip }, sctx)) as Confirmed;
        assert.ok(a.show_to_builder.endsWith(`\n\n${emailQuestionFor('alice@example.com')}`), a.show_to_builder);
        assert.ok(a.agent_note!.endsWith(`${EMAIL_NOTE} ${EMAIL_SHARED_NOTE}`));
        const again = (await handlers.confirm_entry({ ...s.input, project: { ...projA, name: 'Tip Jar A2', repo_url: `${s.repo}-a2` }, answers: { ...s.answers, email: 'alice@example.com' }, signed_in: codeA, ...skip }, sctx)) as Confirmed;
        assert.ok(!again.show_to_builder.includes('by email'), 'once per login');
        assert.equal(((await handlers.tell_earnkit({ weekly_email: { answer: 'yes' }, signed_in: codeA }, sctx)) as { show_to_builder: string }).show_to_builder, EMAIL_ON);

        // Bob signs in on the same agent: asked too (his own login), his own subscription.
        const codeB = (await signInAs(s.inst, null, s.repo, 'bob'))!;
        const b = (await handlers.confirm_entry({ ...s.input, project: { ...s.project, name: 'Tip Jar B', repo_url: `${s.repo}-b` }, answers: { ...s.answers, email: 'bob@example.com' }, signed_in: codeB, ...skip }, sctx)) as Confirmed;
        assert.ok(b.show_to_builder.endsWith(`\n\n${emailQuestionFor('bob@example.com')}`));
        await handlers.tell_earnkit({ weekly_email: { answer: 'yes' }, signed_in: codeB }, sctx);
        assert.deepEqual(await subs(), [
          { login: 'alice', email: 'alice@example.com', opted: true },
          { login: 'bob', email: 'bob@example.com', opted: true },
        ]);
        // Bob's "no" (and a yes with another address) never touches Alice's.
        await handlers.tell_earnkit({ weekly_email: { answer: 'no' }, signed_in: codeB }, sctx);
        await handlers.tell_earnkit({ weekly_email: { answer: 'yes', email: 'mallory@example.com' }, signed_in: codeB }, sctx);
        assert.deepEqual(await subs(), [
          { login: 'alice', email: 'alice@example.com', opted: true },
          { login: 'bob', email: 'mallory@example.com', opted: true },
        ]);

        // record_submission (P16): an address the answer bank already holds for this project is
        // never named on a hosted agent (it may be another builder's).
        const codeC = (await signInAs(s.inst, null, s.repo, 'carol'))!;
        const projC = { name: 'Tip Jar C', repo_url: `${s.repo}-c`, live_url: 'https://tipjar.xyz' };
        await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id)
          VALUES (${s.inst}, ${projectKey(projC)}, 'contact', ${JSON.stringify({ email: 'dave@example.com' })}, ${s.p.id})`;
        const rec = (await handlers.record_submission(
          { program_id: s.p.id, project: projC, submission_data: { ...s.answers, email: 'dave@example.com' }, token: 'skip', signed_in: codeC },
          sctx,
        )) as { show_to_builder: string; agent_note?: string };
        assert.ok(rec.show_to_builder.endsWith(`\n\n${EMAIL_QUESTION}`), rec.show_to_builder);
        assert.ok(!rec.show_to_builder.includes('dave@example.com'));
      }),
    ),
  ));

test('10.8 without RESEND_API_KEY the question is never asked and a yes saves nothing', dbTest, () =>
  withTokenEnv(() =>
    withResend(async () => {
      const t = await confirmSetup('email-off', { extra: [EMAIL_FIELD] });
      const r = (await handlers.confirm_entry({ ...t.input, answers: { ...t.answers, email: 'a@b.co' }, ...skip }, t.ctx)) as Confirmed;
      assert.ok(r.kit);
      assert.ok(!r.show_to_builder.includes(EMAIL_QUESTION));
      const [row] = await sql()<{ asked: Date | null }[]>`SELECT digest_asked_at AS asked FROM installations WHERE id = ${t.inst}`;
      assert.equal(row.asked, null);
      const yes = (await handlers.tell_earnkit({ weekly_email: { answer: 'yes', email: 'a@b.co' } }, t.ctx)) as { show_to_builder: string; saved: string[] };
      assert.deepEqual(yes.saved, []);
      assert.equal(await subscription(t.inst), null);
    }, false),
  ));

test('10.11 list_programs: "Builders using EarnKit won $X" once, right after the headline; absent at 0', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`won-${process.pid}-${Date.now()}`}) RETURNING id`;
  const read = wonSource.read;
  try {
    wonSource.read = async () => 12_500;
    const r = (await handlers.list_programs({ more: true }, { installationId: id })) as { show_to_builder: string };
    const paras = r.show_to_builder.split('\n\n');
    // Joined to the money headline, or the first paragraph when the reply opens with a heading
    // (other test files' programs share this database); present.test pins each form exactly.
    assert.match(paras[0], /(^|in prizes (open right now|you qualify for)\. )Builders using EarnKit won \$12,500\.$/);
    assert.equal(r.show_to_builder.split('Builders using EarnKit won').length, 2, 'once');
    wonSource.read = async () => 0;
    const none = (await handlers.list_programs({ more: true }, { installationId: id })) as { show_to_builder: string };
    assert.doesNotMatch(none.show_to_builder, /Builders using EarnKit|won \$0/);
  } finally {
    wonSource.read = read;
    await sql()`DELETE FROM installations WHERE id = ${id}`;
  }
});

// ---- v2.10 Task 5 (item 11): description fields in plain words.
const PITCH: SubmissionRequirement = { key: 'pitch', label: 'One-sentence description', type: 'text', required: true, from: 'builder', kind: 'one_liner' };
const UNPLAIN = `Tip Jar, contract 0x${'ab12'.repeat(10)}, TVL: 1, tx: 2`;

test('5.4 prepare_submission: the plain-words fix is the agent\'s only; the builder sees the draft', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('plainprep', { remembered: W8, extra: [PITCH] });
    const r = (await handlers.prepare_submission({ ...t.input, answers: { ...t.answers, pitch: UNPLAIN } }, t.ctx)) as Record<string, unknown> & {
      show_to_builder: string;
      agent_fixes?: { rule: string; text: string }[];
      fixes?: { text: string }[];
    };
    assert.equal(r.ready, true);
    assert.ok(r.agent_fixes?.some((f) => f.rule === 'not_plain' && f.text === PLAIN_FIX('One-sentence description')));
    assert.ok(!r.show_to_builder.includes(PLAIN_FIX('One-sentence description')));
    assert.doesNotMatch(r.show_to_builder, /plain words/);
    assert.ok(!(r.fixes ?? []).some((f) => /plain words/.test(f.text)));
    assert.match(r.show_to_builder, /One-sentence description/, 'the draft shows');
  }));

test('5.3 (P32) record_submission on an EarnKit campaign refuses an unplain description; nothing recorded', dbTest, async (tc) => {
  const PAY = '0x' + 'a'.repeat(40);
  const f = committedProgram('earnkit-campaign-1-base');
  Object.assign(f, { id: `t5-camp-${process.pid}-${Date.now()}`, status: 'active', starts_at: '2026-09-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  Object.assign(f, earnkitTexts(f));
  await upsertProgram(ProgramFile.parse(f));
  dropAfter(tc, f.id);
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t5-camp-${process.pid}-${Date.now()}`}) RETURNING id`;
  const project = { name: 'Tip Jar', description: UNPLAIN, repo_url: 'https://github.com/alice/tipjar-t5', live_url: 'https://tipjar.xyz' };
  const r = (await handlers.record_submission(
    {
      program_id: f.id,
      project,
      submission_data: { project_name: 'Tip Jar', description: UNPLAIN, repo_url: project.repo_url, live_url: project.live_url, contracts: '0x' + '1'.repeat(40), payout_wallet: PAY },
      token: 'skip',
    },
    { installationId: id },
  )) as Record<string, unknown> & { agent_fixes?: { key: string; rule: string }[] };
  assert.ok(!('show_to_builder' in r));
  assert.equal(r.agent_note, PLAIN_NOTE);
  assert.deepEqual(r.agent_fixes?.map((x) => [x.key, x.rule]), [['description', 'not_plain']]);
  const rows = await sql()`SELECT 1 FROM projects WHERE installation_id = ${id}`;
  assert.equal(rows.length, 0);
});

// ---- v2.10 items 2 and 3: one lead line per first reply; the guide on the first prepare ----

test('8.6 v2.10 item 3 (Review Focus 5): the first prepare for a program starts with its guide, then the questions; never again, nor after an entry; a shared client shows it while the coach has not asked (R13)', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('guide1');
    const input = { ...t.input, answers: { description: t.answers.description } };
    const first = (await handlers.prepare_submission(input, t.ctx)) as Coached;
    const guide = await guideFor(t.p.id);
    // The guide: header, difficulty, what won (Arc has past rounds), what it wants, the best bet; no bonus line.
    assert.match(guide, /^Arc Microgrants · 500 USDC × 20 grants · ends Oct 14, 11:59 PM ET\nDifficulty: /);
    assert.match(guide, /\n\nWhat won (last time|before)\n/);
    assert.match(guide, /\n\nWhat Arc wants now\n- /);
    assert.match(guide, /\n\nYour best bet\n- /);
    assert.doesNotMatch(guide, /Builder bonus/);
    assert.ok(first.show_to_builder.startsWith(`${guide}\n\nArc Microgrants: 1 quick question`), first.show_to_builder);
    assert.equal(first.show_to_builder.split(guide).length, 2, 'once');
    // The second call for Arc: no guide.
    const second = (await handlers.prepare_submission(input, t.ctx)) as Coached;
    assert.ok(second.show_to_builder.startsWith('Arc Microgrants: 1 quick question'), second.show_to_builder);
    // Pre-flight P23: an entry, then the program leaves working_on (as recording does): still no guide.
    const yes = (await handlers.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.ok(yes.project_id);
    assert.equal(await hasProgramEntry(t.inst, t.p.id), true);
    await setWorkingOn(t.inst, t.p.id, false);
    const after = (await handlers.prepare_submission(input, t.ctx)) as Coached;
    assert.ok(!after.show_to_builder.includes(guide), after.show_to_builder);
    // A shared client: working_on is installation-wide, so the guide shows whenever coach_asked isn't set.
    const shared = { ...t.ctx, sharedClient: true };
    for (const n of [1, 2]) {
      const s = (await handlers.prepare_submission(input, shared)) as Coached;
      assert.ok(s.show_to_builder.startsWith(`${guide}\n\n`), `shared call ${n}: ${s.show_to_builder}`);
    }
    const asked = (await handlers.prepare_submission({ ...t.input, coach_asked: true }, shared)) as Coached;
    assert.ok(!asked.show_to_builder.includes(guide), asked.show_to_builder);
    // A closed program: no guide (and nothing added).
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${t.p.id}`;
    const fresh = await confirmSetup('guide1-closed');
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${fresh.p.id}`;
    const closed = (await handlers.prepare_submission({ ...fresh.input }, fresh.ctx)) as Coached;
    assert.ok(!closed.show_to_builder.includes('Difficulty:'), closed.show_to_builder);
  }));

test('8.7 v2.10 item 3: a program without past rounds or focus shows "What it wants" with its first 2 rules, no "What won"; get_program has no guide_note', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('guide2');
    const ava = { ...committedProgram('avalanche-team1-mini-grants'), id: `${t.p.id}-ava`, status: 'active' };
    await upsertProgram(ProgramFile.parse(ava));
    // Closed at the end: an open Avalanche copy (needs no repo) would become other tests' no-repo offer.
    try {
    const rules = ProgramFile.parse(ava).rules;
    const r = (await handlers.prepare_submission({ program_id: ava.id, project: t.project, answers: {} }, t.ctx)) as Coached;
    assert.ok(r.show_to_builder.includes(`\n\nWhat it wants\n- ${rules[0]}\n- ${rules[1]}\n\n`), r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /What won|wants now/);
    if (rules[2]) assert.ok(!r.show_to_builder.includes(rules[2]));
    const details = (await handlers.get_program({ program_id: ava.id }, t.ctx)) as { guide?: { text: string } };
    assert.ok(details.guide?.text.includes('What it wants'));
    assert.ok(!('guide_note' in details));
    assert.doesNotMatch(JSON.stringify(details), /show it when the builder asks|guide_note/);
    } finally {
      await sql()`UPDATE programs SET status = 'closed' WHERE id = ${ava.id}`;
    }
  }));

// ---- v2.10 item 4 (Task 9): the 4 tools dispatch to the v2.9 handlers; old calls (aliases) and their
// new forms give the same replies.

/** A reply with what differs between two setups (ids, repo, token codes and links) made equal. */
function same(t: Awaited<ReturnType<typeof confirmSetup>>, reply: unknown): string {
  const path = t.repo.replace('https://github.com/', '');
  return JSON.stringify(reply)
    .replaceAll(t.repo, 'REPO')
    .replaceAll(path, 'REPO_PATH')
    .replaceAll(t.p.id, 'PID')
    .replace(/(https:\/\/)?tokens\.fun\/coin\/0x[0-9a-f]+/g, 'TOKEN_URL')
    .replace(/token: [0-9a-f]{16}/g, 'token: CODE')
    .replace(/"project_id":\d+/g, '"project_id":0')
    .replace(/"submitted_at":"[^"]+"/g, '"submitted_at":"T"')
    // Test program ids and repo names carry the setup's tag and stamp (cut with an ellipsis in tables).
    .replace(/t8-[a-z0-9-]*…?/g, 'TEST_ID');
}

test('9.3 find: no program_id is list_programs; program_id shows the curated guide', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('t9find');
    const ctx = { ...t.ctx, matchProjects: async () => ({ checked: 0, fits: [] }) };
    // Lines said once (news, the deadline line) are taken by the first call; then the two agree.
    await handlers.list_programs({}, ctx);
    // Task 11: other test files add programs to the shared database while this runs, so a pair of
    // reads may straddle one; a pair that differs is read again (at most 3 times).
    const agree = async (input: object) => {
      let pair: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        pair = [await tools.find(input, ctx), await handlers.list_programs(input, ctx)];
        if (isDeepStrictEqual(pair[0], pair[1])) break;
      }
      assert.deepEqual(pair[0], pair[1]);
    };
    await agree({});
    await agree({ more: true });
    const one = (await tools.find({ program_id: t.p.id }, ctx)) as { show_to_builder: string; guide: { text: string } };
    assert.equal(one.show_to_builder, one.guide.text);
    assert.match(one.show_to_builder, /^Arc Microgrants/);
    const rest: Record<string, unknown> = { ...one };
    delete rest.show_to_builder;
    assert.deepEqual(rest, await handlers.get_program({ program_id: t.p.id }, ctx));
    await assert.rejects(tools.find({ program_id: t.p.id, nope: 1 }, ctx), /Unrecognized key/);
  }));

test('9.3 tell: pickup is pick_up_entries; statements are tell_earnkit; several at once join their lines in order', dbTest, async () => {
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t9tell-${process.pid}-${Date.now()}`}) RETURNING id`;
  const ctx = { installationId: inst };
  assert.deepEqual(await tools.tell({ pickup: 'no' }, ctx), await handlers.pick_up_entries({ answer: 'no' }, ctx));
  const told = { repo_facts: [{ repo: 'alice/tipjar', has_users: true }] };
  const viaOld = (await handlers.tell_earnkit(told, ctx)) as { agent_note: string };
  const viaNew = (await tools.tell(told, ctx)) as { agent_note: string };
  assert.deepEqual(viaNew, viaOld);
  assert.match(viaNew.agent_note, /The next find uses it/);
  const both = (await tools.tell({ pickup: 'no', weekly_email: { answer: 'no' } }, ctx)) as { show_to_builder: string };
  const pick = (await handlers.pick_up_entries({ answer: 'no' }, ctx)) as { show_to_builder: string };
  const mail = (await handlers.tell_earnkit({ weekly_email: { answer: 'no' } }, ctx)) as { show_to_builder?: string };
  assert.equal(both.show_to_builder, [pick.show_to_builder, mail.show_to_builder].filter(Boolean).join('\n'));
  await assert.rejects(tools.tell({ pickup: 'maybe' }, ctx), /Invalid option/);
  await assert.rejects(tools.tell({}, ctx), /Pass at least one/);
});

test('9.3 prepare is prepare_submission (the same strict input); an old call aliased gives the same reply', dbTest, () =>
  withTokenEnv(async () => {
    const a = await confirmSetup('t9prepa');
    const b = await confirmSetup('t9prepb');
    const old = await handlers.prepare_submission({ ...a.input, coach_asked: true }, a.ctx);
    const next = aliasCall('prepare_submission', { ...b.input, coach_asked: true })!;
    assert.equal(same(b, await tools.prepare(next.args, b.ctx)), same(a, old));
  }));

test('9.3 find with repo: the eligibility check as one plain line after the guide', () => {
  assert.equal(eligibilityLine('https://github.com/alice/tipjar', { status: 'likely', missing: [], effort: null, note: null }), 'alice/tipjar fits.');
  assert.equal(eligibilityLine('alice/tipjar', { status: 'after_step', missing: [], effort: null, note: 'needs a mainnet deploy.' }), 'alice/tipjar fits after one step: needs a mainnet deploy.');
  assert.equal(eligibilityLine('alice/tipjar.git', { status: 'no', missing: [], effort: null, note: 'no arc code found in this repo' }), "alice/tipjar doesn't fit yet: no arc code found in this repo.");
  assert.equal(eligibilityLine('alice/tipjar', { error: "Couldn't read your repos on GitHub." }), "Couldn't read your repos on GitHub.");
  assert.equal(eligibilityLine('alice/tipjar', null), null);
});

test('fix round 2 (Minor): withoutTokenLine drops the entered line\'s token sentence only', () => {
  assert.equal(withoutTokenLine('Entered in Arc. Your token: tokens.fun/coin/0xabc.\nBuilder bonus: 0.2 ETH so far'), 'Entered in Arc.\nBuilder bonus: 0.2 ETH so far');
  assert.equal(withoutTokenLine("Entered in Arc. Your token isn't launched yet; it joins the builder bonus once it is.\nBuilder bonus: x"), 'Entered in Arc.\nBuilder bonus: x');
  assert.equal(withoutTokenLine('Entered in Arc. Your token is launching.'), 'Entered in Arc.');
  assert.equal(withoutTokenLine('Entered in Arc.'), 'Entered in Arc.');
});

// ---- v2.10 item 13: prepare with deploy

test('10.11 prepare with deploy: off without DEPLOYER_PRIVATE_KEY (no chain read); on, the deployed line ends show_to_builder and the address is nowhere else', dbTest, async () => {
  const { DEPLOY_LINES, deployedLine } = await import('./deploy');
  const f = committedProgram('arc-microgrants');
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t10-deploy-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t10-${stamp}`}) RETURNING id`;
  const repoKey = `alice${process.pid}x${Date.now()}/tipjar`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, ${`alice${process.pid}x${Date.now()}`}, ${id}, now(), 3, 'entry')`; // the day limit is keyed by this login (I6)
  const ADDR = '0x00000000000000000000000000000000000a11ce';
  const OWNER = '0x2222222222222222222222222222222222222222';
  let reads = 0;
  const chain = {
    estimate: async () => ((reads++), { gas: 100_000n, maxFeePerGas: 100_000_000_000n }),
    balance: async () => ((reads++), 10n ** 18n),
    send: async () => `0x${'ab'.repeat(32)}` as const,
    receipt: async () => ({ status: 'success' as const, contractAddress: ADDR as `0x${string}`, gasUsed: 50_000n, effectiveGasPrice: 100_000_000_000n }),
    simulate: async () => `0x${'60'.repeat(50)}` as const,
    nonce: async () => 1,
    code: async () => `0x${'60'.repeat(50)}` as const,
    read: async (a: { fn: string }) => (a.fn === 'owner' ? OWNER : null),
    write: async () => `0x${'cd'.repeat(32)}` as const,
  };
  const abi = [{ type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' }];
  const call = {
    program_id: f.id,
    project: { name: 'TipJar', repo_url: `https://github.com/${repoKey}`, description: 'A tip jar for streamers.' },
    deploy: { chain: 'base', bytecode: `0x${'60'.repeat(40)}`, abi, owner_wallet: OWNER },
  };
  const ctx = {
    installationId: id,
    deployDeps: { chain: () => chain, usdPerNative: async () => 1, now: new Date(Date.UTC(2160, Number(process.pid % 12), 3)), gate: { owner: async () => ({ status: 'missing' as const }), latest: async () => null } },
  };
  const off = (await tools.prepare(call, ctx)) as { deploy: unknown; show_to_builder: string };
  assert.deepEqual(off.deploy, { unavailable: DEPLOY_LINES.off });
  assert.equal(reads, 0);
  const keys = ['DEPLOYER_PRIVATE_KEY', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];
  const old = keys.map((k) => process.env[k]);
  process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
  try {
    const on = (await tools.prepare(call, ctx)) as Record<string, unknown> & { show_to_builder: string };
    const line = deployedLine('TipJar', 'base', ADDR, true);
    assert.ok(on.show_to_builder.endsWith(`\n\n${line}`), on.show_to_builder);
    assert.deepEqual(on.deploy, { address: ADDR, chain: 'base', owner_ok: true });
    // The short address shows once (the deployed line); the full address in no builder text.
    assert.equal(on.show_to_builder.split('0x0000…11ce').length - 1, 1);
    const builderText = JSON.stringify({ ...on, deploy: undefined, agent_note: undefined });
    assert.ok(!builderText.toLowerCase().includes(ADDR.slice(2)), 'the address only in deploy');
  } finally {
    keys.forEach((k, i) => (old[i] === undefined ? delete process.env[k] : (process.env[k] = old[i])));
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

test('v2.10.3 prepare with an Arc deploy while DEPLOY_CHAINS=base: refused cleanly, before the wallet ask, the login read or any chain', dbTest, async () => {
  const f = committedProgram('arc-microgrants');
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t1003-arc-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t1003-${stamp}`}) RETURNING id`;
  let touched = 0;
  const names = ['DEPLOYER_PRIVATE_KEY', 'DEPLOY_CHAINS'];
  const old = names.map((n) => process.env[n]);
  process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
  process.env.DEPLOY_CHAINS = 'base';
  try {
    const r = (await tools.prepare(
      { program_id: f.id, project: { name: 'TipJar', repo_url: 'https://github.com/alice/tipjar' }, deploy: { chain: 'arc', bytecode: '0x6060', abi: [] } },
      { installationId: id, deployDeps: { chain: () => ((touched++), null), installationLogin: async () => ((touched++), 'alice') } },
    )) as { deploy: unknown; show_to_builder: string; agent_note?: string };
    assert.deepEqual(r.deploy, { unavailable: 'Deploys on Arc are off right now.' });
    assert.ok(r.show_to_builder.endsWith('Deploys on Arc are off right now.'), r.show_to_builder);
    assert.equal(touched, 0, 'no login read, no chain');
  } finally {
    names.forEach((n, i) => (old[i] === undefined ? delete process.env[n] : (process.env[n] = old[i])));
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

test('10.11 prepare with deploy and no wallet known: the reply asks for the owner wallet in one line', dbTest, async () => {
  const f = committedProgram('arc-microgrants');
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t10-wallet-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t10w-${stamp}`}) RETURNING id`;
  try {
    const r = (await tools.prepare(
      { program_id: f.id, project: { name: 'TipJar', repo_url: 'https://github.com/alice/tipjar' }, deploy: { chain: 'arc', bytecode: '0x6060', abi: [] } },
      { installationId: id },
    )) as { deploy: unknown; show_to_builder: string };
    assert.deepEqual(r.deploy, { needs_wallet: 'Send me the wallet that should own TipJar.' });
    assert.ok(r.show_to_builder.endsWith('Send me the wallet that should own TipJar.'));
  } finally {
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

test('v2.11 T8: prepare with deploy never makes a public test wallet the owner (given or remembered): it asks for the builder\'s own, and nothing is deployed', dbTest, async () => {
  const f = committedProgram('arc-microgrants');
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t8-testw-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', fresh_build: undefined });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t8w-${stamp}`}) RETURNING id`;
  let chainCalls = 0;
  const deployDeps = { chain: () => (chainCalls++, null) } as unknown as DeployDeps;
  try {
    const call = (owner_wallet?: string) =>
      tools.prepare(
        { program_id: f.id, project: { name: 'TipJar', repo_url: 'https://github.com/alice/tipjar' }, deploy: { chain: 'arc', bytecode: '0x6060', abi: [], ...(owner_wallet && { owner_wallet }) } },
        { installationId: id, deployDeps },
      ) as Promise<{ deploy: unknown; show_to_builder: string; agent_note?: string }>;
    const given = await call('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    assert.deepEqual(given.deploy, { needs_wallet: 'Send me the wallet that should own TipJar.' });
    assert.match(given.agent_note ?? '', /public test/);
    await sql()`UPDATE installations SET payout_wallet = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' WHERE id = ${id}`;
    const remembered = await call();
    assert.deepEqual(remembered.deploy, { needs_wallet: 'Send me the wallet that should own TipJar.' });
    assert.equal(chainCalls, 0, 'no deploy was attempted');
  } finally {
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

test('fix round 2 (N6): prepare with deploy refuses when the installation login read fails (never a fresh key)', dbTest, async () => {
  const { DEPLOY_LINES } = await import('./deploy');
  const f = committedProgram('arc-microgrants');
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t10-n6-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t10n6-${stamp}`}) RETURNING id`;
  let chainCalls = 0;
  const old = process.env.DEPLOYER_PRIVATE_KEY;
  process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
  try {
    const r = (await tools.prepare(
      {
        program_id: f.id,
        project: { name: 'TipJar', repo_url: 'https://github.com/alice/tipjar' },
        deploy: { chain: 'base', bytecode: '0x6060', abi: [], owner_wallet: '0x2222222222222222222222222222222222222222' },
      },
      { installationId: id, deployDeps: { chain: () => ((chainCalls++), null), installationLogin: async () => { throw new Error('db down'); } } },
    )) as { deploy: unknown; show_to_builder: string };
    assert.deepEqual(r.deploy, { unavailable: DEPLOY_LINES.lowBalance });
    assert.ok(r.show_to_builder.endsWith(DEPLOY_LINES.lowBalance));
    assert.equal(chainCalls, 0, 'nothing reached the deploy');
  } finally {
    if (old === undefined) delete process.env.DEPLOYER_PRIVATE_KEY;
    else process.env.DEPLOYER_PRIVATE_KEY = old;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

test('final fix M3: on a shared client, prepare with deploy refuses while sign-in is off, and when the caller login read fails', dbTest, async () => {
  const { DEPLOY_LINES } = await import('./deploy');
  const f = committedProgram('arc-microgrants');
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t10-m3-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t10m3-${stamp}`}) RETURNING id`;
  let chainCalls = 0;
  let loginReads = 0;
  const call = {
    program_id: f.id,
    project: { name: 'TipJar', repo_url: 'https://github.com/alice/tipjar' },
    signed_in: 'ABCD-EFGH',
    deploy: { chain: 'base', bytecode: '0x6060', abi: [], owner_wallet: '0x2222222222222222222222222222222222222222' },
  };
  const ctx = {
    installationId: id,
    sharedClient: true,
    deployDeps: {
      chain: () => ((chainCalls++), null),
      callerLogin: async () => {
        loginReads++;
        throw new Error('db down');
      },
    },
  };
  const keys = ['DEPLOYER_PRIVATE_KEY', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];
  const old = keys.map((k) => process.env[k]);
  process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  try {
    // Sign-in off: no deploy on a shared client (never keyed by the repo or the agent-wide proof).
    const off = (await tools.prepare(call, ctx)) as { deploy: unknown; show_to_builder: string };
    assert.deepEqual(off.deploy, { unavailable: DEPLOY_LINES.off });
    assert.ok(off.show_to_builder.endsWith(DEPLOY_LINES.off), off.show_to_builder);
    assert.equal(loginReads, 0);
    // Sign-in on, the caller login read fails: refused (N6), never a deploy keyed by the repo.
    process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
    const errLog = console.error;
    console.error = () => {};
    const failed = (await tools.prepare(call, ctx).finally(() => (console.error = errLog))) as { deploy: unknown; show_to_builder: string };
    assert.deepEqual(failed.deploy, { unavailable: DEPLOY_LINES.lowBalance });
    assert.equal(loginReads, 1);
    assert.equal(chainCalls, 0, 'nothing reached the deploy');
  } finally {
    keys.forEach((k, i) => (old[i] === undefined ? delete process.env[k] : (process.env[k] = old[i])));
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

test('T11 fix (journey 11.0): prepare with deploy checks this draft with the deployed contract: no "No contract found" next to the deployed line', dbTest, async () => {
  const { deployedLine } = await import('./deploy');
  const f = committedProgram('arc-microgrants', { keepContract: true });
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t11-deploy-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t11d-${stamp}`}) RETURNING id`;
  const repoKey = `t11x${process.pid}x${Date.now()}/tipjar`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, ${`t11${process.pid}x${Date.now()}`}, ${id}, now(), 3, 'entry')`;
  const ADDR = '0x12ab00000000000000000000000000000000' + '9f3e';
  const OWNER = '0x2222222222222222222222222222222222222222';
  const chain = {
    estimate: async () => ({ gas: 100_000n, maxFeePerGas: 1_000_000_000n }),
    balance: async () => 10n ** 18n,
    send: async () => `0x${'ab'.repeat(32)}` as const,
    receipt: async () => ({ status: 'success' as const, contractAddress: ADDR as `0x${string}`, gasUsed: 50_000n, effectiveGasPrice: 1_000_000_000n }),
    simulate: async () => `0x${'60'.repeat(50)}` as const,
    nonce: async () => 1,
    code: async () => `0x${'60'.repeat(50)}` as const,
    read: async (a: { fn: string }) => (a.fn === 'owner' ? OWNER : null),
    write: async () => `0x${'cd'.repeat(32)}` as const,
  };
  const abi = [{ type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' }];
  const project = { name: 'TipJar', repo_url: `https://github.com/${repoKey}`, live_url: 'https://tipjar-t11.xyz' };
  const answers = { description: 'Fans tip creators in USDC on Arc.', builder_profile: 'https://github.com/alice', payout_wallet: OWNER };
  const ctx = {
    installationId: id,
    deployDeps: { chain: () => chain, usdPerNative: async () => 1, now: new Date(Date.UTC(2161, Number(process.pid % 12), 3)), gate: { owner: async () => ({ status: 'missing' as const }), latest: async () => null } },
  };
  const keys = ['DEPLOYER_PRIVATE_KEY', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];
  const old = keys.map((k) => process.env[k]);
  process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
  try {
    const r = (await tools.prepare({ program_id: f.id, project, answers, coach_asked: true, deploy: { chain: 'arc', bytecode: `0x${'60'.repeat(40)}`, abi, owner_wallet: OWNER } }, ctx)) as Record<string, unknown> & { show_to_builder: string };
    assert.deepEqual(r.deploy, { address: ADDR, chain: 'arc', owner_ok: true });
    assert.ok(r.show_to_builder.endsWith(`\n\n${deployedLine('TipJar', 'arc', ADDR, true)}`), r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /No contract found/, 'the draft was checked with the deployed contract');
    assert.equal(r.ready, true, r.show_to_builder);
    // Without a deploy (and no contract given) the same draft says so: the check is real.
    const plain = (await tools.prepare({ program_id: f.id, project, answers, coach_asked: true }, { installationId: id })) as { show_to_builder: string };
    assert.match(plain.show_to_builder, /No contract found on Arc mainnet yet\./);
  } finally {
    keys.forEach((k, i) => (old[i] === undefined ? delete process.env[k] : (process.env[k] = old[i])));
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

// ---- v2.11 T3: the entered and submitted events through the tools

test('3.4, 3.5 confirm yes writes entered once; tell submitted writes submitted with the link once; a shared caller is named by its own sign-in', dbTest, () =>
  withEventLog(() =>
    withTokenEnv(() =>
      withSignIn(async () => {
        const t = await confirmSetup('t3tell');
        const first = (await tools.confirm({ ...t.input, yes: true, wallet: W8 }, t.ctx)) as Confirmed;
        assert.ok(first.kit, JSON.stringify(first));
        await tools.confirm({ ...t.input, yes: true, wallet: W8 }, t.ctx);
        const entered = await eventsByKey(`entered:${first.project_id}`);
        assert.equal(entered.length, 1, 'a second confirm writes none');
        const URL1 = 'https://dorahacks.io/buidl/3535';
        await tools.tell({ submitted: { program_id: t.p.id, external_submission_url: URL1 } }, t.ctx);
        await tools.tell({ submitted: { program_id: t.p.id, external_submission_url: 'https://dorahacks.io/buidl/9999' } }, t.ctx);
        const submitted = await eventsByKey(`submitted:${first.project_id}`);
        assert.equal(submitted.length, 1, 'a second tell writes none');
        const e = submitted[0];
        assert.equal(e.type, 'submitted');
        assert.equal(e.proof_url, URL1);
        assert.equal(e.program_id, t.p.id);
        assert.equal(e.project_id, first.project_id);
        assert.equal(e.installation_id, t.inst);
        assert.deepEqual(e.detail, { basis: 'link' });
        assert.deepEqual((await eventsOfInstallation(t.inst)).map((x) => x.type).sort(), ['entered', 'submitted']);

        // A shared client: the caller's own sign-in for this entry names the login.
        const s = await confirmSetup('t3tells');
        const mine = (await tools.confirm({ ...s.input, yes: true, wallet: W8 }, s.ctx)) as Confirmed;
        await sql()`UPDATE installations SET shared_client = true WHERE id = ${s.inst}`;
        const code = await signInAs(s.inst, mine.project_id!, s.repo, 'alice');
        await tools.tell({ submitted: { program_id: s.p.id, project_id: mine.project_id }, signed_in: code! }, { ...s.ctx, sharedClient: true });
        const [shared] = await eventsByKey(`submitted:${mine.project_id}`);
        assert.equal(shared.github_login, 'alice');
        assert.equal(shared.login_basis, 'signin');
        assert.equal(shared.proof_url, null);
        assert.deepEqual(shared.detail, { basis: 'builder_said' });
      }),
    ),
  ),
);

test('3.5 a shared client\'s tell submitted that is only noted writes no event', dbTest, () =>
  withEventLog(() =>
    withTokenEnv(() =>
      withSignIn(async () => {
        const t = await confirmSetup('t3noted');
        const first = (await tools.confirm({ ...t.input, yes: true, wallet: W8 }, t.ctx)) as Confirmed;
        await sql()`UPDATE installations SET shared_client = true WHERE id = ${t.inst}`;
        await tools.tell({ submitted: { program_id: t.p.id, project_id: first.project_id } }, { ...t.ctx, sharedClient: true });
        assert.equal((await eventsByKey(`submitted:${first.project_id}`)).length, 0);
      }),
    ),
  ),
);

// ---- v2.11 T7 (spec 1): find's no-repo lead, build_offer and fresh_offer_at ----

/** v2.10's no-repo line, the reply whenever there is no fresh pick. */
const T7_V210 = /^(\$[\d.,]+[KM]?\+?|Money) is open\. Want the 3 easiest\?$/;

/**
 * An Arc copy tagged for the fresh build (fixture only), closing in 36 hours ("closes tomorrow"), and
 * a new installation with no repos. The copy names a starter of its own (arc-tipjar's facts, tested,
 * under this run's id), and `starters` registers only that one, so no other test's program, nor
 * one left by an earlier run on the same database, can be the pick. Review I2: the program is
 * closed and the installation deleted when the test ends, so a rerun starts clean.
 */
async function freshSetup(tag: string, tc: TestContext) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const p = {
    ...arc,
    id: `t7-${tag}-${stamp}`,
    title: 'T7 Tip Grants',
    status: 'active',
    ends_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    fresh_build: { starter: `t7-${tag}-${stamp}-starter` },
  };
  await upsertProgram(ProgramFile.parse(p));
  const [{ id: inst }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`tools-t7-${tag}-${stamp}`}) RETURNING id`;
  const offerAt = async () => (await sql()<{ fresh_offer_at: Date | null }[]>`SELECT fresh_offer_at FROM installations WHERE id = ${inst}`)[0].fresh_offer_at;
  const base = { installationId: inst };
  const starterId = `t7-${tag}-${stamp}-starter`;
  // Tested today, so the pick-time 30-day rule (review M6) never ages the fixture out.
  const tested_at = new Date().toISOString().slice(0, 10);
  const starters = { [starterId]: { ...TESTED_STARTERS['arc-tipjar'], id: starterId, tested_at } } as unknown as typeof TESTED_STARTERS;
  tc.after(async () => {
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${p.id}`;
    // Children first (a build records projects on this installation), then the installation.
    await sql()`DELETE FROM projects WHERE installation_id = ${inst}`;
    await sql()`DELETE FROM installations WHERE id = ${inst}`;
  });
  return { p, inst, offerAt, base, starterId, starters };
}

/** Runs `fn` with the deployer, DEPLOY_CHAINS (v2.10.3) and R2 variables set as given (unset when undefined), then restores them. */
async function withShipEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const names = ['DEPLOYER_PRIVATE_KEY', 'DEPLOY_CHAINS', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) {
    if (vars[n] === undefined) delete process.env[n];
    else process.env[n] = vars[n];
  }
  try {
    return await fn();
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  }
}
const R2_ON = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'earnkit-sites' };
const DEPLOYER_ON = { DEPLOYER_PRIVATE_KEY: `0x${'11'.repeat(32)}` };

// ---- v2.11 T5/T6 follow-up: the real registry and Arc's real fresh_build stay closed in production ----

test('T6 follow-up: production fails closed: no deployer key (production today, or R2 only) offers nothing for the real files and registry, byte for byte; the key offers Arc, with R2 or (T9) the Pages fallback', async () => {
  // Arc Microgrants carries fresh_build in its program file, and arc-tipjar is tested (2026-10-11).
  const now = new Date('2026-10-11T12:00:00Z');
  const cards = fileCards();
  assert.deepEqual(cards.find((c) => c.id === 'arc-microgrants')?.fresh_build, { starter: 'arc-tipjar' });
  assert.equal(STARTERS['arc-tipjar'].tested_at, '2026-10-11');
  const message = (fresh?: ReturnType<typeof freshSwitches>) => ({
    alerts: [], campaigns: [], cards, repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now, more: false, ...(fresh && { fresh }),
  });
  const v210 = presentFirstMessage(message());
  assert.match(v210, T7_V210);
  // The switches read the env when the lead is worked out (deployOn is lazy), so all of it runs inside.
  const run = (vars: Record<string, string>) =>
    withShipEnv(vars, async () => {
      const fresh = freshSwitches({}, true);
      return { real: fresh.starters === undefined, lead: freshLead(message(fresh)), reply: presentFirstMessage(message(fresh)) };
    });
  for (const [label, vars] of [['production today (neither)', {}], ['R2 only', R2_ON]] as const) {
    const r = await run(vars);
    assert.ok(r.real, `${label}: the real registry`);
    assert.equal(r.lead, undefined, label);
    assert.equal(r.reply, v210, `${label}: the v2.10 line byte for byte`);
  }
  // Not vacuous: with both on, the same files and registry lead with Arc.
  const on = await run({ ...DEPLOYER_ON, ...R2_ON });
  assert.equal(on.lead?.card.id, 'arc-microgrants');
  assert.equal((await run(DEPLOYER_ON)).lead?.card.id, 'arc-microgrants', 'deployer only: the Pages fallback');
  assert.equal(
    on.reply.split('\n')[1],
    'Arc Microgrants pays 500 USDC and closes in 3 days. A USDC tip page on Arc takes about an hour. Want me to build it?',
  );
});

test('v2.10.3 freshSwitches: deployOn is deployChainOn, so a chain left out of DEPLOY_CHAINS is never a chain EarnKit can deploy to', async () => {
  const deployOn = (vars: Record<string, string | undefined>) =>
    withShipEnv(vars, async () => {
      const on = freshSwitches({}, true);
      return { arc: on.deployOn('arc'), base: on.deployOn('base') };
    });
  assert.deepEqual(await deployOn({ ...DEPLOYER_ON, DEPLOY_CHAINS: 'base' }), { arc: false, base: true });
  assert.deepEqual(await deployOn({ ...DEPLOYER_ON, DEPLOY_CHAINS: 'ARC ' }), { arc: true, base: false });
  assert.deepEqual(await deployOn(DEPLOYER_ON), { arc: true, base: true }, 'unset: both, as before');
  assert.deepEqual(await deployOn({ DEPLOY_CHAINS: 'arc,base' }), { arc: false, base: false }, 'no deployer key: off');
});

test('v2.10.3 production with DEPLOY_CHAINS=base: the real files and registry never offer the Arc starter (the v2.10 line byte for byte); DEPLOY_CHAINS=arc offers it', async () => {
  const now = new Date('2026-10-11T12:00:00Z');
  const cards = fileCards();
  const message = (fresh?: ReturnType<typeof freshSwitches>) => ({
    alerts: [], campaigns: [], cards, repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now, more: false, ...(fresh && { fresh }),
  });
  const v210 = presentFirstMessage(message());
  const run = (vars: Record<string, string>) =>
    withShipEnv(vars, async () => {
      const fresh = freshSwitches({}, true);
      return { lead: freshLead(message(fresh)), reply: presentFirstMessage(message(fresh)) };
    });
  for (const [label, vars] of [['R2 and the key, Base only', { ...DEPLOYER_ON, ...R2_ON, DEPLOY_CHAINS: 'base' }], ['the key alone, Base only', { ...DEPLOYER_ON, DEPLOY_CHAINS: 'base' }]] as const) {
    const r = await run(vars);
    assert.equal(r.lead, undefined, label);
    assert.equal(r.reply, v210, `${label}: the v2.10 line byte for byte`);
  }
  // Not vacuous: the same env with Arc listed leads with Arc.
  assert.equal((await run({ ...DEPLOYER_ON, ...R2_ON, DEPLOY_CHAINS: 'arc' })).lead?.card.id, 'arc-microgrants');
});

// ---- v2.11 T8 (spec 3, plan S6 and S7): the twist question, the build checks and the build kit ----

type BuildReply = { show_to_builder: string; agent_note?: string; build?: Record<string, unknown>; kit?: ReturnType<typeof buildKit> };
const T8_WALLET = '0x12ab34cd56ef7890a1b2c3d4e5f6a7b8c9d09f3e';
const T8_POD = {
  twist: 'tips for my podcast listeners',
  name: 'PodTips',
  description: 'Podcast listeners tip the show in USDC on Arc.',
  feature: 'Each tip can carry a question for the podcast to answer on air.',
  for_whom: 'for your podcast listeners',
};

/** A pickable program (freshSetup) with deploys and hosting on, plus prepare and the stored build. */
async function buildSetup(tag: string, tc: TestContext) {
  const t = await freshSetup(`b-${tag}`, tc);
  const ctx = { ...t.base, freshDeps: { deployOn: () => true, hostOn: true, starters: t.starters } };
  const prepare = async (input: object, c: object = ctx) => (await tools.prepare(input, c as typeof ctx)) as BuildReply;
  const stored = async () =>
    (await sql()<{ build: Record<string, unknown> | null; payout_wallet: string | null }[]>`SELECT build, payout_wallet FROM installations WHERE id = ${t.inst}`)[0];
  const start = (c?: object) => prepare({ program_id: t.p.id, build: { start: true, program_id: t.p.id } }, c);
  const twist = (b: object = {}, c?: object) => prepare({ program_id: t.p.id, build: { program_id: t.p.id, ...T8_POD, ...b } }, c);
  return { ...t, ctx, prepare, stored, start, twist };
}
const atMostOneQuestion = (r: BuildReply, label = '') => assert.ok(r.show_to_builder.split('?').length - 1 <= 1, `${label}: ${r.show_to_builder}`);
const refusedQuietly = (r: BuildReply, re: RegExp, label = '') => {
  assert.equal(r.show_to_builder, '', `${label}: nothing for the builder`);
  assert.match(r.agent_note ?? '', re, label);
};

test('8.3 / 8.4 refusals are agent notes only, with an empty show_to_builder: an address in the name, 41 characters, "Arc kit", a bad wallet, a public test wallet; every reply has at most one "?"', dbTest, async (tc) => {
  const t = await buildSetup('refuse', tc);
  const q = await t.start();
  atMostOneQuestion(q, 'start');
  const cases: [string, object, RegExp][] = [
    // First: once a valid wallet came with any twist, the build keeps it (review M1).
    ['no wallet given or remembered', {}, /Pass build\.wallet/],
    ['address in the name', { name: `PodTips ${T8_WALLET}`, wallet: T8_WALLET }, /^Fix build\.name/],
    ['41-character name', { name: `Pod${'x'.repeat(38)}`, wallet: T8_WALLET }, /^Fix build\.name: 3 to 40 characters/],
    ['the kit name', { name: 'Arc kit', wallet: T8_WALLET }, /^Fix build\.name/],
    ['a bad wallet', { wallet: '0x12ab' }, /^Fix build\.wallet/],
    ['anvil account 0', { wallet: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }, /^Fix build\.wallet: .*public test/],
    ['the zero address', { wallet: `0x${'0'.repeat(40)}` }, /^Fix build\.wallet/],
  ];
  for (const [label, b, re] of cases) {
    const r = await t.twist(b);
    refusedQuietly(r, re, label);
    atMostOneQuestion(r, label);
  }
  // Nothing past the start (and the kept wallet, review M1) was stored, and no wallet was remembered.
  const s = await t.stored();
  assert.ok(!('name' in (s.build ?? {})));
  assert.equal(s.build?.wallet, T8_WALLET);
  assert.equal(s.payout_wallet, null);
});

test('8.3 a remembered public test wallet is never used: the twist asks for the builder\'s own', dbTest, async (tc) => {
  const t = await buildSetup('testwallet', tc);
  await sql()`UPDATE installations SET payout_wallet = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' WHERE id = ${t.inst}`;
  assert.equal((await t.start()).show_to_builder, twistQuestion(false), 'a test wallet counts as no wallet');
  refusedQuietly(await t.twist(), /Pass build\.wallet/);
});

test('8.5 a shared client asking for the build path gets "I can\'t build from here", and nothing is stored', dbTest, async (tc) => {
  const t = await buildSetup('shared', tc);
  const shared = { ...t.ctx, sharedClient: true };
  for (const r of [await t.start(shared), await t.twist({ wallet: T8_WALLET }, shared)]) {
    assert.equal(r.show_to_builder, BUILD_CHAT_ONLY);
    atMostOneQuestion(r, 'shared');
    assert.ok(!r.kit);
  }
  const s = await t.stored();
  assert.equal(s.build, null);
  assert.equal(s.payout_wallet, null);
});

test('8.6 build.start for a program freshPick would not pick (a long shot), with deploys off, or one never started: an agent note, nothing stored', dbTest, async (tc) => {
  const t = await buildSetup('nopick', tc);
  const stamp = `${process.pid}-${Date.now()}`;
  const monad = {
    ...committedProgram('monad-metropolis'),
    id: `t8-monad-${stamp}`,
    status: 'active',
    ends_at: new Date(Date.now() + 36 * 3_600_000).toISOString(),
    fresh_build: { starter: t.starterId },
  };
  await upsertProgram(ProgramFile.parse(monad));
  tc.after(async () => {
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${monad.id}`;
  });
  refusedQuietly(await t.prepare({ program_id: monad.id, build: { start: true, program_id: monad.id } }), /can't start a build/);
  refusedQuietly(await t.start({ ...t.ctx, freshDeps: { ...t.ctx.freshDeps, deployOn: () => false } }), /can't start a build/);
  refusedQuietly(await t.prepare({ program_id: 'no-such-program', build: { start: true, program_id: 'no-such-program' } }), /can't start a build/);
  // The twist before build.start: never.
  refusedQuietly(await t.twist({ wallet: T8_WALLET }), /build: \{ start: true/);
  assert.equal((await t.stored()).build, null);
  // Started for one program, the twist names another: refused, and the stored build stays.
  await t.start();
  refusedQuietly(await t.prepare({ program_id: monad.id, build: { program_id: monad.id, ...T8_POD, wallet: T8_WALLET } }), /build: \{ start: true/);
  assert.equal((await t.stored()).build?.program_id, t.p.id);
});

test('S7: build is strict: an unknown key, a mixed shape or a program_id that differs from build.program_id is refused with an agent note', dbTest, async (tc) => {
  const t = await buildSetup('strict', tc);
  refusedQuietly(await t.prepare({ program_id: t.p.id, build: { start: true, program_id: t.p.id, color: 'red' } }), /color/);
  refusedQuietly(await t.prepare({ program_id: t.p.id, build: { start: true, program_id: t.p.id, twist: 'x' } }), /build/);
  refusedQuietly(await t.prepare({ program_id: 'other', build: { start: true, program_id: t.p.id } }), /program_id/);
  refusedQuietly(await t.prepare({ program_id: t.p.id, project: { name: 'x' }, build: { start: true, program_id: t.p.id } }), /project/);
  assert.equal((await t.stored()).build, null);
});

test('8.3 (review M1) a valid wallet sent with a twist that fails on another field is kept: the retry without it passes, and it is remembered only then', dbTest, async (tc) => {
  const t = await buildSetup('keepwallet', tc);
  await t.start();
  refusedQuietly(await t.twist({ name: 'Arc kit', wallet: T8_WALLET }), /^Fix build\.name/);
  assert.equal((await t.stored()).payout_wallet, null, 'not remembered on a refusal');
  assert.equal((await t.stored()).build?.wallet, T8_WALLET, 'kept with the build');
  const r = await t.twist();
  assert.match(r.show_to_builder, /^Building PodTips/);
  assert.equal(r.kit?.owner_wallet, T8_WALLET);
  // Final fix M7: the kept wallet is remembered once the twist passes, so a later session never asks again.
  assert.equal((await t.stored()).payout_wallet, T8_WALLET, 'remembered on the pass');
});

test('8.5 (review M3) a shared client with deploys off gets the refusal note, never "add EarnKit to a coding agent"', dbTest, async (tc) => {
  const t = await buildSetup('sharedoff', tc);
  const off = { ...t.ctx, sharedClient: true, freshDeps: { ...t.ctx.freshDeps, deployOn: () => false } };
  for (const r of [await t.start(off), await t.twist({ wallet: T8_WALLET }, off)]) refusedQuietly(r, /can't start a build/);
  assert.equal((await t.stored()).build, null);
});

// ---- v2.11 T9 (spec 4, decision 2, plan S9 to S11): deploy and host in one call, with no click ----

const T9_ADDR = '0x00000000000000000000000000000000000a11ce';
const T9_ABI = [
  {
    type: 'constructor',
    inputs: [{ name: 'owner_', type: 'address' }, { name: 'name_', type: 'string' }, { name: 'minTip_', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  { type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' },
];
const T9_R2 = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'AKID', R2_SECRET_ACCESS_KEY: 's'.repeat(40), R2_BUCKET: 'sites' };
const T9_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

/** Runs `fn` with these variables set (undefined: unset), then restores them. */
async function withVars<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** The deploy env: the deployer key and the proof-line secret; R2 on unless `r2: false`; GitHub sign-in off. */
const shipVars = (o: { r2?: boolean; deployer?: boolean } = {}) => ({
  ...(o.r2 === false ? Object.fromEntries(Object.keys(T9_R2).map((k) => [k, undefined])) : T9_R2),
  DEPLOYER_PRIVATE_KEY: o.deployer === false ? undefined : T9_KEY,
  EARNKIT_AUTH_SECRET: process.env.EARNKIT_AUTH_SECRET || 'tools-t9-secret',
  GITHUB_OAUTH_CLIENT_ID: undefined,
  GITHUB_OAUTH_CLIENT_SECRET: undefined,
});

type ShipReply = BuildReply & { deploy?: Record<string, unknown>; host?: Record<string, unknown> };

/**
 * A started and checked build (the twist with the wallet and the repo) for a fresh login's repo
 * `<login>/podtips`, whose builder said the login is theirs; GitHub's public read of it is cached
 * (`days` old, 5 public repos). A fake Arc chain that counts deploys, the proof line in the repo
 * (`line: false`: none), a passing link probe, and `ship(deploy)` for the build mark.
 */
type PusherFn = (r: { owner: string; repo: string }, hasLine: (text: string) => boolean, issuedAt: Date | null) => Promise<string | null>;
async function shipSetup(
  tag: string,
  tc: TestContext,
  o: { days?: number; line?: boolean; hostOn?: boolean; deployOn?: boolean; pusher?: string | null; ownerRead?: string; github?: (inst: number, login: string) => PusherFn; branch?: boolean } = {},
) {
  const t = await buildSetup(`t9-${tag}`, tc);
  const login = `jt9${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const repo = `https://github.com/${login}/podtips`;
  const repoKey = `${login}/podtips`;
  await sql()`UPDATE installations SET github_user = ${login} WHERE id = ${t.inst}`;
  const note = JSON.stringify({ type: 'User', created_at: new Date(Date.now() - (o.days ?? 730) * 86_400_000).toISOString(), public_repos: 5 });
  await sql()`
    INSERT INTO url_checks (key, ok, checked_at, note) VALUES (${`ghuser:${login}`}, true, now(), ${note})
    ON CONFLICT (key) DO UPDATE SET ok = true, checked_at = now(), note = EXCLUDED.note`;
  const sent: string[] = [];
  const chain = {
    estimate: async () => ({ gas: 100_000n, maxFeePerGas: 100_000_000_000n }),
    balance: async () => 10n ** 18n,
    send: async (a: { data: string }) => ((sent.push(a.data)), `0x${'ab'.repeat(32)}` as const),
    receipt: async () => ({ status: 'success' as const, contractAddress: T9_ADDR as `0x${string}`, gasUsed: 50_000n, effectiveGasPrice: 100_000_000_000n, blockNumber: 4242n }),
    simulate: async () => `0x${'60'.repeat(50)}` as const,
    nonce: async () => 1,
    code: async () => `0x${'60'.repeat(50)}` as const,
    read: async (a: { fn: string }) => (a.fn === 'owner' ? (o.ownerRead ?? T8_WALLET) : null),
    write: async () => `0x${'cd'.repeat(32)}` as const,
  };
  const reads: string[] = [];
  const gate = {
    owner: async (r: { owner: string; repo: string }) => {
      reads.push(`${r.owner}/${r.repo}`);
      return o.line === false ? ({ status: 'missing' as const }) : ({ status: 'ok' as const, text: `${tokenLineFor(t.inst, `https://github.com/${r.owner}/${r.repo}`)}\n` });
    },
    latest: async () => null,
    // T9 security fix I1: who GitHub's push record says added the line (default: the repo owner).
    pusher: o.github ? o.github(t.inst, login) : async () => (o.pusher === undefined ? login : o.pusher),
  };
  const probes: string[] = [];
  const gh = fakeGitHub();
  const ctx = {
    ...t.ctx,
    freshDeps: { ...t.ctx.freshDeps, hostOn: o.hostOn ?? true, deployOn: () => o.deployOn ?? true },
    // A month of its own far ahead, so the shared monthly gas counter never runs out under other runs.
    deployDeps: { chain: () => chain, usdPerNative: async () => 1, now: new Date(Date.UTC(2170 + (Date.now() % 50), Number(process.pid % 12), 3)), gate },
    verifyDeps: { probe: async (u: string) => void probes.push(u) },
    // v2.14 T3 fix round 1 (`branch`): the Bench proves the build's repo by its proof branch on a fake GitHub.
    ...(o.branch && { proofBranchFetch: gh.f }),
  };
  await withVars(shipVars(), async () => {
    await t.start(ctx);
    const twisted = await t.twist({ wallet: T8_WALLET, repo_url: repo }, ctx);
    assert.match(twisted.show_to_builder, /^Building PodTips/);
    // The agent pushes the kit's proof branch from the builder's own account (as v213-journey 16.2 does).
    if (o.branch) {
      const branch = (twisted as { kit?: { proof_branch?: { branch?: string } } }).kit?.proof_branch?.branch;
      assert.match(branch ?? '', /^earnkit-[a-z2-7]{12}$/, JSON.stringify(twisted));
      gh.push(repoKey, branch!, login);
    }
  });
  reads.length = 0;
  // T9 N1: the starter's real forge bytecode (the build path deploys nothing else).
  const deploy = (d: Record<string, unknown> = {}) => ({
    chain: 'arc',
    bytecode: ARC_TIPJAR_BYTECODE,
    abi: T9_ABI,
    constructor_args: [T8_WALLET, 'PodTips', '1000000'],
    owner_wallet: T8_WALLET,
    ...d,
  });
  const ship = (d: Record<string, unknown> | null = {}, c: object = ctx, project: object = {}) =>
    t.prepare(
      {
        program_id: t.p.id,
        project: { name: 'PodTips', description: T8_POD.description, repo_url: repo, ...project },
        ...(d && { deploy: deploy(d), host: true }),
        build: { program_id: t.p.id },
      },
      c,
    ) as Promise<ShipReply>;
  return { ...t, ctx, login, repo, repoKey, sent, reads, probes, ship, deploy, gh };
}

const T8_REPO = 'https://github.com/jenil04/podtips';

// ---- Restored in v2.14 T3 fix round 1: tell submitted and the build path's checks ----------------

test('9.3 R16 tell: submitted marks the newest entry submitted; fix round 1 (I2): on a shared client only the pasted code\'s own entry, by project_id', dbTest, () =>
  withTokenEnv(() =>
    withSignIn(async () => {
      const t = await confirmSetup('t9tell');
      const first = (await tools.confirm({ ...t.input, yes: true, wallet: W8 }, t.ctx)) as Confirmed;
      assert.ok(first.kit, JSON.stringify(first));
      await sql()`UPDATE installations SET shared_client = true WHERE id = ${t.inst}`;
      const unmarked = async () => assert.equal((await t.rows())[0].submission_confirmed_at, null);
      await unmarked();
      const shared = { ...t.ctx, sharedClient: true };
      const isNoted = (r: unknown) => {
        const n = r as { show_to_builder: string; agent_note: string; project_id?: number; token?: unknown };
        assert.equal(n.show_to_builder, NOTED_FOR_NOW);
        assert.match(n.agent_note, /pass signed_in .* and the entry's project_id/);
        // Nothing of the entry is read back either (name, token, bonus line).
        assert.deepEqual(Object.keys(n).sort(), ['agent_note', 'show_to_builder']);
      };
      // Shared: no project_id; a project_id without a code; another builder's code; a typed login. Nothing written or read.
      isNoted(await tools.tell({ submitted: { program_id: t.p.id } }, shared));
      isNoted(await tools.tell({ submitted: { program_id: t.p.id, project_id: first.project_id } }, shared));
      const codeB = await signInAs(t.inst, null, `https://github.com/bob/t9-${Date.now()}`, 'bob');
      for (const signed_in of [codeB!, 'alice'])
        isNoted(await tools.tell({ submitted: { program_id: t.p.id, project_id: first.project_id } as never, signed_in }, shared));
      // An old call's own project (P15c) on a shared client: noted too, never written by repo key.
      isNoted(await tools.tell({ submitted: { program_id: t.p.id, project: t.project, submission_data: t.answers }, signed_in: codeB! }, shared));
      await unmarked();
      // Alice's own code and her entry's project_id: that entry.
      const codeA = await signInAs(t.inst, first.project_id!, t.repo, 'alice');
      const mine = (await tools.tell({ submitted: { program_id: t.p.id, project_id: first.project_id }, signed_in: codeA! }, shared)) as { project_id: number };
      assert.equal(mine.project_id, first.project_id);
      assert.ok((await t.rows())[0].submission_confirmed_at, 'submission_confirmed_at set');
      // Not shared: the newest entry in that program, its saved answers; never a second row.
      const told = (await tools.tell({ submitted: { program_id: t.p.id } }, t.ctx)) as { show_to_builder: string; project_id: number };
      assert.equal(told.project_id, first.project_id);
      assert.equal((await t.rows()).length, 1, 'the same entry, never a second one');
      // Another installation's entry is not found.
      const other = await confirmSetup('t9tell2');
      await assert.rejects(tools.tell({ submitted: { program_id: t.p.id, project_id: first.project_id } }, other.ctx), /No entry/);
      // No entry yet in that program: confirm first.
      await assert.rejects(tools.tell({ submitted: { program_id: other.p.id } }, other.ctx), /call confirm first/);
    }),
  ));

test('9.3 R16 tell: an old "I submitted" (record_submission with builder_submitted) aliased to tell gives record_submission\'s reply', dbTest, () =>
  withTokenEnv(async () => {
    const a = await confirmSetup('t9suba');
    const b = await confirmSetup('t9subb');
    await handlers.confirm_entry({ ...a.input, ...go, wallet: W8 }, a.ctx);
    await tools.confirm({ ...b.input, yes: true, wallet: W8 }, b.ctx);
    const args = (t: typeof a) => ({ program_id: t.p.id, project: t.project, submission_data: t.answers, builder_submitted: true });
    const old = await handlers.record_submission(args(a), a.ctx);
    const next = aliasCall('record_submission', args(b))!;
    assert.equal(next.name, 'tell');
    const fresh = await tools.tell(next.args, b.ctx);
    assert.equal(same(b, fresh), same(a, old));
    assert.ok((await b.rows())[0].submission_confirmed_at);
    assert.equal((await b.rows()).length, 1);
  }));

test('T11 fix (journey 11.0): prepare with deploy checks this draft with the deployed contract: no "No contract found" next to the deployed line', dbTest, async () => {
  const { deployedLine } = await import('./deploy');
  const f = committedProgram('arc-microgrants', { keepContract: true });
  const stamp = `${process.pid}-${Date.now()}`;
  Object.assign(f, { id: `t11-deploy-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(f));
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t11d-${stamp}`}) RETURNING id`;
  const repoKey = `t11x${process.pid}x${Date.now()}/tipjar`;
  await sql()`
    INSERT INTO github_verifications (repo_key, login, installation_id, account_created_at, public_repos, purpose)
    VALUES (${repoKey}, ${`t11${process.pid}x${Date.now()}`}, ${id}, now(), 3, 'entry')`;
  const ADDR = '0x12ab00000000000000000000000000000000' + '9f3e';
  const OWNER = '0x2222222222222222222222222222222222222222';
  const chain = {
    estimate: async () => ({ gas: 100_000n, maxFeePerGas: 1_000_000_000n }),
    balance: async () => 10n ** 18n,
    send: async () => `0x${'ab'.repeat(32)}` as const,
    receipt: async () => ({ status: 'success' as const, contractAddress: ADDR as `0x${string}`, gasUsed: 50_000n, effectiveGasPrice: 1_000_000_000n }),
    simulate: async () => `0x${'60'.repeat(50)}` as const,
    nonce: async () => 1,
    code: async () => `0x${'60'.repeat(50)}` as const,
    read: async (a: { fn: string }) => (a.fn === 'owner' ? OWNER : null),
    write: async () => `0x${'cd'.repeat(32)}` as const,
  };
  const abi = [{ type: 'function', name: 'owner', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' }];
  const project = { name: 'TipJar', repo_url: `https://github.com/${repoKey}`, live_url: 'https://tipjar-t11.xyz' };
  const answers = { description: 'Fans tip creators in USDC on Arc.', builder_profile: 'https://github.com/alice', payout_wallet: OWNER };
  const ctx = {
    installationId: id,
    deployDeps: { chain: () => chain, usdPerNative: async () => 1, now: new Date(Date.UTC(2161, Number(process.pid % 12), 3)), gate: { owner: async () => ({ status: 'missing' as const }), latest: async () => null } },
  };
  const keys = ['DEPLOYER_PRIVATE_KEY', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];
  const old = keys.map((k) => process.env[k]);
  process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
  process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-secret';
  try {
    const r = (await tools.prepare({ program_id: f.id, project, answers, coach_asked: true, deploy: { chain: 'arc', bytecode: `0x${'60'.repeat(40)}`, abi, owner_wallet: OWNER } }, ctx)) as Record<string, unknown> & { show_to_builder: string };
    assert.deepEqual(r.deploy, { address: ADDR, chain: 'arc', owner_ok: true });
    assert.ok(r.show_to_builder.endsWith(`\n\n${deployedLine('TipJar', 'arc', ADDR, true)}`), r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /No contract found/, 'the draft was checked with the deployed contract');
    assert.equal(r.ready, true, r.show_to_builder);
    // Without a deploy (and no contract given) the same draft says so: the check is real.
    const plain = (await tools.prepare({ program_id: f.id, project, answers, coach_asked: true }, { installationId: id })) as { show_to_builder: string };
    assert.match(plain.show_to_builder, /No contract found on Arc mainnet yet\./);
  } finally {
    keys.forEach((k, i) => (old[i] === undefined ? delete process.env[k] : (process.env[k] = old[i])));
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${f.id}`;
  }
});

test('8.1 build.start with no wallet known: exactly the twist question plus "Add the wallet that should own it."; the build is stored (S6)', dbTest, async (tc) => {
  const t = await buildSetup('nowallet', tc);
  const r = await t.start();
  assert.equal(r.show_to_builder, twistQuestion(false));
  assert.equal(
    r.show_to_builder,
    'What should it do for you or your users? One line is enough, like "tips for my podcast listeners". Add the wallet that should own it. If you don\'t have one, I\'ll help you make a free one on your computer.',
  );
  assert.match(r.agent_note ?? '', /wallet \(the one they give; never make one up/);
  atMostOneQuestion(r, '8.1');
  const { build } = await t.stored();
  assert.equal(build?.program_id, t.p.id);
  assert.equal(build?.starter_id, t.starterId);
  assert.ok(typeof build?.started_at === 'string');
  assert.ok(!('wallet' in (build ?? {})));
  // A direct call without the top-level program_id is the same (S7's shape).
  assert.equal((await t.prepare({ build: { start: true, program_id: t.p.id } })).show_to_builder, twistQuestion(false));
});

test('8.1 build.start with a remembered wallet (not shared): the question alone, never asked twice', dbTest, async (tc) => {
  const t = await buildSetup('remembered', tc);
  await rememberWallet(t.inst, T8_WALLET);
  const r = await t.start();
  assert.equal(r.show_to_builder, twistQuestion(true));
  assert.equal(r.show_to_builder, 'What should it do for you or your users? One line is enough, like "tips for my podcast listeners".');
  assert.doesNotMatch(r.agent_note ?? '', /Ask .*wallet/);
  // The twist without a wallet uses the remembered one.
  const b = await t.twist();
  assert.equal(b.show_to_builder, "Building PodTips: a USDC tip page for your podcast listeners. I'll be back with the live link.");
  assert.equal(b.kit?.owner_wallet, T8_WALLET);
  assert.equal((await t.stored()).build?.wallet, T8_WALLET);
});

test('8.2 the twist with a wallet: the building line and the kit (degit path, proof branch for the repo); the wallet is remembered off a shared client', dbTest, async (tc) => {
  const t = await buildSetup('twist', tc);
  const secret = process.env.EARNKIT_AUTH_SECRET;
  process.env.EARNKIT_AUTH_SECRET = 'test-secret-t8';
  tc.after(() => {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
  });
  await t.start();
  const r = await t.twist({ wallet: T8_WALLET, repo_url: T8_REPO });
  assert.equal(r.show_to_builder, "Building PodTips: a USDC tip page for your podcast listeners. I'll be back with the live link.");
  atMostOneQuestion(r, '8.2');
  assert.equal(r.kit?.degit, 'npx degit earnkitai/chain-kits/arc/tipjar <project>');
  assert.deepEqual(r.kit?.twist_slots, { name: 'PodTips', description: T8_POD.description, feature: T8_POD.feature });
  // The Bench: the repo is proven by its proof branch (no earnkit.txt line).
  assert.equal(r.kit?.proof_line, null);
  assert.match((r.kit as { proof_branch?: { branch: string } } | undefined)?.proof_branch?.branch ?? '', /^earnkit-[a-z2-7]{12}$/);
  assert.equal(r.kit?.owner_wallet, T8_WALLET);
  assert.deepEqual(r.build, { program_id: t.p.id, starter_id: t.starterId, step: 'build' });
  const s = await t.stored();
  assert.equal(s.payout_wallet, T8_WALLET, 'remembered');
  assert.equal(s.build?.wallet, T8_WALLET);
  assert.equal(s.build?.twist, T8_POD.twist);
  assert.equal(s.build?.name, 'PodTips');
  assert.equal(s.build?.description, T8_POD.description);
  assert.equal(s.build?.feature, T8_POD.feature);
  assert.equal(s.build?.repo_url, T8_REPO);
  // Sent again unchanged (the agent adding nothing new): the builder already saw the building line.
  const again = await t.twist({ wallet: T8_WALLET, repo_url: T8_REPO });
  assert.equal(again.show_to_builder, '');
  assert.equal((again.kit as { proof_branch?: { branch: string } } | undefined)?.proof_branch?.branch, (r.kit as { proof_branch?: { branch: string } } | undefined)?.proof_branch?.branch, 'the same open code');
  // The next build's twist question needs no wallet: never asked twice.
  assert.equal((await t.start()).show_to_builder, twistQuestion(true));
});

test('8.2 the twist before the repo exists: the kit says to send build.repo_url for the proof branch, and that call shows the builder nothing new', dbTest, async (tc) => {
  const t = await buildSetup('norepo', tc);
  const secret = process.env.EARNKIT_AUTH_SECRET;
  process.env.EARNKIT_AUTH_SECRET = 'test-secret-t8';
  tc.after(() => {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
  });
  await t.start();
  const r = await t.twist({ wallet: T8_WALLET });
  assert.match(r.show_to_builder, /^Building PodTips/);
  // No repo yet: no proof branch; the kit's order says to send build.repo_url for it.
  assert.equal((r.kit as { proof_branch?: unknown } | undefined)?.proof_branch, undefined);
  assert.ok(r.kit?.order.some((o) => /build\.repo_url/.test(o)), JSON.stringify(r.kit?.order));
  const later = await t.twist({ wallet: T8_WALLET, repo_url: T8_REPO });
  assert.equal(later.show_to_builder, '');
  assert.match((later.kit as { proof_branch?: { branch: string } } | undefined)?.proof_branch?.branch ?? '', /^earnkit-[a-z2-7]{12}$/);
  // A repo under EarnKit's own org is the kit, never the builder's.
  refusedQuietly(await t.twist({ wallet: T8_WALLET, repo_url: 'https://github.com/earnkitai/chain-kits' }), /^Fix build\.repo_url/);
});

test('9.3 the build mark with deploy and host: true deploys once (owner and constructor_args[0] the build wallet), holds the deployed line for the joined reply (T10), issues the upload URL with no click, and writes built then deployed', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars(), async () => {
      const { deployedLine } = await import('./deploy');
      const { deploySite, liveLine } = await import('./hosting');
      const t = await shipSetup('ship', tc, { branch: true });
      const r = await t.ship();
      assert.equal(t.sent.length, 1, 'exactly one deploy');
      const { decodeDeployData } = await import('viem');
      const decoded = decodeDeployData({ abi: T9_ABI as never, bytecode: ARC_TIPJAR_BYTECODE, data: t.sent[0] as `0x${string}` });
      assert.equal(String((decoded.args as unknown[])[0]).toLowerCase(), T8_WALLET, 'constructor_args[0] is the build wallet');
      assert.equal(deployedLine('PodTips', 'arc', T9_ADDR, true), "PodTips is deployed on Arc: 0x0000…11ce. You're the owner.");
      // T10 (spec 5): the deployed line waits for the reply after the live link.
      assert.equal(r.show_to_builder, '');
      assert.deepEqual(r.deploy, { address: T9_ADDR, chain: 'arc', owner_ok: true });
      assert.match(String(r.host?.upload_url), /\/api\/host\/upload\?t=[A-Za-z0-9_-]{43}$/);
      assert.ok(!('sign_in_url' in (r.host ?? {})), 'no sign-in click');
      assert.match(r.agent_note ?? '', /POST it to host\.upload_url/);
      assert.deepEqual(r.build, { program_id: t.p.id, starter_id: t.starterId, step: 'host' });
      atMostOneQuestion(r, '9.3');
      assert.ok(!JSON.stringify(r.show_to_builder).includes(String(r.host?.upload_url)), 'the upload URL is never builder text');
      // The Bench: the proof branch proved the build; the deploy's own gate read the repo once, never again for hosting.
      assert.deepEqual(t.reads, [t.repoKey]);
      const [tok] = await sql()<{ basis: string; login: string }[]>`SELECT basis, login FROM host_upload_tokens WHERE installation_id = ${t.inst}`;
      assert.deepEqual({ ...tok }, { basis: 'proof_line', login: t.login });
      const events = await buildEventsOf(t.inst);
      assert.deepEqual(events.map((e) => e.type), ['built', 'deployed']);
      const [built, deployed] = events;
      assert.equal(built.dedupe_key, `built:${t.inst}:${t.repoKey}:${t.p.id}`);
      assert.equal(built.proof_url, t.repo);
      assert.equal(built.program_id, t.p.id);
      assert.equal(built.wallet, T8_WALLET);
      assert.deepEqual([built.github_login, built.login_basis], [t.login, 'proof_line']);
      assert.deepEqual(built.detail, { starter: t.starterId, twist: T8_POD.twist });
      // T9 M3, N1: the starter's exact bytecode, so the deployed event names the starter.
      assert.equal(deployed.wallet, T8_WALLET);
      assert.equal(deployed.chain, 'arc');
      assert.deepEqual([deployed.github_login, deployed.login_basis], [t.login, 'proof_line']);
      assert.equal(deployed.detail.starter, t.starterId);
      assert.equal(deployed.detail.address, T9_ADDR);
      // 9.6: the upload's own reply is v2.9's liveLine, and it writes hosted once.
      const token = new URL(String(r.host?.upload_url)).searchParams.get('t')!;
      const r2 = { put: async () => {}, list: async () => [], del: async () => {}, copy: async () => {} };
      const zip = (await import('fflate')).zipSync({ 'index.html': new TextEncoder().encode('<!doctype html><html><body>PodTips</body></html>') });
      const up = await deploySite(token, zip, { r2 });
      assert.equal(up.body.show_to_builder, liveLine('PodTips', `podtips-${t.login}`));
      assert.equal(up.body.show_to_builder, `PodTips is live: podtips-${t.login}.earnkit.com`);
      const after = await buildEventsOf(t.inst);
      assert.deepEqual(after.map((e) => [e.type, e.login_basis]), [['built', 'proof_line'], ['deployed', 'proof_line'], ['hosted', 'proof_line']]);
      // A rerun of the same call writes no second built (one per repo and program).
      await t.ship();
      assert.equal((await buildEventsOf(t.inst)).filter((e) => e.type === 'built').length, 1);
      await sql()`UPDATE hosted_sites SET status = 'ended' WHERE repo_key = ${t.repoKey}`;
    }),
  ),
);

test('9.4 v2.10.3 DEPLOY_CHAINS=base: the Arc build\'s deploy is refused as deployStep refuses it ("Deploys on Arc are off right now."); nothing deployed, read, hosted or logged; no chain left is the plain off line', dbTest, (tc) =>
  withEventLog(async () => {
    const { DEPLOY_LINES, deployOffLine, deployOffNote } = await import('./deploy');
    const t = await shipSetup('chains', tc, { branch: true });
    const real = { ...t.ctx, freshDeps: { ...t.ctx.freshDeps, deployOn: undefined } };
    for (const [label, c] of [['the real switches', real], ['a deploy switch left on', t.ctx]] as const) {
      const r = await withVars({ ...shipVars(), DEPLOY_CHAINS: 'base' }, () => t.ship({}, c));
      assert.equal(r.show_to_builder, 'Deploys on Arc are off right now.', label);
      assert.equal(r.show_to_builder, deployOffLine('arc'), label);
      assert.deepEqual(r.deploy, { unavailable: deployOffLine('arc') }, label);
      assert.equal(r.agent_note, deployOffNote('arc'), label);
      assert.ok(!('host' in r), `${label}: no host block`);
      atMostOneQuestion(r, label);
    }
    const none = await withVars({ ...shipVars(), DEPLOY_CHAINS: 'nope' }, () => t.ship({}, real));
    assert.equal(none.show_to_builder, DEPLOY_LINES.off, 'no chain left: the plain off line');
    assert.deepEqual(none.deploy, { unavailable: DEPLOY_LINES.off });
    assert.equal(t.sent.length, 0);
    assert.deepEqual(t.reads, [], 'no proof read');
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM host_upload_tokens WHERE installation_id = ${t.inst}`)[0].n, 0);
    assert.deepEqual(await eventsOfInstallation(t.inst), []);
    // Not vacuous: Arc listed, the same build deploys.
    const on = await withVars({ ...shipVars(), DEPLOY_CHAINS: 'arc' }, () => t.ship({}, real));
    assert.equal(t.sent.length, 1, 'DEPLOY_CHAINS=arc deploys');
    assert.deepEqual(on.deploy, { address: T9_ADDR, chain: 'arc', owner_ok: true });
    await sql()`UPDATE hosted_sites SET status = 'ended' WHERE repo_key = ${t.repoKey}`;
  }),
);

test('9.x (review T8 M5) the mark fails closed: an owner or constructor_args[0] that is not the build wallet, the wrong chain, no proof branch, no checked build, or a shared client: an agent note, nothing deployed or logged', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars(), async () => {
      const t = await shipSetup('m5', tc, { branch: true });
      const OTHER = '0x2222222222222222222222222222222222222222';
      const cases: [string, Record<string, unknown>, RegExp][] = [
        ['another owner_wallet', { owner_wallet: OTHER }, /^deploy\.owner_wallet must be the build's wallet/],
        ['another constructor_args[0]', { constructor_args: [OTHER, 'PodTips', '1000000'] }, /^deploy\.constructor_args\[0\] must be the build's wallet/],
        ['no constructor_args', { constructor_args: undefined }, /^deploy\.constructor_args must be exactly 3 values/],
        ['the wrong chain', { chain: 'base' }, /^deploy\.chain must be 'arc'/],
      ];
      for (const [label, d, re] of cases) {
        const r = await t.ship(d);
        refusedQuietly(r, re, label);
        if (label !== 'the wrong chain' && label !== 'no constructor_args') assert.ok((r.agent_note ?? '').includes(T8_WALLET), `${label}: names the build wallet`);
      }
      // An owner_wallet in other case is the same wallet.
      const upper = await t.ship({ owner_wallet: T8_WALLET.toUpperCase().replace('0X', '0x') });
      assert.deepEqual(upper.deploy, { address: T9_ADDR, chain: 'arc', owner_ok: true });
      assert.equal(t.sent.length, 1, 'only the matching call deployed');

      // The Bench: no proof branch pushed yet, so no deploy: the agent is told to push it first.
      const noLine = await shipSetup('m5line', tc);
      const nl = await noLine.ship();
      refusedQuietly(nl, /^Push the proof branch first: git push origin HEAD:refs\/heads\/earnkit-[a-z2-7]{12}/);
      assert.equal(noLine.sent.length, 0);
      assert.deepEqual(await buildEventsOf(noLine.inst), []);

      const fresh = await buildSetup('t9-notready', tc);
      await withVars(shipVars(), () => fresh.start());
      refusedQuietly(
        await fresh.prepare({ program_id: fresh.p.id, project: { name: 'PodTips', repo_url: t.repo }, deploy: t.deploy(), host: true, build: { program_id: fresh.p.id } }),
        /^Call prepare with the build fields/,
        'started but no checked twist',
      );
      const shared = await t.ship({}, { ...t.ctx, sharedClient: true });
      assert.equal(shared.show_to_builder, BUILD_CHAT_ONLY);
      assert.equal(t.sent.length, 1, 'nothing more deployed');
      for (const r of [nl, shared]) atMostOneQuestion(r);
      assert.deepEqual((await buildEventsOf(t.inst)).map((e) => e.type), ['built', 'deployed']);
    }),
  ),
);

test('security re-review 4 F1: a timed-out v2.10 deploy of other bytecode is never settled or labelled as the starter by the build path', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars(), async () => {
      const t = await shipSetup('f1v210', tc, { branch: true });
      const real = t.ctx.deployDeps.chain();
      const slow = { ...t.ctx, deployDeps: { ...t.ctx.deployDeps, chain: () => ({ ...real, receipt: async () => null }) } };
      // v2.10's plain prepare with deploy: any bytecode (here the starter's plus one byte), its receipt never comes.
      await t.prepare({ program_id: t.p.id, project: { name: 'PodTips', repo_url: t.repo }, deploy: t.deploy({ bytecode: `${ARC_TIPJAR_BYTECODE}00` }) }, slow);
      const [v210] = await sql()<{ status: string; starter: string | null }[]>`SELECT status, starter FROM contract_deploys WHERE installation_id = ${t.inst}`;
      assert.deepEqual({ ...v210 }, { status: 'unknown', starter: null });
      // The build path's call: that row is left alone; the normal path's day cap refuses (fail closed).
      const r = await t.ship();
      assert.equal(t.sent.length, 1, 'nothing sent again');
      assert.ok(!('address' in (r.deploy ?? {})), JSON.stringify(r.deploy));
      const rows = await sql()<{ status: string }[]>`SELECT status FROM contract_deploys WHERE installation_id = ${t.inst}`;
      assert.deepEqual(rows.map((x) => x.status), ['unknown'], 'never settled');
      assert.ok(!(await eventsOfInstallation(t.inst)).some((e) => e.type === 'deployed'), 'never labelled or logged as the starter');
    }),
  ),
);

test('final fix I2: the site never goes up: 15 minutes on, prepare with build and no live_url says the deployed line and one question, nothing invented', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars({ r2: false }), async () => {
        const t = await joinSetup('nolive', tc, { hostOn: false });
        const r = await t.ship({}, t.ctx);
        assert.equal(r.show_to_builder, '');
        assert.match(r.agent_note ?? '', /If the site isn't live within 15 minutes, call prepare with program_id, project \{ name, repo_url \} and build: \{ program_id \}, without live_url/);
        assert.match(r.agent_note ?? '', /If it doesn't load within 15 minutes, make that call without live_url/);
        // Exactly the call the notes name.
        const j = (await t.prepare({ program_id: t.p.id, project: { name: 'PodTips', repo_url: t.repo }, build: { program_id: t.p.id } }, t.ctx)) as JoinedReply;
        const lines = j.show_to_builder.split('\n');
        assert.equal(lines[0], "PodTips is deployed on Arc: 0x0000…11ce. You're the owner.");
        assert.doesNotMatch(j.show_to_builder, /is live/);
        // The usual draft reply after the deployed line: "Before you submit: a live link on Arc mainnet." and the
        // entry table. At most one question (in fact none: the missing link is a statement, never invented).
        assert.equal(lines[2], 'Before you submit: a live link on Arc mainnet.');
        atMostOneQuestion(j, 'I2');
        assert.equal(j.ready, false);
        assert.ok(String(j.agent_note).endsWith(BUILD_NO_LIVE_NOTE), 'the agent hears the entry waits for the live link');
        assert.ok(!('live_url' in (j.entry?.project ?? {})), 'no live link invented');
        assert.deepEqual((await buildEventsOf(t.inst)).map((e) => e.type), ['built', 'deployed'], 'no hosted event');
      }),
    ),
  ),
);


// ---- Restored in v2.14 T3 fix round 1: the build path's live safety rules -----------------------

/**
 * The build's own events (eventsOfInstallation), without the proof branch's source_verified (the Bench
 * proves the build's repo first) and the built_live coin line's coin_offered and coin_answered (coin-moments.test.ts).
 */
const buildEventsOf = async (inst: number) =>
  (await eventsOfInstallation(inst)).filter((e) => !['source_verified', 'coin_offered', 'coin_answered'].includes(e.type));

type JoinedReply = ShipReply & {
  ready?: boolean;
  questions?: unknown;
  entry?: { project: Record<string, unknown>; answers: Record<string, string> };
  token?: { proposed: { name: string; symbol: string } };
  shown_wallet?: string;
};

/**
 * A shipped build (shipSetup) whose agent also launches tokens: tokens.fun is a fake that records the
 * creator wallet, the gate reads this agent's line in the repo. `live()` deploys and uploads the site
 * to EarnKit hosting and returns its link; `joined(live_url)` is the call after the live link.
 */
async function joinSetup(tag: string, tc: TestContext, o: Parameters<typeof shipSetup>[2] = {}) {
  const t = await shipSetup(`t10-${tag}`, tc, { branch: true, ...o });
  // The Bench: the builder has a page (find made it), so the build's live reply can pitch its coin.
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${t.inst}, ${`t10j${t.inst}`}, now()) ON CONFLICT DO NOTHING`;
  const launched: string[] = [];
  const tokenDeps = {
    available: () => true,
    limit: async () => {},
    check: async () => true,
    gate: {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
      owner: async () => ({ status: 'ok' as const, text: tokenLineFor(t.inst, t.repo)! }),
      // The Bench proves a coin's repo by its proof branch (v2.13.1 O1), not the earnkit.txt line.
      branchProof: async () => ({ ok: true as const }),
      screen: async () => {},
    },
    deploy: async (d: { projectId: number; name: string; symbol: string; creatorWallet: string }) => {
      launched.push(d.creatorWallet.toLowerCase());
      const url = `https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`;
      await sql()`UPDATE projects SET token_url = ${url}, token_status = 'launched', coin_address = ${'0x' + randomBytes(20).toString('hex')},
        coin_launched_at = now(), token_name = ${d.name}, token_symbol = ${d.symbol} WHERE id = ${d.projectId}`;
      return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: url };
    },
  } as unknown as TokenFlowDeps;
  const ctx = { ...t.ctx, tokenDeps };
  const live = async () => {
    const { deploySite } = await import('./hosting');
    const r = await t.ship({}, ctx);
    const token = new URL(String(r.host?.upload_url)).searchParams.get('t')!;
    const r2 = { put: async () => {}, list: async () => [], del: async () => {}, copy: async () => {} };
    const zip = (await import('fflate')).zipSync({ 'index.html': new TextEncoder().encode('<!doctype html><html><body>PodTips</body></html>') });
    const up = await deploySite(token, zip, { r2 });
    tc.after(() => sql()`UPDATE hosted_sites SET status = 'ended' WHERE repo_key = ${t.repoKey}`.then(() => undefined));
    return { deployReply: r, upload: up.body as { show_to_builder: string; url: string } };
  };
  const joined = (live_url: string, c: object = ctx) => t.ship(null, c, { live_url }) as Promise<JoinedReply>;
  const confirm = (input: object) => tools.confirm({ program_id: t.p.id, ...input }, ctx as never) as Promise<Confirmed>;
  return { ...t, ctx, launched, live, joined, confirm };
}

/** The Bench's built_live coin line (coin-moments.ts coinLine), with the build wallet shown before the yes. */
const T10_CONFIRM = (symbol: string) =>
  `It's live, and your entry is ready either way. A coin pays you 40% of its trading fees, paid to 0x12ab…9f3e. Want to launch a coin, $${symbol} (PodTips), for it?`;

test('9.5 hosting off: the deploy runs and the GitHub Pages note goes to the agent; a github.io link of the repo owner that loads writes hosted (github_pages), anyone else\'s writes none', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars({ r2: false }), async () => {
      const t = await shipSetup('pages', tc, { hostOn: false, branch: true });
      const r = await t.ship();
      assert.equal(t.sent.length, 1);
      assert.equal(r.show_to_builder, '', 'T10: the deployed line waits for the live link');
      assert.deepEqual(r.host, { github_pages: true, site_dir: 'site' });
      assert.match(r.agent_note ?? '', /GitHub Pages/);
      assert.match(r.agent_note ?? '', /Don't show this note or the reason\./);
      assert.doesNotMatch(r.show_to_builder, /Pages|github\.io|Hosting/);
      atMostOneQuestion(r, '9.5');
      // Someone else's github.io link: no hosted event.
      await t.ship(null, t.ctx, { live_url: 'https://someoneelse.github.io/podtips/' });
      assert.deepEqual((await buildEventsOf(t.inst)).map((e) => e.type), ['built', 'deployed']);
      // The builder's own: probed, then hosted once.
      const live = `https://${t.login}.github.io/podtips/`;
      await t.ship(null, t.ctx, { live_url: live });
      await t.ship(null, t.ctx, { live_url: live });
      const events = await buildEventsOf(t.inst);
      assert.deepEqual(events.map((e) => e.type), ['built', 'deployed', 'hosted']);
      const hosted = events[2];
      assert.equal(hosted.dedupe_key, `hosted:gh:${t.inst}:${t.repoKey}:${live}`);
      assert.equal(hosted.proof_url, live);
      assert.deepEqual(hosted.detail, { host: 'github_pages' });
      assert.deepEqual([hosted.github_login, hosted.login_basis], [t.login, 'proof_line']);
      assert.ok(t.probes.includes(live), 'probed');
    }),
  ),
);

test('9.5 a github.io link that does not load writes no hosted event', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars({ r2: false }), async () => {
      const t = await shipSetup('pagesdown', tc, { hostOn: false, branch: true });
      await t.ship();
      const down = { ...t.ctx, verifyDeps: { probe: async () => { throw new Error('404'); } } };
      await t.ship(null, down, { live_url: `https://${t.login}.github.io/podtips-down/` });
      assert.deepEqual((await buildEventsOf(t.inst)).map((e) => e.type), ['built', 'deployed']);
    }),
  ),
);

test('T9 I2 the Pages hosted event: only the build\'s own repo with a contract deployed for this installation, only that repo\'s own link', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars({ r2: false }), async () => {
      const { pagesLinkOf } = await import('./tools');
      assert.equal(pagesLinkOf('alice/site', 'https://alice.github.io/site/'), 'https://alice.github.io/site/');
      // Final fix I3: the gh-pages branch root BUILD_PAGES_NOTE publishes is served here; its site/ subpath never counts.
      assert.equal(pagesLinkOf('alice/podtips', 'https://alice.github.io/podtips/'), 'https://alice.github.io/podtips/');
      assert.equal(pagesLinkOf('alice/podtips', 'https://alice.github.io/podtips/site/'), null);
      assert.equal(pagesLinkOf('alice/site', 'https://ALICE.github.io/site'), 'https://alice.github.io/site');
      assert.equal(pagesLinkOf('alice/site', 'https://alice.github.io/other/'), null, 'another repo of the owner');
      assert.equal(pagesLinkOf('alice/site', 'https://alice.github.io/'), null, 'the user site');
      assert.equal(pagesLinkOf('alice/alice.github.io', 'https://alice.github.io/'), 'https://alice.github.io/');
      assert.equal(pagesLinkOf('alice/site', 'https://bob.github.io/site/'), null);
      assert.equal(pagesLinkOf('alice/site', 'https://alice.github.io/site/?x=1'), null);
      // No contract deployed yet for this installation: nothing, even for the right link.
      const t = await shipSetup('pagesi2', tc, { hostOn: false, branch: true });
      const live = `https://${t.login}.github.io/podtips/`;
      await t.ship(null, t.ctx, { live_url: live });
      assert.deepEqual(await buildEventsOf(t.inst), []);
      // Another repo named in the call (someone else's site): nothing, even after a deploy.
      await t.ship();
      const victim = `jt9victim${Date.now().toString(36)}`;
      await t.ship(null, t.ctx, { repo_url: `https://github.com/${victim}/site`, live_url: `https://${victim}.github.io/site/` });
      await t.ship(null, t.ctx, { live_url: `https://${t.login}.github.io/other/` });
      assert.deepEqual((await buildEventsOf(t.inst)).map((e) => e.type), ['built', 'deployed']);
      // Another installation's record of the same link never blocks this one's (the key is scoped).
      await t.ship(null, t.ctx, { live_url: live });
      const [h] = (await buildEventsOf(t.inst)).filter((e) => e.type === 'hosted');
      assert.equal(h.dedupe_key, `hosted:gh:${t.inst}:${t.repoKey}:${live}`);
      assert.equal(h.repo_key, t.repoKey);
    }),
  ),
);

test('T9 M6 a deployed contract the build wallet does not own gets no site; M4 a deploy refused by a cap writes no built', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars(), async () => {
      const t = await shipSetup('notowned', tc, { ownerRead: '0x3333333333333333333333333333333333333333', branch: true });
      const r = await t.ship();
      assert.equal(r.show_to_builder, 'PodTips is deployed on Arc: 0x0000…11ce.');
      assert.ok(!('host' in r), 'no host block');
      assert.match(r.agent_note ?? '', /won't host its site/);
      assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM host_upload_tokens WHERE installation_id = ${t.inst}`)[0].n, 0);
      // The same repo again the same day: the cap refuses it before anything is sent, and no second built.
      const capped = await t.ship();
      assert.equal(capped.show_to_builder, 'You can deploy once a day per chain, 3 times a month.');
      assert.equal(t.sent.length, 1);
      const capOnly = await shipSetup('caponly', tc, { branch: true });
      // N2: three deploys of this repo today by other installations reach the per-repo day cap.
      await sql()`
        INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd)
        SELECT ${capOnly.inst}, 'installation:x' || n, ${capOnly.repoKey}, 'arc', '0x01', 'deployed', 1 FROM generate_series(1, 3) n`;
      const r2 = await capOnly.ship();
      assert.equal(r2.show_to_builder, 'You can deploy once a day per chain, 3 times a month.');
      assert.deepEqual((await buildEventsOf(capOnly.inst)).map((e) => e.type), [], 'no built when a cap refuses');
    }),
  ),
);

test('final fix M8: a receipt timeout never strands the build: the same deploy-and-host call again settles the sent deploy from its receipt, sends nothing new and goes on to hosting', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars(), async () => {
      const t = await shipSetup('m8pending', tc, { branch: true });
      const real = t.ctx.deployDeps.chain();
      const slow = { ...t.ctx, deployDeps: { ...t.ctx.deployDeps, chain: () => ({ ...real, receipt: async () => null }) } };
      const first = await t.ship({}, slow);
      assert.equal(first.show_to_builder, 'The deploy is still going. It can take a few minutes.');
      assert.equal(first.agent_note, BUILD_PENDING_NOTE);
      assert.equal(t.sent.length, 1);
      const [row] = await sql()<{ status: string }[]>`SELECT status FROM contract_deploys WHERE installation_id = ${t.inst}`;
      assert.equal(row.status, 'unknown');
      // Still no receipt: the same answer, nothing sent again.
      assert.equal((await t.ship({}, slow)).agent_note, BUILD_PENDING_NOTE);
      assert.equal(t.sent.length, 1);
      // The receipt is in: settled, never sent again, and the call goes on to hosting as a fresh deploy would.
      const again = await t.ship();
      assert.equal(t.sent.length, 1, 'never deployed twice');
      assert.deepEqual(again.deploy, { address: T9_ADDR, chain: 'arc', owner_ok: true });
      assert.equal(again.show_to_builder, '', 'the deployed line waits for the joined reply');
      assert.match(String(again.host?.upload_url), /\/api\/host\/upload\?t=/);
      assert.match(again.agent_note ?? '', /Show the builder nothing yet/);
      const rows = await sql()<{ status: string; address: string; block: string }[]>`SELECT status, address, block::text FROM contract_deploys WHERE installation_id = ${t.inst}`;
      assert.deepEqual(rows.map((r) => ({ ...r })), [{ status: 'deployed', address: T9_ADDR, block: '4242' }]);
      const events = await buildEventsOf(t.inst);
      assert.deepEqual(events.map((e) => e.type), ['built', 'deployed']);
      assert.equal(events[1].dedupe_key, `deployed:${(await sql()<{ id: number }[]>`SELECT id FROM contract_deploys WHERE installation_id = ${t.inst}`)[0].id}`);
      assert.equal((events[1].detail as { starter?: string }).starter, (events[0].detail as { starter?: string }).starter, 'the build\'s starter');
    }),
  ),
);

test('10.0 the deploy-and-host call holds the deployed line: the builder sees nothing until the live link, and the upload\'s line waits too', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars(), async () => {
        const t = await joinSetup('hold', tc);
        const { deployReply: r } = await t.live();
        assert.equal(r.show_to_builder, '');
        assert.deepEqual(r.deploy, { address: T9_ADDR, chain: 'arc', owner_ok: true });
        assert.match(r.agent_note ?? '', /Show the builder nothing yet/);
        assert.match(r.agent_note ?? '', /within 15 minutes/, 'final fix I2: the fallback on the upload path too');
        assert.match(r.agent_note ?? '', /Don't show the upload's show_to_builder/);
        assert.doesNotMatch(r.agent_note ?? '', /Show the upload's show_to_builder as written/);
      }),
    ),
  ),
);

test('10.1/10.2 after the live link: the entry is drafted from the build with no coach question, and one reply holds the live line, the deployed line and the confirm line (the build wallet, short)', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars(), async () => {
        const t = await joinSetup('join', tc);
        const { upload } = await t.live();
        const j = await t.joined(upload.url);
        const symbol = j.token?.proposed.symbol ?? '';
        assert.deepEqual(j.show_to_builder.split('\n'), [
          `PodTips is live: podtips-${t.login}.earnkit.com`,
          "PodTips is deployed on Arc: 0x0000…11ce. You're the owner.",
          T10_CONFIRM(symbol),
        ]);
        assert.equal(j.ready, true);
        assert.ok(!('questions' in j), 'no coach question');
        atMostOneQuestion(j, '10.2');
        assert.equal(j.show_to_builder.split('40%').length - 1, 1, '40% once');
        assert.doesNotMatch(j.show_to_builder, /What won before|Ready\.|\|/, 'no guide, no draft table');
        // 10.1: the draft, from the build: the hosted link, the repo, the twist description, the owner's GitHub.
        assert.equal(String(j.entry?.project.live_url).replace(/\/$/, ''), upload.url);
        assert.equal(j.entry?.project.repo_url, t.repo);
        assert.equal(j.entry?.project.description, T8_POD.description);
        assert.deepEqual(j.entry?.project.contracts, [T9_ADDR]);
        assert.equal(j.entry?.answers.builder_profile, `https://github.com/${t.login}`);
        assert.equal(j.shown_wallet, T8_WALLET);
        assert.match(j.agent_note ?? '', /entry\.project/);
        // Called again: the same coin, its moment recorded once.
        const again = await t.joined(upload.url);
        assert.ok(again.show_to_builder.includes(`$${symbol} (PodTips)`), again.show_to_builder);
        assert.equal((await sql()`SELECT 1 FROM coin_moments WHERE builder_id = ${t.inst}`).length, 1);
      }),
    ),
  ),
);

test('10.2 (T9 concern 6) the GitHub Pages fallback: the live line names the github.io link', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars({ r2: false }), async () => {
        const t = await joinSetup('pages', tc, { hostOn: false });
        const r = await t.ship({}, t.ctx);
        assert.equal(r.show_to_builder, '');
        assert.deepEqual(r.host, { github_pages: true, site_dir: 'site' });
        const j = await t.joined(`https://${t.login}.github.io/podtips/`);
        const lines = j.show_to_builder.split('\n');
        assert.deepEqual(lines.slice(0, 2), [`PodTips is live: ${t.login}.github.io/podtips`, "PodTips is deployed on Arc: 0x0000…11ce. You're the owner."]);
        assert.equal(lines[2], T10_CONFIRM(j.token?.proposed.symbol ?? ''));
        assert.equal(lines.length, 3);
        assert.deepEqual((await buildEventsOf(t.inst)).map((e) => e.type), ['built', 'deployed', 'hosted']);
      }),
    ),
  ),
);

test('10.2 a live link that is not the build\'s own (another site, or a Pages link that does not load) gets no live line: the deployed line still shows, never "is live"', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars({ r2: false }), async () => {
        const t = await joinSetup('notown', tc, { hostOn: false });
        await t.ship({}, t.ctx);
        for (const [label, url, c] of [
          ['someone else\'s site', 'https://someoneelse.github.io/podtips/', t.ctx],
          ['a Pages link that does not load', `https://${t.login}.github.io/podtips/`, { ...t.ctx, verifyDeps: { probe: async () => { throw new Error('404'); } } }],
        ] as const) {
          const j = await t.joined(url, c);
          assert.doesNotMatch(j.show_to_builder, /is live/, label);
          assert.match(j.show_to_builder, /^PodTips is deployed on Arc: 0x0000…11ce\. You're the owner\.\n/, label);
          atMostOneQuestion(j, label);
        }
      }),
    ),
  ),
);

test('10.3 (owner ruling on final fix M4) another wallet is allowed but never unseen: the confirm line shows it, and only the next yes launches to the wallet shown', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars(), async () => {
        const t = await joinSetup('wallet', tc);
        const { upload } = await t.live();
        const j = await t.joined(upload.url);
        const input = { project: j.entry!.project, answers: j.entry!.answers, token: { name: j.token!.proposed.name, symbol: j.token!.proposed.symbol } };
        const OTHER = '0x2222222222222222222222222222222222222222';
        const other = await t.confirm({ ...input, yes: true, wallet: OTHER });
        assert.ok(!('kit' in other), 'no kit');
        assert.deepEqual(t.launched, [], 'nothing launched');
        assert.match(other.show_to_builder, /^Yes submits your entry and launches \$\w+ \(PodTips\)\. Wallet: 0x2222…2222\. yes \/ skip the token$/);
        assert.equal(other.shown_wallet, OTHER);
        atMostOneQuestion(other as BuildReply, '10.3');
        assert.equal(other.agent_note, BUILD_WALLET_NOTE);
        // The next yes to the line that showed it launches to it, and only to it.
        const yesOther = await t.confirm({ ...input, yes: true, wallet: OTHER });
        assert.equal(yesOther.token?.status, 'launched');
        assert.deepEqual(t.launched, [OTHER], 'the wallet the builder saw');
        assert.ok(yesOther.kit);
      }),
    ),
  ),
);

test('10.3 back to the build wallet after another was shown: shown again first, then the yes launches to it', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars(), async () => {
        const t = await joinSetup('wallet2', tc);
        const { upload } = await t.live();
        const j = await t.joined(upload.url);
        const input = { project: j.entry!.project, answers: j.entry!.answers, token: { name: j.token!.proposed.name, symbol: j.token!.proposed.symbol } };
        const OTHER = '0x2222222222222222222222222222222222222222';
        await t.confirm({ ...input, yes: true, wallet: OTHER });
        assert.deepEqual(t.launched, []);
        // Back to the build wallet: shown again first, then the yes launches to it.
        const back = await t.confirm({ ...input, yes: true, wallet: T8_WALLET });
        assert.ok(!('kit' in back));
        assert.match(back.show_to_builder, /Wallet: 0x12ab…9f3e\. yes \/ skip the token$/);
        const yes = await t.confirm({ ...input, yes: true, wallet: T8_WALLET });
        assert.equal(yes.token?.status, 'launched');
        assert.deepEqual(t.launched, [T8_WALLET]);
        assert.ok(yes.kit);
      }),
    ),
  ),
);

test('10.4 the yes hands over the DoraHacks kit (copy-paste only); tell submitted marks the entry; the events are built, deployed, hosted, entered, submitted, once each', dbTest, (tc) =>
  withEventLog(() =>
    withTokenEnv(() =>
      withVars(shipVars(), async () => {
        const t = await joinSetup('kit', tc);
        const { upload } = await t.live();
        const j = await t.joined(upload.url);
        const input = { project: j.entry!.project, answers: j.entry!.answers, token: { name: j.token!.proposed.name, symbol: j.token!.proposed.symbol } };
        const yes = await t.confirm({ ...input, yes: true, wallet: T8_WALLET });
        assert.equal(yes.kit?.mode, 'copy_paste');
        assert.match(yes.kit!.show_to_builder, /dorahacks\.io/);
        assert.match(yes.show_to_builder, /^Your token \$\w+ is live: tokens\.fun\/coin\/0x/);
        const sub = (await tools.tell({ submitted: { program_id: t.p.id } }, t.ctx as never)) as { show_to_builder: string };
        assert.match(sub.show_to_builder, /^Entered in T7 Tip Grants\./m);
        const [row] = await sql()<{ submission_confirmed_at: Date | null }[]>`SELECT submission_confirmed_at FROM projects WHERE id = ${yes.project_id!}`;
        assert.ok(row.submission_confirmed_at, 'submitted');
        await tools.tell({ submitted: { program_id: t.p.id } }, t.ctx as never);
        const events = await buildEventsOf(t.inst);
        assert.deepEqual(events.map((e) => e.type), ['built', 'deployed', 'hosted', 'entered', 'submitted']);
      }),
    ),
  ),
);

test('10.13 the build path: the live reply asks "It\'s live. Want to launch a coin for it?" with the wallet; yes launches and is counted; a program entry never', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('t10-built', { remembered: W8, noOffer: true, branch: true });
    await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${t.inst}, ${`t10b${t.inst}`}, now())`;
    await saveBuild(t.inst, { program_id: t.p.id, starter_id: 'arc-tipjar', started_at: new Date().toISOString(), wallet: W8.toLowerCase(), name: 'Tip Jar', repo_url: t.repo });
    const join = { lead: ['Tip Jar is live: tipjar.xyz'], wallet: W8.toLowerCase() };
    const r = (await handlers.prepare_submission(t.input, t.ctx, join)) as { show_to_builder: string; agent_note: string; shown_wallet: string; token: { proposed: { name: string; symbol: string } } };
    // Fix round 1 (rulings 5, 6): the coin that launches is named, and a no still enters.
    const { name, symbol } = r.token.proposed;
    assert.equal(r.show_to_builder, `Tip Jar is live: tipjar.xyz\nIt's live, and your entry is ready either way. A coin pays you 40% of its trading fees, paid to 0x1581…b9a3. Want to launch a coin, $${symbol} (${name}), for it?`);
    const [shown] = await sql()`SELECT moment, wallet FROM coin_moments WHERE builder_id = ${t.inst}`;
    assert.deepEqual({ ...shown }, { moment: 'built_live', wallet: W8.toLowerCase() }, 'recorded with the line, with its wallet');
    assert.equal(r.agent_note.includes(BUILD_COIN_NOTE), true, r.agent_note);
    const yes = (await tools.confirm({ ...t.input, yes: true, wallet: r.shown_wallet, token: { name: r.token.proposed.name, symbol: r.token.proposed.symbol } }, t.ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 1, JSON.stringify(yes));
    const [m] = await sql()`SELECT moment, answer, project_id FROM coin_moments WHERE builder_id = ${t.inst}`;
    assert.deepEqual({ ...m }, { moment: 'built_live', answer: 'yes', project_id: yes.project_id });
    // Another program's entry by the same person: never a token.
    const other = await confirmSetup('t10-other', { remembered: W8 });
    await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${other.inst}, ${`t10o${other.inst}`}, now())`;
    const plain = (await handlers.prepare_submission(other.input, other.ctx)) as { show_to_builder: string };
    assert.doesNotMatch(plain.show_to_builder, /launch a coin|launches \$|40%/);
    assert.ok(plain.show_to_builder.endsWith("Ready to submit?"));
  }),
);



test('9.4 deploys off: "Deploys are off right now.", nothing deployed, no upload URL, no built event; the env without the key says the same', dbTest, (tc) =>
  withEventLog(async () => {
    const { DEPLOY_LINES } = await import('./deploy');
    const t = await shipSetup('off', tc);
    const off = { ...t.ctx, freshDeps: { ...t.ctx.freshDeps, deployOn: () => false } };
    for (const [label, vars, c] of [['switch off', shipVars(), off], ['no deployer key', shipVars({ deployer: false }), { ...t.ctx, freshDeps: { ...t.ctx.freshDeps, deployOn: undefined } }]] as const) {
      const r = await withVars(vars, () => t.ship({}, c));
      assert.equal(r.show_to_builder, DEPLOY_LINES.off, label);
      assert.equal(r.show_to_builder, 'Deploys are off right now.', label);
      assert.deepEqual(r.deploy, { unavailable: DEPLOY_LINES.off }, label);
      assert.ok(!('host' in r), `${label}: no host block`);
      atMostOneQuestion(r, label);
    }
    assert.equal(t.sent.length, 0);
    assert.deepEqual(t.reads, [], 'no proof read');
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM host_upload_tokens WHERE installation_id = ${t.inst}`)[0].n, 0);
    assert.deepEqual(await eventsOfInstallation(t.inst), []);
  }),
);

test('9.1 prepare host: true off a shared client: the proof line and the public account read give host.upload_url with no sign_in_url; 10 days old gives the gate line', dbTest, (tc) =>
  withVars(shipVars(), async () => {
    for (const [days, expect] of [[730, 'upload'], [10, 'gate']] as const) {
      const t = await shipSetup(`host${days}`, tc, { days });
      const r = (await tools.prepare(
        { program_id: t.p.id, project: { name: 'PodTips', repo_url: t.repo }, host: true },
        t.ctx,
      )) as { host: Record<string, string> };
      assert.ok(!('sign_in_url' in r.host), `${days}: no sign-in link`);
      if (expect === 'upload') {
        assert.match(r.host.upload_url, /\/api\/host\/upload\?t=/);
        await sql()`UPDATE host_upload_tokens SET used_at = now() WHERE installation_id = ${t.inst}`;
      } else assert.deepEqual(r.host, { unavailable: 'Hosting needs a GitHub account at least 30 days old with a public repo.' });
    }
  }),
);

test('T9 N1 the build path deploys only the starter\'s exact bytecode with its own constructor encoding: a suffix, other bytecode, a wrong argument count or the agent\'s own constructor types are refused', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars(), async () => {
      const t = await shipSetup('exact', tc);
      const suffix = `${ARC_TIPJAR_BYTECODE}${'00'.repeat(12)}${'33'.repeat(20)}0040`;
      refusedQuietly(await t.ship({ bytecode: suffix }), /^deploy\.bytecode must be the starter's own contract/, 'a suffix');
      refusedQuietly(await t.ship({ bytecode: `0x${'60'.repeat(40)}` }), /^deploy\.bytecode must be/, 'other bytecode');
      refusedQuietly(await t.ship({ constructor_args: [T8_WALLET, 'PodTips'] }), /^deploy\.constructor_args must be exactly 3 values/, 'two args');
      refusedQuietly(await t.ship({ constructor_args: [T8_WALLET, 'PodTips', 'lots'] }), /^deploy\.constructor_args must be exactly 3 values/, 'not a number');
      // The agent's ABI says the owner is the second argument: the starter's own types decide, so arg 0 is still checked.
      const swapped = [{ type: 'constructor', inputs: [{ name: 'n', type: 'string' }, { name: 'o', type: 'address' }, { name: 'm', type: 'uint256' }], stateMutability: 'nonpayable' }];
      refusedQuietly(await t.ship({ abi: swapped, constructor_args: ['PodTips', T8_WALLET, '1'] }), /constructor_args\[0\]|constructor_args must be exactly/, 'swapped types');
      assert.equal(t.sent.length, 0);
      assert.deepEqual(await eventsOfInstallation(t.inst), []);
    }),
  ),
);

// ---- v2.11 T9 security fix R4: the build flow through GitHub's real push record (fetchLinePusher)

test('security re-review 4 F1: a timed-out v2.10 deploy of other bytecode is never settled or labelled as the starter by the build path', dbTest, (tc) =>
  withEventLog(() =>
    withVars(shipVars(), async () => {
      const t = await shipSetup('f1v210', tc);
      const real = t.ctx.deployDeps.chain();
      const slow = { ...t.ctx, deployDeps: { ...t.ctx.deployDeps, chain: () => ({ ...real, receipt: async () => null }) } };
      // v2.10's plain prepare with deploy: any bytecode (here the starter's plus one byte), its receipt never comes.
      await t.prepare({ program_id: t.p.id, project: { name: 'PodTips', repo_url: t.repo }, deploy: t.deploy({ bytecode: `${ARC_TIPJAR_BYTECODE}00` }) }, slow);
      const [v210] = await sql()<{ status: string; starter: string | null }[]>`SELECT status, starter FROM contract_deploys WHERE installation_id = ${t.inst}`;
      assert.deepEqual({ ...v210 }, { status: 'unknown', starter: null });
      // The build path's call: that row is left alone; the normal path's day cap refuses (fail closed).
      const r = await t.ship();
      assert.equal(t.sent.length, 1, 'nothing sent again');
      assert.ok(!('address' in (r.deploy ?? {})), JSON.stringify(r.deploy));
      const rows = await sql()<{ status: string }[]>`SELECT status FROM contract_deploys WHERE installation_id = ${t.inst}`;
      assert.deepEqual(rows.map((x) => x.status), ['unknown'], 'never settled');
      assert.ok(!(await eventsOfInstallation(t.inst)).some((e) => e.type === 'deployed'), 'never labelled or logged as the starter');
    }),
  ),
);

// ---- v2.11 T10 (spec 5): the entry drafted from the build, the live, deployed and confirm lines in one reply, the kit, submitted

test('7.8 (v2.12.1 T12, replaces v2.12 7.8 and 7.8c) flag on: find has no v2.12 consent or score line; tell hide hides the page; x_handle is accepted and ignored; a shared client\'s page asks get an agent note', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`tools-t7-consent-${process.pid}-${Date.now()}`}) RETURNING id`;
  const ctx = { installationId: id };
  for (let i = 0; i < 2; i++) {
    const r = (await tools.find({}, ctx)) as { show_to_builder: string };
    assert.match(r.show_to_builder, /^Where you stand\n/);
    assert.doesNotMatch(r.show_to_builder, /Say hide anytime|earnkit\.com\/b\/|You: score|Score \d+/);
  }
  const hidden = (await tools.tell({ profile: 'hide' }, ctx)) as { show_to_builder: string };
  assert.equal(hidden.show_to_builder, 'Your page is hidden. Say show my page to list it again.');
  const shown = (await tools.tell({ profile: 'show' }, ctx)) as { show_to_builder: string };
  assert.equal(shown.show_to_builder, 'Your page is no longer hidden.', 'unclaimed: no page link');
  // An agent that kept v2.12's tell schema: x_handle parses and does nothing (the page's handle is the X claim's).
  await assert.rejects(tools.tell({ x_handle: 'elonmusk' }, ctx), /Pass at least one/);
  const [p] = await sql()<{ x_handle: string | null }[]>`SELECT x_handle FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(p.x_handle, null);
  const [{ id: shared }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${`tools-t7-shared-${process.pid}-${Date.now()}`}, true) RETURNING id`;
  const r = (await tools.tell({ profile: 'hide' }, { installationId: shared, sharedClient: true })) as { show_to_builder?: string; agent_note?: string };
  assert.equal(r.show_to_builder ?? '', '');
  assert.match(r.agent_note ?? '', /serves many builders/);
});

// ---- v2.12 T9: find's second line, the agent_completable filter, the token pitch gate ----

async function newInstallation() {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t9-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}) RETURNING id`;
  return id;
}

test('v2.12 final review (T9): withoutBonusLine drops only the guide\'s builder bonus section', () => {
  assert.equal(withoutBonusLine('Head\nDifficulty: Easy\n\nYour best bet\n- x\n\nBuilder bonus: no tokens yet, so yours would be first'), 'Head\nDifficulty: Easy\n\nYour best bet\n- x');
  assert.equal(withoutBonusLine('Head\n\nBest'), 'Head\n\nBest');
});

test('v2.12 final review (T9): find for a person under the pitch score never says the builder bonus', dbTest, async () => {
  const ctx = { installationId: await newInstallation() };
  for (let i = 0; i < 2; i++) {
    const r = (await tools.find({ more: true }, ctx)) as { show_to_builder: string };
    assert.doesNotMatch(r.show_to_builder, /Builder bonus:|so yours would be first/);
  }
});

/** The program ids find lists, and whether each title shows in the "show more" reply. */
async function findCards(ids: { id: string; title: string }[]) {
  const ctx = { installationId: await newInstallation() };
  await hideOthers(ctx.installationId, ids.map((p) => p.id));
  const r = (await tools.find({ more: true }, ctx)) as { show_to_builder: string; programs: { id: string }[] };
  const listed = new Set(r.programs.map((p) => p.id));
  return ids.filter((p) => listed.has(p.id) && r.show_to_builder.includes(p.title)).map((p) => p.id);
}

test('9.5 v2.12 find drops programs an agent cannot complete', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const col = { ...committedProgram('colosseum-worlds-fair'), id: `t9-col-${stamp}`, title: `T9 Fair ${stamp}`, status: 'active', starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' };
  const arc = { ...committedProgram('arc-microgrants'), id: `t9-arc-${stamp}`, title: `T9 Grants ${stamp}`, status: 'active', starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(col));
  await upsertProgram(ProgramFile.parse(arc));
  const [row] = await sql()<{ agent_completable: boolean }[]>`SELECT agent_completable FROM programs WHERE id = ${col.id}`;
  assert.equal(row.agent_completable, false, 'programs:sync writes the derivation');
  const both = [{ id: col.id, title: col.title }, { id: arc.id, title: arc.title }];
  assert.deepEqual(await findCards(both), [arc.id]);
});

/** The confirm line a person with this public score (and held flag) sees. */
async function confirmLineFor(o: { score: number; held: boolean }) {
  return withTokenEnv(async () => {
    const t = await confirmSetup(`t9-${o.score}-${o.held}`, { remembered: W8 });
    await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at, held) VALUES (${t.inst}, ${`t9p${t.inst}`}, now(), ${o.held})`;
    // A held person: their newest score is held; the public one is the last unheld (here: none above 0).
    await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
      VALUES (${t.inst}, '2026-10-12', ${o.score}, 50, '{}', '{}', 'v1', 'v1-launch', ${o.held})`;
    const r = (await tools.confirm({ program_id: t.p.id, project: t.project, answers: t.answers }, t.ctx)) as { show_to_builder: string };
    return r.show_to_builder;
  });
}

test('9.6, v2.12.1 T10: a program entry\'s confirm gets "Ready to submit?" at any score (the token waits for its 3b moments)', dbTest, async () => {
  for (const [score, held] of [[19, false], [20, false], [95, false], [80, true]] as const)
    assert.equal(await confirmLineFor({ score, held }), 'Ready to submit?', `${score} ${held}`);
});

test('9.6b v2.12, v2.12.1 T10: a program entry\'s confirm: a yes records the entry with no token launched', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('t9-yes', { remembered: W8 });
    await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${t.inst}, ${`t9y${t.inst}`}, now())`;
    const r = (await tools.confirm({ program_id: t.p.id, project: t.project, answers: t.answers, yes: true, wallet: W8 }, t.ctx)) as Confirmed;
    assert.equal(typeof r.project_id, 'number');
    assert.equal(t.calls.deploy, 0);
    assert.doesNotMatch(r.show_to_builder, /launches \$|40% of its fees/);
    // Final review (T9): no builder bonus line after confirm either (the bonus is funded by a token).
    assert.doesNotMatch(r.show_to_builder, /Builder bonus/);
  }),
);

/** A profile with this one public score (held: the profile and the row are held). */
async function scoreProfile(inst: number, score: number, held = false) {
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at, held) VALUES (${inst}, ${`t9f${inst}`}, now(), ${held})`;
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${inst}, '2026-10-12', ${score}, 50, '{}', '{}', 'v1', 'v1-launch', ${held})`;
}

test('9.11 v2.12 prepare under the pitch score: the question round never asks for the token\'s wallet', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('t9-wask-on');
    await scoreProfile(t.inst, 19);
    const r = (await handlers.prepare_submission({ program_id: t.p.id, project: t.project, answers: {} }, t.ctx)) as { show_to_builder: string; ready: boolean };
    assert.equal(r.ready, false);
    assert.doesNotMatch(r.show_to_builder, /token/i);
  }),
);

test('9.12 v2.12 under the pitch score nothing launches by project_id or the old launch route, and skip says nothing about a token', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('t9-held', { remembered: W8 });
    await scoreProfile(t.inst, 80, true);
    // The entry, recorded without a token (a held person's yes).
    const rec = (await tools.confirm({ program_id: t.p.id, project: t.project, answers: t.answers, yes: true, wallet: W8 }, t.ctx)) as Confirmed;
    assert.equal(typeof rec.project_id, 'number');
    // The stored offer matches: by project_id the yes would launch it.
    const again = (await tools.confirm({ project_id: rec.project_id, yes: true, wallet: W8 }, t.ctx)) as Confirmed;
    assert.doesNotMatch(again.show_to_builder, /launches \$|is live/);
    const old = (await handlers.launch_token({ project_id: rec.project_id, builder_confirmed: true, creator_wallet: W8 }, t.ctx)) as { status: string };
    assert.equal(old.status, 'skipped');
    assert.equal(t.calls.deploy, 0);
    assert.equal(t.calls.gate, 0);
    const s = await confirmSetup('t9-skip', { remembered: W8 });
    await scoreProfile(s.inst, 19);
    const skipped = (await tools.confirm({ program_id: s.p.id, project: s.project, answers: s.answers, skip_token: true }, s.ctx)) as Confirmed;
    assert.doesNotMatch(skipped.show_to_builder, /No token/);
  }),
);

// ---- v2.12.1 T10 (spec 3b): built through EarnKit, the live reply asks the coin ----

test('10.13b the build path: no to the coin enters without one and counts as a decline', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('t10-no', { remembered: W8, noOffer: true });
    await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${t.inst}, ${`t10n${t.inst}`}, now())`;
    await saveBuild(t.inst, { program_id: t.p.id, starter_id: 'arc-tipjar', started_at: new Date().toISOString(), wallet: W8.toLowerCase(), name: 'Tip Jar', repo_url: t.repo });
    await handlers.prepare_submission(t.input, t.ctx, { lead: ['Tip Jar is live: tipjar.xyz'], wallet: W8.toLowerCase() });
    const no = (await tools.confirm({ ...t.input, skip_token: true }, t.ctx)) as Confirmed;
    assert.equal(typeof no.project_id, 'number');
    assert.equal(t.calls.deploy, 0);
    const [m] = await sql()`SELECT answer FROM coin_moments WHERE builder_id = ${t.inst}`;
    assert.equal(m.answer, 'no');
  }),
);
