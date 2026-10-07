import { SafeFetchError } from './safe-fetch';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SponsorCampaignInput, tools } from './tools';
import { sql } from './db';
import { EntryError } from './campaigns';
import { earnkitTexts } from './campaign-text';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { setSanctionsOracle } from './sanctions';
import { tokenLineFor } from './token-gate';
import { REPO_HELD } from './entry-text';
import { endsOf } from './present';
import type { TokenFlowDeps } from './token-launch';
import { committedProgram } from './fixtures/program-file';

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

// Against the local database when configured.
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

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
  const project = { name: 'Tip Jar', description: 'Tips for creators', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar.example' };
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
  const project = { name: 'Tip Jar', description: 'Tips', repo_url: 'https://github.com/alice/tipjar', live_url: 'https://tipjar.example' };
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
    // Every required answer: the Token row (a token on Base) and the wallet line.
    const ready = await prep({ name: 'TipJar', repo_url: `https://github.com/alice/tipjar-${stamp}`, live_url: 'https://tipjar.example' }, answers);
    assert.equal(ready.ready, true);
    assert.match(ready.show_to_builder, /\| Token \| Your entry gets a token on Base, \$TIPJAR: /);
    assert.equal(ready.shown_wallet, W);
    assert.ok(tickerChecks > 0);
    // No project name, but a GitHub repo: the repo name is the name.
    const noName = await prep({ repo_url: 'https://github.com/a/tipjar', live_url: 'https://tipjar.example' }, answers);
    assert.equal(noName.token?.proposed.symbol, 'TIPJAR');
    // Fix round 1 (Minor 6): the Entry row names the repo, as the token does.
    assert.match(noName.show_to_builder, /^\| Entry \| Tipjar for /);
    assert.match(noName.show_to_builder, /\| Token \| Your entry gets a token on Base, \$TIPJAR: /);
    // C5: an item given but invalid says "(check it)"; at most 3 items, then "and N more".
    const bad = await prep({ name: 'TipJar' }, { live_deployment_url: 'not a link' });
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
    assert.match(text, new RegExp(`\\| Proof ${run} \\|`));
    assert.match(text, new RegExp(`\\| No proof ${run} \\|`));
    assert.match(text, /Plus the builder bonus: the top 10 on each program also get paid in ETH\. 0\.42 ETH so far\.$/);
    assert.match(text, /\n\nIdeas I can build:\n- /);
    assert.ok(text.includes(`\n- Proof ${run}: ${proof.ideas[0]}\n- Proof ${run}: ${proof.ideas[1]}\n`), text);
    assert.ok(text.includes(`\n- No proof ${run}: ${noProof.ideas[0]}\n- No proof ${run}: ${noProof.ideas[1]}\n`), text);
    // Without injection: no pools yet, so the provable program's bonus sentence is the empty-pool one.
    const plain = (await tools.list_programs({}, { installationId: id })) as { show_to_builder: string };
    assert.match(plain.show_to_builder, /Plus the builder bonus: the top 10 on each program also get paid in ETH\.$/);
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
    project: { name: `Tip Jar ${n}`, description: 'Tips', repo_url: `https://github.com/alice/t4-${stamp}-${n}`, live_url: `https://t4-${n}.example` },
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
    project: { name, repo_url, live_url: 'https://tipjar.example' },
    answers: { description: 'Tips', builder_profile: 'https://github.com/alice' },
  });
  try {
    // 1. An entry naming a wallet (the builder skipped the coin): remembered for the installation.
    const id = await inst('one');
    const skipped = (await tools.record_submission(entry(a.id, 1, { payout_wallet: W, token: 'skip' }), { installationId: id, roundPoolsWei: pools })) as {
      recorded: boolean;
      show_to_builder: string;
    };
    assert.equal(skipped.recorded, true);
    assert.equal(skipped.show_to_builder, `Entered in ${a.title}.`, 'skipped: no coin, no bonus line');
    // 2. The next prepare_submission, on another non-campaign program, prefills it.
    const prep = (await tools.prepare_submission({ program_id: b.id, ...ready() }, { installationId: id })) as {
      show_to_builder: string;
      token: { creator_wallet: string | null };
    };
    assert.equal(prep.token.creator_wallet, W);
    assert.match(prep.show_to_builder, /\| Token \| Your entry gets a token on Base, Tip Jar \(\$TIP\): /);
    assert.ok(prep.show_to_builder.includes(`Wallet for fees and any bonus: ${W} (used last time) — or tell me another.`), prep.show_to_builder);
    assert.equal(prep.show_to_builder.split(W).length, 2, 'the full wallet once, on the wallet line');
    // A wallet given in this call is not "from last time".
    const OTHER = '0x' + 'f'.repeat(39) + '4';
    const given = (await tools.prepare_submission({ program_id: b.id, ...ready(), answers: { ...ready().answers, payout_wallet: OTHER } }, { installationId: id })) as {
      show_to_builder: string;
    };
    assert.ok(given.show_to_builder.includes(`Wallet for fees and any bonus: ${OTHER} — or tell me another.`));
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
    assert.deepEqual(r.bonus_round, { key: `${a.id}:2026-09-16`, ends_at: '2099-01-01T00:00:00.000Z', ends_label: 'Oct 14' });
    assert.equal(r.bonus_round!.ends_label, endsOf({ summary: a.summary, ends_at: new Date(a.ends_at) }));
    // The agent's note names the tool; the builder's text never does.
    assert.equal(r.token.note, 'No token yet: no wallet was given.');
    assert.equal((r.token as { agent_note?: string }).agent_note, 'No token yet: no wallet was given. When the builder replies with a wallet, call launch_token with the wallet as creator_wallet by Oct 14.');
    assert.equal(
      r.show_to_builder,
      `Entered in ${a.title}. Reply with a wallet to get your token and join the builder bonus (0.18 ETH so far · ends Oct 14 · earnkit.com/bonus/${a.id}-2026-09-16).`,
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
      /^Entered in .*\. Your token: tokens\.fun\/coin\/0xT · you earn 40% of its fees\.\nSend me your dorahacks\.io entry link to join the builder bonus \(0\.18 ETH so far · ends Oct 14 · earnkit\.com\/bonus\/.+\)\.$/,
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
    assert.match(late.show_to_builder, /^Entered in .*\. Your token: tokens\.fun\/coin\/0xT · you earn 40% of its fees\.\nBuilder bonus: 0\.18 ETH so far · ends Oct 14 · /);
    assert.equal(await count(), 1, 'one entry, not two');
    const [basis] = await sql()<{ submission_basis: string | null }[]>`SELECT submission_basis FROM projects WHERE id = ${ok.project_id}`;
    assert.equal(basis.submission_basis, 'unverified_page');
    assert.equal((await sql()<{ payout_wallet: string }[]>`SELECT payout_wallet FROM installations WHERE id = ${two}`)[0].payout_wallet, B);

    // 5. Final review M1: another installation enters the same repo here while that eligible entry
    // holds it: one plain line, no bonus line, no wallet ask, and the agent is never told to launch.
    type Held = { repo_held?: boolean; bonus_round: unknown; show_to_builder: string; token: { note?: string } };
    const sameRepo = (n: number) =>
      entry(a.id, 4, { project: { name: `Tip Jar ${n}`, description: 'Tips', repo_url: repoUrl(4), live_url: 'https://t4-4.example' }, token: { name: 'TipJar', symbol: 'TIPJAR' }, builder_confirmed: true });
    const held = (await tools.record_submission(sameRepo(5), { installationId: await inst('three'), roundPoolsWei: pools })) as Held;
    assert.equal(held.repo_held, true);
    assert.equal(held.bonus_round, null);
    assert.equal(held.show_to_builder, `Entered in ${a.title}. ${REPO_HELD}`);
    assert.doesNotMatch(held.token.note ?? '', /launch_token|creator_wallet/);
    assert.match((held as { bonus_note?: string }).bonus_note ?? '', new RegExp(`entry #${ok.project_id} already holds this repo`));
    // The repo's coin is on an entry here that isn't eligible yet (no counting submission): still held.
    await sql()`UPDATE projects SET submission_proof_ok_at = NULL, token_repo_key = ${`github.com/alice/t4-${stamp}-4`} WHERE id = ${ok.project_id}`;
    const coinHeld = (await tools.record_submission(sameRepo(6), { installationId: await inst('four'), roundPoolsWei: pools })) as Held;
    assert.equal(coinHeld.repo_held, true);
    assert.equal(coinHeld.bonus_round, null);
    assert.equal(coinHeld.show_to_builder, `Entered in ${a.title}. ${REPO_HELD}`);
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
    assert.ok(shownPrep.show_to_builder.includes(`${SHOWN} (used last time)`));
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
  } finally {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});

test('C7: record_submission and launch_token launch no token until the entry has every required item', dbTest, async () => {
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
    // No live link and no builder profile: entered, but no token, and the builder reads why.
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
    )) as { recorded: boolean; project_id: number; token: { status: string; note: string; agent_note: string }; show_to_builder: string };
    assert.equal(r.recorded, true);
    assert.equal(r.token.status, 'skipped');
    assert.equal(r.token.note, 'Not launched: the entry still needs a live link on Arc mainnet; a public builder profile.');
    assert.match(r.token.agent_note, /live_deployment_url, builder_profile/);
    assert.match(r.show_to_builder, /Your token isn't launched yet: the entry still needs a live link on Arc mainnet; a public builder profile/);
    assert.doesNotMatch(r.show_to_builder, /launch_token|record_submission|live_url|\bcoin\b|Clanker/);
    assert.equal(deploys.length, 0);
    assert.deepEqual(checks, [], 'no tokens.fun ticker check while not ready');
    // The confirmed name and ticker are kept for later.
    const [row] = await sql()<{ token_name: string; token_symbol: string; token_status: string }[]>`
      SELECT token_name, token_symbol, token_status FROM projects WHERE id = ${r.project_id}`;
    assert.deepEqual({ ...row }, { token_name: 'Tip Jar', token_symbol: 'TIPJAR', token_status: 'skipped' });

    // launch_token with the live link: the stored answers still lack the profile, so it fails.
    const l = (await tools.launch_token(
      { project_id: r.project_id, builder_confirmed: true, live_url: 'https://tipjar.example' },
      ctx,
    )) as { status: string; note: string };
    assert.equal(l.status, 'failed');
    assert.equal(l.note, 'Not launched: the entry still needs a public builder profile.');
    assert.equal(deploys.length, 0);

    // Recorded again with every answer: ready, so the token launches with the kept ticker.
    const again = (await tools.record_submission(
      {
        program_id: p.id,
        project: { name: 'Tip Jar', repo_url: repo, live_url: 'https://tipjar.example' },
        submission_data: { description: 'Tips', builder_profile: 'https://github.com/alice' },
        payout_wallet: W,
        token: { name: 'Tip Jar', symbol: 'TIPJAR' },
        builder_confirmed: true,
      },
      ctx,
    )) as { project_id: number; token: { status: string } };
    assert.equal(again.project_id, r.project_id, 'the same entry, updated');
    assert.equal(again.token.status, 'launched');
    assert.deepEqual(deploys.map((d) => d.symbol), ['TIPJAR']);
  } finally {
    if (secret === undefined) delete process.env.EARNKIT_AUTH_SECRET;
    else process.env.EARNKIT_AUTH_SECRET = secret;
    if (key === undefined) delete process.env.TOKENSFUN_DEPLOY_API_KEY;
    else process.env.TOKENSFUN_DEPLOY_API_KEY = key;
  }
});
