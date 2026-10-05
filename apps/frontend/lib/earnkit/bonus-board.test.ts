import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bonusBoard, daysLeft, ethText, frozenRows, openRows, type OpenEntry } from './bonus-board';
import type { BonusPayoutRow } from './bonus-payout';
import { sql } from './db';
import { holdBonusDbLock } from './fixtures/bonus-db-lock';

holdBonusDbLock();

const E18 = 10n ** 18n;
const now = new Date('2026-10-05T12:00:00Z');

test('daysLeft: whole days, rounded up; 0 once ended', () => {
  assert.equal(daysLeft(new Date('2026-10-05T13:00:00Z'), now), 1);
  assert.equal(daysLeft(new Date('2026-10-08T12:00:00Z'), now), 3);
  assert.equal(daysLeft(new Date('2026-10-08T12:00:01Z'), now), 4);
  assert.equal(daysLeft(now, now), 0);
  assert.equal(daysLeft(new Date('2026-10-01T00:00:00Z'), now), 0);
});

test('ethText: up to 4 decimals, rounded down, never scientific', () => {
  assert.equal(ethText(0n), '0');
  assert.equal(ethText(E18 * 3n), '3');
  assert.equal(ethText(420_000_000_000_000_000n), '0.42');
  assert.equal(ethText(123_456_789_000_000n), '0.0001');
  assert.equal(ethText(99_999_999_999_999n), 'under 0.0001');
});

const entry = (id: number, o: Partial<OpenEntry> = {}): OpenEntry => ({
  id, name: `P${id}`, repo_url: `https://github.com/a/p${id}`, live_url: null, coin: true, proof: true,
  eligible: true, rank: null, score: null, submitted_at: new Date(Date.UTC(2026, 9, 1, id)), ...o,
});

test('openRows: eligible ranked first (re-numbered), then eligible unscored, then not eligible with the plain reason', () => {
  const rows = openRows([
    entry(1, { coin: false, eligible: false }),
    entry(2, { rank: 3, score: 40.123456 }),
    entry(3, { rank: 1, score: 88 }),
    entry(4),
    entry(5, { proof: false, eligible: false, rank: 2, score: 70 }), // lost eligibility: no stale rank
    entry(6, { eligible: false }),
  ]);
  assert.deepEqual(
    rows.map((r) => [r.name, r.rank, r.score, r.eligible, r.note]),
    [
      ['P3', 1, '88.0', true, 'Yes'],
      ['P2', 2, '40.1', true, 'Yes'],
      ['P4', null, null, true, 'Yes, not scored yet'],
      ['P1', null, null, false, 'No: no coin'],
      ['P5', null, null, false, 'No: submission page not confirmed yet'],
      ['P6', null, null, false, 'No: an earlier entry of this repo counts'],
    ],
  );
  for (const r of rows) assert.deepEqual([r.amount, r.tx], [null, null]);
});

const frozen = (id: number, rank: number, o: Partial<BonusPayoutRow> = {}): BonusPayoutRow => ({
  id, project_id: id, rank, score: 100 - rank, wallet: `0x${String(id).padStart(40, '0')}`, installation_id: id,
  flags: [], slot: null, amount_wei: null, status: null, tx_hash: null, raw_tx: null, stale_at: null, reverts: 0,
  paid_at: null, vetoed: false, veto_reason: null, ...o,
});

test('frozenRows: the frozen order minus removed entries (top 10, renumbered), each place amount; only mined payouts link', () => {
  const rows = Array.from({ length: 12 }, (_, i) => frozen(i + 1, i + 1));
  rows[1] = { ...rows[1], vetoed: true, veto_reason: 'farmed users' };
  rows[0] = { ...rows[0], status: 'paid', tx_hash: '0x' + 'a'.repeat(64), slot: 0, amount_wei: (E18 / 4n).toString() };
  rows[2] = { ...rows[2], status: 'sending', tx_hash: '0x' + 'b'.repeat(64), slot: 1, amount_wei: '1' };
  const amounts = [E18 / 4n, E18 / 5n, ...Array.from({ length: 8 }, () => E18 / 100n)];
  const names = new Map(rows.map((r) => [r.project_id, {
    name: `P${r.project_id}`, repo_url: r.project_id === 1 ? 'https://github.com/a/p1' : 'javascript:alert(1)', live_url: null,
  }]));
  const { rows: out, removed } = frozenRows(rows, amounts, names);
  assert.equal(removed, 1);
  // The removed #2 is gone and everyone below moved up: P3 is now #2, P11 takes the 10th place.
  assert.deepEqual(out.map((r) => [r.rank, r.name]), [1, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((id, i) => [i + 1, `P${id}`]));
  assert.deepEqual([out[0].amount, out[0].tx, out[0].eligible, out[0].note], ['0.25', '0x' + 'a'.repeat(64), true, 'Yes']);
  assert.deepEqual([out[1].amount, out[1].tx], ['0.2', null]); // sending: no link until mined
  assert.equal(out[9].amount, '0.01');
  assert.equal(out[0].score, '99.0');
  // Links only in their canonical https form; anything else is dropped.
  assert.deepEqual([out[0].repo_url, out[1].repo_url], ['https://github.com/a/p1', null]);
  // Nothing about wallets, flags or veto reasons reaches the public rows.
  const json = JSON.stringify(out);
  assert.ok(!json.includes('0x00000000000000000000000000000000000000'));
  assert.ok(!json.includes('farmed'));
});

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };

test('bonusBoard: an open round (live ranking, pool so far) and a paid round (frozen ranking, links); unknown is null', db, async () => {
  const tag = `board-${process.pid}-${Date.now()}`;
  const realNow = new Date();
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, ends_at, submission_proof)
    VALUES (${tag}, 'Org', 'Some Grants', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown',
      ${new Date(realNow.getTime() + 3 * 86_400_000)}, ${sql().json({ host: 'x.org', path_pattern: '^/b/' })})`;
  const mk = (name: string, coin: string | null, proof: boolean) => sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, coin_address, coin_launched_at, submission_proof_ok_at, bonus_repo_key, creator_wallet, submitted_at)
    VALUES (${tag}, ${name}, ${`https://github.com/a/${name}`}, ${coin}, ${coin ? realNow : null},
      ${proof ? realNow : null}, ${`github.com/a/${name}`}, '0x00000000000000000000000000000000000000aa', now() - interval '1 hour')
    RETURNING id`;
  const [a] = await mk('alpha', `0x${(process.pid.toString(16) + Date.now().toString(16)).padStart(40, '0')}`, true);
  const [b] = await mk('beta', null, true);
  await sql()`
    INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at, state)
    VALUES (${tag}, ${tag}, now() - interval '1 day', ${new Date(realNow.getTime() + 3 * 86_400_000)}, 'open')`;
  await sql()`
    INSERT INTO bonus_ledger (tx_hash, log_index, round_key, destination, amount_wei, block_time)
    VALUES (${`${tag}-l`}, 0, ${tag}, 'round', ${(E18 / 2n).toString()}, now())`;
  await sql()`
    INSERT INTO bonus_scores (round_key, project_id, day, signals, through, score, rank)
    VALUES (${tag}, ${a.id}, CURRENT_DATE, '{}', now(), 61.5, 1)`;
  const paidKey = `${tag}:2026-09`;
  await sql()`
    INSERT INTO bonus_rounds (round_key, program_id, starts_at, ends_at, state, terms)
    VALUES (${paidKey}, ${tag}, '2026-09-01', '2026-10-01', 'paid',
      ${sql().json({ token: '0x', symbol: 'WETH', decimals: 18, pool_wei: E18.toString(), amounts: [E18.toString()], flagged: [] })})`;
  await sql()`
    INSERT INTO bonus_payouts (round_key, project_id, rank, score, wallet, installation_id, slot, amount_wei, status, tx_hash, paid_at)
    VALUES (${paidKey}, ${a.id}, 1, 77.25, '0x00000000000000000000000000000000000000aa', 1, 0, ${E18.toString()}, 'paid', ${'0x' + 'c'.repeat(64)}, now())`;
  try {
    const open = await bonusBoard(tag, realNow);
    assert.ok(open);
    assert.deepEqual(
      [open.title, open.state, open.pool, open.days_left],
      ['Some Grants', 'open', '0.5', 3],
    );
    assert.deepEqual(open.rows.map((r) => [r.name, r.rank, r.score, r.note]), [
      ['alpha', 1, '61.5', 'Yes'],
      ['beta', null, null, 'No: no coin'],
    ]);
    const paid = await bonusBoard(paidKey, realNow);
    assert.ok(paid);
    assert.deepEqual([paid.state, paid.pool, paid.days_left], ['paid', '1', 0]);
    assert.deepEqual(paid.rows.map((r) => [r.name, r.rank, r.amount, r.tx]), [['alpha', 1, '1', '0x' + 'c'.repeat(64)]]);
    assert.ok(!JSON.stringify(paid).includes('00aa'), 'no wallet');
    assert.equal(await bonusBoard(`${tag}-missing`, realNow), null);
    // The open round of a program with no deposit yet still shows, with nothing in the pool; a
    // program whose submissions aren't public (no submission_proof) has no bonus page.
    for (const [id, proof] of [[`${tag}-new`, true], [`${tag}-private`, false]] as const)
      await sql()`
        INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, submission_proof)
        VALUES (${id}, 'Org', 'Rolling', 'd', 'https://x', 'https://x', 'r', 's', 'active', 'unknown',
          ${proof ? sql().json({ host: 'x.org', path_pattern: '^/b/' }) : null})`;
    const month = realNow.toISOString().slice(0, 7);
    const fresh = await bonusBoard(`${tag}-new:${month}`, realNow);
    assert.deepEqual([fresh?.state, fresh?.pool, fresh?.rows.length], ['open', '0', 0]);
    assert.equal(await bonusBoard(`${tag}-new:2020-01`, realNow), null);
    assert.equal(await bonusBoard(`${tag}-private:${month}`, realNow), null);
    void b;
  } finally {
    await sql()`DELETE FROM bonus_payouts WHERE round_key LIKE ${`${tag}%`}`;
    await sql()`DELETE FROM bonus_scores WHERE round_key LIKE ${`${tag}%`}`;
    await sql()`DELETE FROM bonus_ledger WHERE tx_hash LIKE ${`${tag}%`}`;
    await sql()`DELETE FROM bonus_rounds WHERE round_key LIKE ${`${tag}%`}`;
    await sql()`DELETE FROM projects WHERE program_id = ${tag}`;
    await sql()`DELETE FROM programs WHERE id LIKE ${`${tag}%`}`;
  }
});
