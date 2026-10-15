import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { EVENT_LOG_FLAG } from './events';
import { RAISE_LINES, pillOf, raiseAsk, raisingCoin, setRaising, showRaisingLine } from './raising';
import { raiseLine } from './coin-moments';

/** v2.13 T9 (spec "4. Optional: raise", R8): the raising flag on the one project's coin, the pill, the ask for an old coin. */

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
process.env[EVENT_LOG_FLAG] = 'on';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = randomBytes(3).toString('hex');
// Rows are per person (per-run keys, as updates.test.ts); builder_events is append-only, so nothing is deleted.
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

/** The one project with a coin on it, as a launch writes it (token_repo_key is the normalized repo). */
async function withCoin(o: { launched?: boolean; raising?: boolean } = {}): Promise<{ id: number; key: string; pid: number }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-raise-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `r${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key) VALUES (${id}, ${`v213ra-${RUN}-${id}`}, ${key})`;
  const [{ pid }] = await sql()<{ pid: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at)
    VALUES ('earnkit-coin', 'Recipe planner', ${`https://github.com/${key}`}, ${`github.com/${key}`}, ${id}, 'RECIPE', ${o.launched === false ? 'pending' : 'launched'},
      ${o.launched === false ? 'pending' : `https://tokens.fun/coin/${id}`}, ${o.raising ? new Date() : null}) RETURNING id AS pid`;
  return { id, key, pid };
}

test('9.1 the raise line names the coin before the yes, as the spec writes it; the wallet is shown when known (B13)', () => {
  assert.equal(raiseLine('Recipe planner', 'RECIPE', null), "Want to raise for Recipe planner? I'll launch $RECIPE on tokens.fun and you get 40% of its trading fees.");
  assert.equal(raiseLine('Recipe planner', 'RECIPE', '0x12ab000000000000000000000000000000009f3e'),
    "Want to raise for Recipe planner? I'll launch $RECIPE on tokens.fun and you get 40% of its trading fees, paid to 0x12ab…9f3e.");
  assert.equal(showRaisingLine('RECIPE'), "Want to show you're raising with $RECIPE?");
});

test('9.2 a coin launched before v2.13 does not show the pill until the builder says yes; stop raising removes it, the coin stays', dbTest, async () => {
  const { id, pid } = await withCoin();
  assert.equal(await pillOf(id), null, 'R8: not by itself');
  assert.deepEqual(await setRaising(id, true), { show_to_builder: RAISE_LINES.on('RECIPE') });
  assert.deepEqual(await pillOf(id), { symbol: 'RECIPE', url: `https://tokens.fun/coin/${id}` });
  assert.deepEqual(await setRaising(id, false), { show_to_builder: RAISE_LINES.off });
  assert.equal(await pillOf(id), null);
  const [p] = await sql()<{ token_status: string }[]>`SELECT token_status FROM projects WHERE id = ${pid}`;
  assert.equal(p.token_status, 'launched', 'the coin stays');
  assert.equal((await sql()`SELECT 1 FROM builder_events WHERE installation_id = ${id} AND type IN ('raising_on','raising_off')`).length, 2);
});

test('9.3 the pill shows only while the coin is launched and raising_at is set', dbTest, async () => {
  const { id } = await withCoin({ launched: false, raising: true });
  assert.equal(await pillOf(id), null);
  assert.deepEqual(await setRaising(id, true), { show_to_builder: RAISE_LINES.notLaunched });
});

test('9.4 the raise ask for an old coin comes once per project', dbTest, async () => {
  const { id, key } = await withCoin();
  const ask = await raiseAsk(id, key, {});
  assert.deepEqual(ask, { kind: 'raise', project_key: key, line: showRaisingLine('RECIPE') });
  assert.equal(await raiseAsk(id, key, { raise_asked: { [key]: new Date().toISOString() } }), null);
  await setRaising(id, true);
  assert.equal(await raiseAsk(id, key, {}), null, 'already raising');
});

test('9.5 tell coin { raising } through the tool turns raising on; flag off it is ignored', dbTest, async () => {
  const { id } = await withCoin();
  const { tools } = await import('./tools');
  delete process.env.EARNKIT_BENCH;
  try {
    const off = (await tools.tell({ coin: { raising: true } }, { installationId: id } as never)) as { show_to_builder: string };
    assert.equal(off.show_to_builder, 'Okay.');
    assert.equal((await raisingCoin(id))?.raising, false, 'flag off: nothing changed');
  } finally {
    process.env.EARNKIT_BENCH = 'on';
  }
  const on = (await tools.tell({ coin: { raising: true } }, { installationId: id } as never)) as { show_to_builder: string };
  assert.equal(on.show_to_builder, RAISE_LINES.on('RECIPE'));
  assert.equal((await raisingCoin(id))?.raising, true);
  const stop = (await tools.tell({ coin: { raising: false } }, { installationId: id } as never)) as { show_to_builder: string };
  assert.equal(stop.show_to_builder, RAISE_LINES.off);
  assert.equal((await raisingCoin(id))?.raising, false);
});

test('9.6 the Bench asks an old coin once (raise_asked), and the move_up yes to it turns raising on', dbTest, async () => {
  const { id, key } = await withCoin();
  const { coinAskBench } = await import('./bench-find');
  const p = { key, name: 'Recipe planner', confirmed: true, live: true, weeks: 2, people: 3, has_coin: true, streak: 0, shipped: true };
  assert.deepEqual(await coinAskBench(id, p, {}), { kind: 'raise', project_key: key, line: showRaisingLine('RECIPE') });
  const [s] = await sql()<{ seen: { raise_asked?: Record<string, string> } }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${id}`;
  assert.ok(s.seen.raise_asked?.[key], 'marked as asked');
  assert.equal(await coinAskBench(id, p, s.seen), null, 'once per project');
  // The reply stored the ask; the yes is answered as asked.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('bench_ask', jsonb_build_object('kind', 'raise', 'key', ${key}::text)) WHERE builder_id = ${id}`;
  const { tools } = await import('./tools');
  const yes = (await tools.tell({ move_up: { kind: 'raise', project_key: key, answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string };
  assert.equal(yes.show_to_builder, RAISE_LINES.on('RECIPE'));
  assert.deepEqual(await pillOf(id), { symbol: 'RECIPE', url: `https://tokens.fun/coin/${id}` });
});
