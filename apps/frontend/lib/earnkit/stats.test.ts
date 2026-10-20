import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATS_KEYS, STATS_LABELS, WIN_RATE_MIN_LABELLED, moneyText, openMoneyUsd, readStats, statsFrom, weiToEth } from './stats';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

holdBonusDbLock();

const E18 = 10n ** 18n;

const emptyRow = {
  open_rows: null, pool_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0,
  bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0, installs_used: 0, builders: 0,
  labelled_entries: 0, entries_won: 0, builders_won_usd: null,
};

test('weiToEth: ETH as a number, 6 decimals, rounded down', () => {
  assert.equal(weiToEth(0n), 0);
  assert.equal(weiToEth(E18), 1);
  assert.equal(weiToEth(1_234_567_890_123_456_789n), 1.234567);
  assert.equal(weiToEth(999n), 0);
});

test('statsFrom: an empty database reads as zeros', () => {
  const s = statsFrom(emptyRow);
  assert.deepEqual(Object.values(s), [0, null, 0, false, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

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
    // Pre-launch 2026-10-19: nor in builders (its own group).
    assert.equal(withoutFlag.builders - withFlag.builders, 1);
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

test('pre-launch 2026-10-19: installs_used counts installations that called find; builders counts a linked reinstall once; test installations count in neither', db, async () => {
  const tag = `stats-used-${process.pid}-${Date.now()}`;
  // A builder who installed, ran find, then reinstalled (a new OAuth client, linked by builder_id);
  // and a bare OAuth install that never called a tool.
  const [root] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, programs_checked_at) VALUES (${`${tag}-root`}, now()) RETURNING id`;
  const [again] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, builder_id) VALUES (${`${tag}-again`}, ${root.id}) RETURNING id`;
  const [bare] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${tag}-bare`}) RETURNING id`;
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  try {
    const { base, mine, flagged } = await sql().begin('isolation level repeatable read', async (tx) => {
      process.env.EARNKIT_TEST_INSTALLATIONS = [root.id, again.id, bare.id].join(',');
      const base = await readStats(new Date(), tx);
      delete process.env.EARNKIT_TEST_INSTALLATIONS;
      const mine = await readStats(new Date(), tx);
      // Only the group's root flagged: the linked reinstall is that builder's too, so builders drops it.
      process.env.EARNKIT_TEST_INSTALLATIONS = String(root.id);
      const flagged = await readStats(new Date(), tx);
      return { base, mine, flagged };
    });
    assert.equal(mine.installs - base.installs, 3);
    assert.equal(mine.installs_used - base.installs_used, 1);
    assert.equal(mine.builders - base.builders, 2);
    assert.equal(flagged.builders - base.builders, 1);
    assert.equal(flagged.installs_used - base.installs_used, 0);
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
    await sql()`DELETE FROM installations WHERE id IN (${again.id}, ${bare.id})`;
    await sql()`DELETE FROM installations WHERE id = ${root.id}`;
  }
});

test('launch-ready L9: activated, weekly_active and shared are served after builders, with labels', () => {
  const i = STATS_KEYS.indexOf('builders');
  assert.deepEqual(STATS_KEYS.slice(i + 1, i + 4), ['activated', 'weekly_active', 'shared']);
  for (const k of ['activated', 'weekly_active', 'shared'] as const) assert.ok(STATS_LABELS[k].length > 0, k);
  const s = statsFrom({ ...emptyRow, activated: 3, weekly_active: 2, shared: 4 });
  assert.deepEqual([s.activated, s.weekly_active, s.shared], [3, 2, 4]);
  assert.equal(statsFrom(emptyRow).shared, 0);
});

test('launch-ready L9 (L6 approvals): activated needs a claimed page, an App-proven repo and an approved week; weekly_active the same people with a week approved in the last 7 days; shared counts approved weeks from the share offer; test installations never count', db, async () => {
  const tag = `stats-l9-${process.pid}-${Date.now()}`;
  const DAY = 86_400_000;
  const mondayOf = (t: number) => {
    const d = new Date(t);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const now = Date.now();
  const lastWeek = mondayOf(now - 7 * DAY);
  const longAgo = mondayOf(now - 35 * DAY);
  const ids: number[] = [];
  /** One person: claimed or not, their repo's proof, and their ship-log weeks ([week, facts]). */
  const person = async (claimed: boolean, proof: string, weeks: [string, Record<string, unknown>][]) => {
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`${tag}-${ids.length}`}) RETURNING id`;
    ids.push(id);
    const key = `${tag}/p${id}`;
    await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle) VALUES (${id}, ${`${tag}-${id}`}, ${claimed ? `x${id}` : null}, ${claimed ? `h${id}` : null})`;
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, 'repo', ${key}, ${key}, 'verified', ${proof}, 'server')`;
    for (const [week, facts] of weeks)
      await sql()`INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${id}, ${key}, ${week}, ${sql().json(facts as never)})`;
    return id;
  };
  const code = { checked: true, shipped_code: { n: 3 } };
  const approved = (at: number) => ({ ...code, approved: true, approved_at: new Date(at).toISOString(), approved_via: 'share' });
  const prevEnv = process.env.EARNKIT_TEST_INSTALLATIONS;
  try {
    const active = await person(true, 'github_app', [[lastWeek, approved(now - DAY)]]); // activated, weekly active, shared
    await person(true, 'github_app', [[longAgo, approved(now - 30 * DAY)]]); // activated, not weekly active, shared
    await person(true, 'github_app', [[lastWeek, code]]); // a checked week with code, never approved: neither
    await person(true, 'proof_line', [[lastWeek, approved(now - DAY)]]); // not App-proven: neither (still a shared week)
    await person(false, 'github_app', [[lastWeek, approved(now - DAY)]]); // not claimed: neither (still a shared week)
    await person(true, 'github_app', [[lastWeek, { ...code, approved: 'yes', approved_at: new Date(now).toISOString() }]]); // not a real approval: neither
    const { base, mine, flagged } = await sql().begin('isolation level repeatable read', async (tx) => {
      process.env.EARNKIT_TEST_INSTALLATIONS = ids.join(',');
      const base = await readStats(new Date(), tx);
      delete process.env.EARNKIT_TEST_INSTALLATIONS;
      const mine = await readStats(new Date(), tx);
      process.env.EARNKIT_TEST_INSTALLATIONS = String(active);
      const flagged = await readStats(new Date(), tx);
      return { base, mine, flagged };
    });
    assert.equal(mine.activated - base.activated, 2);
    assert.equal(mine.weekly_active - base.weekly_active, 1);
    // Fix round 1: weekly active is a subset of activated.
    assert.ok(mine.weekly_active <= mine.activated && base.weekly_active <= base.activated);
    assert.equal(mine.shared - base.shared, 4, 'every approved week from the share offer');
    assert.equal(flagged.activated - base.activated, 1, 'a test installation\'s person never counts');
    assert.equal(flagged.weekly_active - base.weekly_active, 0);
    assert.equal(flagged.shared - base.shared, 3);
  } finally {
    if (prevEnv === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prevEnv;
    if (ids.length) {
      await sql()`DELETE FROM project_updates WHERE builder_id IN ${sql()(ids)}`;
      await sql()`DELETE FROM builder_sources WHERE builder_id IN ${sql()(ids)}`;
      await sql()`DELETE FROM builder_profiles WHERE builder_id IN ${sql()(ids)}`;
      await sql()`DELETE FROM installations WHERE id IN ${sql()(ids)}`;
    }
  }
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
  assert.deepEqual(STATS_KEYS.slice(-6, -4), ['labelled_entries', 'entries_won']);
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
  assert.equal(STATS_KEYS.at(-4), 'builders_won_usd');
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

// ---- v2.9 Task 11 (F21): the one money figure.

/** Every committed program file, read as the row openMoneyUsd takes (the catalogue as synced). */
const catalogueRows = () =>
  readdirSync(join(import.meta.dirname, '../../../../programs'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', f), 'utf8')))
    .map((p) => ({
      max_award_usd: p.max_award_usd ?? null,
      investment: p.investment ?? false,
      status: p.status,
      campaign: p.campaign ?? null,
      source: 'file',
      starts_at: p.starts_at ? new Date(p.starts_at) : null,
      ends_at: p.ends_at ? new Date(p.ends_at) : null,
    }));

test('11.1 openMoneyUsd: the top prize of every open curated program, summed; moneyText rounds down', () => {
  // P20: a fixed now, so the test never breaks when a program closes.
  const now = new Date('2026-10-08T00:00:00Z');
  const rows = catalogueRows();
  // Campaign #1 is closed; scoring and clarity R12 closed Arc Microgrants, Colosseum and Monad Metropolis too.
  // v3 Stage 2 (the honest total): a16z speedrun and Alliance are investments, never counted; upcoming programs neither.
  // Avalanche $10K, Base $5K, Circle $100K and ETHGlobal Mumbai $15K per partner prize.
  assert.equal(openMoneyUsd(rows, now), 130000);
  assert.equal(moneyText(1115000), '$1.1M+');
  assert.equal(moneyText(1_000_000), '$1M');
  assert.equal(moneyText(0), null);
  const open = { max_award_usd: 1000, status: 'active', ends_at: null, starts_at: null };
  assert.equal(openMoneyUsd([open], now), 1000);
  // A sponsor-sourced program, an ended one, a closed one and one not started count 0.
  assert.equal(openMoneyUsd([{ ...open, source: 'sponsor' }], now), 0);
  assert.equal(openMoneyUsd([{ ...open, sponsored: true }], now), 0);
  assert.equal(openMoneyUsd([{ ...open, ends_at: new Date('2026-10-01T00:00:00Z') }], now), 0);
  assert.equal(openMoneyUsd([{ ...open, status: 'closed' }], now), 0);
  assert.equal(openMoneyUsd([{ ...open, starts_at: new Date('2026-11-01T00:00:00Z') }], now), 0);
  // P19: an open EarnKit campaign never counts, as a DB row (campaign) or a card (earnkit_campaign).
  assert.equal(openMoneyUsd([{ ...open, campaign: { prize_usd: 100 } }], now), 0);
  assert.equal(openMoneyUsd([{ ...open, earnkit_campaign: { slug: 'c1' } }], now), 0);
  assert.equal(openMoneyUsd([...rows, { ...open, earnkit_campaign: { slug: 'c1' } }], now), 130000);
  // v3 Stage 2: an investment and an upcoming program count 0.
  assert.equal(openMoneyUsd([{ ...open, investment: true }], now), 0);
  assert.equal(openMoneyUsd([{ ...open, status: 'upcoming' }], now), 0);
  // A program without a stated top prize counts 0.
  assert.equal(openMoneyUsd([{ ...open, max_award_usd: null }], now), 0);
});

test('11.2 /api/stats: open_money_usd and open_money_text; open_pools_* stay, deprecated (Ruling G23); labels match the keys', () => {
  for (const k of ['open_money_usd', 'open_money_text', 'open_pools_usd', 'open_pools_plus'] as const) assert.ok(STATS_KEYS.includes(k), k);
  assert.deepEqual(Object.keys(STATS_LABELS), [...STATS_KEYS]);
  assert.match(STATS_LABELS.open_pools_usd, /deprecated/);
  assert.match(STATS_LABELS.open_pools_plus, /deprecated/);
  const now = new Date('2026-10-08T00:00:00Z');
  const s = statsFrom({ ...emptyRow, open_rows: catalogueRows().map((r) => ({ ...r, starts_at: r.starts_at?.toISOString() ?? null, ends_at: r.ends_at?.toISOString() ?? null })) }, now);
  assert.deepEqual(Object.keys(s), [...STATS_KEYS]);
  assert.equal(s.open_money_usd, 130000);
  assert.equal(s.open_money_text, '$130K in grants and prizes open');
  assert.equal(statsFrom(emptyRow, now).open_money_text, null);
});
