import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, parseTransaction, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { cronPost, nextStep, runCron, scoreMaxAge } from './cron';
import { sql } from './db';
import { dbPayoutStore, type PayoutRpc } from './payout';
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
    confirmedNonce: async () => sent.length,
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
    assert.deepEqual(freeze, { id: tag, step: 'freeze', final: 4, failed: 0, review: true, partial: [b] });
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
    assert.ok(paid.every((p) => p.prize_raw_tx === null));
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

test('freeze: an entry that cannot be scored is frozen with its last score after 24 h, then the review opens', db, async () => {
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
  try {
    await sql()`UPDATE projects SET score = 4, scored_at = ${at(-60)}, scored_through = ${at(-60)} WHERE id = ${b}`;
    assert.deepEqual(mine(await runCron({ now: at(16), deps, only: [tag] }), tag), { id: tag, step: 'freeze', final: 1, failed: 1, review: false, partial: [] });
    const [r1] = await sql()`SELECT state FROM campaign_runs WHERE program_id = ${tag}`;
    assert.equal(r1.state, 'running');
    const later = mine(await runCron({ now: at(16 + 1440), deps, only: [tag] }), tag);
    assert.deepEqual(later, { id: tag, step: 'freeze', final: 0, failed: 1, review: true, partial: [] });
    const rows = await sql()`SELECT id, score, score_final, score_error FROM projects WHERE program_id = ${tag} ORDER BY id`;
    assert.deepEqual(rows.map((r) => [r.id, r.score, r.score_final, r.score_error]), [[a, 5, true, null], [b, 4, true, 'Base explorer returned 502']]);
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
    const first = await run(at(16 + 2880));
    assert.match(String(first.note), /less than the next prize \(3\)/);
    // The program file changes mid-payout: nothing more is sent, and the page says why.
    await sql()`UPDATE programs SET campaign = jsonb_set(campaign, '{amount_each}', '"30"') WHERE id = ${tag}`;
    funds += 100n * 10n ** 18n;
    const paused = await run(at(16 + 2940));
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
    assert.deepEqual(mine(out, tag), { id: tag, step: 'error', note: 'This step failed; it is retried on the next run.' });
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
    assert.equal(await dbPayoutStore.failed(a, false), 0);
    const [r2] = await sql()`SELECT payout_status, prize_tx, payout_stale_at, payout_reverts FROM projects WHERE id = ${a}`;
    assert.deepEqual([r2.payout_status, r2.prize_tx, r2.payout_stale_at, r2.payout_reverts], [null, null, null, 0]);
  } finally {
    await teardown(tag);
  }
});
