import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { sql } from './db';
import { EVENT_LOG_FLAG, recordEvent } from './events';

/**
 * v2.12.1 T10: the weekly metric script, owner-run and read-only: coin offers shown, accepted and
 * launched per ISO week; reads per day against each free limit; claimed pages; the leaderboard's
 * real builders against the goal of 20 (shown, not a target). Runs as a child process against the
 * local database.
 */
const localDb = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '');
const dbTest = { skip: !process.env.DATABASE_URL ? 'no DATABASE_URL' : !localDb && 'DATABASE_URL is not a local Postgres' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const METRIC = join(import.meta.dirname, '../../scripts/v2121-metric.mts');
const ROOT = join(import.meta.dirname, '../../../..');
const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', METRIC, ...args], { cwd: ROOT, env: { ...process.env }, encoding: 'utf8' });

test('10.14 v2121-metric prints coin offers per week, reads per day against the free limits, claimed pages and the leaderboard', dbTest, async () => {
  process.env[EVENT_LOG_FLAG] = 'on';
  try {
    const tag = randomBytes(6).toString('hex');
    const at = new Date('2026-10-10T12:00:00Z'); // ISO week 2026-W41
    assert.ok(await recordEvent({ type: 'coin_offered', dedupe_key: `coin_offered:t10m:${tag}`, installation_id: 1, detail: { moment: 'has_people' }, at }));
    assert.ok(await recordEvent({ type: 'coin_answered', dedupe_key: `coin_answered:t10m:${tag}`, installation_id: 1, detail: { answer: 'yes', moment: 'has_people' }, at }));
    await sql()`INSERT INTO read_usage (day, provider, reads) VALUES ('2026-10-12', 'github_graphql', 1200), ('2026-10-12', 'arc_rpc', 30) ON CONFLICT DO NOTHING`;
  } finally {
    delete process.env[EVENT_LOG_FLAG];
  }
  const r = run('--as-of', '2026-10-14T00:00:00Z', '--days', '7');
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/^2026-W41 Coin offers: shown (\d+), accepted (\d+), launched (\d+)$/m);
  assert.ok(m, r.stdout);
  assert.ok(Number(m[1]) >= 1 && Number(m[2]) >= 1, r.stdout);
  assert.match(r.stdout, /^Reads per day \(against each free limit\)$/m);
  assert.match(r.stdout, /^2026-10-12 github_graphql: \d+ \([\d.]+% of 120,000\)$/m);
  assert.match(r.stdout, /^2026-10-12 arc_rpc: \d+ \(no published limit\)$/m);
  assert.match(r.stdout, /^Claimed pages: \d+ in the window, \d+ in total$/m);
  assert.match(r.stdout, /^Leaderboard: \d+ real builders \(goal 20, shown, not a target\)$/m);
  assert.doesNotMatch(r.stdout, /—/);
  // Bad input is refused.
  assert.equal(run('--days', '0').status, 2);
});
