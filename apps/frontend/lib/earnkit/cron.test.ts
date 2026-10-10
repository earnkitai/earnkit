import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PAY_FAILED_RUNS, TERMS_CHANGED, bonusWaitsOnOwner, cronPost, nextStep, runCron, scoreMaxAge } from './cron';
import { sql } from './db';
import { MANUAL_CHECK, NOT_MAINNET, NO_PAYOUT_KEY, TOP_UP, dbPayoutStore, needsOwner, type PayoutRpc } from './payout';
import { RateLimitError } from './rate-limit';

const ENDS = new Date('2026-10-18T23:59:00Z');
const at = (min: number) => new Date(ENDS.getTime() + min * 60_000);

test('nextStep: score, freeze, review, wait, pay, done', () => {
  const s = (state: 'running' | 'review' | 'paying' | 'paid', now: Date, allFinal = false, reviewUntil: Date | null = null) =>
    nextStep({ state, now, endsAt: ENDS, reviewUntil, allFinal });
  assert.equal(s('running', at(-60)), 'score');
  assert.equal(s('running', at(-60), true), 'score');
  assert.equal(s('running', at(14)), 'score', 'explorer grace');
  assert.equal(s('running', at(16)), 'freeze');
  assert.equal(s('running', at(16), true), 'review');
  assert.equal(s('review', at(100), true, at(2900)), 'wait');
  assert.equal(s('review', at(2900), true, at(2900)), 'pay');
  assert.equal(s('paying', at(3000), true), 'pay');
  assert.equal(s('paid', at(3000), true), 'done');
});

test('I6 needsOwner: a manual check, changed terms, or a wallet short of the prize or of gas wait on the owner; other notes do not', () => {
  assert.equal(needsOwner(MANUAL_CHECK), true);
  assert.equal(needsOwner(`Paid entry #3. ${MANUAL_CHECK}`), true);
  assert.equal(needsOwner(TERMS_CHANGED), true);
  assert.equal(needsOwner(`The payout wallet 0xabc holds 0.5 MINI, less than the next prize (1). ${TOP_UP}`), true);
  assert.equal(needsOwner(`The payout wallet 0xabc needs a little ETH for gas. ${TOP_UP}`), true);
  assert.equal(needsOwner(NO_PAYOUT_KEY), true);
  assert.equal(needsOwner(NOT_MAINNET), true);
  for (const note of [null, undefined, '', 'Waiting for the transfer to entry #4 to be mined.', 'Payouts paused: a check failed; retrying hourly.'])
    assert.equal(needsOwner(note), false);
});

test('scoreMaxAge: 20 h, or 1 h in the last day', () => {
  assert.equal(scoreMaxAge(ENDS, at(-3 * 1440)), 20 * 3_600_000);
  assert.equal(scoreMaxAge(ENDS, at(-1439)), 3_600_000);
});

const SECRET = 'c'.repeat(40);
const req = (auth?: string) =>
  new Request('https://earnkit.com/api/cron', { method: 'POST', headers: { 'x-real-ip': '1.2.3.4', ...(auth && { authorization: auth }) } });

test('POST /api/cron: the secret is required (timing-safe), rate limited, and runs the jobs once', async () => {
  process.env.CRON_SECRET = SECRET;
  let runs = 0;
  const deps = { limit: async () => {}, run: async () => { runs++; return { ok: true }; } };
  assert.equal((await cronPost(req(), deps)).status, 401);
  assert.equal((await cronPost(req('Bearer nope'), deps)).status, 401);
  assert.equal(runs, 0);
  const ok = await cronPost(req(`Bearer ${SECRET}`), deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  assert.equal(runs, 1);
  // I6: a payout waiting on the owner fails the GitHub run (503, same body); a normal run is 200.
  const stuck = { needs_owner: ['c1'], campaigns: [{ id: 'c1', step: 'pay', note: MANUAL_CHECK }] };
  const paused = await cronPost(req(`Bearer ${SECRET}`), { ...deps, run: async () => stuck });
  assert.equal(paused.status, 503);
  assert.deepEqual(await paused.json(), stuck);
  assert.equal((await cronPost(req(`Bearer ${SECRET}`), { ...deps, run: async () => ({ needs_owner: [] }) })).status, 200);
  const limited = await cronPost(req(`Bearer ${SECRET}`), { ...deps, limit: async () => { throw new RateLimitError('Too many cron calls.', 60); } });
  assert.equal(limited.status, 429);
  assert.equal(runs, 1);
  delete process.env.CRON_SECRET;
});

test('the route is a plain POST wrapper (Next 16 route types) and the workflow posts the secret hourly', () => {
  const route = readFileSync(join(import.meta.dirname, '../../app/api/cron/route.ts'), 'utf8');
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(route, /\bGET\b/);
  const yml = readFileSync(join(import.meta.dirname, '../../../../.github/workflows/earnkit-cron.yml'), 'utf8');
  assert.match(yml, /cron: '15 \* \* \* \*'/);
  assert.match(yml, /curl -sS --fail-with-body/, 'a 503 fails the run and shows why');
  assert.match(yml, /Authorization: Bearer \$CRON_SECRET/);
  assert.match(yml, /CRON_SECRET: \$\{\{ secrets\.CRON_SECRET \}\}/);
});

// The lifecycle against a real database when one is configured (the local stack); skipped otherwise.
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const TOKEN = '0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07';
const account = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');
const campaign = {
  kind: 'earnkit',
  prize: { token: TOKEN, symbol: 'MINI', decimals: 18, chain: 'base' },
  winners: 2, amount_each: '3', prize_usd_total: 200, metric: 'unique_wallets', min_score: 1,
};
const result = (score: number, complete = true) => ({
  score, wallets: [], counted: [], seen: score, complete, timedOut: false, codeShare: null,
});

function chain(funds: () => bigint = () => 10n ** 30n) {
  const sent: Hex[] = [];
  const mined = new Set<Hex>();
  const rpc: PayoutRpc = {
    getChainId: async () => 8453,
    nonce: async () => sent.length,
    finalizedNonce: async () => sent.length,
    transaction: async (h) => mined.has(h),
    finalReceipt: async (h) => mined.has(h),
    fees: async () => ({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000n }),
    estimateGas: async () => 50_000n,
    receipt: async (h) => (mined.has(h) ? { status: 'success' } : null),
    broadcast: async (raw) => { sent.push(raw); mined.add(keccak256(raw)); return 'sent'; },
    waitFor: async (h) => (mined.has(h) ? { status: 'success' } : null),
    balanceOf: async () => funds(),
  };
  return { rpc, sent, mined };
}

async function setup(tag: string, n: number) {
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, campaign, starts_at, ends_at)
    VALUES (${tag}, 'o', 't', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown', ${sql().json(campaign as never)},
      ${new Date(ENDS.getTime() - 14 * 86_400_000)}, ${ENDS})`;
  const ids: number[] = [];
  for (let i = 1; i <= n; i++) {
    const [{ id }] = await sql()`
      INSERT INTO projects (program_id, name, repo_url, contracts, payout_wallet, submitted_at)
      VALUES (${tag}, ${'p' + i}, ${'https://github.com/a/' + tag + i}, ${[`0x${String(i).repeat(40)}`]},
        ${`0x${'e'.repeat(39)}${i}`}, ${new Date(Date.UTC(2026, 9, 6, i))})
      RETURNING id`;
    ids.push(id);
  }
  return ids;
}

async function teardown(tag: string) {
  await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
  await sql()`DELETE FROM campaign_runs WHERE program_id = ${tag}`;
  await sql()`DELETE FROM scoring_leases WHERE program_id = ${tag}`;
  await sql()`DELETE FROM programs WHERE id = ${tag}`;
}

const mine = (r: Awaited<ReturnType<typeof runCron>>, tag: string) => r.campaigns.find((c) => c.id === tag);

test('lifecycle: score, freeze and open the 48 h review in one call, wait, then pay the frozen winners once', db, async () => {
  const tag = `test-cron-${process.pid}-${Date.now()}`;
  const [a, b, c, d] = await setup(tag, 4);
  const scores: Record<string, ReturnType<typeof result>> = {
    [`0x${'1'.repeat(40)}`]: result(9), [`0x${'2'.repeat(40)}`]: result(8, false),
    [`0x${'3'.repeat(40)}`]: result(7), [`0x${'4'.repeat(40)}`]: result(6),
  };
  const f = chain();
  const deps = {
    score: { score: async (contracts: string[]) => scores[contracts[0]] },
    pay: { account, rpc: f.rpc, listed: async () => false },
    refreshFees: async () => 0,
  };
  const run = (now: Date) => runCron({ now, deps, only: [tag] });
  try {
    assert.deepEqual(mine(await run(at(-3 * 1440)), tag), { id: tag, step: 'score', scored: 4, failed: 0 });
    const rows = await sql()`SELECT score, score_attempted_at FROM projects WHERE program_id = ${tag} ORDER BY id`;
    assert.deepEqual(rows.map((r) => r.score), [9, 8, 7, 6]);
    assert.ok(rows.every((r) => r.score_attempted_at?.getTime() === at(-3 * 1440).getTime()), 'rotation needs the attempt time');
    // Fresh scores are not read again within 20 h.
    assert.deepEqual(mine(await run(at(-3 * 1440 + 60)), tag), { id: tag, step: 'score', scored: 0, failed: 0 });
    // Still inside the explorer grace: scoring, not freezing.
    assert.equal(mine(await run(at(14)), tag)!.step, 'score');
    assert.equal(f.sent.length, 0);

    // Ruling 16: the freeze pass opens the review in the same call; Ruling 20: the partial final score is flagged.
    const freeze = mine(await run(at(16)), tag)!;
    assert.deepEqual(freeze, { id: tag, step: 'freeze', final: 4, failed: 0, gave_up: [], review: true, partial: [b] });
    const [r1] = await sql()`SELECT state, frozen_at, review_until FROM campaign_runs WHERE program_id = ${tag}`;
    assert.equal(r1.state, 'review');
    assert.equal(r1.review_until.getTime(), at(16).getTime() + 48 * 3_600_000);
    assert.equal(f.sent.length, 0);

    // During the review: nothing is paid. A veto lands in the review.
    assert.deepEqual(mine(await run(at(16 + 47 * 60)), tag), { id: tag, step: 'wait' });
    await sql()`UPDATE projects SET vetoed_at = now(), veto_reason = 'test' WHERE id = ${a}`;
    assert.equal(f.sent.length, 0);

    // After the review: the vetoed entry is skipped; the partial one stays payable.
    const pay = mine(await run(at(16 + 48 * 60)), tag)!;
    assert.deepEqual(pay, { id: tag, step: 'pay', done: true, note: null });
    const paid = await sql()`
      SELECT id, payout_status, prize_tx, prize_raw_tx, prize_amount, prize_paid_at FROM projects
      WHERE program_id = ${tag} ORDER BY id`;
    assert.deepEqual(paid.map((p) => [p.id, p.payout_status, p.prize_amount]), [[a, null, null], [b, 'paid', '3'], [c, 'paid', '3'], [d, null, null]]);
    assert.deepEqual(paid.filter((p) => p.prize_tx).map((p) => p.prize_tx), f.sent.map((raw) => keccak256(raw)));
    // The signed bytes are kept once paid: a stuck send can be proven dead by its nonce (Ruling 33).
    assert.deepEqual(paid.filter((p) => p.prize_raw_tx).map((p) => keccak256(p.prize_raw_tx)), f.sent.map((raw) => keccak256(raw)));
    assert.equal(f.sent.length, 2);
    const [r2] = await sql()`SELECT state, note FROM campaign_runs WHERE program_id = ${tag}`;
    assert.deepEqual([r2.state, r2.note], ['paid', null]);

    // Paid campaigns are left alone: no second payout.
    assert.equal(mine(await run(at(16 + 49 * 60)), tag), undefined);
    assert.equal(f.sent.length, 2);
  } finally {
    await teardown(tag);
  }
});

test('Ruling 35: after the end, one unfinished entry per call gets the whole budget; 3 failed final attempts freeze it flagged partial', db, async () => {
  const tag = `test-cron-giveup-${process.pid}-${Date.now()}`;
  const [a, b] = await setup(tag, 2);
  const deps = {
    score: {
      score: async (contracts: string[]) => {
        if (contracts[0] === `0x${'2'.repeat(40)}`) throw new Error('Base explorer returned 502');
        return result(5);
      },
    },
    refreshFees: async () => 0,
  };
  const run = async (min: number) => mine(await runCron({ now: at(min), deps, only: [tag] }), tag);
  try {
    await sql()`UPDATE projects SET score = 4, scored_at = ${at(-60)}, scored_through = ${at(-60)} WHERE id = ${b}`;
    // Call 1: a has the whole budget and finishes; b is tried with what is left, so its failure is no strike.
    assert.deepEqual(await run(16), { id: tag, step: 'freeze', final: 1, failed: 1, gave_up: [], review: false, partial: [] });
    const attempts = async () => (await sql()`SELECT final_attempts FROM projects WHERE id = ${b}`)[0].final_attempts;
    assert.equal(await attempts(), 0);
    // Calls 2 and 3: b alone, full budget, fails: strikes 1 and 2; no 24 h clock, no review yet.
    assert.deepEqual(await run(76), { id: tag, step: 'freeze', final: 0, failed: 1, gave_up: [], review: false, partial: [] });
    assert.deepEqual(await run(16 + 1440 * 3), { id: tag, step: 'freeze', final: 0, failed: 1, gave_up: [], review: false, partial: [] });
    assert.equal(await attempts(), 2);
    const [r1] = await sql()`SELECT state FROM campaign_runs WHERE program_id = ${tag}`;
    assert.equal(r1.state, 'running');
    // Call 4: the third failed final attempt freezes b with its last score, flagged; the review opens.
    assert.deepEqual(await run(16 + 1440 * 3 + 60), { id: tag, step: 'freeze', final: 0, failed: 0, gave_up: [b], review: true, partial: [b] });
    const rows = await sql()`SELECT id, score, score_final, score_partial, score_error FROM projects WHERE program_id = ${tag} ORDER BY id`;
    assert.deepEqual(rows.map((r) => [r.id, r.score, r.score_final, r.score_partial]), [[a, 5, true, false], [b, 4, true, true]]);
    assert.equal(rows[0].score_error, null);
    assert.match(rows[1].score_error, /did not finish after 3 tries \(last: Base explorer returned 502\); the last score is shown/);
  } finally {
    await teardown(tag);
  }
});

test('M6: closing a campaign after its review opened never stops its payout; closed before that, it is skipped', db, async () => {
  const tag = `test-cron-closed-${process.pid}-${Date.now()}`;
  await setup(tag, 2);
  const f = chain();
  const deps = {
    score: { score: async (contracts: string[]) => result(contracts[0] === `0x${'1'.repeat(40)}` ? 9 : 8) },
    pay: { account, rpc: f.rpc, listed: async () => false },
    refreshFees: async () => 0,
  };
  const run = async (min: number) => mine(await runCron({ now: at(min), deps, only: [tag] }), tag);
  try {
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${tag}`;
    assert.equal(await run(-60), undefined, 'closed while running: skipped');
    await sql()`UPDATE programs SET status = 'active' WHERE id = ${tag}`;
    assert.equal((await run(16))!.review, true);
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${tag}`;
    assert.deepEqual(await run(16 + 48 * 60), { id: tag, step: 'pay', done: true, note: null });
    assert.equal(f.sent.length, 2);
  } finally {
    await teardown(tag);
  }
});

test('a campaign another call is advancing is skipped as busy; the payout key is never needed before the review ends', db, async () => {
  const tag = `test-cron-busy-${process.pid}-${Date.now()}`;
  await setup(tag, 1);
  try {
    await sql()`INSERT INTO scoring_leases (program_id, until) VALUES (${tag}, now() + interval '5 minutes')`;
    assert.deepEqual(mine(await runCron({ now: at(-60), deps: { refreshFees: async () => 0 }, only: [tag] }), tag), { id: tag, step: 'busy' });
  } finally {
    await teardown(tag);
  }
});

test('Ruling 5: token fees are refreshed only for wallets read over 6 h ago (or never), within the deadline', db, async () => {
  const tag = `test-cron-fees-${process.pid}-${Date.now()}`;
  const w = (n: number) => `0x${'c'.repeat(34)}${String(process.pid % 10_000).padStart(4, '0')}${String(n).padStart(2, '0')}`;
  const [stale, fresh, never] = [w(1), w(2), w(3)];
  await setup(tag, 0);
  try {
    for (const [i, wallet] of [stale, fresh, never].entries())
      await sql()`
        INSERT INTO projects (program_id, name, repo_url, token_url, creator_wallet)
        VALUES (${tag}, ${'t' + i}, ${'https://github.com/t/' + tag + i}, ${'https://tokens.fun/coin/' + tag + i}, ${wallet.toUpperCase().replace('0X', '0x')})`;
    await sql()`
      INSERT INTO token_fees (wallet, weth, usd, read_at) VALUES
        (${stale}, '0', 0, now() - interval '7 hours'), (${fresh}, '0', 0, now() - interval '1 hour')
      ON CONFLICT (wallet) DO UPDATE SET read_at = EXCLUDED.read_at`;
    const asked: string[] = [];
    const refreshFees = async (ws: string[]) => { asked.push(...ws); return ws.length; };
    const r = await runCron({ deps: { refreshFees }, only: [tag] });
    assert.ok(asked.includes(stale) && asked.includes(never), 'stale and never-read wallets are refreshed');
    assert.ok(!asked.includes(fresh), 'a wallet read within 6 h is not');
    assert.equal(r.fee_wallets, asked.length);
    asked.length = 0;
    await runCron({ budgetMs: 0, deps: { refreshFees }, only: [tag] });
    assert.deepEqual(asked, [], 'past the deadline nothing is read');
  } finally {
    await sql()`DELETE FROM token_fees WHERE wallet IN ${sql()([stale, fresh, never])}`;
    await teardown(tag);
  }
});

test('I2: the payout terms are frozen when the review opens; an edit pauses the payout and never changes the amount', db, async () => {
  const tag = `test-cron-terms-${process.pid}-${Date.now()}`;
  const [a, b] = await setup(tag, 2);
  let funds = 3n * 10n ** 18n; // one prize of 3
  const f = chain(() => funds - 3n * 10n ** 18n * BigInt(f.sent.length));
  const deps = {
    score: { score: async (contracts: string[]) => result(contracts[0] === `0x${'1'.repeat(40)}` ? 9 : 8) },
    pay: { account, rpc: f.rpc, listed: async () => false },
    refreshFees: async () => 0,
  };
  const run = async (now: Date) => mine(await runCron({ now, deps, only: [tag] }), tag)!;
  try {
    assert.equal((await run(at(16))).review, true);
    const [r0] = await sql()`SELECT terms FROM campaign_runs WHERE program_id = ${tag}`;
    assert.deepEqual(r0.terms, { token: TOKEN, symbol: 'MINI', decimals: 18, amount_each: '3', winners: 2, min_score: 1 });
    const firstOut = await runCron({ now: at(16 + 2880), deps, only: [tag] });
    const first = mine(firstOut, tag)!;
    assert.match(String(first.note), /less than the next prize \(3\)/);
    assert.deepEqual(firstOut.needs_owner, [tag], 'a wallet short of the prize waits on the owner (503)');
    // The program file changes mid-payout: nothing more is sent, and the page says why.
    await sql()`UPDATE programs SET campaign = jsonb_set(campaign, '{amount_each}', '"30"') WHERE id = ${tag}`;
    funds += 100n * 10n ** 18n;
    const pausedOut = await runCron({ now: at(16 + 2940), deps, only: [tag] });
    const paused = mine(pausedOut, tag)!;
    assert.deepEqual(pausedOut.needs_owner, [tag], 'I6: changed terms wait on the owner (503)');
    assert.deepEqual([paused.done, paused.note], [false, "Payout paused: the campaign's prize terms changed after the review opened."]);
    assert.equal(f.sent.length, 1);
    const [r1] = await sql()`SELECT state, note FROM campaign_runs WHERE program_id = ${tag}`;
    assert.deepEqual([r1.state, r1.note], ['paying', paused.note]);
    // Put back: it resumes at the frozen amount; prize_amount matches what was signed.
    await sql()`UPDATE programs SET campaign = jsonb_set(campaign, '{amount_each}', '"3"') WHERE id = ${tag}`;
    assert.equal((await run(at(16 + 3000))).done, true);
    const rows = await sql()`SELECT id, prize_amount FROM projects WHERE program_id = ${tag} ORDER BY id`;
    assert.deepEqual(rows.map((r) => [r.id, r.prize_amount]), [[a, '3'], [b, '3']]);
    const amounts = f.sent.map((raw) => decodeFunctionData({ abi: erc20Abi, data: parseTransaction(raw).data! }).args![1]);
    assert.deepEqual(amounts, [3n * 10n ** 18n, 3n * 10n ** 18n]);
  } finally {
    await teardown(tag);
  }
});

test('M2/M3: a failing pay step answers with a fixed error and a sanitized note (no RPC URL leaks)', db, async () => {
  const tag = `test-cron-err-${process.pid}-${Date.now()}`;
  await setup(tag, 1);
  const secretUrl = 'https://base-mainnet.example/v2/SECRETKEY';
  const deps = {
    score: { score: async () => result(5) },
    pay: { account, rpc: chain().rpc, listed: async () => { throw new Error(`fetch failed: ${secretUrl}`); } },
    refreshFees: async () => 0,
  };
  try {
    await runCron({ now: at(16), deps, only: [tag] });
    const out = await runCron({ now: at(16 + 2880), deps, only: [tag] });
    assert.deepEqual(mine(out, tag), { id: tag, step: 'error', note: 'This step failed; it is retried on the next run.', pay_failures: 1 });
    assert.doesNotMatch(JSON.stringify(out), /SECRETKEY/);
    const [r] = await sql()`SELECT state, note FROM campaign_runs WHERE program_id = ${tag}`;
    assert.deepEqual([r.state, r.note], ['paying', 'Payouts paused: a check failed; retrying hourly.']);
  } finally {
    await teardown(tag);
  }
});

test('M2: when the whole run fails, the response is a fixed error (the Actions log never sees the cause)', async () => {
  process.env.CRON_SECRET = SECRET;
  const res = await cronPost(req(`Bearer ${SECRET}`), {
    limit: async () => {},
    run: async () => { throw new Error('connect ECONNREFUSED postgres://user:pw@db:5432'); },
  });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'The cron run failed; see the server log.' });
  delete process.env.CRON_SECRET;
});

test('Ruling 32 minor: with changed terms, a transfer in flight is still recorded as paid (frozen amount); nothing new is signed', db, async () => {
  const tag = `test-cron-follow-${process.pid}-${Date.now()}`;
  const [a, b] = await setup(tag, 2);
  const f = chain();
  const deps = {
    score: { score: async (contracts: string[]) => result(contracts[0] === `0x${'1'.repeat(40)}` ? 9 : 8) },
    pay: { account, rpc: f.rpc, listed: async () => false },
    refreshFees: async () => 0,
  };
  try {
    await runCron({ now: at(16), deps, only: [tag] });
    const raw = await account.signTransaction({
      chainId: 8453, type: 'eip1559', to: TOKEN as Hex, nonce: 0, gas: 60_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [`0x${'e'.repeat(39)}1`, 3n * 10n ** 18n] }),
    });
    assert.equal(await dbPayoutStore.sending(a, keccak256(raw), raw), true);
    f.mined.add(keccak256(raw));
    await sql()`UPDATE programs SET campaign = jsonb_set(campaign, '{amount_each}', '"30"') WHERE id = ${tag}`;
    const paused = mine(await runCron({ now: at(16 + 2880), deps, only: [tag] }), tag)!;
    assert.equal(paused.note, "Payout paused: the campaign's prize terms changed after the review opened.");
    const rows = await sql()`SELECT id, payout_status, prize_amount, prize_tx FROM projects WHERE program_id = ${tag} ORDER BY id`;
    assert.deepEqual(rows.map((r) => [r.id, r.payout_status, r.prize_amount]), [[a, 'paid', '3'], [b, null, null]]);
    assert.equal(rows[0].prize_tx, keccak256(raw));
    assert.equal(f.sent.length, 0);
  } finally {
    await teardown(tag);
  }
});

test('Ruling 32: the store keeps the first stale time, and a new signature or a clear resets it', db, async () => {
  const tag = `test-cron-stale-${process.pid}-${Date.now()}`;
  const [a] = await setup(tag, 1);
  const t1 = new Date('2026-10-21T01:00:00Z');
  try {
    await dbPayoutStore.stale(a, t1); // not sending: no effect
    await dbPayoutStore.sending(a, `0x${'1'.repeat(64)}`, '0x01');
    await dbPayoutStore.stale(a, t1);
    await dbPayoutStore.stale(a, new Date('2026-10-21T02:00:00Z'));
    const [r1] = await sql()`SELECT payout_status, payout_stale_at FROM projects WHERE id = ${a}`;
    assert.deepEqual([r1.payout_status, r1.payout_stale_at.getTime()], ['sending', t1.getTime()]);
    await dbPayoutStore.stale(a, null); // a later send was accepted (Ruling 33)
    const [r1b] = await sql()`SELECT payout_status, payout_stale_at FROM projects WHERE id = ${a}`;
    assert.deepEqual([r1b.payout_status, r1b.payout_stale_at], ['sending', null]);
    await dbPayoutStore.stale(a, t1);
    assert.equal(await dbPayoutStore.failed(a, false), 0);
    const [r2] = await sql()`SELECT payout_status, prize_tx, payout_stale_at, payout_reverts FROM projects WHERE id = ${a}`;
    assert.deepEqual([r2.payout_status, r2.prize_tx, r2.payout_stale_at, r2.payout_reverts], [null, null, null, 0]);
  } finally {
    await teardown(tag);
  }
});

test('M6: a campaign closed after it ended but before its review is still frozen and paid; a never-launched one is never picked up', db, async () => {
  const tag = `test-cron-closed-end-${process.pid}-${Date.now()}`;
  const never = `test-cron-never-${process.pid}-${Date.now()}`;
  await setup(tag, 2);
  await setup(never, 1);
  const f = chain();
  const deps = {
    score: { score: async (contracts: string[]) => result(contracts[0] === `0x${'1'.repeat(40)}` ? 9 : 8) },
    pay: { account, rpc: f.rpc, listed: async () => false },
    refreshFees: async () => 0,
  };
  const run = async (min: number) => mine(await runCron({ now: at(min), deps, only: [tag, never] }), tag);
  try {
    // Never active: no run row, so closed it is skipped, even after its end.
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${never}`;
    // The campaign ran while active (its run row exists), then is closed after its end, before the freeze.
    assert.equal((await run(-60))!.step, 'score');
    await sql()`UPDATE programs SET status = 'closed' WHERE id = ${tag}`;
    const frozen = await runCron({ now: at(16), deps, only: [tag, never] });
    assert.equal(mine(frozen, tag)!.review, true, 'freeze and review still happen');
    assert.equal(mine(frozen, never), undefined, 'never launched: skipped');
    assert.deepEqual(await run(16 + 48 * 60), { id: tag, step: 'pay', done: true, note: null });
    assert.equal(f.sent.length, 2);
    const [none] = await sql()`SELECT count(*)::int AS n FROM campaign_runs WHERE program_id = ${never}`;
    assert.equal(none.n, 0);
  } finally {
    await teardown(tag);
    await teardown(never);
  }
});

test(`a pay step failing ${PAY_FAILED_RUNS} runs in a row waits on the owner (503); a completed step resets the count`, db, async () => {
  const tag = `test-cron-payfail-${process.pid}-${Date.now()}`;
  await setup(tag, 1);
  let broken = true;
  const deps = {
    score: { score: async () => result(5) },
    pay: { account, rpc: chain().rpc, listed: async () => { if (broken) throw new Error('screen down'); return false; } },
    refreshFees: async () => 0,
  };
  const failures = async () => (await sql()`SELECT pay_failures FROM campaign_runs WHERE program_id = ${tag}`)[0].pay_failures;
  try {
    await runCron({ now: at(16), deps, only: [tag] });
    for (let i = 1; i < PAY_FAILED_RUNS; i++) {
      const out = await runCron({ now: at(16 + 2880 + i * 60), deps, only: [tag] });
      assert.equal(mine(out, tag)!.pay_failures, i);
      assert.deepEqual(out.needs_owner, [], `${i} failed runs: still green`);
    }
    const sixth = await runCron({ now: at(16 + 2880 + PAY_FAILED_RUNS * 60), deps, only: [tag] });
    assert.deepEqual(sixth.needs_owner, [tag], 'six in a row: the owner is emailed');
    assert.equal(await failures(), PAY_FAILED_RUNS);
    const [r] = await sql()`SELECT state, note FROM campaign_runs WHERE program_id = ${tag}`;
    assert.deepEqual([r.state, r.note], ['paying', 'Payouts paused: a check failed; retrying hourly.']);
    broken = false;
    const ok = await runCron({ now: at(16 + 3600), deps, only: [tag] });
    assert.deepEqual(mine(ok, tag), { id: tag, step: 'pay', done: true, note: null });
    assert.deepEqual(ok.needs_owner, []);
    assert.equal(await failures(), 0, 'reset on a completed step');
  } finally {
    await teardown(tag);
  }
});

test('the payout key unset or BASE_RPC_URL off Base mainnet wait on the owner (503); nothing is sent', db, async () => {
  const tag = `test-cron-misconf-${process.pid}-${Date.now()}`;
  await setup(tag, 1);
  const f = chain();
  const base = { score: { score: async () => result(5) }, refreshFees: async () => 0 };
  try {
    await runCron({ now: at(16), deps: base, only: [tag] });
    const noKey = await runCron({ now: at(16 + 2880), deps: { ...base, pay: { account: null, rpc: f.rpc, listed: async () => false } }, only: [tag] });
    assert.deepEqual(mine(noKey, tag), { id: tag, step: 'pay', done: false, note: NO_PAYOUT_KEY });
    assert.deepEqual(noKey.needs_owner, [tag]);
    const wrong = { ...f.rpc, getChainId: async () => 1 };
    const offChain = await runCron({ now: at(16 + 2940), deps: { ...base, pay: { account, rpc: wrong, listed: async () => false } }, only: [tag] });
    assert.deepEqual(mine(offChain, tag), { id: tag, step: 'pay', done: false, note: NOT_MAINNET });
    assert.deepEqual(offChain.needs_owner, [tag]);
    const [r] = await sql()`SELECT state, note FROM campaign_runs WHERE program_id = ${tag}`;
    assert.deepEqual([r.state, r.note], ['paying', NOT_MAINNET]);
    assert.equal(f.sent.length, 0);
  } finally {
    await teardown(tag);
  }
});

test('v2.9 D17 bonusWaitsOnOwner: a low gas balance, or a claim or collect out of gas, waits on the owner; other results do not', () => {
  const ok = { index_failures: 0, sweep: { result: 'nothing to sweep' } };
  assert.equal(bonusWaitsOnOwner(undefined), false);
  assert.equal(bonusWaitsOnOwner(ok), false);
  assert.equal(bonusWaitsOnOwner({ ...ok, gas: { balance_wei: '1', low: true, note: `low. ${TOP_UP}` } }), true);
  assert.equal(bonusWaitsOnOwner({ ...ok, gas: { low: false, note: 'unread' } }), false, 'an unread balance never blocks');
  const gasOut = 'the payout wallet needs ETH for gas';
  assert.equal(bonusWaitsOnOwner({ ...ok, claim: [{ owner: '0x1', result: 'nothing to claim' }, { owner: '0x2', result: gasOut }] }), true);
  assert.equal(bonusWaitsOnOwner({ ...ok, collect: [{ coin: '0x1', result: gasOut }] }), true);
  assert.equal(bonusWaitsOnOwner({ ...ok, claim_others: [{ owner: '0x3', result: 'next run' }, { owner: '0x4', result: gasOut }] }), true);
  assert.equal(bonusWaitsOnOwner({ ...ok, claim_others: [{ owner: '0x3', result: 'next run' }] }), false);
  assert.equal(bonusWaitsOnOwner({ ...ok, claim: [{ owner: '0x1', result: 'failed' }], collect: 'waiting on a stored send' }), false);
  // Unchanged: the sweep's TOP_UP note and INDEX_FAILED_RUNS failed index steps.
  assert.equal(bonusWaitsOnOwner({ ...ok, sweep: { result: `${gasOut}. ${TOP_UP}` } }), true);
  assert.equal(bonusWaitsOnOwner({ ...ok, index_failures: 6 }), true);
});

// ---- v2.10 item 13: the deployer's gas

test('v2.10.3 DEPLOY_CHAINS=base: the cron reads Base only and never lists deployer-gas:arc', db, async () => {
  const reads: string[] = [];
  const chainOf = (c: 'arc' | 'base') => ({
    balance: async () => {
      reads.push(c);
      return 0n; // empty on both: only an enabled chain may be flagged
    },
  }) as unknown as import('./deploy').DeployChain;
  const deps = { refreshFees: async () => 0, deployer: { chain: chainOf, usdPerNative: async () => 1 } };
  const tag = `t1003-gas-${process.pid}`;
  const names = ['DEPLOYER_PRIVATE_KEY', 'DEPLOY_CHAINS'] as const;
  const old = names.map((n) => process.env[n]);
  process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
  process.env.DEPLOY_CHAINS = 'base';
  try {
    const on = await runCron({ deps, only: [tag] });
    assert.deepEqual(reads, ['base']);
    assert.ok(on.needs_owner.includes('deployer-gas:base'));
    assert.ok(!on.needs_owner.some((k) => k.endsWith(':arc')), on.needs_owner.join(','));
  } finally {
    names.forEach((n, i) => (old[i] === undefined ? delete process.env[n] : (process.env[n] = old[i])));
  }
});

test('10.12 deployerGas: with the deployer on, each balance is read once a run and a chain under $0.25 is TOP_UP; off, no read', db, async () => {
  const reads: string[] = [];
  const chainOf = (c: 'arc' | 'base') => ({
    balance: async () => {
      reads.push(c);
      return c === 'base' ? 2n * 10n ** 17n : 5n * 10n ** 18n; // $0.20 and $5 at $1 a coin
    },
  }) as unknown as import('./deploy').DeployChain;
  const deps = { refreshFees: async () => 0, deployer: { chain: chainOf, usdPerNative: async () => 1 } };
  const tag = `t10-gas-${process.pid}`;
  const old = process.env.DEPLOYER_PRIVATE_KEY;
  try {
    const off = await runCron({ deps, only: [tag] });
    assert.deepEqual(reads, []);
    assert.ok(!off.needs_owner.some((k) => k.startsWith('deployer-gas:')));
    process.env.DEPLOYER_PRIVATE_KEY = '5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
    const on = await runCron({ deps, only: [tag] });
    assert.deepEqual(reads.sort(), ['arc', 'base']);
    assert.ok(on.needs_owner.includes('deployer-gas:base'));
    assert.ok(!on.needs_owner.includes('deployer-gas:arc'));
    assert.deepEqual((on as { deployer_gas?: unknown }).deployer_gas, { arc: { usd: 5 }, base: { usd: 0.2, note: 'TOP_UP' } });
  } finally {
    if (old === undefined) delete process.env.DEPLOYER_PRIVATE_KEY;
    else process.env.DEPLOYER_PRIVATE_KEY = old;
  }
});

// ---- v2.11 T11: the usage checks run inside this cron

test('11.5 runCron: the usage step reports its counts; a failed read never breaks the run (200, no needs_owner)', db, async () => {
  const { EVENT_LOG_FLAG, recordEvent } = await import('./events');
  const before = process.env[EVENT_LOG_FLAG];
  process.env[EVENT_LOG_FLAG] = 'on';
  process.env.CRON_SECRET = SECRET;
  try {
    const now = new Date();
    const key = `deployed:t11-cron-${process.pid}-${Date.now()}`;
    assert.equal(
      await recordEvent({ type: 'deployed', dedupe_key: key, at: new Date(now.getTime() - 31 * 86_400_000), chain: 'base', detail: { address: '0x' + '5e'.repeat(20) } }),
      true,
    );
    const [{ id }] = await sql()<{ id: string }[]>`SELECT id::text FROM builder_events WHERE dedupe_key = ${key}`;
    let reads = 0;
    const usage = {
      only: [id],
      getCode: async () => {
        reads++;
        throw new Error('rpc down');
      },
    };
    const tag = `t11-cron-${process.pid}`;
    const run = () => runCron({ now, deps: { refreshFees: async () => 0, usage }, only: [tag] });
    const res = await cronPost(req(`Bearer ${SECRET}`), { limit: async () => {}, run });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { usage_checks?: unknown; needs_owner: string[] };
    assert.deepEqual(body.usage_checks, { checked: 0, failed: 1 });
    assert.deepEqual(body.needs_owner, []);
    assert.equal(reads, 1, 'one read a run, no retry loop');
    const ok = await runCron({ now, deps: { refreshFees: async () => 0, usage: { ...usage, getCode: async () => '0x6080', blockscout: async () => ({ transactions_count: '4' }) } }, only: [tag] });
    assert.deepEqual((ok as { usage_checks?: unknown }).usage_checks, { checked: 1, failed: 0 });
    // Without its deps, a run limited to other programs (tests, the e2e) skips the step.
    const skipped = await runCron({ now, deps: { refreshFees: async () => 0 }, only: [tag] });
    assert.equal((skipped as { usage_checks?: unknown }).usage_checks, undefined);
  } finally {
    if (before === undefined) delete process.env[EVENT_LOG_FLAG];
    else process.env[EVENT_LOG_FLAG] = before;
    delete process.env.CRON_SECRET;
  }
});
