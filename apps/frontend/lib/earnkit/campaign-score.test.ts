import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCampaignEntries, type ScoreRow } from './campaign-score';

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
    },
  );
  assert.deepEqual(out.map((o) => o.result), ['skipped', 'timed_out']);
  assert.deepEqual(stored, [{ id: 2, through: null }]);
});
