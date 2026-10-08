import './fixtures/no-network-checks';
import { randomBytes } from 'node:crypto';
import { SafeFetchError } from './safe-fetch';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SponsorCampaignInput, WALLET_IGNORED, canBuild, listProgramsInput, matchRows, tools } from './tools';
import { reportedGithubUser, reportedRepos } from './match-projects';
import { sql } from './db';
import { EntryError } from './campaigns';
import { earnkitTexts } from './campaign-text';
import { ProgramFile, type SubmissionRequirement } from './program-file';
import { coachIntro, draftTable, fixesLine, preSubmitCheck, questionsFor, type Application } from './coach';
import { projectKey, readBank } from './answer-bank';
import { alsoProgramFacts, upsertProgram } from './programs';
import { enteredProgramIds } from './projects';
import { setSanctionsOracle } from './sanctions';
import { tokenLineFor } from './token-gate';
import { REPO_HELD } from './entry-text';
import { TOKEN_LINE, endsOf } from './present';
import { LAUNCHING, LAUNCH_STUCK, SKIPPED_ENTRY, launchLimit, tickerTakenNote, type TokenFlowDeps } from './token-launch';
import { offerKey, readOffer, saveOffer } from './token-offers';
import { proposeToken } from './token-proposal';
import { LaunchError, NOT_LAUNCHED_YET, STUCK_LAUNCH_MS, deployToken, stuckLaunches } from './tokens';
import { runCron } from './cron';
import { CANT_PUSH, NO_WALLET_HINT, confirmOffer, proofLineWaiting } from './confirm';
import { eligibleSql } from './traction';
import { committedProgram } from './fixtures/program-file';
import { alsoQualifies, alsoText, type AlsoRow } from './also-qualifies';
import type { Chain } from './match';

const REF = `0x${'a'.repeat(64)}`;

test('SponsorCampaignInput accepts a valid create input', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'create',
    sponsor_wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    sponsor_name: 'Acme',
    title: 'Build on Acme',
    theme: 'Build something cool with the Acme SDK during the campaign.',
    criteria: 'Judged on creativity and polish.',
    chains: ['base'],
    token: 'USDC',
    amount: '5000',
    winners: 3,
    ends_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput accepts a valid status input', () => {
  const result = SponsorCampaignInput.safeParse({ action: 'status', ref: REF });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput: status takes no tx hash any more', () => {
  assert.equal(
    SponsorCampaignInput.safeParse({
      action: 'status',
      ref: REF,
      tx: `0x${'b'.repeat(64)}`,
    }).success,
    false,
  );
});

test('SponsorCampaignInput: create needs sponsor_wallet', () => {
  const { success } = SponsorCampaignInput.safeParse({
    action: 'create',
    sponsor_name: 'Acme',
    title: 'Build on Acme',
    theme: 'Build something cool with the Acme SDK during the campaign.',
    criteria: 'Judged on creativity and polish.',
    chains: ['base'],
    token: 'USDC',
    amount: '5000',
    winners: 3,
    ends_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(success, false);
});

test('SponsorCampaignInput accepts a valid award input', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'award',
    ref: REF,
    winners: [{ entry_id: 1, amount: '100', reason: 'Best use of the SDK' }],
  });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput rejects an award whose winners is a number', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'award',
    ref: REF,
    winners: 3,
  });
  assert.equal(result.success, false);
});

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

/**
 * v2.8 Task 11: other dbTests leave stray active, curated, non-campaign programs behind (never
 * closed), which record_submission's "Also qualifies" (Ruling 29 (plan)) would now pick up and
 * fold into show_to_builder, breaking an exact-equality assertion written before that existed.
 * Closes every such program except `keep`'s ids for the duration of `fn` (best effort, same
 * pattern as the neighboring "v2.5 §1" and "Ruling 11 (plan) fix round 1" tests), then reopens them.
 */
async function withOnlyPrograms<T>(keep: string[], fn: () => Promise<T>): Promise<T> {
  const stray = await sql()<{ id: string }[]>`
    SELECT id FROM programs WHERE status = 'active' AND source = 'file' AND campaign IS NULL AND id NOT IN ${sql()(keep)}`;
  if (stray.length) await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  try {
    return await fn();
  } finally {
    if (stray.length) await sql()`UPDATE programs SET status = 'active' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  }
}

/**
 * v2.8 Task 11 review fix round 1, item 4: a bare `startsWith(prefix)` also passes a reply that
 * glues more text onto `prefix` with no separator (or the wrong one). Anchors the match: `actual`
 * must be exactly `prefix`, or `prefix` followed by exactly "\n\n" and then anything (the
 * "Also qualifies" block's join). Exported-shaped for the tests below; not a general matcher.
 */
function assertEntered(actual: string, prefix: string, message?: string) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(actual, new RegExp(`^${escaped}(\\n\\n|$)`), message ?? actual);
}

test('v2.4 §2: a failed entry uses none of the daily 20; a recorded one uses one', dbTest, async () => {
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
    await assert.rejects(tools.record_submission(entry, ctx), EntryError);
    assert.equal(await used(), 0);
    deployer = PAY;
    const r = (await tools.record_submission(entry, ctx)) as { recorded: boolean; show_to_builder?: string };
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
  const result = (await tools.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar' } },
    { installationId: id },
  )) as Record<string, unknown>;
  assert.equal(result.warning, 'This program is closed or past its deadline.');
  assert.ok(!('token' in result));
});

test('I8: prepare_submission asks about the remembered payout wallet in full and never prefills it', dbTest, async () => {
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
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`i8-${process.pid}-${Date.now()}`}, ${W}) RETURNING id`;
  const r = (await tools.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar', repo_url: 'https://github.com/alice/tipjar' } },
    { installationId: id },
  )) as { show_to_builder: string; payout_wallet_note?: string; missing: { key: string }[]; ready: boolean; sign_to_enter?: unknown };
  assert.match(r.show_to_builder, new RegExp(`Pay prizes to ${W}\\? It is the wallet from your last entry\\.`));
  assert.match(r.show_to_builder, /paid to your wallet by /);
  assert.match(r.payout_wallet_note ?? '', new RegExp(`^Pay prizes to ${W}\\? Confirm with the builder\\.`));
  assert.ok(r.missing.some((m) => m.key === 'payout_wallet'), 'still missing until the builder confirms');
  assert.equal(r.ready, false);
  // Once the builder confirms, the agent passes it: shown in full in the Prize row, no question.
  const ok = (await tools.prepare_submission(
    { program_id: f.id, project: { name: 'Tip Jar' }, answers: { payout_wallet: W } },
    { installationId: id },
  )) as { show_to_builder: string; payout_wallet_note?: string };
  assert.match(ok.show_to_builder, new RegExp(`paid to ${W} by `));
  assert.doesNotMatch(ok.show_to_builder, /Pay prizes to/);
  assert.equal(ok.payout_wallet_note, undefined);
});

test('campaign fee wallet: only a payout wallet given in this call, never the remembered one; other programs keep it', dbTest, async () => {
  const W = '0x' + 'c'.repeat(39) + '7';
  const GIVEN = '0x' + 'd'.repeat(39) + '1';
  const stamp = `${process.pid}-${Date.now()}`;
  const camp = committedProgram('earnkit-campaign-1-base');
  Object.assign(camp, { id: `fee-camp-${stamp}`, status: 'active', starts_at: '2026-09-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
  Object.assign(camp, earnkitTexts(camp));
  await upsertProgram(ProgramFile.parse(camp));
  const plain = committedProgram('arc-microgrants');
  Object.assign(plain, { id: `fee-plain-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(plain));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`fee-${stamp}`}, ${W}) RETURNING id`;
  // Token launches on, the ticker check unreachable (no network in tests).
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const realFetch = globalThis.fetch;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  type Token = { creator_wallet: string | null; note: string; say_to_builder: string };
  // v2.7 Ruling 15 (plan): the token block appears only once the entry is ready, so every answer is given.
  const project = { name: 'Tip Jar', description: 'Tips', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar.xyz' };
  const full = { contracts: '0x' + '1'.repeat(40), builder_profile: 'https://github.com/alice', description: 'Tips' };
  const call = async (program_id: string, answers?: Record<string, string>) =>
    (await tools.prepare_submission({ program_id, project, answers: { ...full, ...answers } }, { installationId: id })) as {
      token?: Token;
      show_to_builder: string;
      ready: boolean;
    };
  const prep = async (program_id: string, answers?: Record<string, string>) => (await call(program_id, answers)).token!;
  try {
    // A campaign without a payout wallet in this call is not ready: no token block, no fee wallet.
    const none = await call(camp.id);
    assert.equal(none.ready, false);
    assert.equal(none.token, undefined, 'the remembered wallet is never the fee wallet in a campaign');
    assert.ok(none.show_to_builder.startsWith('Before you submit: your payout wallet.'), none.show_to_builder);
    assert.ok(!none.show_to_builder.includes(GIVEN));
    const given = await prep(camp.id, { payout_wallet: GIVEN });
    assert.equal(given.creator_wallet, GIVEN);
    assert.doesNotMatch(given.note, /Ask the builder for the wallet/);
    // Not a campaign: v2.3 unchanged, the remembered wallet is the fee wallet.
    assert.equal((await prep(plain.id)).creator_wallet, W);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});

test('v2.7 §3, Ruling 15 (plan): prepare_submission leads with what is missing; the token step waits until ready', dbTest, async () => {
  const W = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a3';
  const stamp = `${process.pid}-${Date.now()}`;
  const arc = committedProgram('arc-microgrants');
  Object.assign(arc, { id: `t4-ready-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' });
  await upsertProgram(ProgramFile.parse(arc));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, payout_wallet) VALUES (${`t4-ready-${stamp}`}, ${W}) RETURNING id`;
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const realFetch = globalThis.fetch;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  // The ticker check: every ticker free; counted, so a not-ready call is seen to make none.
  let tickerChecks = 0;
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes('/api/check-ticker')) {
      tickerChecks++;
      return Response.json({ available: true });
    }
    return new Response('', { status: 503 });
  }) as typeof fetch;
  type Reply = { ready: boolean; show_to_builder: string; token?: { proposed: { name: string; symbol: string } }; shown_wallet?: string };
  const prep = async (project: Record<string, string>, answers: Record<string, string>) =>
    (await tools.prepare_submission({ program_id: arc.id, project, answers }, { installationId: id })) as Reply;
  const answers = { description: 'Tips on Arc', builder_profile: 'https://github.com/alice' };
  try {
    // Arc without the live mainnet link: not ready, the screen says so first; no token, no wallet.
    const notReady = await prep({ name: 'TipJar', repo_url: `https://github.com/alice/tipjar-${stamp}` }, answers);
    assert.equal(notReady.ready, false);
    assert.ok(notReady.show_to_builder.startsWith('Before you submit: a live link on Arc mainnet.\n\n'), notReady.show_to_builder);
    assert.ok(!('token' in notReady));
    assert.ok(!('shown_wallet' in notReady));
    assert.doesNotMatch(notReady.show_to_builder, /Token|Wallet|Fees in WETH|0x1581/);
    assert.equal(tickerChecks, 0, 'no ticker check while not ready');
    // Every required answer: v2.8 Part C, the confirmation offer (the builder bonus comes with a token).
    const ready = await prep({ name: 'TipJar', repo_url: `https://github.com/alice/tipjar-${stamp}`, live_url: 'https://tipjar.xyz' }, answers);
    assert.equal(ready.ready, true);
    assert.match(ready.show_to_builder, /\n\nReady\. Want the builder bonus\? It comes with a token\.\n/);
    assert.match(ready.show_to_builder, /\nWallet for fees and any bonus: 0x1581…b9a3 \(used last time\), or tell me another\.\n/);
    assert.equal(ready.shown_wallet, W);
    assert.ok(tickerChecks > 0);
    // No project name, but a GitHub repo: the repo name is the name.
    const noName = await prep({ repo_url: 'https://github.com/a/tipjar', live_url: 'https://tipjar.xyz' }, answers);
    assert.equal(noName.token?.proposed.symbol, 'TIPJAR');
    // v2.8 Part D: once ready, the draft table leads (the Entry table stays for what is missing).
    assert.match(noName.show_to_builder, /^\| Field \| Answer \|\n\|---\|---\|\n\| Live deployment on Arc mainnet \| https:\/\/tipjar\.xyz/);
    assert.match(noName.show_to_builder, /Want the builder bonus\? It comes with a token\./);
    // C5: an item given but invalid says "(check it)"; at most 3 items, then "and N more".
    const bad = await prep({ name: 'TipJar' }, { live_deployment_url: 'not a link', builder_profile: 'not a link either' });
    assert.ok(bad.show_to_builder.startsWith('Before you submit: a live link on Arc mainnet (check it); a public repo link; a short description; and 1 more.\n\n'), bad.show_to_builder);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});

test('v2.5 §1: list_programs reads the builder bonus pools once, only where entries are provable; no repo shows ideas', dbTest, async () => {
  const file = (name: string) =>
    committedProgram(name);
  const run = `${process.pid}-${Date.now()}`;
  const proof = Object.assign(file('arc-microgrants'), {
    id: `v25-proof-${run}`, title: `Proof ${run}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', max_award_usd: 9_999_999,
  });
  const noProof = Object.assign(file('base-builder-grants'), {
    // v2.6 Ruling 8: ends_at with no starts_at needs builder_bonus: false (this fixture has
    // neither a submission_proof pattern nor, now, a builder bonus).
    id: `v25-noproof-${run}`, title: `No proof ${run}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', max_award_usd: 9_999_998,
    builder_bonus: false,
    // v2.9 A6: Base is no longer Easy. This fixture keeps an Easy rating (without the live-product
    // tag, which programs:check refuses with Easy), so it stays among the 5 rows when other tests
    // leave Easy programs open in the shared DB.
    tag: undefined,
    difficulty_override: { level: 'Easy', rated_by: 'earnkit', source_url: 'https://docs.base.org/get-started/builders' },
  });
  assert.ok(proof.submission_proof && noProof.submission_proof === null);
  // Other dbTests leave stray active EarnKit campaigns behind (never closed); an open one changes
  // which offer closes the message (Ruling 10 (plan): a campaign offer moves the bonus sentence to
  // its own paragraph above it), which would make the end-anchored assertions below meaningless.
  // Close them for the duration of this test, then reopen (best effort; same pattern as the
  // neighboring "Ruling 11 (plan) fix round 1" test).
  const stray = await sql()<{ id: string }[]>`
    SELECT id FROM programs WHERE status = 'active' AND campaign->>'kind' = 'earnkit'`;
  if (stray.length) await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  try {
    await upsertProgram(ProgramFile.parse(proof));
    await upsertProgram(ProgramFile.parse(noProof));
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash) VALUES (${`v25-pool-${run}`}) RETURNING id`;
    const calls: string[][] = [];
    const r = (await tools.list_programs({}, {
      installationId: id,
      roundPoolsWei: async (ids) => {
        calls.push(ids);
        return new Map([[proof.id, 42n * 10n ** 16n]]);
      },
    })) as { show_to_builder: string };
    const text = r.show_to_builder;
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes(proof.id) && !calls[0].includes(noProof.id), calls[0].join());
    // v2.7 §3: no per-row bonus column or note; the bonus closes the message instead.
    assert.match(text, /\| Program \| (Prize|You could win) \| Difficulty \| Ends \|/);
    // v2.8.1 §B8: no repo, and entering needs one: the row says so.
    assert.match(text, new RegExp(`\\| Proof ${run} \\(needs a repo\\) \\|`));
    assert.match(text, new RegExp(`\\| No proof ${run} \\(needs a repo\\) \\|`));
    assert.match(text, /Every entry gets a token that pays you, and its fees fund the builder bonus\. 0\.42 ETH so far\.$/);
    assert.match(text, /\n\nIdeas I can build:\n- /);
    assert.ok(text.includes(`\n- Proof ${run}: ${proof.ideas[0]}\n- Proof ${run}: ${proof.ideas[1]}\n`), text);
    assert.ok(text.includes(`\n- No proof ${run}: ${noProof.ideas[0]}\n- No proof ${run}: ${noProof.ideas[1]}\n`), text);
    // Without injection: no pools yet, so the provable program's bonus sentence is the empty-pool one.
    const plain = (await tools.list_programs({}, { installationId: id })) as { show_to_builder: string };
    assert.match(plain.show_to_builder, /Every entry gets a token that pays you, and its fees fund the builder bonus\.$/);
    // I2: a program whose round froze (the pool read maps it to null) shows no bonus to win: the
    // 0.42 ETH this test injected for proof.id never surfaces once its round is frozen. (Other test
    // files share this DB and may run concurrently, so a blanket "no bonus sentence at all" isn't
    // reliable here; present.test.ts's bonusCell/bonusClose unit tests cover the frozen rule
    // directly. Fix round 1, Minor 2.)
    const frozen = (await tools.list_programs({}, { installationId: id, roundPoolsWei: async () => new Map([[proof.id, null]]) })) as { show_to_builder: string };
    assert.doesNotMatch(frozen.show_to_builder, /0\.42 ETH/);
  } finally {
    await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()([proof.id, noProof.id])}`;
    if (stray.length) await sql()`UPDATE programs SET status = 'active' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  }
});

test('Ruling 11 (plan) fix round 1: a remembered GitHub user whose matching fails gets no "You could"; a control without one gets "You could win"', dbTest, async () => {
  const run = `${process.pid}-${Date.now()}`;
  const file = (name: string) =>
    committedProgram(name);
  const prog = Object.assign(file('arc-microgrants'), {
    id: `v26-ghost-${run}`, title: `Ghost ${run}`, status: 'active', ends_at: '2099-01-01T00:00:00Z', max_award_usd: 1000,
  });
  await upsertProgram(ProgramFile.parse(prog));
  const [{ id: withUser }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, github_user) VALUES (${`v26-ghost-${run}`}, 'ghost') RETURNING id`;
  const [{ id: control }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`v26-noghost-${run}`}) RETURNING id`;
  // Other dbTests in this file leave stray active EarnKit campaigns behind (never closed); any
  // open campaign makes zeroState false regardless of repos, which would make both assertions below
  // meaningless. Close them for the duration of this test, then reopen (best effort).
  const stray = await sql()<{ id: string }[]>`
    SELECT id FROM programs WHERE status = 'active' AND campaign->>'kind' = 'earnkit'`;
  if (stray.length) await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  const errLog = console.error;
  console.error = () => {};
  try {
    // A stub that throws a plain Error (not GitHubError/RateLimitError) makes tools.ts leave
    // yourRepos = null (matching "failed silently", logged, never surfaced as { error }), so
    // githubGiven alone decides "You could" — unlike the old GitHubError stub, where
    // youCould({ error }, anything) was already false and zeroState was already false (finding 2),
    // so the test could never have failed no matter how githubGiven was wired.
    const r = (await tools.list_programs({}, {
      installationId: withUser,
      matchProjects: async () => {
        throw new Error('boom');
      },
    })) as { show_to_builder: string };
    assert.match(r.show_to_builder, /\| Program \| Prize \| Difficulty \| Ends \|/);
    assert.doesNotMatch(r.show_to_builder, /You could/);
    // Control: no remembered github_user or repos, so matching is never attempted (yourRepos stays
    // null the ordinary way) and githubGiven is false: the same program gets "You could win".
    const c = (await tools.list_programs({}, { installationId: control })) as { show_to_builder: string };
    assert.match(c.show_to_builder, /\| Program \| You could win \| Difficulty \| Ends \|/);
  } finally {
    console.error = errLog;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${prog.id}`;
    if (stray.length) await sql()`UPDATE programs SET status = 'active' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  }
});

after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('v2.6 §3: the wallet is remembered on any entry and prefilled; no wallet records the entry with no coin yet', dbTest, async () => {
  const W = '0x' + 'e'.repeat(39) + '3';
  const stamp = `${process.pid}-${Date.now()}`;
  const arc = committedProgram('arc-microgrants');
  const a = { ...arc, id: `t4-a-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  const b = { ...arc, id: `t4-b-${stamp}`, title: 'Other Grants', status: 'active', ends_at: '2099-01-01T00:00:00Z', submission_proof: null };
  await upsertProgram(ProgramFile.parse(a));
  await upsertProgram(ProgramFile.parse(b));
  const inst = async (tag: string) =>
    (await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t4-${tag}-${stamp}`}) RETURNING id`)[0].id;
  const entry = (program_id: string, n: number, extra: Record<string, unknown>) => ({
    program_id,
    project: { name: `Tip Jar ${n}`, description: 'Tips', repo_url: `https://github.com/alice/t4-${stamp}-${n}`, live_url: `https://t4-${n}.xyz` },
    // C7: a complete entry (every required item), so the token step runs.
    submission_data: { description: 'Tips', builder_profile: 'https://github.com/alice' },
    ...extra,
  });
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const secret = process.env.EARNKIT_AUTH_SECRET;
  const realFetch = globalThis.fetch;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  process.env.EARNKIT_AUTH_SECRET ||= 'tools-test-secret'; // token lines are HMACs under it
  // The ticker check and any other read are unreachable: nothing reaches the network or tokens.fun.
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
  const pools = async (ids: string[]) => new Map(ids.map((id) => [id, 180000000000000000n] as [string, bigint]));
  // v2.7 Ruling 15 (plan): every required answer, so the token step shows.
  const ready = (name = 'Tip Jar', repo_url = `https://github.com/alice/t4-${stamp}-ready`) => ({
    project: { name, repo_url, live_url: 'https://tipjar.xyz' },
    answers: { description: 'Tips', builder_profile: 'https://github.com/alice' },
  });
  try {
    await withOnlyPrograms([a.id, b.id], () => run());
  } finally {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
  async function run() {
    // 1. An entry naming a wallet (the builder skipped the coin): remembered for the installation.
    const id = await inst('one');
    const skipped = (await tools.record_submission(entry(a.id, 1, { payout_wallet: W, token: 'skip' }), { installationId: id, roundPoolsWei: pools })) as {
      recorded: boolean;
      show_to_builder: string;
    };
    assert.equal(skipped.recorded, true);
    // v2.8 Task 11: "Also qualifies" (Other Grants, a genuinely open chain-fit sibling) may follow,
    // anchored on the "\n\n" join (review fix round 1, item 4) so a glued-together reply would fail.
    assertEntered(skipped.show_to_builder, `Entered in ${a.title}.`, 'skipped: no coin, no bonus line');
    assert.doesNotMatch(skipped.show_to_builder.split('\n\n')[0], /ETH|builder bonus/);
    // 2. The next prepare_submission, on another non-campaign program, prefills it.
    const prep = (await tools.prepare_submission({ program_id: b.id, ...ready() }, { installationId: id })) as {
      show_to_builder: string;
      token: { creator_wallet: string | null };
    };
    assert.equal(prep.token.creator_wallet, W);
    // v2.8 Part C: the offer's wallet line shows it short (Ruling 17's form); shown_wallet carries it in full.
    assert.match(prep.show_to_builder, /Want the builder bonus\? It comes with a token\./);
    assert.ok(prep.show_to_builder.includes('Wallet for fees and any bonus: 0xeeee…eee3 (used last time), or tell me another.'), prep.show_to_builder);
    assert.equal((prep as { shown_wallet?: string }).shown_wallet, W);
    // A wallet given in this call is not "from last time".
    const OTHER = '0x' + 'f'.repeat(39) + '4';
    const given = (await tools.prepare_submission({ program_id: b.id, ...ready(), answers: { ...ready().answers, payout_wallet: OTHER } }, { installationId: id })) as {
      show_to_builder: string;
    };
    assert.ok(given.show_to_builder.includes('Wallet for fees and any bonus: 0xffff…fff4, or tell me another.'), given.show_to_builder);
    // Ruling 22: a typo'd wallet (bad EIP-55 checksum) is refused with a clear error, never shown or dropped.
    const TYPO = '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a4';
    await assert.rejects(
      tools.prepare_submission({ program_id: b.id, project: { name: 'Tip Jar' }, answers: { payout_wallet: TYPO } }, { installationId: id }),
      (err: unknown) => err instanceof EntryError && err.message.includes("That wallet address isn't valid. Check it and send it again."),
    );
    // M5 / I8: a campaign prepare_submission after this non-campaign entry asks about the wallet in
    // full and never prefills it as the fee wallet.
    const camp = committedProgram('earnkit-campaign-1-base');
    Object.assign(camp, { id: `t4-camp-${stamp}`, status: 'active', starts_at: '2026-09-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
    Object.assign(camp, earnkitTexts(camp));
    await upsertProgram(ProgramFile.parse(camp));
    const cp = (await tools.prepare_submission({ program_id: camp.id, project: { name: 'Tip Jar' } }, { installationId: id })) as {
      show_to_builder: string;
      token?: { creator_wallet: string | null };
    };
    assert.match(cp.show_to_builder, new RegExp(`Pay prizes to ${W}\\? It is the wallet from your last entry\\.`));
    assert.doesNotMatch(cp.show_to_builder, /used last time|yours from last time|Wallet for fees/);
    assert.equal(cp.token?.creator_wallet ?? null, null);

    // 3. No wallet ever given: the entry is recorded, the coin is not, and the reply says how to add it.
    const none = await inst('none');
    const r = (await tools.record_submission(entry(a.id, 2, { token: { name: 'TipJar', symbol: 'TIPJAR' }, builder_confirmed: true }), {
      installationId: none,
      roundPoolsWei: pools,
    })) as {
      recorded: boolean;
      bonus_round: { key: string; ends_at: string; ends_label: string } | null;
      token: { status: string; note: string; no_wallet?: boolean };
      show_to_builder: string;
    };
    assert.equal(r.recorded, true);
    assert.equal(r.token.status, 'skipped');
    assert.equal(r.token.no_wallet, true);
    // Ruling 29: the round's end is the first message's label for this program (its summary's
    // "closes Oct 14"), never a UTC day computed separately.
    assert.deepEqual(r.bonus_round, { key: `${a.id}:2026-09-16`, ends_at: '2099-01-01T00:00:00.000Z', ends_label: 'Oct 14, 11:59 PM ET' });
    assert.equal(r.bonus_round!.ends_label, endsOf({ summary: a.summary, ends_at: new Date(a.ends_at) }));
    // The agent's note names the tool; the builder's text never does.
    assert.equal(r.token.note, 'No token yet: no wallet was given.');
    assert.equal((r.token as { agent_note?: string }).agent_note, 'No token yet: no wallet was given. When the builder replies with a wallet, call launch_token with the wallet as creator_wallet by Oct 14, 11:59 PM ET.');
    // v2.8 Task 11: "Also qualifies" (Other Grants, a genuinely open chain-fit sibling) may follow,
    // anchored on the "\n\n" join (review fix round 1, item 4).
    assertEntered(
      r.show_to_builder,
      `Entered in ${a.title}. Reply with a wallet to get your token and join the builder bonus (0.18 ETH so far · ends Oct 14, 11:59 PM ET · earnkit.com/bonus/${a.id}-2026-09-16).`,
    );
    assert.doesNotMatch(r.show_to_builder, /launch_token|vault|\p{Extended_Pictographic}/u);

    // 4. C1: remembered wallet A, the builder gives B. A typo'd B fails the entry (nothing recorded,
    // nothing launched to A); a valid B is the coin's creator wallet.
    const two = await inst('two');
    const A = '0x' + 'a'.repeat(39) + '9';
    const B = '0x' + 'b'.repeat(39) + '8';
    await sql()`UPDATE installations SET payout_wallet = ${A} WHERE id = ${two}`;
    const deploys: { creatorWallet: string }[] = [];
    const repoUrl = (n: number) => `https://github.com/alice/t4-${stamp}-${n}`;
    const tokenDeps = {
      available: () => true,
      limit: async () => {},
      check: async () => true,
      gate: {
        repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
        owner: async () => ({ status: 'ok' as const, text: tokenLineFor(two, repoUrl(4))! }),
        screen: async () => {},
      },
      deploy: async (d: { creatorWallet: string; name: string; symbol: string }) => {
        deploys.push(d);
        return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: 'https://tokens.fun/coin/0xT' };
      },
    } as unknown as TokenFlowDeps;
    const ctxTwo = { installationId: two, roundPoolsWei: pools, tokenDeps };
    const coinEntry = (n: number, wallet: string) =>
      entry(a.id, n, { payout_wallet: wallet, token: { name: 'TipJar', symbol: 'TIPJAR' }, builder_confirmed: true });
    const count = async () => (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM projects WHERE installation_id = ${two}`)[0].n;
    await assert.rejects(
      tools.record_submission(coinEntry(3, '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a4'), ctxTwo),
      (err: unknown) => err instanceof EntryError && err.message.includes("That wallet address isn't valid."),
    );
    assert.equal(await count(), 0);
    assert.equal(deploys.length, 0, 'never launched to the remembered wallet');
    const ok = (await tools.record_submission(coinEntry(4, B), ctxTwo)) as { project_id: number; token: { status: string }; show_to_builder: string };
    assert.equal(ok.token.status, 'launched');
    assert.deepEqual(deploys.map((d) => d.creatorWallet), [B]);
    // Ruling 24: a public entry page and no entry link yet: the builder is asked for the link.
    assert.match(
      ok.show_to_builder,
      /^Entered in .*\. Your token: tokens\.fun\/coin\/0xT\.\nSend me your dorahacks\.io entry link to join the builder bonus \(0\.18 ETH so far · ends Oct 14, 11:59 PM ET · earnkit\.com\/bonus\/.+\)\.(\n\n|$)/,
    );
    assert.doesNotMatch(ok.show_to_builder, /builder_submitted|record_submission|launch_token/);
    // I1: the builder says yes (the site blocks EarnKit): the same entry is updated, its coin kept,
    // nothing launched again, and the reply is the counting line.
    await sql()`UPDATE projects SET token_url = 'https://tokens.fun/coin/0xT', coin_address = ${'0x' + [...crypto.getRandomValues(new Uint8Array(20))].map((x) => x.toString(16).padStart(2, '0')).join('')}, coin_launched_at = now() WHERE id = ${ok.project_id}`;
    const late = (await tools.record_submission(
      { ...coinEntry(4, B), external_submission_url: 'https://dorahacks.io/buidl/4040', builder_submitted: true },
      { ...ctxTwo, entryDeps: { fetchProof: async () => { throw new SafeFetchError('it answered 405'); } } },
    )) as { project_id: number; updated?: boolean; token: { status: string }; show_to_builder: string };
    assert.equal(late.project_id, ok.project_id);
    assert.equal(late.updated, true);
    assert.equal(late.token.status, 'launched');
    assert.equal(deploys.length, 1, 'no second launch');
    assert.match(late.show_to_builder, /^Entered in .*\. Your token: tokens\.fun\/coin\/0xT\.\nBuilder bonus: 0\.18 ETH so far · ends Oct 14, 11:59 PM ET · /);
    assert.equal(await count(), 1, 'one entry, not two');
    const [basis] = await sql()<{ submission_basis: string | null }[]>`SELECT submission_basis FROM projects WHERE id = ${ok.project_id}`;
    assert.equal(basis.submission_basis, 'unverified_page');
    assert.equal((await sql()<{ payout_wallet: string }[]>`SELECT payout_wallet FROM installations WHERE id = ${two}`)[0].payout_wallet, B);

    // 5. Final review M1: another installation enters the same repo here while that eligible entry
    // holds it: one plain line, no bonus line, no wallet ask, and the agent is never told to launch.
    type Held = { repo_held?: boolean; bonus_round: unknown; show_to_builder: string; token: { note?: string } };
    const sameRepo = (n: number) =>
      entry(a.id, 4, { project: { name: `Tip Jar ${n}`, description: 'Tips', repo_url: repoUrl(4), live_url: 'https://t4-4.xyz' }, token: { name: 'TipJar', symbol: 'TIPJAR' }, builder_confirmed: true });
    const held = (await tools.record_submission(sameRepo(5), { installationId: await inst('three'), roundPoolsWei: pools })) as Held;
    assert.equal(held.repo_held, true);
    assert.equal(held.bonus_round, null);
    assertEntered(held.show_to_builder, `Entered in ${a.title}. ${REPO_HELD}`);
    assert.doesNotMatch(held.token.note ?? '', /launch_token|creator_wallet/);
    assert.match((held as { bonus_note?: string }).bonus_note ?? '', new RegExp(`entry #${ok.project_id} already holds this repo`));
    // The repo's coin is on an entry here that isn't eligible yet (no counting submission): still held.
    await sql()`UPDATE projects SET submission_proof_ok_at = NULL, token_repo_key = ${`github.com/alice/t4-${stamp}-4`} WHERE id = ${ok.project_id}`;
    const coinHeld = (await tools.record_submission(sameRepo(6), { installationId: await inst('four'), roundPoolsWei: pools })) as Held;
    assert.equal(coinHeld.repo_held, true);
    assert.equal(coinHeld.bonus_round, null);
    assertEntered(coinHeld.show_to_builder, `Entered in ${a.title}. ${REPO_HELD}`);
    assert.match((coinHeld as { bonus_note?: string }).bonus_note ?? '', /another entry of this repo in this program has its token/);
    // The holder's own re-record is not "held" by its own coin.
    const own = (await tools.record_submission({ ...coinEntry(4, B), builder_submitted: true }, ctxTwo)) as Held & { project_id: number };
    assert.equal(own.project_id, ok.project_id);
    assert.equal(own.repo_held, undefined);
    assert.notEqual(own.bonus_round, null);

    // 6. Ruling 30: no unseen wallet at submission. prepare_submission shows a remembered wallet
    // and returns it as shown_wallet; the remembered wallet then changes (a shared registration).
    const five = await inst('five');
    const SHOWN = '0x' + 'c'.repeat(39) + '1';
    const LATER = '0x' + 'd'.repeat(39) + '2';
    await sql()`UPDATE installations SET payout_wallet = ${SHOWN} WHERE id = ${five}`;
    const shownPrep = (await tools.prepare_submission({ program_id: b.id, ...ready('Tip Jar 7', repoUrl(7)) }, { installationId: five })) as {
      show_to_builder: string;
      shown_wallet?: string;
    };
    assert.equal(shownPrep.shown_wallet, SHOWN);
    assert.ok(shownPrep.show_to_builder.includes('0xcccc…ccc1 (used last time)'));
    await sql()`UPDATE installations SET payout_wallet = ${LATER} WHERE id = ${five}`;
    const fiveDeploys: { creatorWallet: string }[] = [];
    const fiveDeps = {
      ...tokenDeps,
      gate: { ...tokenDeps.gate, owner: async (r: { owner: string; repo: string }) => ({ status: 'ok' as const, text: tokenLineFor(five, `https://github.com/${r.owner}/${r.repo}`)! }) },
      deploy: async (d: { creatorWallet: string; name: string; symbol: string }) => {
        fiveDeploys.push(d);
        return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: 'https://tokens.fun/coin/0xF' };
      },
    } as unknown as TokenFlowDeps;
    const fiveEntry = (n: number, extra: Record<string, unknown> = {}) =>
      entry(b.id, n, { token: { name: 'TipJar', symbol: 'TIPJAR' }, builder_confirmed: true, builder_submitted: true, ...extra });
    // The agent omits the wallet: recorded with no coin, the plain no-wallet line, never the remembered wallet.
    const omitted = (await tools.record_submission(fiveEntry(7), { installationId: five, roundPoolsWei: pools, tokenDeps: fiveDeps })) as {
      recorded: boolean;
      token: { status: string; no_wallet?: boolean };
      show_to_builder: string;
    };
    assert.equal(omitted.recorded, true);
    assert.equal(omitted.token.no_wallet, true);
    assert.equal(fiveDeploys.length, 0, 'neither the shown nor the changed remembered wallet is used');
    assert.match(omitted.show_to_builder, /^Entered in Other Grants\. Reply with a wallet to get your token and join the builder bonus \(/);
    // The agent echoes shown_wallet: the coin pays the wallet the builder saw, not the changed one.
    const echoed = (await tools.record_submission(fiveEntry(8, { payout_wallet: shownPrep.shown_wallet }), { installationId: five, roundPoolsWei: pools, tokenDeps: fiveDeps })) as {
      token: { status: string };
    };
    assert.equal(echoed.token.status, 'launched');
    assert.deepEqual(fiveDeploys.map((d) => d.creatorWallet), [SHOWN]);
  }
});

test('v2.8 Ruling 2 (plan): record_submission launches the token on an incomplete entry; complete_at waits for every required item', dbTest, async () => {
  const W = '0x' + 'c'.repeat(39) + '7';
  const stamp = `${process.pid}-${Date.now()}`;
  const arc = committedProgram('arc-microgrants');
  const p = { ...arc, id: `c7-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(p));
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`c7-${stamp}`}) RETURNING id`;
  const repo = `https://github.com/alice/c7-${stamp}`;
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const secret = process.env.EARNKIT_AUTH_SECRET;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  process.env.EARNKIT_AUTH_SECRET ||= 'tools-test-secret';
  const deploys: { symbol: string }[] = [];
  const checks: string[] = [];
  const tokenDeps = {
    available: () => true,
    limit: async () => {},
    check: async (s: string) => { checks.push(s); return true; },
    gate: {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
      owner: async () => ({ status: 'ok' as const, text: tokenLineFor(inst, repo)! }),
      screen: async () => {},
    },
    deploy: async (d: { name: string; symbol: string }) => {
      deploys.push(d);
      return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: 'https://tokens.fun/coin/0xC7' };
    },
  } as unknown as TokenFlowDeps;
  const ctx = { installationId: inst, roundPoolsWei: async () => new Map(), tokenDeps };
  try {
    // v2.8 Ruling 2 (plan): no live link and no builder profile: entered, and the token launches
    // (no C7 gate on the launch), but the entry is not complete, so not bonus-eligible yet.
    const r = (await tools.record_submission(
      {
        program_id: p.id,
        project: { name: 'Tip Jar', repo_url: repo },
        submission_data: { description: 'Tips' },
        payout_wallet: W,
        token: { name: 'Tip Jar', symbol: 'TIPJAR' },
        builder_confirmed: true,
      },
      ctx,
    )) as { recorded: boolean; project_id: number; token: { status: string; needs?: string } };
    assert.equal(r.recorded, true);
    assert.equal(r.token.status, 'launched');
    assert.equal(r.token.needs, undefined);
    assert.deepEqual(deploys.map((d) => d.symbol), ['TIPJAR']);
    const completeAt = async () =>
      (await sql()<{ complete_at: Date | null }[]>`SELECT complete_at FROM projects WHERE id = ${r.project_id}`)[0].complete_at;
    assert.equal(await completeAt(), null);
    // What the real deploy records (tokens.ts deployToken; the fake above records nothing).
    await sql()`UPDATE projects SET coin_address = ${'0x' + randomBytes(20).toString('hex')}, coin_launched_at = now(),
      token_url = 'https://tokens.fun/coin/0xC7', token_status = 'launched' WHERE id = ${r.project_id}`;

    // Recorded again with every answer: the same entry, now complete; its token is kept (no second launch).
    const again = (await tools.record_submission(
      {
        program_id: p.id,
        project: { name: 'Tip Jar', repo_url: repo, live_url: 'https://tipjar.xyz' },
        submission_data: { description: 'Tips', builder_profile: 'https://github.com/alice' },
        payout_wallet: W,
        token: { name: 'Tip Jar', symbol: 'TIPJAR' },
        builder_confirmed: true,
      },
      ctx,
    )) as { project_id: number; token: { status: string } };
    assert.equal(again.project_id, r.project_id, 'the same entry, updated');
    assert.equal(again.token.status, 'launched');
    assert.deepEqual(deploys.map((d) => d.symbol), ['TIPJAR'], 'one launch only');
    assert.ok((await completeAt()) instanceof Date);
  } finally {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});

test('v2.8 Rulings 2-3 (plan), C8: launch_token on real rows: a skipped entry is refused (nothing deploys); a set complete_at never moves', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const arc = committedProgram('arc-microgrants');
  const p = { ...arc, id: `t7lt-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(p));
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t7lt-${stamp}`}) RETURNING id`;
  const key = process.env.TOKENSFUN_DEPLOY_API_KEY;
  const secret = process.env.EARNKIT_AUTH_SECRET;
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  process.env.EARNKIT_AUTH_SECRET ||= 'tools-test-secret';
  const deploys: string[] = [];
  const tokenDeps = {
    available: () => true,
    limit: async () => {},
    check: async () => true,
    gate: {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }),
      owner: async (r: { owner: string; repo: string }) => ({ status: 'ok' as const, text: tokenLineFor(inst, `https://github.com/${r.owner}/${r.repo}`)! }),
      screen: async () => {},
    },
    deploy: async (d: { name: string; symbol: string }) => {
      deploys.push(d.symbol);
      return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: 'https://tokens.fun/coin/0xT7' };
    },
  } as unknown as TokenFlowDeps;
  const ctx = { installationId: inst, roundPoolsWei: async () => new Map(), tokenDeps };
  const W = '0x' + 'd'.repeat(39) + '7';
  const entry = async (n: number, o: { choice?: 'go' | 'skip'; complete_at?: Date }) => {
    const repo = `https://github.com/alice/t7lt-${stamp}-${n}`;
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, bonus_repo_key, confirm_choice, complete_at, live_verified_at)
      VALUES (${p.id}, ${`Kit ${n}`}, ${repo}, ${`https://kit${n}.xyz`}, ${inst}, ${repo.replace('https://', '')},
        ${o.choice ?? null}, ${o.complete_at ?? null}, now())
      RETURNING id`;
    await sql()`INSERT INTO submissions (project_id, submission_data)
      VALUES (${id}, ${sql().json({ description: 'A kit.', builder_profile: 'https://github.com/alice' })})`;
    return id;
  };
  try {
    // dbStore.load reads confirm_choice from the row: the refusal fires, nothing deploys or changes.
    const skipped = await entry(1, { choice: 'skip' });
    const out = (await tools.launch_token(
      { project_id: skipped, builder_confirmed: true, creator_wallet: W, live_url: 'https://other.xyz' },
      ctx,
    )) as { status: string; note: string };
    assert.deepEqual([out.status, out.note], ['failed', SKIPPED_ENTRY]);
    assert.deepEqual(deploys, []);
    const [row] = await sql()<{ live_url: string; token_url: string | null; complete_at: Date | null }[]>`
      SELECT live_url, token_url, complete_at FROM projects WHERE id = ${skipped}`;
    assert.deepEqual([row.live_url, row.token_url, row.complete_at], ['https://kit1.xyz', null, null]);
    // A complete entry with complete_at already set: launch_token's COALESCE keeps the earlier value.
    const earlier = new Date('2026-10-01T00:00:00Z');
    const set = await entry(2, { complete_at: earlier });
    await tools.launch_token({ project_id: set, builder_confirmed: true, creator_wallet: W }, ctx);
    const [kept] = await sql()<{ complete_at: Date }[]>`SELECT complete_at FROM projects WHERE id = ${set}`;
    assert.equal(kept.complete_at.getTime(), earlier.getTime());
    // A complete entry without one: launch_token sets it (Ruling C8).
    const unset = await entry(3, {});
    await tools.launch_token({ project_id: unset, builder_confirmed: true, creator_wallet: W }, ctx);
    const [now] = await sql()<{ complete_at: Date | null }[]>`SELECT complete_at FROM projects WHERE id = ${unset}`;
    assert.ok(now.complete_at instanceof Date);
  } finally {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});

test('v2.8 Ruling 23 (plan): how_to_submit and sign_to_enter only for an open campaign; v2.8 Ruling 4: no submission link before the confirmation', dbTest, async () => {
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
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`r23-${stamp}`}) RETURNING id`;
  const prep = async (program_id: string) =>
    (await tools.prepare_submission({ program_id, project: { name: 'Tip Jar' } }, { installationId: id })) as Record<string, unknown>;
  const p = await prep(plain.id);
  assert.ok(!('how_to_submit' in p) && !('sign_to_enter' in p));
  assert.ok(!('submission_url' in p));
  const c = await prep(closed.id);
  assert.ok(!('how_to_submit' in c) && !('sign_to_enter' in c));
  assert.match(String((await prep(open.id)).how_to_submit), /This is an EarnKit campaign/);
});

// ---- v2.8 Task 8: the confirmation step (Part C, Rulings 1, 3, 4, 5, 7 (plan)). The kit comes only
// from confirm_entry, after the builder's yes or skip; the token launches on yes.
async function confirmSetup(tag: string, o: { remembered?: string; check?: (s: string) => boolean; extra?: SubmissionRequirement[]; noOffer?: boolean; keepContract?: boolean } = {}) {
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
  const ctx = { installationId: inst, roundPoolsWei: async () => new Map(), repoCoins: async () => new Map(), tokenDeps };
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

test('8.1 Ruling 4 (plan): prepare_submission ready ends with the offer; no kit, submission link, prefilled link or paste list at any depth', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('prep', { remembered: W8 });
    const r = (await tools.prepare_submission(t.input, t.ctx)) as Record<string, unknown>;
    assert.equal(r.ready, true);
    assert.match(String(r.show_to_builder), /\n\nReady\. Want the builder bonus\? It comes with a token\.\n/);
    for (const k of ['kit', 'submission_url', 'prefilled_url', 'paste', 'agent_steps', 'api'])
      assert.ok(!keysOf(r).includes(k), k);
    assert.doesNotMatch(JSON.stringify(r), /"(kit|submission_url|prefilled_url|paste)":/);
    // The token line for the agent to push with its work, before the builder confirms.
    assert.equal(r.token_line, tokenLineFor(t.inst, t.repo));
    assert.match(String(r.agent_note), /^Commit this line to earnkit\.txt at the repo root with your next push, before the builder confirms\. /);
    assert.equal(r.shown_wallet, W8);
    // An agent that can't push: no token line, and the one-line offer.
    const noPush = (await tools.prepare_submission({ ...t.input, agent: { can_push: false } }, t.ctx)) as Record<string, unknown>;
    assert.ok(!('token_line' in noPush) && !('shown_wallet' in noPush));
    assert.ok(String(noPush.show_to_builder).endsWith('\n\nTo launch your token, open this in Claude Code or Cursor.\nReady to submit?'), String(noPush.show_to_builder));
  }));

test('8.2/8.3: confirm_entry without the yes (or without a decision) is the offer only, nothing recorded; record_submission never returns a kit', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('offer', { remembered: W8 });
    // v2.8.1 §A2: the Yes line names the token that launches.
    const proposal = { name: 'Tip Jar', symbol: 'TIP' };
    const expected = confirmOffer({ hasBonus: true, coinIn: null, canPush: true, wallet: W8, remembered: true, proposal });
    assert.match(expected, /\nYes: launches \$TIP \(Tip Jar\) on Base\. You earn 40% of its trading fees, plus a shot at the builder bonus\.\n/);
    for (const extra of [{}, { builder_confirmed: true }, { decision: 'go' }]) {
      const r = (await tools.confirm_entry({ ...t.input, ...extra }, t.ctx)) as Confirmed & { token?: { proposed?: unknown } };
      assert.equal(r.show_to_builder, expected, JSON.stringify(extra));
      assert.ok(!('kit' in r) && !('project_id' in r));
      assert.deepEqual(r.token, { proposed: proposal });
      assert.match(r.agent_note ?? '', /token: token\.proposed/);
      assert.equal(r.shown_wallet, W8);
    }
    assert.equal((await t.rows()).length, 0, 'no entry before the yes');
    assert.equal(t.calls.gate + t.calls.deploy, 0);
    // 8.3: an entry never confirmed (an older agent): recorded, no kit anywhere.
    const rec = (await tools.record_submission(
      { program_id: t.p.id, project: t.project, submission_data: t.answers, token: 'skip' },
      t.ctx,
    )) as Record<string, unknown>;
    assert.equal(rec.recorded, true);
    assert.ok(!keysOf(rec).includes('kit'));
    // A campaign is entered in one step.
    const camp = committedProgram('earnkit-campaign-1-base');
    Object.assign(camp, { id: `t8-camp-${process.pid}-${Date.now()}`, status: 'active', starts_at: '2026-09-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' });
    Object.assign(camp, earnkitTexts(camp));
    await upsertProgram(ProgramFile.parse(camp));
    await assert.rejects(tools.confirm_entry({ ...t.input, program_id: camp.id, ...go }, t.ctx), /EarnKit campaigns are entered in one step\./);
  }));

test('8.4/8.7/8.11: "go" launches the token and returns the kit; a second "go" launches nothing; record_submission updates the same entry', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('go');
    const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.equal(r.token?.status, 'launched');
    assert.ok(r.kit, 'the kit');
    assert.equal(r.kit!.mode, 'copy_paste');
    const link = r.token!.tokens_fun!.replace('https://', '');
    // Final review M8: the post-launch line names the ticker.
    assert.match(r.token?.symbol ?? '', /^[A-Z0-9]+$/);
    assert.equal(r.show_to_builder, `Your token $${r.token!.symbol} is live: ${link}.\n\n${r.kit!.show_to_builder}`);
    assert.ok(r.kit!.show_to_builder.endsWith('After you submit, paste your entry link here.'));
    assert.deepEqual(t.calls.wallets, [W8], 'only the wallet given in this exchange');
    const [row] = await t.rows();
    assert.equal(row.id, r.project_id);
    assert.equal(row.confirm_choice, 'go');
    assert.ok(row.confirmed_at instanceof Date);
    assert.ok(row.complete_at instanceof Date, 'complete: every required item was given');
    // 8.7: a second "go": the same entry, nothing deployed again, the kit again.
    const again = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.equal(again.project_id, r.project_id);
    assert.equal(t.calls.deploy, 1);
    assert.ok(again.kit);
    assert.equal(again.token?.status, 'launched');
    // A later "skip" never takes the token's entry out of the bonus (Ruling 3, Task 7's carry).
    const skipLater = (await tools.confirm_entry({ ...t.input, builder_confirmed: true, decision: 'skip' }, t.ctx)) as Confirmed;
    assert.ok(skipLater.show_to_builder.startsWith('Your token is live: '), skipLater.show_to_builder);
    assert.equal((await t.rows())[0].confirm_choice, 'go');
    // 8.11: the builder submitted: record_submission updates the same row, no token flow.
    const rec = (await tools.record_submission(
      { program_id: t.p.id, project: t.project, submission_data: t.answers, payout_wallet: W8, builder_submitted: true },
      t.ctx,
    )) as { project_id: number; token: { status: string; tokens_fun?: string } };
    assert.equal(rec.project_id, r.project_id);
    assert.equal(rec.token.status, 'launched');
    assert.equal(rec.token.tokens_fun, (await t.rows())[0].token_url);
    assert.equal(t.calls.deploy, 1);
    const rows = await t.rows();
    assert.equal(rows.length, 1, 'one entry');
    assert.ok(rows[0].submission_confirmed_at instanceof Date);
  }));

test('8.5: "go" with no wallet: no launch and no kit, the no-wallet hint; again with a wallet launches and returns the kit; a typo errors', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('nowallet');
    const r = (await tools.confirm_entry({ ...t.input, ...go }, t.ctx)) as Confirmed;
    assert.equal(r.show_to_builder, NO_WALLET_HINT);
    assert.equal(r.token?.fixable, true);
    assert.ok(!('kit' in r));
    assert.match(r.agent_note ?? '', /confirm_entry/);
    assert.equal(t.calls.deploy, 0);
    await assert.rejects(
      tools.confirm_entry({ ...t.input, ...go, wallet: '0x1581AC8d887518Dbcb4a4A15231b96f03706B9a4' }, t.ctx),
      (err: unknown) => err instanceof EntryError && err.message.includes("That wallet address isn't valid."),
    );
    assert.equal(t.calls.deploy, 0);
    const ok = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.equal(ok.token?.status, 'launched');
    assert.ok(ok.kit);
    assert.equal(ok.project_id, r.project_id);
    assert.deepEqual(t.calls.wallets, [W8]);
  }));

test('8.5b Ruling 30: a remembered wallet is never used unless the agent passes it back', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('remembered', { remembered: W8 });
    const r = (await tools.confirm_entry({ ...t.input, ...go }, t.ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 0);
    assert.ok(!('kit' in r));
    assert.equal(r.show_to_builder, 'Use 0x1581…b9a3 for fees and any bonus, or tell me another?');
    assert.match(r.agent_note ?? '', /^Pass shown_wallet as wallet once the builder confirms it\./);
    assert.equal(r.shown_wallet, W8);
    const ok = (await tools.confirm_entry({ ...t.input, ...go, wallet: r.shown_wallet }, t.ctx)) as Confirmed;
    assert.equal(ok.token?.status, 'launched');
    assert.deepEqual(t.calls.wallets, [W8]);
  }));

test('8.6: "skip": the kit, no token, never bonus-eligible even with a token, proof and a complete entry', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('skip');
    const r = (await tools.confirm_entry({ ...t.input, builder_confirmed: true, decision: 'skip' }, t.ctx)) as Confirmed;
    assert.ok(r.kit);
    assert.ok(!('token' in r));
    assert.ok(r.show_to_builder.startsWith('No token, no builder bonus.\n\nReady for '), r.show_to_builder);
    assert.equal(t.calls.gate + t.calls.deploy, 0);
    const [row] = await t.rows();
    assert.equal(row.confirm_choice, 'skip');
    // The same row with a token, a counting proof and complete_at: still never eligible. A "go"
    // control row with the same facts is (so the check is not vacuous).
    const control = (await confirmSetup('skipctl'));
    const c = (await tools.confirm_entry({ ...control.input, ...go, wallet: W8 }, control.ctx)) as Confirmed;
    for (const id of [row.id, c.project_id!])
      await sql()`UPDATE projects SET coin_address = COALESCE(coin_address, ${'0x' + randomBytes(20).toString('hex')}), coin_launched_at = now() - interval '1 hour',
        submission_proof_ok_at = now() - interval '1 hour', complete_at = now() - interval '1 hour', submitted_at = now() - interval '1 hour' WHERE id = ${id}`;
    const ends = new Date('2099-01-01T00:00:00Z');
    const eligible = new Set((await sql()<{ id: number }[]>`SELECT p.id FROM projects p WHERE p.id IN ${sql()([row.id, c.project_id!])} AND ${eligibleSql(ends, null)}`).map((x) => x.id));
    assert.ok(!eligible.has(row.id), 'skip is final for the bonus');
    assert.ok(eligible.has(c.project_id!), 'the go control is eligible');
    // launch_token on the skipped entry is refused (Ruling 3).
    const lt = (await tools.launch_token({ project_id: row.id, builder_confirmed: true, creator_wallet: W8 }, t.ctx)) as { note: string };
    assert.equal(lt.note, SKIPPED_ENTRY);
  }));

test("8.8 Ruling 7: an agent that can't push: no gate read or deploy, the entry records, the kit with the one line", dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('nopush');
    const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8, agent: { can_push: false } }, t.ctx)) as Confirmed;
    assert.equal(t.calls.gate + t.calls.deploy, 0);
    assert.ok(r.kit);
    assert.ok(r.show_to_builder.startsWith(`${CANT_PUSH}\n\nReady for `), r.show_to_builder);
    assert.equal((await t.rows())[0].confirm_choice, 'go');
  }));

test('8.9 Ruling 5: a repo whose token is entered in Arc: no offer, "go" records with no launch and returns the kit', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('elsewhere');
    const ctx = { ...t.ctx, repoCoins: async (keys: string[]) => new Map(keys.map((k) => [k, { program_id: 'arc-microgrants', title: 'Arc Microgrants' }] as const)) };
    const offer = (await tools.confirm_entry(t.input, ctx)) as Confirmed;
    // v2.8.1 §C13: no bonus note in the offer or the confirmation; Also qualifies says it once.
    assert.equal(offer.show_to_builder, 'Ready to submit?');
    assert.ok(!('shown_wallet' in offer));
    const prep = (await tools.prepare_submission(t.input, ctx)) as { show_to_builder: string };
    assert.ok(prep.show_to_builder.endsWith('\n\nReady to submit?'), prep.show_to_builder);
    assert.doesNotMatch(prep.show_to_builder, /builder bonus/i);
    const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, ctx)) as Confirmed;
    assert.equal(t.calls.gate + t.calls.deploy, 0);
    assert.ok(r.kit);
    assert.ok(r.show_to_builder.startsWith('Ready for '), r.show_to_builder);
  }));

test('v2.8.1 §D (T4 carry): Also qualifies names the round the token fees book to after rollover, with the rollover line once', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('rollnote');
    const asked: string[] = [];
    const ctx = {
      ...t.ctx,
      repoCoins: async (keys: string[]) => new Map(keys.map((k) => [k, { program_id: 'arc-microgrants', title: 'Arc Microgrants' }] as const)),
      bonusEntry: async (key: string) => {
        asked.push(key);
        return { program_id: 'base-builder-grants', title: 'Base Builder Grant Program' };
      },
    };
    await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, ctx);
    const rec = (await tools.record_submission(
      { program_id: t.p.id, project: t.project, submission_data: t.answers, builder_submitted: true },
      ctx,
    )) as { show_to_builder: string };
    const also = rec.show_to_builder.split('\n\nYou also qualify for:')[1];
    if (also) {
      assert.match(also, /Your builder bonus rides on your Base Builder Grant Program entry\. Your builder bonus moves to your next entry when a program ends\.$/);
      assert.equal(rec.show_to_builder.split('moves to your next entry').length, 2, rec.show_to_builder);
      assert.doesNotMatch(rec.show_to_builder, /Arc Microgrants entry/);
      assert.ok(asked.length >= 1 && asked.every((k) => k === t.repo.replace('https://', '')), JSON.stringify(asked));
      // The token note names the same round (Also qualifies carries the "rides on" line here).
      assert.equal((rec as { token?: { note?: string } }).token?.note, 'Your builder bonus rides on your Base Builder Grant Program entry.');
      // Fees bound for the Safe (no open entry): no bonus note at all.
      const none = (await tools.record_submission(
        { program_id: t.p.id, project: t.project, submission_data: t.answers, builder_submitted: true },
        { ...ctx, bonusEntry: async () => null },
      )) as { show_to_builder: string };
      assert.doesNotMatch(none.show_to_builder, /rides on|moves to your next entry/);
      assert.equal((none as { token?: { note?: string } }).token?.note, 'This repo already has a token.');
    } else assert.doesNotMatch(rec.show_to_builder, /moves to your next entry/);
  }));

test('v2.8.1 §D, T5 fix round 1: no mocks: home ended, first entry elsewhere: bonus_note, builder text and token note all name the new entry', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('rollreal');
    // The entry's submission is proven at record time (its DoraHacks page links the repo).
    const ctx = { ...t.ctx, repoCoins: undefined, entryDeps: { fetchProof: async () => `See the repo: ${t.repo}` } };
    const key = t.repo.replace('https://', '');
    const home = `${t.p.id}-home`;
    // The repo's token is in a program whose window has ended (its fees roll over).
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
        status, existing_work, starts_at, ends_at)
      VALUES (${home}, 'X', 'Ended Grants', 'd', 'https://x.xyz', 'https://x.xyz', 'r', 's', 'active', 'allowed',
        '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')`;
    await sql()`
      INSERT INTO projects (program_id, name, repo_url, bonus_repo_key, token_repo_key, token_url, token_status, coin_address, coin_launched_at)
      VALUES (${home}, 'Home', ${t.repo}, ${key}, ${key}, ${`https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`}, 'launched',
        ${'0x' + randomBytes(20).toString('hex')}, '2026-01-05T00:00:00Z')`;
    try {
      const confirm = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, ctx)) as Confirmed;
      assert.equal(t.calls.deploy, 0, 'one token per repo');
      assert.ok(confirm.kit);
      const rec = (await tools.record_submission(
        { program_id: t.p.id, project: t.project, submission_data: t.answers, builder_submitted: true, external_submission_url: 'https://dorahacks.io/buidl/582' },
        ctx,
      )) as { show_to_builder: string; bonus_note?: string; token: { note?: string } };
      const rides = `Your builder bonus rides on your ${t.p.title} entry.`;
      assert.ok(rec.bonus_note?.includes(rides), rec.bonus_note);
      assert.doesNotMatch(rec.bonus_note ?? '', /Ended Grants/);
      assert.equal(rec.token.note, rides);
      assert.equal(rec.show_to_builder.split(rides).length, 2, rec.show_to_builder);
      assert.doesNotMatch(rec.show_to_builder, /Ended Grants/);
    } finally {
      await sql()`DELETE FROM projects WHERE program_id = ${home}`;
      await sql()`DELETE FROM programs WHERE id = ${home}`;
    }
  }));

test('8.10 C6, v2.8.1 fix round 1: "go" launches exactly the pair shown; another ticker is shown first; a shown ticker taken since gets a new Yes line; nothing deploys unseen', dbTest, () =>
  withTokenEnv(async () => {
    let taken = new Set<string>();
    const t = await confirmSetup('taken', { check: (s) => !taken.has(s) });
    // The agent asks for a ticker the builder never saw: the Yes line with it, nothing launched.
    const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8, token: { symbol: 'OWN' } }, t.ctx)) as Confirmed & { token?: { proposed?: { name: string; symbol: string } } };
    assert.ok(!('kit' in r));
    assert.equal(t.calls.deploy, 0);
    assert.deepEqual(r.token?.proposed, { name: t.offered.name, symbol: 'OWN' });
    assert.match(r.show_to_builder, new RegExp(`\\nYes: launches \\$OWN \\(${t.offered.name}\\) on Base\\.`));
    assert.deepEqual(await readOffer(t.inst, t.p.id, offerKey(t.repo, 'Tip Jar')), { name: t.offered.name, symbol: 'OWN' });
    // OWN is taken before the builder's "go" (no echo): never another ticker silently; a new Yes line.
    taken = new Set(['OWN']);
    const again = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as Confirmed & { token?: { proposed?: { name: string; symbol: string } } };
    assert.equal(t.calls.deploy, 0);
    assert.ok(!('kit' in again));
    const next = again.token!.proposed!.symbol;
    assert.notEqual(next, 'OWN');
    assert.ok(again.show_to_builder.startsWith(`$OWN is taken.\nWant the builder bonus?`), again.show_to_builder);
    assert.match(again.show_to_builder, new RegExp(`\\nYes: launches \\$${next} \\(`));
    // The builder says yes to the new line: exactly that launches.
    const ok = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8, token: again.token!.proposed }, t.ctx)) as Confirmed;
    assert.equal(ok.token?.status, 'launched');
    assert.equal(ok.token?.symbol, next);
    assert.equal(t.calls.deploy, 1);
    assert.ok(ok.kit);
    // No pair stored at all (an agent that skipped the offer): the Yes line first, nothing launched.
    const u = await confirmSetup('nooffer', { noOffer: true });
    const first = (await tools.confirm_entry({ ...u.input, ...go, wallet: W8 }, u.ctx)) as Confirmed;
    assert.equal(u.calls.deploy, 0);
    assert.ok(!('kit' in first));
    assert.match(first.show_to_builder, /\nYes: launches \$[A-Z0-9]+ \(Tip Jar\) on Base\./);
    assert.equal(((await tools.confirm_entry({ ...u.input, ...go, wallet: W8 }, u.ctx)) as Confirmed).token?.status, 'launched');
    assert.equal(u.calls.deploy, 1);
  }));

test('8.10b: the proof line not pushed yet is fixable (no kit, "say go"); a private repo is lasting (the kit, no token)', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('gate');
    const noLine = { ...t.ctx, tokenDeps: { ...t.ctx.tokenDeps, gate: { ...t.ctx.tokenDeps.gate, owner: async () => ({ status: 'missing' as const }) } } as TokenFlowDeps };
    const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, noLine)) as Confirmed;
    assert.ok(!('kit' in r));
    assert.equal(r.token?.fixable, true);
    assert.equal(r.show_to_builder, 'I need to add a short proof line to your repo first, then say go.');
    assert.match(r.agent_note ?? '', /Then call confirm_entry again\./);
    const priv = { ...t.ctx, tokenDeps: { ...t.ctx.tokenDeps, gate: { ...t.ctx.tokenDeps.gate, repo: async () => { throw new Error('GitHub: Not Found (not found)'); } } } as TokenFlowDeps };
    const p = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, priv)) as Confirmed;
    assert.ok(p.kit);
    assert.ok(!p.token?.fixable);
    assert.match(p.show_to_builder, /isn't public on GitHub\./);
    assert.equal(t.calls.deploy, 0);
  }));

test('C24, v2.8.1 §A3: the proof line still missing on the next "go" returns the kit with what the token waits on (never "open this in Claude Code"); the first miss tells the agent about can_push: false', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('c24');
    const noLine = { ...t.ctx, tokenDeps: { ...t.ctx.tokenDeps, gate: { ...t.ctx.tokenDeps.gate, owner: async () => ({ status: 'missing' as const }) } } as TokenFlowDeps };
    const first = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, noLine)) as Confirmed;
    assert.ok(!('kit' in first));
    assert.equal(first.token?.fixable, true);
    assert.match(first.agent_note ?? '', /If you can't push to this repo, call confirm_entry again with agent: \{ can_push: false \}: the entry records without a token and the kit comes back\./);
    // The next "go" with the line still missing: never a dead end.
    const second = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, noLine)) as Confirmed;
    assert.ok(second.kit, 'the kit');
    assert.ok(!second.token?.fixable);
    assert.ok(second.show_to_builder.startsWith(`${proofLineWaiting(null)}\n\nReady for `), second.show_to_builder);
    assert.doesNotMatch(second.show_to_builder, /Claude Code|Cursor/);
    assert.match(second.token?.agent_note ?? '', /isn't on the default branch\. Write the line "token: [0-9a-f]{16}" to earnkit\.txt at the root of github\.com\/[^ ]+ on the default branch and push it yourself/);
    assert.doesNotMatch(second.token?.agent_note ?? '', /can_push/);
    assert.equal(t.calls.deploy, 0);
    assert.equal((await t.rows())[0].confirm_choice, 'go');
    // An agent that did push in between: the next "go" launches as usual.
    const u = await confirmSetup('c24push');
    const missing = { ...u.ctx, tokenDeps: { ...u.ctx.tokenDeps, gate: { ...u.ctx.tokenDeps.gate, owner: async () => ({ status: 'missing' as const }) } } as TokenFlowDeps };
    assert.ok(!('kit' in ((await tools.confirm_entry({ ...u.input, ...go, wallet: W8 }, missing)) as Confirmed)));
    const pushed = (await tools.confirm_entry({ ...u.input, ...go, wallet: W8 }, u.ctx)) as Confirmed;
    assert.equal(pushed.token?.status, 'launched');
    assert.ok(pushed.kit);
  }));

test('I3, v2.8.1 §C13: recording Base after Arc (the repo\'s token is in Arc): the bonus note once, positively, never "isn\'t launched yet"', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('i3');
    const ctx = { ...t.ctx, repoCoins: undefined };
    const arc = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, ctx)) as Confirmed;
    assert.equal(arc.token?.status, 'launched');
    // What deployToken records with the claim: the token's repo key (one token per repo).
    await sql()`UPDATE projects SET token_repo_key = bonus_repo_key WHERE id = ${arc.project_id!}`;
    const baseFile = committedProgram('base-builder-grants');
    const baseId = `i3-base-${process.pid}-${Date.now()}`;
    await upsertProgram(ProgramFile.parse({ ...baseFile, id: baseId, status: 'active' }));
    const confirm = (await tools.confirm_entry({ ...t.input, program_id: baseId, ...go, wallet: W8 }, ctx)) as Confirmed;
    assert.ok(confirm.kit);
    // The kit alone: no bonus note before it.
    assert.equal(confirm.show_to_builder, confirm.kit!.show_to_builder);
    assert.doesNotMatch(confirm.show_to_builder, /builder bonus/i);
    const rec = (await tools.record_submission(
      { program_id: baseId, project: t.project, submission_data: t.answers, builder_submitted: true },
      ctx,
    )) as { show_to_builder: string; token: { status: string; note?: string } };
    // Once: in Also qualifies when it shows, else right after "Entered in…".
    assert.ok(rec.show_to_builder.startsWith(`Entered in ${baseFile.title}.`), rec.show_to_builder);
    assert.equal(rec.show_to_builder.split(`Your builder bonus rides on your ${t.p.title} entry.`).length, 2, rec.show_to_builder);
    assert.doesNotMatch(rec.show_to_builder, /no builder bonus|don't add|counts in/i);
    assert.doesNotMatch(rec.show_to_builder, /isn't launched/);
    assert.equal(rec.token.status, 'skipped');
    assert.equal(rec.token.note, `Your builder bonus rides on your ${t.p.title} entry.`);
    assert.equal(t.calls.deploy, 1);
  }));

test('8.12: list_programs closes with the token line and never says "optional"', dbTest, async () => {
  const stray = await sql()<{ id: string }[]>`
    SELECT id FROM programs WHERE status = 'active' AND campaign->>'kind' = 'earnkit'`;
  if (stray.length) await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  try {
    const [{ id }] = await sql()<{ id: number }[]>`
      INSERT INTO installations (token_hash) VALUES (${`t8-list-${process.pid}-${Date.now()}`}) RETURNING id`;
    const r = (await tools.list_programs({}, { installationId: id, roundPoolsWei: async () => new Map() })) as { show_to_builder: string };
    assert.ok(r.show_to_builder.endsWith(TOKEN_LINE), r.show_to_builder.slice(-200));
    assert.doesNotMatch(JSON.stringify(r), /optional/i);
  } finally {
    if (stray.length) await sql()`UPDATE programs SET status = 'active' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
  }
});

// ---- Task 8 fix round 1.
test('fix 1: the entry\'s own wallet is the one shown and the one used; the remembered one never', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('ownwallet', { remembered: W8 });
    const A = '0x' + 'a'.repeat(39) + '9';
    // An earlier attempt (or a v2.7 record) left wallet A on this entry; the remembered wallet is B (W8).
    await sql()`INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, bonus_repo_key, creator_wallet)
      VALUES (${t.p.id}, 'Tip Jar', ${t.repo}, 'https://tipjar.xyz', ${t.inst}, ${t.repo.replace('https://', '')}, ${A})`;
    const prep = (await tools.prepare_submission(t.input, t.ctx)) as { show_to_builder: string; shown_wallet?: string };
    assert.equal(prep.shown_wallet, A);
    assert.ok(prep.show_to_builder.includes('Wallet for fees and any bonus: 0xaaaa…aaa9 (used last time), or tell me another.'), prep.show_to_builder);
    const offer = (await tools.confirm_entry(t.input, t.ctx)) as Confirmed;
    assert.equal(offer.shown_wallet, A);
    assert.match(offer.show_to_builder, /0xaaaa…aaa9/);
    assert.doesNotMatch(offer.show_to_builder, /0x1581/);
    // "go" without echoing: nothing launches (fix round 2); A is suggested as a question.
    const r = (await tools.confirm_entry({ ...t.input, ...go }, t.ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 0);
    assert.ok(!('kit' in r));
    assert.equal(r.show_to_builder, 'Use 0xaaaa…aaa9 for fees and any bonus, or tell me another?');
    assert.equal(r.shown_wallet, A);
    // Echoed: launched to A, never the remembered one.
    const ok = (await tools.confirm_entry({ ...t.input, ...go, wallet: r.shown_wallet }, t.ctx)) as Confirmed;
    assert.equal(ok.token?.status, 'launched');
    assert.deepEqual(t.calls.wallets, [A]);
  }));

test('final fix wave (M5): on a hosted agent the entry\'s stored wallet is never shown or suggested', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('sharedwallet', { remembered: W8 });
    const A = '0x' + 'a'.repeat(39) + '9';
    await sql()`INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, bonus_repo_key, creator_wallet)
      VALUES (${t.p.id}, 'Tip Jar', ${t.repo}, 'https://tipjar.xyz', ${t.inst}, ${t.repo.replace('https://', '')}, ${A})`;
    const ctx = { ...t.ctx, sharedClient: true };
    const prep = (await tools.prepare_submission(t.input, ctx)) as { show_to_builder: string; shown_wallet?: string };
    assert.ok(!('shown_wallet' in prep), JSON.stringify(prep.shown_wallet));
    assert.doesNotMatch(prep.show_to_builder, /0xaaaa|0x1581/);
    const offer = (await tools.confirm_entry(t.input, ctx)) as Confirmed;
    assert.ok(!('shown_wallet' in offer));
    assert.doesNotMatch(offer.show_to_builder, /0xaaaa|0x1581/);
    // "go" without a wallet: nothing launches and no wallet is suggested.
    const r = (await tools.confirm_entry({ ...t.input, ...go }, ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 0);
    assert.ok(!('shown_wallet' in r));
    assert.doesNotMatch(r.show_to_builder, /0xaaaa|0x1581/);
  }));

test("fix 2: a token link the builder typed is not EarnKit's token: \"go\" launches EarnKit's, and never claims theirs", dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('typed');
    await sql()`INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, bonus_repo_key, token_url)
      VALUES (${t.p.id}, 'Tip Jar', ${t.repo}, 'https://tipjar.xyz', ${t.inst}, ${t.repo.replace('https://', '')}, 'https://mytoken.xyz/tip')`;
    const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 1);
    assert.equal(r.token?.status, 'launched');
    assert.match(r.show_to_builder, /^Your token \$[A-Z0-9]+ is live: tokens\.fun\/coin\/0x/, r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /mytoken/);
    assert.equal((await t.rows()).length, 1, 'the same entry');
    // Ruling C11: the builder's own link is kept, never as EarnKit's token.
    const [kept] = await sql()<{ own_token_url: string | null; token_url: string | null }[]>`
      SELECT own_token_url, token_url FROM projects WHERE installation_id = ${t.inst}`;
    assert.equal(kept.own_token_url, 'https://mytoken.xyz/tip');
    assert.match(kept.token_url ?? '', /^https:\/\/tokens\.fun\/coin\//);
    assert.doesNotMatch(JSON.stringify(r), /mytoken/, 'never in the reply');
    // "skip" on such an entry is a real skip (the typed link is not a token that holds the choice).
    const s = await confirmSetup('typedskip');
    await sql()`INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, bonus_repo_key, token_url)
      VALUES (${s.p.id}, 'Tip Jar', ${s.repo}, 'https://tipjar.xyz', ${s.inst}, ${s.repo.replace('https://', '')}, 'https://mytoken.xyz/tip')`;
    const k = (await tools.confirm_entry({ ...s.input, builder_confirmed: true, decision: 'skip' }, s.ctx)) as Confirmed;
    assert.ok(k.show_to_builder.startsWith('No token, no builder bonus.'), k.show_to_builder);
    assert.equal((await s.rows())[0].confirm_choice, 'skip');
    const [untouched] = await sql()<{ own_token_url: string | null; token_url: string | null }[]>`
      SELECT own_token_url, token_url FROM projects WHERE installation_id = ${s.inst}`;
    assert.deepEqual([untouched.own_token_url, untouched.token_url], [null, 'https://mytoken.xyz/tip'], 'skip changes nothing');
    assert.equal(s.calls.deploy, 0);
  }));

test('fix 3 (C9): an incomplete entry still gets its token on "go"; the kit names what is missing first and marks blanks', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('incomplete');
    const r = (await tools.confirm_entry({ ...t.input, answers: { description: 'Tips' }, ...go, wallet: W8 }, t.ctx)) as Confirmed & {
      kit: { missing: string[]; fields: { key: string; answer: string; missing?: true }[]; show_to_builder: string };
    };
    assert.equal(r.token?.status, 'launched', 'goal 2: the token launches');
    assert.equal(r.kit.missing.length, 1);
    const kitText = r.kit.show_to_builder;
    assert.ok(kitText.startsWith(`Before you submit: ${r.kit.missing[0]}.\n\nFor `), kitText);
    assert.ok(kitText.includes('Public builder profile\n(still needed)'), kitText);
    assert.ok(r.kit.fields.some((f) => f.key === 'builder_profile' && f.missing === true && f.answer === ''));
    assert.equal((await t.rows())[0].complete_at, null, 'not complete, so not bonus-eligible yet');
    // An answer given but not valid is a blank too, flagged to check.
    const bad = (await tools.confirm_entry({ ...t.input, answers: { description: 'Tips', builder_profile: 'not a link' }, ...go, wallet: W8 }, t.ctx)) as typeof r;
    assert.ok(bad.kit.show_to_builder.startsWith('Before you submit: '), bad.kit.show_to_builder);
    assert.match(bad.kit.missing[0], /\(check it\)$/);
    assert.doesNotMatch(bad.kit.show_to_builder, /not a link/);
  }));

test('fix round 2: wallet X shown, "go" with no echo, stored wallet A on the entry: nothing launches', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('noecho');
    const A = '0x' + 'a'.repeat(39) + '9';
    const X = '0x' + 'c'.repeat(39) + '1';
    await sql()`INSERT INTO projects (program_id, name, repo_url, live_url, installation_id, bonus_repo_key, creator_wallet)
      VALUES (${t.p.id}, 'Tip Jar', ${t.repo}, 'https://tipjar.xyz', ${t.inst}, ${t.repo.replace('https://', '')}, ${A})`;
    // The offer is given X: it shows X.
    const offer = (await tools.confirm_entry({ ...t.input, wallet: X }, t.ctx)) as Confirmed;
    assert.equal(offer.shown_wallet, X);
    assert.match(offer.show_to_builder, /0xcccc…ccc1/);
    // "go" arrives without the echo: no deploy at all, to A or anyone; the reply asks.
    const r = (await tools.confirm_entry({ ...t.input, ...go }, t.ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 0);
    assert.deepEqual(t.calls.wallets, []);
    assert.equal(r.token?.fixable, true);
    assert.ok(!('kit' in r));
    assert.equal(r.show_to_builder, 'Use 0xaaaa…aaa9 for fees and any bonus, or tell me another?');
    // The builder names X again and the agent passes it: launched to X.
    const ok = (await tools.confirm_entry({ ...t.input, ...go, wallet: X }, t.ctx)) as Confirmed;
    assert.equal(ok.token?.status, 'launched');
    assert.deepEqual(t.calls.wallets, [X]);
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
    const r = (await tools.prepare_submission({ ...t.input, answers: { description: COACH_ANSWERS.description, builder_profile: COACH_ANSWERS.builder_profile } }, t.ctx)) as Coached;
    const reqs = ProgramFile.parse(t.p).submission_requirements;
    const q = questionsFor({ reqs, answers: { description: 'x', builder_profile: 'x' }, first: true, project: 'Tip Jar' });
    assert.equal(r.show_to_builder, coachIntro(t.p.title, q));
    assert.equal(r.show_to_builder.split('\n')[1], '1. Who has used Tip Jar so far?');
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

test('9 coach: all answers: the draft, the fixes, then Ready and the offer; still no kit', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('draft', { remembered: W8, extra: COACH_EXTRA });
    const answers = { ...COACH_ANSWERS, traction: 'Creators love it.' };
    const r = (await tools.prepare_submission({ ...t.input, answers }, t.ctx)) as Coached;
    const p = ProgramFile.parse(t.p);
    const values = { ...answers, live_deployment_url: 'https://tipjar.xyz/', repo_url: t.repo };
    const fixes = preSubmitCheck({ reqs: p.submission_requirements, answers: values, judging: p.judging ?? null, knownLinks: [t.repo] }).filter(
      (f) => f.for === 'builder',
    );
    assert.ok(fixes.length > 0, 'a traction answer with no number');
    assert.equal(
      r.show_to_builder,
      [
        draftTable(p.submission_requirements, values),
        fixesLine(fixes),
        `Ready. ${confirmOffer({ hasBonus: true, coinIn: null, canPush: true, wallet: W8, remembered: true, proposal: { name: 'Tip Jar', symbol: 'TIP' } })}`,
      ].join('\n\n'),
    );
    assert.match(r.show_to_builder, /\n1\. Traction: add how many people used it \(e\.g\. 120 users, 900 payments\)\./);
    // C13: Arc's judging goes to the agent, never as a keyword fix to the builder.
    assert.doesNotMatch(r.show_to_builder, /No answer shows/);
    assert.deepEqual(r.fixes, fixes);
    assert.ok(!keysOf(r).includes('kit'));
    assert.ok(!('questions' in r));
    // 9.9: never blocking: "yes" with the fixes still open returns the kit.
    const go1 = (await tools.confirm_entry({ ...t.input, answers, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.ok(go1.kit);
    assert.equal(go1.token?.status, 'launched');
  }));

test('9 coach: confirm_entry "go" stores the application and banks the answers; the next program asks one round of short bullets', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('bank', { extra: COACH_EXTRA });
    // The offer renders with fixes open (never blocking) and writes nothing.
    const offer = (await tools.confirm_entry({ ...t.input, answers: { ...COACH_ANSWERS, traction: 'Loved.' } }, t.ctx)) as Confirmed;
    assert.match(offer.show_to_builder, /^Want the builder bonus\?/);
    const r = (await tools.confirm_entry({ ...t.input, answers: COACH_ANSWERS, ...go, wallet: W8 }, t.ctx)) as Confirmed;
    assert.ok(r.kit);
    const [row] = await sql()<{ application: Application }[]>`SELECT application FROM projects WHERE id = ${r.project_id!}`;
    assert.equal(row.application.answers.traction, COACH_ANSWERS.traction);
    assert.equal(row.application.answers.repo_url, t.repo);
    assert.equal(row.application.kinds.traction, 'traction');
    assert.equal(row.application.kinds.live_deployment_url, 'links');
    assert.ok(Array.isArray(row.application.fixes));
    assert.ok(!Number.isNaN(Date.parse(row.application.at)));
    const bank = await readBank(t.inst, projectKey({ repo_url: t.repo, name: 'Tip Jar' }));
    assert.equal(bank.get('traction'), COACH_ANSWERS.traction);
    assert.equal(bank.get('why_you'), COACH_ANSWERS.why_you);
    assert.equal(bank.get('use_of_funds'), COACH_ANSWERS.next);
    assert.ok(!bank.has('other'));
    // The second program for the same project: the bank fills what it can; one question at most,
    // though two required builder fields are still empty.
    const second = { ...committedProgram('arc-microgrants'), id: `${t.p.id}-2`, title: 'Second Grants', status: 'active', ends_at: '2099-01-01T00:00:00Z' };
    second.submission_requirements = [
      ...second.submission_requirements,
      { key: 'usage', label: 'Usage so far', type: 'text', required: true, from: 'builder', kind: 'traction' },
      { key: 'plan', label: 'Next 3 months', type: 'text', required: true, from: 'builder', kind: 'milestones' },
      { key: 'team', label: 'Team', type: 'text', required: true, from: 'builder', kind: 'team' },
    ];
    await upsertProgram(ProgramFile.parse(second));
    const r2 = (await tools.prepare_submission({ program_id: second.id, project: t.project, answers: { description: 'Tips on Arc' } }, t.ctx)) as Coached;
    // C15/C17: one round of short bullets for what only the builder knows; C16: the saved profile is a yes/no.
    assert.equal(r2.questions?.length, 3);
    assert.equal(
      r2.show_to_builder,
      [
        "Second Grants: a few things only you know, then I'll write it.",
        '- What will you ship in the next 3 months?',
        '- Who is building Tip Jar with you?',
        '- Use https://github.com/alice again?',
      ].join('\n'),
    );
    assert.equal(r2.coach?.from_bank.usage, COACH_ANSWERS.traction);
    assert.ok(!('builder_profile' in (r2.coach?.from_bank ?? {})), 'contact details are never filled silently');
    assert.deepEqual((r2.questions?.[2] as { suggested?: unknown }).suggested, { builder_profile: COACH_ANSWERS.builder_profile });
    assert.deepEqual(r2.coach && (r2.coach as unknown as { judging: string[] }).judging, [
      'Relevance to Arc',
      'Technical credibility',
      'Quality of what you built',
      'Worth taking further',
    ]);
    assert.match(r2.agent_note ?? '', /Re-angle answers from the bank to this program's judges\./);
    // One round per program: with the answer and coach_asked, no second question, even with a
    // required builder field still empty (it shows as missing for the agent to draft).
    const r2b = (await tools.prepare_submission(
      { program_id: second.id, project: t.project, answers: { description: 'Tips on Arc', plan: 'Recurring tips by March.', builder_profile: COACH_ANSWERS.builder_profile }, coach_asked: true },
      t.ctx,
    )) as Coached & { missing: { key: string }[] };
    assert.ok(!('questions' in r2b));
    assert.equal(r2b.ready, false);
    assert.deepEqual(r2b.missing.map((m) => m.key), ['team']);
    assert.match(r2b.show_to_builder, /^Before you submit: a team\./);
    // Another installation with the same repo gets nothing from this bank.
    const [{ id: other }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t9-other-${t.p.id}`}) RETURNING id`;
    const r3 = (await tools.prepare_submission({ program_id: second.id, project: t.project, answers: { description: 'Tips on Arc' } }, { ...t.ctx, installationId: other })) as Coached;
    assert.equal(r3.questions?.length, 4, "a first program: 3 questions and the contact bullet");
    assert.deepEqual(r3.coach?.from_bank, {});
  }));

test('C15/C17, v2.8.1 §C12: Base Builder Grants, first program: 3 questions and one bullet cover every builder-only field, the Loom and the Builder Code included; the answers make it ready (no second round)', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('base15', { remembered: W8 });
    const base = { ...committedProgram('base-builder-grants'), id: `${t.p.id}-base`, status: 'active', starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' };
    await upsertProgram(ProgramFile.parse(base));
    const draft = {
      project_name_description: 'TipJar: tips for creators in USDC.',
      live_product_url: 'https://tipjar.xyz',
      contract_address: '0x' + '1'.repeat(40),
      track: 'Trading',
    };
    const r = (await tools.prepare_submission({ program_id: base.id, project: t.project, answers: draft }, t.ctx)) as Coached;
    // 3 numbered questions and the leftovers as one short bullet (C17).
    assert.equal(r.questions?.length, 4);
    // v2.8.1 §C12: the Loom demo and the Base Builder Code are in this first round, never a surprise second one.
    assert.match(r.show_to_builder, /a Loom product demo/i, r.show_to_builder);
    assert.match(r.show_to_builder, /your Base Builder Code/);
    // A remembered wallet: no wallet question (the offer shows it).
    assert.ok(!r.questions!.some((q) => q.keys.includes('payout_wallet')));
    assert.equal(r.show_to_builder.split('\n').filter((l) => /^\d\. /.test(l)).length, 3);
    assert.equal(r.show_to_builder.split('\n').filter((l) => l.startsWith('- ')).length, 1);
    const asked = new Set(r.questions!.flatMap((q) => q.keys));
    const builderOnly = (base.submission_requirements as SubmissionRequirement[]).filter((x) => x.required && x.from === 'builder').map((x) => x.key);
    for (const k of builderOnly) assert.ok(asked.has(k), k);
    assert.match(r.agent_note ?? '', /Never answer a field marked builder_only yourself/);
    // The builder's answers under the questions' keys: ready, straight to the draft and the offer.
    const answers = { ...draft, ...Object.fromEntries(builderOnly.map((k) => [k, k === 'email' ? 'alice@example.com' : k === 'demo_loom' ? 'https://loom.com/share/abc' : `${k} 120 by March`])) };
    const done = (await tools.prepare_submission({ program_id: base.id, project: t.project, answers, coach_asked: true }, t.ctx)) as Coached;
    assert.equal(done.ready, true);
    assert.match(done.show_to_builder, /Ready\. Want the builder bonus\?/);
    assert.doesNotMatch(done.show_to_builder, /^Before you submit: /);
  }));

test('v2.8.1 §C11: the wallet is asked once, in the coach round; confirming is a single yes; only the wallet passed with "go" launches', dbTest, () =>
  withTokenEnv(async () => {
    // No remembered wallet: Arc's one question (the builder profile) carries the wallet ask.
    const t = await confirmSetup('c11');
    const asked = (await tools.prepare_submission({ ...t.input, answers: { description: t.answers.description } }, t.ctx)) as Coached;
    assert.equal(asked.questions?.length, 1);
    const q = asked.questions![0];
    assert.deepEqual(q.keys, ['builder_profile', 'payout_wallet']);
    assert.equal(
      asked.show_to_builder,
      "Arc Microgrants: 1 quick question, then I'll write your application.\n" +
        "1. Your public builder profile? And the wallet for your token's fees and any bonus (0x…)? No wallet yet? Make one at keys.coinbase.com.",
    );
    assert.match(asked.agent_note ?? '', /answers\.payout_wallet/);
    // The answers come back with the wallet: the offer names it (not "used last time") and returns it as shown_wallet.
    const answers = { ...t.answers, payout_wallet: W8 };
    const ready = (await tools.prepare_submission({ ...t.input, answers, coach_asked: true }, t.ctx)) as Coached & { shown_wallet?: string };
    assert.equal(ready.ready, true);
    assert.match(ready.show_to_builder, /\nWallet for fees and any bonus: 0x1581…b9a3, or tell me another\./);
    assert.doesNotMatch(ready.show_to_builder, /used last time|keys\.coinbase\.com/);
    assert.equal(ready.shown_wallet, W8);
    // Money safety (Ruling C12): a "go" without the wallet launches nothing; the coach's wallet is only asked about.
    const bare = (await tools.confirm_entry({ ...t.input, answers, ...go }, t.ctx)) as Confirmed;
    assert.equal(t.calls.deploy, 0);
    assert.equal(bare.show_to_builder, 'Use 0x1581…b9a3 for fees and any bonus, or tell me another?');
    assert.equal(bare.shown_wallet, W8);
    // The single yes: the agent echoes shown_wallet with "go".
    const yes = (await tools.confirm_entry({ ...t.input, answers, ...go, wallet: ready.shown_wallet }, t.ctx)) as Confirmed;
    assert.equal(yes.token?.status, 'launched');
    assert.deepEqual(t.calls.wallets, [W8]);
    // No wallet question when a wallet is already known (remembered), or the agent can't push.
    const known = await confirmSetup('c11-known', { remembered: W8 });
    const k = (await tools.prepare_submission({ ...known.input, answers: { description: known.answers.description } }, known.ctx)) as Coached;
    assert.deepEqual(k.questions?.flatMap((x) => x.keys), ['builder_profile']);
    const nopush = (await tools.prepare_submission({ ...t.input, answers: { description: t.answers.description }, agent: { can_push: false } }, { ...t.ctx, installationId: (await confirmSetup('c11-np')).inst })) as Coached;
    assert.ok(!nopush.questions?.some((x) => x.keys.includes('payout_wallet')));
    // A repo whose token is entered elsewhere gets no token here: no wallet question.
    const other = await confirmSetup('c11-elsewhere');
    const elsewhere = (await tools.prepare_submission({ ...other.input, answers: { description: other.answers.description } }, {
      ...other.ctx,
      repoCoins: async (keys: string[]) => new Map(keys.map((key) => [key, { program_id: 'base-builder-grants', title: 'Base Builder Grant Program' }] as const)),
    })) as Coached;
    assert.ok(!elsewhere.questions?.some((x) => x.keys.includes('payout_wallet')));
    // A wallet answer that isn't an address fails the call plainly (Ruling 22), never dropped.
    await assert.rejects(tools.prepare_submission({ ...t.input, answers: { ...t.answers, payout_wallet: 'my wallet' }, coach_asked: true }, t.ctx), /isn't valid/);
  }));

test('10.9 Ruling 4, Part E: Base (its Google form in the file): prepare_submission never has the link; confirm_entry go and skip return the prefilled_link kit', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('base10', { remembered: W8 });
    const base = { ...committedProgram('base-builder-grants'), id: `${t.p.id}-base`, status: 'active', starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' };
    await upsertProgram(ProgramFile.parse(base));
    const reqs = base.submission_requirements as SubmissionRequirement[];
    const answers: Record<string, string> = {
      ...Object.fromEntries(reqs.map((r) => [r.key, `${r.label.slice(0, 20)} answer`])),
      email: 'alice@example.com',
      live_product_url: 'https://tipjar.xyz',
      demo_loom: 'https://loom.com/share/abc',
      contract_address: '0x' + '1'.repeat(40),
      track: 'Trading',
    };
    const input = { program_id: base.id, project: t.project, answers, coach_asked: true };
    const prep = (await tools.prepare_submission(input, t.ctx)) as Record<string, unknown>;
    assert.equal(prep.ready, true, JSON.stringify(prep.missing));
    for (const k of ['kit', 'prefilled_url', 'paste', 'agent_steps', 'api', 'submission_url']) assert.ok(!keysOf(prep).includes(k), k);
    assert.doesNotMatch(JSON.stringify(prep), /docs\.google\.com\/forms|usp=pp_url|entry\.\d+/);

    const { coach_asked: _c, ...confirmInput } = input;
    void _c;
    type KitReply = Confirmed & { kit?: { mode: string; prefilled_url?: string; paste: { key: string }[]; show_to_builder: string } };
    const r = (await tools.confirm_entry({ ...confirmInput, ...go, wallet: W8 }, t.ctx)) as KitReply;
    assert.equal(r.token?.status, 'launched');
    assert.equal(r.kit?.mode, 'prefilled_link');
    const url = r.kit!.prefilled_url!;
    assert.ok(url.startsWith(`${base.form.url}?usp=pp_url&entry.100652540=`), url);
    assert.match(url, /&entry\.1495021877=Trading(&|$)/);
    assert.ok(url.length <= 8000);
    // The checkbox question has no entry id in the file: it is pasted (ticked) by the builder.
    assert.deepEqual(r.kit!.paste.map((f) => f.key), ['primary_challenge']);
    assert.ok(r.kit!.show_to_builder.startsWith(`Ready for ${base.title}. Open this, check it, and click submit:\n${url}\n\nYou add these yourself:\nSign in to Google and tick Record my email address.\n\nWhat is the primary challenge`), r.kit!.show_to_builder);
    assert.ok(!url.includes('emailAddress'), 'never emailAddress= (C19)');
    assert.ok(r.kit!.show_to_builder.endsWith('After you submit, send me the confirmation screenshot or email.'));
    assert.match(r.agent_note ?? '', /Never submit the form for them/);
    // Skip: the same kit.
    const s = (await tools.confirm_entry({ ...confirmInput, builder_confirmed: true, decision: 'skip' }, t.ctx)) as KitReply;
    assert.equal(s.kit?.mode, 'prefilled_link');
    assert.equal(s.kit?.prefilled_url, url);
  }));

test('10 Part E: confirm_entry on DoraHacks with a browser is still the paste list; the agent is told never to fill it', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('dora10');
    const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8, agent: { browser: true } }, t.ctx)) as Confirmed & { kit?: { mode: string; agent_steps?: string[] } };
    assert.equal(r.kit?.mode, 'copy_paste');
    assert.ok(!r.kit?.agent_steps);
    assert.match(r.agent_note ?? '', /terms ban automated use/);
  }));

test('11 Also qualifies: after confirm_entry "go" and record_submission on Arc, also_qualifies reuses the bank and the cached chains; never Arc; Task 8 carry excludes an entered one', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('also', { extra: COACH_EXTRA });
    // v2.8 Part E's Base fixture, cloned under a fresh id (already open and rolling, as committed).
    const other = { ...committedProgram('base-builder-grants'), id: `${t.p.id}-base`, title: `Also Base ${t.p.id}` };
    await upsertProgram(ProgramFile.parse(other));

    // Isolate: close every other active, curated, non-campaign program for the duration, so stray
    // rows other dbTests leave in this shared database can't crowd the top MAX_ALSO rows (same
    // pattern as the v2.5 §1 list_programs test's stray-campaign handling).
    const stray = await sql()<{ id: string }[]>`
      SELECT id FROM programs WHERE status = 'active' AND source = 'file' AND campaign IS NULL AND id NOT IN (${t.p.id}, ${other.id})`;
    if (stray.length) await sql()`UPDATE programs SET status = 'closed' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
    try {
      const go1 = (await tools.confirm_entry({ ...t.input, answers: COACH_ANSWERS, ...go, wallet: W8 }, t.ctx)) as Confirmed;
      assert.ok(go1.kit);
      const submit = () =>
        tools.record_submission(
          { program_id: t.p.id, project: t.project, submission_data: COACH_ANSWERS, builder_submitted: true },
          t.ctx,
        ) as Promise<{ also_qualifies?: AlsoRow[]; show_to_builder: string }>;

      // Uncached: chains fall back to Arc's own (arc only), so the Base-chain program doesn't fit.
      const r1 = await submit();
      assert.ok(!r1.also_qualifies?.some((x) => x.id === other.id));
      // No candidate fits yet (isolated to just t.p and other, and other needs base): the reply is
      // exactly the entered text, with no "Also qualifies" suffix at all. Captured for the full
      // joined-string check below (review fix round 1, item 4).
      const mainText = r1.show_to_builder;
      assert.ok(!r1.also_qualifies);

      // Cache the repo's chains as covering Base too: it now shows, via the cache (Ruling 29).
      const full = t.repo.replace('https://github.com/', '');
      await sql()`
        INSERT INTO github_repo_facts (full_name, pushed_at, chains, commits_since) VALUES (
          ${full}, now(),
          ${sql().json({ arc: { mainnet: true, testnet: false, evidence: 'x' }, base: { mainnet: true, testnet: false, evidence: 'x' } })},
          '{}')`;
      const r2 = await submit();
      assert.ok(!r2.also_qualifies?.some((x) => x.id === t.p.id), 'never the entered program itself');
      const row = r2.also_qualifies?.find((x) => x.id === other.id);
      assert.ok(row, 'the Base-chain program shows via the cached chains');

      // The wiring matches the pure function exactly, given the same bank, programs and entries.
      const bank = await readBank(t.inst, projectKey({ repo_url: t.repo, name: 'Tip Jar' }));
      const programs = await alsoProgramFacts();
      const enteredIds = await enteredProgramIds(t.inst, { repoUrl: t.repo, name: 'Tip Jar' });
      const args = { enteredProgramId: t.p.id, chains: ['arc', 'base'] as Chain[], programs, bank, answers: COACH_ANSWERS, hasLiveProduct: true, now: new Date() };
      const expectedRows = alsoQualifies({ ...args, enteredIds });
      assert.deepEqual(r2.also_qualifies, expectedRows);
      // confirmSetup's ctx.repoCoins always answers {} (so the token launch flow never sees this
      // repo as held elsewhere): the same stub makes coinIn null here, not the entered program.
      // Review fix round 1, item 4: the full joined string (mainText + "\n\n" + the block), not
      // just the tail, so a regression that glues the sections together would be caught.
      assert.equal(r2.show_to_builder, `${mainText}\n\n${alsoText(expectedRows, null)}`);

      // Reusing the bank cuts how much is left (usage_numbers, kind traction, is filled from Arc's).
      const unbanked = alsoQualifies({ ...args, enteredIds, bank: new Map() }).find((x) => x.id === other.id)!;
      assert.ok(row!.left < unbanked.left, 'reusing the bank cuts how much is left for the next program');

      // Task 8 carry: confirming Base too (skip, never submitted) still counts as entered; it is
      // never offered a second time.
      await tools.confirm_entry(
        { program_id: other.id, project: t.project, answers: COACH_ANSWERS, builder_confirmed: true, decision: 'skip' },
        t.ctx,
      );
      const r3 = await submit();
      assert.ok(!r3.also_qualifies?.some((x) => x.id === other.id), 'already entered (confirmed, unsubmitted): never offered twice');
    } finally {
      if (stray.length) await sql()`UPDATE programs SET status = 'active' WHERE id IN ${sql()(stray.map((s) => s.id))}`;
    }
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
  const ctx = { installationId: mine, roundPoolsWei: async () => new Map(), repoCoins: async () => new Map() };
  type Listed = { ask_outcome?: { project_id: number; program_id: string; question: string; agent_note: string } };
  try {
    const first = (await tools.list_programs({}, ctx)) as Listed;
    assert.deepEqual(first.ask_outcome && { ...first.ask_outcome, agent_note: undefined }, {
      project_id: tipjar,
      program_id: due.id,
      question: `Did TipJar win anything in Arc Due ${stamp}?`,
      agent_note: undefined,
    });
    assert.match(first.ask_outcome!.agent_note, /tell_earnkit/);
    assert.doesNotMatch(first.ask_outcome!.agent_note, /report_outcome/);
    // Asked once: not on the next call.
    const second = (await tools.list_programs({}, ctx)) as Listed;
    assert.ok(!('ask_outcome' in second));
    // Ruling C21: list_programs takes no answer (it stays read-only); tell_earnkit stores it.
    await assert.rejects(tools.list_programs({ report_outcome: { project_id: tipjar, result: 'won' } }, ctx));
    assert.ok(!('report_outcome' in tools));
    const saved = (await tools.tell_earnkit(
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
      tools.tell_earnkit({ program_status: [{ program_id: due.id, status: 'won', project_id: theirs }] }, ctx),
      (err: Error) => err.constructor.name === 'NotFoundError',
    );
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM entry_outcomes WHERE project_id = ${theirs}`)[0].n, 0);
    // A self-report never alerts: the wins in the next reply come from announcements only.
    const next = (await tools.list_programs({}, ctx)) as { show_to_builder: string };
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
  const ctx = { installationId: inst, roundPoolsWei: async () => new Map(), repoCoins: async () => new Map() };
  type Listed = { show_to_builder: string; wallet_note?: string };
  try {
    await withOnlyPrograms([p.id], async () => {
    const first = (await tools.list_programs(
      {
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
    const back = (await tools.list_programs({}, ctx)) as Listed;
    assert.ok(back.show_to_builder.startsWith(`Your entries: ${p.title} (TipJar, submitted).\n\n`), back.show_to_builder);
    assert.match(back.show_to_builder, new RegExp(`\\| ${p.title} \\(entered\\) \\|`));
    assert.doesNotMatch(back.show_to_builder, new RegExp(`(start on|keep going on|new for) ${p.title}`));
    assert.ok(!('wallet_note' in back));
    });
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
  const ctx = { installationId: inst, roundPoolsWei: async () => new Map(), repoCoins: async () => new Map() };
  const base = committedProgram('base-builder-grants');
  // v2.9 A7: without the live-product tag, so a live, verified product repo could win it.
  const p = { ...base, id: `t12-new-${stamp}`, title: `Fresh Base ${stamp}`, status: 'active', form: undefined, tag: undefined };
  const repo = {
    key: 'alice/tipjar', name: 'tipjar', url: 'https://github.com/alice/tipjar', homepage: 'https://tipjar.xyz', created_at: '2026-01-01T00:00:00Z',
    chains: { base: { mainnet: true, testnet: false, evidence: 'x' } }, product: { score: 6, tier: 'product', missing: [] }, live_verified: true, said: null,
  };
  try {
    await tools.list_programs({}, ctx); // the first check: quiet, marks every open program seen
    await sql()`UPDATE installations SET fit_repos = ${sql().json([repo] as never)} WHERE id = ${inst}`;
    await upsertProgram(ProgramFile.parse(p));
    const r = (await tools.list_programs({}, ctx)) as { show_to_builder: string };
    const count = r.show_to_builder.split(`new: ${p.title}`).length - 1;
    assert.equal(count, 1, r.show_to_builder);
    assert.match(r.show_to_builder, new RegExp(`^Since you last checked: .*new: ${p.title} \\(up to \\$5,000\\)`));
  } finally {
    await sql()`DELETE FROM installations WHERE id = ${inst}`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${p.id}`;
  }
});

// ---------------------------------------------------------------------------------------------
// v2.8.1 §A (token launch never stuck, limits, timeouts): the real deployToken (claim, outcome,
// release, one retry) against a mocked tokens.fun, through confirm_entry. DB only; no network.
type LaunchReply = {
  show_to_builder: string;
  project_id?: number;
  token?: { status: string; note?: string; launching?: boolean; agent_note?: string };
  kit?: unknown;
  agent_note?: string;
};

/** One tokens.fun answer: a status and a JSON body (or a delay before it). */
type Answer = { status: number; body: unknown; headers?: Record<string, string>; delayMs?: number };

async function launchSetup(tag: string, answers: Answer[]) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const p = { ...arc, id: `t281-${tag}-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(p));
  const [{ id: inst }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t281-${tag}-${stamp}`}) RETURNING id`;
  const repo = `https://github.com/alice/t281-${tag}-${stamp}`;
  const posts: unknown[] = [];
  const queue = [...answers];
  const fakeFetch = (async (_url: string, init: { body: string }) => {
    posts.push(JSON.parse(init.body));
    const a = queue.shift() ?? { status: 500, body: { error: 'no more answers' } };
    if (a.delayMs) await new Promise((r) => setTimeout(r, a.delayMs));
    return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json', ...a.headers } });
  }) as unknown as typeof fetch;
  const tokenDeps: TokenFlowDeps = {
    available: () => true,
    limit: async () => {},
    check: async () => true,
    gate: {
      repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null, defaultBranch: 'main' }),
      owner: async () => ({ status: 'ok', text: tokenLineFor(inst, repo)! }),
      screen: async () => {},
    },
    deploy: (a) => deployToken(a, { fetch: fakeFetch, sleep: async () => {} }),
  };
  const ctx = { installationId: inst, roundPoolsWei: async () => new Map(), repoCoins: async () => new Map(), tokenDeps };
  await saveOffer(inst, p.id, offerKey(repo, 'Tip Jar'), { name: 'Tip Jar', symbol: 'TIPJAR' });
  const input = {
    program_id: p.id,
    project: { name: 'Tip Jar', repo_url: repo, live_url: 'https://tipjar.xyz' },
    answers: { description: 'Tips for creators on Arc', builder_profile: 'https://github.com/alice' },
  };
  const row = async () =>
    (
      await sql()<{ id: number; token_url: string | null; token_status: string | null; token_note: string | null; token_claimed_at: Date | null }[]>`
        SELECT id, token_url, token_status, token_note, token_claimed_at FROM projects WHERE installation_id = ${inst}`
    )[0];
  const done = async () => {
    await sql()`DELETE FROM projects WHERE installation_id = ${inst}`;
    await sql()`DELETE FROM installations WHERE id = ${inst}`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${p.id}`;
  };
  return { ctx, input, posts, queue, row, done };
}

async function withLaunchEnv<T>(fn: () => Promise<T>, env: Record<string, string> = {}) {
  const keys = ['TOKENSFUN_DEPLOY_API_KEY', 'EARNKIT_AUTH_SECRET', ...Object.keys(env)];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'test-key';
  process.env.EARNKIT_AUTH_SECRET ||= 't281-secret';
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const OK = (addr = '0x' + 'ab'.repeat(20)) => ({
  status: 200,
  body: { success: true, tokenAddress: addr, txHash: '0x' + '12'.repeat(32), urls: { tokensfun: `https://tokens.fun/coin/${addr}` } },
});
const PENDING_TX = { status: 503, body: { error: 'Pending transactions detected. Try again in a few minutes.', pendingCount: 1 } };

test('v2.8.1 §A1: a 503 "Pending transactions" is retried once under the same claim and launches', dbTest, () =>
  withLaunchEnv(async () => {
    const t = await launchSetup('retry-ok', [PENDING_TX, OK()]);
    try {
      const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
      assert.equal(t.posts.length, 2, 'one automatic retry');
      assert.equal(r.token?.status, 'launched');
      assert.ok(r.kit);
      const row = await t.row();
      assert.equal(row.token_status, 'launched');
      assert.ok(row.token_claimed_at, 'the claim time is stamped');
    } finally {
      await t.done();
    }
  }));

test('v2.8.1 §A1: nothing minted twice (503, then a revert): the claim is released, the builder says go, and "go" launches', dbTest, () =>
  withLaunchEnv(async () => {
    const t = await launchSetup('release', [
      PENDING_TX,
      { status: 500, body: { error: 'Deployment failed', message: 'Contract execution reverted. Please try again or contact support.', minted: false } },
      OK(),
    ]);
    try {
      const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
      assert.equal(t.posts.length, 2, 'retried once, never more');
      assert.equal(r.token?.status, 'failed');
      assert.ok(r.show_to_builder.startsWith("Your token didn't launch yet; say go to try again.\n\n"), r.show_to_builder);
      assert.ok(r.kit, 'never a dead end');
      const row = await t.row();
      assert.equal(row.token_url, null, 'released');
      assert.equal(row.token_status, 'failed');
      assert.equal(row.token_note, NOT_LAUNCHED_YET);
      // The builder says go: it launches.
      const again = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
      assert.equal(again.token?.status, 'launched');
      assert.equal(t.posts.length, 3);
    } finally {
      await t.done();
    }
  }));

test('v2.8.1 §A1: an unknown outcome (502, or a tx hash) keeps the claim: never retried, plain words, the owner is alerted after 10 minutes', dbTest, () =>
  withLaunchEnv(async () => {
    for (const answer of [
      { status: 502, body: { error: 'Deployment status unknown' } },
      { status: 503, body: { error: 'Pending transactions detected.', txHash: '0x' + '34'.repeat(32) } },
    ]) {
      const t = await launchSetup('unknown', [answer, OK()]);
      try {
        const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(t.posts.length, 1, 'no retry');
        assert.equal(r.token?.status, 'pending');
        assert.ok(r.show_to_builder.startsWith(`${LAUNCH_STUCK}\n\n`), r.show_to_builder);
        assert.match(r.token?.agent_note ?? '', /never retried/);
        const row = await t.row();
        assert.equal(row.token_url, 'pending');
        // A second "go": nothing deploys; the settled claim is said plainly, with the kit.
        const again = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(t.posts.length, 1);
        assert.equal(again.token?.note, LAUNCH_STUCK);
        assert.ok(again.kit);
        // The cron: not yet at 9 minutes, then needs_owner past 10.
        const claimed = row.token_claimed_at!.getTime();
        assert.ok(!(await stuckLaunches(new Date(claimed + 9 * 60_000))).includes(row.id));
        assert.ok((await stuckLaunches(new Date(claimed + STUCK_LAUNCH_MS + 1_000))).includes(row.id));
        const out = await runCron({ now: new Date(claimed + STUCK_LAUNCH_MS + 1_000), only: ['none'], deps: { stuckLaunches, refreshFees: async () => 0 } });
        assert.ok(out.needs_owner.includes(`token-pending:${row.id}`), JSON.stringify(out.needs_owner));
        // Final fix wave (M1): a claim with no time (taken by old code after the backfill) is stuck
        // now, for the cron and for the builder (never "launching" forever).
        await sql()`UPDATE projects SET token_claimed_at = NULL, token_note = NULL WHERE id = ${row.id}`;
        assert.ok((await stuckLaunches(new Date())).includes(row.id));
        const untimed = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(t.posts.length, 1);
        assert.equal(untimed.token?.note, LAUNCH_STUCK);
      } finally {
        await t.done();
      }
    }
  }));

test('v2.8.1 §A5: a slow deploy replies "launching" before the reply time (no kit); the next call returns the token and the kit', dbTest, () =>
  withLaunchEnv(
    async () => {
      const t = await launchSetup('slow', [{ ...OK(), delayMs: 900 }]);
      try {
        const started = Date.now();
        const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        const took = Date.now() - started;
        assert.ok(took < 850, `replied in ${took} ms, before the deploy answered`);
        assert.equal(r.show_to_builder, LAUNCHING);
        assert.equal(r.token?.launching, true);
        assert.ok(!r.kit, 'the kit comes with the result');
        assert.match(r.agent_note ?? '', /call the same tool again with the same arguments plus check_back: true/);
        // Asked again while it still runs: launching again, nothing new deployed.
        const mid = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(mid.show_to_builder, LAUNCHING);
        assert.equal(t.posts.length, 1);
        // The deploy finishes in the background and records itself.
        await new Promise((res) => setTimeout(res, 1_200));
        assert.equal((await t.row()).token_status, 'launched');
        const next = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(next.token?.status, 'launched');
        assert.ok(next.kit);
        assert.equal(t.posts.length, 1);
      } finally {
        await t.done();
      }
    },
    { EARNKIT_LAUNCH_REPLY_MS: '300' },
  ));

test('v2.8.1 §A4: tokens.fun\'s wallet limit says when to retry (retry_after), releases the claim, and the kit comes back', dbTest, () =>
  withLaunchEnv(async () => {
    const at = new Date(Date.now() + 3 * 3_600_000);
    const t = await launchSetup('limit', [{ status: 429, body: { error: 'Daily token limit reached', retry_after: at.toISOString(), retry_after_seconds: 10_800 }, headers: { 'retry-after': '10800' } }]);
    try {
      const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
      const hhmm = new Date(Math.ceil(at.getTime() / 60_000) * 60_000).toISOString().slice(11, 16);
      assert.ok(r.show_to_builder.startsWith(`Your token didn't launch: this wallet reached today's launch limit. Try again after ${hhmm} UTC.\n\n`), r.show_to_builder);
      assert.ok(r.kit);
      assert.equal(t.posts.length, 1, 'a limit is never retried at once');
      assert.equal((await t.row()).token_url, null);
    } finally {
      await t.done();
    }
  }));

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

test('v2.8.1 fix round 1: a release after the "launching" reply is read by the check-back, never relaunched; a new "go" relaunches', dbTest, () =>
  withLaunchEnv(
    async () => {
      const busy = { ...PENDING_TX, delayMs: 250 };
      const t = await launchSetup('bg-release', [busy, busy, OK()]);
      try {
        const r = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(r.show_to_builder, LAUNCHING);
        // Both 503s and the release happen in the background.
        await new Promise((res) => setTimeout(res, 900));
        const row = await t.row();
        assert.equal(row.token_url, null);
        assert.equal(t.posts.length, 2);
        // The agent checks back with the same arguments plus check_back: the stored note, no launch.
        const back = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8, check_back: true }, t.ctx)) as LaunchReply;
        assert.ok(back.show_to_builder.startsWith("Your token didn't launch yet; say go to try again.\n\n"), back.show_to_builder);
        assert.equal(t.posts.length, 2, 'the check-back launched nothing');
        // The builder says go: it launches.
        const goAgain = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(goAgain.token?.status, 'launched');
        assert.equal(t.posts.length, 3);
      } finally {
        await t.done();
      }
    },
    { EARNKIT_LAUNCH_REPLY_MS: '150' },
  ));

test('v2.8.1 fix round 1: without check_back, a same-arguments call within 2 minutes of an unseen release is a read too', dbTest, () =>
  withLaunchEnv(
    async () => {
      const busy = { ...PENDING_TX, delayMs: 250 };
      const t = await launchSetup('bg-unseen', [busy, busy, OK()]);
      try {
        await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx);
        await new Promise((res) => setTimeout(res, 900));
        const same = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.ok(same.show_to_builder.startsWith("Your token didn't launch yet; say go to try again.\n\n"), same.show_to_builder);
        assert.equal(t.posts.length, 2, 'deploy called exactly twice');
        // Seen now: the next "go" launches.
        const next = (await tools.confirm_entry({ ...t.input, ...go, wallet: W8 }, t.ctx)) as LaunchReply;
        assert.equal(next.token?.status, 'launched');
        assert.equal(t.posts.length, 3);
      } finally {
        await t.done();
      }
    },
    { EARNKIT_LAUNCH_REPLY_MS: '150' },
  ));

// ---- v2.8.1 §E17: hosted agent installs (shared_client).

test('v2.8.1 §E17: on a hosted agent the remembered wallet is never suggested; the builder is asked', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('shared-wallet', { remembered: W8 });
    const ctx = { ...t.ctx, sharedClient: true };
    const prep = (await tools.prepare_submission(t.input, ctx)) as Record<string, unknown>;
    assert.ok(!('shown_wallet' in prep), 'no remembered wallet on the offer');
    assert.ok(!JSON.stringify(prep).toLowerCase().includes(W8.toLowerCase()));
    const offer = (await tools.confirm_entry(t.input, ctx)) as Confirmed;
    assert.ok(!('shown_wallet' in offer));
    assert.ok(!offer.show_to_builder.toLowerCase().includes(W8.toLowerCase()));
    // A "go" without a wallet: nothing launched, and the wallet is asked, never the remembered one.
    const goNoWallet = (await tools.confirm_entry({ ...t.input, ...go }, ctx)) as Confirmed;
    assert.ok(!JSON.stringify(goNoWallet).toLowerCase().includes(W8.toLowerCase()));
    assert.equal(t.calls.deploy, 0);
    // The same installation off a hosted agent keeps v2.8's behavior.
    const own = (await tools.prepare_submission(t.input, t.ctx)) as Record<string, unknown>;
    assert.equal(own.shown_wallet, W8);
  }));

test('v2.8.1 §E17: the coach round asks for the wallet on a hosted agent even with one remembered', dbTest, () =>
  withTokenEnv(async () => {
    const t = await confirmSetup('shared-coach', { remembered: W8, extra: [{ key: 'team', label: 'Team', type: 'text', required: true, from: 'builder', kind: 'team' } as SubmissionRequirement] });
    const asked = (await tools.prepare_submission(t.input, { ...t.ctx, sharedClient: true })) as { show_to_builder: string };
    assert.match(asked.show_to_builder, /The wallet for your token's fees/);
    const own = (await tools.prepare_submission(t.input, t.ctx)) as { show_to_builder: string };
    assert.doesNotMatch(own.show_to_builder, /The wallet for your token's fees/, 'a remembered wallet is not asked again off a hosted agent');
  }));

test('v2.8.1 §E17: a hosted agent saved answers come back only as a named yes/no', dbTest, () =>
  withTokenEnv(async () => {
    const team = { key: 'team', label: 'Team', type: 'text', required: true, from: 'builder', kind: 'team' } as SubmissionRequirement;
    const t = await confirmSetup('shared-bank', { extra: [team] });
    await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id)
      VALUES (${t.inst}, ${projectKey({ repo_url: t.repo, name: 'Tip Jar' })}, 'team', 'Alice and Bob', 'other-program')`;
    const shared = (await tools.prepare_submission(t.input, { ...t.ctx, sharedClient: true })) as { show_to_builder: string; ready: boolean; coach?: { from_bank?: unknown } };
    assert.match(shared.show_to_builder, /Use "Alice and Bob" again\?/);
    assert.equal(shared.ready, false, 'not filled until the builder says yes');
    const own = (await tools.prepare_submission(t.input, t.ctx)) as { show_to_builder: string };
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
      tools.prepare_submission({ ...t.input, project: { ...t.project, live_url: 'https://example.com' } }, t.ctx),
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
    const r = (await tools.prepare_submission(input, ctx)) as {
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
    await tools.confirm_entry({ ...input, ...go, decision: 'skip' }, ctx);
    const [row] = await t.rows();
    assert.equal(row.complete_at, null);
    const [v] = await sql()<{ live_verified_at: Date | null }[]>`SELECT live_verified_at FROM projects WHERE id = ${row.id}`;
    assert.equal(v.live_verified_at, null);
  }));

test('v2.9 A5 fix round 1: Arc (needs_contract) through startEntry and recordSubmission: complete only with a loading link and a contract with code', dbTest, () =>
  withTokenEnv(async () => {
    const { LIVE_FAILED_LINE } = await import('./verify');
    const NO_CONTRACT = 'No contract found on Arc mainnet yet.';
    type Prep = { ready: boolean; show_to_builder: string; fixes?: { text: string }[] };
    const cols = async (inst: number) =>
      sql()<{ complete_at: Date | null; live_verified_at: Date | null; contract_verified_at: Date | null }[]>`
        SELECT complete_at, live_verified_at, contract_verified_at FROM projects WHERE installation_id = ${inst} ORDER BY id`;
    // One case per entry: its own installation, live link and contract (the memory cache is per link and address).
    const arcCase = async (tag: string, o: { probeOk: boolean; code: string }) => {
      const t = await confirmSetup(tag, { remembered: W8, keepContract: true });
      assert.equal(t.p.needs_contract, 'arc');
      const contract = `0x${randomBytes(20).toString('hex')}`;
      const project = { ...t.project, live_url: `https://${tag}-${t.inst}.tipjar.xyz`, contracts: [contract] };
      const ctx = {
        ...t.ctx,
        verifyDeps: {
          probe: async () => {
            if (!o.probeOk) throw new Error('no answer');
          },
          getCode: async () => o.code,
        },
      };
      return { t, ctx, input: { ...t.input, project } };
    };

    // A loading link and a contract with code: complete, both columns set (startEntry).
    const ok = await arcCase('a5ok', { probeOk: true, code: '0x6080' });
    const okPrep = (await tools.prepare_submission(ok.input, ok.ctx)) as Prep;
    assert.equal(okPrep.ready, true, okPrep.show_to_builder);
    await tools.confirm_entry({ ...ok.input, ...go, decision: 'skip' }, ok.ctx);
    const [okRow] = await cols(ok.t.inst);
    assert.ok(okRow.complete_at instanceof Date && okRow.live_verified_at instanceof Date && okRow.contract_verified_at instanceof Date);
    // The same through recordSubmission (a new entry, never confirmed): complete, both columns set.
    const rec = await arcCase('a5rec', { probeOk: true, code: '0x6080' });
    await tools.record_submission({ program_id: rec.t.p.id, project: rec.input.project, submission_data: rec.t.answers, token: 'skip' }, rec.ctx);
    const [recRow] = await cols(rec.t.inst);
    assert.ok(recRow.complete_at instanceof Date && recRow.live_verified_at instanceof Date && recRow.contract_verified_at instanceof Date);

    // A loading link, but 0x at the address: not complete, the contract fix line, the offer still shown.
    const empty = await arcCase('a5empty', { probeOk: true, code: '0x' });
    const emptyPrep = (await tools.prepare_submission(empty.input, empty.ctx)) as Prep;
    assert.equal(emptyPrep.ready, false);
    assert.deepEqual(emptyPrep.fixes?.filter((f) => f.text === NO_CONTRACT).length, 1);
    assert.match(emptyPrep.show_to_builder, /Want the builder bonus\?/);
    await tools.confirm_entry({ ...empty.input, ...go, decision: 'skip' }, empty.ctx);
    const [emptyRow] = await cols(empty.t.inst);
    assert.equal(emptyRow.complete_at, null);
    assert.ok(emptyRow.live_verified_at instanceof Date);
    assert.equal(emptyRow.contract_verified_at, null);

    // A failed probe: not complete, the live link fix line, the offer still shown (recordSubmission).
    const down = await arcCase('a5down', { probeOk: false, code: '0x6080' });
    const downPrep = (await tools.prepare_submission(down.input, down.ctx)) as Prep;
    assert.equal(downPrep.ready, false);
    assert.deepEqual(downPrep.fixes?.filter((f) => f.text === LIVE_FAILED_LINE).length, 1);
    assert.match(downPrep.show_to_builder, /Want the builder bonus\?/);
    await tools.record_submission({ program_id: down.t.p.id, project: down.input.project, submission_data: down.t.answers, token: 'skip' }, down.ctx);
    const [downRow] = await cols(down.t.inst);
    assert.deepEqual([downRow.complete_at, downRow.live_verified_at], [null, null]);
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
  assert.deepEqual(rows.map((r) => [r.repo, r.product_score]), [['r1', 6], ['r3', 5], ['r2', 4]]);
  const a16z = matchRows([5, 6].map((s, i) => scoredFit(`a${i}`, s, 'a16z-speedrun')), new Set(['a16z-speedrun']));
  assert.deepEqual(a16z.map((r) => r.repo), ['a1']);
});

test('2.12 list_programs: 5 repos fitting Base give 3 Base rows in matches, best score first', dbTest, async () => {
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t2-matches-${process.pid}-${Date.now()}`}) RETURNING id`;
  const r = (await tools.list_programs(
    { local_repos: [{ name: 'r0', chains: ['base'] }] },
    { installationId: id, matchProjects: async () => ({ checked: 5, scored: 5, fits: fiveOnBase }) },
  )) as { matches: { repo: string; program_id: string }[] };
  const base = r.matches.filter((m) => m.program_id === 'base-builder-grants');
  assert.deepEqual(base.map((m) => m.repo), ['r1', 'r3', 'r2']);
});

test('3.10 list_programs reads the builder memory once: not interested leaves the reply and matches; said reaches matching', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const id1 = `t3-arc-${stamp}`;
  await upsertProgram(ProgramFile.parse({ ...arc, id: id1, title: `Arc T3 ${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' }));
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash) VALUES (${`t3-memory-${stamp}`}) RETURNING id`;
  let given: { said?: Record<string, unknown> } | undefined;
  const ctx = {
    installationId: id,
    roundPoolsWei: async () => new Map(),
    repoCoins: async () => new Map(),
    matchProjects: async (input: { said?: Record<string, unknown> }) => {
      given = input;
      return { checked: 1, scored: 1, fits: [scoredFit('tipjar', 6, id1)] };
    },
  };
  type Listed = { show_to_builder: string; matches: { program_id: string }[] };
  try {
    const before = (await tools.list_programs({ local_repos: [{ name: 'tipjar', chains: ['arc'] }] }, ctx)) as Listed;
    assert.match(before.show_to_builder, new RegExp(`Arc T3 ${stamp}`));
    assert.ok(before.matches.some((m) => m.program_id === id1));
    assert.equal(given?.said, undefined);
    const told = (await tools.tell_earnkit(
      { program_status: [{ program_id: id1, status: 'not_interested' }], repo_facts: [{ repo: 'tipjar', testnet_chains: ['arc'] }] },
      ctx,
    )) as { saved: string[]; agent_note: string };
    assert.equal(told.saved.length, 2);
    const after = (await tools.list_programs({ local_repos: [{ name: 'tipjar', chains: ['arc'] }] }, ctx)) as Listed;
    assert.doesNotMatch(after.show_to_builder, new RegExp(`Arc T3 ${stamp}`));
    assert.ok(!after.matches.some((m) => m.program_id === id1));
    assert.deepEqual(given?.said, { 'name:tipjar': { mainnet: [], testnet: ['arc'], live_url: null, has_users: null, not_mine: false } });
  } finally {
    await sql()`DELETE FROM installations WHERE id = ${id}`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${id1}`;
  }
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
    roundPoolsWei: async () => new Map(),
    repoCoins: async () => new Map(),
    matchProjects: async (input: { said?: Record<string, unknown> }) => {
      given = input;
      return { checked: 1, scored: 1, fits: [scoredFit('tipjar', 6, arcId)] };
    },
  };
  type Told = { show_to_builder?: string; saved: string[]; agent_note: string };
  type Listed = { show_to_builder: string; matches: { program_id: string }[] };
  try {
    // Builder A, on the shared agent.
    const told = (await tools.tell_earnkit(
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
    const b = (await tools.list_programs({ local_repos: [{ name: 'tipjar', chains: ['arc'] }] }, ctx)) as Listed;
    assert.match(b.show_to_builder, new RegExp(`Arc G6 ${stamp}`));
    assert.doesNotMatch(b.show_to_builder, /applied outside EarnKit/);
    assert.ok(b.matches.some((m) => m.program_id === arcId));
    assert.equal(given?.said, undefined);
    // An outcome without its entry is refused (the newest entry may be another builder's); with it, stored.
    await assert.rejects(
      tools.tell_earnkit({ program_status: [{ program_id: arcId, status: 'won' }] }, ctx),
      (err: Error) => err.constructor.name === 'NotFoundError' && /project_id/.test(err.message),
    );
    assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM entry_outcomes WHERE project_id = ${entry}`)[0].n, 0);
    const won = (await tools.tell_earnkit({ program_status: [{ program_id: arcId, status: 'won', project_id: entry }] }, ctx)) as Told;
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
    roundPoolsWei: async () => new Map(),
    repoCoins: async () => new Map(),
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
    await tools.list_programs({ local_repos: [{ name: 'secret-a-app', chains: ['arc'] }] }, s.ctx());
    assert.equal(s.calls.length, 1);
    const b = (await tools.list_programs({}, s.ctx())) as G7Listed;
    assert.equal(s.calls.length, 1, "B's call matched nothing (A's repos aren't B's)");
    assert.doesNotMatch(JSON.stringify(b), /secret-a-app/);
    assert.doesNotMatch(b.show_to_builder, /remember|shared|many builders/i);
    // Control: the same installation, not shared, does remember them.
    await tools.list_programs({}, s.ctx(false));
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
    const b = (await tools.list_programs({}, s.ctx())) as G7Listed;
    assert.ok(!('ask_outcome' in b));
    assert.doesNotMatch(JSON.stringify(b), /SecretA/);
    const [row] = await sql()<{ outcome_asked_at: Date | null }[]>`SELECT outcome_asked_at FROM projects WHERE id = ${entry}`;
    assert.equal(row.outcome_asked_at, null, 'not marked asked');
    // Control: not shared, the question is asked.
    const own = (await tools.list_programs({}, s.ctx(false))) as G7Listed;
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
    const b = (await tools.list_programs({}, s.ctx())) as G7Listed;
    assert.doesNotMatch(b.show_to_builder, /Your entries|Since you last checked|SecretA|you won/);
    const program = (await tools.get_program({ program_id: s.programId }, s.ctx())) as { since_you_last_checked?: string };
    assert.ok(!('since_you_last_checked' in program));
    // Control: not shared, A's entry and win show.
    const own = (await tools.list_programs({}, s.ctx(false))) as G7Listed;
    assert.match(own.show_to_builder, /Your entries: .*SecretA/);
    assert.match(own.show_to_builder, /you won/);
  } finally {
    await s.cleanup();
  }
});

test('4.A7/A8 list_programs remembers the best owned fit repos and records the rows shown; not on a shared client', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const arc = committedProgram('arc-microgrants');
  const pid = `t4-arc-${stamp}`;
  await upsertProgram(ProgramFile.parse({ ...arc, id: pid, title: `Arc T4 ${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' }));
  const facts = (name: string) => ({
    name, url: `https://github.com/alice/${name}`, homepage: 'https://tipjar.xyz', created_at: '2026-01-01T00:00:00Z',
    chains: { arc: { mainnet: true, testnet: false, evidence: 'x' } }, commits_in_window: {}, live_verified: true,
  });
  const fit = (name: string, score: number, missing: string[] = []) => ({
    ...scoredFit(name, score, pid),
    key: `alice/${name}`,
    product: { score, tier: score >= 5 ? 'product' : score >= 3 ? 'project' : 'noise', missing },
    live_verified: true,
    facts: facts(name),
  });
  const fits = [fit('tipjar', 6), fit('other', 6, ['owned']), fit('side', 4)];
  const ctxOf = (id: number, sharedClient = false) => ({
    installationId: id, sharedClient, roundPoolsWei: async () => new Map(), repoCoins: async () => new Map(),
    matchProjects: async () => ({ checked: 3, scored: 3, fits }),
  });
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`t4-fit-${stamp}`}) RETURNING id`;
  const [{ id: shared }] = await sql()<{ id: number }[]>`
    INSERT INTO installations (token_hash, shared_client) VALUES (${`t4-shared-${stamp}`}, true) RETURNING id`;
  try {
    await tools.list_programs({ local_repos: [{ name: 'tipjar', chains: ['arc'] }] }, ctxOf(id));
    const [row] = await sql()<{ fit_repos: { key: string }[] }[]>`SELECT fit_repos FROM installations WHERE id = ${id}`;
    // Owned only, the highest score first.
    assert.deepEqual(row.fit_repos.map((r) => r.key), ['alice/tipjar', 'alice/side']);
    const shown = await sql()<{ program_id: string; repo_key: string; product_score: number; row_level: string }[]>`
      SELECT program_id, repo_key, product_score, row_level FROM match_shown WHERE installation_id = ${id}`;
    assert.equal(shown.length, 1);
    assert.equal(shown[0].program_id, pid);
    assert.equal(shown[0].product_score, 6);
    // Ruling G7: a shared client keeps no fit repos (its alerts are off), but what was shown is recorded.
    await tools.list_programs({ local_repos: [{ name: 'tipjar', chains: ['arc'] }] }, ctxOf(shared, true));
    const [s] = await sql()<{ fit_repos: unknown[] }[]>`SELECT fit_repos FROM installations WHERE id = ${shared}`;
    assert.deepEqual(s.fit_repos, []);
  } finally {
    await sql()`DELETE FROM installations WHERE id IN (${id}, ${shared})`;
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${pid}`;
  }
});
