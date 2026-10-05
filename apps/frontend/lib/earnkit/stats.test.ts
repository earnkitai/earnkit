import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS_KEYS, readStats, statsFrom, weiToEth } from './stats';
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
    open_money_usd: null, programs_open: 0, coins_launched: 0,
    bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, installs: 0,
  });
  assert.deepEqual(Object.values(s), [0, 0, 0, 0, 0, 0]);
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('readStats: DB aggregates move with open programs, launched coins, bonus money and installs', db, async () => {
  const tag = `stats-${process.pid}-${Date.now()}`;
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
    INSERT INTO projects (program_id, name, installation_id, token_status, token_url)
    VALUES (${`${tag}-open`}, 'a', ${inst.id}, 'launched', 'https://tokens.fun/x') RETURNING id`;
  await sql()`INSERT INTO projects (program_id, name, token_status, token_url) VALUES (${`${tag}-open`}, 'b', 'pending', 'pending')`;
  await sql()`
    INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at, state)
    VALUES (${tag}, ${`${tag}-open`}, now() - interval '1 day', now() + interval '1 day', 'paid')`;
  await sql()`
    INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time) VALUES
      (${`${tag}-1`}, 0, NULL, ${tag}, 'round', ${(2n * E18).toString()}, now()),
      (${`${tag}-2`}, 0, NULL, NULL, 'safe', ${(E18 / 2n).toString()}, now())`;
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
    assert.ok(d('coins_launched') >= 1);
    assert.ok(d('installs') >= 1);
    // 2.5 ETH of bonus deposits in all: the Safe's slot got 3.75, and 0.5 of them were booked to it.
    assert.equal(d('fees_to_safe_eth'), 4.25);
    assert.equal(d('bonus_paid_eth'), 0.25);
  } finally {
    await sql()`DELETE FROM bonus_payouts WHERE round_key = ${tag}`;
    await sql()`DELETE FROM bonus_ledger WHERE tx_hash LIKE ${`${tag}-%`}`;
    await sql()`DELETE FROM bonus_rounds WHERE round_key = ${tag}`;
    await sql()`DELETE FROM projects WHERE program_id LIKE ${`${tag}-%`}`;
    await sql()`DELETE FROM installations WHERE id = ${inst.id}`;
    await sql()`DELETE FROM programs WHERE id LIKE ${`${tag}-%`}`;
  }
});
