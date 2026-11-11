import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall, mcpInstructions, mcpListTools } from './fixtures/mcp-call';
import { FIND_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION, SERVER_INSTRUCTIONS, TRACK_DESCRIPTION } from './mcp';
import { SESSION_START } from './tool-text';
import { PROJECT_DESCRIPTION } from './project-input';
import { clientIp, windowStart } from './rate-limit';

after(() => sql().end());

const NOW = new Date('2026-11-04T12:00:00Z');
async function ctx() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'mcp-' + Math.random()}) RETURNING id`;
  return { installationId: r.id as number, builderId: null, now: NOW, gh: (async () => new Response('', { status: 404 })) as typeof fetch };
}

test('four tools, their descriptions and the server instructions, verbatim', async () => {
  const c = await ctx();
  const tools = await mcpListTools(c);
  assert.deepEqual(tools.map((t) => t.name), ['find', 'track', 'record', 'screen']);
  assert.equal(
    FIND_DESCRIPTION,
    'What can this repo earn: the programs it fits with every field pre-filled, the ones one change away, and the ledger. Call it first in every session with the project you are in, and again when the builder asks about money or programs. Pass every project fact you can read before the first call: chains with contract addresses, live_url, users (true only if you know), first_commit_at. Programs match on them, and a missing fact shows as a gap. With program_id: whether the project fits that program, and its details and form.',
  );
  assert.equal(
    TRACK_DESCRIPTION,
    "What the builder did: started (a claim before filling), applied (with submitted_by, and fields_used: the field keys from find's fields), won (with amount_usd; a further payment of a win already recorded is won again with that payment's amount and payment: { key } naming it, a key of your own that a retry repeats; it adds to the total once; won again without payment corrects the amount), rejected, no_result, skipped, unskip (a skipped program may come back), or gap_done (item: the gap's item from find, copied exactly as given; project: the same object you passed to find). Call started before filling and applied after every submission. The started reply's application_id is the application's id at EarnKit: put it in the form's reference field when there is one, and give it when the program asks for an EarnKit id.",
  );
  assert.equal(tools[0].description, FIND_DESCRIPTION);
  assert.equal(tools[1].description, TRACK_DESCRIPTION);
  const props = (i: number) => (tools[i].inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
  assert.ok('project_id' in props(0));
  assert.deepEqual(Object.keys(props(0)), ['project', 'program_id', 'project_id', 'ask', 'filter']);
  assert.deepEqual(['project_id', 'submitted_by', 'fields_used'].filter((k) => k in props(1)), ['project_id', 'submitted_by', 'fields_used']);
  assert.ok(props(1).status.enum?.includes('started'));
  assert.equal(
    RECORD_DESCRIPTION,
    "The builder's record: facts, links, documents and answers, kept once and read by every agent of theirs. Call it with get after find, once find's reply has linked true; call it with set for every new fact the builder gives; with brief for the question and facts behind one answer kind.",
  );
  assert.equal(tools[2].description, RECORD_DESCRIPTION);
  assert.equal(
    SCREEN_DESCRIPTION,
    "For a program's reviewer: hand EarnKit the applicant list, each { ref (your id for them, required), name, repo_url, live_url, contracts: [{ chain, address }], pitch, application_id (the EarnKit id the applicant gave you, if any), requeue ({ job_id, ref } of the earlier row this one replaces, when you queue an applicant again; that row must be in this program's screens with the same application_id) }, and get it back in named tiers with public evidence; with job_id, progress and results, 25 applicants a page (page, from 1; next_page names the next, null on the last); with outcomes, who won (amount_usd, or amount with a three-letter currency code; cents allowed; a further payment of one win: won again with that payment's amount and payment: { key }, a key of your own that a retry repeats; it adds once; won again without payment corrects the amount). Every reviewer of the program reads and continues its screens, for 180 days.",
  );
  assert.equal(tools[3].description, SCREEN_DESCRIPTION);
  assert.equal(
    SERVER_INSTRUCTIONS,
    "Call find first in every session with the project you are in, unless the builder is only screening applicants. Call record with get after that, and only when find's reply has linked true. Show find's reply as given; shorten if you must, keep money first and the last action. Draft every form from find's fields: 'earnkit' and 'record' values as given, 'agent' values you draft from the field's sources, 'builder' values you ask the builder for once, all together; approved answers fitted by cutting, never by adding. Anything the builder tells you that a form could ask, save with record before using it. Submit in your own browser only after track started, and only when the builder said yes or their standing approval covers it. After each submission call track applied. When find's reply carries a sign-in link, show it once as the reply gives it; until the builder signs in, nothing is saved across agents. Never write a sentence about traction yourself. Never name tools, fields or files. Never invent an amount, a deadline or a rule.",
  );
  assert.equal(await mcpInstructions(c), SERVER_INSTRUCTIONS);
  assert.ok(SERVER_INSTRUCTIONS.startsWith(SESSION_START));
  assert.ok(!SERVER_INSTRUCTIONS.includes('in your own words'));
});

test('find strips unknown keys; track refuses them with its one line, the detail in the agent note (C35, C21)', async () => {
  const c = await ctx();
  const f = await mcpCall(c, 'find', { project: { name: 'X', description: 'An app.' }, wallet: '0xabc', github_user: 'someone' });
  assert.equal(f.isError, false, f.text);
  assert.ok(typeof f.reply!.show_to_builder === 'string');
  const t = await mcpCall(c, 'track', { program_id: 'alliance-all19', status: 'skipped', extra: 1 });
  assert.equal(t.isError, false, t.text);
  assert.equal(t.reply!.show_to_builder, 'I could not read that. Send the program, a status, and for a win the amount.');
  assert.match(t.reply!.agent_note as string, /^Nothing was recorded\. .*extra/);
  const e = await mcpCall(c, 'track', {});
  assert.equal(e.isError, false, e.text);
  assert.equal(e.reply!.show_to_builder, 'I could not read that. Send the program, a status, and for a win the amount.');
  assert.match(e.reply!.agent_note as string, /program_id/);
  assert.doesNotMatch(e.text, /MCP error|Input validation/);
  const w = await mcpCall(c, 'track', { program_id: 5, status: 'maybe', amount_usd: 'lots' });
  assert.equal(w.reply!.show_to_builder, 'I could not read that. Send the program, a status, and for a win the amount.');
  const [n] = await sql()`SELECT count(*)::int AS n FROM application_history WHERE installation_id = ${c.installationId}`;
  assert.equal(n.n, 0);
});

test('track, record and screen advertise the same strict schemas they enforce inside (C35)', async () => {
  const tools = await mcpListTools(await ctx());
  const schema = (i: number) => tools[i].inputSchema as { properties: Record<string, { enum?: string[]; type?: string }>; required?: string[]; additionalProperties?: unknown };
  assert.deepEqual(schema(1).required, ['program_id', 'status']);
  assert.equal(schema(1).additionalProperties, false);
  assert.equal(schema(1).properties.amount_usd.type, 'number');
  assert.equal(schema(2).additionalProperties, false);
  assert.equal(schema(2).properties.get.type, 'boolean');
  assert.equal(schema(3).additionalProperties, false);
  assert.equal(schema(3).properties.job_id.type, 'string');
});

test('T5, T6 (v6.1.14): find and track take one project schema; screen names ref, repo_url and live_url, with ref required', async () => {
  const tools = await mcpListTools(await ctx());
  type S = { properties: Record<string, { description?: string; properties?: Record<string, unknown>; items?: { required?: string[]; properties?: Record<string, unknown> } }> };
  const props = (i: number) => (tools[i].inputSchema as S).properties;
  assert.equal(props(0).project.description, PROJECT_DESCRIPTION);
  assert.equal(props(1).project.description, PROJECT_DESCRIPTION);
  assert.deepEqual(Object.keys(props(1).project.properties ?? {}), Object.keys(props(0).project.properties ?? {}));
  assert.deepEqual(Object.keys(props(0).project.properties ?? {}), ['name', 'description', 'repo_url', 'live_url', 'demo_url', 'chains', 'first_commit_at', 'last_commit_at', 'private', 'builder_codes', 'users']);
  for (const k of ['ref', 'repo_url', 'live_url']) assert.ok(SCREEN_DESCRIPTION.includes(k), k);
  assert.match(SCREEN_DESCRIPTION, /ref \(your id for them, required\)/);
  assert.deepEqual(props(3).applicants.items?.required, ['ref']);
  assert.ok(!/projects \(by id\)|standing approval/.test(RECORD_DESCRIPTION + JSON.stringify(props(2))));
  assert.match(JSON.stringify(props(2).set), /projects as a list/);
});

test('T1, Review Focus 3 (v6.1.14): find and track keep a chain object passed without mainnet, with no problem line', async () => {
  const c = await ctx();
  const project = { name: 'Chainy', description: 'An app.', chains: [{ chain: 'base', contract: '0x' + 'c'.repeat(40) }, 'arc'] };
  const f = await mcpCall(c, 'find', { project });
  assert.equal(f.isError, false, f.text);
  assert.ok(!JSON.stringify(f.reply!.problems ?? []).includes('mainnet'), JSON.stringify(f.reply!.problems));
  assert.doesNotMatch(f.reply!.show_to_builder as string, /needs a contract on Base/);
  const t = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped', project });
  assert.equal(t.isError, false, t.text);
  assert.doesNotMatch(t.reply!.agent_note as string, /mainnet/);
});

test('F3 (v6.1.14 fix round 1): a find with program_id says linked as the default find does', async () => {
  const c = await ctx();
  const one = await mcpCall(c, 'find', { program_id: 'base-builder-grants', project: { name: 'X', description: 'An app.' } });
  assert.equal(one.isError, false, one.text);
  assert.equal(one.reply!.linked, false);
  const unknown = await mcpCall(c, 'find', { program_id: 'no-such-program-at-all' });
  assert.equal(unknown.reply!.linked, false);
});

test('B4: arguments nested past 64 levels are the plain line, never a stack overflow', async () => {
  const c = await ctx();
  let deep: unknown = 'x';
  for (let i = 0; i < 200; i += 1) deep = { a: deep };
  for (const [name, args] of [['record', { set: deep }], ['track', { program_id: 'x', status: 'started', note: deep }], ['screen', { thresholds: deep }], ['find', { project: { name: deep, description: 'd' } }]] as const) {
    const r = await mcpCall(c, name, args as Record<string, unknown>);
    assert.equal(r.isError, false, r.text);
    assert.equal(r.reply!.show_to_builder, 'I could not read that.');
    assert.equal(r.reply!.agent_note, 'The arguments were nested too deep.');
  }
});

test('find takes ask leniently: rules shows the rules list, any other value is ignored (v6.1.8, 1b)', async () => {
  const c = await ctx();
  const project = { name: 'X', description: 'An app.' };
  const plain = await mcpCall(c, 'find', { program_id: 'base-builder-grants', project });
  const other = await mcpCall(c, 'find', { program_id: 'base-builder-grants', project, ask: 'everything' });
  const rules = await mcpCall(c, 'find', { program_id: 'base-builder-grants', project, ask: 'rules' });
  assert.equal(other.isError, false, other.text);
  assert.equal(other.reply!.show_to_builder, plain.reply!.show_to_builder);
  assert.doesNotMatch(plain.reply!.show_to_builder as string, /^Rules:$/m);
  assert.match(rules.reply!.show_to_builder as string, /^Rules:$/m);
});

test('C17: an unknown project_id is a problem line on find, and named in the agent note on track', async () => {
  const c = await ctx();
  const f = await mcpCall(c, 'find', { project_id: 'nope', project: { name: 'X', description: 'An app.' } });
  assert.equal(f.isError, false, f.text);
  assert.ok((f.reply!.problems as string[]).includes('project_id not known; matched without it'));
  // Problem lines carry no stop of their own, so the note never reads ".." (final review M2).
  assert.match(f.reply!.agent_note as string, /Some project facts were dropped: [^\n]*project_id not known; matched without it[^\n]*\. Send them corrected next time\./);
  assert.doesNotMatch(f.reply!.agent_note as string, /\.\./);
  const t = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped', project_id: 'nope' });
  assert.equal(t.isError, false, t.text);
  assert.match(t.reply!.agent_note as string, /project_id nope is not known; ignored\./);
  assert.doesNotMatch(t.reply!.show_to_builder as string, /project_id/);
});

test('a database error is the busy line', async () => {
  // An id past Postgres's integer range: the database refuses the query.
  const r = await mcpCall({ installationId: 2 ** 40, builderId: null, now: NOW }, 'find', { project: { name: 'X', description: 'An app.' } });
  assert.equal(r.isError, true);
  assert.equal(r.text, 'EarnKit is busy. Try again in a minute.');
});

const seed = (key: string, count: number) =>
  sql()`INSERT INTO rate_windows (key, window_start, count) VALUES (${key}, ${windowStart(NOW, 3_600_000)}, ${count})`;
const BUSY_HOUR = 'You have asked a lot this hour. Try again in about 60 minutes.';

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
  const later = await mcpCall({ ...c, now: new Date(NOW.getTime() + 48 * 60_000) }, 'find', {});
  assert.equal(later.text, 'You have asked a lot this hour. Try again in about 12 minutes.');
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

test('clientIp: the rightmost x-forwarded-for entry wins; x-real-ip only without one; then the socket (security M3)', () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7', 'x-real-ip': '9.9.9.9' })), '203.0.113.7');
  assert.equal(clientIp(h({ 'x-forwarded-for': '203.0.113.8' }), '10.0.0.1'), '203.0.113.8');
  assert.equal(clientIp(h({ 'x-real-ip': '203.0.113.9' }), '10.0.0.1'), '203.0.113.9');
  assert.equal(clientIp(h({}), '203.0.113.10'), '203.0.113.10');
  assert.equal(clientIp(h({})), 'unknown');
});

test('L13-4, L12-4 (v6.1.14): find and track read wrong-typed arguments leniently: the plain lines, never the library text', async () => {
  const { upsertProgram } = await import('./programs');
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'l134-users', title: 'Lenient Users Grant', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  const c = await ctx();
  const plain = (r: { isError: boolean; text: string }) => {
    assert.equal(r.isError, false, r.text);
    assert.doesNotMatch(r.text, /MCP error|Input validation|Invalid input|-32602/);
  };
  // A null or string project is no project: the open list.
  for (const project of [null, 'my app']) {
    const r = await mcpCall(c, 'find', { project });
    plain(r);
    assert.match(r.reply!.show_to_builder as string, /^Open now:|^Nothing is open right now/);
  }
  // A numeric program id is its text; one over 100 characters is no one program (the plain unknown line).
  const num = await mcpCall(c, 'find', { program_id: 12345 });
  plain(num);
  const long = await mcpCall(c, 'find', { program_id: 'x'.repeat(200) });
  plain(long);
  assert.equal(long.reply!.show_to_builder, num.reply!.show_to_builder);
  // A string filter.all reads as the boolean; a category that is not one is dropped and named for the agent.
  const P = { name: 'Lenient App', description: 'An app for lenient tests.' };
  const all = await mcpCall(c, 'find', { project: P, filter: { all: 'true' } });
  plain(all);
  assert.ok(Array.isArray(all.reply!.not_fit), 'filter.all "true" is the full list');
  const cat = await mcpCall(c, 'find', { project: P, filter: { category: 'money' } });
  plain(cat);
  assert.match(cat.reply!.agent_note as string, /Some arguments were not read: filter\.category dropped: not one of [a-z, ]+\./);
  // track with a null project: the done step goes under the last find's project.
  const done = await mcpCall(c, 'track', { program_id: 'l134-users', status: 'gap_done', item: 'users', project: null });
  plain(done);
  assert.equal(done.reply!.show_to_builder, 'Tracked.');
  const [row] = await sql()`SELECT project_key FROM gaps_done WHERE installation_id = ${c.installationId} AND program_id = 'l134-users'`;
  assert.equal(row.project_key, 'name:lenient app');
  // A string project on track is dropped and named; the step still records; a numeric program id reads as text.
  const str = await mcpCall(c, 'track', { program_id: 12345, status: 'skipped', project: 'x' });
  plain(str);
  assert.match(str.reply!.agent_note as string, /project dropped: not an object/);
});

test('readLoosely (v6.1.14, L13-4): nulls left out, numbers as text, cuts, objects, booleans and enums named when dropped', async () => {
  const { readLoosely } = await import('./tool-input');
  const rules = { text: ['a', 'f.n'], cut: { a: 3 }, objects: ['o', 'f'], booleans: ['f.all'], enums: { 'f.cat': ['grant', 'bounty'] as const } };
  assert.deepEqual(readLoosely({ a: 12345, b: null, o: 'x', f: { all: 'TRUE', cat: 'Grant', n: 7, z: null } }, rules), {
    args: { a: '123', f: { all: true, cat: 'grant', n: '7' } },
    problems: ['o dropped: not an object'],
  });
  assert.deepEqual(readLoosely({ f: { all: 'yes', cat: 'money' } }, rules), {
    args: { f: {} },
    problems: ['f.all dropped: not true or false', 'f.cat dropped: not one of grant, bounty'],
  });
  assert.deepEqual(readLoosely('nope', rules), { args: {}, problems: [] });
  assert.deepEqual(readLoosely({ f: [1] }, rules), { args: {}, problems: ['f dropped: not an object'] });
});

test('T6-F4 (v6.1.14 fix round 1): a field find still cannot read after the lenient pass is dropped and named', async () => {
  const c = await ctx();
  for (const program_id of [{}, true]) {
    const r = await mcpCall(c, 'find', { program_id });
    assert.equal(r.isError, false, r.text);
    assert.doesNotMatch(r.text, /MCP error|Input validation|Invalid input|-32602/);
    assert.match(r.reply!.agent_note as string, /Some arguments were not read: program_id dropped: not text\./);
  }
});
