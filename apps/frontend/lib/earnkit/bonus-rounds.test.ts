import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFor, roundFor, roundPoolsWei } from './bonus-rounds';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

const d = (s: string) => new Date(s);
const windowed = { id: 'arc', starts_at: d('2026-09-16T10:00:00Z'), ends_at: d('2026-10-15T04:00:00Z') };
const rolling = { id: 'base-grants', starts_at: null, ends_at: null };

test('roundFor: a windowed program is one round, open inside its window only', () => {
  assert.deepEqual(roundFor(windowed, d('2026-10-01T00:00:00Z')), {
    key: 'arc',
    starts: windowed.starts_at,
    ends: windowed.ends_at,
  });
  assert.equal(roundFor(windowed, d('2026-09-16T09:59:59Z')), null, 'before the start');
  assert.equal(roundFor(windowed, d('2026-09-16T10:00:00Z'))?.key, 'arc', 'the start is inside');
  assert.equal(roundFor(windowed, d('2026-10-15T03:59:59.999Z'))?.key, 'arc');
  assert.equal(roundFor(windowed, d('2026-10-15T04:00:00Z')), null, 'the end is outside');
  const noStart = { id: 'x', starts_at: null, ends_at: windowed.ends_at };
  assert.equal(roundFor(noStart, d('2020-01-01T00:00:00Z'))?.key, 'x', 'no start: open until the end');
});

test('roundFor: a rolling program has UTC calendar-month rounds', () => {
  const oct = roundFor(rolling, d('2026-10-31T23:59:59Z'));
  assert.deepEqual(oct, {
    key: 'base-grants:2026-10',
    starts: d('2026-10-01T00:00:00Z'),
    ends: d('2026-11-01T00:00:00Z'),
  });
  assert.equal(roundFor(rolling, d('2026-11-01T00:00:00Z'))?.key, 'base-grants:2026-11');
  assert.equal(roundFor(rolling, d('2026-12-31T23:00:00Z'))?.ends.toISOString(), '2027-01-01T00:00:00.000Z');
  // A rolling program that starts later: no round before it; its first round starts with it.
  const later = { id: 'r', starts_at: d('2026-10-20T12:00:00Z'), ends_at: null };
  assert.equal(roundFor(later, d('2026-10-20T11:59:59Z')), null);
  assert.equal(roundFor(later, d('2026-10-21T00:00:00Z'))?.starts.toISOString(), '2026-10-20T12:00:00.000Z');
});

test('bookingFor: the round when one is open at the deposit; otherwise the Safe, with the reason', () => {
  const proof = { host: 'dorahacks.io' };
  const open = { ...windowed, status: 'active', submission_proof: proof };
  assert.deepEqual(bookingFor(open, d('2026-10-01T00:00:00Z')), {
    destination: 'round',
    round: roundFor(windowed, d('2026-10-01T00:00:00Z')),
  });
  assert.deepEqual(bookingFor(open, d('2026-10-16T00:00:00Z')), { destination: 'safe', reason: 'no open round' });
  // No public submissions: no entry can ever be eligible, so its pool would never be paid.
  assert.deepEqual(bookingFor({ ...open, submission_proof: null }, d('2026-10-01T00:00:00Z')), {
    destination: 'safe',
    reason: 'builder bonus not available',
  });
  // A rolling program that was closed has no more rounds.
  assert.deepEqual(bookingFor({ ...rolling, status: 'closed', submission_proof: proof }, d('2026-10-01T00:00:00Z')), {
    destination: 'safe',
    reason: 'no open round',
  });
  assert.equal(bookingFor({ ...rolling, status: 'active', submission_proof: proof }, d('2026-10-01T00:00:00Z')).destination, 'round');
});

// ---- DB-gated ----
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
holdBonusDbLock();

const P = (id: string) => `t4-pools-${id}`;
async function program(id: string, starts: Date | null, ends: Date | null, status = 'active') {
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
      status, existing_work, starts_at, ends_at, submission_proof)
    VALUES (${id}, 'X', ${id}, 'd', 'https://x.example', 'https://x.example', 'r', 's', ${status}, 'allowed',
      ${starts}, ${ends}, ${sql().json({ host: 'x.example' })})`;
}
let n = 0;
async function ledger(roundKey: string | null, wei: string, destination = 'round') {
  if (roundKey)
    await sql()`INSERT INTO bonus_rounds (program_id, round_key, starts_at, ends_at)
                VALUES (${roundKey.split(':')[0]}, ${roundKey}, now(), now()) ON CONFLICT DO NOTHING`;
  await sql()`INSERT INTO bonus_ledger (tx_hash, log_index, coin, round_key, destination, amount_wei, block_time)
        VALUES (${`0xt4pool${n++}`}, 0, '0xc', ${roundKey}, ${destination}, ${wei}, now())`;
}

test('roundPoolsWei: one grouped read; only rounds open now, never a future start, an ended window or an unbooked month', db, async () => {
  const now = d('2026-10-10T12:00:00Z');
  try {
    await program(P('win'), d('2026-10-01T00:00:00Z'), d('2026-10-20T00:00:00Z'));
    await program(P('ended'), d('2026-09-01T00:00:00Z'), d('2026-10-05T00:00:00Z'));
    await program(P('future'), d('2026-10-15T00:00:00Z'), d('2026-11-15T00:00:00Z'));
    await program(P('roll'), null, null);
    await program(P('roll-unbooked'), null, null);
    await program(P('frozen'), d('2026-10-01T00:00:00Z'), d('2026-10-20T00:00:00Z'));
    await ledger(P('win'), '400000000000000000');
    await ledger(P('win'), '20000000000000000');
    await ledger(null, '999', 'safe'); // the Safe's never counts
    await ledger(P('ended'), '5');
    await ledger(P('future'), '5'); // cannot happen, but must not show
    await ledger(`${P('roll')}:2026-10`, '7');
    await ledger(`${P('roll')}:2026-09`, '1000'); // last month's round
    await ledger(`${P('roll-unbooked')}:2026-09`, '1000');
    await ledger(P('frozen'), '9');
    await sql()`UPDATE bonus_rounds SET state = 'frozen' WHERE round_key = ${P('frozen')}`;

    let queries = 0;
    const pools = await roundPoolsWei(
      ['win', 'ended', 'future', 'roll', 'roll-unbooked', 'frozen', 'missing'].map(P),
      { now, onQuery: () => queries++ },
    );
    assert.equal(queries, 1, 'one query');
    assert.deepEqual(
      Object.fromEntries(pools),
      { [P('win')]: 420000000000000000n, [P('roll')]: 7n },
    );
    assert.deepEqual(await roundPoolsWei([]), new Map());
  } finally {
    await sql()`DELETE FROM bonus_ledger WHERE tx_hash LIKE '0xt4pool%'`;
    await sql()`DELETE FROM bonus_rounds WHERE program_id LIKE 't4-pools-%'`;
    await sql()`DELETE FROM programs WHERE id LIKE 't4-pools-%'`;
  }
});

test('roundPoolsWei agrees with roundFor on the open round key at a month boundary', db, async () => {
  try {
    await program(P('edge'), null, null);
    await ledger(`${P('edge')}:2026-10`, '3');
    await ledger(`${P('edge')}:2026-11`, '4');
    const at = async (s: string) => (await roundPoolsWei([P('edge')], { now: d(s) })).get(P('edge'));
    assert.equal(roundFor({ id: P('edge'), starts_at: null, ends_at: null }, d('2026-10-31T23:59:59Z'))?.key, `${P('edge')}:2026-10`);
    assert.equal(await at('2026-10-31T23:59:59Z'), 3n);
    assert.equal(await at('2026-11-01T00:00:00Z'), 4n);
  } finally {
    await sql()`DELETE FROM bonus_ledger WHERE tx_hash LIKE '0xt4pool%'`;
    await sql()`DELETE FROM bonus_rounds WHERE program_id LIKE 't4-pools-%'`;
    await sql()`DELETE FROM programs WHERE id LIKE 't4-pools-%'`;
  }
});
