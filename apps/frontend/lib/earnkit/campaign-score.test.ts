import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { gaveUpNote, scoreCampaignEntries, storeFinalMiss, storeScore, type ScoreRow } from './campaign-score';
import { sql } from './db';

const program = { starts_at: new Date('2026-10-05T00:00:00Z'), ends_at: new Date('2026-10-19T00:00:00Z') };
const row = (id: number, extra: Partial<ScoreRow> = {}): ScoreRow => ({
  id,
  contracts: [`0x${String(id).repeat(40)}`],
  payout_wallet: `0x${'a'.repeat(39)}${id}`,
  deployers: [`0x${'d'.repeat(39)}${id}`],
  score: null,
  scored_at: null,
  scored_through: null,
  score_final: false,
  score_attempted_at: null,
  ...extra,
});
const result = (score: number) => ({
  score, wallets: [], counted: [], seen: score, complete: true, timedOut: false, codeShare: null,
});

test('v2.4 §6: one failing entry never stops the others; its error is stored on it', async () => {
  const stored: number[] = [];
  const failed: [number, string][] = [];
  const out = await scoreCampaignEntries(
    program,
    [row(1), row(2), row(3)],
    { now: new Date('2026-10-06T00:00:00Z'), deadline: Date.now() + 5_000, final: false, maxAgeMs: 0 },
    {
      score: async (contracts) => {
        if (contracts[0] === row(2).contracts[0]) throw new Error('Base explorer /api/v2/addresses returned 502');
        return result(4);
      },
      store: async (id) => { stored.push(id); },
      fail: async (id, m) => { failed.push([id, m]); },
      attempt: async () => {},
    },
  );
  assert.deepEqual(stored, [1, 3]);
  assert.deepEqual(failed, [[2, 'Base explorer /api/v2/addresses returned 502']]);
  assert.deepEqual(out.map((o) => o.result), ['scored', 'failed', 'scored']);
});

test("the entry's payout wallet and deployers are excluded; the window ends at now while running", async () => {
  const calls: { to: Date; exclude?: string[] }[] = [];
  await scoreCampaignEntries(
    program,
    [row(1)],
    { now: new Date('2026-10-06T00:00:00Z'), deadline: Date.now() + 5_000, final: false, maxAgeMs: 0 },
    {
      score: async (_c, _f, to, opts) => { calls.push({ to, exclude: opts?.exclude }); return result(1); },
      store: async () => {},
      fail: async () => {},
      attempt: async () => {},
    },
  );
  assert.deepEqual(calls, [{ to: new Date('2026-10-06T00:00:00Z'), exclude: [row(1).payout_wallet, ...row(1).deployers!] }]);
});

test('final: the whole window once, marked final; entries already final are skipped', async () => {
  const stored: { id: number; through: Date | null; final: boolean }[] = [];
  const out = await scoreCampaignEntries(
    program,
    [row(1), row(2, { score: 5, score_final: true })],
    { now: new Date('2026-10-19T00:20:00Z'), deadline: Date.now() + 5_000, final: true, maxAgeMs: 0 },
    {
      score: async () => result(7),
      store: async (id, _r, _at, through, final) => { stored.push({ id, through, final }); },
      fail: async () => {},
      attempt: async () => {},
    },
  );
  assert.deepEqual(stored, [{ id: 1, through: program.ends_at, final: true }]);
  assert.deepEqual(out.map((o) => o.result), ['final', 'skipped']);
});

test('a fresh running score is skipped; a read cut short saves a provisional score only where there is none', async () => {
  const now = new Date('2026-10-06T00:00:00Z');
  const fresh = row(1, { score: 3, scored_at: new Date('2026-10-05T23:00:00Z'), scored_through: new Date('2026-10-05T23:00:00Z') });
  const stored: { id: number; through: Date | null }[] = [];
  const out = await scoreCampaignEntries(
    program,
    [fresh, row(2)],
    { now, deadline: Date.now() + 5_000, final: false, maxAgeMs: 20 * 3_600_000 },
    {
      score: async () => ({ ...result(1), timedOut: true, complete: false }),
      store: async (id, _r, _at, through) => { stored.push({ id, through }); },
      fail: async () => {},
      attempt: async () => {},
    },
  );
  assert.deepEqual(out.map((o) => o.result), ['skipped', 'timed_out']);
  assert.deepEqual(stored, [{ id: 2, through: null }]);
});

test('a scored entry whose read is cut short stays unchanged', async () => {
  const stored: number[] = [];
  const old = new Date('2026-10-05T01:00:00Z');
  const out = await scoreCampaignEntries(
    program,
    [row(1, { score: 5, scored_at: old, scored_through: old })],
    { now: new Date('2026-10-06T00:00:00Z'), deadline: Date.now() + 5_000, final: false, maxAgeMs: 0 },
    {
      score: async () => ({ ...result(1), timedOut: true, complete: false }),
      store: async (id) => { stored.push(id); },
      fail: async () => {},
      attempt: async () => {},
    },
  );
  assert.deepEqual(out.map((o) => o.result), ['timed_out']);
  assert.deepEqual(stored, []);
});

test('a failing fail() write never stops the loop', async () => {
  const stored: number[] = [];
  const out = await scoreCampaignEntries(
    program,
    [row(1), row(2)],
    { now: new Date('2026-10-06T00:00:00Z'), deadline: Date.now() + 5_000, final: false, maxAgeMs: 0 },
    {
      score: async (contracts) => {
        if (contracts[0] === row(1).contracts[0]) throw new Error('explorer down');
        return result(2);
      },
      store: async (id) => { stored.push(id); },
      fail: async () => { throw new Error('database down'); },
      attempt: async () => {},
    },
  );
  assert.deepEqual(out.map((o) => o.result), ['failed', 'scored']);
  assert.deepEqual(stored, [2]);
});

test('rotation: an entry that ran out of time goes last next pass, so [slow, fast] scores fast on pass 2', async () => {
  const rows = [row(1), row(2)];
  const slow = rows[0].contracts[0];
  const pass = (n: number) =>
    scoreCampaignEntries(
      program,
      rows,
      { now: new Date(Date.UTC(2026, 9, 6, n)), deadline: Date.now() + 50, final: false, maxAgeMs: 0 },
      {
        score: async (contracts) => {
          if (contracts[0] !== slow) return result(3);
          await new Promise((r) => setTimeout(r, 70));
          return { ...result(0), timedOut: true, complete: false };
        },
        store: async () => {},
        fail: async () => {},
        attempt: async (id, at) => {
          rows.find((r) => r.id === id)!.score_attempted_at = at;
        },
      },
    );
  const one = await pass(1);
  assert.deepEqual(one.map((o) => [o.id, o.result]), [[1, 'timed_out'], [2, 'timed_out']]);
  const two = await pass(2);
  assert.deepEqual(two.map((o) => [o.id, o.result]), [[2, 'scored'], [1, 'timed_out']]);
});

test('Ruling 35 final pass: only the first unfinished entry of a call counts a miss; a timed-out higher lower bound is kept', async () => {
  const rows = [row(1, { score: 2 }), row(2, { score: 9 })];
  const misses: [number, string][] = [];
  const stored: { id: number; score: number; final: boolean }[] = [];
  const tries: Record<number, number> = {};
  const pass = (n: number) =>
    scoreCampaignEntries(
      program,
      rows,
      { now: new Date(Date.UTC(2026, 9, 19, n)), deadline: Date.now() + 5_000, final: true, maxAgeMs: 0 },
      {
        // Both are too big to finish: the read is cut short with a partial count.
        score: async (contracts) => ({ ...result(contracts[0] === rows[0].contracts[0] ? 6 : 3), timedOut: true, complete: false }),
        store: async (id, r, _at, _through, final) => { stored.push({ id, score: r.score, final }); },
        fail: async () => {},
        attempt: async (id, at) => { rows.find((r) => r.id === id)!.score_attempted_at = at; },
        miss: async (id, m) => {
          misses.push([id, m]);
          tries[id] = (tries[id] ?? 0) + 1;
          if (tries[id] < 3) return false;
          rows.find((r) => r.id === id)!.score_final = true;
          return true;
        },
      },
    );
  const one = await pass(1);
  assert.deepEqual(one.map((o) => [o.id, o.result]), [[1, 'timed_out'], [2, 'timed_out']]);
  assert.deepEqual(misses, [[1, 'the final read did not finish in time']], 'only the full-budget attempt is a miss');
  // Entry 1's lower bound (6) beats its stored 2; entry 2's (3) is below its stored 9, so it stays.
  assert.deepEqual(stored, [{ id: 1, score: 6, final: false }]);
  // Rotation: entry 2 (older attempt) leads the next call.
  const two = await pass(2);
  assert.deepEqual(two.map((o) => o.id), [2, 1]);
  assert.deepEqual(misses.map((m) => m[0]), [1, 2]);
  for (let n = 3; n <= 6; n++) await pass(n);
  assert.deepEqual(tries, { 1: 3, 2: 3 });
  assert.ok(rows.every((r) => r.score_final), 'both frozen after 3 misses each');
});

test('final pass: an error on the full-budget attempt is a miss (not a plain failure); the third gives up', async () => {
  let n = 0;
  const failed: number[] = [];
  const out = [];
  for (let i = 0; i < 3; i++)
    out.push(
      ...(await scoreCampaignEntries(
        program,
        [row(1)],
        { now: new Date('2026-10-19T01:00:00Z'), deadline: Date.now() + 5_000, final: true, maxAgeMs: 0 },
        {
          score: async () => { throw new Error('Base explorer returned 502'); },
          store: async () => {},
          fail: async (id) => { failed.push(id); },
          attempt: async () => {},
          miss: async () => ++n >= 3,
        },
      )),
    );
  assert.deepEqual(out.map((o) => o.result), ['failed', 'failed', 'gave_up']);
  assert.deepEqual(failed, []);
});

test('gaveUpNote names the tries and the last error, capped at 300 characters', () => {
  assert.equal(
    gaveUpNote('Base explorer returned 502'),
    'Final score did not finish after 3 tries (last: Base explorer returned 502); the last score is shown and may be low.',
  );
  assert.equal(gaveUpNote('x'.repeat(500)).length, 300);
});

// Against a real database when one is configured (the local stack); skipped otherwise.
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

test('storage: fail() keeps the score; a final partial read stays partial; the attempt is recorded', db, async () => {
  const pid = `test-score-${process.pid}-${Date.now()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${pid}, 'o', 't', 'd', 'https://x', 'https://x', 'r', 's', 'closed', 'unknown')`;
  const [{ id }] = await sql()`
    INSERT INTO projects (program_id, name, repo_url) VALUES (${pid}, 'n', 'https://github.com/a/b') RETURNING id`;
  try {
    const now = new Date('2026-10-19T00:20:00Z');
    const counted = [{ wallet: '0x01', kind: 'eoa' as const }, { wallet: '0x02', kind: 'smart' as const }];
    await storeScore(id, { ...result(2), counted, complete: false, codeShare: 0.25 }, now, program.ends_at, false);
    const out = await scoreCampaignEntries(
      program,
      [row(id, { score: 2, scored_at: now, scored_through: program.ends_at })],
      { now, deadline: Date.now() + 5_000, final: true, maxAgeMs: 0 },
      { score: async () => { throw new Error('Base explorer returned 502'); } },
    );
    assert.deepEqual(out.map((o) => o.result), ['failed']);
    const [a] = await sql()`SELECT score, score_error, score_final, score_attempted_at FROM projects WHERE id = ${id}`;
    assert.deepEqual([a.score, a.score_error, a.score_final], [2, 'Base explorer returned 502', false]);
    assert.equal(a.score_attempted_at.getTime(), now.getTime());

    await scoreCampaignEntries(
      program,
      [row(id, { score: 2 })],
      { now, deadline: Date.now() + 5_000, final: true, maxAgeMs: 0 },
      { score: async () => ({ ...result(1), counted: [counted[1]], complete: false }) },
    );
    const [b] = await sql()`SELECT score, score_error, score_final, score_partial, scored_through FROM projects WHERE id = ${id}`;
    assert.deepEqual([b.score, b.score_error, b.score_final, b.score_partial], [1, null, true, true]);
    assert.equal(b.scored_through.getTime(), program.ends_at.getTime());
    const wallets = await sql()`SELECT wallet, kind FROM entry_wallets WHERE project_id = ${id}`;
    assert.deepEqual(wallets.map((w) => [w.wallet, w.kind]), [['0x02', 'smart']]);
  } finally {
    await sql()`DELETE FROM projects WHERE id = ${id}`;
    await sql()`DELETE FROM programs WHERE id = ${pid}`;
  }
});

test('storeFinalMiss: misses 1 and 2 keep the entry open with the error; the 3rd freezes it flagged partial', db, async () => {
  const pid = `test-score-miss-${process.pid}-${Date.now()}`;
  await sql()`
    INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, status, existing_work)
    VALUES (${pid}, 'o', 't', 'd', 'https://x', 'https://x', 'r', 's', 'closed', 'unknown')`;
  const [{ id }] = await sql()`
    INSERT INTO projects (program_id, name, repo_url, score) VALUES (${pid}, 'n', 'https://github.com/a/b', 7) RETURNING id`;
  try {
    assert.equal(await storeFinalMiss(id, 'timeout'), false);
    assert.equal(await storeFinalMiss(id, 'timeout'), false);
    const [a] = await sql()`SELECT final_attempts, score_final, score_partial, score_error FROM projects WHERE id = ${id}`;
    assert.deepEqual([a.final_attempts, a.score_final, a.score_partial, a.score_error], [2, false, false, 'timeout']);
    assert.equal(await storeFinalMiss(id, 'Base explorer returned 502'), true);
    const [b] = await sql()`SELECT score, final_attempts, score_final, score_partial, score_error FROM projects WHERE id = ${id}`;
    assert.deepEqual([b.score, b.final_attempts, b.score_final, b.score_partial], [7, 3, true, true]);
    assert.equal(b.score_error, gaveUpNote('Base explorer returned 502'));
    assert.equal(await storeFinalMiss(id, 'again'), false, 'a frozen entry is left alone');
  } finally {
    await sql()`DELETE FROM projects WHERE id = ${id}`;
    await sql()`DELETE FROM programs WHERE id = ${pid}`;
  }
});
