import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall, mcpInstructions, mcpListTools } from './fixtures/mcp-call';
import { FIND_DESCRIPTION, RECORD_DESCRIPTION, SERVER_INSTRUCTIONS, TRACK_DESCRIPTION } from './mcp';
import { windowStart } from './rate-limit';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
async function ctx() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'mcp-' + Math.random()}) RETURNING id`;
  return { installationId: r.id as number, builderId: null, now: NOW, gh: (async () => new Response('', { status: 404 })) as typeof fetch };
}

test('three tools, their descriptions and the server instructions, verbatim', async () => {
  const c = await ctx();
  const tools = await mcpListTools(c);
  assert.deepEqual(tools.map((t) => t.name), ['find', 'track', 'record']);
  assert.equal(
    FIND_DESCRIPTION,
    'What can this repo earn: the programs it fits with every field pre-filled, the ones one change away, and the ledger. Call it at session start with the project you are in, and again when the builder asks about money or programs. With program_id: that program\'s details and form.',
  );
  assert.equal(
    TRACK_DESCRIPTION,
    'What the builder did: applied, won (with amount_usd), rejected, no_result, skipped, or gap_done (with item). Call it after every submission and every answer about a result.',
  );
  assert.equal(tools[0].description, FIND_DESCRIPTION);
  assert.equal(tools[1].description, TRACK_DESCRIPTION);
  assert.equal(
    RECORD_DESCRIPTION,
    "The builder's record: facts, links, documents, answers and standing approval, kept once and read by every agent of theirs. Call it with get at session start; call it with set for every new fact the builder gives; with brief for the question and facts behind one answer kind.",
  );
  assert.equal(tools[2].description, RECORD_DESCRIPTION);
  assert.equal(
    SERVER_INSTRUCTIONS,
    "Call record with get at the start of every session, then find with the project you are in. Open with find's reply in your own words. Draft every form from find's fields: record and repo values as given, approved answers fitted by cutting, never by adding. Anything the builder tells you that a form could ask, save with record before using it. Submit in your own browser only after track started, and only when the builder said yes or their standing approval covers it. After each submission call track applied. Never write a sentence about traction yourself. Never name tools, fields or files. Never invent an amount, a deadline or a rule.",
  );
  assert.equal(await mcpInstructions(c), SERVER_INSTRUCTIONS);
});

test('find strips unknown keys; track refuses them', async () => {
  const c = await ctx();
  const f = await mcpCall(c, 'find', { project: { name: 'X', description: 'An app.' }, wallet: '0xabc', github_user: 'someone' });
  assert.equal(f.isError, false, f.text);
  assert.ok(typeof f.reply!.show_to_builder === 'string');
  const t = await mcpCall(c, 'track', { program_id: 'alliance-all19', status: 'skipped', extra: 1 });
  assert.equal(t.isError, true, t.text);
  const [n] = await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`;
  assert.equal(n.n, 0);
});

test('a database error is the busy line', async () => {
  // An id past Postgres's integer range: the database refuses the query.
  const r = await mcpCall({ installationId: 2 ** 40, builderId: null, now: NOW }, 'find', { project: { name: 'X', description: 'An app.' } });
  assert.equal(r.isError, true);
  assert.equal(r.text, 'EarnKit is busy. Try again in a minute.');
});

const seed = (key: string, count: number) =>
  sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${key}, ${windowStart(NOW, 3_600_000)}, ${count})`;
const BUSY_HOUR = 'EarnKit is busy. Try again in an hour.';

test('the 121st tool call in an hour is the busy reply, as a tool result', async () => {
  const c = await ctx();
  await seed(`mcp:${c.installationId}`, 119);
  const ok = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(ok.isError, false, ok.text);
  const busy = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(busy.isError, true);
  assert.equal(busy.text, BUSY_HOUR);
  const f = await mcpCall(c, 'find', {});
  assert.equal(f.text, BUSY_HOUR);
  const next = await mcpCall({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(next.isError, false, next.text);
});

test('the per-IP floor: the 601st call from one address in an hour is busy, whatever the installation', async () => {
  const c = await ctx();
  await seed('mcpIp:203.0.113.9', 600);
  const busy = await mcpCall({ ...c, ip: '203.0.113.9' }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(busy.text, BUSY_HOUR);
  const other = await mcpCall({ ...c, ip: '203.0.113.10' }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(other.isError, false, other.text);
});
