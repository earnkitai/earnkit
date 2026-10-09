import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS_KEYS, STATS_LABELS, WIN_RATE_MIN_LABELLED, readStats, statsFrom, weiToEth, type StatsNumberKey } from './stats';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

holdBonusDbLock();

const E18 = 10n ** 18n;

const emptyRow = {
  open_money_usd: null, pool_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0,
  bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0,
  labelled_entries: 0, entries_won: 0, builders_won_usd: null,
};

test('weiToEth: ETH as a number, 6 decimals, rounded down', () => {
  assert.equal(weiToEth(0n), 0);
  assert.equal(weiToEth(E18), 1);
  assert.equal(weiToEth(1_234_567_890_123_456_789n), 1.234567);
  assert.equal(weiToEth(999n), 0);
});

test('statsFrom: exactly the public keys, numbers only, no per-user data', () => {
  const s = statsFrom({
    open_money_usd: '15500.00',
    pool_rows: [
      { pool_usd: 840000, reward: '$840,000 in prizes' },
      { pool_usd: 250000, reward: '$250,000+ prize pool' },
      { pool_usd: 99, reward: 'not stated' }, // programs:check refuses it; a row that slipped past counts as none
      { pool_usd: null, reward: 'Up to $5,000' },
    ],
    programs_open: 4,
    bonus_programs_open: 3,
    coins_launched: 7,
    bonus_deposits_wei: (2n * E18).toString(),
    bonus_to_safe_wei: (E18 / 2n).toString(),
    bonus_paid_wei: (E18 / 4n).toString(),
    bonus_pools_wei: ((6n * E18) / 10n).toString(),
    installs: 12,
    labelled_entries: 5,
    entries_won: 2,
    builders_won_usd: '12500.00',
  });
  assert.deepEqual(Object.keys(s), [...STATS_KEYS]);
  assert.deepEqual(s, {
    open_money_usd: 15500,
    // v2.7.1: the landing's pool total ("$1.09M+"): Monad's "+" and the programs without a pool.
    open_pools_usd: 1090000,
    open_pools_plus: true,
    programs_open: 4,
    bonus_programs_open: 3,
    coins_launched: 7,
    // The Safe's 30% slot is 1.5x the bonus wallet's 20% of the same fees (3 ETH), plus the bonus
    // deposits booked to the Safe (0.5 ETH: ended rounds, no open round).
    fees_to_safe_eth: 3.5,
    bonus_paid_eth: 0.25,
    // v2.7 Ruling 20 (plan): open rounds' bookings, wei to ETH.
    bonus_pools_eth: 0.6,
    installs: 12,
    labelled_entries: 5,
    entries_won: 2,
    builders_won_usd: 12500,
  });
  for (const [k, v] of Object.entries(s)) assert.equal(typeof v, k === 'open_pools_plus' ? 'boolean' : 'number', k);
  const exact = statsFrom({ ...emptyRow, pool_rows: [{ pool_usd: '10000', reward: '10,000 USDC pool' }] });
  assert.deepEqual([exact.open_pools_usd, exact.open_pools_plus], [10000, false]);
});


test('statsFrom: an empty database reads as zeros', () => {
  const s = statsFrom(emptyRow);
  assert.deepEqual(Object.values(s), [0, 0, false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
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
  // v2.7.1: a curated program whose reward states its pool counts in open_pools_usd.
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, pool_usd)
    VALUES (${`${tag}-pool`}, 'o', 'Pool', 'd', 'https://x', 'https://x', '$7,000 in prizes', 's', 'active', 'unknown', 7000)`;
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
    const d = (k: StatsNumberKey) => Math.round((after[k] - before[k]) * 1e6) / 1e6;
    // Other test files insert programs, coins and installations in parallel: those deltas are a
    // lower bound. The bonus tables are held by this file's lock: exact.
    assert.ok(d('open_money_usd') >= 5250, `open money +${d('open_money_usd')}`);
    assert.ok(d('open_pools_usd') >= 7000, `open pools +${d('open_pools_usd')}`);
    assert.equal(after.open_pools_plus, true); // the test's own programs have no pool
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

test('v2.6 Ruling 6/16 (plan): an owner test installation never counts in installs, coins_launched or bonus_pools_eth', db, async () => {
  const tag = `stats-test-inst-${process.pid}-${Date.now()}`;
  const coin = `0x${(process.pid.toString(16) + Date.now().toString(16)).padStart(40, 'e')}`.slice(0, 42);
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
  const [inst] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
  await sql()`
    INSERT INTO projects (program_id, name, installation_id, token_status, token_url, coin_address)
    VALUES (${tag}, 'test entry', ${inst.id}, 'launched', 'https://tokens.fun/x', ${coin})`;
  // Final review M2: a Safe booking from the test coin (an opted-out program, say) never counts either.
  await sql()`
    INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time)
    VALUES (${`${tag}-safe`}, 0, ${coin}, NULL, 'safe', ${(4n * E18 / 10n).toString()}, now())`;
  // Final review M7: nor its booking into an open round's pool (bonus_pools_eth).
  await sql()`
    INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at, state)
    VALUES (${`${tag}-round`}, ${tag}, now() - interval '1 day', now() + interval '1 day', 'open')`;
  await sql()`
    INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time)
    VALUES (${`${tag}-round`}, 0, ${coin}, ${`${tag}-round`}, 'round', ${(2n * E18 / 10n).toString()}, now())`;
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
    assert.equal(Math.round((withoutFlag.fees_to_safe_eth - withFlag.fees_to_safe_eth) * 1e6) / 1e6, 0.4);
    assert.equal(Math.round((withoutFlag.bonus_pools_eth - withFlag.bonus_pools_eth) * 1e6) / 1e6, 0.2);
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
    await sql()`DELETE FROM bonus_ledger WHERE tx_hash IN (${`${tag}-safe`}, ${`${tag}-round`})`;
    await sql()`DELETE FROM bonus_rounds WHERE round_key = ${`${tag}-round`}`;
    await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
    await sql()`DELETE FROM installations WHERE id = ${inst.id}`;
    await sql()`DELETE FROM programs WHERE id = ${tag}`;
  }
});

test('T9 note: jenil.ai labels fees_to_safe_eth as the v2.5 tokens only; every stat has a label', () => {
  assert.equal(STATS_LABELS.fees_to_safe_eth, 'fees to the Safe (v2.5 tokens)');
  assert.deepEqual(Object.keys(STATS_LABELS), [...STATS_KEYS]);
  for (const l of Object.values(STATS_LABELS)) assert.doesNotMatch(l, /vault|\p{Extended_Pictographic}/u);
});

test('v2.7 Ruling 20 (plan): bonus_pools_eth key and label', () => {
  assert.ok((STATS_KEYS as readonly string[]).includes('bonus_pools_eth'));
  assert.equal(STATS_LABELS.bonus_pools_eth, 'builder bonus pools open (ETH)');
});

test('v2.7 Ruling 20 (plan): bonus_pools_eth sums open rounds\' round bookings; a frozen round never counts', db, async () => {
  const tag = `stats-pools-${process.pid}-${Date.now()}`;
  const program = `${tag}-p`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${program}, 'o', ${program}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
  const round = (key: string, state: string) => sql()`
    INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at, state)
    VALUES (${key}, ${program}, now() - interval '1 day', now() + interval '1 day', ${state})`;
  const book = (hash: string, key: string | null, destination: string, wei: bigint) => sql()`
    INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time)
    VALUES (${hash}, 0, NULL, ${key}, ${destination}, ${wei.toString()}, now())`;
  try {
    const before = await readStats();
    await round(`${tag}-open`, 'open');
    await round(`${tag}-frozen`, 'frozen');
    await book(`${tag}-1`, `${tag}-open`, 'round', E18 / 10n);
    await book(`${tag}-2`, `${tag}-frozen`, 'round', E18); // frozen: not an open pool
    await book(`${tag}-3`, null, 'safe', E18); // booked to the Safe, not a pool
    const after = await readStats();
    assert.equal(Math.round((after.bonus_pools_eth - before.bonus_pools_eth) * 1e6) / 1e6, 0.1);
  } finally {
    await sql()`DELETE FROM bonus_ledger WHERE tx_hash LIKE ${`${tag}-%`}`;
    await sql()`DELETE FROM bonus_rounds WHERE round_key LIKE ${`${tag}-%`}`;
    await sql()`DELETE FROM programs WHERE id = ${program}`;
  }
});

test('v2.6 Ruling 16 (plan): bonus_programs_open key and label', () => {
  assert.ok((STATS_KEYS as readonly string[]).includes('bonus_programs_open'));
  assert.equal(STATS_LABELS.bonus_programs_open, 'programs with a builder bonus');
});

// ---- v2.8 Task 12, Part G, Ruling 30 (plan): outcomes in public stats.
test('v2.8 Ruling 30 (plan): labelled_entries and entries_won keys and labels; the win-rate floor is documented', () => {
  assert.deepEqual(STATS_KEYS.slice(-3, -1), ['labelled_entries', 'entries_won']);
  assert.equal(STATS_LABELS.labelled_entries, 'entries with a published result');
  assert.equal(STATS_LABELS.entries_won, 'entries that won');
  assert.equal(WIN_RATE_MIN_LABELLED, 30);
  // No stat is a rate: the public win-rate claim has no code path.
  for (const k of STATS_KEYS) assert.doesNotMatch(k, /rate|percent/);
});

test('v2.8 Ruling 30 (plan): announcements count, self-reports and test installations never do', db, async () => {
  const tag = `stats-outcomes-${process.pid}-${Date.now()}`;
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  const Rollback = new Error('rollback');
  try {
    // One repeatable-read transaction, rolled back: exact deltas whatever other files write meanwhile.
    await sql().begin('isolation level repeatable read', async (tx) => {
      const [inst] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
      const [testInst] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${tag}-t`}) RETURNING id`;
      process.env.EARNKIT_TEST_INSTALLATIONS = String(testInst.id);
      const before = await readStats(new Date(), tx);
      await tx`
        INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
        VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
      const entry = async (name: string, installation: number) =>
        (await tx<{ id: number }[]>`
          INSERT INTO projects (program_id, name, installation_id) VALUES (${tag}, ${name}, ${installation}) RETURNING id`)[0].id;
      const outcome = (project: number, result: string, basis: string) => tx`
        INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis)
        VALUES (${project}, ${tag}, 'Round 1', ${result}, ${basis})`;
      const won = await entry('won', inst.id);
      const lost = await entry('lost', inst.id);
      const selfWon = await entry('self', inst.id);
      const testWon = await entry('test', testInst.id);
      await outcome(won, 'won', 'announcement');
      await outcome(lost, 'not_selected', 'announcement');
      await outcome(selfWon, 'won', 'self_reported');
      await outcome(testWon, 'won', 'announcement');
      const mid = await readStats(new Date(), tx);
      assert.equal(mid.labelled_entries - before.labelled_entries, 2);
      assert.equal(mid.entries_won - before.entries_won, 1);
      // A self-report on an announced entry changes neither count.
      await outcome(won, 'not_selected', 'self_reported');
      await outcome(lost, 'won', 'self_reported');
      const after = await readStats(new Date(), tx);
      assert.equal(after.labelled_entries, mid.labelled_entries);
      assert.equal(after.entries_won, mid.entries_won);
      throw Rollback;
    });
  } catch (err) {
    if (err !== Rollback) throw err;
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
  }
});

test('v2.9 D18: fee_claims rows (an ops log, never revenue) never change fees_to_safe_eth', db, async () => {
  const tag = `0x${'f9'.repeat(32)}`;
  const roles = ['safe', 'bonus', 'creator', 'mini'] as const;
  try {
    const { before, afterRows } = await sql().begin('isolation level repeatable read', async (tx) => {
      const before = await readStats(new Date(), tx);
      for (const [i, role] of roles.entries())
        await tx`INSERT INTO fee_claims (tx_hash, owner, role, weth, gas_wei)
          VALUES (${`${tag.slice(0, -1)}${i}`}, ${`0x${String(i).repeat(40)}`}, ${role}, ${E18.toString()}, 1000)`;
      const afterRows = await readStats(new Date(), tx);
      return { before, afterRows };
    });
    assert.equal(afterRows.fees_to_safe_eth, before.fees_to_safe_eth);
    assert.deepEqual(afterRows, before, 'no public stat moves (statsFrom reads only the aggregate row, which never reads fee_claims)');
  } finally {
    await sql()`DELETE FROM fee_claims WHERE tx_hash LIKE ${`${tag.slice(0, -1)}%`}`;
  }
});

test('10.10 builders_won_usd: announced won or placed prizes only; a self-report or a test installation\'s win adds nothing', db, async () => {
  const tag = `stats-won-${process.pid}-${Date.now()}`;
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  const Rollback = new Error('rollback');
  assert.equal(STATS_KEYS.at(-1), 'builders_won_usd');
  assert.equal(STATS_LABELS.builders_won_usd, 'won by EarnKit builders (announced, USD)');
  try {
    await sql().begin('isolation level repeatable read', async (tx) => {
      const [inst] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${tag}) RETURNING id`;
      const [testInst] = await tx<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${tag}-t`}) RETURNING id`;
      process.env.EARNKIT_TEST_INSTALLATIONS = String(testInst.id);
      const before = await readStats(new Date(), tx);
      await tx`
        INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
        VALUES (${tag}, 'o', ${tag}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown')`;
      const entry = async (installation: number) =>
        (await tx<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id) VALUES (${tag}, 'p', ${installation}) RETURNING id`)[0].id;
      const outcome = async (installation: number, result: string, basis: string, prize: number | null, round = 'R1') => tx`
        INSERT INTO entry_outcomes (project_id, program_id, round_label, result, prize_usd, basis)
        VALUES (${await entry(installation)}, ${tag}, ${round}, ${result}, ${prize}, ${basis})`;
      await outcome(inst.id, 'won', 'announcement', 10_000);
      await outcome(inst.id, 'placed', 'announcement', 2_500);
      await outcome(inst.id, 'won', 'announcement', null);
      await outcome(inst.id, 'finalist', 'announcement', 700);
      await outcome(inst.id, 'won', 'self_reported', 5_000);
      await outcome(testInst.id, 'won', 'announcement', 9_000);
      const after = await readStats(new Date(), tx);
      assert.equal(after.builders_won_usd - before.builders_won_usd, 12_500);
      throw Rollback;
    });
  } catch (err) {
    if (err !== Rollback) throw err;
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
  }
});
