import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { EVENT_LOG_FLAG } from './events';
import { RAISE_LINES, pillOf, raisingCoin, setRaising, showRaisingLine } from './raising';
import { raiseLine } from './coin-moments';

/** v2.13 T9 (spec "4. Optional: raise"): the raising flag on the one project's coin, the pill, and (scoring and clarity R8) the line for an old coin, only when the builder asks about a token. */

// Final fix: the Raising pill and asks are behind EARNKIT_RAISING (raisingEnabled); these cases are the flag on.
process.env.EARNKIT_RAISING = 'on';
process.env[EVENT_LOG_FLAG] = 'on';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = randomBytes(3).toString('hex');
// Rows are per person (per-run keys, as updates.test.ts); builder_events is append-only, so nothing is deleted.
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

/** The one project with a coin on it, as a launch writes it (token_repo_key is the normalized repo). */
async function withCoin(o: { launched?: boolean; raising?: boolean; confirmed?: boolean } = {}): Promise<{ id: number; key: string; pid: number }> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v213-raise-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  const key = `r${RUN}/p${id}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, main_project_key) VALUES (${id}, ${`v213ra-${RUN}-${id}`}, ${key})`;
  const [{ pid }] = await sql()<{ pid: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, token_repo_key, installation_id, token_symbol, token_status, token_url, raising_at)
    VALUES ('earnkit-coin', 'Recipe planner', ${`https://github.com/${key}`}, ${`github.com/${key}`}, ${id}, 'RECIPE', ${o.launched === false ? 'pending' : 'launched'},
      ${o.launched === false ? 'pending' : `https://tokens.fun/coin/${id}`}, ${o.raising ? new Date() : null}) RETURNING id AS pid`;
  // The one project, confirmed (the repo's own proof) unless `confirmed: false` (Confirming).
  await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped)
    VALUES (${id}, ${key}, 'Recipe planner', 'app', ${o.confirmed !== false}, true)`;
  if (o.confirmed !== false) await confirm(id, key);
  return { id, key, pid };
}
const confirm = async (id: number, key: string) => {
  await sql()`UPDATE builder_projects SET confirmed = true WHERE builder_id = ${id} AND project_key = ${key}`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by)
    VALUES (${id}, 'repo', ${key}, ${key}, 'verified', 'proof_line', 'agent')`;
};

test('9.1 the offer line names the coin before the yes (v3 Stage 2: the backing offer); the wallet is shown when known (B13)', () => {
  assert.equal(raiseLine('Recipe planner', 'RECIPE', null),
    'People can back Recipe planner onchain. EarnKit launches a $RECIPE coin on tokens.fun for it; you keep 40% of its trading fees. It is a tradable token on Base and can go to zero. Want to open backing for Recipe planner?');
  assert.equal(raiseLine('Recipe planner', 'RECIPE', '0x12ab000000000000000000000000000000009f3e'),
    'People can back Recipe planner onchain. EarnKit launches a $RECIPE coin on tokens.fun for it; you keep 40% of its trading fees, paid to 0x12ab…9f3e. It is a tradable token on Base and can go to zero. Want to open backing for Recipe planner?');
  assert.equal(showRaisingLine('RECIPE'), 'Want your page to show backing for $RECIPE?');
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

test('9.4 R8: the community-round line for an old coin comes only when the builder asks (tell token), as often as asked, until it shows', dbTest, async () => {
  const { id } = await withCoin();
  const { tokenAsk, RAISE_NOTE } = await import('./bench-find');
  assert.deepEqual(await tokenAsk(id), { show_to_builder: showRaisingLine('RECIPE'), agent_note: RAISE_NOTE });
  assert.deepEqual(await tokenAsk(id), { show_to_builder: showRaisingLine('RECIPE'), agent_note: RAISE_NOTE }, 'asked again: the same line');
  await setRaising(id, true);
  assert.equal((await tokenAsk(id)).show_to_builder, 'Your coin is already live.', 'already showing');
});

test('9.5 tell coin { raising } through the tool turns raising on', dbTest, async () => {
  const { id } = await withCoin();
  const { tools } = await import('./tools');
  const on = (await tools.tell({ coin: { raising: true } }, { installationId: id } as never)) as { show_to_builder: string };
  assert.equal(on.show_to_builder, RAISE_LINES.on('RECIPE'));
  assert.equal((await raisingCoin(id))?.raising, true);
  const stop = (await tools.tell({ coin: { raising: false } }, { installationId: id } as never)) as { show_to_builder: string };
  assert.equal(stop.show_to_builder, RAISE_LINES.off);
  assert.equal((await raisingCoin(id))?.raising, false);
});

test('9.6 R8: find never asks about an old coin; tell token: \'ask\' does, and tell coin { raising: true } turns it on', dbTest, async () => {
  const { id } = await withCoin();
  const { tools } = await import('./tools');
  const asked = (await tools.tell({ token: 'ask' }, { installationId: id } as never)) as { show_to_builder: string; agent_note?: string };
  assert.equal(asked.show_to_builder, showRaisingLine('RECIPE'));
  assert.match(String(asked.agent_note), /coin: \{ raising: true \}/);
  const yes = (await tools.tell({ coin: { raising: true } }, { installationId: id } as never)) as { show_to_builder: string };
  assert.equal(yes.show_to_builder, RAISE_LINES.on('RECIPE'));
  assert.deepEqual(await pillOf(id), { symbol: 'RECIPE', url: `https://tokens.fun/coin/${id}` });
  // An old reply's stored raise ask: a yes to it is "Okay." (retired), nothing changes.
  await sql()`UPDATE projects SET raising_at = NULL WHERE installation_id = ${id}`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', jsonb_build_object('kind', 'raise', 'key', (SELECT main_project_key FROM builder_profiles WHERE builder_id = ${id}))) WHERE builder_id = ${id}`;
  const [{ key }] = await sql()<{ key: string }[]>`SELECT main_project_key AS key FROM builder_profiles WHERE builder_id = ${id}`;
  const old = (await tools.tell({ move_up: { kind: 'raise', project_key: key, answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string };
  assert.equal(old.show_to_builder, 'Okay.');
  assert.equal((await raisingCoin(id))?.raising, false);
});

test('9.10 a Confirming project with a launched coin: no community-round line, setRaising(true) changes nothing, no pill; once confirmed all three work', dbTest, async () => {
  const { id, key } = await withCoin({ confirmed: false });
  const { tokenAsk, TOKEN_NOT_YET } = await import('./bench-find');
  assert.deepEqual(await tokenAsk(id), { show_to_builder: TOKEN_NOT_YET });
  assert.deepEqual(await setRaising(id, true), { show_to_builder: 'Okay.' });
  assert.equal((await raisingCoin(id))?.raising, false, 'nothing changed');
  await sql()`UPDATE projects SET raising_at = now() WHERE installation_id = ${id}`;
  assert.equal(await pillOf(id), null, 'no pill while Confirming, even with raising_at set');
  await sql()`UPDATE projects SET raising_at = NULL WHERE installation_id = ${id}`;
  await confirm(id, key);
  assert.equal((await tokenAsk(id)).show_to_builder, showRaisingLine('RECIPE'));
  assert.deepEqual(await setRaising(id, true), { show_to_builder: RAISE_LINES.on('RECIPE') });
  assert.deepEqual(await pillOf(id), { symbol: 'RECIPE', url: `https://tokens.fun/coin/${id}` });
});
