import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { matchStats, recordShown, updateMatchFloors } from './match-loop';
import { WIN_RATE_MIN_LABELLED } from './stats';

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

type Row = { result: string; product_score: number | null; shown_status: string | null };
/** n labelled rows: the first `won` won (scores 6, 5, 6, ...), the rest not selected (score 3). */
const rows = (n: number, won: number, likely: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    result: i < won ? 'won' : 'not_selected',
    product_score: i < won ? (i === 1 ? 5 : 6) : 3,
    shown_status: i < likely ? 'likely' : 'after_step',
  }));

test('4.10 matchStats: dormant under 30 labelled entries; at 30, the lowest winning score and the likely-row win rate', () => {
  assert.equal(WIN_RATE_MIN_LABELLED, 30);
  assert.deepEqual(matchStats(rows(29, 3, 10)), { floor: null, precision: null, labelled: 29 });
  // 30 entries: 3 won (scores 6, 5, 6), 10 shown as likely (the 3 winners among them): 3 / 10.
  assert.deepEqual(matchStats(rows(30, 3, 10)), { floor: 5, precision: 0.3, labelled: 30 });
  // Placed counts as a win; no likely rows: no precision; no scored winner: no floor.
  const placed = rows(30, 0, 0).map((r, i) => (i === 0 ? { ...r, result: 'placed', product_score: 4 } : r));
  assert.deepEqual(matchStats(placed), { floor: 4, precision: null, labelled: 30 });
  const unscored = rows(30, 2, 5).map((r) => ({ ...r, product_score: null }));
  assert.deepEqual(matchStats(unscored), { floor: null, precision: 0.4, labelled: 30 });
});

test('4.11 recordShown keeps one row per day; updateMatchFloors writes only at 30 labelled entries, never from a self-report', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const big = `ml-big-${stamp}`;
  const small = `ml-small-${stamp}`;
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`ml-${stamp}`}) RETURNING id`;
  for (const id of [big, small])
    await sql()`
      INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work, chains)
      VALUES (${id}, 'o', ${id}, 'd', 'https://x', 'https://x', 'r', 's', 'active', 'allowed', '{base}')`;
  try {
    // recordShown: twice on one day is one row (the latest status wins); another day is another row.
    const shown = { program_id: big, repo_key: 'alice/r0', status: 'after_step', product_score: 6, row_level: 'Medium' as const, traction: 5 };
    await recordShown(inst, [shown], '2026-10-01');
    await recordShown(inst, [{ ...shown, status: 'likely', row_level: 'Easy' }], '2026-10-01');
    const [{ n, status }] = await sql()<{ n: number; status: string }[]>`
      SELECT count(*)::int AS n, max(status) AS status FROM match_shown WHERE installation_id = ${inst} AND day = '2026-10-01'`;
    assert.equal(n, 1);
    assert.equal(status, 'likely');

    // 30 labelled entries in `big`: 3 won (scores 6, 5, 6), 10 shown as likely the day before entry.
    const entry = async (program: string, i: number, score: number) =>
      (await sql()<{ id: number }[]>`
        INSERT INTO projects (program_id, name, repo_url, installation_id, product_score, submitted_at)
        VALUES (${program}, ${`r${i}`}, ${`https://github.com/alice/r${i}`}, ${inst}, ${score}, '2026-10-02T12:00:00Z') RETURNING id`)[0].id;
    for (let i = 0; i < 30; i++) {
      const won = i < 3;
      const id = await entry(big, i, won ? (i === 1 ? 5 : 6) : 3);
      await sql()`
        INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis)
        VALUES (${id}, ${big}, 'R1', ${won ? 'won' : 'not_selected'}, 'announcement')`;
      if (i < 10) await recordShown(inst, [{ ...shown, repo_key: `alice/r${i}`, status: 'likely' }], '2026-10-01');
    }
    // P32: a self-reported win with a lower score never moves the floor, nor counts as labelled.
    const self = await entry(big, 99, 1);
    await sql()`
      INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis)
      VALUES (${self}, ${big}, 'R1', 'won', 'self_reported')`;
    // `small`: 29 labelled entries only.
    for (let i = 0; i < 29; i++) {
      const id = await entry(small, 200 + i, 6);
      await sql()`
        INSERT INTO entry_outcomes (project_id, program_id, round_label, result, basis)
        VALUES (${id}, ${small}, 'R1', 'won', 'announcement')`;
    }

    const r = await updateMatchFloors();
    assert.ok(r.updated >= 1);
    const read = async (id: string) =>
      (await sql()<{ match_floor: number | null; match_precision: string | null }[]>`
        SELECT match_floor, match_precision FROM programs WHERE id = ${id}`)[0];
    const b = await read(big);
    assert.equal(b.match_floor, 5);
    assert.equal(Number(b.match_precision), 0.3);
    assert.deepEqual(await read(small), { match_floor: null, match_precision: null });
  } finally {
    await sql()`DELETE FROM projects WHERE program_id IN (${big}, ${small})`;
    await sql()`DELETE FROM installations WHERE id = ${inst}`;
    await sql()`DELETE FROM programs WHERE id IN (${big}, ${small})`;
  }
});

test('3.12 (v2.10 item 6) recordShown writes traction; a second call the same day keeps the latest', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`ml3-${stamp}`}) RETURNING id`;
  try {
    const row = { program_id: `p-${stamp}`, repo_key: 'alice/tipjar', status: 'likely', product_score: 6, row_level: 'Easy' as const, traction: 3 };
    await recordShown(inst, [row], '2026-10-09');
    await recordShown(inst, [{ ...row, traction: 9 }, { ...row, repo_key: 'alice/other', traction: null }], '2026-10-09');
    const got = await sql()<{ repo_key: string; traction: number | null }[]>`
      SELECT repo_key, traction FROM match_shown WHERE installation_id = ${inst} ORDER BY repo_key`;
    assert.deepEqual(got.map((r) => ({ ...r })), [
      { repo_key: 'alice/other', traction: null },
      { repo_key: 'alice/tipjar', traction: 9 },
    ]);
  } finally {
    await sql()`DELETE FROM installations WHERE id = ${inst}`;
  }
});
