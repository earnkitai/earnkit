import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS_KEYS, STATS_LABELS, readStats, statsFrom, weiToEth } from './stats';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

holdBonusDbLock();

const E18 = 10n ** 18n;

test('weiToEth: ETH as a number, 6 decimals, rounded down', () => {
  assert.equal(weiToEth(0n), 0);
  assert.equal(weiToEth(E18), 1);
  assert.equal(weiToEth(1_234_567_890_123_456_789n), 1.234567);
  assert.equal(weiToEth(999n), 0);
});

test('statsFrom: exactly the public keys, numbers only, no per-user data', () => {
  const s = statsFrom({
    open_money_usd: '15500.00',
    programs_open: 4,
    bonus_programs_open: 3,
    coins_launched: 7,
    bonus_deposits_wei: (2n * E18).toString(),
    bonus_to_safe_wei: (E18 / 2n).toString(),
    bonus_paid_wei: (E18 / 4n).toString(),
    installs: 12,
  });
  assert.deepEqual(Object.keys(s), [...STATS_KEYS]);
  assert.deepEqual(s, {
    open_money_usd: 15500,
    programs_open: 4,
    bonus_programs_open: 3,
    coins_launched: 7,
    // The Safe's 30% slot is 1.5x the bonus wallet's 20% of the same fees (3 ETH), plus the bonus
    // deposits booked to the Safe (0.5 ETH: ended rounds, no open round).
    fees_to_safe_eth: 3.5,
    bonus_paid_eth: 0.25,
    installs: 12,
  });
  for (const v of Object.values(s)) assert.equal(typeof v, 'number');
});

test('statsFrom: an empty database reads as zeros', () => {
  const s = statsFrom({
    open_money_usd: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0,
    bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, installs: 0,
  });
  assert.deepEqual(Object.values(s), [0, 0, 0, 0, 0, 0, 0]);
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('readStats: DB aggregates move with open programs, launched coins, bonus money and installs', db, async () => {
  const tag = `stats-${process.pid}-${Date.now()}`;
  const stamp = process.pid.toString(16) + Date.now().toString(16);
  const hash = (n: number) => `0x${(stamp + n).padStart(64, '0')}`;
  const coin = `0x${stamp.padStart(40, 'c')}`.slice(0, 42);
  const before = await readStats();
  assert.deepEqual(Object.keys(before), [...STATS_KEYS]);
  const prog = (id: string, status: string, endsInMs: number | null, award: number | null) => sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, ends_at, max_award_usd)
    VALUES (${id}, 'o', ${id}, 'd', 'https://x', 'https://x', 'r', 's', ${status}, 'unknown',
      ${endsInMs === null ? null : new Date(Date.now() + endsInMs)}, ${award})`;
  await prog(`${tag}-open`, 'active', 86_400_000, 5000);
  await prog(`${tag}-rolling`, 'active', null, 250);
  await prog(`${tag}-ended`, 'active', -86_400_000, 9999); // ended: not open
  await prog(`${tag}-closed`, 'closed', 86_400_000, 9999); // closed: not open
  const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
  const [p1] = await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, installation_id, token_status, token_url, coin_address)
    VALUES (${`${tag}-open`}, 'a', ${inst.id}, 'launched', 'https://tokens.fun/x', ${coin}) RETURNING id`;
  await sql()`INSERT INTO projects (program_id, name, token_status, token_url) VALUES (${`${tag}-open`}, 'b', 'pending', 'pending')`;
  await sql()`
    INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at, state)
    VALUES (${tag}, ${`${tag}-open`}, now() - interval '1 day', now() + interval '1 day', 'paid')`;
  await sql()`
    INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time) VALUES
      (${hash(1)}, 0, ${coin}, ${tag}, 'round', ${(2n * E18).toString()}, now()),
      (${hash(2)}, 0, NULL, NULL, 'safe', ${(E18 / 2n).toString()}, now()),
      -- M5: a deposit from a coin EarnKit didn't launch: booked to the Safe, but no Safe slot known.
      (${hash(3)}, 0, '0x00000000000000000000000000000000000000ff', NULL, 'safe', ${((3n * E18) / 10n).toString()}, now()),
      -- A paid round's remainder (a veto left a place empty): part of the round's own 2 ETH, so
      -- it counts once, as money routed to the Safe, never as a new deposit.
      (${`round-rest:${tag}`}, 0, NULL, ${tag}, 'safe', ${(E18 / 10n).toString()}, now())`;
  await sql()`
    INSERT INTO bonus_payouts (round_key, project_id, rank, score, wallet, slot, amount_wei, status, tx_hash, paid_at)
    VALUES (${tag}, ${p1.id}, 1, 90, '0x1', 0, ${(E18 / 4n).toString()}, 'paid', '0xabc', now())`;
  try {
    const after = await readStats();
    const d = (k: (typeof STATS_KEYS)[number]) => Math.round((after[k] - before[k]) * 1e6) / 1e6;
    // Other test files insert programs, coins and installations in parallel: those deltas are a
    // lower bound. The bonus tables are held by this file's lock: exact.
    assert.ok(d('open_money_usd') >= 5250, `open money +${d('open_money_usd')}`);
    assert.ok(d('programs_open') >= 2);
    assert.ok(d('bonus_programs_open') >= 2); // both open programs default to builder_bonus: true, no campaign
    assert.ok(d('coins_launched') >= 1);
    assert.ok(d('installs') >= 1);
    // 2 ETH of bonus deposits from an EarnKit coin: the Safe's slot got 3 (M5: the 0.5 with no coin
    // and the 0.3 from a coin EarnKit didn't launch have no known Safe slot). Booked to the Safe:
    // those 0.8, plus 0.1 of the round's pool left over (counted once): 3.9.
    assert.equal(d('fees_to_safe_eth'), 3.9);
    assert.equal(d('bonus_paid_eth'), 0.25);
  } finally {
    await sql()`DELETE FROM bonus_payouts WHERE round_key = ${tag}`;
    await sql()`DELETE FROM bonus_ledger WHERE round_key = ${tag} OR tx_hash IN ${sql()([hash(1), hash(2), hash(3)])}`;
    await sql()`DELETE FROM bonus_rounds WHERE round_key = ${tag}`;
    await sql()`DELETE FROM projects WHERE program_id LIKE ${`${tag}-%`}`;
    await sql()`DELETE FROM installations WHERE id = ${inst.id}`;
    await sql()`DELETE FROM programs WHERE id LIKE ${`${tag}-%`}`;
  }
});

test('v2.6 Ruling 6/16 (plan): an owner test installation never counts in installs or coins_launched', db, async () => {
  const tag = `stats-test-inst-${process.pid}-${Date.now()}`;
  const coin = `0x${(process.pid.toString(16) + Date.now().toString(16)).padStart(40, 'e')}`.slice(0, 42);
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
  const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
  await sql()`
    INSERT INTO projects (program_id, name, installation_id, token_status, token_url, coin_address)
    VALUES (${tag}, 'test entry', ${inst.id}, 'launched', 'https://tokens.fun/x', ${coin})`;
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  try {
    // Fix round 1, finding 2: one repeatable-read transaction so both reads see the same
    // snapshot, however many rows other test files insert or delete between them in parallel.
    const { withoutFlag, withFlag } = await sql().begin('isolation level repeatable read', async (tx) => {
      delete process.env.EARNKIT_TEST_INSTALLATIONS;
      const withoutFlag = await readStats(new Date(), tx);
      process.env.EARNKIT_TEST_INSTALLATIONS = String(inst.id);
      const withFlag = await readStats(new Date(), tx);
      return { withoutFlag, withFlag };
    });
    assert.equal(withoutFlag.installs - withFlag.installs, 1);
    assert.equal(withoutFlag.coins_launched - withFlag.coins_launched, 1);
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
    await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
    await sql()`DELETE FROM installations WHERE id = ${inst.id}`;
    await sql()`DELETE FROM programs WHERE id = ${tag}`;
  }
});

test('T9 note: jenil.ai labels fees_to_safe_eth as the v2.5 coins only; every stat has a label', () => {
  assert.equal(STATS_LABELS.fees_to_safe_eth, 'fees to the Safe (v2.5 coins)');
  assert.deepEqual(Object.keys(STATS_LABELS), [...STATS_KEYS]);
  for (const l of Object.values(STATS_LABELS)) assert.doesNotMatch(l, /vault|\p{Extended_Pictographic}/u);
});

test('v2.6 Ruling 16 (plan): bonus_programs_open key and label', () => {
  assert.ok((STATS_KEYS as readonly string[]).includes('bonus_programs_open'));
  assert.equal(STATS_LABELS.bonus_programs_open, 'programs with a builder bonus');
});
