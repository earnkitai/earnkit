import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall, mcpInstructions, mcpListTools } from './fixtures/mcp-call';
import { FIND_DESCRIPTION, RECORD_DESCRIPTION, SCREEN_DESCRIPTION, SERVER_INSTRUCTIONS, TRACK_DESCRIPTION, limitReply, refusedFor } from './mcp';
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
    "What can this repo earn: the programs it fits with every field pre-filled, the ones one change away, and your applications by name. Call it first in every session with the project you are in, and again when the builder asks about money or programs. Pass every project fact you can read before the first call: chains with contract addresses, live_url, users (true only if you know), first_commit_at. Programs match on them, and a missing fact shows as a gap. With program_id: whether the project fits that program, and its details and form. A project needs a description when it has no repo_url. filter.all: every program, names and money for the builder.",
  );
  assert.equal(
    TRACK_DESCRIPTION,
    "What the builder did, on program_id (the id, the name, or the number from the last find list): started (a claim before filling), applied (with submitted_by, agent when left out, and fields_used: the field keys from find's fields), won (with amount_usd, dollars as a number (5000 or 1234.56): convert 5k to 5000; a win with no application here is recorded as the builder's own send, or amount with currency for another currency: amount_usd may carry cents, amount reads 5k, $2,500.50, 2000 EUR or \u20ac2000, and with no currency a win keeps its own; a further payment of a win already recorded is won again with that payment's amount and payment: { key } naming it, a key of your own that a retry repeats; it adds to the total once; won again without payment corrects the amount), rejected, no_result, held (the builder said stop: send nothing until they say go), skipped (for good), unskip (a skipped program may come back), or gap_done (item: the gap's item from find, copied exactly as given; project: the same object you passed to find). Call started before filling and applied after every submission. The started reply's application_id is the application's id at EarnKit: put it in the form's reference field when there is one, and give it when the program asks for an EarnKit id.",
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
    "The builder's record: facts, links, documents and answers, kept once and read by every agent of theirs. Call it with get after find, once find's reply has linked true: get true reads the facts and each answer kind's length and start, and get with an answer kind reads that kind's answers in full; call it with set for every new fact the builder gives (a partial record: person, company, traction, answers keyed by kind, each { text }, and projects); with brief for the question and facts behind one answer kind. Standing approval (policy) is set on earnkit.com/me only, never here.",
  );
  assert.equal(tools[2].description, RECORD_DESCRIPTION);
  assert.equal(
    SCREEN_DESCRIPTION,
    "For a program's reviewer: hand EarnKit the applicant list, each { ref (your id for them, required), name, repo_url, live_url, contracts: [{ chain, address }], pitch, application_id (the EarnKit id the applicant gave you, if any), requeue ({ job_id, ref } of the earlier row this one replaces, when you queue an applicant again; that row must be in this program's screens with the same application_id) }, and get it back in named tiers with public evidence; with job_id, progress and results, 10 applicants a page (page, from 1; next_page names the next, null on the last); with outcomes, who won (amount_usd, or amount with a three-letter currency code; cents allowed; a further payment of one win: won again with that payment's amount and payment: { key }, a key of your own that a retry repeats; it adds once; won again without payment corrects the amount). Every reviewer of the program reads and continues its screens, for 180 days.",
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

test('L25-5 (v6.1.16): tools/list gives every tool a title; find alone is read-only', async () => {
  const tools = await mcpListTools(await ctx());
  assert.deepEqual(tools.map((t) => [t.name, t.title]), [
    ['find', 'Find what you can earn'],
    ['track', 'Track an application'],
    ['record', 'Your record'],
    ['screen', 'Screen applicants'],
  ]);
  assert.equal(tools[0].annotations?.readOnlyHint, true);
  for (const t of tools.slice(1)) assert.equal(t.annotations?.readOnlyHint, undefined, t.name);
  // L25-24 (v6.1.16): track's note is described.
  const note = (tools[1].inputSchema as { properties: Record<string, { description?: string }> }).properties.note;
  assert.equal(note.description, 'What you want remembered about this send.');
});

test('find strips unknown keys; track refuses them with its one line, the detail in the agent note (C35, C21)', async () => {
  const c = await ctx();
  const f = await mcpCall(c, 'find', { project: { name: 'X', description: 'An app.' }, wallet: '0xabc', github_user: 'someone' });
  assert.equal(f.isError, false, f.text);
  assert.ok(typeof f.reply!.show_to_builder === 'string');
  // L29-9, L29-10 (v6.1.16 Task 15): an input error is isError true, with no builder text and the fix in the note.
  const t = await mcpCall(c, 'track', { program_id: 'alliance-all19', status: 'skipped', extra: 1 });
  assert.equal(t.isError, true, t.text);
  assert.equal(t.reply!.show_to_builder, '');
  assert.match(t.reply!.agent_note as string, /^Nothing was recorded\. .*extra.*; fix it and call again\.$/);
  const e = await mcpCall(c, 'track', {});
  assert.equal(e.isError, true, e.text);
  assert.equal(e.reply!.show_to_builder, '');
  assert.match(e.reply!.agent_note as string, /program_id/);
  assert.doesNotMatch(e.text, /MCP error|Input validation/);
  const w = await mcpCall(c, 'track', { program_id: 5, status: 'maybe', amount_usd: 'lots' });
  assert.equal(w.reply!.show_to_builder, '');
  assert.equal(w.isError, true);
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
  // L26-2 (v6.1.16): get is true (the summary) or an answer kind (that kind in full).
  const get = schema(2).properties.get as { anyOf?: { type?: string; enum?: string[] }[] };
  assert.deepEqual(get.anyOf?.map((x) => x.type), ['boolean', 'string']);
  assert.ok(get.anyOf?.[1].enum?.includes('problem'));
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
  // L29-12 (v6.1.16 Task 15): every project property is typed, the name is required, and the description says when one is needed.
  for (const i of [0, 1]) {
    const project = props(i).project as unknown as { required?: string[]; description?: string; properties: Record<string, { type?: string }> };
    assert.deepEqual(project.required, ['name'], String(i));
    for (const [k, v] of Object.entries(project.properties)) assert.ok(v.type, `${i} ${k}`);
    assert.match(project.description ?? '', /A project needs a description when it has no repo_url/);
  }
  assert.equal((props(0).project as unknown as { properties: Record<string, { type?: string }> }).properties.users.type, 'boolean');
  for (const k of ['ref', 'repo_url', 'live_url']) assert.ok(SCREEN_DESCRIPTION.includes(k), k);
  assert.match(SCREEN_DESCRIPTION, /ref \(your id for them, required\)/);
  assert.deepEqual(props(3).applicants.items?.required, ['ref']);
  assert.ok(!/projects \(by id\)|standing approval/.test(RECORD_DESCRIPTION + JSON.stringify(props(2))));
  // L29-24 (v6.1.16 Task 15): set is typed; policy is not in it.
  const set = props(2).set as unknown as { properties: Record<string, unknown> };
  assert.deepEqual(Object.keys(set.properties), ['person', 'team', 'company', 'traction', 'docs', 'answers', 'projects']);
  assert.doesNotMatch(JSON.stringify(set.properties), /policy|auto_apply/);
});

test('T1, Review Focus 3 (v6.1.14): find and track keep a chain object passed without mainnet, with no problem line', async () => {
  const c = await ctx();
  const project = { name: 'Chainy', description: 'An app.', chains: [{ chain: 'base', contract: '0x' + 'c'.repeat(40) }, 'arc'] };
  const f = await mcpCall(c, 'find', { project });
  assert.equal(f.isError, false, f.text);
  assert.ok(!JSON.stringify(f.reply!.problems ?? []).includes('mainnet'), JSON.stringify(f.reply!.problems));
  assert.doesNotMatch(f.reply!.show_to_builder as string, /needs a contract on Base/);
  const t = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped', project });
  assert.equal(t.isError, true, t.text);
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
    // L29-10 (v6.1.16 Task 15): an input error.
    assert.equal(r.isError, true, r.text);
    assert.equal(r.reply!.show_to_builder, '');
    assert.equal(r.reply!.agent_note, 'The arguments were nested too deep; fix it and call again.');
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
  assert.equal(t.isError, true, t.text);
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
const OWN_LIMIT = "Your agent has used this hour's limit. Try again in about 60 minutes.";
const ADDRESS_LIMIT = 'Too many calls from your network this hour. Try again in about 60 minutes.';

test('L26-5 (v6.1.16): the 121st tool call in an hour is the own-limit line, as a tool result with retry_after_seconds', async () => {
  const c = await ctx();
  await seed(`mcp:${c.installationId}`, 119);
  const ok = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(ok.reply!.show_to_builder, 'Which program do you mean?', ok.text);
  const busy = await mcpCall(c, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(busy.isError, true);
  assert.equal(busy.text, OWN_LIMIT);
  assert.deepEqual(busy.structured, { retry_after_seconds: 3_600 });
  const f = await mcpCall(c, 'find', {});
  assert.equal(f.text, OWN_LIMIT);
  const later = await mcpCall({ ...c, now: new Date(NOW.getTime() + 48 * 60_000) }, 'find', {});
  assert.equal(later.text, "Your agent has used this hour's limit. Try again in about 12 minutes.");
  assert.deepEqual(later.structured, { retry_after_seconds: 720 });
  const next = await mcpCall({ ...c, now: new Date(NOW.getTime() + 3_600_000) }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(next.reply!.show_to_builder, 'Which program do you mean?', next.text);
});

test('the per-IP floor: the 601st call from one address in an hour is the address line, whatever the installation', async () => {
  const c = await ctx();
  await seed('mcpIp:203.0.113.9', 600);
  const busy = await mcpCall({ ...c, ip: '203.0.113.9' }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(busy.isError, true);
  assert.equal(busy.text, ADDRESS_LIMIT);
  assert.deepEqual(busy.structured, { retry_after_seconds: 3_600 });
  const other = await mcpCall({ ...c, ip: '203.0.113.10' }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(other.reply!.show_to_builder, 'Which program do you mean?', other.text);
});

test('Review Focus 16 (L26-1): 600 calls from one installation; the 480 it refuses never count on the address, and a colleague is served', async () => {
  const a = await ctx();
  const b = await ctx();
  const ip = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
  await sql()`DELETE FROM rate_windows WHERE key = ${'mcpIp:' + ip}`;
  const texts = new Map<string, number>();
  for (let i = 1; i <= 600; i++) {
    const r = await refusedFor({ ...a, ip }, NOW);
    if (i <= 120) assert.equal(r, null, `call ${i}`);
    else {
      assert.deepEqual(r, { retryAfter: 3_600, who: 'installation' }, `call ${i}`);
      const text = limitReply(r!).content[0].text;
      texts.set(text, (texts.get(text) ?? 0) + 1);
    }
  }
  assert.deepEqual([...texts], [[OWN_LIMIT, 480]]);
  const [w] = await sql()`SELECT count FROM rate_windows WHERE key = ${'mcpIp:' + ip} AND window_start = ${windowStart(NOW, 3_600_000)}`;
  assert.equal(w.count, 120);
  // Through the server: A is refused with the line and retry_after_seconds; B on the same address is served.
  const refused = await mcpCall({ ...a, ip }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(refused.text, OWN_LIMIT);
  assert.deepEqual(refused.structured, { retry_after_seconds: 3_600 });
  const mate = await mcpCall({ ...b, ip }, 'track', { program_id: 'no-such', status: 'skipped' });
  assert.equal(mate.reply!.show_to_builder, 'Which program do you mean?', mate.text);
  const [w2] = await sql()`SELECT count FROM rate_windows WHERE key = ${'mcpIp:' + ip} AND window_start = ${windowStart(NOW, 3_600_000)}`;
  assert.equal(w2.count, 121);
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
  // L29-9 (v6.1.16 Task 15): a refusal (an unknown program) is isError true, still in plain words.
  const plain = (r: { isError: boolean; text: string }, refused = false) => {
    assert.equal(r.isError, refused, r.text);
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
  plain(num, true);
  const long = await mcpCall(c, 'find', { program_id: 'x'.repeat(200) });
  plain(long, true);
  assert.equal(long.reply!.show_to_builder, num.reply!.show_to_builder);
  // A string filter.all reads as the boolean; a category that is not one is dropped and named for the agent.
  const P = { name: 'Lenient App', description: 'An app for lenient tests.' };
  const all = await mcpCall(c, 'find', { project: P, filter: { all: 'true' } });
  plain(all);
  assert.ok(Array.isArray(all.reply!.not_fit), 'filter.all "true" is the full list');
  const cat = await mcpCall(c, 'find', { project: P, filter: { category: 'money' } });
  plain(cat);
  // L29-13 (v6.1.16 Task 15): the ruled problems line.
  assert.match(cat.reply!.agent_note as string, /Some arguments were not read: category "money" was not read: use grant, hackathon, investment or bounty\./);
  // track with a null project: the done step goes under the last find's project.
  const done = await mcpCall(c, 'track', { program_id: 'l134-users', status: 'gap_done', item: 'users', project: null });
  plain(done);
  assert.equal(done.reply!.show_to_builder, 'Tracked.');
  const [row] = await sql()`SELECT project_key FROM gaps_done WHERE installation_id = ${c.installationId} AND program_id = 'l134-users'`;
  assert.equal(row.project_key, 'name:lenient app');
  // A string project on track is dropped and named; the step still records; a numeric program id reads as text.
  const str = await mcpCall(c, 'track', { program_id: 12345, status: 'skipped', project: 'x' });
  plain(str, true);
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

test('L29-30 (v6.1.16 Task 15): serverInfo.version is the package version', async () => {
  const { mcpServerInfo } = await import('./fixtures/mcp-call');
  const { default: pkg } = await import('../../package.json', { with: { type: 'json' } });
  const info = await mcpServerInfo(await ctx());
  assert.deepEqual([info?.name, info?.version], ['earnkit', pkg.version]);
  assert.equal(pkg.version, '6.1.16');
});
