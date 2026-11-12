import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { guideText } from './guide';
import { replayFetch } from './fixtures/github';
import { mcpCall } from './fixtures/mcp-call';
import { lastGaps } from './installations';
import { shownReadyOf } from './find';
import { parseProject } from './project-input';
import { FULL_LIST_STYLE_NOTE, FULL_RULE_SAY, REPO_STEP_NOTE, gapLine, inPersonLine, readyLine } from './reply';
import type { GapProgram, ReadyProgram } from './find';
/** L29-7 (v6.1.16 Task 15): every ready program of a find reply: what the agent may send, in person and the builder's to send. */
const allReady = (r: Record<string, unknown>): unknown[] => [...((r.ready as unknown[]) ?? []), ...((r.in_person as unknown[]) ?? []), ...((r.you_send as unknown[]) ?? [])];
/**
 * L29-26 (v6.1.16 Task 15): filter.all's builder text is names and money only; each listed program's full line as the
 * default view would write it (from the JSON lists), one per line in number order, then the builder text.
 */
/** L29-26 (v6.1.16 Task 15): what the builder sees, then the agent note, whose "Not shown to the builder" lines are the default view's rest. */
const seen = (r: Record<string, unknown>): string => [r.show_to_builder as string, r.agent_note as string].join('\n');
const listText = (r: Record<string, unknown>): string => {
  const items = [...(allReady(r) as ReadyProgram[]), ...(r.gaps as GapProgram[])].sort((a, b) => a.n - b.n);
  const line = (x: ReadyProgram | GapProgram) => ('gap' in x ? gapLine(x) : x.in_person ? inPersonLine(x) : readyLine(x, r.linked === true, NOW));
  return [...items.map(line), r.show_to_builder as string].join('\n');
};
/** A block of the reply: its heading and the numbered lines under it (L29-26, v6.1.16 Task 15: one line each, no blank lines). */
const blockOf = (show: string, head: string) => {
  const ls = show.split('\n');
  const i = ls.findIndex((l) => l.startsWith(head));
  if (i < 0) return '';
  const out = [ls[i]];
  for (const l of ls.slice(i + 1)) {
    if (!/^\d+\. /.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
};

after(() => sql().end());
beforeEach(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;
const CLOSINGS = [
  // FR-1 (v6.1.16 Task 14 fix round 1): signed out with a repo, sign-in comes first: no apply offer until linked.
  /Sign in once and I check the repo is yours; then say yes\.$/,
  // v6.1.8 (1a): one action. The gap lines carry their own "do n" and "yes n".
  // L24-9 (v6.1.16 Task 11): "ready" when other blocks are listed.
  // L29-17, L29-27 (v6.1.16 Task 15): no second action; a yes that needs answers names them.
  /Say yes and (?:tell me [^\n]+, and )?I apply to all \d+( ready)?\.$/,
  /Say yes and tell me [^\n]+, and I (?:apply to|draft) [^\n]+\.$/,
  /Nothing is ready yet\. Do real people use it\? Say yes, sign in once( at \S+)?, and I check\.$/,
  // L24-8, L24-10 (v6.1.16 Task 11): the do offer and the drafts fold into this one.
  /Say yes and I apply to (?!all \d+( ready)?\. )[^\n]+\.$/,
  // L24-28 (v6.1.16 Task 11): the one ready program over the limit.
  /[^\n]+ is over your limit\. Say yes and I apply\.$/,
  /Say yes and I draft all \d+ for you to send\.$/,
  /Say yes and I draft it for you to send\.$/,
  /Nothing is ready yet\.( Say "yes \d+" if that rule fits you and I get it ready\.| Say "do \d+" and I [^\n]+\.)?$/,
  // O2 (v6.1.10): in-person programs listed and nothing remote ready.
  /Nothing remote is ready yet\. Say yes and I start the in-person applications\.$/,
  /Nothing fits yet\. Ask again any time and I show what is new\.$/,
  // L24-11 (v6.1.16 Task 11): the one standing-approval line.
  /Applying now to [^\n]+ under your standing approval\. (Say stop and I hold any of them|Say yes and I also apply to [^\n]+)\.$/,
];

async function installation() {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'find-' + Math.random()}) RETURNING id`;
  return r.id as number;
}
const rec = replayFetch('earnkit');
// The agent knows the live link (it passes it); whether real people use it, it does not say.
const PROJECT = { name: 'EarnKit', description: 'Grants for builders.', repo_url: `https://github.com/${rec.repo}`, live_url: 'https://earnkit.com' };
const ctx = (id: number, now = NOW) => ({ installationId: id, builderId: null, now, gh: rec.fetch });
/** The first find after a link ends with the linked notice (security M2). */
const NOTICE_TAIL = '';
const ids = (xs: unknown) => (xs as { program_id: string }[]).map((x) => x.program_id);

test('first find has no since', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const reply = r.reply!;
  assert.deepEqual(reply.since, { from: null, new: [], changed: [], closing: [] });
  const show = reply.show_to_builder as string;
  assert.ok(!show.includes('Since'));
  assert.ok(CLOSINGS.some((c) => c.test(show)), show);
  // Up to five remote and two in person (v6.1.4).
  const shownReady = allReady(reply) as { in_person: boolean }[];
  assert.ok(shownReady.filter((p) => !p.in_person).length > 0 && shownReady.filter((p) => !p.in_person).length <= 5);
  assert.ok(shownReady.filter((p) => p.in_person).length <= 2);
  assert.ok((reply.gaps as unknown[]).length <= 3);
  assert.equal(reply.as_reported, false);
  const [row] = await sql()`SELECT last_find_at FROM installations WHERE id = ${id}`;
  assert.equal((row.last_find_at as Date).toISOString(), NOW.toISOString());
  const first = (allReady(reply) as { fields: { from: string }[]; filled: number }[])[0];
  assert.ok(first.fields.length > 0);
  assert.doesNotMatch(show, /—|\b(coin|points|score|rank|streak|token)s?\b/i);
  // #10 (v6.1.15): the reply is shown as given, never retold.
  const note = reply.agent_note as string;
  assert.ok(note.startsWith("Show find's reply as given; shorten if you must, keep money first and the last action. No emojis, no em dashes, no invented facts."), note);
  assert.ok(!JSON.stringify(reply).includes('in your own words'));
  assert.equal(
    show,
    [
      "Ready to apply (1):",
      "1. Arbitrum Mentorship Program: Cohort 2, up to $100,000, closes Dec 6. Long odds: few prizes for many entries.",
      "One step away (3):",
      // L1i-2 (v6.1.16.1): every step row the budget allows, numbered as shown.
      "2. Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app and tell me if real people use it.",
      "3. Base Ecosystem Fund, pre-seed and seed investment, amount not stated. Their rule: a pre-seed or seed stage startup that chooses Base as its home.",
      "4. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.",
      // L1j-3 (v6.1.17): the in-person rows left out are counted. L18-1 (v6.1.18): with the rows the rank cap left out.
      'And 32 more in the full list.',
      // L28-8 (v6.1.16 Task 14): the founders count and the time commitment are the builder's team facts to give.
      // FR-1 (v6.1.16 Task 14 fix round 1): signed out with a repo, sign-in comes first.
      'Sign in once and I check the repo is yours; then say yes.',
    ].join('\n'),
  );
  // Only what nobody but the builder can give: no contacts or team. Whole words, so a program named Team1 is not "team".
  for (const p of allReady(reply) as { needs: string[]; setup: string[] }[])
    for (const n of p.needs.filter((x) => !p.setup.includes(x))) assert.doesNotMatch(n, /email|name|\bteam\b|telegram|x profile/i);
});

test('find saves every gap it found for track to read (last_gaps: what, kind and item)', async () => {
  type G = { program_id: string; gap: { what: string; kind: string; item: string } };
  // Every gap of this project, with its first gap's what, kind and item, as filter.all lists them.
  const every = (await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } })).reply!.gaps as G[];
  const want = Object.fromEntries(every.map((g) => [g.program_id, { what: g.gap.what, kind: g.gap.kind, item: g.gap.item }]));
  assert.ok(Object.values(want).some((g) => g.kind === 'rule'), 'fixture needs a rule gap');
  // A default find shows only some of them, and still saves them all.
  const id = await installation();
  const shown = (await mcpCall(ctx(id), 'find', { project: PROJECT })).reply!.gaps as G[];
  assert.ok(every.length > shown.length, `fixture needs more gaps than a default find shows: ${every.length} vs ${shown.length}`);
  const saved = await lastGaps(id);
  assert.deepEqual(saved, want);
  assert.ok(Object.keys(saved).length > shown.length);
  for (const g of shown) assert.equal(saved[g.program_id].what, g.gap.what);
});

test('a category filter stamps the time and keeps the last gaps; filter.all and a default find write them (v6.1.7, C24a)', async () => {
  const id = await installation();
  await mcpCall(ctx(id), 'find', { project: PROJECT });
  const before = await lastGaps(id);
  assert.ok(Object.keys(before).length > 0);
  const later = new Date(NOW.getTime() + H);
  const r = await mcpCall(ctx(id, later), 'find', { project: PROJECT, filter: { category: 'investment' } });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(await lastGaps(id), before);
  const [row] = await sql()`SELECT last_find_at FROM installations WHERE id = ${id}`;
  assert.equal((row.last_find_at as Date).toISOString(), later.toISOString());
  // A category with all is still a category: kept.
  await mcpCall(ctx(id, later), 'find', { project: PROJECT, filter: { category: 'investment', all: true } });
  assert.deepEqual(await lastGaps(id), before);
  // filter.all writes them (the same gaps a default find has).
  await sql()`UPDATE installations SET last_gaps = '{}'::jsonb WHERE id = ${id}`;
  await mcpCall(ctx(id, later), 'find', { project: PROJECT, filter: { all: true } });
  assert.deepEqual(await lastGaps(id), before);
  // A default find replaces them.
  await sql()`UPDATE installations SET last_gaps = '{}'::jsonb WHERE id = ${id}`;
  await mcpCall(ctx(id, later), 'find', { project: PROJECT });
  assert.deepEqual(await lastGaps(id), before);
});

test('default list: in-person programs never take a remote ready slot (v6.1.4)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  const show = r.reply!.show_to_builder as string;
  const ready = allReady(r.reply!) as { title: string; in_person: boolean }[];
  const remote = ready.filter((p) => !p.in_person);
  const attend = ready.filter((p) => p.in_person);
  assert.ok(remote.length >= 1 && remote.length <= 5, show);
  assert.ok(attend.length <= 2, show);
  assert.match(show, /^Ready to apply/m);
  // v6.1.6 (R18a): rule-only programs are one answer away, so one remote program is ready, as in v6.1.4.
  assert.deepEqual(remote.map((p) => p.title), ['Arbitrum Mentorship Program: Cohort 2'], show);
  const block = show.split(/\n\nIn person \(\d+\):\n/)[1]?.split('\n\n')[0] ?? '';
  assert.ok(block.split('\n').filter(Boolean).length <= 2, show);
});

/** A synthetic in-person program (the real ones close once their attend-by date passes). */
async function withInPerson<T>(run: () => Promise<T>): Promise<T> {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-attend', title: 'Attend Summit', in_person: true, setup: ['apply to attend and get accepted'] }), 'file', NOW);
  try {
    return await run();
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-attend'`;
  }
}

test('the numbers the builder sees are the n of each item: ready in order, gaps, then in person', async () => withInPerson(async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { all: true } });
  const reply = r.reply!;
  const show = reply.show_to_builder as string;
  const ready = allReady(reply) as { program_id: string; title: string; n: number; in_person: boolean }[];
  const gaps = reply.gaps as { program_id: string; title: string; n: number }[];
  const printed = (n: number) => new RegExp(`^${n}\\. ([^,]+),`, 'm').exec(show)?.[1];
  // The full list, so the synthetic in-person program shows past the default two (v6.1.4).
  assert.equal(printed(1), ready[0].title);
  assert.deepEqual([ready[0].in_person, ready[0].n], [false, 1]);
  assert.equal(printed(ready[3].n), ready[3].title);
  const inPerson = ready.find((p) => p.in_person)!;
  assert.equal(printed(inPerson.n), inPerson.title);
  // The real in-person programs are open now too: from the first in-person one on, every ready item is in person,
  // numbered after every step; the rule-only in-person programs follow them in the In person block (O2, v6.1.10).
  assert.equal(inPerson.program_id, 'f-attend');
  const attendRule = (g: { in_person?: boolean; gap: { kind: string }; also: { kind: string }[] }) => g.in_person === true && [g.gap, ...g.also].every((x) => x.kind === 'rule');
  const steps = (gaps as unknown as Parameters<typeof attendRule>[0][]).filter((g) => !attendRule(g)) as unknown as typeof gaps;
  const ruled = gaps.filter((g) => !steps.includes(g));
  assert.ok(ruled.length > 0 && ruled.some((g) => g.program_id === 'antler-us-residency'), JSON.stringify(ids(ruled)));
  assert.ok(ready.slice(ready.indexOf(inPerson)).every((p) => p.in_person && steps.every((g) => g.n < p.n) && ruled.every((g) => g.n > p.n)));
  // L29-26 (v6.1.16 Task 15): the full view is names and money, one per line, by number.
  assert.equal(printed(ruled[0].n), ruled[0].title);
  for (const x of [...ready, ...gaps]) assert.equal(printed(x.n), x.title, String(x.n));
  assert.deepEqual([...ready, ...gaps].map((x) => x.n).sort((a, b) => a - b), Array.from({ length: ready.length + gaps.length }, (_, i) => i + 1));
  assert.match(reply.agent_note as string, /numbers the builder says are each item's n/);
}));

test('a deadline moved since the last find', async () => {
  const id = await installation();
  await sql()`UPDATE programs SET created_at = ${new Date(NOW.getTime() - 1000 * H)}`;
  await mcpCall(ctx(id), 'find', { project: PROJECT });
  const p = (await getProgram('alliance-all19'))!.file;
  await upsertProgram({ ...p, ends_at: '2026-11-25T23:59:59Z' }, 'file', new Date(NOW.getTime() + H));
  try {
    const r = await mcpCall(ctx(id, new Date(NOW.getTime() + 2 * H)), 'find', { project: PROJECT });
    const since = r.reply!.since as { changed: { program_id: string; what: string }[] };
    assert.equal(since.changed[0].program_id, 'alliance-all19');
    assert.match(since.changed[0].what, /^deadline moved/);
    assert.match(r.reply!.show_to_builder as string, /\nSince Nov 4: Alliance ALL19: deadline moved to Nov 25\.\n/);
  } finally {
    // Later pins quote Alliance's real deadline.
    await upsertProgram(p, 'file', new Date(NOW.getTime() + 3 * H));
  }
});

test('a skipped program leaves ready and gaps', async () => {
  const id = await installation();
  const before = await mcpCall(ctx(id), 'find', { project: PROJECT });
  const top = ids(allReady(before.reply!))[0];
  const t = await mcpCall(ctx(id), 'track', { program_id: top, status: 'skipped' });
  assert.equal(t.isError, false, t.text);
  const after = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.ok(!ids(allReady(after.reply!)).includes(top));
  assert.ok(!ids(after.reply!.gaps).includes(top));
});

test('find with program_id: the fields and the verdict; no link and no rules list for the builder (v6.1.8, 1b)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'alliance-all19', project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const reply = r.reply!;
  assert.ok(Array.isArray(reply.fields) && (reply.fields as unknown[]).length > 0);
  assert.equal((reply.program as { id: string; submission_url: string }).id, 'alliance-all19');
  assert.equal((reply.program as { submission_url: string }).submission_url, 'https://alliance.xyz/apply');
  assert.ok(reply.verdict);
  // In person and ready: the in-person line of the list without its number; L1j-7 (v6.1.17): then its one action.
  assert.equal(reply.show_to_builder, "Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.\nYou apply in person; the guide has the steps.");
  const bare = await mcpCall(ctx(id), 'find', { program_id: 'alliance-all19' });
  assert.ok((bare.reply!.fields as { value: unknown }[]).every((f) => f.value === null));
  const none = await mcpCall(ctx(id), 'find', { program_id: 'no-such-program' });
  // L29-9, L29-15 (v6.1.16 Task 15): a refusal, and a question.
  assert.equal(none.isError, true);
  // L1j-2 (v6.1.17): the name it was given.
  assert.equal(none.reply!.show_to_builder, 'I do not know a program called "no-such-program". Say its full name.');
  assert.ok((none.reply!.show_to_builder as string).length > 0);
});

test('find with program_id for YC: in person, the line says what attending takes and asks nothing more (v6.1.8)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'y-combinator', project: PROJECT });
  assert.equal(r.isError, false, r.text);
  // L1j-7 (v6.1.17): one closing action.
  assert.equal(r.reply!.show_to_builder, 'Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.\nYou apply in person; the guide has the steps.');
});

test('find with program_id and no project: the money, the rules list, no link and no draft offer; the agent is told to pass the project (v6.1.8, 1b)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'base-builder-grants' });
  assert.equal(r.isError, false, r.text);
  const guide = r.reply!.guide as { title: string; rules: string[]; eligibility: string[] };
  assert.equal(guide.title, 'Base Builder Grant Program');
  assert.ok(guide.rules.length > 0 && guide.eligibility.includes('A live product.'));
  // L26-4 (v6.1.16 Task 12): the builder lines keep every rule; guide.rules carries the first two.
  const every = guideText((await getProgram('base-builder-grants'))!, NOW).rules;
  assert.deepEqual(guide.rules, every.slice(0, 2));
  assert.equal(r.reply!.show_to_builder, ['Base Builder Grant Program, up to $5,000, rolling.', 'Rules:', ...every.map((x) => `- ${x}`)].join('\n'));
  assert.equal(r.reply!.agent_note, 'Call find with the project for whether you fit.');
  const none = await mcpCall(ctx(id), 'find', { program_id: 'no-such-program' });
  assert.equal(none.reply!.guide, null);
});

test('#12, L1g-4 (v6.1.15): the reply reads the money lowercase mid-sentence; EUR, $ and NYC stay', async () => {
  const id = await installation();
  const first = async (program_id: string) => ((await mcpCall(ctx(id), 'find', { program_id })).reply!.show_to_builder as string).split('\n')[0];
  assert.equal(await first('sovereign-tech-fund'), 'Sovereign Tech Fund, funds work from EUR 50,000, rolling.');
  assert.match(await first('lido-lego-grants'), /^LEGO: Lido Ecosystem Grants Organization, up to \$100,000 by tier, more by DAO vote, /);
  assert.equal(await first('base-builder-grants'), 'Base Builder Grant Program, up to $5,000, rolling.');
  assert.match(await first('uniswap-foundation-open-grants'), /^Uniswap Foundation Open Grants, amount not stated, set by milestone budget, /);
});

const dash1b = replayFetch('nextjs-dashboard');
test('1b (v6.1.8): Base Builder Grants for a web2 SaaS says it is not a fit, as the list does, and offers no draft', async () => {
  const saas = { name: 'Dashboard', description: 'An admin dashboard.', repo_url: `https://github.com/${dash1b.repo}` };
  const c = { installationId: await installation(), builderId: null, now: NOW, gh: dash1b.fetch };
  const r = await mcpCall(c, 'find', { program_id: 'base-builder-grants', project: saas });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.show_to_builder, 'Base Builder Grant Program, up to $5,000. Not a fit: needs a contract on Base.');
  assert.equal(r.reply!.agent_note, 'It does not fit this project: draft nothing and submit nothing unless the builder asks again with a project it fits.');
  const all = await mcpCall({ ...c, installationId: await installation() }, 'find', { project: saas, filter: { all: true } });
  assert.equal((all.reply!.not_fit as { program_id: string; reason: string }[]).find((n) => n.program_id === 'base-builder-grants')?.reason, 'needs a contract on Base');
  // On a contract on Base, the one change left is EarnKit's: "do" names it.
  const onBase = await mcpCall({ ...c, installationId: await installation() }, 'find', {
    program_id: 'base-builder-grants', project: { ...saas, live_url: 'https://dash.example.com', users: true, chains: [{ chain: 'base', mainnet: true }] },
  });
  assert.equal(onBase.reply!.show_to_builder, ['Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app.', 'Say "do" and I add Base Builder Codes to the app first.'].join('\n'));
  assert.match(onBase.reply!.agent_note as string, /^On "do": make the gap's change/m);
  // Asked for the rules: the list sits between the line and the action.
  const asked = await mcpCall({ ...c, installationId: await installation() }, 'find', {
    program_id: 'base-builder-grants', ask: 'rules', project: { ...saas, live_url: 'https://dash.example.com', users: true, chains: [{ chain: 'base', mainnet: true }] },
  });
  // L26-4 (v6.1.16 Task 12): guide.rules carries two; the builder lines every rule.
  const rules = guideText((await getProgram('base-builder-grants'))!, NOW).rules;
  assert.deepEqual((asked.reply!.guide as { rules: string[] }).rules, rules.slice(0, 2));
  assert.equal(asked.reply!.show_to_builder, ['Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app.', 'Rules:', ...rules.map((x) => `- ${x}`), 'Say "do" and I add Base Builder Codes to the app first.'].join('\n'));
  assert.doesNotMatch(asked.reply!.agent_note as string, /ask 'rules'/);
});

test('1b (v6.1.8): Solana Foundation Grants for a Solana dapp names the one rule and asks for a yes', async () => {
  const saber = replayFetch('saber-distributor');
  const devnet = ((u: RequestInfo | URL) =>
    String(u).endsWith('/Anchor.toml') ? Promise.resolve(new Response('[programs.devnet]\nx = "y"\n[provider]\ncluster = "devnet"')) : saber.fetch(u)) as typeof fetch;
  const project = { name: 'Orca Whirlpools', description: 'Concentrated liquidity DEX on Solana', repo_url: `https://github.com/${saber.repo}`, live_url: 'https://www.orca.so', users: true, chains: [{ chain: 'solana', mainnet: true, contract: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc' }] };
  const r = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: devnet }, 'find', { program_id: 'solana-foundation-grants', project });
  assert.equal(r.isError, false, r.text);
  assert.equal(
    r.reply!.show_to_builder,
    [
      'Solana Foundation Grants, milestone grants, amount not stated. Their rule: a public good, meaning a significant open source contribution to the Solana ecosystem or a free community offering.',
      'Say yes if that is you and I draft it.',
    ].join('\n'),
  );
  const note = (r.reply!.agent_note as string).split('\n');
  assert.ok(note.some((l) => l.startsWith('A "Their rule" gap is a program rule EarnKit cannot check.')));
  assert.ok(note.includes("The program's rules are in guide.rules; show them only when the builder asks, or call again with ask 'rules'."));
});

test('C1 (v6.1.8 final fix, B20b): FLOSS/fund for a chainless CLI asks the users question, never the sign-in bar; a yes makes it ready', async () => {
  // L16-8 (v6.1.16): a live site alone never clears FLOSS/fund's code step, so the CLI names its repo (not read here).
  const SITE = { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', live_url: 'https://ripgrep.dev' };
  const site = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: SITE });
  assert.equal(site.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000: code in a public repo and tell me if real people use it. First: publish a funding manifest on your site or repo.', 'Tell me when the code is in a public repo and I look again.'].join('\n'));
  const CLI = { ...SITE, repo_url: 'https://github.com/BurntSushi/ripgrep' };
  const ask = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  assert.equal(ask.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.', 'Say yes if they do and I draft it.'].join('\n'));
  const yes = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: { ...CLI, users: true } });
  // F3 fix round 1 (v6.1.10): the users yes stands only for a fully ready program; FLOSS still needs its manifest link.
  assert.equal((yes.reply!.verdict as { status: string }).status, 'ready');
  assert.equal(yes.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000. You give: the funding manifest link. First: publish a funding manifest on your site or repo.', 'Sign in once and I check the repo is yours; then say yes.'].join('\n'));
  // With no live link and the repo not read, nothing EarnKit can see exists (B20c, v6.1.9): not a fit, even on a yes.
  const { live_url: _l, repo_url: _r, ...bare } = CLI;
  const bareYes = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: { ...bare, users: true } });
  assert.deepEqual([(bareYes.reply!.verdict as { status: string }).status, bareYes.reply!.show_to_builder], ['no', 'FLOSS/fund, $10,000 to $100,000. Not a fit: needs code in a repo or a live link.']);
});

test('1b (v6.1.8): FLOSS/fund for a CLI on Base: not a fit with no live link, sign in to confirm users, then ready with one yes', async () => {
  const CLI = { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', users: true, chains: [{ chain: 'base', mainnet: true }] };
  const no = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  // B20c (v6.1.9): nothing EarnKit can see exists, so the users bar is not a fit before any tier; L1g-6 (v6.1.15): users
  // were reported, so the reason asks for something to read.
  assert.equal(no.reply!.show_to_builder, 'FLOSS/fund, $10,000 to $100,000. Not a fit: needs code in a repo or a live link.');
  // L16-8 (v6.1.16): with its repo named (not read here), so the live site is not all FLOSS/fund sees.
  const live = { ...CLI, live_url: 'https://ripgrep.dev', repo_url: 'https://github.com/BurntSushi/ripgrep' };
  const gap = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: live });
  // F2 (fix round 1, v6.1.14): no link in this context and nothing read: the sign-in is the one action, without a link.
  assert.equal(gap.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000: proof that real people use it. First: publish a funding manifest on your site or repo.', 'Sign in once and I remember you.'].join('\n'));
  // Linked, with the used tier stored: ready, the list's ready line and the one yes.
  const { getRecord, saveRecord } = await import('../v6/builders');
  // L28-3 (v6.1.16 Task 14): signed in as the repo's owner.
  const { id, builderId } = await linkedWith({ projects: [{ id: 'rg', name: 'ripgrep', live_url: 'https://ripgrep.dev' }] }, [], 'BurntSushi');
  const record = await getRecord(builderId);
  record.projects[0].last_tier = { tier: 'used', line: 'Used: real people use it.', read_at: NOW.toISOString() };
  // Read within the day: the one-program reply keeps the stored tier, as the list does (I3).
  record.projects[0].evidence_read_at = NOW.toISOString();
  await saveRecord(builderId, record, NOW);
  const r = await mcpCall({ ...ctx(id), builderId }, 'find', { program_id: 'floss-fund-zerodha', project: live, project_id: 'rg' });
  assert.equal(r.isError, false, r.text);
  assert.equal((r.reply!.verdict as { status: string }).status, 'ready', JSON.stringify(r.reply!.verdict));
  const lines = (r.reply!.show_to_builder as string).split('\n');
  assert.equal(lines.length, 2, r.reply!.show_to_builder as string);
  assert.equal(lines[0], 'FLOSS/fund, $10,000 to $100,000. You give: the funding manifest link. First: publish a funding manifest on your site or repo.');
  assert.equal(lines[1], 'Say yes and I apply to FLOSS/fund.');
});

test('find with program_id: a closed program is closed, an upcoming one not open yet; neither offers a draft', async () => {
  const id = await installation();
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-shut', title: 'Shut Grants', status: 'closed' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f-past', title: 'Past Grants', ends_at: '2026-11-01T00:00:00Z' }), 'file', NOW);
  // The note's own full stop is not doubled (C10).
  await upsertProgram(programFixture({ id: 'f-soon', title: 'Soon Grants', status: 'upcoming', opens_note: 'Opens in January.' }), 'file', NOW);
  for (const pid of ['f-shut', 'f-past']) {
    const r = await mcpCall(ctx(id), 'find', { program_id: pid, project: PROJECT });
    const show = r.reply!.show_to_builder as string;
    // Low 20 (v6.1.13): closed is said once, in one line, and no rules are listed, with a project or without.
    assert.match(show, /^(Shut|Past) Grants, [^\n]*, closed\.$/, show);
    const bare = (await mcpCall(ctx(id), 'find', { program_id: pid })).reply!.show_to_builder as string;
    assert.equal(bare, show);
    assert.doesNotMatch(show, /draft|Apply at|https?:/);
    // With a project the rules list waits to be asked for (v6.1.8, 1b).
    assert.doesNotMatch(show, /^Rules:/m);
    assert.match(r.reply!.agent_note as string, /draft nothing/);
  }
  const soon = await mcpCall(ctx(id), 'find', { program_id: 'f-soon' });
  const show = soon.reply!.show_to_builder as string;
  // C10: the first line says it is not open yet, with the opens note; no Apply at line.
  const { moneyOf } = await import('./find');
  assert.equal(show.split('\n')[0], `Soon Grants, ${moneyOf((await getProgram('f-soon'))!.file)}. Not open yet: Opens in January.`);
  assert.doesNotMatch(show, /Apply at|draft/, show);
});

test('a 2,000-character description is cut, not refused: find still answers ready and gaps', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: { ...PROJECT, description: 'Grants for builders. '.repeat(100) } });
  assert.equal(r.isError, false, r.text);
  assert.ok((allReady(r.reply!) as unknown[]).length > 0);
  assert.ok(Array.isArray(r.reply!.gaps));
  assert.deepEqual(r.reply!.problems, ['description cut to 280 characters']);
  assert.doesNotMatch(r.reply!.show_to_builder as string, /^Open now/);
});

test('L1g-6 (v6.1.15): users reported but nothing to read: the not-fit reason asks for code or a live link (personas 21, 30)', async () => {
  type NotFit = { program_id: string; reason: string }[];
  const reason = async (project: Record<string, unknown>) =>
    ((await mcpCall(ctx(await installation()), 'find', { project, filter: { all: true } })).reply!.not_fit as NotFit).find((n) => n.program_id === 'floss-fund-zerodha')?.reason;
  assert.equal(await reason({ name: 'Roomly', description: 'A booking app for small hotels.', users: true }), 'needs code in a repo or a live link');
  assert.equal(await reason({ name: 'Quest Runner', description: 'Command line runner for team quests', repo_url: 'git@github.com:o/r.git', users: true }), 'needs code in a repo or a live link');
  assert.equal(await reason({ name: 'Roomly', description: 'A booking app for small hotels.' }), 'needs a product people use');
});

test('I1 (v6.1.15 fix round 1): a public GitLab repo with users is the builder\'s word: one line about the host, never "needs code in a repo"', async () => {
  const project = { name: 'Pad', description: 'A note-taking CLI.', repo_url: 'https://gitlab.com/acme/pad', users: true };
  const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project });
  const show = r.reply!.show_to_builder as string;
  assert.notEqual((r.reply!.verdict as { status: string }).status, 'no', show);
  assert.equal(show, ['FLOSS/fund, $10,000 to $100,000. You give: the funding manifest link. First: publish a funding manifest on your site or repo.', 'Sign in once and I check the repo is yours; then say yes.'].join('\n'));
  // The project reply: the host said once, and nothing says the code is missing.
  const all = await mcpCall(ctx(await installation()), 'find', { project, filter: { all: true } });
  const text = listText(all.reply!);
  assert.equal(text.match(/I read GitHub repos only; matched on what you told me\./g)?.length, 1, text);
  assert.ok(!/needs code in a repo|I could not read the repo|code in a repo\./.test(text), text);
  assert.ok(!(all.reply!.not_fit as { reason: string }[]).some((n) => n.reason === 'needs code in a repo or a live link'));
});

test('L1g-7 (v6.1.15): a contract reported on a testnet only is asked onto that chain\'s mainnet (persona 26)', async () => {
  const dash = replayFetch('nextjs-dashboard');
  const project = { name: 'Vault', description: 'deployed on Sepolia testnet only', repo_url: `https://github.com/${dash.repo}`, chains: [{ chain: 'ethereum', mainnet: false, contract: '0x2222222222222222222222222222222222222222' }] };
  const r = await mcpCall({ ...ctx(await installation()), gh: dash.fetch }, 'find', { project, program_id: 'ethereum-security-subsidy-program' });
  const show = r.reply!.show_to_builder as string;
  assert.ok(show.includes(': deploy the contract on Ethereum mainnet.'), show);
  assert.ok(!show.includes('deploy the contract on Ethereum.'), show);
});

test('L1g-2 (v6.1.15): a name-only project gets the open list, closing on what it does or its repo, by name', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: { name: 'Lumen' } });
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.match(show, /^Open now:\n/);
  assert.equal(show.split('\n').find((l) => l.startsWith('Tell me')), 'Tell me what Lumen does in a line, or its repo link, and I match it.');
  assert.ok(!show.includes('Tell me which project'));
});

test('find with no project: the open list and the ask for the project', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', {});
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.match(show, /^Open now:\n/);
  // Fix round 1 (M4, L29-26): within the 10-line budget: names and money, five, the count, the ask (no "I'll").
  const lines = show.split('\n');
  assert.ok(lines.length <= 10, show);
  assert.equal(lines.filter((l) => /^[^\n]+, [^\n]+\.$/.test(l) && !l.startsWith('Tell me')).length, 5, show);
  for (const line of lines.slice(1)) assert.ok(line.endsWith('.'), line);
  assert.doesNotMatch(show, /I'll/);
  // L1i-6 (v6.1.16.1): each line keeps its close and in person.
  assert.equal(lines.slice(1, 6).join('\n'), [
    "PayPal AI Hackathon: Build What's Next with PayPal and AI, $67,500 in prizes, closes in 8 days.",
    'UGREEN Hackathon 2026 on AI NAS, $46,000 in prizes, closes in 11 days.',
    'Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days.',
    'Alliance ALL19, $400,000 at admission, closes in 14 days, in person.',
    'Monad Blitz @广州 (Guangzhou), $1,500 in prizes, closes Nov 21, in person.',
  ].join('\n'));
  assert.equal(lines.at(-1), 'Tell me which project and I match it.');
  // Template row 12 (v6.1.15): the overflow is its own sentence, with a capital.
  assert.match(lines.at(-2)!, /^And \d+ more\.$/);
  assert.ok(!lines.some((l) => /^and \d+ more/.test(l)));
  assert.match(r.reply!.agent_note as string, /project/);
  // A find with no project is a find too (v6.1.8 C47).
  const [row] = await sql()`SELECT last_find_at, last_gaps FROM installations WHERE id = ${id}`;
  assert.equal((row.last_find_at as Date).toISOString(), NOW.toISOString());
  assert.equal(row.last_gaps, null);
});

test('a project with problems still matches; the problems go to the agent', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: { ...PROJECT, live_url: 'not a link', chains: [{ chain: 'nochain', mainnet: true }] } });
  assert.equal(r.isError, false, r.text);
  assert.ok((r.reply!.problems as string[]).length === 2);
  assert.match(r.reply!.agent_note as string, /live_url dropped/);
  assert.ok((allReady(r.reply!) as unknown[]).length > 0);
});

test('filter.all lists the rest with a reason; the leftover count is in the note otherwise', async () => withInPerson(async () => {
  const id = await installation();
  const capped = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.match(capped.reply!.agent_note as string, /^The full list holds \d+ more; show it when the builder asks for all, more or the full list\. Call find with filter\.all for it\.$/m);
  const all = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { all: true } });
  assert.ok((allReady(all.reply!) as unknown[]).length > 5);
  const notFit = all.reply!.not_fit as { program_id: string; reason: string }[];
  assert.ok(notFit.every((n) => n.reason.length > 0));
  assert.ok(!notFit.some((n) => n.program_id === 'base-builder-grants'));
  const { live_url: _, ...noLink } = PROJECT;
  const offline = await mcpCall(ctx(id), 'find', { project: noLink, filter: { all: true } });
  assert.ok((offline.reply!.not_fit as { program_id: string; reason: string }[]).some((n) => n.program_id === 'base-builder-grants' && n.reason.length > 0));
  const grants = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { category: 'investment', all: true } });
  assert.ok((allReady(grants.reply!) as { category: string }[]).every((p) => p.category === 'investment'));
}));

test('a repo read that fails never fails find', async () => {
  const id = await installation();
  const broken = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  const r = await mcpCall({ installationId: id, builderId: null, now: NOW, gh: broken }, 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
});

test('a result past due is asked once', async () => {
  const id = await installation();
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-due', title: 'Due Grant', results_due: { date: '2026-11-01' } }), 'file', NOW);
  try {
    const t = await mcpCall(ctx(id), 'track', { program_id: 'f-due', status: 'applied' });
    assert.equal(t.isError, false, t.text);
    const first = await mcpCall(ctx(id), 'find', { project: PROJECT });
    assert.deepEqual(first.reply!.ask_outcome, [{ program_id: 'f-due', title: 'Due Grant', due_at: '2026-11-01T00:00:00.000Z' }]);
    // L23-4 (v6.1.16): the builder text asks, once a day for this installation.
    assert.match(first.reply!.show_to_builder as string, /\nResults for Due Grant were due Nov 1\. Did you hear back\?\n/);
    assert.match(first.reply!.agent_note as string, /Due Grant/);
    const second = await mcpCall(ctx(id), 'find', { project: PROJECT });
    assert.deepEqual(second.reply!.ask_outcome, []);
  } finally {
    // v6.1.2: a leftover Due Grant is the only non-in-person ready line in later finds; it must not outlive this test.
    await sql()`DELETE FROM programs WHERE id = 'f-due'`;
  }
});

// v6.1: the record side of find.
const LIVE = async () => {
  const { evidence, liveRows } = await import('../v6/fixtures/evidence-builder');
  return evidence({ live: liveRows({ url: 'https://earnkit.com', url_ok: true }) });
};
let ghId = 920_000;
/** A linked installation whose builder holds `patch` (merged by the builder, `approve` approved). */
async function linkedWith(patch: Record<string, unknown>, approve: string[] = [], login?: string) {
  const { saveInstallation, connectInstallation } = await import('./installations');
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, approvePath, mergeRecord } = await import('../v6/record');
  const token = 'find-linked-' + Math.random();
  await saveInstallation(token, 'Claude Code');
  const id = (await connectInstallation(token))!.id;
  // L28-3 (v6.1.16 Task 14): signed in as the owner of the replayed repo (PROJECT) unless a test names another login.
  const b = await upsertBuilder({ github_id: ++ghId, login: login ?? PROJECT.repo_url.split('/')[3], name: 'FL', avatar_url: null }, NOW);
  await linkInstallation(id, b.id, NOW);
  const m = mergeRecord(EMPTY_RECORD, patch, 'builder', NOW);
  assert.deepEqual(m.problems, []);
  await saveRecord(b.id, approve.reduce((r, p) => approvePath(r, p, NOW), m.record), NOW);
  return { id, builderId: b.id };
}
const OWNER_RECORD = {
  person: { name: 'Jenil Thakker', email: 'jenil@example.com' },
  projects: [{ id: 'earnkit', name: 'EarnKit', repo_url: `https://github.com/${rec.repo}`, live_url: 'https://earnkit.com', answers: { problem: { text: 'Builders lose weeks on grant forms.' } } }],
};
const OAUTH_ENV = { GITHUB_OAUTH_CLIENT_ID: 'Iv1.client', GITHUB_OAUTH_CLIENT_SECRET: 'shh', EARNKIT_URL: 'https://earnkit.test', EARNKIT_AUTH_SECRET: 'find-test-secret' };
async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('unlinked without oauth is v5', async () => {
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /Sign in once at/);
  assert.doesNotMatch(show, /record/i);
  assert.equal(r.reply!.linked, false);
  assert.equal('sign_in' in r.reply!, false);
  assert.ok(CLOSINGS.some((c) => c.test(show.split('\n').at(-1)!)), show);
  assert.deepEqual([r.reply!.record_missing, r.reply!.evidence_summary, r.reply!.applied_overnight, r.reply!.released, r.reply!.auto_apply], [[], null, [], [], false]);
  // v6.1.3 R4: the blockers are named unlinked too.
  assert.ok((r.reply!.blockers as unknown[]).length > 0);
  assert.doesNotMatch(r.reply!.agent_note as string, /approved answers|style contract/);
});

test('unlinked with sign-in configured: the closing line, then the sign-in as its second sentence (R5a)', async () => withEnv(OAUTH_ENV, async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  const show = r.reply!.show_to_builder as string;
  const lines = show.split('\n');
  const link = r.reply!.sign_in as string;
  assert.match(link, /\/link\//);
  // FR-1, N5 (v6.1.16 Task 14 fix rounds 1 and 2): signed out with a repo, one sign-in line, with its link, is the closing.
  assert.equal(lines.at(-1), `Sign in once at ${link} and I check the repo is yours; then say yes.`);
  assert.equal(show.match(/Sign in once/g)!.length, 1);
  assert.equal(r.reply!.linked, false);
}));

test('R19: project C (no repo) gets the short sign-in sentence (v6.1.6)', async () => withEnv(OAUTH_ENV, async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Project C', description: 'A wallet app for remittances.', live_url: 'https://c.example.com' } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
  const show = r.reply!.show_to_builder as string;
  const link = r.reply!.sign_in as string;
  assert.ok(show.includes(`\nSign in once at ${link} and I remember you across agents.`), show);
  assert.doesNotMatch(show, /read your repo/);
}));

test('linked: record fields, what the record lacks, blockers, and the own tier read once a day', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD, ['projects.earnkit.answers.problem']);
  let reads = 0;
  const evidence = async () => {
    reads++;
    return LIVE();
  };
  const r = await mcpCall({ ...ctx(id), builderId, evidence }, 'find', { project: PROJECT, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const reply = r.reply!;
  assert.equal(reply.linked, true);
  const ready = allReady(reply) as { program_id: string; from_record: number; fields: { key: string; from: string; value: string | null; style?: string }[]; need_you: string[] }[];
  const z = ready.find((p) => p.program_id === 'z-fellows')!;
  assert.ok(z.from_record > 0, JSON.stringify(z));
  // L26-4 (v6.1.16 Task 12): the full list's fields carry key, label, value and source only; the details come with the program.
  for (const f of z.fields) assert.deepEqual(Object.keys(f).sort(), ['from', 'key', 'label', 'value']);
  const zOne = (await mcpCall({ ...ctx(id), builderId, evidence }, 'find', { program_id: 'z-fellows', project: PROJECT })).reply!;
  const zFields = zOne.fields as { key: string; from: string; value: string | null; style?: string }[];
  const problem = zFields.find((f) => f.key === 'problem')!;
  assert.deepEqual([problem.from, problem.value, typeof problem.style], ['record', 'Builders lose weeks on grant forms.', 'string']);
  assert.equal(zFields.find((f) => f.key === 'email')!.value, 'jenil@example.com');
  assert.ok((reply.record_missing as string[]).includes('your founder video link'), JSON.stringify(reply.record_missing));
  const blockers = reply.blockers as { program_id: string; sign_in: string | null; needs_click: boolean; needs: string[] }[];
  // v6.1.2: Avalanche now carries an eligibility gap; Y Combinator is the ready program with a platform sign-in (and a click).
  const yc = blockers.find((b) => b.program_id === 'y-combinator')!;
  assert.deepEqual([yc.sign_in, yc.needs_click], ['Y Combinator', true]);
  assert.deepEqual(blockers.find((b) => b.program_id === 'z-fellows')?.needs, ['founder_video']);
  assert.deepEqual((reply.evidence_summary as { tier: string }).tier, 'live');
  const show = reply.show_to_builder as string;
  // L1i-6 (v6.1.16.1): the full view keeps the close.
  assert.equal(show.split('\n').find((l) => l.startsWith('1. ')), '1. Arbitrum Mentorship Program: Cohort 2, up to $100,000, closes Dec 6.');
  // v6.1.6 (R21): Y Combinator is in person, so its line names what attending takes and the Before block does not.
  // L29-26 (v6.1.16 Task 15): the full view is names and money; the Before line and the evidence line are the default's.
  const d = (await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT })).reply!.show_to_builder as string;
  assert.match(d, /\nBefore applying: [^\n]+\./);
  assert.doesNotMatch(d, /Still missing for these programs/);
  assert.doesNotMatch(d.split('\n').find((b) => b.startsWith('Before applying: '))!, /Y Combinator/);
  assert.doesNotMatch(show, /Sign in once at/);
  // Fix round 1 (M2): the full list points at the program's own find for the style.
  assert.ok((reply.agent_note as string).includes(FULL_LIST_STYLE_NOTE));
  assert.doesNotMatch(reply.agent_note as string, /blockers; name them once|Submit only/);
  assert.equal(reads, 1);

  // Inside 24 hours: no read, the stored tier.
  const { getRecord } = await import('../v6/builders');
  const stored = (await getRecord(builderId)).projects[0];
  assert.equal(stored.evidence_read_at, NOW.toISOString());
  assert.equal(stored.last_tier?.tier, 'live');
  const again = await mcpCall({ ...ctx(id, new Date(NOW.getTime() + 2 * H)), builderId, evidence }, 'find', { project: PROJECT });
  assert.equal(reads, 1);
  assert.equal((again.reply!.evidence_summary as { tier: string }).tier, 'live');

  // A read that throws: no summary, nothing stored, one problem.
  const { id: id2, builderId: b2 } = await linkedWith(OWNER_RECORD);
  const broken = await mcpCall({ ...ctx(id2), builderId: b2, evidence: async () => { throw new Error('down'); } }, 'find', { project: PROJECT });
  assert.equal(broken.isError, false, broken.text);
  assert.equal(broken.reply!.evidence_summary, null);
  assert.ok((broken.reply!.problems as string[]).includes('evidence not read'));
  assert.doesNotMatch(broken.reply!.agent_note as string, /evidence not read/);
  assert.equal((await getRecord(b2)).projects[0].evidence_read_at, undefined);
});

test('min_tier above the project tier moves the program to gaps with kind tier; unknown tier passes', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-tier', title: 'Tier Grant', min_tier: 'used' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith(OWNER_RECORD);
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    const gaps = r.reply!.gaps as { program_id: string; gap: { kind: string; item: string; what: string; effort: string; agent_can: boolean } }[];
    const g = gaps.find((x) => x.program_id === 'f-tier');
    assert.ok(g, JSON.stringify(gaps.map((x) => x.program_id)));
    assert.deepEqual(g.gap, { kind: 'tier', item: 'tier:used', what: 'about 25 outside users in 90 days; I count 0', effort: 'weeks', agent_can: false, details: { tier: 'live', min_tier: 'used' } });
    assert.ok(!ids(allReady(r.reply!)).includes('f-tier'));
    // A read that fails leaves the own tier unknown: the bar falls back to the provisional one (R3c), building here.
    const other = await linkedWith(OWNER_RECORD);
    const u = await mcpCall({ ...ctx(other.id), builderId: other.builderId, evidence: async () => { throw new Error('down'); } }, 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(u.reply!.gaps).includes('f-tier'));
    // Linked, the builder has signed in: the bar says the proof is still being read, never to sign in (I2).
    assert.match(listText(u.reply!), /Tier Grant, up to \$5,000\. Your proof is still being read; ask again in a minute\./);
    assert.doesNotMatch(listText(u.reply!), /proof that /);
    // Unlinked (v6.1.3 R3): the repo read reads as building at most, so a used bar is a gap. Unread (B20, v6.1.8):
    // the report's live link reads as live, still under a used bar; nothing reported is not a fit.
    const v5 = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(v5.reply!.gaps).includes('f-tier'));
    const unread = await mcpCall(ctx(await installation()), 'find', { project: { ...PROJECT, private: true, chains: [{ chain: 'base', mainnet: true }] }, filter: { all: true } });
    assert.ok(ids(unread.reply!.gaps).includes('f-tier'));
    const nothing = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Idea', description: 'An idea.', chains: [{ chain: 'base', mainnet: true }] }, filter: { all: true } });
    assert.ok(!ids(allReady(nothing.reply!)).includes('f-tier') && !ids(nothing.reply!.gaps).includes('f-tier'));
    // B20c (v6.1.9): with nothing that exists, a used program is not a fit by its own rule, before the tier bar.
    assert.deepEqual((nothing.reply!.not_fit as { program_id: string; reason: string }[]).find((n) => n.program_id === 'f-tier')?.reason, 'needs a product people use');
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-tier'`;
  }
});

test('#6 (v6.1.15): a linked tier gap reads in plain words with one full stop', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { contract, evidence, liveRows } = await import('../v6/fixtures/evidence-builder');
  await upsertProgram(programFixture({ id: 'f-tier4', title: 'Tier Grant', min_tier: 'used' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith(OWNER_RECORD);
    const four = async () => evidence({ live: liveRows({ url: 'https://earnkit.com', url_ok: true }), onchain: [contract({ tx_90d: 9, senders_90d: 4, funded_senders_90d: 4, funded_sample: 4 })] });
    const r = await mcpCall({ ...ctx(id), builderId, evidence: four }, 'find', { project: PROJECT, filter: { all: true } });
    assert.equal(r.isError, false, r.text);
    const g = (r.reply!.gaps as { program_id: string; n: number; gap: { kind: string; what: string } }[]).find((x) => x.program_id === 'f-tier4')!;
    assert.deepEqual([g.gap.kind, g.gap.what], ['tier', 'about 25 outside users in 90 days; I count 4']);
    assert.match(listText(r.reply!), new RegExp(`^${g.n}\\. Tier Grant, up to \\$5,000: about 25 outside users in 90 days; I count 4\\.$`, 'm'));
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-tier4'`;
  }
});

test('I1 (v6.1.15 fix round 1): a tier line stored before v6.1.15 reads in today\'s words, fresh or with the re-read failing', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { withRecord } = await import('../v6/builders');
  const OLD = 'Your project is live, with no verified usage yet. Next: 25 senders the deployer did not fund, on mainnet in 90 days; you have 4.';
  const NEW = 'Your project is live, with no verified usage yet. Next: about 25 outside users in 90 days; I count 4.';
  await upsertProgram(programFixture({ id: 'f-tier-old', title: 'Old Line Grant', min_tier: 'used' }), 'file', NOW);
  try {
    for (const [name, readAt, readFails] of [['fresh', NOW, false], ['re-read fails', new Date(NOW.getTime() - 48 * H), true]] as const) {
      const { id, builderId } = await linkedWith(OWNER_RECORD);
      await withRecord(builderId, NOW, (cur) => {
        const mine = cur.projects[0];
        mine.evidence_read_at = readAt.toISOString();
        mine.last_tier = { tier: 'live', line: OLD, read_at: readAt.toISOString(), repo_url: mine.repo_url ?? undefined };
        return { record: cur, result: null };
      });
      let reads = 0;
      const evidence = async () => { reads++; if (readFails) throw new Error('down'); return LIVE(); };
      const r = await mcpCall({ ...ctx(id), builderId, evidence }, 'find', { project: PROJECT, filter: { all: true } });
      assert.equal(r.isError, false, r.text);
      assert.equal(reads, readFails ? 1 : 0, name);
      const g = (r.reply!.gaps as { program_id: string; n: number; gap: { what: string } }[]).find((x) => x.program_id === 'f-tier-old')!;
      assert.equal(g.gap.what, 'about 25 outside users in 90 days; I count 4', name);
      const show = listText(r.reply!);
      assert.match(show, new RegExp(`^${g.n}\\. Old Line Grant, up to \\$5,000: about 25 outside users in 90 days; I count 4\\.$`, 'm'), name);
      // Task 9 fix round 1 (M2): a failed re-read within 14 days of the same repo keeps the tier and says so; the gate still
      // reads the stored line in today's words.
      const summaryLine = readFails ? 'I could not read your repo today; using what I read on Nov 2.' : NEW;
      assert.ok(!show.includes(summaryLine), name);
      assert.equal((r.reply!.evidence_summary as { line: string }).line, summaryLine, name);
      assert.doesNotMatch(summaryLine, /deployer|senders|mainnet|unfunded/, name);
    }
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-tier-old'`;
  }
});

test('Review Focus 5 (v6.1.15): every linked tier gap holds no deployer, senders or mainnet; the reviewer line keeps the rule', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { codeRows, contract, daysAgo, evidence, liveRows } = await import('../v6/fixtures/evidence-builder');
  const { place } = await import('../v6/tiers');
  const { reviewerLine } = await import('../v6/tier-words');
  const site = liveRows({ url: 'https://earnkit.com', url_ok: true });
  const users = (k: number) => [contract({ tx_90d: 9, senders_90d: k, funded_senders_90d: k, funded_sample: k })];
  const cases = [
    { name: 'live, no users', e: evidence({ live: site, onchain: users(0) }), rule: true },
    { name: 'live, 4 users', e: evidence({ live: site, onchain: users(4) }), rule: true },
    { name: 'live by contract', e: evidence({ onchain: users(7), code: codeRows({ last_push_at: daysAgo(3), commits_90d: 2 }) }), rule: true },
    { name: 'building', e: evidence({ repo: 'a/b', onchain: [contract()], code: codeRows({ last_push_at: daysAgo(3), commits_90d: 2 }) }), rule: false },
    { name: 'unverified', e: evidence({ onchain: [contract()] }), rule: false },
    { name: 'flagged self-funded', e: evidence({ live: site, onchain: [contract({ tx_90d: 900, senders_90d: 150, funded_sample: 50, funded_senders_90d: 5 })] }), rule: true },
  ];
  for (const min of ['used', 'live'] as const) await upsertProgram(programFixture({ id: `rf5-${min}`, title: `Bar ${min} Grant`, min_tier: min }), 'file', NOW);
  try {
    let seen = 0;
    for (const c of cases) {
      const { id, builderId } = await linkedWith(OWNER_RECORD);
      const r = await mcpCall({ ...ctx(id), builderId, evidence: async () => c.e }, 'find', { project: PROJECT, filter: { all: true } });
      assert.equal(r.isError, false, r.text);
      const show = listText(r.reply!);
      for (const x of r.reply!.gaps as { n: number; gap: { kind: string; what: string } }[]) {
        if (x.gap.kind !== 'tier') continue;
        seen++;
        assert.doesNotMatch(x.gap.what, /deployer|senders|mainnet/, `${c.name}: ${x.gap.what}`);
        const lines = show.split('\n').filter((l) => l.startsWith(`${x.n}. `));
        assert.ok(lines.length, `${c.name}: no line ${x.n}`);
        // The line carries the gap's own words (a program's quoted rule may say mainnet; that is the program's text).
        assert.ok(lines.some((l) => l.includes(x.gap.what)), `${c.name}: ${lines.join(' | ')}`);
      }
      const summary = (r.reply!.evidence_summary as { line: string } | null)?.line;
      if (summary) assert.doesNotMatch(summary, /deployer|senders|mainnet/, `${c.name}: ${summary}`);
      for (const b of show.split('\n\n').filter((x) => x.startsWith('Your project is'))) assert.doesNotMatch(b, /deployer|senders|mainnet/, `${c.name}: ${b}`);
      if (c.rule) assert.match(reviewerLine(place(c.e, { identical_pitch: 0, shared_contributors: 0 }, undefined, NOW), c.e), /(senders|wallets) the deployer did not fund/, c.name);
    }
    assert.ok(seen >= cases.length, `tier gaps seen: ${seen}`);
  } finally {
    await sql()`DELETE FROM programs WHERE id IN ('rf5-used', 'rf5-live')`;
  }
});

// v6.1.3 R3: unlinked, a provisional tier from the repo read gates min_tier; it never reaches evidence_summary.
const CONFIRM = 'proof that your product is live';
async function withLiveBar<T>(run: () => Promise<T>): Promise<T> {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-live', title: 'Live Grant', min_tier: 'live' }), 'file', NOW);
  try {
    return await run();
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-live'`;
  }
}

/** The builder's text has Live Grant as a ready line and no confirm line. */
function assertLiveReady(show: string) {
  assert.match(show, /^\d+\. Live Grant, up to \$5,000\.( |$)/m, show);
  assert.doesNotMatch(show, /proof that /, show);
}

test('unlinked: each bar names itself in the gap line (R3b)', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { provisionalGate } = await import('../v6/find-record');
  const ready = { program_id: 'f', status: 'ready' as const, gaps: [], reason: null, long_shot: null, rules: [] };
  const line = (min: 'used' | 'live' | 'building', tier: 'building' | 'unverified' | 'live') =>
    provisionalGate(ready, { id: 'f', file: programFixture({ id: 'f', min_tier: min }) } as never, tier, { onchain: true, linked: false }).gaps[0]?.what;
  assert.equal(line('used', 'live'), 'proof that real people use it');
  assert.equal(line('live', 'building'), 'proof that your product is live');
  assert.equal(line('building', 'unverified'), 'proof that your project has code');
});

test('unlinked: a public repo with no live URL from code and no mainnet contract is a gap with the link line (R3)', async () => withLiveBar(async () => {
  const { live_url: _, ...noLink } = PROJECT;
  const r = await mcpCall(ctx(await installation()), 'find', { project: noLink, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, false);
  assert.ok(!ids(allReady(r.reply!)).includes('f-live'));
  const g = (r.reply!.gaps as { program_id: string; n: number; gap: { kind: string; what: string; details?: unknown } }[]).find((x) => x.program_id === 'f-live');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(g.gap.kind, 'tier');
  assert.equal(g.gap.what, CONFIRM);
  assert.match(listText(r.reply!), new RegExp(`^${g.n}\\. Live Grant, up to \\$5,000: ${CONFIRM}\\.$`, 'm'));
  assert.equal(r.reply!.evidence_summary, null);
  // A live URL the agent reports is not the code's: still the gap (the earnkit repo has no homepage).
  const reported = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
  assert.ok(ids(reported.reply!.gaps).includes('f-live'));
  assert.equal(reported.reply!.evidence_summary, null);
}));

test('unlinked: a live URL read from the code passes the live bar (R3)', async () => withLiveBar(async () => {
  const dash = replayFetch('nextjs-dashboard');
  const r = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch }, 'find', {
    project: { name: 'Dashboard', description: 'A dashboard.', repo_url: `https://github.com/${dash.repo}` }, filter: { all: true },
  });
  assert.equal(r.isError, false, r.text);
  assert.ok(ids(allReady(r.reply!)).includes('f-live'), JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(r.reply!.evidence_summary, null);
  assertLiveReady(r.reply!.show_to_builder as string);
  // R3a: the agent passing the live URL (as the note asks) keeps the code's homepage: still live.
  const passed = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch }, 'find', {
    project: { name: 'Dashboard', description: 'A dashboard.', repo_url: `https://github.com/${dash.repo}`, live_url: 'https://dashboard-v1-ashy.vercel.app' }, filter: { all: true },
  });
  assert.equal(passed.isError, false, passed.text);
  assert.ok(ids(allReady(passed.reply!)).includes('f-live'), JSON.stringify(ids(passed.reply!.gaps)));
  assertLiveReady(passed.reply!.show_to_builder as string);
}));

test('linked with an empty record: the provisional bar holds after sign-in, and asks to add the project (R3c, I2 nuance v6.1.9); a matched project not read yet says the proof is still being read', async () => withLiveBar(async () => {
  const { id, builderId } = await linkedWith({});
  const { live_url: _, ...noLink } = PROJECT;
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: noLink, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.linked, true);
  const g = (r.reply!.gaps as { program_id: string; n: number; gap: { kind: string; what: string } }[]).find((x) => x.program_id === 'f-live');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(g.gap.kind, 'tier');
  assert.match(listText(r.reply!), new RegExp(`^${g.n}\\. Live Grant, up to \\$5,000\\. Add this project to your record so EarnKit can read its proof\\.$`, 'm'));
  assert.doesNotMatch(listText(r.reply!), /proof that |still being read/);
  assert.equal(r.reply!.evidence_summary, null);
  // The one-program reply: the same line, and no "tell me when" action under it.
  const one = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { program_id: 'f-live', project: noLink });
  assert.equal(one.reply!.show_to_builder, 'Live Grant, up to $5,000. Add this project to your record so EarnKit can read its proof.');
  // The record holds this project but its proof could not be read yet: the proof is still being read.
  const held = await linkedWith({ projects: [{ id: 'ek', name: 'EarnKit', repo_url: `https://github.com/${rec.repo}` }] });
  const failing = async () => { throw new Error('read failed'); };
  const m = await mcpCall({ ...ctx(held.id), builderId: held.builderId, evidence: failing }, 'find', { project: noLink, filter: { all: true } });
  const mg = (m.reply!.gaps as { program_id: string; n: number }[]).find((x) => x.program_id === 'f-live');
  assert.ok(mg, JSON.stringify(ids(m.reply!.gaps)));
  assert.match(listText(m.reply!), new RegExp(`^${mg.n}\\. Live Grant, up to \\$5,000\\. Your proof is still being read; ask again in a minute\\.$`, 'm'));
  assert.doesNotMatch(listText(m.reply!), /Add this project/);
}));

test('I3 (v6.1.8 final fix): the one-program reply gates on the same fresh own tier the list reads, before and after a list find', async () => withLiveBar(async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const c = { ...ctx(id), builderId, evidence: LIVE };
  // The detail first: it reads the own evidence as the list would (live), so the live bar is met.
  const detail = await mcpCall(c, 'find', { program_id: 'f-live', project: PROJECT, project_id: 'earnkit' });
  assert.equal(detail.isError, false, detail.text);
  const list = await mcpCall(c, 'find', { project: PROJECT, project_id: 'earnkit', filter: { all: true } });
  assert.ok(ids(allReady(list.reply!)).includes('f-live'), JSON.stringify(ids(list.reply!.gaps)));
  assert.equal((detail.reply!.verdict as { status: string }).status, 'ready', detail.reply!.show_to_builder as string);
  // And after the list: still the same verdict.
  const again = await mcpCall(c, 'find', { program_id: 'f-live', project: PROJECT, project_id: 'earnkit' });
  assert.equal((again.reply!.verdict as { status: string }).status, 'ready');
}));

test('B20 (v6.1.8): an unread repo gets the bar from the report: a live link or a repo reads building, nothing no fit', async () => withLiveBar(async () => {
  const { live_url: _, ...noLink } = PROJECT;
  const tierOf = async (project: Record<string, unknown>) => {
    const r = await mcpCall(ctx(await installation()), 'find', { project, filter: { all: true } });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.reply!.as_reported, true);
    const g = (r.reply!.gaps as { program_id: string; gap: { kind: string; what: string } }[]).find((x) => x.program_id === 'f-live');
    const no = (r.reply!.not_fit as { program_id: string; reason: string }[]).find((x) => x.program_id === 'f-live');
    return { ready: ids(allReady(r.reply!)).includes('f-live'), gap: g ? `${g.gap.kind}: ${g.gap.what}` : null, no: no?.reason ?? null, show: listText(r.reply!) };
  };
  // A repo named and not read (private): building, under a live bar.
  const priv = await tierOf({ ...noLink, private: true, chains: [{ chain: 'base', mainnet: true }] });
  assert.deepEqual([priv.ready, priv.gap, priv.no], [false, `tier: ${CONFIRM}`, null]);
  assert.equal(priv.show.split('Private repo: matched on what you told me.').length, 2, priv.show);
  // A live link reported is a claim (fix round 4): building, the same gap, read or not.
  assert.deepEqual((({ ready, gap, no }) => [ready, gap, no])(await tierOf({ ...PROJECT, private: true, chains: [{ chain: 'base', mainnet: true }] })), [false, `tier: ${CONFIRM}`, null]);
  assert.deepEqual((({ ready, gap, no }) => [ready, gap, no])(await tierOf({ name: 'Site', description: 'A site.', live_url: 'https://c.example.com', chains: [{ chain: 'base', mainnet: true }] })), [false, `tier: ${CONFIRM}`, null]);
  // Nothing reported: not a fit, with the bar named, never ready and never a gap.
  const idea = await tierOf({ name: 'Rent Split', description: 'An idea: an app that splits rent between roommates', chains: [{ chain: 'base', mainnet: true }] });
  assert.deepEqual([idea.ready, idea.gap, idea.no], [false, null, 'needs a live product']);
  assert.doesNotMatch(idea.show, /Live Grant/);
  // B20b (final fix, C1): the bars are onchain evidence; with no chain, the program's items alone decide.
  const web2 = await tierOf({ ...noLink, private: true });
  assert.deepEqual([web2.ready, web2.gap, web2.no], [true, null, null]);
  assert.doesNotMatch(web2.show, /proof that /);
  const web2Idea = await tierOf({ name: 'Rent Split', description: 'An idea: an app that splits rent between roommates' });
  assert.deepEqual([web2Idea.ready, web2Idea.gap, web2Idea.no], [true, null, null]);
}));

test('fix round 4 (v6.1.8): the private and public versions of one project get the same tier; a reported live link is never live', async () => {
  const { provisionalTier } = await import('../v6/find-record');
  const { repoFacts } = await import('./repo-facts');
  const { parseProject } = await import('./project-input');
  const tierOf = async (over: Record<string, unknown>) => {
    const p = parseProject({ ...PROJECT, ...over });
    assert.ok(p.ok);
    return provisionalTier(await repoFacts(p.project, { gh: rec.fetch, now: NOW }));
  };
  // The earnkit repo has no homepage and no mainnet contract read from code: building, read or not.
  assert.deepEqual([await tierOf({}), await tierOf({ private: true })], ['building', 'building']);
  const { live_url: _, ...noLink } = PROJECT;
  const bare = parseProject(noLink);
  assert.ok(bare.ok);
  assert.equal(provisionalTier(await repoFacts({ ...bare.project, private: true }, { now: NOW })), 'building');
  const site = parseProject({ name: 'Site', description: 'A site.', live_url: 'https://c.example.com' });
  assert.ok(site.ok);
  assert.equal(provisionalTier(await repoFacts(site.project, { now: NOW })), 'building');
  const idea = parseProject({ name: 'Idea', description: 'An idea.' });
  assert.ok(idea.ok);
  assert.equal(provisionalTier(await repoFacts(idea.project, { now: NOW })), null);
  // Live only from the code read: the dashboard repo's homepage.
  const dash2 = replayFetch('nextjs-dashboard');
  const d = parseProject({ name: 'Dashboard', description: 'A dashboard.', repo_url: `https://github.com/${dash2.repo}` });
  assert.ok(d.ok);
  assert.equal(provisionalTier(await repoFacts(d.project, { gh: dash2.fetch, now: NOW })), 'live');
});

test('B20 (v6.1.8): reads paused gives the same answer as the read would, and says so once', async () => withLiveBar(async () => {
  const { hit, LIMITS } = await import('./rate-limit');
  const { live_url: _, ...noLink } = PROJECT;
  const id = await installation();
  for (let n = 0; n < LIMITS.repoRead.limit; n++) await hit(`repoRead:${id}`, LIMITS.repoRead.limit, LIMITS.repoRead.windowSeconds, NOW);
  const r = await mcpCall(ctx(id), 'find', { project: { ...noLink, chains: [{ chain: 'base', mainnet: true }] }, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
  assert.deepEqual(r.reply!.repo_notes, ['paused']);
  const show = listText(r.reply!);
  // The read (building) and the report (a repo named: building) agree: the same live bar gap.
  const g = (r.reply!.gaps as { program_id: string; gap: { kind: string } }[]).find((x) => x.program_id === 'f-live');
  assert.equal(g?.gap.kind, 'tier');
  assert.equal(show.split('Repo reads are paused until tomorrow; matched on what you told me.').length, 2, show);
  assert.doesNotMatch(show, /Private repo/);
  // The agent hears it once too: the paused line, not the as-reported line beside it.
  const note = r.reply!.agent_note as string;
  assert.match(note, /Repo reads are paused for this installation until tomorrow/);
  assert.doesNotMatch(note, /No public repo was read/);
}));

test('unlinked: blockers name the sign-ins, clicks and documents as linked does, never outside_approval (R4)', async () => withInPerson(async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
  const blockers = r.reply!.blockers as { program_id: string; sign_in: string | null; needs_click: boolean; needs: string[]; outside_approval?: true }[];
  const yc = blockers.find((b) => b.program_id === 'y-combinator');
  assert.ok(yc, JSON.stringify(blockers));
  assert.equal(yc.sign_in, 'Y Combinator');
  assert.ok(blockers.every((b) => !('outside_approval' in b)));
  // Only ready programs are named; the in-person one keeps its own block.
  const ready = new Set(ids(allReady(r.reply!)));
  assert.ok(blockers.every((b) => ready.has(b.program_id)));
  const show = listText(r.reply!);
  // v6.1.6 (R21): the in-person line says what attending takes; the Before block never repeats it.
  assert.doesNotMatch(show, /Sign in once to Y Combinator/);
  assert.match(show, /^\d+\. Y Combinator Winter 2027 Batch, [^\n]*Needs a YC account/m);
  assert.equal(r.reply!.evidence_summary, null);
  assert.deepEqual(r.reply!.record_missing, []);
}));

test('auto_apply changes the closing line and the agent note; never removes a program', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 2, never: ['z-fellows'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  const show = r.reply!.show_to_builder as string;
  const free = freeOf(r.reply!);
  // S6 fix round 1 (v6.1.9): a program waiting on a required builder answer is not sent tonight; it is named as waiting.
  const waits = freeOf(r.reply!, true).filter((p) => !free.includes(p));
  assert.ok(free.length + waits.length >= 1, show);
  if (free.length > 0) {
    assert.match(show, tonightRe(free.slice(0, 2).map((p) => p.title)));
    assert.doesNotMatch(show, /Say yes/);
  } else assert.match(show, /\nSay yes and (?:tell me [^\n]+, and )?I apply to Arbitrum Mentorship Program: Cohort 2\./);
  // Fix round 1 (M1): with nothing sent alone, the Say asks for what the waiting one needs; the Before line names no
  // wait. With a send under way, the wait is a clause of the Before line.
  for (const p of waits)
    assert.match(show, free.length > 0 ? new RegExp(`\nBefore applying: [^\n]*for [^\n]*${p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : /\nSay yes and tell me [^\n]+, and I apply to /);
  assert.equal(r.reply!.auto_apply, true);
  // L29-6 (v6.1.16 Task 15): the note names the programs the approval covers, only these.
  if (free.length > 0) assert.match(r.reply!.agent_note as string, new RegExp(`^Standing approval is on for only these: ${free.slice(0, 2).map((p) => p.program_id).join(', ')}\\. For each, call track started`, 'm'));
  assert.ok(!ids(allReady(r.reply!)).includes('z-fellows'));
});

type B = { program_id: string; sign_in: string | null; needs_click: boolean; outside_approval?: true };
/** The closing line when the agent applies tonight: the programs named (C40). */
const tonightRe = (titles: string[]) => {
  const words = titles.length <= 1 ? titles.join('') : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
  // L24-11 (v6.1.16 Task 11): the one standing line: stop to hold, or the yes for the ones outside the approval.
  return new RegExp(`\\nApplying now to ${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} under your standing approval\\. (?:Say stop and I hold any of them\\.|Say yes and I also apply to [^\\n]+?\\.)${NOTICE_TAIL}$`);
};
/** The ready programs the agent may send alone tonight: no sign-in, click or approval limit in the way. */
const freeOf = (reply: Record<string, unknown>, waiting = false) => {
  const blocked = new Set((reply.blockers as B[]).filter((b) => b.sign_in || b.needs_click || b.outside_approval).map((b) => b.program_id));
  // S6 fix round 1 (v6.1.9): and every required builder answer in (`waiting` keeps the ones that wait on one).
  return (allReady(reply) as { program_id: string; title: string; in_person: boolean; needs: string[]; setup: string[] }[])
    .filter((p) => !p.in_person && !blocked.has(p.program_id) && (waiting || p.needs.every((n) => p.setup.includes(n))));
};

test('categories limit only what the agent sends alone: an investment program stays ready, not counted tonight', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, categories: ['grant', 'hackathon', 'bounty'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const ready = allReady(r.reply!) as { program_id: string; title: string; category: string; in_person: boolean }[];
  const invest = ready.filter((p) => p.category === 'investment');
  assert.ok(invest.length > 0, JSON.stringify(ids(ready)));
  const blockers = r.reply!.blockers as B[];
  for (const p of invest) assert.equal(blockers.find((b) => b.program_id === p.program_id)?.outside_approval, true, p.program_id);
  assert.ok(blockers.filter((b) => b.outside_approval).every((b) => invest.some((p) => p.program_id === b.program_id)));
  const free = freeOf(r.reply!);
  assert.ok(free.every((p) => !invest.some((x) => x.program_id === p.program_id)));
  const show = listText(r.reply!);
  // C46: an in-person program is never in the outside-approval list.
  const named = invest.filter((p) => !p.in_person && !blockers.find((b) => b.program_id === p.program_id)!.needs_click).map((p) => p.title);
  for (const p of invest.filter((x) => x.in_person)) assert.doesNotMatch(show.split('\n').find((b) => b.startsWith('Before')) ?? '', new RegExp(p.title));
  // Here every remote investment program needs the builder's submit, so none is named; the in-person ones never are.
  assert.ok(invest.some((p) => p.in_person), JSON.stringify(ids(invest)));
  if (named.length > 0) assert.ok(show.includes(`Outside your standing approval, you say yes yourself: ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`}.`), show);
  else assert.doesNotMatch(show, /Outside your standing approval/, show);
  assert.match(show, free.length > 0 ? tonightRe(free.map((p) => p.title)) : /Say yes/);
  if (free.length > 0) assert.match(r.reply!.agent_note as string, /outside_approval/);
});

test('max_ask_usd keeps a larger ask out of tonight and names it; a program with no stated amount is not over it', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-big', title: 'Big Grant', reward: 'Up to $50,000 per grant', summary: 'Up to $50,000 · rolling', max_award_usd: 50_000 }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f-open', title: 'Open Grant' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, max_ask_usd: 10_000 } });
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    assert.equal(r.isError, false, r.text);
    const ready = ids(allReady(r.reply!));
    assert.ok(ready.includes('f-big') && ready.includes('f-open'), JSON.stringify(ready));
    const blockers = r.reply!.blockers as B[];
    assert.deepEqual(blockers.find((b) => b.program_id === 'f-big'), { program_id: 'f-big', sign_in: null, needs_click: false, needs: [], outside_approval: true, over_limit_usd: 10_000 });
    assert.equal(blockers.find((b) => b.program_id === 'f-open'), undefined);
    const freeRows = freeOf(r.reply!);
    const free = ids(freeRows);
    assert.ok(free.includes('f-open') && !free.includes('f-big'), JSON.stringify(free));
    const show = listText(r.reply!);
    // L24-11 (v6.1.16 Task 11): the ask outside the approval takes the standing line's yes.
    assert.match(show, /under your standing approval\. Say yes and I also apply to [^\n]*Big Grant/);
    assert.doesNotMatch(show, /also apply to [^\n]*Open Grant/);
    assert.match(show, tonightRe(freeRows.map((p) => p.title)));
    // With auto_apply off, the limits change nothing.
    const off = await linkedWith({ ...OWNER_RECORD, policy: { max_ask_usd: 10_000, categories: ['grant'] } });
    const o = await mcpCall({ ...ctx(off.id), builderId: off.builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(allReady(o.reply!)).includes('f-big'));
    assert.ok((o.reply!.blockers as B[]).every((b) => !b.outside_approval));
    assert.doesNotMatch(listText(o.reply!), /Outside your standing approval/);
  } finally {
    await sql()`DELETE FROM programs WHERE id IN ('f-big', 'f-open')`;
  }
});

test('never removes a program from the list entirely', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { never: ['z-fellows'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  const listed = [...ids(allReady(r.reply!)), ...ids(r.reply!.gaps), ...ids(r.reply!.not_fit), ...ids(r.reply!.blockers)];
  assert.ok(!listed.includes('z-fellows'), JSON.stringify(listed));
  assert.doesNotMatch(listText(r.reply!), /Z Fellows/);
});

test('a stale claim shows in released; a live one stays ready, marked', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const { claim } = await import('../v6/claims');
  await claim(`b:${builderId}`, 'alliance-all19', 'earnkit', id, new Date(NOW.getTime() - 25 * H));
  // v6.1.4: the default list shows two in-person programs (YC and Alliance), so the live claim is on one shown.
  // v6.1.7: only another installation's claim marks a program; this installation's own claim does not.
  const [other] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'find-other-' + Math.random()}, 'Cursor') RETURNING id`;
  const { linkInstallation } = await import('../v6/builders');
  await linkInstallation(other.id as number, builderId, NOW);
  await claim(`b:${builderId}`, 'y-combinator', 'earnkit', other.id as number, new Date(NOW.getTime() - H));
  await claim(`b:${builderId}`, 'arbitrum-mentorship-cohort-2', 'earnkit', id, new Date(NOW.getTime() - H));
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  // L23-7 (v6.1.16): released by title, with when it was started; the builder hears it, and the agent note names the title.
  assert.deepEqual(r.reply!.released, [{ program_id: 'alliance-all19', title: 'Alliance ALL19', started_at: new Date(NOW.getTime() - 25 * H).toISOString() }]);
  assert.match(r.reply!.agent_note as string, /released: Alliance ALL19\./);
  // L29-33 (v6.1.16 Task 15): the Say ONE_SAY_ORDER keeps is the last line.
  assert.match(r.reply!.show_to_builder as string, /\nAlliance ALL19: started Nov 3, nothing sent\. Say yes to apply or say skip\.$/);
  const ready = allReady(r.reply!) as { program_id: string; claimed_since?: string }[];
  assert.ok(ids(ready).includes('alliance-all19'));
  assert.equal(ready.find((p) => p.program_id === 'y-combinator')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
  assert.ok(ids(ready).includes('arbitrum-mentorship-cohort-2'));
  assert.equal(ready.find((p) => p.program_id === 'arbitrum-mentorship-cohort-2')?.claimed_since, undefined);
  assert.match(r.reply!.agent_note as string, /claimed_since is claimed by another of the builder's agents: do not submit it\./);
});

test('find with program_id, linked: the record fills an approved answer; unlinked as before', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD, ['projects.earnkit.answers.problem']);
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { program_id: 'z-fellows', project: PROJECT });
  assert.equal(r.isError, false, r.text);
  const fields = r.reply!.fields as { key: string; from: string; value: string | null; style?: string }[];
  const problem = fields.find((f) => f.key === 'problem')!;
  assert.deepEqual([problem.from, problem.value, typeof problem.style], ['record', 'Builders lose weeks on grant forms.', 'string']);
  assert.equal(fields.find((f) => f.key === 'email')!.value, 'jenil@example.com');
  assert.match(r.reply!.agent_note as string, /Fit approved answers by cutting, never by adding; the style contract travels on each field\./);
  // Without a project or project_id, no project's answers stand in (v6.1.8 C41); the record's facts still fill.
  const bare = await mcpCall({ ...ctx(id), builderId }, 'find', { program_id: 'z-fellows' });
  const bareFields = bare.reply!.fields as { key: string; from: string; value: string | null }[];
  assert.notEqual(bareFields.find((f) => f.key === 'problem')!.from, 'record');
  assert.equal(bareFields.find((f) => f.key === 'email')!.value, 'jenil@example.com');
  const byId = await mcpCall({ ...ctx(id), builderId }, 'find', { program_id: 'z-fellows', project_id: 'earnkit' });
  assert.equal((byId.reply!.fields as { key: string; from: string }[]).find((f) => f.key === 'problem')!.from, 'record');
  const v5 = await mcpCall(ctx(await installation()), 'find', { program_id: 'z-fellows', project: PROJECT });
  const v5fields = v5.reply!.fields as { from: string }[];
  assert.ok(v5fields.every((f) => f.from !== 'record'));
  assert.doesNotMatch(v5.reply!.agent_note as string, /Fit approved answers/);
});

test('a failed own read keeps the stored tier line; a broken link never fails find; the open list carries the sign-in line', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  const later = await mcpCall({ ...ctx(id, new Date(NOW.getTime() + 30 * H)), builderId, evidence: async () => { throw new Error('down'); } }, 'find', { project: PROJECT });
  assert.equal((later.reply!.evidence_summary as { tier: string }).tier, 'live');
  assert.ok((later.reply!.problems as string[]).includes('evidence not read'));

  const broken = await mcpCall({ ...ctx(await installation()), linkUrl: async () => { throw new Error('db blip'); } }, 'find', { project: PROJECT });
  assert.equal(broken.isError, false, broken.text);
  assert.equal('sign_in' in broken.reply!, false);

  await withEnv(OAUTH_ENV, async () => {
    const open = await mcpCall(ctx(await installation()), 'find', {});
    const link = open.reply!.sign_in as string;
    assert.match(link, /\/link\//);
    assert.match(open.reply!.show_to_builder as string, /^Open now:\n/);
    const openLines = (open.reply!.show_to_builder as string).split('\n');
    // L1j-6 (v6.1.17 fix round 1 I3): the ask is last, the sign-in sentence before it.
    assert.equal(openLines.at(-2), `Sign in once at ${link} so I remember you across agents.`);
    assert.equal(openLines.at(-1), 'Tell me which project and I match it.');
    assert.ok(openLines.length <= 10, openLines.join('\n'));
    for (const line of openLines.slice(1, -2)) assert.ok(line.endsWith('.'), line);
  });
});

// shownReadyOf: the split and cap of the ready list, pure (v6.1.5).
type V = { id: string; in_person: boolean };
const isIn = (v: V) => v.in_person;
const remote = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, in_person: false }));
const inPerson = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, in_person: true }));

test('shownReadyOf: zero remote and three in person gives the first two in person only', () => {
  assert.deepEqual(shownReadyOf(inPerson(3), false, isIn).map((v) => v.id), ['p0', 'p1']);
});

// v6.1.17 fix round 1 (I2): every remote ready program is in the JSON, so the yes never covers one the agent lacks.
test('shownReadyOf: six remote and zero in person gives all six remote', () => {
  assert.deepEqual(shownReadyOf(remote(6), false, isIn).map((v) => v.id), ['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
});

test('shownReadyOf: all returns everything unchanged', () => {
  const input = [...inPerson(3), ...remote(6)];
  assert.deepEqual(shownReadyOf(input, true, isIn), input);
});

test('shownReadyOf: remote first, then in person, even when the input interleaves them', () => {
  const [r, p] = [remote(3), inPerson(3)];
  const input = [p[0], r[0], p[1], r[1], p[2], r[2]];
  assert.deepEqual(shownReadyOf(input, false, isIn).map((v) => v.id), ['r0', 'r1', 'r2', 'p0', 'p1']);
});

// v6.1.6: the audit's project A (a Base agent with a public repo, a live URL and Base mainnet). Its repo was not
// recorded; the read replays the earnkit fixture repo under the project's own name, description and live URL.
const PROJECT_A = {
  name: 'Arkanoid Breakout Orchestrator',
  description: 'ERC-8004 compliant AI agent on Base that orchestrates Arkanoid Breakout game sessions',
  repo_url: `https://github.com/${rec.repo}`,
  live_url: 'https://arkanoid-breakout-five.vercel.app',
  chains: [{ chain: 'base', mainnet: true }],
};
type G = { program_id: string; n: number; gap: { kind: string; item: string; what: string }; also: { kind: string; item: string; what: string }[]; rules: string[]; setup: string[] };
const lineOf = (show: string, n: number) => show.split('\n').find((l) => l.startsWith(`${n}. `)) ?? '';
const BASE_RULE = 'a pre-seed or seed stage startup that chooses Base as its home';
/** The block of the reply that starts with `head`, up to the next blank line. */


const PROJECT_B = { name: 'dotfiles', description: 'Mathias Bynens dotfiles for macOS', repo_url: 'https://github.com/mathiasbynens/dotfiles' };
const PROJECT_C = { name: 'My notes', description: 'Personal markdown notes and dotfiles' };
/** The in-person block numbered from `n`. L1e-3 (v6.1.13): YC's application answers are the builder's, repo or not
 *  (its file says so), so its line names them for every project; `_noRepo` is kept for the callers. */
const inPersonBlock = (n: number, _noRepo = false) => [
  'In person (2):',
  `${n}. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.`,
  `${n + 1}. Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.`,
];
/** L1e-6 (v6.1.13): 14 days out, its list line says when it closes, as its detail does. */
const META_VR_LINE = (n: number) => `${n}. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.`;
/** L1c-2 (v6.1.10): with the VR rule unlikely (no keyword named), the rule slot goes to a rule with no keywords.
 *  L1d-2 (v6.1.11): Colosseum's crypto-product rule is unlikely for a project naming no crypto word. */
/** L1e-2 (v6.1.13): Thiel's age rule names who it is for (student, college), so a project naming none of those never
 *  sees it; FUTO, a rule with no keywords, takes the one no-hit slot where the project has code to show (L1e-6: an
 *  idea or an empty repo has none, and is left the in-person block alone). */
const FUTO_ONLY = ['One step away (1):', '1. FUTO Microgrants, $1,000 to $5,000. Their rule: open source software from a small or early-stage project.'];
/** Fix round 1 (T3-R1): an idea, notes or an empty repo: FUTO one real step away (code in a repo), then in person.
 *  L18-2 (v6.1.18): FUTO is open source, so with no repo link the code goes in a public repo; an empty repo read is
 *  public already, so its step stays code in a repo. */
const FUTO_CODE = (empty = false) => `1. FUTO Microgrants, $1,000 to $5,000: code in a${empty ? '' : ' public'} repo. Their rule: open source software from a small or early-stage project.`;
// L29-26 (v6.1.16 Task 15): one line each, no blank lines.
// L18-1 (v6.1.18): the rows the rank cap left out are counted before the Say.
const IDEA_REPLY = (notes: string[] = [], more = 19, empty = false) => ['One step away (1):', FUTO_CODE(empty), ...inPersonBlock(2), ...notes, `And ${more} more in the full list.`, codeFirst(empty)].join('\n');
/** The closing on a rule-only program the reply lists first. */
const THAT_RULE_FIRST = 'Nothing is ready yet. Say "yes 1" if that rule fits you and I get it ready.';
/** L1d-2 (v6.1.11, Review Focus 2): Colosseum's line names its account and sprint, never "a demo video" alone. */
// L18-2 (v6.1.18): an idea has no repo, so Colosseum's code in a repo comes before the demo video.
const COLOSSEUM_LINE = (n: number) => `${n}. Colosseum Eternal, $25,000 award: code in a repo and a demo video. First: sign up for a Colosseum account; start the four-week sprint in the Eternal dashboard. Their rules: a crypto product built during the four-week sprint; the team has not raised venture capital for the startup it submits.`;
/** Fix round 1 (v6.1.10): a remote step shown closes the reply with its own step, in-person programs listed or not. */
const RULE_FIRST = 'Nothing is ready yet. Say "yes 1" if that rule fits you and I get it ready.';
/** L1f-2 (v6.1.14): the only step needs code first, so the closing asks for that, never the rule yes. */
const codeFirst = (empty = false) => `Nothing is ready yet. Tell me when the code is in a${empty ? '' : ' public'} repo and I look again.`;
// L29-34 (v6.1.16 Task 15): unlinked, the one ask holds the sign-in that checks it.
const USERS_FIRST = 'Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.';
/** The rule-bearing program alone, a list of one (N-2, v6.1.9 fix round 1). */
const META_VR_ONLY = ['One step away (1):', META_VR_LINE(1)];

test('R18e: project A (Base mainnet; its replayed repo also reads Arbitrum) gets the rule-only program on its first reported chain, Base (v6.1.6, v6.1.7)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_A });
  assert.equal(r.isError, false, r.text);
  assert.equal(
    r.reply!.show_to_builder,
    [
      "Ready to apply (1):",
      "1. Arbitrum Mentorship Program: Cohort 2, up to $100,000, closes Dec 6. Long odds: few prizes for many entries.",
      "One step away (3):",
      // L1i-2 (v6.1.16.1): every step row the budget allows, numbered as shown.
      "2. Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app and tell me if real people use it.",
      "3. Base Ecosystem Fund, pre-seed and seed investment, amount not stated. Their rule: a pre-seed or seed stage startup that chooses Base as its home.",
      "4. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.",
      // L1j-3 (v6.1.17): the in-person rows left out are counted. L18-1 (v6.1.18): with the rows the rank cap left out.
      'And 32 more in the full list.',
      // L28-8 (v6.1.16 Task 14): the founders count and the time commitment are the builder's team facts to give.
      // FR-1 (v6.1.16 Task 14 fix round 1): signed out with a repo, sign-in comes first.
      'Sign in once and I check the repo is yours; then say yes.',
    ].join('\n'),
  );
  // Without the repo's Arbitrum, the Base rule-only program takes the slot ahead of the $900K chain-agnostic one and
  // ahead of the richer Meta VR: the rule slot prefers a program on the builder's chain (v6.1.8 fix round 3).
  const { repo_url: _, ...baseOnly } = PROJECT_A;
  const b = await mcpCall(ctx(await installation()), 'find', { project: baseOnly });
  const ruled = (b.reply!.gaps as G[]).filter((g) => [g.gap, ...g.also].some((x) => x.kind === 'rule'));
  assert.deepEqual(ruled.map((g) => g.program_id), ['base-ecosystem-fund'], b.reply!.show_to_builder as string);
});

test('R18e, R18f, C54, B20, B20c, B20d: projects B (dotfiles, repo link answers 404) and C (notes, no repo) report no chain: no contract step, no users question, the rule-bearing program alone, no in-person gap program by default (v6.1.6, v6.1.8, v6.1.9)', async () => {
  const b = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_B });
  assert.equal(b.isError, false, b.text);
  // Its repo is not recorded, so the replay answers 404: unread, said once (fix round 1). A repo link that was not read
  // does not exist for the users question (B20d), so FLOSS/fund is not a fit; Meta VR stands alone, a list of one (N-2).
  assert.deepEqual(b.reply!.repo_notes, ['unread']);
  assert.equal(
    b.reply!.show_to_builder,
    [...FUTO_ONLY, ...inPersonBlock(2), 'I could not read the repo; matched on what you told me.', 'And 19 more in the full list.', THAT_RULE_FIRST].join('\n'),
  );
  // The same repo with reads paused for the day (the daily cap): the repo likely exists, the users question stands.
  const { hit, LIMITS } = await import('./rate-limit');
  const capped = await installation();
  for (let n = 0; n < LIMITS.repoRead.limit; n++) await hit(`repoRead:${capped}`, LIMITS.repoRead.limit, LIMITS.repoRead.windowSeconds, NOW);
  // L26-9 (v6.1.16 Task 12): the 404 above is kept 30 minutes and answers unread with no read; a fresh read is paused.
  await sql()`DELETE FROM repo_cache`;
  const paused = await mcpCall(ctx(capped), 'find', { project: PROJECT_B });
  assert.deepEqual(paused.reply!.repo_notes, ['paused']);
  assert.equal(
    paused.reply!.show_to_builder,
    ['One step away (1):', '1. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.', ...inPersonBlock(2), 'Repo reads are paused until tomorrow; matched on what you told me.', 'And 24 more in the full list.', USERS_FIRST].join('\n'),
  );
  // No repo and no live link: nothing to ask the users question of (B20c); the rule-bearing program stands alone as a
  // list of one (N-2 fix round 1), and the closing asks its rule first (I2, final).
  const c = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_C });
  assert.equal(c.isError, false, c.text);
  assert.equal(c.reply!.show_to_builder, IDEA_REPLY());
  for (const r of [b, c]) assert.doesNotMatch(r.reply!.show_to_builder as string, /FLOSS|real people use it/);
  for (const r of [b, c]) assert.match(r.reply!.agent_note as string, /^The full list holds \d+ more; show it when the builder asks for all, more or the full list\. Call find with filter\.all for it\.$/m);
  for (const project of [PROJECT_B, PROJECT_C]) {
    const all = await mcpCall(ctx(await installation()), 'find', { project, filter: { all: true } });
    assert.equal((all.reply!.not_fit as { program_id: string; reason: string }[]).find((n) => n.program_id === 'floss-fund-zerodha')?.reason, 'needs a product people use', project.name);
  }
  for (const r of [b, c]) {
    assert.ok((r.reply!.gaps as { in_person: boolean }[]).every((g) => !g.in_person), JSON.stringify(ids(r.reply!.gaps)));
    assert.doesNotMatch(r.reply!.show_to_builder as string, /deploy the contract|a contract on/);
  }
  // filter.all still lists the in-person ones; Monad Blitz Guangzhou needs a contract on Monad, so it is not a fit
  // (Monad Blitz Oregon is closed since lane 20, v6.1.16).
  const all = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_C, filter: { all: true } });
  const notFit = all.reply!.not_fit as { program_id: string; reason: string }[];
  assert.deepEqual(notFit.filter((n) => n.program_id.startsWith('monad-blitz')).map((n) => n.reason), ['needs a contract on Monad']);
  assert.ok(ids(all.reply!.gaps).includes('antler-us-residency'), JSON.stringify(ids(all.reply!.gaps)));
});

/** The web2 SaaS fixture: a public Next.js repo with a homepage and no chain anywhere. */
const dash = replayFetch('nextjs-dashboard');
const SAAS = { name: 'Dashboard', description: 'An admin dashboard.', repo_url: `https://github.com/${dash.repo}` };
const dashCtx = async () => ({ installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch });
/** The VR persona: its own name and words, on the replayed public Next.js repo (code read), users said. */
const VR = { name: 'ALVR', description: 'Stream VR games from your PC to your headset over Wi-Fi', repo_url: `https://github.com/${dash.repo}`, users: true };

test('L1i-3 (v6.1.16.1, Review Focus 2): signed out with a link, the users question carries the one sign-in; the proof line has no link', async () => {
  const link = 'https://earnkit.com/link/abc';
  const c = { ...(await dashCtx()), linkUrl: async () => link };
  const d = await mcpCall(c, 'find', { project: SAAS });
  const show = d.reply!.show_to_builder as string;
  assert.equal(show, [
    "One step away (1):",
    "1. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.",
    "In person (2):",
    "2. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.",
    "3. Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
    // L1j-1 (v6.1.17): the closing carries the sign-in, so no other line mentions it.
    // L18-1 (v6.1.18): the rows the rank cap left out are counted.
    'And 22 more in the full list.',
    `Nothing is ready yet. Do real people use it? Say yes, sign in once at ${link}, and I check.`,
  ].join('\n'));
  assert.equal(show.split(/(?<=[.?!])\s+/).filter((x) => /sign in once/i.test(x)).length, 1, show);
  assert.ok(!show.includes(`Sign in once at ${link} and I read your repo for proof and remember you.`));
  assert.equal(show.split(link).length, 2, show);
  // Fix round 1 (I2): the full list too (personas 4, 11, 13, 14, 16, 25, 26): one sign-in sentence, one link.
  const full = (await mcpCall(c, 'find', { project: SAAS, filter: { all: true } })).reply!.show_to_builder as string;
  assert.equal(full.split(/(?<=[.?!])\s+/).filter((x) => /sign in once/i.test(x)).length, 1, full);
  assert.equal(full.split(link).length, 2, full);
  assert.ok(!/I read your repo for proof/.test(full), full);
  assert.ok(full.endsWith(`Nothing is ready yet. Do real people use it? Say yes, sign in once at ${link}, and I check.`), full);
});

// Placed beside L1i-3, so it sees the same catalog (later tests add ready programs).
test('Task 2 (v6.1.16.1, Task 1 leftover): after an unlink, a find closing on the users question has one sign-in sentence, the closing\'s', async () => {
  const { unlinkInstallation } = await import('../v6/builders');
  const link = 'https://earnkit.com/link/t2leftover';
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  assert.equal(await unlinkInstallation(id, builderId, NOW), true);
  const d = await mcpCall({ installationId: id, builderId: null, now: new Date(NOW.getTime() + H), gh: dash.fetch, linkUrl: async () => link }, 'find', { project: SAAS });
  const show = d.reply!.show_to_builder as string;
  assert.equal(show.split('\n').at(-1), `Nothing is ready yet. Do real people use it? Say yes, sign in once at ${link}, and I check.`, show);
  assert.ok(show.includes('This agent was unlinked from your account.'), show);
  assert.equal(show.split(/(?<=[.?!])\s+/).filter((x) => /sign in once/i.test(x)).length, 1, show);
  assert.equal(show.split(link).length, 2, show);
});

// Placed beside L1i-3, so it sees the same catalog.
test('L1j-1, L1j-3, L1j-6 (v6.1.17, Review Focus 1 and 3): the lane 1j personas: one sign-in sentence, the Say last, the hidden rows counted', async () => {
  const link = 'https://earnkit.com/link/l1j';
  // Personas 4, 11, 13, 14, 16, 25, 26 and check-16: the users gap, signed out, default and full list.
  for (const all of [false, true]) {
    const c = { ...(await dashCtx()), linkUrl: async () => link };
    const show = (await mcpCall(c, 'find', { project: SAAS, ...(all ? { filter: { all: true } } : {}) })).reply!.show_to_builder as string;
    assert.equal(show.split(/(?<=[.?!])\s+/).filter((x) => /sign in/i.test(x)).length, 1, show);
    assert.equal(show.split('\n').at(-1), `Nothing is ready yet. Do real people use it? Say yes, sign in once at ${link}, and I check.`, show);
  }
  // Personas 1, 5, 10, 17, 19, 20, 22, 23 and 27: two of four ready rows shown, the other two counted.
  const vr = (await mcpCall(await dashCtx(), 'find', { project: VR })).reply!.show_to_builder as string;
  assert.deepEqual(vr.split('\n').slice(-2), ['And 23 more in the full list.', 'Sign in once and I check the repo is yours; then say yes.']);
});

/**
 * v6.1.17 Task 5 (v6.1.16 Task 15 M5, Task 8 N4): lane 1h's personas as named replays, their own words on a recorded
 * repo of the same kind (a Solana repo, a Base app, an archived, an empty or a public Next.js repo; no repo stays none),
 * signed out with a link, as lanes 1h and 1j ran them.
 */
const LANE_1H: Record<string, { project: Record<string, unknown>; repo?: string }> = {
  2: { repo: 'saber-distributor', project: { name: 'Orca Whirlpools', description: 'Concentrated liquidity DEX on Solana with a TypeScript and Rust SDK', live_url: 'https://www.orca.so', chains: [{ chain: 'solana', mainnet: true, contract: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc' }], users: true } },
  3: { repo: 'onchain-reaction', project: { name: 'Arkanoid Breakout Orchestrator', description: 'ERC-8004 compliant AI agent on Base that orchestrates Arkanoid Breakout game sessions', live_url: 'https://arkanoid-breakout-five.vercel.app', chains: [{ chain: 'base', mainnet: true }] } },
  6: { repo: 'nextjs-dashboard', project: { name: 'VoteChain', description: 'Hackathon project: private onchain voting built this weekend on Scaffold-ETH', first_commit_at: '2026-11-07T10:00:00Z', last_commit_at: '2026-11-09T22:00:00Z', chains: [{ chain: 'base', mainnet: false }] } },
  8: { project: { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' } },
  9: { repo: 'nextjs-dashboard', project: { name: 'Billing Core', description: 'Usage-based billing engine for B2B APIs, private repo', private: true, users: true } },
  12: { repo: 'archived-dashboard', project: { name: 'Atom', description: 'The hackable text editor' } },
  15: { repo: 'empty-repo', project: { name: 'LibreDesktop project list', description: 'A list of LibreDesktop projects' } },
  18: { repo: 'nextjs-dashboard', project: { name: 'Chainlink price feeds', description: 'Decentralized oracle network delivering price data onchain; ETH/USD feed on Ethereum', chains: [{ chain: 'ethereum', mainnet: true, contract: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' }], users: true } },
  24: { repo: 'nextjs-dashboard', project: { name: 'Onchain Tipjar', description: 'Tip jar contract for creators on Base', chains: [{ chain: 'base' }] } },
  26: { repo: 'nextjs-dashboard', project: { name: 'Sepolia Escrow', description: 'Escrow contract deployed on Sepolia testnet only', chains: [{ chain: 'ethereum', mainnet: false, contract: '0x1111111111111111111111111111111111111111' }] } },
  29: { project: { name: 'BaseMint', description: 'NFT mint page on Base', chains: [{ chain: 'base', mainnet: true, contract: '0x4200000000000000000000000000000000000006' }] } },
  30: { project: { name: 'Roomly', description: 'A booking app for coworking rooms', users: true } },
  31: { project: { name: 'SolTip', description: 'Tipping app on Solana', chains: [{ chain: 'solana', mainnet: true }] } },
};
const LANE_1H_LINK = 'https://earnkit.com/link/lane1h';
async function lane1hAll(id: number): Promise<Record<string, unknown>> {
  const p = LANE_1H[id];
  const rr = p.repo ? replayFetch(p.repo) : null;
  const c = { installationId: await installation(), builderId: null, now: NOW, ...(rr ? { gh: rr.fetch } : {}), linkUrl: async () => LANE_1H_LINK };
  return (await mcpCall(c, 'find', { project: { ...p.project, ...(rr ? { repo_url: `https://github.com/${rr.repo}` } : {}) }, filter: { all: true } })).reply!;
}
async function lane1h(id: number, all = false): Promise<string> {
  const p = LANE_1H[id];
  const rr = p.repo ? replayFetch(p.repo) : null;
  const c = { installationId: await installation(), builderId: null, now: NOW, ...(rr ? { gh: rr.fetch } : {}), linkUrl: async () => LANE_1H_LINK };
  const project = { ...p.project, ...(rr ? { repo_url: `https://github.com/${rr.repo}` } : {}) };
  const r = await mcpCall(c, 'find', { project, ...(all ? { filter: { all: true } } : {}) });
  assert.equal(r.isError, false, r.text);
  return r.reply!.show_to_builder as string;
}

const SOLANA_MOBILE = 'Solana Mobile Builder Grants, milestone grants, requests of $10,000 to $50,000';
const MWA = 'use Mobile Wallet Adapter and Seed Vault in an Android app. Their rule: a mobile-focused dApp for the Solana Mobile ecosystem.';

test('L1h-8 (v6.1.17 Task 5, v6.1.16 Task 15 M5): lane 1h personas 8, 9, 12, 15, 30 and 31 name the gap once in line 1 and the closing names only the step', async () => {
  const signIn = (proof = false) => `Sign in once at ${LANE_1H_LINK} and I ${proof ? 'read your repo for proof and remember you' : 'remember you across agents'}.`;
  // L18-2 (v6.1.18): with no repo link FUTO's code goes in a public repo; the empty repo (15) is public already.
  const CODE = codeFirst();
  const futo = FUTO_CODE();
  const floss = (gap: string) => `1. FLOSS/fund, $10,000 to $100,000: ${gap}. First: publish a funding manifest on your site or repo.`;
  // L18-1 (v6.1.18): each persona's more line counts the rows the rank cap left out.
  const want: [number, string, string[], string, number][] = [
    [8, 'code in a public repo', ['One step away (1):', futo, ...inPersonBlock(2), signIn()], CODE, 19],
    [9, 'a public repo', ['One step away (1):', floss('a public repo'), ...inPersonBlock(2), 'Private repo: matched on what you told me.', signIn()], 'Nothing is ready yet. Tell me when the repo is public and I look again.', 23],
    [12, 'the repo is archived', ['One step away (1):', floss('the repo is archived'), ...inPersonBlock(2), signIn(true)], 'Nothing is ready yet. Tell me the live repo and I look again.', 22],
    [15, 'code in a repo', ['One step away (1):', FUTO_CODE(true), ...inPersonBlock(2), 'The repo is empty, so I matched on what you told me.', signIn()], codeFirst(true), 17],
    [30, 'code in a public repo', ['One step away (1):', futo, ...inPersonBlock(2), signIn()], CODE, 19],
    [31, 'code in a repo', ['One step away (1):', '1. Solana Foundation Grants, milestone grants, amount not stated: code in a repo. Their rule: a public good, meaning a significant open source contribution to the Solana ecosystem or a free community offering.', ...inPersonBlock(2), signIn()], codeFirst(true), 10],
  ];
  for (const [id, gap, head, closing, more] of want) {
    const show = await lane1h(id);
    assert.equal(show, [...head, `And ${more} more in the full list.`, closing].join('\n'), `persona ${id}`);
    const lines = show.split('\n');
    // The gap words once, in line 1; no other line but the closing's step speaks of the same gap.
    assert.equal(lines[1].split(gap).length, 2, `persona ${id}`);
    assert.ok(lines.slice(2, -1).every((l) => !l.includes(gap) && !/^Tell me|First:.*repo is|code in a repo/i.test(l.replace(/^\d+\. [^:]+: /, ''))), `persona ${id}`);
    assert.equal(show.split(LANE_1H_LINK).length, 2, `persona ${id}`);
  }
});

test('L1h-3 (v6.1.17 Task 5, v6.1.16 Task 8 N4): lane 1h\'s filter.all for personas 2, 3, 6, 18, 24, 26, 29 and 31 never reads "on Solana and Mobile Wallet Adapter"', async () => {
  for (const id of [2, 3, 6, 18, 24, 26, 29, 31]) {
    const r = await lane1hAll(id);
    const text = [listText(r), r.agent_note as string].join('\n');
    assert.doesNotMatch(text, /on Solana and Mobile Wallet Adapter/, `persona ${id}`);
    const line = listText(r).split('\n').find((l) => l.includes(`${SOLANA_MOBILE}:`))!;
    // A Solana project needs only the feature; any other the contract first, joined with ", and".
    const solana = id === 2 || id === 31;
    assert.equal(line.replace(/^\d+\. /, ''), `${SOLANA_MOBILE}: ${solana ? '' : 'deploy the contract on Solana, and '}${MWA}`, `persona ${id}`);
  }
});

test('C54 (v6.1.8, Review Focus 1): the web2 SaaS fixture\'s default and full replies hold no chain step; contract programs are not a fit', async () => {
  const d = await mcpCall(await dashCtx(), 'find', { project: SAAS });
  assert.equal(d.isError, false, d.text);
  // N-2 (v6.1.9): one rule-free step, so the list is that one line, never Meta VR as line two; M1: the closing asks
  // the users question as a yes.
  assert.equal(
    d.reply!.show_to_builder,
    [
      "One step away (1):",
      "1. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.",
      "In person (2):",
      "2. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.",
      "3. Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      // L18-1 (v6.1.18): the rows the rank cap left out are counted.
      'And 22 more in the full list.',
      "Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.",
    ].join('\n'),
  );
  assert.match(d.reply!.agent_note as string, /^The full list holds \d+ more; show it when the builder asks for all, more or the full list\. Call find with filter\.all for it\.$/m);
  // C1 (final fix, B20b): the users question is the whole step; once said, FLOSS/fund is ready, never the bar.
  const said = await mcpCall(await dashCtx(), 'find', { project: { ...SAAS, users: true } });
  assert.match(blockOf(said.reply!.show_to_builder as string, 'Ready to apply'), /^1\. FLOSS\/fund, \$10,000 to \$100,000\. /m);
  assert.doesNotMatch(said.reply!.show_to_builder as string, /proof that |funded wallets/);
  const all = await mcpCall(await dashCtx(), 'find', { project: SAAS, filter: { all: true } });
  const show = listText(all.reply!);
  assert.doesNotMatch(show, /deploy the contract|contract on|\b(Arc|Arbitrum|Monad|Solana|Ethereum)\b(?! Foundation| Incubator)/);
  const gaps = all.reply!.gaps as { gap: { kind: string }; also: { kind: string }[] }[];
  assert.ok(gaps.every((g) => [g.gap, ...g.also].every((x) => x.kind !== 'chain' && x.kind !== 'contract_on')));
  const notFit = new Map((all.reply!.not_fit as { program_id: string; reason: string }[]).map((n) => [n.program_id, n.reason]));
  assert.equal(notFit.get('circle-developer-grants'), 'needs a contract on Arc');
  assert.equal(notFit.get('arbitrum-mentorship-cohort-2'), 'needs a contract on Arbitrum');
  assert.equal(notFit.get('solana-foundation-grants'), 'needs a contract on Solana');
});

test('C60, C1, N-2 (v6.1.8, v6.1.9): the VR persona (a public repo with code, users said) is ready for FLOSS with no sign-in bar, then Meta VR alone as its step; the full list leads with Meta VR', async () => {
  const r = await mcpCall(await dashCtx(), 'find', { project: VR });
  assert.equal(r.isError, false, r.text);
  assert.equal(
    r.reply!.show_to_builder,
    [
      "Ready to apply (1):",
      "1. FLOSS/fund, $10,000 to $100,000. First: publish a funding manifest on your site or repo.",
      "One step away (1):",
      "2. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.",
      // L1j-3 (v6.1.17): YC and Alliance, left out, are counted.
      'And 23 more in the full list.',
      'Sign in once and I check the repo is yours; then say yes.',
    ].join('\n'),
  );
  assert.doesNotMatch(r.reply!.show_to_builder as string, /proof that /);
  // One real change each, so the money decides: $1M pool, $120K pool, then PayPal's $67,500 pool.
  const all = await mcpCall(await dashCtx(), 'find', { project: VR, filter: { all: true } });
  assert.deepEqual(ids(all.reply!.gaps).slice(0, 3), ['meta-vr-start-competition-2026', 'codegeist-2026', 'paypal-ai-hackathon']);
  // B20c fix round 1 (persona 9): a private repo is the builder's word, so it exists. L1f-1 (v6.1.14, Review Focus 6):
  // FLOSS/fund and HeroDevs are open source programs, so the private repo is one step from each (a public repo), never
  // ready and never "Say yes and I apply.".
  const hidden = await mcpCall(ctx(await installation()), 'find', { project: { ...VR, private: true } });
  assert.equal(blockOf(hidden.reply!.show_to_builder as string, 'Ready to apply'), '');
  assert.doesNotMatch(hidden.reply!.show_to_builder as string, /Say yes and I apply/);
  assert.equal(
    hidden.reply!.show_to_builder,
    [
      "One step away (3):",
      "1. FLOSS/fund, $10,000 to $100,000: a public repo. First: publish a funding manifest on your site or repo.",
      // L1i-2 (v6.1.16.1): every step row the budget allows.
      "2. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.",
      "3. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000: a public repo. Their rule: a developer tool whose versions are near or past official end of life.",
      "In person (2):",
      "4. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.",
      "5. Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      "Private repo: matched on what you told me.",
      // L18-1 (v6.1.18): the rows the rank cap left out are counted.
      'And 21 more in the full list.',
      "Nothing is ready yet. Tell me when the repo is public and I look again.",
    ].join('\n'),
  );
  assert.equal((hidden.reply!.show_to_builder as string).match(/make the repo public|the repo is public/g)!.length, 1);
  // L1g-8b (v6.1.16, Review Focus 1): the full list never asks an open source program's rule, nor an unlikely one, while
  // the public repo is a step: one shape with the default list.
  const full = await mcpCall(ctx(await installation()), 'find', { project: { ...VR, private: true }, filter: { all: true } });
  const fullShow = listText(full.reply!);
  assert.equal(fullShow.split('\n').at(-1), 'Nothing is ready yet. Tell me when the repo is public and I look again.');
  assert.doesNotMatch(fullShow, /Say "yes/);
  assert.ok((full.reply!.gaps as { public_first?: true }[]).some((g) => g.public_first), fullShow);
  const one = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss', project: { ...VR, private: true } });
  assert.equal(one.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000: a public repo. First: publish a funding manifest on your site or repo.', 'Tell me when the repo is public and I look again.'].join('\n'));
  // FR-1 (final fix): the one-program reply names the step once too.
  assert.doesNotMatch(one.reply!.show_to_builder as string, /make the repo public/);
  assert.ok((hidden.reply!.agent_note as string).split('\n').includes(REPO_STEP_NOTE));
});

test('N-3 (v6.1.9, Review Focus 2): the VR persona marks the demo video done and Meta VR heads the next default list as rule-only with its yes', async () => {
  const c = await dashCtx();
  const first = await mcpCall(c, 'find', { project: VR });
  assert.equal(blockOf(first.reply!.show_to_builder as string, 'One step away'), ['One step away (1):', META_VR_LINE(2)].join('\n'));
  // L29-8 (v6.1.16 Task 15): a claim waits on the rule; the refusal says so and nothing is written.
  const started = await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'started' });
  assert.equal(started.isError, true, started.text);
  assert.match(started.reply!.show_to_builder as string, /^Confirm the rule first: a hands-first experience for Meta VR devices, entered by a Meta VR Start member\. Say yes if that is you\.$/);
  const { claim } = await import('../v6/claims');
  await claim(`i:${c.installationId}`, 'meta-vr-start-competition-2026', `https://github.com/${dash.repo}`.toLowerCase(), c.installationId, NOW);
  // A live claim (another path) pins it: it heads the step list with its demo video and rule.
  const claimed = await mcpCall(c, 'find', { project: VR });
  assert.equal(
    blockOf(claimed.reply!.show_to_builder as string, 'One step away'),
    ['One step away (1):', '2. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.'].join('\n'),
  );
  const done = await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'gap_done', item: 'demo_video' });
  assert.equal(done.isError, false, done.text);
  const again = await mcpCall(c, 'find', { project: VR });
  const show = again.reply!.show_to_builder as string;
  assert.equal(
    blockOf(show, 'One step away'),
    ['One step away (1):', '2. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.'].join('\n'),
  );
  assert.equal(ids(again.reply!.gaps)[0], 'meta-vr-start-competition-2026');
  assert.doesNotMatch(show, /Codegeist/);
  assert.equal(show.split('\n').at(-1), 'Sign in once and I check the repo is yours; then say yes.');
  // Another installation, with no claim and no step done, still sees the demo video step.
  const other = await mcpCall(await dashCtx(), 'find', { project: VR });
  assert.equal(blockOf(other.reply!.show_to_builder as string, 'One step away'), ['One step away (1):', META_VR_LINE(2)].join('\n'));
  // Skipped, it leaves the list.
  await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'skipped' });
  const skipped = await mcpCall(c, 'find', { project: VR });
  assert.doesNotMatch(skipped.reply!.show_to_builder as string, /Meta VR/);
});

/** Lane 1e (v6.1.13): the persona words of the fifth live run, on the replayed public Next.js repo (code read). */
const STARTER = { name: 'Next.js SaaS Starter', description: 'SaaS starter with Stripe subscriptions, team billing and a dashboard', repo_url: `https://github.com/${dash.repo}`, live_url: 'https://next-saas-start.vercel.app', users: true };
const STUDENT = { name: 'micrograd', description: 'My student side project: a tiny scalar autograd engine and neural net library', repo_url: `https://github.com/${dash.repo}` };
const RIPGREP = { name: 'ripgrep', description: 'Recursively searches directories for a regex pattern while respecting gitignore', repo_url: `https://github.com/${dash.repo}` };
const THIEL_LINE = 'Thiel Fellowship, $250,000 over two years. Their rule: applicant aged 22 or younger with no university degree, who will drop out of college if selected.';

test('L1e-2 (v6.1.13, Review Focus 7, persona 1): a company never sees Thiel; a ready FLOSS/fund leaves exactly one "Say"', async () => {
  const r = await mcpCall(await dashCtx(), 'find', { project: STARTER });
  const show = r.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /Thiel/);
  // FR-1 (v6.1.16 Task 14 fix round 1): signed out with a repo, the sign-in is the one action.
  assert.equal(show.match(/\bSay\b/g)?.length ?? 0, 0, show);
  assert.equal(show.split('\n').at(-1), 'Sign in once and I check the repo is yours; then say yes.');
});

test('L1e-2 and L1e-5 (v6.1.13, persona 7): a student project sees Thiel by default, and filter.all closes on its rule', async () => {
  const r = await mcpCall(await dashCtx(), 'find', { project: STUDENT });
  const show = r.reply!.show_to_builder as string;
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'thiel-fellowship');
  assert.ok(g, show);
  assert.equal(lineOf(show, g.n), `${g.n}. ${THIEL_LINE}`);
  const all = await mcpCall(await dashCtx(), 'find', { project: STUDENT, filter: { all: true } });
  // L1i-5 (v6.1.16.1): the full list shows no rule, so it asks none; a number gets that program's details.
  assert.equal((listText(all.reply!)).split('\n').at(-1), `Nothing is ready yet. ${FULL_RULE_SAY}`);
  assert.doesNotMatch(all.reply!.show_to_builder as string, /Say "yes/);
  assert.match(all.reply!.agent_note as string, /When the builder says a number from the full list, call find with that item's program_id\./);
});

test('L1e-4 (v6.1.13, Review Focus 9, persona 4): after the users yes on FLOSS/fund, HeroDevs never asks it again', async () => {
  const c = await dashCtx();
  await mcpCall(c, 'find', { project: RIPGREP });
  const yes = await mcpCall(c, 'track', { program_id: 'floss', status: 'gap_done', item: 'users', project: RIPGREP });
  assert.equal(yes.isError, false, yes.text);
  const again = await mcpCall(c, 'find', { project: RIPGREP, filter: { all: true } });
  const show = listText(again.reply!);
  assert.doesNotMatch(show, /real people use it/);
  const hero = [...(again.reply!.gaps as G[]), ...(allReady(again.reply!) as G[])].find((x) => x.program_id === 'herodevs-sustainability-fund');
  assert.ok(hero, show);
  assert.doesNotMatch(lineOf(show, hero.n), /real people/);
  // The send-time verdict reads the same project fact: track started names no users step for HeroDevs.
  const started = await mcpCall(c, 'track', { program_id: 'herodevs-sustainability-fund', status: 'started', project: RIPGREP });
  assert.doesNotMatch(started.reply!.show_to_builder as string, /real people/);
});

test('L1e-3 (v6.1.13, Review Focus 8, personas 8 and 15): after the Thiel rule yes, the idea and the empty repo read one line and a closing that names the answers', async () => {
  const emptyRec = replayFetch('empty-repo');
  const IDEA = { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' };
  const EMPTY = { name: 'LibreDesktop project list', description: 'A list of LibreDesktop projects', repo_url: `https://github.com/${emptyRec.repo}` };
  const lines: string[][] = [];
  for (const [project, gh] of [[IDEA, undefined], [EMPTY, emptyRec.fetch]] as const) {
    const c = { installationId: await installation(), builderId: null, now: NOW, ...(gh ? { gh } : {}) };
    const one = await mcpCall(c, 'find', { program_id: 'thiel', project });
    const g = one.reply!.verdict as { gaps: { item: string }[] };
    await mcpCall(c, 'track', { program_id: 'thiel', status: 'gap_done', item: g.gaps[0].item, project });
    const after = await mcpCall(c, 'find', { program_id: 'thiel', project });
    const list = await mcpCall(c, 'find', { project });
    const show = list.reply!.show_to_builder as string;
    lines.push([after.reply!.show_to_builder as string, lineOf(show, 1), lineOf(show, 2), show.split('\n').at(-1)!]);
    assert.doesNotMatch(show, /Say yes/, show);
  }
  // L18-2 (v6.1.18): the two read alike but for FUTO's step: the idea's code goes in a public repo, the empty repo's in it.
  assert.deepEqual(lines[1], [...lines[0].slice(0, 2), FUTO_CODE(true).replace(/^1\./, '2.'), lines[0][3]]);
  assert.deepEqual(lines[0], [
    // L24-2 (v6.1.16 Task 11): the rule yes settled only the rule; the next reply offers the draft afresh. After that
    // offer (apply), the list's closing names the answers (Review Focus 1, v6.1.14), so the line does not.
    ['Thiel Fellowship, $250,000 over two years. Long odds: many apply, few are taken. You give: the online application answers.', 'Say yes and I draft it for you to send.'].join('\n'),
    '1. Thiel Fellowship, $250,000 over two years. Long odds: many apply, few are taken.',
    // Fix round 1 (T3-R1): FUTO is one real step away, code in a repo, with no yes of its own (T3-R5).
    FUTO_CODE().replace(/^1\./, '2.'),
    'Thiel Fellowship needs your online application answers; then I draft it for you to send.',
  ]);
});


test('fix round 1 (v6.1.13, T3-R3): a project reporting chain avalanche, no Avalanche word in its prose, sees Avalanche Team1 by default', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Shop Pay', description: 'Payments for small shops', chains: [{ chain: 'avalanche', mainnet: true }] } });
  assert.ok(ids(r.reply!.gaps).includes('avalanche-team1-mini-grants'), r.reply!.show_to_builder as string);
  const plain = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Shop Pay', description: 'Payments for small shops' } });
  assert.ok(!ids(plain.reply!.gaps).includes('avalanche-team1-mini-grants'), plain.reply!.show_to_builder as string);
});

test('L12-7 (v6.1.14), Review Focus 9: a Solana project with no repo sees Solana Foundation Grants as its step and never a Base deploy by default', async () => {
  const SOL = { name: 'Solflare Tips', description: 'Tipping for creators on Solana', chains: [{ chain: 'solana', mainnet: true }] };
  const r = await mcpCall(ctx(await installation()), 'find', { project: SOL });
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.equal(
    show,
    [
      "One step away (1):",
      "1. Solana Foundation Grants, milestone grants, amount not stated: code in a repo. Their rule: a public good, meaning a significant open source contribution to the Solana ecosystem or a free community offering.",
      "In person (2):",
      "2. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.",
      "3. Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      // L18-1 (v6.1.18): the rows the rank cap left out are counted.
      'And 10 more in the full list.',
      "Nothing is ready yet. Tell me when the code is in a repo and I look again.",
    ].join('\n'),
  );
  assert.doesNotMatch(show, /deploy the contract on|—|\b(coin|points|score|rank|grade|streak|token)s?\b/i);
  // The full list keeps the other chains' deploys, and the own chain's programs with their real gaps.
  const all = await mcpCall(ctx(await installation()), 'find', { project: SOL, filter: { all: true } });
  const shown = listText(all.reply!);
  for (const id of ['solana-foundation-grants', 'solana-incubator-cohort-6', 'base-ecosystem-fund', 'monad-blitz-guangzhou']) assert.ok(ids(all.reply!.gaps).includes(id), id);
  assert.match(shown, /\d+\. Base Ecosystem Fund, pre-seed and seed investment, amount not stated: deploy the contract on Base\. /);
  assert.match(shown, /\d+\. Solana Incubator Cohort 6, NYC incubator with relocation stipend, amount not stated: code in a repo\. /);
  // The own chain's grant carries code in a repo as its real gap.
  const gaps = (all.reply!.gaps as { program_id: string; gap: { what: string } }[]).find((g) => g.program_id === 'solana-foundation-grants')!;
  assert.equal(gaps.gap.what, 'code in a repo');
});

test('fix round 1 (v6.1.14, T7-F1, T7-F2): an owner-only link meets no bar; gap_done on the code step of Solana Foundation Grants is noted', async () => {
  const SOL = { name: 'Solflare Tips', description: 'Tipping for creators on Solana', chains: [{ chain: 'solana', mainnet: true }] };
  const c = ctx(await installation());
  const bare = (await mcpCall(c, 'find', { project: SOL })).reply!.show_to_builder as string;
  // T7-F1: the owner's page is neither repo nor live link, so the reply is the one with no link (no building bar met).
  for (const link of ['https://github.com/lane12', 'https://github.com/orgs/acme']) {
    const owner = await mcpCall(ctx(await installation()), 'find', { project: { ...SOL, repo_url: link } });
    assert.equal(owner.reply!.show_to_builder, bare, link);
    assert.match(owner.text, /repo_url names no repo; kept as a plain link, not read/);
  }
  // T7-F2: the code step shown is the step gap_done takes, for a program that does not require a repo too.
  const done = await mcpCall(c, 'track', { program_id: 'solana-foundation-grants', status: 'gap_done', item: 'repo', project: SOL });
  assert.equal(done.isError, false, done.text);
  assert.equal(done.reply!.show_to_builder, 'Tracked. Tell me when it is live and I look again.');
  // The read settles it: with no repo yet the step still shows.
  const again = await mcpCall(c, 'find', { project: SOL });
  assert.match(again.reply!.show_to_builder as string, /Solana Foundation Grants, milestone grants, amount not stated: code in a repo\./);
});

test('L12-7 (v6.1.14): a keyword hit whose only change is code in a repo shows on a chain as it does with none; a student on a chain still sees Thiel', async () => {
  const HOOK = { name: 'Hookswap', description: 'A Uniswap limit order tool' };
  const onEth = await mcpCall(ctx(await installation()), 'find', { project: { ...HOOK, chains: [{ chain: 'ethereum', mainnet: true }] } });
  const eth = onEth.reply!.show_to_builder as string;
  assert.equal(
    eth.split('\n\n')[0],
    [
      "One step away (3):",
      "1. Ethereum Security Subsidy Program, up to 30% of audit cost: code in a repo. First: set aside a security budget to co-fund the audit. Their rule: smart contracts for Ethereum mainnet with a defined audit scope (lines of code and contract count).",
      // L1i-2 (v6.1.16.1): every step row the budget allows.
      "2. Uniswap Foundation Open Grants, amount not stated, set by milestone budget: code in a repo. Their rule: work that contributes to the Uniswap ecosystem and benefits people beyond your own product.",
      "3. Uniswap Foundation Security Fund (UFSF) Audit Subsidies, up to 100% of the audit cost: code in a repo. First: register a legal entity for KYB; finalize the contracts for audit. Their rule: smart contracts in the Uniswap ecosystem (a v4 hook or a Uniswap integration) with a date they will be ready for audit.",
      "In person (2):",
      "4. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.",
      "5. Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      // L18-1 (v6.1.18): the rows the rank cap left out are counted.
      'And 9 more in the full list.',
      "Nothing is ready yet. Tell me when the code is in a repo and I look again.",
    ].join('\n'),
  );
  assert.ok(eth.endsWith('Nothing is ready yet. Tell me when the code is in a repo and I look again.'), eth);
  const plain = await mcpCall(ctx(await installation()), 'find', { project: HOOK });
  assert.ok(ids(plain.reply!.gaps).includes('uniswap-foundation-open-grants'));
  // A student on Base or Solana still sees Thiel by default.
  for (const chains of [[{ chain: 'base', mainnet: true }], ['solana']]) {
    const r = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Campus Pay', description: 'A college student app for splitting bills', chains } });
    assert.ok(ids(r.reply!.gaps).includes('thiel-fellowship'), r.reply!.show_to_builder as string);
    assert.match(r.reply!.show_to_builder as string, /\d\. Thiel Fellowship, \$250,000 over two years\. Their rule: applicant aged 22 or younger/);
  }
  // A program on another chain or no keyword hit keeps its bar: Z Fellows (no rule) is still no fit on a chain with no code.
  assert.ok(!ids(onEth.reply!.gaps).includes('z-fellows'));
});

test('L1d-1 (v6.1.11, Review Focus 1): a claim on one project never pins or leads another project of the builder', async () => {
  // L28-3 (v6.1.16 Task 14): a claim with a repo needs the repo's own builder: signed in as its owner.
  const { linkInstallation, upsertBuilder } = await import('../v6/builders');
  const u = await dashCtx();
  const owner = await upsertBuilder({ github_id: 951_595, login: dash.repo.split('/')[0], name: 'Owner', avatar_url: null }, NOW);
  await linkInstallation(u.installationId, owner.id, NOW);
  const c = { ...u, builderId: owner.id as number | null };
  await mcpCall(c, 'find', { project: VR });
  // L29-8 (v6.1.16 Task 15): the rule first; once confirmed, the claim lands on this project.
  const refused = await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'started', project: VR });
  assert.equal(refused.isError, true, refused.text);
  const { eligibilityOf } = await import('./program-file');
  const { itemKey } = await import('./eligibility');
  for (const x of eligibilityOf((await getProgram('meta-vr-start-competition-2026'))!.file).filter((y) => y.kind === 'rule'))
    await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'gap_done', item: itemKey(x), project: VR });
  const started = await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'started', project: VR });
  assert.equal(started.isError, false, started.text);
  const [row] = await sql()`SELECT project_id FROM applications WHERE program_id = 'meta-vr-start-competition-2026' AND installation_id = ${c.installationId}`;
  assert.equal(row.project_id, `https://github.com/${dash.repo}`.toLowerCase());
  // Another project of the same builder: the VR claim does not pin, so the idea opens as it always does.
  const IDEA = { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' };
  const other = await mcpCall(c, 'find', { project: IDEA });
  const show = other.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /Meta VR/);
  // L29-26 (v6.1.16 Task 15): Task 9's since line sits after the money lines.
  // L28-3 (v6.1.16 Task 14): signed in now, so the record's before-applying line shows too.
  assert.equal(show.split('\n').filter((l) => !l.startsWith('Since ') && !l.startsWith('Before applying:')).join('\n'), IDEA_REPLY(), show);
  // The claimed project itself still has it pinned.
  const own = await mcpCall(c, 'find', { project: VR });
  assert.equal(ids(own.reply!.gaps)[0], 'meta-vr-start-competition-2026');
});

test('L1d-1 (v6.1.11), C1 (v6.1.13), ruling 12 (v6.1.16): another agent\'s claim on another project says so on its line without that project\'s name, by default and in filter.all, and leaves the yes count', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const { claim } = await import('../v6/claims');
  const [other] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'find-other-' + Math.random()}, 'Cursor') RETURNING id`;
  const { linkInstallation } = await import('../v6/builders');
  await linkInstallation(other.id as number, builderId, NOW);
  const before = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  await claim(`b:${builderId}`, 'y-combinator', 'name:another project', other.id as number, new Date(NOW.getTime() - H));
  // L13-8, L12-1 (v6.1.14): a claim with no project holds the program on every project's list (here in person).
  await claim(`b:${builderId}`, 'alliance-all19', null, other.id as number, new Date(NOW.getTime() - H));
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  const ready = allReady(r.reply!) as { program_id: string; claimed_since?: string; title: string }[];
  assert.ok(ids(ready).includes('y-combinator'));
  assert.equal(ready.find((p) => p.program_id === 'y-combinator')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
  assert.equal(ready.find((p) => p.program_id === 'alliance-all19')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
  // L29-26 (v6.1.16 Task 15): something is ready, so the in-person lines are the agent's (Not shown).
  const both = seen(r.reply!);
  const line = both.split('\n').find((l) => /^\d+\. Y Combinator/.test(l))!;
  assert.match(line, / Being handled by your other agent\.$/);
  assert.doesNotMatch(both, /another project/);
  assert.match(both.split('\n').find((l) => /^\d+\. Alliance ALL19/.test(l))!, / Being handled by your other agent\.$/);
  assert.equal(both.split('\n').filter((l) => l.includes('Being handled')).length, 2);
  // It is no yes: the same list less one to say yes to; it neither pins nor leads the list (L17-6, v6.1.16: a held
  // remote one moves after the ones this agent can send, so the lists are compared as sets).
  assert.deepEqual(ids(ready).sort(), ids(allReady(before.reply!)).sort());
  assert.match(r.reply!.agent_note as string, /claimed_since is claimed by another of the builder's agents: do not submit it\./);
  const all = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  const allShow = listText(all.reply!);
  assert.match(allShow.split('\n').find((l) => l.includes('Y Combinator'))!, / Being handled by your other agent\.$/);
  const everyReady = allReady(all.reply!) as { program_id: string; claimed_since?: string }[];
  assert.equal(everyReady.find((p) => p.program_id === 'y-combinator')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
});

test('L1f-3 (v6.1.14, persona 12): an archived repo is never asked the users question; its line reads the archive as a gap', async () => {
  const rec = replayFetch('archived-dashboard');
  const ATOM = { name: 'Atom', description: 'The hackable text editor', repo_url: `https://github.com/${rec.repo}` };
  const c = { installationId: await installation(), builderId: null, now: NOW, gh: rec.fetch };
  const r = await mcpCall(c, 'find', { project: ATOM });
  const show = r.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /real people use it/);
  assert.equal(show, [
    'One step away (1):',
    '1. FLOSS/fund, $10,000 to $100,000: the repo is archived. First: publish a funding manifest on your site or repo.',
    ...inPersonBlock(2),
    // L1g-5 (v6.1.16): the line reads the archive, so the archived note is left out.
    // L18-1 (v6.1.18): the rows the rank cap left out are counted.
    'And 22 more in the full list.',
    'Nothing is ready yet. Tell me the live repo and I look again.',
  ].join('\n'));
  assert.doesNotMatch(show, /This repo is archived/);
  assert.equal(show.match(/ell me the live repo/g)!.length, 1);
  assert.ok((r.reply!.agent_note as string).split('\n').includes(REPO_STEP_NOTE));
  const one = await mcpCall(c, 'find', { program_id: 'herodevs', project: ATOM });
  assert.equal(one.reply!.show_to_builder, [
    // FR-1 (final fix): the telling step is the action, so the line leaves it out.
    'HeroDevs Open Source Sustainability Fund, $2,500 to $15,000: the repo is archived. Their rule: a developer tool whose versions are near or past official end of life.',
    'Tell me the live repo and I look again.',
  ].join('\n'));
  assert.equal((one.reply!.show_to_builder as string).match(/ell me the live repo/g)!.length, 1);
});

test('B20c (v6.1.9, Review Focus 1): a repo-less idea and an empty repo are never asked the users question, and a yes never makes FLOSS/fund ready', async () => {
  const IDEA = { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' };
  const emptyRec = replayFetch('empty-repo');
  const EMPTY = { name: 'LibreDesktop project list', description: 'A list of LibreDesktop projects', repo_url: `https://github.com/${emptyRec.repo}` };
  const ideaCtx = async () => ({ installationId: await installation(), builderId: null, now: NOW });
  const emptyCtx = async () => ({ installationId: await installation(), builderId: null, now: NOW, gh: emptyRec.fetch });
  const idea = await mcpCall(await ideaCtx(), 'find', { project: IDEA });
  // L1e-2 (v6.1.13, persona 8): no Thiel (no student word); fix round 1 (T3-R1): FUTO one real step away, code in a repo.
  assert.equal(idea.reply!.show_to_builder, IDEA_REPLY());
  const empty = await mcpCall(await emptyCtx(), 'find', { project: EMPTY });
  assert.equal(empty.reply!.show_to_builder, IDEA_REPLY(['The repo is empty, so I matched on what you told me.'], 17, true));
  for (const [mk, project] of [[ideaCtx, IDEA], [emptyCtx, EMPTY]] as const) {
    // Even after the builder says yes (users: true, or gap_done users): not a fit, never ready, never a step.
    const c = await mk();
    await mcpCall(c, 'track', { program_id: 'floss-fund-zerodha', status: 'gap_done', item: 'users' });
    const yes = await mcpCall(c, 'find', { project: { ...project, users: true }, filter: { all: true } });
    assert.ok(!ids(allReady(yes.reply!)).includes('floss-fund-zerodha') && !ids(yes.reply!.gaps).includes('floss-fund-zerodha'), listText(yes.reply!));
    assert.equal((yes.reply!.not_fit as { program_id: string; reason: string }[]).find((n) => n.program_id === 'floss-fund-zerodha')?.reason, 'needs code in a repo or a live link');
    const one = await mcpCall(c, 'find', { program_id: 'floss-fund-zerodha', project: { ...project, users: true } });
    assert.equal(one.reply!.show_to_builder, 'FLOSS/fund, $10,000 to $100,000. Not a fit: needs code in a repo or a live link.');
    assert.doesNotMatch(listText(yes.reply!), /real people use it/);
  }
});

test('L1d-2 (v6.1.11, Review Focus 2 and 3): an idea or an empty repo naming no crypto word never opens with the Solana sprint; a crypto idea sees it with its account and sprint', async () => {
  const ideaCtx = async () => ({ installationId: await installation(), builderId: null, now: NOW });
  const emptyRec = replayFetch('empty-repo');
  const plain = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' } });
  const empty = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: emptyRec.fetch }, 'find', { project: { name: 'LibreDesktop project list', description: 'A list of LibreDesktop projects', repo_url: `https://github.com/${emptyRec.repo}` } });
  for (const r of [plain, empty]) {
    assert.doesNotMatch(r.reply!.show_to_builder as string, /Colosseum/);
    assert.ok(!ids(r.reply!.gaps).includes('colosseum-eternal'), r.reply!.show_to_builder as string);
  }
  // Under filter.all it is still listed, its line naming the account and the sprint.
  const all = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' }, filter: { all: true } });
  const g = (all.reply!.gaps as G[]).find((x) => x.program_id === 'colosseum-eternal')!;
  assert.ok(g, listText(all.reply!));
  assert.equal(lineOf(listText(all.reply!), g.n), COLOSSEUM_LINE(g.n));
  // An idea that says crypto sees it in the default list, never as "a demo video" alone.
  const crypto = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: a crypto app that splits rent between roommates onchain' } });
  const show = crypto.reply!.show_to_builder as string;
  const c = (crypto.reply!.gaps as G[]).find((x) => x.program_id === 'colosseum-eternal');
  assert.ok(c, show);
  assert.equal(lineOf(seen(crypto.reply!), c.n), COLOSSEUM_LINE(c.n));
  assert.doesNotMatch(show, /a demo video\. Their rule: the team has not raised/);
  // Fix round 1 (v6.1.16): with bare "crypto" gone, a crypto app, a DeFi and an NFT idea still hit with no "onchain" in the text.
  for (const description of ['An idea: a crypto app that splits rent between roommates', 'An idea: a DeFi lending pool for students', 'An idea: an NFT ticket for concerts']) {
    const r = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description } });
    const x = (r.reply!.gaps as G[]).find((y) => y.program_id === 'colosseum-eternal');
    assert.ok(x, `${description}: ${r.reply!.show_to_builder as string}`);
    assert.equal(lineOf(seen(r.reply!), x.n), COLOSSEUM_LINE(x.n));
  }
});

test('L1c-2 (v6.1.10, Review Focus 3): an idea that names no VR word never opens with the VR competition; one whose description says "Meta Quest" does', async () => {
  const ideaCtx = async () => ({ installationId: await installation(), builderId: null, now: NOW });
  const plain = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' } });
  assert.doesNotMatch(plain.reply!.show_to_builder as string, /Meta VR/);
  assert.match(plain.reply!.agent_note as string, /^The full list holds \d+ more; show it when the builder asks for all, more or the full list\. Call find with filter\.all for it\.$/m);
  // L1g-1 (v6.1.16): a multi-word keyword matches only whole: "Meta Quest" names it, a bare "Quest" does not.
  const bare = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: a Quest app that splits rent and bills between roommates' } });
  assert.doesNotMatch(bare.reply!.show_to_builder as string, /Meta VR/);
  const quest = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: a Meta Quest app that splits rent and bills between roommates' } });
  assert.equal(quest.reply!.show_to_builder, [...META_VR_ONLY, ...inPersonBlock(2, true), 'And 19 more in the full list.', RULE_FIRST].join('\n'));
  // The full list still has it for the plain idea, as a step.
  const all = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' }, filter: { all: true } });
  assert.ok(ids(all.reply!.gaps).includes('meta-vr-start-competition-2026'), JSON.stringify(ids(all.reply!.gaps)));
});

test('N1 (v6.1.12, Review Focus 1): a Quest project with one other step sees Meta VR in its default list, in rank order', async () => {
  const QUEST = { name: 'HandsOn', description: 'A hand tracking game for Meta Quest', repo_url: `https://github.com/${dash.repo}` };
  const r = await mcpCall(await dashCtx(), 'find', { project: QUEST });
  assert.equal(r.isError, false, r.text);
  // Lane 10 saw FLOSS/fund alone; the keyword hit now takes its own slot, ahead by its money, and the rule with no hit
  // (HeroDevs' licence rule beside a users question) keeps the one last slot.
  assert.equal(
    r.reply!.show_to_builder,
    [
      "One step away (3):",
      // L1i-2 (v6.1.16.1): every step row the budget allows.
      "1. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.",
      "2. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.",
      "3. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000: tell me if real people use it. Their rule: a developer tool whose versions are near or past official end of life.",
      "In person (2):",
      "4. Y Combinator Winter 2027 Batch, $500,000 investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and batch preference.",
      "5. Alliance ALL19, $400,000 at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      // L18-1 (v6.1.18): the rows the rank cap left out are counted.
      'And 20 more in the full list.',
      "Nothing is ready yet. Do real people use it? Say yes, sign in once, and I check.",
    ].join('\n'),
  );
  // An Atlassian Forge app sees Codegeist the same way.
  const forge = await mcpCall(await dashCtx(), 'find', { project: { ...QUEST, name: 'Sprinter', description: 'An Atlassian Forge app for Jira sprint reports' } });
  assert.match(seen(forge.reply!), /^\d+\. Codegeist/m);
});

test('O1 (v6.1.10, Review Focus 2): a program closing in two days that the project fits is always in the default reply, its line saying so', async () => {
  const PAY = { ...VR, description: 'Stream VR games from your PC to your headset over Wi-Fi; pay per game with PayPal' };
  const at = async (now: Date) => mcpCall({ installationId: await installation(), builderId: null, now, gh: dash.fetch }, 'find', { project: PAY });
  // N1 (v6.1.12): eight days out both keyword hits (VR and PayPal) take their own slots in rank order, and a rule
  // with no keywords (HeroDevs; L1e-2, v6.1.13: Thiel names students, so not here) keeps the one last slot. L1e-6: the
  // PayPal line says it closes in 8 days; one yes per reply, the ready program's.
  const early = (await at(NOW)).reply!;
  assert.equal(
    blockOf(early.show_to_builder as string, 'One step away'),
    [
      "One step away (3):",
      "2. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.",
      // L1i-2 (v6.1.16.1): every step row the budget allows.
      "3. PayPal AI Hackathon: Build What's Next with PayPal and AI, $67,500 in prizes, closes in 8 days: a demo video. First: join the hackathon with a Devpost account; sign up for a PayPal Developer account (sandbox). Their rule: meaningfully uses a PayPal API, SDK or developer capability together with an AI model, tool or platform.",
      "4. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000. Their rule: a developer tool whose versions are near or past official end of life.",
    ].join('\n'),
  );
  // Two days out it is listed first, ahead of the cap; a keyword hit, it leaves the one rule slot to HeroDevs (N1, v6.1.12).
  const late = (await at(new Date('2026-11-10T08:00:00Z'))).reply!;
  assert.equal(
    blockOf(late.show_to_builder as string, 'One step away'),
    [
      "One step away (3):",
      "2. PayPal AI Hackathon: Build What's Next with PayPal and AI, $67,500 in prizes, closes in 2 days: a demo video. First: join the hackathon with a Devpost account; sign up for a PayPal Developer account (sandbox). Their rule: meaningfully uses a PayPal API, SDK or developer capability together with an AI model, tool or platform.",
      "3. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 8 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.",
      "4. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000. Their rule: a developer tool whose versions are near or past official end of life.",
    ].join('\n'),
  );
  assert.equal((late.gaps as { program_id: string; closes_in?: string }[])[0].closes_in, 'in 2 days');
});

test('fix round 1 (v6.1.8): a repo link that answers 404 is matched on the report and said once', async () => {
  const f = replayFetch('nextjs-dashboard');
  const gone = ((u: RequestInfo | URL) => (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(String(u)) ? Promise.resolve(new Response('Not Found', { status: 404 })) : f.fetch(u))) as typeof fetch;
  const r = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: gone }, 'find', { project: SAAS });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
  assert.deepEqual(r.reply!.repo_notes, ['unread']);
  const show = r.reply!.show_to_builder as string;
  assert.equal(show.split('I could not read the repo; matched on what you told me.').length, 2, show);
  assert.doesNotMatch(show, /Private repo|paused/);
  assert.match(r.reply!.agent_note as string, /No public repo was read/);
});

test('C59 (v6.1.8): a fork, an archived repo and an empty repo each get their one sentence; archived is not live; empty promises no repo proof', async () => withEnv(OAUTH_ENV, async () => withLiveBar(async () => {
  const run = async (slug: string, over: Record<string, unknown> = {}) => {
    const f = replayFetch(slug);
    const r = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: f.fetch, linkUrl: async () => 'https://earnkit.com/link/abc' }, 'find', {
      project: { name: slug, description: 'An admin dashboard.', repo_url: `https://github.com/${f.repo}`, chains: [{ chain: 'base', mainnet: true }], ...over }, filter: { all: true },
    });
    assert.equal(r.isError, false, r.text);
    return r.reply!;
  };
  const once = (show: string, s: string) => assert.equal(show.split(s).length, 2, show);
  const fork = await run('fork-dashboard');
  once(fork.show_to_builder as string, 'This repo is a fork; programs judge the original.');
  assert.ok(ids(fork.ready).includes('f-live'));
  const archived = await run('archived-dashboard');
  // L1g-5 (v6.1.16): a shown line reads the archive ("the repo is archived"), so the note is left out; the archive is said once.
  assert.doesNotMatch(archived.show_to_builder as string, /This repo is archived; programs want active work\./);
  assert.match(listText(archived), /: the repo is archived\./);
  // Its homepage is not a live link: the live bar is a gap.
  assert.ok(ids(archived.gaps).includes('f-live'), JSON.stringify(ids(archived.gaps)));
  const empty = await run('empty-repo');
  // An empty repo holds no proof of code (final review M6): with no live link, a program with a bar is not a fit.
  assert.ok((empty.not_fit as { program_id: string }[]).some((n) => n.program_id === 'f-live'), JSON.stringify(ids(empty.gaps)));
  const show = empty.show_to_builder as string;
  once(show, 'The repo is empty, so I matched on what you told me.');
  assert.doesNotMatch(show, /I read your repo/);
  // L29-33 (v6.1.16 Task 15): the note, then the sign-in, then the Say.
  const lines = show.split('\n');
  assert.deepEqual(lines.slice(-3, -1), ['The repo is empty, so I matched on what you told me.', 'Sign in once at https://earnkit.com/link/abc and I remember you across agents.']);
  // F9 (v6.1.12): Builder Codes reported on the empty repo: the two notes are one sentence.
  const codes = await run('empty-repo', { builder_codes: true });
  assert.deepEqual(codes.repo_notes, ['empty', 'no_builder_codes']);
  const codesShow = codes.show_to_builder as string;
  assert.equal(codesShow.split('\n').at(-3), 'The repo is empty and does not send Builder Codes yet, so I matched on what you told me.');
  assert.doesNotMatch(codesShow, /The repo does not send Builder Codes yet\./);
  const plain = await run('nextjs-dashboard');
  assert.doesNotMatch(plain.show_to_builder as string, /fork|archived|empty|told me/);
  assert.equal(plain.repo_notes, undefined);
})));

test('C58 (v6.1.8): a name and a repo with no description is matched on the README, and the agent is told', async () => {
  const r = await mcpCall(await dashCtx(), 'find', { project: { name: 'linux', repo_url: `https://github.com/${dash.repo}` } });
  assert.equal(r.isError, false, r.text);
  assert.doesNotMatch(r.reply!.show_to_builder as string, /^Open now|Tell me which project/m);
  assert.ok((r.reply!.gaps as unknown[]).length > 0);
  assert.ok((r.reply!.agent_note as string).split('\n').includes("No description was passed, so the README's first sentence stood in for it; pass one next time if it reads wrong."));
  // With no repo link, the description is still needed.
  const none = await mcpCall(await dashCtx(), 'find', { project: { name: 'linux' } });
  assert.match(none.reply!.show_to_builder as string, /^Open now/);
});

test('C55, B21 (v6.1.8, Review Focus 3): a Solana project that reports mainnet and its program id is never told to deploy on Solana', async () => {
  const saber = replayFetch('saber-distributor');
  const devnet = ((u: RequestInfo | URL) =>
    String(u).endsWith('/Anchor.toml') ? Promise.resolve(new Response('[programs.devnet]\nx = "y"\n[provider]\ncluster = "devnet"')) : saber.fetch(u)) as typeof fetch;
  const orca = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
  const project = { name: 'Orca Whirlpools', description: 'Concentrated liquidity DEX on Solana', repo_url: `https://github.com/${saber.repo}`, live_url: 'https://www.orca.so', users: true, chains: [{ chain: 'solana', mainnet: true, contract: orca }] };
  const r = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: devnet }, 'find', { project, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, false);
  assert.equal(r.reply!.problems, undefined);
  const show = listText(r.reply!);
  assert.doesNotMatch(show, /deploy the contract on Solana/);
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'solana-foundation-grants');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.deepEqual([g.gap.kind, g.also], ['rule', []]);
});

test('project A (R18a): Base Ecosystem Fund is one answer away; gap_done with its rule item makes it ready, no rule sentence (v6.1.6)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: PROJECT_A, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const show = listText(r.reply!);
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'base-ecosystem-fund');
  assert.ok(g, show);
  assert.deepEqual([g.gap.kind, g.gap.what, g.also], ['rule', BASE_RULE, []]);
  assert.match(g.gap.item, /^rule:[0-9a-f]{8}$/);
  const line = lineOf(show, g.n);
  // L1e-2 (v6.1.13): a ready program takes the closing's yes, so the rule reads as a plain sentence.
  assert.equal(line, `${g.n}. Base Ecosystem Fund, pre-seed and seed investment, amount not stated. Their rule: ${BASE_RULE}.`);
  assert.ok((r.reply!.agent_note as string).split('\n').includes('A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again. Draft it and show the builder; submit only on a yes to the draft.'));
  const t = await mcpCall(ctx(id), 'track', { program_id: 'base-ecosystem-fund', status: 'gap_done', item: g.gap.item });
  assert.equal(t.isError, false, t.text);
  assert.deepEqual([t.reply!.show_to_builder, t.reply!.agent_note], ['Tracked. That rule counts as confirmed.', 'Call find again; the program comes back ready.']);
  const again = await mcpCall(ctx(id), 'find', { project: PROJECT_A, filter: { all: true } });
  const show2 = listText(again.reply!);
  const p = (allReady(again.reply!) as { program_id: string; n: number }[]).find((x) => x.program_id === 'base-ecosystem-fund');
  assert.ok(p, show2);
  const readyLine = lineOf(show2, p.n);
  assert.match(readyLine, /Base Ecosystem Fund/);
  assert.doesNotMatch(readyLine, /Their rule/);
});

test('project A with filter.all: a demo-video gap and a rule share one gap line; every rule gap is in its line (v6.1.6)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_A, filter: { all: true } });
  const show = listText(r.reply!);
  const gaps = r.reply!.gaps as G[];
  const mixed = gaps.find((x) => x.gap.kind === 'demo_video' && x.also.some((a) => a.kind === 'rule'));
  assert.ok(mixed, show);
  const rule = mixed.also.find((a) => a.kind === 'rule')!.what;
  // L1d-2 (v6.1.11): its setup steps, when it has any, sit between the gap and the rules.
  const first = mixed.setup.length > 0 ? ` First: ${mixed.setup.join('; ')}.` : '';
  // L1e-6 (v6.1.13): one rule sentence per line, several joined: "Their rules: a; b.".
  const rulesOf = (x: G) => [x.gap, ...x.also].filter((a) => a.kind === 'rule').map((a) => a.what);
  const sentence = (rs: string[]) => (rs.length === 1 ? ` Their rule: ${rs[0]}.` : ` Their rules: ${rs.join('; ')}.`);
  assert.ok(lineOf(show, mixed.n).includes(`: a demo video.${first} Their rule`), lineOf(show, mixed.n));
  assert.ok(lineOf(show, mixed.n).includes(rule), lineOf(show, mixed.n));
  for (const x of gaps) if (rulesOf(x).length > 0) assert.ok(lineOf(show, x.n).includes(sentence(rulesOf(x))), lineOf(show, x.n));
  assert.ok(show.split('\n').every((l) => (l.match(/Their rules?:/g)?.length ?? 0) <= 1), show);
});

test('find with program_id: each rule on its own line after the money, then the rules list; no Apply at (v6.1.6, v6.1.8)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'base-ecosystem-fund' });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(r.reply!.rules, ['a pre-seed or seed stage startup that chooses Base as its home']);
  const lines = (r.reply!.show_to_builder as string).split('\n');
  assert.match(lines[0], /^Base Ecosystem Fund, /);
  assert.equal(lines[1], 'Their rule: a pre-seed or seed stage startup that chooses Base as its home.');
  assert.equal(lines[2], 'Rules:');
  assert.doesNotMatch(r.reply!.show_to_builder as string, /Apply at|https?:/);
});

test('R18c: a rule-only program above the project tier shows the tier gap first, never "yes n" (v6.1.6)', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-rule-used', title: 'Rule Grant', min_tier: 'used', eligibility: [{ kind: 'rule', note: 'a team of two or more' }] }), 'file', NOW);
  try {
    const { live_url: _, ...noLink } = PROJECT;
    const r = await mcpCall(ctx(await installation()), 'find', { project: noLink, filter: { all: true } });
    assert.equal(r.isError, false, r.text);
    const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'f-rule-used');
    assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
    assert.deepEqual([g.gap.kind, g.also.map((a) => a.kind)], ['tier', ['rule']]);
    const line = lineOf(listText(r.reply!), g.n);
    assert.equal(line, `${g.n}. Rule Grant, up to $5,000: proof that real people use it. Their rule: a team of two or more.`);
    assert.doesNotMatch(line, /Say "yes/);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-rule-used'`;
  }
});

test('R18d: under filter.all, Antler (in person, rule only) says its rule and what attending takes; never in the default slot', async () => {
  const id = await installation();
  const d = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.ok(!ids(d.reply!.gaps).includes('antler-us-residency'));
  // L1i-6 (v6.1.16.1): the whole full list now passes its cap (its lowest rows lose their details), so the investment
  // list, under the cap, carries Antler's whole line.
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true, category: 'investment' } });
  assert.doesNotMatch(r.reply!.agent_note as string, /More programs than fit/);
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'antler-us-residency');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(
    lineOf(listText(r.reply!), g.n),
    `${g.n}. Antler US Residency, $500,000 to $1,000,000 investment. Their rule: at least one co-founder already has independent US work authorization; no visa sponsorship. First: work in person at Antler's NYC, SF or Austin office for up to 3 months.`,
  );
});

test('the first find after a link says which GitHub account it is linked to; the second does not', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const login = (await sql()`SELECT login FROM builders WHERE id = ${builderId}`)[0].login as string;
  const notice = `This agent is now linked to GitHub account ${login}. Unlink any time at earnkit.com/me.`;
  const first = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  assert.equal(first.isError, false, first.text);
  assert.equal(first.reply!.linked_notice, notice);
  const show = first.reply!.show_to_builder as string;
  assert.ok(show.includes(`\n${notice}`), show);
  assert.ok(show.split('\n').at(-1)!.startsWith('Say '), show);
  const second = await mcpCall({ ...ctx(id, new Date(NOW.getTime() + H)), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  assert.equal(second.reply!.linked_notice, null);
  assert.ok(!(second.reply!.show_to_builder as string).includes('now linked'));
  // An unlinked find never carries it.
  const plain = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  assert.equal(plain.reply!.linked_notice, null);
});

test('find { program_id } and the program page never carry reviewers_contact (security M1)', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { guideTextById } = await import('./guide-page');
  const id = await installation();
  await upsertProgram(programFixture({ id: 'f-contact', title: 'Contact Grant', reviewers_contact: 'staff@contact-grant.example' }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f-contact-shut', title: 'Shut Grant', status: 'closed', reviewers_contact: 'staff@contact-grant.example' }), 'file', NOW);
  assert.equal((await getProgram('f-contact'))!.file.reviewers_contact, 'staff@contact-grant.example');
  for (const args of [{ program_id: 'f-contact' }, { program_id: 'f-contact', project: PROJECT }]) {
    const r = await mcpCall(ctx(id), 'find', args);
    assert.equal(r.isError, false, r.text);
    const program = r.reply!.program as Record<string, unknown>;
    assert.equal(program.title, 'Contact Grant');
    assert.equal('reviewers_contact' in program, false);
    assert.ok(!r.text.includes('reviewers_contact') && !r.text.includes('staff@contact-grant.example'));
  }
  const page = await guideTextById('f-contact-shut', NOW);
  assert.ok(page, 'the closed program has a page');
  assert.ok(!JSON.stringify(page).includes('reviewers_contact') && !JSON.stringify(page).includes('staff@contact-grant.example'));
  // Grep: outside tests, only the schema, the API's refusal and find's strip name the field.
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const root = join(import.meta.dirname, '..', '..');
  const naming = ['app', 'lib'].flatMap((dir) =>
    (readdirSync(join(root, dir), { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !f.includes('fixtures'))
      .map((f) => join(root, dir, f))
      .filter((f) => readFileSync(f, 'utf8').includes('reviewers_contact'))
      .map((f) => relative(root, f)),
  );
  assert.deepEqual(naming.sort(), ['lib/v5/api-text.ts', 'lib/v5/find.ts', 'lib/v5/program-file.ts']);
});

test('B10: the first find after an unlink says so with the sign-in link, once; the open list too', async () => {
  const { unlinkInstallation } = await import('../v6/builders');
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const line = `This agent was unlinked from your account. Sign in once at ${link} to link it again.`;
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  assert.equal(await unlinkInstallation(id, builderId, NOW), true);
  const later = new Date(NOW.getTime() + H);
  const first = await mcpCall({ ...ctx(id, later), linkUrl: async () => link }, 'find', { project: PROJECT });
  assert.equal(first.isError, false, first.text);
  assert.equal(first.reply!.linked_notice, line);
  const show = first.reply!.show_to_builder as string;
  // N5b (Task 14 fix round 3): with a repo, one sign-in sentence: the notice keeps its first sentence, the closing the link.
  assert.ok(show.includes('\nThis agent was unlinked from your account.\n'), show);
  assert.equal(show.split(link).length, 2, show);
  assert.equal(show.match(/Sign in once/g)!.length, 1, show);
  const second = await mcpCall({ ...ctx(id, new Date(later.getTime() + H)), linkUrl: async () => link }, 'find', { project: PROJECT });
  assert.equal(second.reply!.linked_notice, null);
  assert.ok(!(second.reply!.show_to_builder as string).includes('unlinked'));

  const other = await linkedWith(OWNER_RECORD);
  await unlinkInstallation(other.id, other.builderId, NOW);
  const list = await mcpCall({ ...ctx(other.id, later), linkUrl: async () => link }, 'find', {});
  const listShow = list.reply!.show_to_builder as string;
  assert.equal(list.reply!.linked_notice, line);
  // Fix round 1 (I3): the ask stays last, the notice before it.
  assert.ok(listShow.endsWith(`\n${line}\nTell me which project and I match it.`), listShow);
  assert.equal(listShow.split(link).length, 2, listShow);
  // No sign-in configured: the notice alone.
  const third = await linkedWith(OWNER_RECORD);
  await unlinkInstallation(third.id, third.builderId, NOW);
  const bare = await mcpCall({ ...ctx(third.id, later), linkUrl: async () => null }, 'find', { project: PROJECT });
  assert.equal(bare.reply!.linked_notice, 'This agent was unlinked from your account.');
});

test('C12: a name saved with record, then find in the same session: read fresh; name and email are two items', async () => {
  const { id, builderId } = await linkedWith({});
  const c = { ...ctx(id), builderId, evidence: LIVE };
  const s = await mcpCall(c, 'record', { set: { person: { name: 'Ada' } } });
  assert.equal(s.isError, false, s.text);
  const a = await mcpCall({ ...c, now: new Date(NOW.getTime() + 1000) }, 'find', { project: PROJECT });
  // The find read the saved record: the name is no longer missing, the email still is.
  const missingA = a.reply!.record_missing as string[];
  assert.ok(!missingA.includes('your name') && missingA.includes('your email'), JSON.stringify(missingA));
  // F5 (v6.1.12), fix round 1 (M1, L29-17 over F5): the missing email is named once in the reply, by the Say.
  const showA = a.reply!.show_to_builder as string;
  // (Alliance's setup step names the first founder's email, another answer.)
  assert.equal(showA.replace(/first founder's email/g, '').match(/\bemail\b/gi)?.length, 1, showA);
  assert.match(showA, /\nSay yes and tell me [^\n]*your email[^\n]*, and I apply to [^\n]+\.$/);
  assert.doesNotMatch(showA.split('\n').find((l) => l.startsWith('Before applying:')) ?? '', /email/);
  await mcpCall(c, 'record', { set: { person: { email: 'ada@example.com' } } });
  const b = await mcpCall({ ...c, now: new Date(NOW.getTime() + 2000) }, 'find', { project: PROJECT });
  const missingB = b.reply!.record_missing as string[];
  assert.ok(!missingB.includes('your name') && !missingB.includes('your email'), JSON.stringify(missingB));
});

test('fix round 1 (v6.1.8, 1b): unlinked, with signing in the one step left, the one-program action is the sign-in sentence with its link', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-sign', title: 'Sign Grant', min_tier: 'used' }), 'file', NOW);
  try {
    const link = 'https://earnkit.com/link/abc';
    const call = async (program_id: string, project: Record<string, unknown>) =>
      (await mcpCall({ ...ctx(await installation()), linkUrl: async () => link }, 'find', { program_id, project })).reply!;
    const pub = await call('f-sign', { ...PROJECT, users: true });
    // Review Focus 2 (v6.1.14): the sign-in is asked once, in the closing.
    assert.equal(pub.show_to_builder, ['Sign Grant, up to $5,000: proof that real people use it.', `Sign in once at ${link} and I check your users and remember you.`].join('\n'));
    assert.equal((pub.show_to_builder as string).match(/Sign in/g)!.length, 1);
    assert.equal(pub.sign_in, link);
    assert.ok((pub.agent_note as string).split('\n').includes('Show the sign-in link once as the reply gives it; once the builder has signed in, call find with program_id again.'));
    assert.doesNotMatch(pub.agent_note as string, /The builder makes each change/);
    // Nothing read (fix round 1, v6.1.14 F1): the sign-in promises only to remember, asked once.
    const priv = await call('f-sign', { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', private: true, users: true, live_url: 'https://ripgrep.dev', chains: [{ chain: 'base', mainnet: true }] });
    assert.equal((priv.show_to_builder as string).split('\n')[1], `Sign in once at ${link} and I remember you.`);
    // No link can be made (F2): the one-program reply still ends on the sign-in, without a link.
    const noLink = (await mcpCall({ ...ctx(await installation()), linkUrl: async () => { throw new Error('no link'); } }, 'find', { program_id: 'f-sign', project: { ...PROJECT, users: true } })).reply!;
    assert.equal(noLink.show_to_builder, ['Sign Grant, up to $5,000: proof that real people use it.', 'Sign in once and I check your users.'].join('\n'));
    assert.equal(noLink.sign_in, undefined);
    assert.equal(priv.sign_in, link);
    // A gap that is not signing in carries no link.
    const notSign = await call('circle-developer-grants', PROJECT);
    assert.equal((notSign.verdict as { status: string }).status, 'gap');
    assert.equal(notSign.sign_in, undefined);
    assert.doesNotMatch(notSign.show_to_builder as string, /Sign in once at/);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-sign'`;
  }
});

test('fix round 1 (v6.1.8, 1b): the one-program line is the list line without its number, for a ready and a gap program', async () => {
  const list = (await mcpCall(ctx(await installation()), 'find', { project: PROJECT })).reply!;
  const r = (allReady(list) as { program_id: string; n: number; in_person: boolean }[]).find((p) => !p.in_person)!;
  const listLine = lineOf(list.show_to_builder as string, r.n);
  const one = await mcpCall(ctx(await installation()), 'find', { program_id: r.program_id, project: PROJECT });
  assert.equal((one.reply!.show_to_builder as string).split('\n')[0], listLine.replace(/^\d+\. /, ''));
  const d = replayFetch('nextjs-dashboard');
  const onBase = { name: 'Dashboard', description: 'An admin dashboard.', repo_url: `https://github.com/${d.repo}`, live_url: 'https://dash.example.com', users: true, chains: [{ chain: 'base', mainnet: true }] };
  const c = async () => ({ installationId: await installation(), builderId: null, now: NOW, gh: d.fetch });
  const all = (await mcpCall(await c(), 'find', { project: onBase, filter: { all: true } })).reply!;
  const g = (all.gaps as G[]).find((x) => x.program_id === 'base-builder-grants')!;
  // L29-26 (v6.1.16 Task 15): the gap line as the default view writes it (filter.all's builder text is names and money).
  const gapListLine = lineOf(listText(all), g.n);
  const detail = await mcpCall(await c(), 'find', { program_id: 'base-builder-grants', project: onBase });
  assert.equal((detail.reply!.show_to_builder as string).split('\n')[0], gapListLine.replace(/^\d+\. /, '').replace(/ Say "do \d+" and I [^.]+\.$/, ''));
});

test('C51, N5: after the account is deleted, the next find of a linked agent says so, once', async () => {
  const { deleteBuilder } = await import('../v6/builders');
  const line = 'Your record was deleted at earnkit.com/me; this agent is unlinked.';
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  await deleteBuilder(builderId, NOW);
  const later = new Date(NOW.getTime() + H);
  // A sign-in link exists, but the reply that says the record is gone offers none (final review M8).
  const first = await mcpCall({ ...ctx(id, later), linkUrl: async () => 'https://earnkit.com/link/abc' }, 'find', { project: PROJECT });
  assert.equal(first.reply!.linked_notice, line);
  assert.equal(first.reply!.sign_in, undefined);
  assert.ok((first.reply!.show_to_builder as string).includes(`\n${line}`), first.reply!.show_to_builder as string);
  const second = await mcpCall({ ...ctx(id, new Date(later.getTime() + H)), linkUrl: async () => null }, 'find', { project: PROJECT });
  assert.equal(second.reply!.linked_notice, null);
  // The open list says it too.
  const other = await linkedWith(OWNER_RECORD);
  await deleteBuilder(other.builderId, NOW);
  const list = await mcpCall({ ...ctx(other.id, later), linkUrl: async () => null }, 'find', {});
  assert.equal(list.reply!.linked_notice, line);
  // Fix round 1 (I3): the ask stays last, the notice before it.
  assert.ok((list.reply!.show_to_builder as string).endsWith(`\n${line}\nTell me which project and I match it.`), list.reply!.show_to_builder as string);
});

test('C47: a find with no project stamps the find, so the linked notice shows once', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const c = { ...ctx(id), builderId, evidence: LIVE };
  const first = await mcpCall(c, 'find', {});
  assert.match(first.reply!.linked_notice as string, /now linked/);
  const second = await mcpCall({ ...c, now: new Date(NOW.getTime() + H) }, 'find', {});
  assert.equal(second.reply!.linked_notice, null);
  const [row] = await sql()`SELECT last_find_at FROM installations WHERE id = ${id}`;
  assert.equal((row.last_find_at as Date).toISOString(), new Date(NOW.getTime() + H).toISOString());
});

test('C41: a project the record does not hold gets no project answers, and the agent is told to pass project_id', async () => {
  const { id, builderId } = await linkedWith({ projects: [{ id: 'other', name: 'Other Thing', answers: { why_you: { text: 'Other why.' } } }] }, ['projects.other.answers.why_you']);
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT });
  assert.equal(r.isError, false, r.text);
  assert.ok((r.reply!.problems as string[]).includes('no record project matched'));
  assert.match(r.reply!.agent_note as string, /pass project_id \(record get lists them\) next time/);
  assert.doesNotMatch(r.reply!.agent_note as string, /dropped: no record project/);
  assert.ok(!JSON.stringify(allReady(r.reply!)).includes('Other why.'));
});

test('C48: when another agent\'s change takes answers back from approval, the next find of this agent says so, once', async () => {
  const { getRecord, saveRecord } = await import('../v6/builders');
  const { mergeRecord } = await import('../v6/record');
  const rec2 = { ...OWNER_RECORD, answers: { why_you: { text: 'We ship.' }, team: { text: 'Two of us.' } } };
  const { id, builderId } = await linkedWith(rec2, ['answers.why_you', 'answers.team', 'projects.earnkit.answers.problem']);
  const c = { ...ctx(id), builderId, evidence: LIVE };
  const first = await mcpCall(c, 'find', { project: PROJECT });
  assert.equal(first.reply!.approvals_again, undefined);
  // Another agent adds short forms: both approvals drop.
  const later = new Date(NOW.getTime() + H);
  await saveRecord(builderId, mergeRecord(await getRecord(builderId), { answers: { why_you: { short: 'Ship.' }, team: { short: 'Two.' } } }, 'agent', later).record, later);
  const next = await mcpCall({ ...c, now: new Date(later.getTime() + H) }, 'find', { project: PROJECT });
  assert.equal(next.reply!.approvals_again, 2);
  assert.ok((next.reply!.show_to_builder as string).includes('\n2 answers wait for your approval again at earnkit.com/me.\n'), next.reply!.show_to_builder as string);
  const third = await mcpCall({ ...c, now: new Date(later.getTime() + 2 * H) }, 'find', { project: PROJECT });
  assert.equal(third.reply!.approvals_again, undefined);
});

test('fix round 1: a linked find with no project reports the overnight sends and answers waiting again; the next project find does not repeat them', async () => {
  const { getRecord, saveRecord } = await import('../v6/builders');
  const { mergeRecord } = await import('../v6/record');
  const { record } = await import('./ledger');
  const rec2 = { ...OWNER_RECORD, answers: { why_you: { text: 'We ship.' } } };
  const { id, builderId } = await linkedWith(rec2, ['answers.why_you']);
  const c = { ...ctx(id), builderId, evidence: LIVE };
  await mcpCall(c, 'find', { project: PROJECT });
  const night = new Date(NOW.getTime() + 8 * H);
  const [p] = (await sql()`SELECT id, file->>'title' AS title FROM programs WHERE id = 'z-fellows'`) as unknown as { id: string; title: string }[];
  const sent = await record(`b:${builderId}`, p.id, 'applied', { installationId: id, now: night, submitted_by: 'agent', autoApplied: true });
  assert.equal(sent.ok, true);
  await saveRecord(builderId, mergeRecord(await getRecord(builderId), { answers: { why_you: { short: 'Ship.' } } }, 'agent', night).record, night);
  const morning = new Date(NOW.getTime() + 20 * H);
  const list = await mcpCall({ ...c, now: morning }, 'find', {});
  const show = list.reply!.show_to_builder as string;
  assert.ok(show.includes(`Applied under your standing approval: ${p.title}.`), show);
  assert.ok(show.includes('One answer waits for your approval again at earnkit.com/me.'), show);
  assert.deepEqual((list.reply!.applied_overnight as { program_id: string }[]).map((x) => x.program_id), ['z-fellows']);
  assert.equal(list.reply!.approvals_again, 1);
  const next = await mcpCall({ ...c, now: new Date(morning.getTime() + H) }, 'find', { project: PROJECT });
  assert.deepEqual(next.reply!.applied_overnight, []);
  assert.doesNotMatch(next.reply!.show_to_builder as string, /Applied under your standing approval|wait for your approval again|waits for your approval again/);
});

test('N-5 (v6.1.9): a step marked done that the read still misses is said once per find after its line; the builder\'s word counts done', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'n5-live', title: 'Live Link Grant', max_award_usd: 4000, eligibility: [{ kind: 'live_product' }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'n5-demo', title: 'Demo Grant', max_award_usd: 4000, eligibility: [{ kind: 'demo_video' }] }), 'file', NOW);
  const c = ctx(await installation());
  const project = { name: 'N5 App', description: 'An app for builders.' };
  const one = async (id: string, p: Record<string, unknown> = project) => (await mcpCall(c, 'find', { program_id: id, project: p })).reply!.show_to_builder as string;
  const LOOKED = 'I looked again and did not find a live link; it stays a step.';
  assert.doesNotMatch(await one('n5-live'), /looked again/);
  const noted = await mcpCall(c, 'track', { program_id: 'n5-live', status: 'gap_done', item: 'live_product' });
  // F6 (v6.1.12): the project has no repo, so there is none to check.
  assert.equal(noted.reply!.show_to_builder, 'Tracked. Tell me when it is live and I look again.');
  assert.equal((await one('n5-live')).split('\n')[0], `Live Link Grant, up to $5,000: put a live link up. ${LOOKED}`);
  // In the full list, after that program's line, once per find, every find while it is missing.
  for (let k = 0; k < 2; k++) {
    const all = listText((await mcpCall(c, 'find', { project, filter: { all: true } })).reply!);
    const line = all.split('\n').find((l) => l.includes('Live Link Grant'))!;
    assert.ok(line.endsWith(`: put a live link up. ${LOOKED}`), line);
    assert.equal(all.split(LOOKED).length, 2);
  }
  // Found: no sentence, and it is ready.
  assert.doesNotMatch(await one('n5-live', { ...project, live_url: 'https://n5.example' }), /looked again/);
  // A demo video is the builder's word: noted, and it counts done.
  const demo = await mcpCall(c, 'track', { program_id: 'n5-demo', status: 'gap_done', item: 'demo_video' });
  assert.deepEqual([demo.reply!.show_to_builder, demo.reply!.agent_note], ['Tracked.', 'Call find again; that step counts as done.']);
  const after = await one('n5-demo');
  assert.doesNotMatch(after, /demo video|looked again/);
});

test('v6.1.9: find with program_id takes the id or the name in any case; L12-3 (v6.1.14): every word must name the program', async () => {
  for (const name of ['yc', 'YC', 'Y Combinator', 'y combinator winter 2027 batch', 'Y-Combinator']) {
    const r = await mcpCall(ctx(await installation()), 'find', { program_id: name });
    assert.equal(r.isError, false, r.text);
    assert.match(r.reply!.show_to_builder as string, /^Y Combinator Winter 2027 Batch, /, name);
    assert.equal((r.reply!.program as { id: string }).id, 'y-combinator', name);
  }
  // L12-3 (v6.1.14): a word naming no program ("labs") is no program, never a guess from the other word.
  const near = await mcpCall(ctx(await installation()), 'find', { program_id: 'Combinator Labs' });
  assert.equal(near.reply!.show_to_builder, 'I do not know a program called "Combinator Labs". Say its full name.');
  for (const [name, id] of [['paypal hackathon', 'paypal-ai-hackathon'], ['thiel fellowship 2027', 'thiel-fellowship'], ['zerodha', 'floss-fund-zerodha']]) {
    const r = await mcpCall(ctx(await installation()), 'find', { program_id: name });
    assert.equal((r.reply!.program as { id: string }).id, id, name);
  }
  for (const name of ['l12-nope', 'base-nope', 'monad-xyz'])
    assert.equal((await mcpCall(ctx(await installation()), 'find', { program_id: name })).reply!.show_to_builder, `I do not know a program called "${name}". Say its full name.`, name);
  // F4 (v6.1.12, Review Focus 3): the common names; one match resolves, several are asked about, three by rank (L1i-8, v6.1.16.1).
  // L1e-1 (v6.1.13, Review Focus 6): an organizer's first word that leads to one program resolves: floss, thiel.
  for (const [name, id] of [['ycombinator', 'y-combinator'], ['Thiel Foundation', 'thiel-fellowship'], ['monad blitz oregon', 'monad-blitz-oregon'], ['floss', 'floss-fund-zerodha'], ['thiel', 'thiel-fellowship']]) {
    const r = await mcpCall(ctx(await installation()), 'find', { program_id: name });
    assert.equal((r.reply!.program as { id: string }).id, id, name);
  }
  for (const [name, line] of [
    ['Base', "Which program do you mean: Base Builder Grant Program, Base Ecosystem Fund or Base Batches 005?"],
    // Lane 20 (v6.1.16): Monad Blitz Oregon is closed, so the open ones lead.
    ['monad', "Which program do you mean: Monad Blitz @广州 (Guangzhou), Monad Nitro or Monad Metropolis Hackathon?"],
    ['Monad Blitz', "Which program do you mean: Monad Blitz @广州 (Guangzhou) or Monad Blitz Oregon?"],
    ['uniswap', "Which program do you mean: Uniswap Foundation Open Grants or Uniswap Foundation Security Fund (UFSF) Audit Subsidies?"],
    // Final fix (v6.1.12, I2): a bracketed parent organizer, two letters: no program.
    ['aws', 'I do not know a program called "aws". Say its full name.'],
    ['fi', 'I do not know a program called "fi". Say its full name.'],
  ]) assert.equal((await mcpCall(ctx(await installation()), 'find', { program_id: name })).reply!.show_to_builder, line, name);
  // Final fix (v6.1.12, I2): a loose name that is one program: the detail's first line names it.
  const kiro = await mcpCall(ctx(await installation()), 'find', { program_id: 'kiro' });
  assert.equal((kiro.reply!.program as { id: string }).id, 'kiroween-2026');
  assert.match(kiro.reply!.show_to_builder as string, /^Kiroween 2026, /);
  const none = await mcpCall(ctx(await installation()), 'find', { program_id: 'qqq-unknown' });
  assert.equal(none.reply!.show_to_builder, 'I do not know a program called "qqq-unknown". Say its full name.');
});

test('v6.1.9: after the builder says yes to the rule, the program comes back ready and the yes stands', async () => {
  const saber = replayFetch('saber-distributor');
  const devnet = ((u: RequestInfo | URL) =>
    String(u).endsWith('/Anchor.toml') ? Promise.resolve(new Response('[programs.devnet]\nx = "y"\n[provider]\ncluster = "devnet"')) : saber.fetch(u)) as typeof fetch;
  const project = { name: 'Orca Whirlpools', description: 'Concentrated liquidity DEX on Solana', repo_url: `https://github.com/${saber.repo}`, live_url: 'https://www.orca.so', users: true, chains: [{ chain: 'solana', mainnet: true, contract: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc' }] };
  const c = { installationId: await installation(), builderId: null, now: NOW, gh: devnet };
  const before = await mcpCall(c, 'find', { program_id: 'solana-foundation-grants', project });
  const rule = (before.reply!.verdict as { gaps: { kind: string; item: string }[] }).gaps.find((g) => g.kind === 'rule')!;
  await mcpCall(c, 'track', { program_id: 'solana-foundation-grants', status: 'gap_done', item: rule.item });
  const after = await mcpCall(c, 'find', { program_id: 'solana-foundation-grants', project });
  // L24-2 (v6.1.16 Task 11): the yes to the rule settled the rule only; the next reply offers apply afresh.
  const lines = (after.reply!.show_to_builder as string).split('\n');
  assert.equal(lines[0], 'Solana Foundation Grants, milestone grants, amount not stated. You give: the requested amount.');
  assert.equal(lines.at(-1), 'Sign in once and I check the repo is yours; then say yes.');
  assert.doesNotMatch(after.reply!.show_to_builder as string, /Your yes stands/);
  // After that apply offer the yes stands (N3, v6.1.12): the closing names the answers still missing.
  const list = await mcpCall(c, 'find', { project });
  const ready = (allReady(list.reply!) as { program_id: string; rule_yes?: true }[]).find((p) => p.program_id === 'solana-foundation-grants');
  assert.equal(ready?.rule_yes, true);
  const show = list.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /Your yes stands/);
  // The others ready (as many as earlier tests left open) are asked for their yes after it.
  // F2 (fix round 1, v6.1.14): a proof gap is listed and this context gives no link, so the linkless sign-in ends it.
  // L29-33 (v6.1.16 Task 15): the sign-in its own line, before the closing.
  // FR-1 (v6.1.16 Task 14 fix round 1): signed out with a repo, the apply offers give way to the sign-in.
  assert.equal(show.split('\n').at(-1), 'Sign in once and I check the repo is yours; then say yes.');
  // N5 (fix round 2): one sign-in line.
  assert.equal(show.match(/Sign in once/g)!.length, 1, show);
});

test('N9 (v6.1.9): the one-program detail tells the agent to pass project_id when the project is not in the record', async () => {
  const { id, builderId } = await linkedWith({ projects: [{ id: 'other', name: 'Other App', repo_url: 'https://github.com/someone/other' }] });
  const r = await mcpCall({ installationId: id, builderId, now: NOW, gh: rec.fetch, evidence: async () => ({ live: [], usage: [] }) as never }, 'find', { program_id: 'base-builder-grants', project: PROJECT });
  assert.equal(r.isError, false, r.text);
  assert.ok((r.reply!.agent_note as string).split('\n').some((l) => l.includes('pass project_id (record get lists them) next time')), r.reply!.agent_note as string);
});

test('S4 (v6.1.9): a code step marked done makes the next find check the repo again, though the cached read is fresh', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 's4-codes', title: 'S4 Codes Grant', eligibility: [{ kind: 'builder_codes' }] as never }), 'file', NOW);
  let calls = 0;
  const spy = ((u: RequestInfo | URL) => {
    calls++;
    return rec.fetch(u);
  }) as typeof fetch;
  const c = (min: number) => ({ installationId: id, builderId: null, now: new Date(NOW.getTime() + min * 60_000), gh: spy });
  const id = await installation();
  await mcpCall(c(0), 'find', { project: PROJECT });
  calls = 0;
  await mcpCall(c(5), 'find', { project: PROJECT });
  assert.equal(calls, 0, 'a fresh read is served from the cache');
  const done = await mcpCall(c(6), 'track', { program_id: 's4-codes', status: 'gap_done', item: 'builder_codes' });
  assert.equal(done.reply!.agent_note, 'Call find again so the repo is re-read.');
  await mcpCall(c(7), 'find', { project: PROJECT });
  assert.ok(calls > 0, 'the step marked done sends the read back to GitHub');
  // F7 (v6.1.12): once; unpushed, the next finds trust the cached read again.
  calls = 0;
  for (const min of [8, 9, 10]) await mcpCall(c(min), 'find', { project: PROJECT });
  assert.equal(calls, 0, 'an unpushed repo is not re-read on every find');
});

test('Review Focus 1 (v6.1.10, L1c-1): two projects of one builder never share a done step', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { ruleItem } = await import('./eligibility');
  const RULE = 'a team of two or more';
  await upsertProgram(programFixture({ id: 'pk-users', title: 'Team Grant', max_award_usd: 4000, eligibility: [{ kind: 'rule', note: RULE }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'pk-demo', title: 'Demo Grant', max_award_usd: 4000, eligibility: [{ kind: 'demo_video' }] }), 'file', NOW);
  const c = ctx(await installation());
  const A = { name: 'Alpha App', description: 'An app for builders.' };
  const B = { name: 'Beta App', description: 'Another app for builders.' };
  const status = async (id: string, p: Record<string, unknown>) => ((await mcpCall(c, 'find', { program_id: id, project: p })).reply!.verdict as { status: string }).status;
  const listed = async (p: Record<string, unknown>) => {
    const r = (await mcpCall(c, 'find', { project: p, filter: { all: true } })).reply!;
    return { ready: ids(r.ready), gaps: ids(r.gaps) };
  };
  // A's yes to the rule (the track carries no project: the last find was A's).
  assert.ok((await listed(A)).gaps.includes('pk-users'));
  assert.equal((await mcpCall(c, 'track', { program_id: 'pk-users', status: 'gap_done', item: ruleItem(RULE) })).reply!.show_to_builder, 'Tracked. That rule counts as confirmed.');
  assert.ok((await listed(A)).ready.includes('pk-users'));
  const b = await listed(B);
  assert.ok(b.gaps.includes('pk-users') && !b.ready.includes('pk-users'));
  assert.equal(await status('pk-users', B), 'gap');
  // B's demo video, passed with its project after a find of A: A keeps its step.
  await listed(A);
  await mcpCall(c, 'track', { program_id: 'pk-demo', status: 'gap_done', item: 'demo_video', project: B });
  assert.equal(await status('pk-demo', B), 'ready');
  assert.equal(await status('pk-demo', A), 'gap');
  assert.equal(await status('pk-users', A), 'ready');
  // The find note asks for the same project on track.
  const note = (await mcpCall(c, 'find', { project: A })).reply!.agent_note as string;
  assert.ok(note.split('\n').includes('Pass the same project on track so its steps stay with it.'), note);
});

test('O3 (v6.1.10, Review Focus 4): a project with no first-commit date is asked when it started for a new-work hackathon, never refused; its word settles it', async () => {
  const IDEA = { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' };
  const c = { installationId: await installation(), builderId: null, now: NOW };
  const all = await mcpCall(c, 'find', { project: IDEA, filter: { all: true } });
  const notFit = (all.reply!.not_fit as { program_id: string; reason: string }[]).map((n) => n.program_id);
  for (const id of ['ugreen-ai-nas-hackathon-2026', 'kiroween-2026']) {
    assert.ok(!notFit.includes(id), id);
    const g = (all.reply!.gaps as { program_id: string; gap: { kind: string; item: string; what: string }; also: { kind: string; what: string }[] }[]).find((x) => x.program_id === id);
    assert.ok(g, id);
    const started = [g.gap, ...g.also].find((x) => x.kind === 'new_work_after');
    assert.equal(started?.what, 'tell me when you started this', id);
  }
  assert.match(all.reply!.agent_note as string, /"Tell me when you started this" is a question, not work/);
  const one = await mcpCall(c, 'find', { program_id: 'kiroween-2026', project: IDEA });
  // L18-2 (v6.1.18): no repo link, so the code in a public repo comes first and the closing waits on it.
  assert.equal(one.reply!.show_to_builder, 'Kiroween 2026, $100,000 in prizes: code in a public repo, tell me when you started this, a demo video and a Kiro folder in the repo, not ignored by git. First: join Kiroween 2026 with a Devpost account; sign up for a Kiro account (free credits by Dec 1). Their rule: built with Kiro.\nTell me when the code is in a public repo and I look again.');
  const item = ((one.reply!.verdict as { gaps: { kind: string; item: string }[] }).gaps.find((x) => x.kind === 'new_work_after'))!.item;
  const t = await mcpCall(c, 'track', { program_id: 'kiroween-2026', status: 'gap_done', item, project: IDEA });
  assert.equal(t.reply!.show_to_builder, 'Tracked.');
  const again = await mcpCall(c, 'find', { program_id: 'kiroween-2026', project: IDEA });
  assert.equal(again.reply!.show_to_builder, 'Kiroween 2026, $100,000 in prizes: code in a public repo, a demo video and a Kiro folder in the repo, not ignored by git. First: join Kiroween 2026 with a Devpost account; sign up for a Kiro account (free credits by Dec 1). Their rule: built with Kiro.\nTell me when the code is in a public repo and I look again.');
  assert.ok(!(again.reply!.verdict as { gaps: { kind: string }[] }).gaps.some((x) => x.kind === 'new_work_after'));
  // A first-commit date in the project settles it too: after the start fits, before it does not.
  const late = await mcpCall(c, 'find', { program_id: 'ugreen-ai-nas-hackathon-2026', project: { ...IDEA, first_commit_at: '2026-10-25T00:00:00Z' } });
  assert.ok(!(late.reply!.verdict as { gaps: { kind: string }[] }).gaps.some((x) => x.kind === 'new_work_after'));
  const early = await mcpCall(c, 'find', { program_id: 'ugreen-ai-nas-hackathon-2026', project: { ...IDEA, first_commit_at: '2026-01-01T00:00:00Z' } });
  assert.equal((early.reply!.verdict as { status: string }).status, 'no');
});

// Re-pinned by L1i-6 (v6.1.16.1): the no-project open list is names and money with the close and in person.
test('O4 (v6.1.10), M4, L1i-6: the no-project open list names five programs with their money and close, then the count', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', {});
  const lines = (r.reply!.show_to_builder as string).split('\n');
  assert.equal(lines[0], 'Open now:');
  assert.ok(lines.slice(1, 6).every((l) => /^[^\n]+, [^\n]+, closes [^\n]+\.$/.test(l)), lines.join('\n'));
  assert.match(lines[6], /^And \d+ more\.$/);
});

test('L1i-4, L1i-6 (v6.1.16.1): with filter.all, no project and a name only list every open program, one per line, with close and in person', async () => {
  const { listOpenPrograms } = await import('./programs');
  const open = await listOpenPrograms(NOW);
  for (const args of [{ filter: { all: true } }, { project: { name: 'Lumen' }, filter: { all: true } }]) {
    const r = await mcpCall(ctx(await installation()), 'find', args);
    assert.equal(r.isError, false, r.text);
    const show = r.reply!.show_to_builder as string;
    const lines = show.split('\n');
    assert.equal(lines[0], 'Open now:');
    assert.doesNotMatch(show, /^And \d+ more\.$/m);
    for (const p of open) {
      const line = lines.find((l) => l.startsWith(`${p.file.title}, `));
      assert.ok(line, `${p.id} missing: ${show}`);
      if (p.file.in_person) assert.match(line!, /, in person\.$/, p.id);
      if (p.file.ends_at && !/rolling/.test(p.file.summary)) assert.match(line!, /, closes /, p.id);
    }
    assert.equal(lines.filter((l) => /^[^\n]+, [^\n]+\.$/.test(l) && !l.startsWith('Tell me') && !l.startsWith('Sign in')).length, open.length, show);
    assert.equal(lines.at(-1), JSON.stringify(args).includes('Lumen') ? 'Tell me what Lumen does in a line, or its repo link, and I match it.' : 'Tell me which project and I match it.');
  }
});

const NIGHT_FIELDS = [
  { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
  { key: 'tagline', label: 'Tagline', type: 'text', required: true, from: 'project', kind: 'one_liner', todo: 'a tagline', max_chars: 80 },
  { key: 'problem', label: 'What problem do you solve', type: 'text', required: true, from: 'project', kind: 'problem', todo: 'the problem', max_chars: 300 },
  { key: 'email', label: 'Contact email', type: 'email', required: true, from: 'builder', kind: 'contact', todo: 'your email' },
];

test('F1, F2, lane 8 #1, #8, #10 (v6.1.10): the problem the record lacks holds the send and is the one "need you"; the told name and tagline are the agent\'s', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f1-night', title: 'Night Grant', category: 'grant', max_award_usd: 900_000, submission_requirements: NIGHT_FIELDS as never }), 'file', NOW);
  const { id, builderId } = await linkedWith({ person: { name: 'Ada Lovelace', email: 'ada@example.com' }, policy: { auto_apply: true, max_per_night: 5, categories: ['grant'] } });
  const c = { ...ctx(id), builderId };
  // No repo: the name and tagline the agent passed are its drafts (F2), the problem is the builder's (lane 8 #1).
  const bare = await mcpCall(c, 'find', { project: { name: 'Night App', description: 'Night shifts for nurses.', live_url: 'https://night.example' } });
  const show = bare.reply!.show_to_builder as string;
  const line = show.split('\n').find((l) => l.includes('Night Grant'))!;
  assert.equal(line, '1. Night Grant, up to $5,000. You give: the problem.');
  const night = (allReady(bare.reply!) as { program_id: string; need_you: string[]; needs: string[] }[]).find((p) => p.program_id === 'f1-night')!;
  assert.deepEqual([night.need_you, night.needs], [['the problem'], ['the problem']]);
  // Off the tonight list, named as waiting (F1).
  assert.doesNotMatch(show.split('\n').at(-1)!, /Night Grant/);
  assert.match(show, /Before applying: [^\n]*your problem for [^\n]*Night Grant/);
  // With a repo the same line, and the record is never asked for a project with its repo or site (lane 8 #10).
  const repo = await mcpCall(c, 'find', { project: { ...PROJECT, name: 'Night App' } });
  assert.ok(!(repo.reply!.record_missing as string[]).includes('a project with its repo or site'), JSON.stringify(repo.reply!.record_missing));
  // N5 (v6.1.12): a live link passed is the site, so it is not asked for either; with no link at all it is.
  assert.ok(!(bare.reply!.record_missing as string[]).includes('a project with its repo or site'), JSON.stringify(bare.reply!.record_missing));
  const none = await mcpCall(c, 'find', { project: { name: 'Night App', description: 'Night shifts for nurses.' } });
  assert.ok((none.reply!.record_missing as string[]).includes('a project with its repo or site'));
});

test('F3 and fix round 1 (v6.1.10), N3 (v6.1.12): the users yes and the rule yes stand for a fully ready program; with answers missing the closing names them', async () => {
  // L16-8 (v6.1.16): the repo is named (not read here), so FLOSS/fund's code step is not asked.
  const CLI = { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', live_url: 'https://ripgrep.dev', repo_url: 'https://github.com/BurntSushi/ripgrep' };
  // L28-3, FR-1 (v6.1.16 Task 14): signed in as the repo's owner, so the apply offers stand (the test's subject).
  const { id: lid, builderId: lb } = await linkedWith({}, [], 'BurntSushi');
  const c = { ...ctx(lid), builderId: lb } as unknown as ReturnType<typeof ctx>;
  const ask = await mcpCall(c, 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  assert.equal((ask.reply!.show_to_builder as string).split('\n').at(-1), 'Say yes if they do and I draft it.');
  await mcpCall(c, 'track', { program_id: 'floss-fund-zerodha', status: 'gap_done', item: 'users', project: CLI });
  // L24-2 (v6.1.16 Task 11): the yes answered the users question only ("I draft it"); the next reply offers apply
  // afresh. After that offer the list's closing names the manifest link (N3, v6.1.12) and line 1 does not.
  const floss = await mcpCall(c, 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  assert.equal(floss.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000. You give: the funding manifest link. First: publish a funding manifest on your site or repo.', 'Say yes and I apply to FLOSS/fund.'].join('\n'));
  const listed = await mcpCall(c, 'find', { project: CLI });
  assert.match((listed.reply!.show_to_builder as string), /FLOSS\/fund needs your funding manifest link; then I apply\./);
  assert.equal((listed.reply!.show_to_builder as string).match(/funding manifest link/g)!.length, 1, listed.reply!.show_to_builder as string);
  // Fully ready (the one answer is the agent's draft): the yes stands, for the users yes and the rule yes alike.
  const { programFixture } = await import('./fixtures/program');
  const { ruleItem } = await import('./eligibility');
  await upsertProgram(programFixture({ id: 'f3-used', title: 'Used Grant', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f3-rule', title: 'Rule Grant', eligibility: [{ kind: 'rule', note: 'a solo builder' }] }), 'file', NOW);
  // L1e-4 (v6.1.13): the users yes said to FLOSS/fund is a fact about the project, so this program's users question is
  // answered too; the yes to send was said to FLOSS/fund alone, so the closing asks it here.
  const used0 = await mcpCall(c, 'find', { program_id: 'f3-used', project: CLI });
  assert.equal(used0.reply!.show_to_builder, ['Used Grant, up to $5,000.', 'Say yes and I apply to Used Grant.'].join('\n'));
  assert.doesNotMatch(used0.reply!.show_to_builder as string, /real people use it/);
  // Final round (I2): users: true the agent passed settles the users item (ready), but the builder said nothing, so
  // the closing asks for the yes; only gap_done users (the builder's yes relayed) makes it stand.
  const passed = await mcpCall(c, 'find', { program_id: 'f3-used', project: { ...CLI, users: true } });
  assert.equal((passed.reply!.verdict as { status: string }).status, 'ready');
  assert.equal(passed.reply!.show_to_builder, ['Used Grant, up to $5,000.', 'Say yes and I apply to Used Grant.'].join('\n'));
  assert.doesNotMatch(JSON.stringify(passed.reply), /yes stands/);
  await mcpCall(c, 'track', { program_id: 'f3-used', status: 'gap_done', item: 'users', project: CLI });
  const used = await mcpCall(c, 'find', { program_id: 'f3-used', project: CLI });
  assert.equal(used.reply!.show_to_builder, ['Used Grant, up to $5,000.', 'Your yes stands for Used Grant: I apply now.'].join('\n'));
  await mcpCall(c, 'track', { program_id: 'f3-rule', status: 'gap_done', item: ruleItem('a solo builder'), project: CLI });
  const rule = await mcpCall(c, 'find', { program_id: 'f3-rule', project: CLI });
  assert.equal((rule.reply!.show_to_builder as string).split('\n').at(-1), 'Your yes stands for Rule Grant: I apply now.');
});

test('Review Focus 3 (v6.1.13, B4): a done step survives any spelling of the same repo link; a name-only project keeps its steps once its repo is added', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'rf3-demo', title: 'Spelled Grant', max_award_usd: 4000, eligibility: [{ kind: 'demo_video' }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'rf3-two', title: 'Second Grant', max_award_usd: 4000, eligibility: [{ kind: 'demo_video' }] }), 'file', NOW);
  const status = async (c: ReturnType<typeof ctx>, id: string, p: Record<string, unknown>) =>
    ((await mcpCall(c, 'find', { program_id: id, project: p })).reply!.verdict as { status: string }).status;
  const repo = PROJECT.repo_url;
  const [owner, name] = rec.repo.split('/');
  const spellings = [
    `https://www.github.com/${rec.repo}`, `${repo}/tree/main`, `${repo}?tab=readme-ov-file`, `${repo}#readme`, repo.replace('https:', 'http:'),
    `https://github.com:8443/${rec.repo}`, `${repo}.git?x=1`, `https://GitHub.com/${owner.toUpperCase()}/${name}/`,
  ];
  // L24-23 (v6.1.16 Task 11, controller ruling): a link carrying a user name is dropped, never read as the repo.
  const parsedMe = parseProject({ ...PROJECT, repo_url: `https://me@github.com/${rec.repo}` });
  assert.ok(parsedMe.ok && parsedMe.project.repo_url === undefined && parsedMe.problems.includes('the repo link carried a user name and was dropped'));
  for (const spelled of spellings) {
    const c = ctx(await installation());
    assert.equal(await status(c, 'rf3-demo', PROJECT), 'gap', spelled);
    const done = await mcpCall(c, 'track', { program_id: 'rf3-demo', status: 'gap_done', item: 'demo_video', project: { ...PROJECT, repo_url: spelled } });
    assert.equal(done.isError, false, done.text);
    assert.equal(await status(c, 'rf3-demo', PROJECT), 'ready', spelled);
    // And the other way: the find spelled so reads the step marked on the plain link.
    assert.equal(await status(c, 'rf3-demo', { ...PROJECT, repo_url: spelled }), 'ready', spelled);
  }
  // Found by name first: the step done and the claim move to the repo key once the builder says yes to the join
  // question (L28-5, v6.1.16 Task 14, re-pinned: never on a find alone; signed in as the repo's owner, L28-3).
  const { linkInstallation, upsertBuilder } = await import('../v6/builders');
  const u = ctx(await installation());
  const ob = await upsertBuilder({ github_id: 952_474, login: owner, name: 'Owner', avatar_url: null }, NOW);
  await linkInstallation(u.installationId, ob.id, NOW);
  const c = { ...u, builderId: ob.id as number | null } as unknown as ReturnType<typeof ctx>;
  const NAMED = { name: 'Keyed App', description: 'Grants for builders.' };
  assert.equal(await status(c, 'rf3-demo', NAMED), 'gap');
  await mcpCall(c, 'track', { program_id: 'rf3-demo', status: 'gap_done', item: 'demo_video' });
  await mcpCall(c, 'track', { program_id: 'rf3-two', status: 'started', project: NAMED });
  const asked = await mcpCall(c, 'find', { program_id: 'rf3-demo', project: { ...NAMED, repo_url: `${repo}/tree/main` } });
  assert.equal(asked.reply!.show_to_builder, `Is "Keyed App" the same as ${repo.toLowerCase().replace('https://', '')}? Say yes and I join them.`);
  assert.equal((asked.reply!.verdict as { status: string }).status, 'gap');
  const join = async () => mcpCall(c, 'track', { program_id: 'join', status: 'gap_done', item: 'join:Keyed App', project: { ...NAMED, repo_url: repo } });
  const joined = await join();
  assert.equal(joined.isError, false, joined.text);
  assert.equal(joined.reply!.show_to_builder, `Joined "Keyed App" with ${repo.toLowerCase().replace('https://', '')}.`);
  assert.equal(await status(c, 'rf3-demo', { ...NAMED, repo_url: `${repo}/tree/main` }), 'ready');
  const owned = 'b:' + ob.id;
  assert.deepEqual((await sql()`SELECT DISTINCT project_key FROM gaps_done WHERE owner = ${owned}`).map((r) => r.project_key), [repo.toLowerCase()]);
  const [claimRow] = await sql()`SELECT project_id FROM applications WHERE owner = ${owned} AND program_id = 'rf3-two'`;
  assert.equal(claimRow.project_id, repo.toLowerCase());
  // A step under both keys keeps the newer time.
  const older = new Date(NOW.getTime() - 2 * H);
  await sql()`INSERT INTO gaps_done (owner, installation_id, project_key, program_id, item, at) VALUES (${owned}, ${c.installationId}, 'name:keyed app', 'rf3-demo', 'demo_video', ${new Date(NOW.getTime() + H)})`;
  await sql()`UPDATE gaps_done SET at = ${older} WHERE owner = ${owned} AND project_key = ${repo.toLowerCase()}`;
  await mcpCall(c, 'find', { program_id: 'rf3-demo', project: { ...NAMED, repo_url: repo } });
  await join();
  const rows = await sql()`SELECT project_key, at FROM gaps_done WHERE owner = ${owned}`;
  assert.deepEqual(rows.map((r) => [r.project_key, (r.at as Date).toISOString()]), [[repo.toLowerCase(), new Date(NOW.getTime() + H).toISOString()]]);
});

test('Low 22 (v6.1.13): Arbitrum Open House São Paulo opens with when submissions run', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ProgramFile } = await import('./program-file');
  const file = ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs/arbitrum-open-house-sao-paulo.json'), 'utf8')));
  await upsertProgram(file, 'file', NOW);
  const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'arbitrum-open-house-sao-paulo' });
  assert.match((r.reply!.show_to_builder as string).split('\n')[0], /\. Not open yet: Submissions run Feb 8 to Mar 1, 2027; registration is open on HackQuest since Nov 2, 2026, and the requirements are not published yet\.$/);
});


test('L13-7 (v6.1.14): a linked find keeps whether standing approval was on, for the send after it', async () => {
  const on = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 5, categories: ['grant'] } });
  await mcpCall({ ...ctx(on.id), builderId: on.builderId, evidence: LIVE }, 'find', { project: PROJECT });
  const off = await linkedWith(OWNER_RECORD);
  await mcpCall({ ...ctx(off.id), builderId: off.builderId, evidence: LIVE }, 'find', { project: PROJECT });
  const rows = await sql()`SELECT id, last_find_auto FROM installations WHERE id IN (${on.id}, ${off.id})`;
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.last_find_auto])), { [on.id]: true, [off.id]: false });
});

test('L13-8, L12-1 (v6.1.14), L17-6 (v6.1.16): another agent\'s claim with no project holds the program on this list, in the held block, by default and in filter.all, out of the yes', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const { claim } = await import('../v6/claims');
  const [other] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'find-l138-' + Math.random()}, 'Cursor') RETURNING id`;
  const { linkInstallation } = await import('../v6/builders');
  await linkInstallation(other.id as number, builderId, NOW);
  await claim(`b:${builderId}`, 'arbitrum-mentorship-cohort-2', null, other.id as number, new Date(NOW.getTime() - H));
  for (const filter of [undefined, { all: true }]) {
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, ...(filter ? { filter } : {}) });
    const ready = allReady(r.reply!) as { program_id: string; claimed_since?: string }[];
    assert.equal(ready.find((p) => p.program_id === 'arbitrum-mentorship-cohort-2')?.claimed_since, new Date(NOW.getTime() - H).toISOString(), JSON.stringify(filter));
    const show = r.reply!.show_to_builder as string;
    // L17-6 (v6.1.16): a held remote program is never under Ready. L29-26 (v6.1.16 Task 15): by default it is the
    // agent's (Not shown), in the full view its name and money; its line carries no held sentence.
    const held = (filter ? listText(r.reply!) : seen(r.reply!)).split('\n').find((l) => /^\d+\. Arbitrum Mentorship Program/.test(l));
    assert.ok(held, show);
    assert.ok(!blockOf(show, 'Ready to apply').includes('Arbitrum Mentorship Program'), show);
    if (!filter) assert.doesNotMatch(held!, /Being handled/);
    // Never a plain ready one in the yes.
    assert.doesNotMatch(show, /Say yes and I apply\.$/);
  }
});

test('L13-9 (v6.1.14): one tonight list, the same by default and in filter.all; the shown cap never decides what goes', async () => {
  const { programFixture } = await import('./fixtures/program');
  const extra = Array.from({ length: 7 }, (_, k) => `l139-${k}`);
  for (const id of extra) await upsertProgram(programFixture({ id, title: `Night Grant ${id.slice(-1)}`, category: 'grant' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, categories: ['grant'] } });
    const c = { ...ctx(id), builderId, evidence: LIVE };
    const byDefault = await mcpCall(c, 'find', { project: PROJECT });
    const all = await mcpCall(c, 'find', { project: PROJECT, filter: { all: true } });
    const tonight = byDefault.reply!.tonight as { programs: { program_id: string; title: string }[]; limit_used: boolean };
    assert.deepEqual(all.reply!.tonight, tonight);
    for (const x of extra) assert.ok(ids(tonight.programs).includes(x), x);
    // v6.1.17 fix round 1 (I2): the default JSON holds every ready program, so every one going tonight is in it.
    const listed = ids((allReady(byDefault.reply!) as { program_id: string; in_person: boolean }[]).filter((p) => !p.in_person));
    for (const x of ids(tonight.programs)) assert.ok(listed.includes(x), x);
    const line = (r: typeof all) => /Applying now to [^\n]+? under your standing approval\. Say (stop and I hold any of them|yes and I also apply to [^\n]+?)\./.exec(r.reply!.show_to_builder as string)?.[0];
    assert.ok(line(byDefault));
    assert.equal(line(byDefault), line(all));
    assert.doesNotMatch(byDefault.reply!.agent_note as string, /past the shown list/);
  } finally {
    await sql()`DELETE FROM programs WHERE id LIKE 'l139-%'`;
  }
});

test('FR-2 (v6.1.14 final fix): find reads an SSH repo link as the repo, the same reply and project key as its https form', async () => {
  const https = await mcpCall(ctx(await installation()), 'find', { project: PROJECT });
  const sshId = await installation();
  const ssh = await mcpCall(ctx(sshId), 'find', { project: { ...PROJECT, repo_url: `git@github.com:${rec.repo}.git` } });
  assert.equal(ssh.isError, false, ssh.text);
  assert.ok(!((ssh.reply!.problems as string[] | undefined) ?? []).some((p) => /repo_url/.test(p)));
  assert.equal(ssh.reply!.show_to_builder, https.reply!.show_to_builder);
  const [row] = await sql()`SELECT last_project_key FROM installations WHERE id = ${sshId}`;
  assert.equal(row.last_project_key, `https://github.com/${rec.repo}`.toLowerCase());
});

test('L1g-1 (v6.1.16, Review Focus 1): "Quest Runner" (a CLI for team quests) sees no Meta VR by default; in the full list it is only unlikely and its rule is never asked', async () => {
  const QUEST = { name: 'Quest Runner', description: 'Command line runner for team quests', repo_url: `https://github.com/${dash.repo}` };
  const d = await mcpCall(await dashCtx(), 'find', { project: QUEST });
  assert.equal(d.isError, false, d.text);
  assert.ok(!ids(d.reply!.gaps).includes('meta-vr-start-competition-2026'), d.reply!.show_to_builder as string);
  assert.doesNotMatch(d.reply!.show_to_builder as string, /Meta VR/);
  const all = await mcpCall(await dashCtx(), 'find', { project: QUEST, filter: { all: true } });
  const vr = (all.reply!.gaps as { program_id: string; n: number; unlikely?: true; keyword_hit?: true }[]).find((g) => g.program_id === 'meta-vr-start-competition-2026');
  assert.ok(vr?.unlikely && !vr.keyword_hit, JSON.stringify(vr));
  assert.doesNotMatch((listText(all.reply!)).split('\n').at(-1)!, new RegExp(`"yes ${vr!.n}"`));
  // "Built for Meta Quest 3" names it: a keyword hit, in the default list.
  const quest3 = await mcpCall(await dashCtx(), 'find', { project: { ...QUEST, name: 'Arena', description: 'Built for Meta Quest 3' } });
  assert.ok(ids(quest3.reply!.gaps).includes('meta-vr-start-competition-2026'), quest3.reply!.show_to_builder as string);
});

test('L16-7 (v6.1.16, Review Focus 2): a program with a result shows the result and no yes; a sent one with no result keeps its view', async () => {
  const view = async (c: Awaited<ReturnType<typeof dashCtx>>) => mcpCall(c, 'find', { program_id: 'floss-fund-zerodha', project: { ...SAAS, users: true } });
  const won = await dashCtx();
  const before = (await view(won)).reply!.show_to_builder as string;
  assert.match(before, /say yes/i);
  // L28-3 (v6.1.16 Task 14): unsigned in, the builder's own send is kept by name, off the repo, and still read here.
  await mcpCall(won, 'track', { program_id: 'floss-fund-zerodha', status: 'applied', submitted_by: 'builder' });
  // Sent, no result yet: today's view.
  assert.equal((await view(won)).reply!.show_to_builder, before);
  await mcpCall(won, 'track', { program_id: 'floss-fund-zerodha', status: 'won', amount_usd: 3000 });
  const w = (await view(won)).reply!;
  assert.equal(w.show_to_builder, ['FLOSS/fund, $10,000 to $100,000.', 'Won $3,000.'].join('\n'));
  assert.equal(w.agent_note, 'This program already has a result; nothing to send.');
  assert.doesNotMatch(w.show_to_builder as string, /Say|Sign in|Tell me/);
  const lost = await dashCtx();
  await mcpCall(lost, 'track', { program_id: 'floss-fund-zerodha', status: 'applied', submitted_by: 'builder' });
  await mcpCall(lost, 'track', { program_id: 'floss-fund-zerodha', status: 'rejected' });
  assert.equal((await view(lost)).reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000.', 'Rejected.'].join('\n'));
  // No project: the program's own view, not the result.
  assert.doesNotMatch((await mcpCall(lost, 'find', { program_id: 'floss-fund-zerodha' })).reply!.show_to_builder as string, /Rejected/);
});

test('L16-8 (v6.1.16, Review Focus 5): a bit.ly link never clears FUTO\'s code step, nor does a live site; the agent hears to send the real link', async () => {
  const { SHORT_LINK_NOTE } = await import('./project-input');
  const FUTO_LINE = 'FUTO Microgrants, $1,000 to $5,000: code in a public repo.';
  for (const project of [
    { name: 'Rent Split', description: 'An app that splits rent.', repo_url: 'https://bit.ly/3xYz' },
    { name: 'Rent Split', description: 'An app that splits rent.', live_url: 'https://rentsplit.app' },
  ]) {
    const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'futo-microgrants', project });
    assert.ok((r.reply!.show_to_builder as string).startsWith(FUTO_LINE), r.reply!.show_to_builder as string);
    assert.equal((r.reply!.agent_note as string).includes(SHORT_LINK_NOTE), project.repo_url !== undefined, r.reply!.agent_note as string);
    // The list says the same, and the shortened link is named for the agent there too.
    const list = await mcpCall(ctx(await installation()), 'find', { project });
    assert.ok(seen(list.reply!).includes('code in a public repo'), list.reply!.show_to_builder as string);
    assert.equal((list.reply!.agent_note as string).split('\n').filter((l) => l === SHORT_LINK_NOTE).length, project.repo_url !== undefined ? 1 : 0);
  }
  const short = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Rent Split', description: 'An app that splits rent.', repo_url: 'https://bit.ly/3xYz' } });
  assert.deepEqual(short.reply!.problems, ['repo_url dropped: a shortened link']);
});

test('L16-6 (v6.1.16, lane 16 N41, Review Focus 5): a Codeberg browse link and its clone link share one done step', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'n41-demo', title: 'Berg Grant', max_award_usd: 4000, eligibility: [{ kind: 'demo_video' }] }), 'file', NOW);
  const status = async (c: ReturnType<typeof ctx>, p: Record<string, unknown>) =>
    ((await mcpCall(c, 'find', { program_id: 'n41-demo', project: p })).reply!.verdict as { status: string }).status;
  for (const [browse, clone] of [
    ['https://codeberg.org/acme/berg/src/branch/main', 'https://codeberg.org/acme/berg.git'],
    ['https://bitbucket.org/acme/bucket/src/main/', 'git@bitbucket.org:acme/bucket.git'],
  ]) {
    const c = ctx(await installation());
    const P = { name: 'Berg', description: 'A tool.', repo_url: browse };
    assert.equal(await status(c, P), 'gap', browse);
    const done = await mcpCall(c, 'track', { program_id: 'n41-demo', status: 'gap_done', item: 'demo_video', project: { ...P, repo_url: clone } });
    assert.equal(done.isError, false, done.text);
    assert.equal(await status(c, P), 'ready', browse);
  }
});

test('L1h-1, L1h-2 (v6.1.16): the lookup JSON carries full figures; "otf" and "OTF" name the OTF fund, "internet freedom" still does', async () => {
  const id = await installation();
  for (const program_id of ['arbitrum-mentorship-cohort-2', 'alliance-all19']) {
    const r = await mcpCall(ctx(id), 'find', { program_id });
    const p = r.reply!.program as { description: string; reward: string };
    for (const t of [p.description, p.reward, JSON.stringify(r.reply!.guide)]) assert.doesNotMatch(t, /\d[KkMm]\b/, `${program_id}: ${t}`);
  }
  assert.match(JSON.stringify((await mcpCall(ctx(id), 'find', { program_id: 'alliance-all19' })).reply!.program), /\$400,000 upon admission/);
  for (const name of ['otf', 'OTF', 'internet freedom'])
    assert.equal(((await mcpCall(ctx(id), 'find', { program_id: name })).reply!.program as { id: string } | null)?.id, 'otf-internet-freedom-fund', name);
  // L1j-2 (v6.1.17, Review Focus 2): the name given, never a bare question.
  assert.equal((await mcpCall(ctx(id), 'find', { program_id: 'zzqx' })).reply!.show_to_builder, 'I do not know a program called "zzqx". Say its full name.');
});

test('L1h-1 (v6.1.16): EarnKit\'s own hint for the Solana Incubator reads in full figures', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'solana-incubator-cohort-6', project: { name: 'Pay App', description: 'Payments for coffee shops on Solana.', chains: ['solana'] } });
  assert.ok(r.text.includes('your path to $10,000,000 annual revenue'), r.text.slice(0, 400));
  assert.doesNotMatch(r.text.replace(/generating \$10M/g, ''), /path to \$10M/);
});

// ---- v6.1.16 Task 9: time truth (lane 23) ----

test('Review Focus 12 (v6.1.16, L23-2): a program past ends_at reads closed on find, its tile, its guide (200, Closed on), the lists and the ledger before any run', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { landingAt, landingTiles } = await import('./landing');
  const { gatedGuidePage, guideTextById, listGuideIds } = await import('./guide-page');
  const { programsListGet, readListedPrograms } = await import('./programs-read');
  const { summary } = await import('./ledger');
  const minuteAgo = new Date(NOW.getTime() - 60_000).toISOString();
  const file = programFixture({ id: 'tt-past', title: 'Past Grant', summary: 'Up to $5,000', ends_at: minuteAgo });
  await upsertProgram(file, 'file', new Date(NOW.getTime() - 2 * H));
  try {
    // Find: one line, closed, no yes.
    const one = await mcpCall(ctx(await installation()), 'find', { program_id: 'tt-past', project: PROJECT });
    assert.equal(one.reply!.show_to_builder, 'Past Grant, up to $5,000, closed.');
    // The tile, fresh and from a cache made before the close.
    const row = (await getProgram('tt-past'))!;
    assert.equal(landingTiles([row], NOW)[0].when, 'Closed');
    const cached = landingTiles([row], new Date(NOW.getTime() - 2 * 60_000))[0];
    assert.equal(cached.when, 'Closes in under an hour');
    const l = landingAt({ chip: null, tiles: [cached], featured: [cached], total: 1 }, NOW);
    assert.deepEqual([l.tiles[0].when, l.featured[0].when], ['Closed', 'Closed']);
    // The guide: listed, rendered closed, no Apply link.
    assert.ok((await listGuideIds(NOW)).includes('tt-past'));
    const page = await gatedGuidePage('tt-past', () => listGuideIds(NOW), (id) => guideTextById(id, NOW));
    assert.ok(page);
    assert.deepEqual([page.status, page.submission_url, page.guide.closed_on, page.guide.closes, page.guide.submit], ['closed', '', 'Closed on Nov 4.', 'Closed', null]);
    // The list: gone from a fresh read and from a cached one.
    assert.ok(!(await readListedPrograms(NOW)).some((p) => p.id === 'tt-past'));
    const before = await readListedPrograms(new Date(NOW.getTime() - 2 * 60_000));
    assert.ok(before.some((p) => p.id === 'tt-past'));
    const body = (await (await programsListGet(new Request('https://earnkit.test/api/programs'), async () => before, NOW)).json()) as { programs: { id: string }[] };
    assert.ok(!body.programs.some((p) => p.id === 'tt-past'));
    // The ledger (find and /me): never closing soon.
    assert.deepEqual((await summary('i:0', [row], NOW)).closing_soon, []);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'tt-past'`;
  }
});

test('L23-9, L23-22 (v6.1.16): one minute before a close, find, the tile and the guide all say closes in under an hour', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { landingTiles } = await import('./landing');
  const { guideTextById } = await import('./guide-page');
  const soon = new Date(NOW.getTime() + 60_000).toISOString();
  await upsertProgram(programFixture({ id: 'tt-soon', title: 'Soon Grant', summary: 'Up to $5,000', ends_at: soon }), 'file', NOW);
  try {
    const one = await mcpCall(ctx(await installation()), 'find', { program_id: 'tt-soon' });
    assert.match(one.reply!.show_to_builder as string, /^Soon Grant, up to \$5,000, closes in under an hour\./);
    const list = await mcpCall(ctx(await installation()), 'find', {});
    // L1i-6 (v6.1.16.1): the open list keeps the close, as the tile and the guide.
    assert.match(list.reply!.show_to_builder as string, /^Open now:\nSoon Grant, up to \$5,000, closes in under an hour\.$/m);
    assert.equal(landingTiles([(await getProgram('tt-soon'))!], NOW)[0].when, 'Closes in under an hour');
    assert.equal((await guideTextById('tt-soon', NOW))!.guide.closes, 'Closes in under an hour.');
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'tt-soon'`;
  }
});

test('L23-1 (v6.1.16): a day after the standing-approval line, nothing sent: the next find says so first, once, and keeps one Say', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'tt-promise', title: 'Promise Grant', category: 'grant' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, categories: ['grant'] } });
    const c = (now: Date) => ({ ...ctx(id, now), builderId, evidence: LIVE });
    const first = await mcpCall(c(NOW), 'find', { project: PROJECT });
    const named = (first.reply!.tonight as { programs: { program_id: string; title: string }[] }).programs;
    assert.ok(ids(named).includes('tt-promise'));
    assert.match(first.reply!.show_to_builder as string, /Applying now to [^\n]* under your standing approval\. Say stop and I hold any of them\./);
    const [kept] = await sql()`SELECT promised, promised_at FROM installations WHERE id = ${id}`;
    assert.deepEqual(ids(kept.promised), ids(named));
    // Within 24 hours nothing is said.
    const soon = await mcpCall(c(new Date(NOW.getTime() + 10 * H)), 'find', { project: PROJECT });
    assert.doesNotMatch(soon.reply!.show_to_builder as string, /Nothing was sent/);
    // A day later, nothing recorded since: said first, the closing loses its Say.
    const day = await mcpCall(c(new Date(NOW.getTime() + 25 * H)), 'find', { project: PROJECT });
    const show = day.reply!.show_to_builder as string;
    assert.match(show, /\nNothing was sent for [^\n]*Promise Grant[^\n]* since you said yes on Nov 4\. Say yes again and I apply now\.$/);
    // L24-8 (v6.1.16 Task 11): a gap line's "do n" is folded into the closing, so one Say in all.
    assert.equal(show.match(/\bSay\b/g)?.length, 1, show);
    assert.match(day.reply!.agent_note as string, /Nothing was sent for [^\n]*Promise Grant[^\n]* after the standing-approval line named them/);
    // Said once.
    const after = await mcpCall(c(new Date(NOW.getTime() + 26 * H)), 'find', { project: PROJECT });
    assert.doesNotMatch(after.reply!.show_to_builder as string, /Nothing was sent/);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'tt-promise'`;
  }
});

test('L23-4 (v6.1.16): two agents of one builder each ask about a result past due once a day, in builder text', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { saveInstallation, connectInstallation } = await import('./installations');
  const { linkInstallation } = await import('../v6/builders');
  await upsertProgram(programFixture({ id: 'tt-due', title: 'Due Two Grant', results_due: { date: '2026-11-01' } }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith(OWNER_RECORD);
    const token = 'tt-second-' + Math.random();
    await saveInstallation(token, 'Cursor');
    const second = (await connectInstallation(token))!.id;
    await linkInstallation(second, builderId, NOW);
    const t = await mcpCall({ ...ctx(id), builderId }, 'track', { program_id: 'tt-due', status: 'applied' });
    assert.equal(t.isError, false, t.text);
    const LINE = /\nResults for Due Two Grant were due Nov 1\. Did you hear back\?\n/;
    // Fix round 1 (I1, v6.1.16.1): in a full 10 lines the results question gives way to the step rows past the first;
    // then it is the agent's, under "Not shown to the builder".
    const at = async (inst: number, now: Date) => ({ reply: { show_to_builder: seen((await mcpCall({ ...ctx(inst, now), builderId, evidence: LIVE }, 'find', { project: PROJECT })).reply!) } });
    const later = new Date(NOW.getTime() + H);
    assert.match((await at(id, NOW)).reply!.show_to_builder as string, LINE);
    assert.doesNotMatch((await at(id, later)).reply!.show_to_builder as string, LINE);
    assert.match((await at(second, later)).reply!.show_to_builder as string, LINE);
    assert.doesNotMatch((await at(second, later)).reply!.show_to_builder as string, LINE);
    const tomorrow = new Date(NOW.getTime() + 24 * H);
    assert.match((await at(id, tomorrow)).reply!.show_to_builder as string, LINE);
    assert.match((await at(second, tomorrow)).reply!.show_to_builder as string, LINE);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'tt-due'`;
  }
});

test('L23-8 (v6.1.16): a one-program find of a program another agent of the builder started says so in place of the yes', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { claim } = await import('../v6/claims');
  const { saveInstallation, connectInstallation } = await import('./installations');
  const { linkInstallation } = await import('../v6/builders');
  await upsertProgram(programFixture({ id: 'tt-held', title: 'Held Grant' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith(OWNER_RECORD);
    const token = 'tt-holder-' + Math.random();
    await saveInstallation(token, 'Cursor');
    const other = (await connectInstallation(token))!.id;
    await linkInstallation(other, builderId, NOW);
    const before = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { program_id: 'tt-held', project: PROJECT });
    assert.match(before.reply!.show_to_builder as string, /\nSay yes and I apply to Held Grant\.$/);
    await claim(`b:${builderId}`, 'tt-held', 'earnkit', other, new Date(NOW.getTime() - 60_000));
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { program_id: 'tt-held', project: PROJECT });
    const show = r.reply!.show_to_builder as string;
    assert.match(show, /\nAnother agent of yours started this one on Nov 4\.$/);
    assert.doesNotMatch(show, /\bSay yes\b/);
    assert.match(r.reply!.agent_note as string, /Claimed by another of the builder's agents: do not submit it\./);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'tt-held'`;
  }
});

test('L23-18 (v6.1.16): a closed program the builder sent says when, and when results come (or that none are announced)', async () => {
  const { programFixture } = await import('./fixtures/program');
  const closes = new Date(NOW.getTime() + 2 * H).toISOString();
  await upsertProgram(programFixture({ id: 'tt-sent', title: 'Sent Grant', summary: 'Up to $5,000', ends_at: closes, results_due: { date: '2026-12-01' } }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'tt-sent2', title: 'Sent Two Grant', summary: 'Up to $5,000', ends_at: closes }), 'file', NOW);
  try {
    const id = await installation();
    for (const p of ['tt-sent', 'tt-sent2']) assert.equal((await mcpCall(ctx(id), 'track', { program_id: p, status: 'applied' })).isError, false);
    const later = new Date(NOW.getTime() + 3 * 24 * H);
    const a = await mcpCall(ctx(id, later), 'find', { program_id: 'tt-sent' });
    assert.equal(a.reply!.show_to_builder, 'Sent Grant, up to $5,000.\nClosed. You applied Nov 4; results Dec 1.');
    const b = await mcpCall(ctx(id, later), 'find', { program_id: 'tt-sent2' });
    assert.equal(b.reply!.show_to_builder, 'Sent Two Grant, up to $5,000.\nClosed. You applied Nov 4; results not announced.');
    assert.equal((b.reply!.show_to_builder as string).match(/closed/gi)?.length, 1);
  } finally {
    await sql()`DELETE FROM programs WHERE id IN ('tt-sent', 'tt-sent2')`;
  }
});

test('L23-16 (v6.1.16), lane 23 A1 and A2: the same list 10 hours later starts with Nothing new since and keeps the money lines', async () => {
  const id = await installation();
  const first = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.doesNotMatch(first.reply!.show_to_builder as string, /Nothing new/);
  const again = await mcpCall(ctx(id, new Date(NOW.getTime() + 10 * H)), 'find', { project: PROJECT });
  assert.equal(again.reply!.nothing_new_since, NOW.toISOString());
  // With nothing else moved (the since line empty), it sits after the money lines (pinned in reply.test). v6.1.17: this
  // catalog fills the 10 lines with rows and the And-more line (L1j-3), and the since line gives way first (fix round 1 I1).
  const show = again.reply!.show_to_builder as string;
  assert.equal(show, [
    'Ready to apply (4):',
    '1. Night Grant, up to $5,000.',
    '2. Live Link Grant, up to $5,000.',
    '3. Contact Grant, up to $5,000.',
    'One step away (3):',
    '4. S4 Codes Grant, up to $5,000: add Base Builder Codes to the app.',
    '5. Berg Grant, up to $5,000: a demo video.',
    '6. Demo Grant, up to $5,000: a demo video.',
    'And 42 more in the full list.',
    'Sign in once and I check the repo is yours; then say yes.',
  ].join('\n'));
  const [row] = await sql()`SELECT last_list_hash, last_list_at FROM installations WHERE id = ${id}`;
  assert.match(row.last_list_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.last_list_at.toISOString(), new Date(NOW.getTime() + 10 * H).toISOString());
  // A linked agent too (A1).
  const { id: linkedId, builderId } = await linkedWith(OWNER_RECORD);
  const lc = (now: Date) => ({ ...ctx(linkedId, now), builderId, evidence: LIVE });
  await mcpCall(lc(NOW), 'find', { project: PROJECT });
  assert.equal((await mcpCall(lc(new Date(NOW.getTime() + 10 * H)), 'find', { project: PROJECT })).reply!.nothing_new_since, NOW.toISOString());
  // Another list: not said.
  const other = await mcpCall(ctx(id, new Date(NOW.getTime() + 11 * H)), 'find', { project: { name: 'Notes', description: 'Personal markdown notes' } });
  assert.equal(other.reply!.nothing_new_since, undefined);
  // v6.1.17 Task 5 (v6.1.16 Task 9 N3): the nothing-new line itself, exactly. This find's reply, cut to its first ready
  // row so the 10 lines leave room and with its since line empty (nothing else moved; this file's catalog moved Alliance),
  // reads it: the same day `your last look`, a later day the date.
  const { replyText } = await import('./reply');
  const since = again.reply!.since as Record<string, unknown>;
  const short = { ...again.reply!, since: { ...since, new: [], changed: [], closing: [] }, ready: (again.reply!.ready as unknown[]).slice(0, 1), gaps: [], in_person: [], you_send: [] };
  const sinceOf = (now: Date) => replyText(short as never, false, now).split('\n').filter((l) => /^Nothing new since|^Since /.test(l));
  assert.deepEqual(sinceOf(new Date(NOW.getTime() + 10 * H)), ['Nothing new since your last look.']);
  assert.deepEqual(sinceOf(new Date(NOW.getTime() + 48 * H)), ['Nothing new since Nov 4.']);
});

/** Every string literal on an assert line of a test file: the pinned replies and their parts. */
function pinnedTexts(file: string): string[] {
  const src = readFileSync(join(import.meta.dirname, file), 'utf8');
  return src.split('\n').filter((l) => /\bassert\./.test(l) && !/^\s*\/\//.test(l)).flatMap((l) => l.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []);
}

test('Review Focus 12 (v6.1.16, L23-1): no pinned reply and no exported text promises a send tonight or by tomorrow morning', async () => {
  const banned = /\btonight\b|by tomorrow morning/i;
  for (const f of ['find.test.ts', 'reply.test.ts', 'track.test.ts']) for (const t of pinnedTexts(f)) assert.doesNotMatch(t.replace(/\$\{[^}]*\}/g, ''), banned, `${f}: ${t}`);
  const mods = [await import('./reply'), await import('./site-copy'), await import('./tool-text'), await import('./llms'), await import('./ledger'), await import('../v6/find-record'), await import('../v6/screen-tool')];
  const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
  for (const m of mods) for (const [k, v] of Object.entries(m)) for (const s of strings(v)) assert.doesNotMatch(s, banned, `${k}: ${s}`);
});

test('ONE_SAY_ORDER (v6.1.16, L23-21): no pinned reply carries two Says (L24-8, Task 11: the do offer is the closing\'s)', async () => {
  const { ONE_SAY_ORDER, oneSay, withoutSay } = await import('./reply');
  assert.deepEqual([...ONE_SAY_ORDER], ['not_sent', 'started_not_sent', 'record_sign_in', 'closing']);
  const say = oneSay();
  assert.equal(say('A: started Nov 3, nothing sent. Say yes to apply or say skip.'), 'A: started Nov 3, nothing sent. Say yes to apply or say skip.');
  assert.equal(say('Nothing is ready yet. Say "yes 2" if that rule fits you and I get it ready.'), 'Nothing is ready yet.');
  assert.equal(withoutSay('Say yes and I apply to all 3.'), '');
  const says = (t: string) => (t.match(/\bSay\b/g) ?? []).length;
  for (const f of ['find.test.ts', 'reply.test.ts', 'track.test.ts']) for (const t of pinnedTexts(f)) assert.ok(says(t) <= 1, `${f}: ${t}`);
});

test('Task 9 fix round 1 (M1): an upcoming program at its start date reads open on every surface before the run flips it; one with no form stays not open yet', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { isOpenAt, listOpenPrograms } = await import('./programs');
  const { landingAt, landingTiles } = await import('./landing');
  const { guideTextById } = await import('./guide-page');
  const { readListedPrograms } = await import('./programs-read');
  // NLnet open call style: upcoming, a form, the next window starting now.
  const start = new Date(NOW.getTime() - 60_000).toISOString();
  const file = programFixture({ id: 'tt-opens', title: 'Opens Call', status: 'upcoming', summary: 'Up to $5,000', starts_at: start,
    ends_at: new Date(NOW.getTime() + 20 * 24 * H).toISOString(), opens_note: 'Opens on its next call date' });
  await upsertProgram(file, 'file', new Date(NOW.getTime() - 24 * H));
  await upsertProgram(programFixture({ id: 'tt-noform', title: 'No Form Call', status: 'upcoming', starts_at: start, submission_requirements: [], opens_note: 'Form to come' }), 'file', new Date(NOW.getTime() - 24 * H));
  try {
    assert.equal(isOpenAt(file, NOW), true);
    assert.equal(isOpenAt(file, new Date(NOW.getTime() - 2 * 60_000)), false);
    assert.ok((await listOpenPrograms(NOW)).some((r) => r.id === 'tt-opens'));
    assert.ok(!(await listOpenPrograms(NOW)).some((r) => r.id === 'tt-noform'));
    const one = await mcpCall(ctx(await installation()), 'find', { program_id: 'tt-opens' });
    assert.match(one.reply!.show_to_builder as string, /^Opens Call, up to \$5,000, closes Nov 24\./);
    assert.match((await mcpCall(ctx(await installation()), 'find', { program_id: 'tt-noform' })).reply!.show_to_builder as string, /Not open yet: Form to come\./);
    const row = (await getProgram('tt-opens'))!;
    const tile = landingTiles([row], NOW)[0];
    assert.deepEqual([tile.status, tile.when], ['active', 'Closes Nov 24']);
    // A tile cached a minute before the start flips at render.
    const cached = landingTiles([row], new Date(NOW.getTime() - 2 * 60_000))[0];
    assert.deepEqual([cached.status, cached.when], ['upcoming', 'Not open yet']);
    const l = landingAt({ chip: null, tiles: [cached], featured: [], total: 1 }, NOW);
    assert.deepEqual([l.tiles[0].status, l.tiles[0].when], ['active', 'Closes Nov 24']);
    const page = (await guideTextById('tt-opens', NOW))!;
    assert.deepEqual([page.status, page.opens_note, page.guide.closes, page.submission_url !== ''], ['active', null, 'Closes Nov 24.', true]);
    assert.equal((await readListedPrograms(NOW)).find((p) => p.id === 'tt-opens')?.status, 'active');
  } finally {
    await sql()`DELETE FROM programs WHERE id IN ('tt-opens', 'tt-noform')`;
  }
});

test('Task 9 fix round 1 (N5): unlinking an agent clears its kept standing-approval promise', async () => {
  const { markPromised, promisedOf } = await import('./installations');
  const { unlinkInstallation } = await import('../v6/builders');
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  await markPromised(id, [{ program_id: 'x', title: 'X Grant' }], NOW);
  assert.ok(await promisedOf(id));
  assert.equal(await unlinkInstallation(id, builderId, NOW), true);
  assert.equal(await promisedOf(id), null);
});

// v6.1.16 Task 11 (lane 24).

const L24_CLI = { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', live_url: 'https://ripgrep.dev', repo_url: 'https://github.com/BurntSushi/ripgrep' };

test('L24-2 (Review Focus 14): a yes to a question settles only the question; the next reply offers apply afresh; after an apply offer the yes stands', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { ruleItem } = await import('./eligibility');
  await upsertProgram(programFixture({ id: 'l24-us', title: 'L24 Users Grant', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'l24-rule', title: 'L24 Rule Grant', eligibility: [{ kind: 'rule', note: 'a first-time founder' }] }), 'file', NOW);
  try {
    // L28-3, FR-1 (v6.1.16 Task 14): signed in as the repo's owner, so the apply offers stand.
    const { id: lid, builderId: lb } = await linkedWith({}, [], 'BurntSushi');
    const c = { ...ctx(lid), builderId: lb } as unknown as ReturnType<typeof ctx>;
    const last = async (id: string) => ((await mcpCall(c, 'find', { program_id: id, project: L24_CLI })).reply!.show_to_builder as string).split('\n').at(-1);
    // The users question ("I draft it"), the builder's yes, then the next reply.
    assert.equal(await last('l24-us'), 'Say yes if they do and I draft it.');
    await mcpCall(c, 'track', { program_id: 'l24-us', status: 'gap_done', item: 'users', project: L24_CLI });
    assert.equal(await last('l24-us'), 'Say yes and I apply to L24 Users Grant.');
    // That was an apply offer: now the yes stands.
    assert.equal(await last('l24-us'), 'Your yes stands for L24 Users Grant: I apply now.');
    // The rule question ("Say yes if that is you and I draft it."), the yes, then the apply offer afresh.
    assert.equal(await last('l24-rule'), 'Say yes if that is you and I draft it.');
    await mcpCall(c, 'track', { program_id: 'l24-rule', status: 'gap_done', item: ruleItem('a first-time founder'), project: L24_CLI });
    assert.equal(await last('l24-rule'), 'Say yes and I apply to L24 Rule Grant.');
    // The list after a look-again question: no "Your yes stands"; after an apply offer it stands.
    await sql()`UPDATE installations SET last_offer = 'look_again' WHERE id = ${c.installationId}`;
    const list = await mcpCall(c, 'find', { project: L24_CLI });
    assert.doesNotMatch(list.reply!.show_to_builder as string, /Your yes stands/);
    assert.equal((await sql()`SELECT last_offer FROM installations WHERE id = ${c.installationId}`)[0].last_offer, 'apply');
    const again = await mcpCall(c, 'find', { project: L24_CLI });
    assert.match(again.reply!.show_to_builder as string, /Your yes stands for [^\n]*L24 (Users|Rule) Grant/);
    for (const r of [list, again]) assert.doesNotMatch(r.reply!.agent_note as string, /without asking again/);
  } finally {
    await sql()`DELETE FROM programs WHERE id IN ('l24-us', 'l24-rule')`;
  }
});

test('L23-12 K7 (v6.1.17 Task 5, v6.1.16 Task 9 N3): 181 days and a sweep later, a name-only find keeps the repo, the confirmed rule and its standing yes', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { ruleItem } = await import('./eligibility');
  const { resolvedKey, sweepReports } = await import('./ledger');
  const ends = new Date(NOW.getTime() + 365 * 24 * H).toISOString();
  await upsertProgram(programFixture({ id: 'k7-rule', title: 'K7 Rule Grant', ends_at: ends, eligibility: [{ kind: 'rule', note: 'a first-time founder' }] }), 'file', NOW);
  try {
    const { id: lid, builderId: lb } = await linkedWith({}, [], 'BurntSushi');
    const at = (days: number) => ({ ...ctx(lid, new Date(NOW.getTime() + days * 24 * H)), builderId: lb }) as unknown as ReturnType<typeof ctx>;
    const last = async (days: number, project: Record<string, unknown>) => ((await mcpCall(at(days), 'find', { program_id: 'k7-rule', project })).reply!.show_to_builder as string).split('\n').at(-1);
    assert.equal(await last(0, L24_CLI), 'Say yes if that is you and I draft it.');
    const yes = await mcpCall(at(0), 'track', { program_id: 'k7-rule', status: 'gap_done', item: ruleItem('a first-time founder'), project: L24_CLI });
    assert.equal(yes.isError, false, yes.text);
    assert.equal(await last(0, L24_CLI), 'Say yes and I apply to K7 Rule Grant.');
    const later = new Date(NOW.getTime() + 181 * 24 * H);
    await sweepReports(later);
    const owner = `b:${lb}`;
    assert.equal(await resolvedKey(owner, 'name:ripgrep'), 'https://github.com/burntsushi/ripgrep');
    // The name alone, after the sweep: the rule yes and the apply offer still stand.
    assert.equal(await last(181, { name: L24_CLI.name, description: L24_CLI.description }), 'Your yes stands for K7 Rule Grant: I apply now.');
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'k7-rule'`;
  }
});

test('L24-13, L24-29: the one-program reply under standing approval says so with the list note; it carries the project problems', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'l24-y1', title: 'L24 Alpha Grant', category: 'grant' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, categories: ['grant'] } });
    const c = { ...ctx(id), builderId, evidence: LIVE };
    const r = await mcpCall(c, 'find', { program_id: 'l24-y1', project: { ...PROJECT, name: 'A'.repeat(200) } });
    const show = r.reply!.show_to_builder as string;
    assert.equal(show.split('\n').at(-1), 'Under your standing approval; I apply when your agent next checks. Say stop and I hold it.');
    const note = r.reply!.agent_note as string;
    assert.ok(note.includes('Standing approval is on for only these:'), note);
    assert.ok(note.includes('On stop, call track with status held for each program named.'));
    assert.deepEqual(r.reply!.problems, ['name cut to 80 characters']);
    assert.ok(note.includes('Some project facts were dropped: name cut to 80 characters.'), note);
    // Held: never under standing approval, on the list or the one-program reply.
    await mcpCall(c, 'track', { program_id: 'l24-y1', status: 'held', project: PROJECT });
    const held = await mcpCall(c, 'find', { program_id: 'l24-y1', project: PROJECT });
    assert.notEqual((held.reply!.show_to_builder as string).split('\n').at(-1), 'Under your standing approval; I apply when your agent next checks. Say stop and I hold it.');
    const list = await mcpCall(c, 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(!ids((list.reply!.tonight as { programs: unknown }).programs).includes('l24-y1'));
    // L29-26 (v6.1.16 Task 15): the full view is names and money; the hold is in the JSON.
  assert.match(listText(list.reply!), /^\d+\. L24 Alpha Grant/m);
    // started lifts the hold.
    await mcpCall(c, 'track', { program_id: 'l24-y1', status: 'started', project: PROJECT });
    const back = await mcpCall(c, 'find', { project: PROJECT, filter: { all: true } });
    assert.doesNotMatch(listText(back.reply!), /On hold/);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'l24-y1'`;
  }
});

test('L24-1 (ruling 12): another agent\'s project name never reaches this agent\'s reply', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const [other] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'find-l24-' + Math.random()}, 'Cursor') RETURNING id`;
  const { linkInstallation } = await import('../v6/builders');
  await linkInstallation(other.id as number, builderId, NOW);
  const name = 'Neutral Words Stand In Here For All 52';
  const { track } = await import('./track');
  await track({ installationId: other.id as number, builderId, now: NOW }, { program_id: 'y-combinator', status: 'started', project: { name, description: 'x' } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  const all = JSON.stringify(r.reply);
  for (const w of ['Neutral', 'Stand', 'neutral words']) assert.ok(!all.includes(w), w);
  assert.match(listText(r.reply!), /Y Combinator[^\n]* Being handled by your other agent\./);
});

test('Review Focus 15 (v6.1.16 Task 11): hidden characters in a name, a description, a record answer, a track note and a client name reach no surface; a Persian joiner survives', async () => {
  const HIDDEN = /[\u0000\u000d\u202e\u200b\ufeff\u2060]|[A-Za-z]\u200d[A-Za-z]/;
  const PERSIAN = 'می\u200cخواهم';
  // L28-3 (v6.1.16 Task 14): the claim needs the repo's own builder.
  const { id, builderId } = await linkedWith(OWNER_RECORD, [], PROJECT.repo_url.split('/')[3]);
  await sql()`UPDATE installations SET client_name = ${'Agent\u202e\u200bName'} WHERE id = ${id}`;
  const dirty = (s: string) => `${s}\u202e\u200bA\u200dB\u0000\r\n${PERSIAN}`;
  const project = { ...PROJECT, name: dirty('Timer'), description: dirty('A timer for builders.') };
  const c = { ...ctx(id), builderId, evidence: LIVE };
  const rec = await mcpCall(c, 'record', { set: { answers: { problem: { text: dirty('Builders miss grants.') } } } });
  const f = await mcpCall(c, 'find', { project });
  const one = await mcpCall(c, 'find', { program_id: 'y-combinator', project });
  const t = await mcpCall(c, 'track', { program_id: 'y-combinator', status: 'started', note: dirty('note'), project });
  for (const r of [rec, f, one, t]) {
    assert.doesNotMatch(r.reply!.show_to_builder as string, HIDDEN);
    assert.doesNotMatch(r.reply!.agent_note as string, HIDDEN);
    assert.doesNotMatch(JSON.stringify(r.reply), /\\u0000|\\r|\\u202e|\\u200b/);
  }
  const { getRecord } = await import('../v6/builders');
  const stored = (await getRecord(builderId)).answers.problem!.text;
  assert.doesNotMatch(stored, HIDDEN);
  assert.ok(stored.includes(PERSIAN), stored);
  const [row] = await sql()`SELECT note FROM applications WHERE owner = ${'b:' + builderId} AND program_id = 'y-combinator'`;
  assert.doesNotMatch(row.note as string, HIDDEN);
  assert.ok((row.note as string).includes(PERSIAN));
  const { meData } = await import('../v6/me-view');
  const was = process.env.EARNKIT_AUTH_SECRET;
  process.env.EARNKIT_AUTH_SECRET ??= 'find-test-secret-0123456789abcdef';
  const me = await meData({ id: builderId, login: 'x', name: null } as never, NOW, 'sess').finally(() => {
    if (was === undefined) delete process.env.EARNKIT_AUTH_SECRET;
  });
  assert.doesNotMatch(JSON.stringify(me), /\\u0000|\\u202e|\\u200b|\u202e|\u200b/);
});

// v6.1.16 Task 15 (L29-26, Review Focus 21): the default find is at most ten lines with one Say, the last.
const sayLines = (show: string) => show.split('\n').filter((l) => /(^|[.?!] )(Or )?[Ss]ay\b/.test(l));
test('Review Focus 21: each of the 52 catalog programs as the only ready one, with every other line a reply can carry, reads at most 10 lines and one Say, last', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { ProgramFile } = await import('./program-file');
  const { prefill } = await import('./prefill');
  const { reportOnlyFacts } = await import('./repo-facts');
  const { moneyOf } = await import('./find');
  const { replyParts, numbered, attendRuleGap } = await import('./reply');
  const dir = new URL('../../../../programs/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 52);
  const facts = reportOnlyFacts({ name: 'App', description: 'An app.' } as never);
  const gap = (n: string): GapProgram => ({
    program_id: n, title: `${n} Grant`, money: '$1,000', max_award_usd: 1000, category: 'grant', closes_at: null, rules: [], in_person: false, setup: [], n: 0,
    gap: { kind: 'chain', item: 'chain:arc', what: 'deploy the contract on Arc', effort: 'hours', agent_can: false }, also: [],
  });
  const apps = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((t) => ({ program_id: t, title: `${t} Grant`, status: 'waiting' as const, sent_at: '2026-11-01T10:00:00.000Z', result_at: null, amount: null }));
  for (const f of files) {
    const file = ProgramFile.parse(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    const row = { id: file.id, file } as never;
    const pre = prefill(row, facts, null);
    const one: ReadyProgram = {
      program_id: file.id, title: file.title, money: moneyOf(file), max_award_usd: file.max_award_usd ?? null, category: 'grant', closes_at: null, closes_in: null,
      long_shot: null, in_person: file.in_person, submission_url: file.submission_url, fields: pre.fields, filled: pre.filled, from_record: 0, repo_required: pre.repo_required,
      need_you: pre.need_you, facts_from_repo: pre.facts_from_repo, total: pre.total, needs: [...file.setup, ...pre.need_you], setup: file.setup, rules: [], n: 0,
    };
    for (const linked of [false, true]) {
      const r = {
        since: { from: '2026-11-01T00:00:00.000Z', new: [{ program_id: 'x', title: 'X' }], changed: [], closing: [] }, ready: [one], gaps: ['P', 'Q', 'R', 'S'].map(gap),
        ledger: { applied: 7, asked_usd: 0, won: 0, won_usd: 0, won_other: [], won_no_amount: 0, pending: 7, rejected: 0, skipped: 0, closing_soon: [], results_soon: [{ program_id: 'r', title: 'R Grant', results_at: '' }] },
        applications: apps, ask_outcome: [{ program_id: 'q', title: 'Q Grant', due_at: '2026-11-01T00:00:00.000Z' }], as_reported: false, linked,
        record_missing: linked ? ['your email'] : [], blockers: [], evidence_summary: linked ? { tier: 'live', line: 'Your project is live, with no verified usage yet.' } : null,
        applied_overnight: [], released: [{ program_id: 'z', title: 'Z Grant', started_at: '2026-11-02T10:00:00.000Z' }], auto_apply: false,
        repo_notes: ['private' as const], linked_notice: linked ? 'This agent is now linked to GitHub account ada. Unlink any time at earnkit.com/me.' : null,
        ...(linked ? {} : { sign_in: 'https://earnkit.test/link/abc' }),
      };
      const shown = { ...r, ...numbered(r.ready, r.gaps, attendRuleGap) };
      const { text, hidden } = replyParts(shown as never, false, NOW);
      const lines = text.split('\n');
      assert.ok(lines.length <= 10, `${f} ${linked}: ${lines.length}\n${text}`);
      assert.equal(sayLines(text).length, 1, `${f} ${linked}\n${text}`);
      assert.match(lines.at(-1)!, /(^|[.?!] )[Ss]ay\b/, `${f} ${linked}\n${text}`);
      for (const l of lines) assert.match(l, /[.:?]$/, `${f}: ${l}`);
      assert.doesNotMatch(text, /—|\b(score|rank|grade|points|coin|token|streak)s?\b/i);
      assert.ok(hidden.length > 0, f);
    }
  }
});

test('Review Focus 21: the persona finds read at most 10 lines with one Say, last; filter.all is names and money only', async () => {
  const cases: [Parameters<typeof mcpCall>[0], Record<string, unknown>][] = [
    [ctx(await installation()), PROJECT], [ctx(await installation()), PROJECT_A], [ctx(await installation()), PROJECT_B], [ctx(await installation()), PROJECT_C],
    [await dashCtx(), VR], [await dashCtx(), { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' }],
  ];
  for (const [c, project] of cases) {
    const r = await mcpCall(c, 'find', { project });
    const show = r.reply!.show_to_builder as string;
    const lines = show.split('\n');
    assert.ok(lines.length <= 10, show);
    assert.ok(sayLines(show).length <= 1, show);
    if (sayLines(show).length === 1) assert.equal(sayLines(show)[0], lines.at(-1), show);
    const all = await mcpCall(c, 'find', { project, filter: { all: true } });
    const listed = (all.reply!.show_to_builder as string).split('\n').filter((l) => /^\d+\. /.test(l));
    assert.ok(listed.length > 0);
    for (const l of listed) assert.match(l, /^\d+\. [^\n]+, [^\n]+\.$/, l);
    for (const l of listed) assert.doesNotMatch(l, /You give:|First:|Their rule|Long odds|Needs /, l);
  }
});

test('L29-1, L29-2: the applications by name on every find with applications, project or not; the JSON lists them all', async () => {
  const id = await installation();
  const { track } = await import('./track');
  await upsertProgram((await import('./fixtures/program')).programFixture({ id: 'l291-a', title: 'L291 Builder Grant' }), 'file', NOW);
  await upsertProgram((await import('./fixtures/program')).programFixture({ id: 'l291-b', title: 'L291 Starter Grant' }), 'file', NOW);
  const t = { installationId: id, builderId: null, now: NOW };
  await track(t, { program_id: 'l291-a', status: 'applied', submitted_by: 'builder' });
  await track({ ...t, now: new Date(NOW.getTime() + H) }, { program_id: 'l291-b', status: 'won', amount_usd: 5000 });
  const f = await mcpCall(ctx(id, new Date(NOW.getTime() + 2 * H)), 'find', { project: PROJECT });
  const line = (f.reply!.show_to_builder as string).split('\n').find((l) => l.startsWith('Your applications:'));
  // Fix round 1 (N4): a win recorded from outside EarnKit has no send date; the line says when it was recorded.
  assert.equal(line, 'Your applications: L291 Starter Grant (won $5,000), L291 Builder Grant (sent Nov 4, waiting).');
  const apps = f.reply!.applications as { program_id: string; title: string; status: string; sent_at: string; result_at: string | null; amount: string | null }[];
  assert.deepEqual(apps.map((a) => [a.program_id, a.status, a.amount]), [['l291-b', 'won', '$5,000'], ['l291-a', 'waiting', null]]);
  assert.deepEqual(apps.map((a) => a.sent_at === null), [true, false]);
  // No project, and a name alone: the line, then the one ask for the project.
  for (const args of [{}, { project: { name: 'Timer' } }]) {
    const o = await mcpCall(ctx(id, new Date(NOW.getTime() + 3 * H)), 'find', args);
    const show = (o.reply!.show_to_builder as string).split('\n');
    assert.equal(show[0], line, JSON.stringify(args));
    assert.match(show[1], /^Tell me (which project and I match it|what Timer does in a line, or its repo link, and I match it)\.$/);
    assert.equal((o.reply!.applications as unknown[]).length, 2);
  }
});

test('L29-7, L29-13, L29-14: ready is what the agent may send; in person and you send apart; unread arguments named', async () => withInPerson(async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true, category: 'Grant' } });
  const ready = r.reply!.ready as { in_person: boolean; program_id: string }[];
  const inPerson = r.reply!.in_person as { in_person: boolean }[];
  assert.ok(ready.every((p) => !p.in_person));
  assert.ok(inPerson.every((p) => p.in_person));
  const blockers = r.reply!.blockers as { program_id: string; needs_click: boolean }[];
  assert.ok(ready.every((p) => !blockers.some((b) => b.program_id === p.program_id && b.needs_click)));
  assert.ok((r.reply!.you_send as { program_id: string }[]).every((p) => blockers.some((b) => b.program_id === p.program_id && b.needs_click)));
  const all = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
  assert.ok((all.reply!.in_person as unknown[]).length > 0);
  const odd = await mcpCall(ctx(await installation()), 'find', { repo_url: PROJECT.repo_url, filter: { category: 'grants' } });
  assert.match(odd.reply!.agent_note as string, /(^|\n)category "grants" was not read: use grant, hackathon, investment or bounty\. repo_url belongs inside project\.$/m);
}));

// v6.1.16 Task 12 (L26-4, Review Focus 17): every find reply under its cap, over the whole catalog.
const FULL_PROJECT = {
  ...PROJECT, description: 'Grants for builders: an agent that finds the grants your repo fits and fills the forms.', demo_url: 'https://earnkit.com/demo', users: true, first_commit_at: '2025-01-01',
  chains: [{ chain: 'base', mainnet: true, contract: '0x1111111111111111111111111111111111111111' }, { chain: 'ethereum', mainnet: true, contract: '0x2222222222222222222222222222222222222222' }, { chain: 'solana', mainnet: true }],
};
const LANE_26_OVER = ['uniswap-foundation-security-fund', 'ethereum-security-subsidy-program', 'github-secure-open-source-fund', 'arbitrum-security-program', 'solana-incubator-cohort-6', 'sovereign-tech-fund', 'nlnet-open-call', 'z-fellows'];
test('Review Focus 17 (L26-4): a one-program find is under 20 KB for each of the 52 programs, the full list under 30 KB, unlinked and linked', async () => {
  const { readdirSync } = await import('node:fs');
  const { FIND_CAP_ALL, FIND_CAP_ONE } = await import('./find');
  assert.deepEqual([FIND_CAP_ONE, FIND_CAP_ALL], [20_480, 30_720]);
  const ids = readdirSync(new URL('../../../../programs/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  assert.equal(ids.length, 52);
  for (const id of LANE_26_OVER) assert.ok(ids.includes(id), id);
  const linked = await linkedWith(OWNER_RECORD, ['projects.earnkit.answers.problem']);
  for (const c of [ctx(await installation()), { ...ctx(linked.id), builderId: linked.builderId, evidence: LIVE }]) {
    for (const id of ids) {
      const r = await mcpCall(c, 'find', { program_id: id, project: FULL_PROJECT });
      assert.equal(r.isError, false, `${id}: ${r.text.slice(0, 200)}`);
      assert.ok(Buffer.byteLength(r.text) < 20_480, `${id}: ${Buffer.byteLength(r.text)}`);
      assert.ok((r.reply!.show_to_builder as string).length > 0, id);
      // Fix round 1 (M1): every select keeps its options under the cap (uniswap-foundation-security-fund and
      // ethereum-security-subsidy-program lost them before).
      const file = (await getProgram(id))!.file;
      const fields = r.reply!.fields as { key: string; options?: string[] }[];
      for (const req of file.submission_requirements.filter((q) => q.options && q.options.length > 0))
        assert.deepEqual(fields.find((f) => f.key === req.key)?.options, req.options, `${id} ${req.key} ${c.builderId === null ? 'unlinked' : 'linked'}`);
    }
    const all = await mcpCall(c, 'find', { project: FULL_PROJECT, filter: { all: true } });
    assert.ok(Buffer.byteLength(all.text) < 30_720, `${Buffer.byteLength(all.text)}`);
    // Fix round 1 (M2): the full list's fields carry no style, and its note says where the style is.
    if (c.builderId !== null) {
      assert.ok((all.reply!.agent_note as string).includes(FULL_LIST_STYLE_NOTE), all.reply!.agent_note as string);
      assert.doesNotMatch(all.reply!.agent_note as string, /style contract travels on each field/);
    }
    // Never a listed program's money or gap: every listed program keeps both.
    for (const g of all.reply!.gaps as GapProgram[]) assert.ok(g.money && g.gap.what, g.program_id);
    for (const p of allReady(all.reply!) as ReadyProgram[]) assert.ok(p.money, p.program_id);
  }
});

test('L35-9 (v6.1.17 Task 5, Task 1 re-review): a default reply over the 30 KB cap keeps the ready programs\' fields and empties the other lists\' first', async () => {
  const { findReplyCap, MORE_THAN_FITS } = await import('./find');
  const fields = (k: number, tag: string) => Array.from({ length: k }, (_, i) => ({ key: `${tag}${i}`, label: `F ${i}`, value: 'x'.repeat(4_000), from: 'agent', sources: ['s'] }));
  const row = (n: number, id: string, k: number) => ({ n, program_id: id, money: '$5,000', fields: fields(k, id) });
  // The ready program has the highest number, so a cap by number alone would empty it first.
  const reply = {
    show_to_builder: 'Say yes and I apply to all 1 ready.', agent_note: 'note',
    ready: [row(9, 'r9', 2)],
    in_person: [row(3, 'p3', 6)],
    gaps: [{ ...row(2, 'g2', 6), gap: { kind: 'rule', item: 'rule', what: 'a rule', effort: 'low', agent_can: false, docs: 'd'.repeat(500) }, also: [{ kind: 'users' }], rules: ['r'], setup: ['s'], needs: ['n'] }],
  };
  const cap = 30_720;
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) > cap);
  const out = findReplyCap(reply as never, cap, true) as unknown as typeof reply;
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= cap);
  assert.deepEqual(out.ready[0].fields, reply.ready[0].fields);
  assert.equal(out.in_person[0].fields.length, 0);
  assert.equal(out.gaps[0].fields.length, 0);
  assert.equal(out.gaps[0].money, '$5,000');
  assert.ok(out.agent_note.endsWith(MORE_THAN_FITS));
  // Without keepReady (filter.all), the highest number goes first: the ready program's fields.
  const byNumber = findReplyCap(reply as never, cap) as unknown as typeof reply;
  assert.equal(byNumber.ready[0].fields.length, 0);
});

test('L26-4: a one-program reply carries two guide rules and points at the guide page; one past its cap names the page', async () => {
  const { findReplyCap, FIELDS_CUT_NOTE, MORE_THAN_FITS } = await import('./find');
  const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'base-builder-grants', project: PROJECT });
  assert.equal((r.reply!.guide as { rules: string[] }).rules.length, 2);
  assert.match(r.reply!.agent_note as string, /\nThe rest of the rules are on https:\/\/earnkit\.com\/programs\/base-builder-grants\.$/);
  const capped = findReplyCap(r.reply as never, 2_000) as unknown as { agent_note: string; fields: { sources?: string[] }[] };
  assert.ok(capped.agent_note.endsWith(FIELDS_CUT_NOTE('base-builder-grants')));
  assert.ok(capped.fields.every((f) => f.sources === undefined));
  const list = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
  const cut = findReplyCap(list.reply as never, 4_000) as unknown as { agent_note: string; gaps: GapProgram[] };
  assert.ok(cut.agent_note.endsWith(MORE_THAN_FITS));
  assert.equal(cut.gaps.length, (list.reply!.gaps as unknown[]).length);
});

test('L28-7 (v6.1.16 Task 14): two record projects on one repo and no project_id: asked which, nothing filled from either; with the id, its own value', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'l28-links', title: 'Links Grant', submission_requirements: [
    { key: 'live', label: 'Live link', type: 'url', required: true, from: 'project', kind: 'links', project_field: 'live_url', todo: 'the live link' } as never] }), 'file', NOW);
  const { id, builderId } = await linkedWith({ projects: [
    { id: 'mono-web', name: 'Mono Web', repo_url: `https://github.com/${rec.repo}`, live_url: 'https://web.example.com' },
    { id: 'mono-api', name: 'Mono API', repo_url: `https://github.com/${rec.repo}`, live_url: 'https://api.example.com' }] });
  const c = { ...ctx(id), builderId, evidence: LIVE };
  const r = await mcpCall(c, 'find', { program_id: 'l28-links', project: { name: 'Mono API', repo_url: `https://github.com/${rec.repo}` } });
  assert.equal(r.reply!.show_to_builder, 'Which project: "Mono Web" or "Mono API"?');
  assert.match(r.reply!.agent_note as string, /^Two record projects share this repo, so nothing was filled from either\./);
  const live = (r.reply!.fields as { key: string; value: string | null; from: string }[]).find((f) => f.key === 'live')!;
  assert.notEqual(live.value, 'https://web.example.com');
  assert.notEqual(live.from, 'record');
  const own = await mcpCall(c, 'find', { program_id: 'l28-links', project_id: 'mono-api', project: { name: 'Mono API', repo_url: `https://github.com/${rec.repo}` } });
  assert.equal((own.reply!.fields as { key: string; value: string | null }[]).find((f) => f.key === 'live')!.value, 'https://api.example.com');
});

test('L28-3 (v6.1.16 Task 14): a signed-in builder whose login a read shows is no committer hears it first; with no evidence nothing is said', async () => {
  const { id, builderId } = await linkedWith({}, [], 'not-the-owner');
  const c = { ...ctx(id), builderId, evidence: LIVE };
  const quiet = await mcpCall(c, 'find', { project: PROJECT });
  assert.doesNotMatch(quiet.reply!.show_to_builder as string, /not yours/);
  await sql()`UPDATE repo_cache SET facts = jsonb_set(facts, '{contributors}', '["someone"]'::jsonb) WHERE repo = ${rec.repo.toLowerCase()}`;
  const told = await mcpCall(c, 'find', { project: PROJECT });
  assert.equal((told.reply!.show_to_builder as string).split('\n')[0], 'This repo is not yours; I apply only with repos you commit to.');
  assert.match(told.reply!.agent_note as string, /The signed-in GitHub account is not the repo owner/);
});

test('L1i-5 (v6.1.16.1): a program keeps its number across the default and the full list of one project; another project starts fresh', async () => {
  const SOL = { name: 'Solflare Tips', description: 'Tipping for creators on Solana', chains: [{ chain: 'solana', mainnet: true }] };
  const id = await installation();
  const d = await mcpCall(ctx(id), 'find', { project: SOL });
  const dn = (d.reply!.gaps as G[]).find((g) => g.program_id === 'solana-foundation-grants')!.n;
  assert.match(d.reply!.show_to_builder as string, new RegExp(`^${dn}\\. Solana Foundation Grants, `, 'm'));
  // The default view's rows read 1, 2, 3 as shown, with no gaps, and the JSON numbers are those.
  const shown = (d.reply!.show_to_builder as string).split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split('.')[0]));
  assert.deepEqual(shown, shown.map((_, i) => i + 1));
  const full = await mcpCall(ctx(id), 'find', { project: SOL, filter: { all: true } });
  const fn = (full.reply!.gaps as G[]).find((g) => g.program_id === 'solana-foundation-grants')!.n;
  assert.equal(fn, dn);
  assert.match(full.reply!.show_to_builder as string, new RegExp(`^${fn}\\. Solana Foundation Grants, `, 'm'));
  assert.doesNotMatch(full.reply!.show_to_builder as string, /Say "yes/);
  // Every program the default left out is in the full list.
  const listed = new Set(ids(full.reply!.gaps).concat(ids(allReady(full.reply!))));
  for (const g of [...(d.reply!.gaps as G[]), ...(allReady(d.reply!) as G[])]) assert.ok(listed.has(g.program_id), g.program_id);
  // The default again: the same numbers; a different project on the same installation numbers from 1.
  const rowsOf = (x: { reply: Record<string, unknown> | null }) => (x.reply!.show_to_builder as string).split('\n').filter((l) => /^\d+\. /.test(l)).join('\n');
  const again = await mcpCall(ctx(id), 'find', { project: SOL });
  assert.equal(rowsOf(again), rowsOf(d));
  const other = await mcpCall(ctx(id), 'find', { project: PROJECT_B });
  const fresh = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_B });
  assert.equal(rowsOf(other), rowsOf(fresh));
  assert.deepEqual((other.reply!.gaps as G[]).map((g) => g.n), (fresh.reply!.gaps as G[]).map((g) => g.n));
});

test('L1i-5 (v6.1.16.1): stableNumbers keeps the last list\'s numbers and numbers new programs on after them', async () => {
  const { stableNumbers } = await import('./installations');
  assert.deepEqual([...stableNumbers([], ['a', 'b'])], [['a', 1], ['b', 2]]);
  assert.deepEqual([...stableNumbers(['a', '', 'c'], ['c', 'd', 'a'])], [['a', 1], ['c', 3], ['d', 4]]);
});

// ---- v6.1.16.1 Task 2 ----

test('L35-6 (v6.1.16.1 Task 2): find\'s program_id takes a list reference as the last list\'s number; any other falls to the name lookup', async () => {
  const { markList } = await import('./installations');
  const { programFixture } = await import('./fixtures/program');
  for (const n of [1, 2, 3]) await upsertProgram(programFixture({ id: `l35-fnum-${n}`, title: `L35 FNum ${n}` }), 'file', NOW);
  const id = await installation();
  await markList(id, 'h', NOW, ['l35-fnum-1', 'l35-fnum-2', 'l35-fnum-3']);
  for (const ref of ['#3', '3.', 'No. 3', 'three']) {
    const r = await mcpCall(ctx(id), 'find', { program_id: ref });
    assert.match(r.reply!.show_to_builder as string, /^L35 FNum 3\b/, ref);
  }
  const none = await mcpCall(ctx(id), 'find', { program_id: '#99' });
  assert.equal(none.reply!.show_to_builder, 'I do not know a program called "#99". Say its full name.');
});

test('Fix round 1 (I3, v6.1.16.1): a one-program lookup for another project leaves the last project\'s numbers out of the next list', async () => {
  const saber = replayFetch('saber-distributor');
  const id = await installation();
  const orca = { name: 'Orca Whirlpools', description: 'Concentrated liquidity DEX on Solana', repo_url: `https://github.com/${saber.repo}`, live_url: 'https://www.orca.so', users: true, chains: [{ chain: 'solana', mainnet: true }] };
  const oc = { installationId: id, builderId: null, now: NOW, gh: saber.fetch };
  await mcpCall(oc, 'find', { project: orca });
  await mcpCall(oc, 'find', { project: orca, filter: { all: true } });
  const rc = { installationId: id, builderId: null, now: NOW, gh: dash.fetch };
  await mcpCall(rc, 'find', { program_id: 'floss', project: RIPGREP });
  const fresh = { installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch };
  for (const args of [{ project: RIPGREP, filter: { all: true } }, { project: RIPGREP }]) {
    const a = await mcpCall(rc, 'find', args);
    const b = await mcpCall(fresh, 'find', args);
    const nums = (x: typeof a) => [...(x.reply!.gaps as G[]), ...(allReady(x.reply!) as G[])].map((g) => `${g.n} ${g.program_id}`).sort();
    assert.deepEqual(nums(a), nums(b), JSON.stringify(args));
  }
});

test('Fix round 1 (I4, v6.1.16.1): the numbers the builder sees are the JSON\'s and track\'s: after a category find, "3" is the program shown as 3', async () => {
  const c = await dashCtx();
  await mcpCall(c, 'find', { project: RIPGREP, filter: { category: 'grant' } });
  const d = await mcpCall(c, 'find', { project: RIPGREP });
  const show = d.reply!.show_to_builder as string;
  const three = show.split('\n').find((l) => l.startsWith('3. '))!;
  assert.ok(three, show);
  const items = [...(d.reply!.gaps as G[]), ...(allReady(d.reply!) as G[])];
  // Every row of the text carries its JSON n.
  for (const l of show.split('\n').filter((x) => /^\d+\. /.test(x))) {
    const n = Number(l.split('.')[0]);
    const item = items.find((x) => x.n === n) as (G & { title?: string }) | undefined;
    assert.ok(item && l.startsWith(`${n}. ${(item as unknown as { title: string }).title}, `), `${l} vs ${JSON.stringify(item?.program_id)}`);
  }
  const title = (items.find((x) => x.n === 3) as unknown as { title: string }).title;
  assert.ok(three.startsWith(`3. ${title}, `), three);
  const t = await mcpCall(c, 'track', { program_id: '3', status: 'skipped', project: RIPGREP });
  assert.equal(t.isError, false, t.text);
  assert.ok((t.reply!.show_to_builder as string).startsWith(`Skipped ${title} for good.`), `${t.reply!.show_to_builder} / ${three}`);
});

test('L35-9 (v6.1.17, lane 35 C.5 and C.6, Review Focus 3): after one claim and one hold, the default\'s "all n ready" is the full list\'s Ready count', async () => {
  const { programFixture } = await import('./fixtures/program');
  const { claim } = await import('../v6/claims');
  const { saveInstallation, connectInstallation } = await import('./installations');
  const { linkInstallation } = await import('../v6/builders');
  const ids8 = Array.from({ length: 8 }, (_, k) => `l179-r${k + 1}`);
  for (const [k, id] of ids8.entries()) await upsertProgram(programFixture({ id, title: `L179 Ready ${k + 1}` }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith(OWNER_RECORD);
    const token = 'l179-holder-' + Math.random();
    await saveInstallation(token, 'Cursor');
    const other = (await connectInstallation(token))!.id;
    await linkInstallation(other, builderId, NOW);
    const c = { ...ctx(id), builderId, evidence: LIVE };
    await claim(`b:${builderId}`, 'l179-r1', 'earnkit', other, new Date(NOW.getTime() - 60_000));
    assert.equal((await mcpCall(c, 'track', { program_id: 'l179-r2', status: 'held', project: PROJECT })).isError, false);
    const d = await mcpCall(c, 'find', { project: PROJECT });
    const show = d.reply!.show_to_builder as string;
    const said = /I apply to all (\d+) ready\b/.exec(show);
    assert.ok(said, show);
    assert.doesNotMatch(show, /not shown/);
    const head = Number(/^Ready to apply \((\d+)\):$/m.exec(show)![1]);
    assert.equal(head, Number(said[1]), show);
    assert.ok(show.split('\n').at(-2)!.startsWith('And '), show);
    // Fix round 1 (I2): the JSON's ready list holds every free ready program the yes covers, each with its fields.
    const listed = (d.reply!.ready as { program_id: string; fields: unknown[]; claimed_since?: string; held?: boolean }[]).filter((p) => !p.claimed_since && !p.held);
    assert.equal(listed.length, Number(said[1]), JSON.stringify(listed.map((p) => p.program_id)));
    assert.ok(ids8.slice(2).every((x) => listed.some((p) => p.program_id === x && p.fields.length > 0)));
    assert.doesNotMatch(d.reply!.agent_note as string, /past this list/);
    const full = (await mcpCall(c, 'find', { project: PROJECT, filter: { all: true } })).reply!.show_to_builder as string;
    assert.equal(Number(/^Ready to apply \((\d+)\):$/m.exec(full)![1]), Number(said[1]), full);
    assert.match(full, /^Being handled by your other agent \(1\):$/m);
    assert.match(full, /^On hold until you say go \(1\):$/m);
    assert.ok(full.split('\n').at(-1)!.includes(`I apply to all ${said[1]} ready`), full);
    assert.doesNotMatch(full, /not shown/);
  } finally {
    await sql()`DELETE FROM programs WHERE id = ANY(${ids8})`;
  }
});

test('L1j-5 (v6.1.17): an unknown key inside project is a problems line, never an input error', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: { ...PROJECT, bogus: 1 } });
  assert.equal(r.isError, false, r.text);
  assert.ok((r.reply!.agent_note as string).split('\n').includes('project.bogus was not read.'), r.reply!.agent_note as string);
  assert.doesNotMatch(r.reply!.agent_note as string, /Some arguments were not read/);
  // v6.1.16 Task 15 N6: beside an item that does not say it, only that item keeps the prefix.
  const two = await mcpCall(ctx(await installation()), 'find', { project: { ...PROJECT, bogus: 1 }, filter: { all: 'maybe' } });
  assert.match(two.reply!.agent_note as string, /project\.bogus was not read\./);
});

test('v6.1.17 fix round 1 (I3): with no project, the ask is last and the sign-in sentence before it (persona 28 and {})', async () => {
  const link = 'https://earnkit.com/link/p28';
  for (const [args, ask] of [
    [{ project: { name: 'Lumen' } }, 'Tell me what Lumen does in a line, or its repo link, and I match it.'],
    [{ project: { name: 'Lumen' }, filter: { all: true } }, 'Tell me what Lumen does in a line, or its repo link, and I match it.'],
    [{}, 'Tell me which project and I match it.'],
    [{ filter: { category: 'loan' } }, 'Tell me which project and I match it.'],
  ] as const) {
    const r = await mcpCall({ ...ctx(await installation()), linkUrl: async () => link }, 'find', args);
    const show = r.reply!.show_to_builder as string;
    assert.deepEqual(show.split('\n').slice(-2), [`Sign in once at ${link} so I remember you across agents.`, ask], JSON.stringify(args));
  }
});

test('v6.1.17 fix round 1 (M1, N1): an in-person lookup ends on its action with no project, and a held line sits before it', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'alliance' });
  assert.equal((r.reply!.show_to_builder as string).split('\n').at(-1), 'You apply in person; the guide has the steps.');
  const { claim } = await import('../v6/claims');
  const { saveInstallation, connectInstallation } = await import('./installations');
  const { linkInstallation } = await import('../v6/builders');
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const token = 'n1-holder-' + Math.random();
  await saveInstallation(token, 'Cursor');
  const other = (await connectInstallation(token))!.id;
  await linkInstallation(other, builderId, NOW);
  await claim(`b:${builderId}`, 'alliance-all19', 'earnkit', other, new Date(NOW.getTime() - 60_000));
  const held = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { program_id: 'alliance-all19', project: PROJECT });
  assert.deepEqual((held.reply!.show_to_builder as string).split('\n').slice(-2), ['Another agent of yours started this one on Nov 4.', 'You apply in person; the guide has the steps.']);
});

test('v6.1.16 Task 15 N2 (v6.1.17): find never reads as, am or mm as initials; YC and yc keep Y Combinator', async () => {
  const id = await installation();
  for (const w of ['as', 'am', 'mm', 'AS', 'MM']) {
    const r = await mcpCall(ctx(id), 'find', { program_id: w });
    assert.equal(r.isError, true, w);
    assert.equal(r.reply!.show_to_builder, `I do not know a program called "${w}". Say its full name.`, w);
  }
  for (const w of ['YC', 'yc']) {
    const r = await mcpCall(ctx(id), 'find', { program_id: w });
    assert.equal(r.isError, false, w);
    assert.match(r.reply!.show_to_builder as string, /^Y Combinator/, w);
  }
});

// L18-1 (v6.1.18): the rows the rank cap left out are counted on the builder's more line and in more_count.
test('L18-1: a no-repo project with a live link counts every row the default view leaves out', async () => {
  const id = await installation();
  const project = { name: 'Ledgerly', description: 'Bookkeeping for small shops.', live_url: 'https://ledgerly.example.com', users: true };
  const def = await mcpCall(ctx(id), 'find', { project });
  assert.equal(def.isError, false, def.text);
  const show = def.reply!.show_to_builder as string;
  const all = await mcpCall(ctx(id), 'find', { project, filter: { all: true } });
  const fullRows = (allReady(all.reply!) as unknown[]).length + (all.reply!.gaps as unknown[]).length;
  const shownRows = show.split('\n').filter((l) => /^\d+\. /.test(l)).length;
  const n = def.reply!.more_count as number;
  assert.ok(n > 0, show);
  assert.equal(n, fullRows - shownRows, show);
  assert.match(show, new RegExp(`^And ${n} more in the full list(\\.|; closing this week: .+\\.)$`, 'm'));
  assert.ok(show.split('\n').length <= 10, show);
  assert.equal(all.reply!.more_count, 0);
  assert.ok((def.reply!.agent_note as string).includes(`The full list holds ${n} more;`));
  // The owner's live day (Nov 12): two of the left-out programs close this week, named in closing order with the words
  // their list lines use.
  // The count is read against the full list (other test files add programs to the shared catalog).
  const day = new Date(NOW.getTime() + 8 * 86_400_000);
  const nov12 = await mcpCall(ctx(await installation(), day), 'find', { project });
  const lines = (nov12.reply!.show_to_builder as string).split('\n');
  const nov12All = await mcpCall(ctx(await installation(), day), 'find', { project, filter: { all: true } });
  const left = (allReady(nov12All.reply!) as unknown[]).length + (nov12All.reply!.gaps as unknown[]).length - lines.filter((l) => /^\d+\. /.test(l)).length;
  assert.equal(nov12.reply!.more_count, left);
  assert.equal(lines.at(-2), `And ${left} more in the full list; closing this week: PayPal AI Hackathon: Build What's Next with PayPal and AI (today) and UGREEN Hackathon 2026 on AI NAS (3 days).`, lines.join('\n'));
  assert.ok(lines.length <= 10);
});

test('L18-2 (v6.1.18): the PayPal one-program look for a project with no repo names code in a public repo as the step, never as a rule', async () => {
  const project = { name: 'Ledgerly', description: 'Invoices that chase themselves, with PayPal checkout and an AI agent.', live_url: 'https://ledgerly-demo.vercel.app/', users: true };
  const r = await mcpCall(ctx(await installation()), 'find', { program_id: 'paypal-ai-hackathon', project });
  assert.equal(r.isError, false, r.text);
  const lines = (r.reply!.show_to_builder as string).split('\n');
  assert.equal(lines[0], "PayPal AI Hackathon: Build What's Next with PayPal and AI, $67,500 in prizes, closes in 8 days: code in a public repo and a demo video. First: join the hackathon with a Devpost account; sign up for a PayPal Developer account (sandbox). Their rule: meaningfully uses a PayPal API, SDK or developer capability together with an AI model, tool or platform.", lines.join('\n'));
  assert.equal(lines.at(-1), 'Tell me when the code is in a public repo and I look again.', lines.join('\n'));
});
