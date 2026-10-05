import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingFor, roundFor, roundPoolsWei, windowKey } from './bonus-rounds';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

const d = (s: string) => new Date(s);
const windowed = { id: 'arc', starts_at: d('2026-09-16T10:00:00Z'), ends_at: d('2026-10-15T04:00:00Z') };
const rolling = { id: 'base-grants', starts_at: null, ends_at: null };

test('roundFor: a windowed program is one round keyed by its start day, open inside its window only', () => {
  assert.deepEqual(roundFor(windowed, d('2026-10-01T00:00:00Z')), {
    key: 'arc:2026-09-16',
    starts: windowed.starts_at,
    ends: windowed.ends_at,
  });
  assert.equal(roundFor(windowed, d('2026-09-16T09:59:59Z')), null, 'before the start');
  assert.equal(roundFor(windowed, d('2026-09-16T10:00:00Z'))?.key, 'arc:2026-09-16', 'the start is inside');
  assert.equal(roundFor(windowed, d('2026-10-15T03:59:59.999Z'))?.key, 'arc:2026-09-16');
  assert.equal(roundFor(windowed, d('2026-10-15T04:00:00Z')), null, 'the end is outside');
  // M4: a window without a start has no round (never one counting activity from 1970).
  const noStart = { id: 'x', starts_at: null, ends_at: windowed.ends_at };
  assert.equal(roundFor(noStart, d('2026-10-01T00:00:00Z')), null, 'no start: no round');
});

test('I2 / Ruling 21: an extended end keeps the round (same key, new end); a new start day is a new round', () => {
  const extended = { ...windowed, ends_at: d('2026-10-30T00:00:00Z') };
  const r = roundFor(extended, d('2026-10-20T00:00:00Z'));
  assert.equal(r?.key, roundFor(windowed, d('2026-10-01T00:00:00Z'))?.key, 'same round');
  assert.equal(r?.ends.toISOString(), '2026-10-30T00:00:00.000Z', 'the deposit in the extension is inside the round');
  const cohort2 = { id: 'arc', starts_at: d('2026-11-01T10:00:00Z'), ends_at: d('2026-12-01T00:00:00Z') };
  assert.equal(roundFor(cohort2, d('2026-11-10T00:00:00Z'))?.key, 'arc:2026-11-01', 'a re-run cohort is a new round');
  assert.equal(windowKey('arc', d('2026-09-16T10:00:00Z')), 'arc:2026-09-16');
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
  // A program that isn't active (windowed or rolling) has no open round: the same rule as roundPoolsWei.
  assert.deepEqual(bookingFor({ ...open, status: 'closed' }, d('2026-10-01T00:00:00Z')), { destination: 'safe', reason: 'no open round' });
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
    await program(P('closed'), d('2026-10-01T00:00:00Z'), d('2026-10-20T00:00:00Z'), 'closed');
    await program(P('nostart'), null, d('2026-10-20T00:00:00Z')); // M4: no round
    const oct1 = (id: string) => `${P(id)}:2026-10-01`;
    await ledger(oct1('closed'), '11');
    await ledger(oct1('win'), '400000000000000000');
    await ledger(oct1('win'), '20000000000000000');
    await ledger(null, '999', 'safe'); // the Safe's never counts
    await ledger(`${P('ended')}:2026-09-01`, '5');
    await ledger(`${P('future')}:2026-10-15`, '5'); // cannot happen, but must not show
    await ledger(`${P('roll')}:2026-10`, '7');
    await ledger(`${P('roll')}:2026-09`, '1000'); // last month's round
    await ledger(`${P('roll-unbooked')}:2026-09`, '1000');
    await ledger(oct1('frozen'), '9');
    await ledger(`${P('nostart')}:2026-10-01`, '9');
    await sql()`UPDATE bonus_rounds SET state = 'frozen' WHERE round_key = ${oct1('frozen')}`;

    let queries = 0;
    const pools = await roundPoolsWei(
      ['win', 'ended', 'future', 'roll', 'roll-unbooked', 'frozen', 'closed', 'missing', 'nostart'].map(P),
      { now, onQuery: () => queries++ },
    );
    assert.equal(queries, 1, 'one query');
    // I2: a program whose current round froze maps to null (its bonus is not available).
    assert.deepEqual(
      Object.fromEntries(pools),
      { [P('win')]: 420000000000000000n, [P('roll')]: 7n, [P('frozen')]: null },
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

test('I2 / Ruling 21: programs:sync moves an open round with its program file; a frozen round or another cohort never moves', db, async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ProgramFile } = await import('./program-file');
  const { upsertProgram } = await import('./programs');
  const f = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/arc-microgrants.json'), 'utf8'));
  const id = P('sync');
  const file = (starts: string, ends: string) => ProgramFile.parse({ ...f, id, starts_at: starts, ends_at: ends });
  const window = async (key: string) =>
    (await sql()<{ starts_at: Date; ends_at: Date; state: string }[]>`SELECT starts_at, ends_at, state FROM bonus_rounds WHERE round_key = ${key}`)[0];
  try {
    await upsertProgram(file('2026-09-16T10:00:00Z', '2026-10-15T04:00:00Z'));
    const key = windowKey(id, d('2026-09-16T10:00:00Z'));
    await sql()`INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at)
      VALUES (${key}, ${id}, '2026-09-16T10:00:00Z', '2026-10-15T04:00:00Z')`;
    // The organizer extends the deadline: the open round follows (scoring, freeze and eligibility read it).
    await upsertProgram(file('2026-09-16T10:00:00Z', '2026-10-25T04:00:00Z'));
    assert.equal((await window(key)).ends_at.toISOString(), '2026-10-25T04:00:00.000Z');
    // A frozen round never moves.
    await sql()`UPDATE bonus_rounds SET state = 'review' WHERE round_key = ${key}`;
    await upsertProgram(file('2026-09-16T10:00:00Z', '2026-11-05T04:00:00Z'));
    assert.equal((await window(key)).ends_at.toISOString(), '2026-10-25T04:00:00.000Z');
    // A new cohort (another start day) leaves the old round alone; its own round comes with its first deposit.
    await sql()`UPDATE bonus_rounds SET state = 'open' WHERE round_key = ${key}`;
    await upsertProgram(file('2026-12-01T00:00:00Z', '2027-01-01T00:00:00Z'));
    assert.equal((await window(key)).ends_at.toISOString(), '2026-10-25T04:00:00.000Z');
  } finally {
    await sql()`DELETE FROM bonus_rounds WHERE program_id = ${id}`;
    await sql()`DELETE FROM starters WHERE program_id = ${id}`;
    await sql()`DELETE FROM tracks WHERE program_id = ${id}`;
    await sql()`DELETE FROM programs WHERE id = ${id}`;
  }
});
