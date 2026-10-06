import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardSlug, bonusOn, bookingFor, resolveRoundParam, roundFor, roundKeyFromSlug, roundPoolsWei, windowKey } from './bonus-rounds';
import { sql } from './db';
import { getProgram } from './programs';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';
import { committedProgram } from './fixtures/program-file';

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
  const open = { ...windowed, status: 'active', builder_bonus: true, campaign: null };
  assert.deepEqual(bookingFor(open, d('2026-10-01T00:00:00Z')), {
    destination: 'round',
    round: roundFor(windowed, d('2026-10-01T00:00:00Z')),
  });
  assert.deepEqual(bookingFor(open, d('2026-10-16T00:00:00Z')), { destination: 'safe', reason: 'no open round' });
  // A program that isn't active (windowed or rolling) has no open round: the same rule as roundPoolsWei.
  assert.deepEqual(bookingFor({ ...open, status: 'closed' }, d('2026-10-01T00:00:00Z')), { destination: 'safe', reason: 'no open round' });
  assert.deepEqual(bookingFor({ ...rolling, status: 'closed', builder_bonus: true, campaign: null }, d('2026-10-01T00:00:00Z')), {
    destination: 'safe',
    reason: 'no open round',
  });
  assert.equal(bookingFor({ ...rolling, status: 'active', builder_bonus: true, campaign: null }, d('2026-10-01T00:00:00Z')).destination, 'round');
});

test('v2.6 §4: every program books to its round unless it opted out or is a campaign', () => {
  const open = { ...windowed, status: 'active', builder_bonus: true, campaign: null };
  const at = d('2026-10-01T00:00:00Z');
  assert.equal(bookingFor({ ...open }, at).destination, 'round', 'no proof pattern still has a bonus');
  assert.deepEqual(bookingFor({ ...open, builder_bonus: false }, at), { destination: 'safe', reason: 'builder bonus off' });
  assert.deepEqual(bookingFor({ ...open, campaign: { kind: 'earnkit' } }, at), { destination: 'safe', reason: 'builder bonus off' });
  assert.deepEqual(bookingFor({ ...open, status: 'closed' }, at), { destination: 'safe', reason: 'no open round' });
  assert.equal(bookingFor({ ...open, builder_bonus: undefined }, at).destination, 'round', 'a v2.5 row without the field is on');
});

test('bonusOn: active, not opted out, not a campaign', () => {
  assert.equal(bonusOn({ status: 'active' }), true);
  assert.equal(bonusOn({ status: 'active', builder_bonus: false }), false);
  assert.equal(bonusOn({ status: 'closed' }), false);
  assert.equal(bonusOn({ status: 'active', campaign: { kind: 'sponsor' } }), false);
});

// ---- DB-gated ----
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
holdBonusDbLock();

test('v2.6 Minor 5: bonusOn agrees with its SQL twin for active/closed, opted out, EarnKit and sponsor campaigns', db, async () => {
  const tag = 't4-parity';
  try {
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary,
        status, existing_work, builder_bonus, campaign)
      VALUES
        (${`${tag}-active`}, 'X', 'a', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', true, NULL),
        (${`${tag}-closed`}, 'X', 'a', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'closed', 'allowed', true, NULL),
        (${`${tag}-off`}, 'X', 'a', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', false, NULL),
        (${`${tag}-earnkit`}, 'X', 'a', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', true, ${sql().json({ kind: 'earnkit' })}),
        (${`${tag}-sponsor`}, 'X', 'a', 'd', 'https://x.example', 'https://x.example', 'r', 's', 'active', 'allowed', true, ${sql().json({ kind: 'sponsor' })})`;
    const rows = await sql()<{ id: string; status: string; builder_bonus: boolean; campaign: unknown; sql_bonus: boolean }[]>`
      SELECT id, status, builder_bonus, campaign, (status = 'active' AND builder_bonus AND campaign IS NULL) AS sql_bonus
      FROM programs WHERE id LIKE ${`${tag}-%`} ORDER BY id`;
    assert.equal(rows.length, 5, 'every seeded row was read back');
    for (const r of rows) assert.equal(bonusOn(r), r.sql_bonus, `${r.id}: JS and SQL twins disagree`);
  } finally {
    await sql()`DELETE FROM programs WHERE id LIKE ${`${tag}-%`}`;
  }
});

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
  const { ProgramFile } = await import('./program-file');
  const { upsertProgram } = await import('./programs');
  const f = committedProgram('arc-microgrants');
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

test('Ruling 12 (plan): boardSlug and roundKeyFromSlug round-trip both key forms', () => {
  assert.equal(boardSlug('arc-microgrants:2026-09-16'), 'arc-microgrants-2026-09-16');
  assert.equal(boardSlug('base-builder-grants:2026-10'), 'base-builder-grants-2026-10');
  for (const key of ['arc-microgrants:2026-09-16', 'base-builder-grants:2026-10', 'monad-2026:2026-10'])
    assert.equal(roundKeyFromSlug(boardSlug(key)), key);
  assert.equal(roundKeyFromSlug('arc-microgrants:2026-09-16'), 'arc-microgrants:2026-09-16');
  assert.equal(roundKeyFromSlug('no-date-here'), 'no-date-here');
  assert.equal(resolveRoundParam('arc-microgrants%3A2026-09-16'), 'arc-microgrants:2026-09-16');
  assert.equal(resolveRoundParam('%E0%A4%A'), null);
});

test('v2.7 §2: get_program\'s guide shows the open round\'s pool and board; none for a frozen round', db, async () => {
  const now = new Date();
  const starts = new Date(now.getTime() - 86_400_000);
  const ends = new Date(now.getTime() + 10 * 86_400_000);
  const key = (id: string) => `${P(id)}:${starts.toISOString().slice(0, 10)}`;
  try {
    await program(P('guide'), starts, ends);
    await program(P('guide-frozen'), starts, ends);
    await program(P('guide-empty'), starts, ends);
    await ledger(key('guide'), '180000000000000000');
    await ledger(key('guide-frozen'), '9');
    await sql()`UPDATE bonus_rounds SET state = 'frozen' WHERE round_key = ${key('guide-frozen')}`;
    const text = async (id: string) => (await getProgram(P(id))).guide!.text;
    assert.match(await text('guide'), new RegExp(`\\nBuilder bonus: 0\\.18 ETH so far · [^ ]+/bonus/${P('guide')}-${starts.toISOString().slice(0, 10)}$`));
    assert.match(await text('guide-empty'), /\nBuilder bonus: new pool · /);
    assert.doesNotMatch(await text('guide-frozen'), /Builder bonus/);
  } finally {
    await sql()`DELETE FROM bonus_ledger WHERE round_key LIKE 't4-pools-guide%'`;
    await sql()`DELETE FROM bonus_rounds WHERE program_id LIKE 't4-pools-guide%'`;
    await sql()`DELETE FROM programs WHERE id LIKE 't4-pools-guide%'`;
  }
});
