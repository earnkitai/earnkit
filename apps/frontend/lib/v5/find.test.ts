import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { getProgram, upsertProgram } from './programs';
import { replayFetch } from './fixtures/github';
import { mcpCall } from './fixtures/mcp-call';
import { lastGaps } from './installations';
import { shownReadyOf } from './find';
import { REPO_STEP_NOTE } from './reply';

after(() => sql().end());
beforeEach(() => sql()`DELETE FROM repo_cache`);

const NOW = new Date('2026-11-04T12:00:00Z');
const H = 3_600_000;
const CLOSINGS = [
  // v6.1.8 (1a): one action. The gap lines carry their own "do n" and "yes n".
  /Say yes and I apply to all \d+\. Or say the numbers to skip\.$/,
  /Say yes and I apply\.$/,
  /Say yes and I draft all \d+ for you to send\. Or say the numbers to skip\.$/,
  /Say yes and I draft it for you to send\.$/,
  /Nothing is ready yet\.( Say "yes \d+" if that rule fits you\.)?$/,
  // O2 (v6.1.10): in-person programs listed and nothing remote ready.
  /Nothing remote is ready yet\. Say yes and I start the in-person applications\.$/,
  /Nothing fits yet\. Ask again any time and I show what is new\.$/,
  /Applying tonight to [^\n]+\. Say stop to hold any\.$/,
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
const NOTICE_TAIL = '( This agent is now linked to GitHub account \\S+\\. Unlink any time at earnkit\\.com/me\\.)?';
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
  const shownReady = reply.ready as { in_person: boolean }[];
  assert.ok(shownReady.filter((p) => !p.in_person).length > 0 && shownReady.filter((p) => !p.in_person).length <= 5);
  assert.ok(shownReady.filter((p) => p.in_person).length <= 2);
  assert.ok((reply.gaps as unknown[]).length <= 3);
  assert.equal(reply.as_reported, false);
  const [row] = await sql()`SELECT last_find_at FROM installations WHERE id = ${id}`;
  assert.equal((row.last_find_at as Date).toISOString(), NOW.toISOString());
  const first = (reply.ready as { fields: { from: string }[]; filled: number }[])[0];
  assert.ok(first.fields.length > 0);
  assert.doesNotMatch(show, /—|\b(coin|points|score|rank|streak|token)s?\b/i);
  // #10 (v6.1.15): the reply is shown as given, never retold.
  const note = reply.agent_note as string;
  assert.ok(note.startsWith("Show find's reply as given; shorten if you must, keep money first and the last action. No emojis, no em dashes, no invented facts."), note);
  assert.ok(!JSON.stringify(reply).includes('in your own words'));
  assert.equal(
    show,
    [
      'Ready to apply (1):',
      '1. Arbitrum Mentorship Program: Cohort 2, $100K in prizes, closes in 32 days. Long odds: few prizes for many entries. Drafted: 19 of 22 answers. Needs your top 3 successes, funding raised before and current TVL range.',
      '',
      // L1c-3 (v6.1.10): the project's own chain (Base) first, rule-free then rule-bearing; then the chain-agnostic
      // FLOSS/fund; the Arc deploy (another chain) after them, past the cap.
      'One step away (3):',
      '2. Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app and tell me if real people use it.',
      '3. Base Ecosystem Fund, pre-seed and seed investment. Their rule: a pre-seed or seed stage startup that chooses Base as its home.',
      '4. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.',
      '',
      'In person (2):',
      '5. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and the batch you want.',
      "6. Alliance ALL19, $400K at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      '',
      'Say yes and I apply.',
    ].join('\n'),
  );
  // Only what nobody but the builder can give: no contacts or team. Whole words, so a program named Team1 is not "team".
  for (const p of reply.ready as { needs: string[]; setup: string[] }[])
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
  const ready = r.reply!.ready as { title: string; in_person: boolean }[];
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
  const ready = reply.ready as { program_id: string; title: string; n: number; in_person: boolean }[];
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
  const block = (head: string) => show.split('\n\n').find((b) => b.startsWith(head)) ?? '';
  assert.ok(block('In person').includes(`${ruled[0].n}. ${ruled[0].title}, `), show);
  assert.doesNotMatch(block('One step away'), /Antler/);
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
    assert.match(r.reply!.show_to_builder as string, /^Since /);
  } finally {
    // Later pins quote Alliance's real deadline.
    await upsertProgram(p, 'file', new Date(NOW.getTime() + 3 * H));
  }
});

test('a skipped program leaves ready and gaps', async () => {
  const id = await installation();
  const before = await mcpCall(ctx(id), 'find', { project: PROJECT });
  const top = ids(before.reply!.ready)[0];
  const t = await mcpCall(ctx(id), 'track', { program_id: top, status: 'skipped' });
  assert.equal(t.isError, false, t.text);
  const after = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.ok(!ids(after.reply!.ready).includes(top));
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
  // In person and ready: the in-person line of the list without its number, and no action (attending is in the line).
  assert.equal(reply.show_to_builder, "Alliance ALL19, $400K at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.");
  const bare = await mcpCall(ctx(id), 'find', { program_id: 'alliance-all19' });
  assert.ok((bare.reply!.fields as { value: unknown }[]).every((f) => f.value === null));
  const none = await mcpCall(ctx(id), 'find', { program_id: 'no-such-program' });
  assert.equal(none.isError, false);
  assert.ok((none.reply!.show_to_builder as string).length > 0);
});

test('find with program_id for YC: in person, the line says what attending takes and asks nothing more (v6.1.8)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'y-combinator', project: PROJECT });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.show_to_builder, 'Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and the batch you want.');
});

test('find with program_id and no project: the money, the rules list, no link and no draft offer; the agent is told to pass the project (v6.1.8, 1b)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { program_id: 'base-builder-grants' });
  assert.equal(r.isError, false, r.text);
  const guide = r.reply!.guide as { title: string; rules: string[]; eligibility: string[] };
  assert.equal(guide.title, 'Base Builder Grant Program');
  assert.ok(guide.rules.length > 0 && guide.eligibility.includes('a live product'));
  assert.equal(r.reply!.show_to_builder, ['Base Builder Grant Program, up to $5,000, rolling.', 'Rules:', ...guide.rules.map((x) => `- ${x}`)].join('\n'));
  assert.equal(r.reply!.agent_note, 'Call find with the project for whether you fit.');
  const none = await mcpCall(ctx(id), 'find', { program_id: 'no-such-program' });
  assert.equal(none.reply!.guide, null);
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
  const rules = (asked.reply!.guide as { rules: string[] }).rules;
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
      'Solana Foundation Grants, milestone grants. Their rule: a public good, meaning a significant open source contribution to the Solana ecosystem or a free community offering.',
      'Say yes if that is you and I draft it.',
    ].join('\n'),
  );
  const note = (r.reply!.agent_note as string).split('\n');
  assert.ok(note.some((l) => l.startsWith('A "Their rule" gap is a program rule EarnKit cannot check.')));
  assert.ok(note.includes("The program's rules are in guide.rules; show them only when the builder asks, or call again with ask 'rules'."));
});

test('C1 (v6.1.8 final fix, B20b): FLOSS/fund for a chainless CLI asks the users question, never the sign-in bar; a yes makes it ready', async () => {
  const CLI = { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', live_url: 'https://ripgrep.dev' };
  const ask = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  assert.equal(ask.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.', 'Say yes if they do and I draft it.'].join('\n'));
  const yes = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: { ...CLI, users: true } });
  // F3 fix round 1 (v6.1.10): the users yes stands only for a fully ready program; FLOSS still needs its manifest link.
  assert.equal((yes.reply!.verdict as { status: string }).status, 'ready');
  assert.equal(yes.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000. Needs your funding manifest link. First: publish a funding manifest on your site or repo.', 'Say yes and I apply.'].join('\n'));
  // With no live link and the repo not read, nothing EarnKit can see exists (B20c, v6.1.9): not a fit, even on a yes.
  const { live_url: _l, ...bare } = CLI;
  const bareYes = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: { ...bare, users: true } });
  assert.deepEqual([(bareYes.reply!.verdict as { status: string }).status, bareYes.reply!.show_to_builder], ['no', 'FLOSS/fund, $10,000 to $100,000. Not a fit: needs a product people use.']);
});

test('1b (v6.1.8): FLOSS/fund for a CLI on Base: not a fit with no live link, sign in to confirm users, then ready with one yes', async () => {
  const CLI = { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', users: true, chains: [{ chain: 'base', mainnet: true }] };
  const no = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  // B20c (v6.1.9): nothing EarnKit can see exists, so the users bar is not a fit before any tier.
  assert.equal(no.reply!.show_to_builder, 'FLOSS/fund, $10,000 to $100,000. Not a fit: needs a product people use.');
  const live = { ...CLI, live_url: 'https://ripgrep.dev' };
  const gap = await mcpCall(ctx(await installation()), 'find', { program_id: 'floss-fund-zerodha', project: live });
  // F2 (fix round 1, v6.1.14): no link in this context and nothing read: the sign-in is the one action, without a link.
  assert.equal(gap.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000: proof that real people use it. First: publish a funding manifest on your site or repo.', 'Sign in once and I remember you.'].join('\n'));
  // Linked, with the used tier stored: ready, the list's ready line and the one yes.
  const { getRecord, saveRecord } = await import('../v6/builders');
  const { id, builderId } = await linkedWith({ projects: [{ id: 'rg', name: 'ripgrep', live_url: 'https://ripgrep.dev' }] });
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
  assert.equal(lines[0], 'FLOSS/fund, $10,000 to $100,000. Needs your funding manifest link. First: publish a funding manifest on your site or repo.');
  assert.equal(lines[1], 'Say yes and I apply.');
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
  assert.ok((r.reply!.ready as unknown[]).length > 0);
  assert.ok(Array.isArray(r.reply!.gaps));
  assert.deepEqual(r.reply!.problems, ['description cut to 280 characters']);
  assert.doesNotMatch(r.reply!.show_to_builder as string, /^Open now/);
});

test('find with no project: the open list and the ask for the project', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', {});
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  assert.match(show, /^Open now:\n/);
  assert.ok(show.includes('Alliance ALL19, $400K at admission, closes in'), show);
  const lines = show.split('\n');
  for (const line of lines.slice(1)) assert.ok(line.endsWith('.'), line);
  assert.equal(lines.at(-1), "Tell me which project and I'll match it.");
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
  assert.ok((r.reply!.ready as unknown[]).length > 0);
});

test('filter.all lists the rest with a reason; the leftover count is in the note otherwise', async () => withInPerson(async () => {
  const id = await installation();
  const capped = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.match(capped.reply!.agent_note as string, /^\d+ more left out: ready past the cap, gaps and in-person programs\. Ask with filter\.all for the full list\.$/m);
  const all = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { all: true } });
  assert.ok((all.reply!.ready as unknown[]).length > 5);
  const notFit = all.reply!.not_fit as { program_id: string; reason: string }[];
  assert.ok(notFit.every((n) => n.reason.length > 0));
  assert.ok(!notFit.some((n) => n.program_id === 'base-builder-grants'));
  const { live_url: _, ...noLink } = PROJECT;
  const offline = await mcpCall(ctx(id), 'find', { project: noLink, filter: { all: true } });
  assert.ok((offline.reply!.not_fit as { program_id: string; reason: string }[]).some((n) => n.program_id === 'base-builder-grants' && n.reason.length > 0));
  const grants = await mcpCall(ctx(id), 'find', { project: PROJECT, filter: { category: 'investment', all: true } });
  assert.ok((grants.reply!.ready as { category: string }[]).every((p) => p.category === 'investment'));
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
    assert.deepEqual(first.reply!.ask_outcome, [{ program_id: 'f-due', title: 'Due Grant' }]);
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
async function linkedWith(patch: Record<string, unknown>, approve: string[] = []) {
  const { saveInstallation, connectInstallation } = await import('./installations');
  const { linkInstallation, saveRecord, upsertBuilder } = await import('../v6/builders');
  const { EMPTY_RECORD, approvePath, mergeRecord } = await import('../v6/record');
  const token = 'find-linked-' + Math.random();
  await saveInstallation(token, 'Claude Code');
  const id = (await connectInstallation(token))!.id;
  const b = await upsertBuilder({ github_id: ++ghId, login: 'fl' + ghId, name: 'FL', avatar_url: null }, NOW);
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
  const blocks = show.split('\n\n');
  const link = r.reply!.sign_in as string;
  assert.match(link, /\/link\//);
  const sentence = ` Sign in once at ${link} and I read your repo for proof and remember you.`;
  assert.ok(blocks.at(-1)!.endsWith(sentence), show);
  assert.ok(CLOSINGS.some((c) => c.test(blocks.at(-1)!.slice(0, -sentence.length))), show);
  assert.equal(show.match(/Sign in once at/g)!.length, 1);
  assert.equal(r.reply!.linked, false);
}));

test('R19: project C (no repo) gets the short sign-in sentence (v6.1.6)', async () => withEnv(OAUTH_ENV, async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Project C', description: 'A wallet app for remittances.', live_url: 'https://c.example.com' } });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply!.as_reported, true);
  const show = r.reply!.show_to_builder as string;
  const link = r.reply!.sign_in as string;
  assert.ok(show.endsWith(` Sign in once at ${link} and I remember you across agents.`), show);
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
  const ready = reply.ready as { program_id: string; from_record: number; fields: { key: string; from: string; value: string | null; style?: string }[]; need_you: string[] }[];
  const z = ready.find((p) => p.program_id === 'z-fellows')!;
  assert.ok(z.from_record > 0, JSON.stringify(z));
  const problem = z.fields.find((f) => f.key === 'problem')!;
  assert.deepEqual([problem.from, problem.value, typeof problem.style], ['record', 'Builders lose weeks on grant forms.', 'string']);
  assert.equal(z.fields.find((f) => f.key === 'email')!.value, 'jenil@example.com');
  assert.ok((reply.record_missing as string[]).includes('your founder video link'), JSON.stringify(reply.record_missing));
  const blockers = reply.blockers as { program_id: string; sign_in: string | null; needs_click: boolean; needs: string[] }[];
  // v6.1.2: Avalanche now carries an eligibility gap; Y Combinator is the ready program with a platform sign-in (and a click).
  const yc = blockers.find((b) => b.program_id === 'y-combinator')!;
  assert.deepEqual([yc.sign_in, yc.needs_click], ['Y Combinator', true]);
  assert.deepEqual(blockers.find((b) => b.program_id === 'z-fellows')?.needs, ['founder_video']);
  assert.deepEqual((reply.evidence_summary as { tier: string }).tier, 'live');
  const show = reply.show_to_builder as string;
  assert.equal(show.split('\n').find((l) => l.startsWith('1. ')), '1. Arbitrum Mentorship Program: Cohort 2, $100K in prizes, closes in 32 days. Long odds: few prizes for many entries. Drafted: 16 of 22 answers. Needs your Telegram link, stage now and in 6 months, founder names and backgrounds and 3 more.');
  // v6.1.6 (R21): Y Combinator is in person, so its line names what attending takes and the Before block does not.
  assert.match(show, /\n\nBefore applying: [^\n]*Still missing for these programs: [^\n]+\./);
  assert.doesNotMatch(show.split('\n\n').find((b) => b.startsWith('Before applying: '))!, /Y Combinator/);
  assert.match(show, /\n\nYour project is live, with no verified usage yet\. Next: [^\n]+\.\n\n/);
  assert.doesNotMatch(show, /Sign in once at/);
  assert.match(reply.agent_note as string, /Fit approved answers by cutting, never by adding; the style contract travels on each field\./);
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
    assert.deepEqual(g.gap, { kind: 'tier', item: 'tier:used', what: '25 senders the deployer did not fund, on mainnet in 90 days; you have 0', effort: 'weeks', agent_can: false, details: { tier: 'live', min_tier: 'used' } });
    assert.ok(!ids(r.reply!.ready).includes('f-tier'));
    // A read that fails leaves the own tier unknown: the bar falls back to the provisional one (R3c), building here.
    const other = await linkedWith(OWNER_RECORD);
    const u = await mcpCall({ ...ctx(other.id), builderId: other.builderId, evidence: async () => { throw new Error('down'); } }, 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(u.reply!.gaps).includes('f-tier'));
    // Linked, the builder has signed in: the bar says the proof is still being read, never to sign in (I2).
    assert.match(u.reply!.show_to_builder as string, /Tier Grant, Up to \$5,000\. Your proof is still being read; ask again in a minute\./);
    assert.doesNotMatch(u.reply!.show_to_builder as string, /proof that /);
    // Unlinked (v6.1.3 R3): the repo read reads as building at most, so a used bar is a gap. Unread (B20, v6.1.8):
    // the report's live link reads as live, still under a used bar; nothing reported is not a fit.
    const v5 = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(v5.reply!.gaps).includes('f-tier'));
    const unread = await mcpCall(ctx(await installation()), 'find', { project: { ...PROJECT, private: true, chains: [{ chain: 'base', mainnet: true }] }, filter: { all: true } });
    assert.ok(ids(unread.reply!.gaps).includes('f-tier'));
    const nothing = await mcpCall(ctx(await installation()), 'find', { project: { name: 'Idea', description: 'An idea.', chains: [{ chain: 'base', mainnet: true }] }, filter: { all: true } });
    assert.ok(!ids(nothing.reply!.ready).includes('f-tier') && !ids(nothing.reply!.gaps).includes('f-tier'));
    // B20c (v6.1.9): with nothing that exists, a used program is not a fit by its own rule, before the tier bar.
    assert.deepEqual((nothing.reply!.not_fit as { program_id: string; reason: string }[]).find((n) => n.program_id === 'f-tier')?.reason, 'needs a product people use');
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-tier'`;
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
  assert.match(show, /^\d+\. Live Grant, Up to \$5,000\. /m, show);
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
  assert.ok(!ids(r.reply!.ready).includes('f-live'));
  const g = (r.reply!.gaps as { program_id: string; n: number; gap: { kind: string; what: string; details?: unknown } }[]).find((x) => x.program_id === 'f-live');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(g.gap.kind, 'tier');
  assert.equal(g.gap.what, CONFIRM);
  assert.match(r.reply!.show_to_builder as string, new RegExp(`^${g.n}\\. Live Grant, Up to \\$5,000: ${CONFIRM}\\.$`, 'm'));
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
  assert.ok(ids(r.reply!.ready).includes('f-live'), JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(r.reply!.evidence_summary, null);
  assertLiveReady(r.reply!.show_to_builder as string);
  // R3a: the agent passing the live URL (as the note asks) keeps the code's homepage: still live.
  const passed = await mcpCall({ installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch }, 'find', {
    project: { name: 'Dashboard', description: 'A dashboard.', repo_url: `https://github.com/${dash.repo}`, live_url: 'https://dashboard-v1-ashy.vercel.app' }, filter: { all: true },
  });
  assert.equal(passed.isError, false, passed.text);
  assert.ok(ids(passed.reply!.ready).includes('f-live'), JSON.stringify(ids(passed.reply!.gaps)));
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
  assert.match(r.reply!.show_to_builder as string, new RegExp(`^${g.n}\\. Live Grant, Up to \\$5,000\\. Add this project to your record so EarnKit can read its proof\\.$`, 'm'));
  assert.doesNotMatch(r.reply!.show_to_builder as string, /proof that |still being read/);
  assert.equal(r.reply!.evidence_summary, null);
  // The one-program reply: the same line, and no "tell me when" action under it.
  const one = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { program_id: 'f-live', project: noLink });
  assert.equal(one.reply!.show_to_builder, 'Live Grant, Up to $5,000. Add this project to your record so EarnKit can read its proof.');
  // The record holds this project but its proof could not be read yet: the proof is still being read.
  const held = await linkedWith({ projects: [{ id: 'ek', name: 'EarnKit', repo_url: `https://github.com/${rec.repo}` }] });
  const failing = async () => { throw new Error('read failed'); };
  const m = await mcpCall({ ...ctx(held.id), builderId: held.builderId, evidence: failing }, 'find', { project: noLink, filter: { all: true } });
  const mg = (m.reply!.gaps as { program_id: string; n: number }[]).find((x) => x.program_id === 'f-live');
  assert.ok(mg, JSON.stringify(ids(m.reply!.gaps)));
  assert.match(m.reply!.show_to_builder as string, new RegExp(`^${mg.n}\\. Live Grant, Up to \\$5,000\\. Your proof is still being read; ask again in a minute\\.$`, 'm'));
  assert.doesNotMatch(m.reply!.show_to_builder as string, /Add this project/);
}));

test('I3 (v6.1.8 final fix): the one-program reply gates on the same fresh own tier the list reads, before and after a list find', async () => withLiveBar(async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const c = { ...ctx(id), builderId, evidence: LIVE };
  // The detail first: it reads the own evidence as the list would (live), so the live bar is met.
  const detail = await mcpCall(c, 'find', { program_id: 'f-live', project: PROJECT, project_id: 'earnkit' });
  assert.equal(detail.isError, false, detail.text);
  const list = await mcpCall(c, 'find', { project: PROJECT, project_id: 'earnkit', filter: { all: true } });
  assert.ok(ids(list.reply!.ready).includes('f-live'), JSON.stringify(ids(list.reply!.gaps)));
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
    return { ready: ids(r.reply!.ready).includes('f-live'), gap: g ? `${g.gap.kind}: ${g.gap.what}` : null, no: no?.reason ?? null, show: r.reply!.show_to_builder as string };
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
  const show = r.reply!.show_to_builder as string;
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
  const ready = new Set(ids(r.reply!.ready));
  assert.ok(blockers.every((b) => ready.has(b.program_id)));
  const show = r.reply!.show_to_builder as string;
  // v6.1.6 (R21): the in-person line says what attending takes; the Before block never repeats it.
  assert.doesNotMatch(show, /Sign in once to Y Combinator/);
  assert.match(show, /\n\nIn person \(\d+\):\n/);
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
  } else assert.match(show, /\n\nSay yes and I apply\./);
  for (const p of waits) assert.match(show, new RegExp(`\n\nBefore tonight \\(nothing is sent until these are in\\): [^\n]*for [^\n]*${p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(r.reply!.auto_apply, true);
  assert.match(r.reply!.agent_note as string, /^Standing approval is on: for each ready program within the limits, call track started/m);
  assert.ok(!ids(r.reply!.ready).includes('z-fellows'));
});

type B = { program_id: string; sign_in: string | null; needs_click: boolean; outside_approval?: true };
/** The closing line when the agent applies tonight: the programs named (C40). */
const tonightRe = (titles: string[]) => {
  const words = titles.length <= 1 ? titles.join('') : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
  return new RegExp(`\\n\\nApplying tonight to ${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Say stop to hold any\\.${NOTICE_TAIL}$`);
};
/** The ready programs the agent may send alone tonight: no sign-in, click or approval limit in the way. */
const freeOf = (reply: Record<string, unknown>, waiting = false) => {
  const blocked = new Set((reply.blockers as B[]).filter((b) => b.sign_in || b.needs_click || b.outside_approval).map((b) => b.program_id));
  // S6 fix round 1 (v6.1.9): and every required builder answer in (`waiting` keeps the ones that wait on one).
  return (reply.ready as { program_id: string; title: string; in_person: boolean; needs: string[]; setup: string[] }[])
    .filter((p) => !p.in_person && !blocked.has(p.program_id) && (waiting || p.needs.every((n) => p.setup.includes(n))));
};

test('categories limit only what the agent sends alone: an investment program stays ready, not counted tonight', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, categories: ['grant', 'hackathon', 'bounty'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const ready = r.reply!.ready as { program_id: string; title: string; category: string; in_person: boolean }[];
  const invest = ready.filter((p) => p.category === 'investment');
  assert.ok(invest.length > 0, JSON.stringify(ids(ready)));
  const blockers = r.reply!.blockers as B[];
  for (const p of invest) assert.equal(blockers.find((b) => b.program_id === p.program_id)?.outside_approval, true, p.program_id);
  assert.ok(blockers.filter((b) => b.outside_approval).every((b) => invest.some((p) => p.program_id === b.program_id)));
  const free = freeOf(r.reply!);
  assert.ok(free.every((p) => !invest.some((x) => x.program_id === p.program_id)));
  const show = r.reply!.show_to_builder as string;
  // C46: an in-person program is never in the outside-approval list.
  const named = invest.filter((p) => !p.in_person && !blockers.find((b) => b.program_id === p.program_id)!.needs_click).map((p) => p.title);
  for (const p of invest.filter((x) => x.in_person)) assert.doesNotMatch(show.split('\n\n').find((b) => b.startsWith('Before')) ?? '', new RegExp(p.title));
  // Here every remote investment program needs the builder's submit, so none is named; the in-person ones never are.
  assert.ok(invest.some((p) => p.in_person), JSON.stringify(ids(invest)));
  if (named.length > 0) assert.ok(show.includes(`Outside your standing approval, you say yes yourself: ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`}.`), show);
  else assert.doesNotMatch(show, /Outside your standing approval/, show);
  assert.match(show, free.length > 0 ? tonightRe(free.map((p) => p.title)) : /Say yes/);
  assert.match(r.reply!.agent_note as string, /outside_approval/);
});

test('max_ask_usd keeps a larger ask out of tonight and names it; a program with no stated amount is not over it', async () => {
  const { programFixture } = await import('./fixtures/program');
  await upsertProgram(programFixture({ id: 'f-big', title: 'Big Grant', reward: 'Up to $50,000 per grant', summary: 'Up to $50,000 · rolling', max_award_usd: 50_000 }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f-open', title: 'Open Grant' }), 'file', NOW);
  try {
    const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { auto_apply: true, max_per_night: 20, max_ask_usd: 10_000 } });
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    assert.equal(r.isError, false, r.text);
    const ready = ids(r.reply!.ready);
    assert.ok(ready.includes('f-big') && ready.includes('f-open'), JSON.stringify(ready));
    const blockers = r.reply!.blockers as B[];
    assert.deepEqual(blockers.find((b) => b.program_id === 'f-big'), { program_id: 'f-big', sign_in: null, needs_click: false, needs: [], outside_approval: true, over_limit_usd: 10_000 });
    assert.equal(blockers.find((b) => b.program_id === 'f-open'), undefined);
    const freeRows = freeOf(r.reply!);
    const free = ids(freeRows);
    assert.ok(free.includes('f-open') && !free.includes('f-big'), JSON.stringify(free));
    const show = r.reply!.show_to_builder as string;
    // N4 (v6.1.9): tonight goes ahead; the ask outside the approval would add more.
    assert.match(show, /Tonight's sends? goes? ahead\. These would add \d+ more: [^\n]*you say yes yourself to [^\n]*Big Grant[^\n]*, over your \$10,000 limit[.;]/);
    assert.doesNotMatch(show, /yes yourself to [^\n]*Open Grant/);
    assert.match(show, tonightRe(freeRows.map((p) => p.title)));
    // With auto_apply off, the limits change nothing.
    const off = await linkedWith({ ...OWNER_RECORD, policy: { max_ask_usd: 10_000, categories: ['grant'] } });
    const o = await mcpCall({ ...ctx(off.id), builderId: off.builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
    assert.ok(ids(o.reply!.ready).includes('f-big'));
    assert.ok((o.reply!.blockers as B[]).every((b) => !b.outside_approval));
    assert.doesNotMatch(o.reply!.show_to_builder as string, /Outside your standing approval/);
  } finally {
    await sql()`DELETE FROM programs WHERE id IN ('f-big', 'f-open')`;
  }
});

test('never removes a program from the list entirely', async () => {
  const { id, builderId } = await linkedWith({ ...OWNER_RECORD, policy: { never: ['z-fellows'] } });
  const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  const listed = [...ids(r.reply!.ready), ...ids(r.reply!.gaps), ...ids(r.reply!.not_fit), ...ids(r.reply!.blockers)];
  assert.ok(!listed.includes('z-fellows'), JSON.stringify(listed));
  assert.doesNotMatch(r.reply!.show_to_builder as string, /Z Fellows/);
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
  assert.deepEqual(r.reply!.released, ['alliance-all19']);
  assert.match(r.reply!.agent_note as string, /released: alliance-all19/);
  const ready = r.reply!.ready as { program_id: string; claimed_since?: string }[];
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
    assert.equal(openLines.at(-1), `Sign in once at ${link} so I remember you across agents.`);
    assert.deepEqual(openLines.slice(-3, -1), ["Tell me which project and I'll match it.", '']);
    for (const line of openLines.slice(1, -3)) assert.ok(line.endsWith('.'), line);
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

test('shownReadyOf: six remote and zero in person gives the first five remote', () => {
  assert.deepEqual(shownReadyOf(remote(6), false, isIn).map((v) => v.id), ['r0', 'r1', 'r2', 'r3', 'r4']);
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
const blockOf = (show: string, head: string) => show.split('\n\n').find((b) => b.startsWith(head)) ?? '';

const PROJECT_B = { name: 'dotfiles', description: 'Mathias Bynens dotfiles for macOS', repo_url: 'https://github.com/mathiasbynens/dotfiles' };
const PROJECT_C = { name: 'My notes', description: 'Personal markdown notes and dotfiles' };
/** The in-person block numbered from `n`. L1e-3 (v6.1.13): YC's application answers are the builder's, repo or not
 *  (its file says so), so its line names them for every project; `_noRepo` is kept for the callers. */
const inPersonBlock = (n: number, _noRepo = false) => [
  'In person (2):',
  `${n}. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and the batch you want.`,
  `${n + 1}. Alliance ALL19, $400K at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.`,
];
/** L1e-6 (v6.1.13): 14 days out, its list line says when it closes, as its detail does. */
const META_VR_LINE = (n: number) => `${n}. Meta VR Start Developer Competition 2026, $1,000,000 in prizes, closes in 14 days: a demo video. First: join the Meta VR Start program; turn on Developer Access for your Meta account; join the competition with a Devpost account. Their rule: a hands-first experience for Meta VR devices, entered by a Meta VR Start member.`;
/** L1c-2 (v6.1.10): with the VR rule unlikely (no keyword named), the rule slot goes to a rule with no keywords.
 *  L1d-2 (v6.1.11): Colosseum's crypto-product rule is unlikely for a project naming no crypto word. */
/** L1e-2 (v6.1.13): Thiel's age rule names who it is for (student, college), so a project naming none of those never
 *  sees it; FUTO, a rule with no keywords, takes the one no-hit slot where the project has code to show (L1e-6: an
 *  idea or an empty repo has none, and is left the in-person block alone). */
const FUTO_ONLY = ['One step away (1):', '1. FUTO Microgrants, $1,000 to $5,000. Their rule: open source software from a small or early-stage project.'];
/** Fix round 1 (T3-R1): an idea, notes or an empty repo: FUTO one real step away (code in a repo), then in person. */
const FUTO_CODE = '1. FUTO Microgrants, $1,000 to $5,000: code in a repo. Their rule: open source software from a small or early-stage project.';
const IDEA_REPLY = (notes: string[] = []) => ['One step away (1):', FUTO_CODE, '', ...inPersonBlock(2), '', ...notes.flatMap((x) => [x, '']), CODE_FIRST].join('\n');
/** The closing on a rule-only program the reply lists first. */
const THAT_RULE_FIRST = 'Nothing is ready yet. Say "yes 1" if that rule fits you.';
/** L1d-2 (v6.1.11, Review Focus 2): Colosseum's line names its account and sprint, never "a demo video" alone. */
const COLOSSEUM_LINE = (n: number) => `${n}. Colosseum Eternal, $25,000 award: a demo video. First: sign up for a Colosseum account; start the four-week sprint in the Eternal dashboard. Their rules: a crypto product built during the four-week sprint; the team has not raised venture capital for the startup it submits.`;
/** Fix round 1 (v6.1.10): a remote step shown closes the reply with its own step, in-person programs listed or not. */
const RULE_FIRST = 'Nothing is ready yet. Say "yes 1" if that rule fits you.';
/** L1f-2 (v6.1.14): the only step needs code first, so the closing asks for that, never the rule yes. */
const CODE_FIRST = 'Nothing is ready yet. Tell me when the code is in a repo and I look again.';
const USERS_FIRST = 'Nothing is ready yet. Do real people use it? Say yes and I look again.';
/** The rule-bearing program alone, a list of one (N-2, v6.1.9 fix round 1). */
const META_VR_ONLY = ['One step away (1):', META_VR_LINE(1)];

test('R18e: project A (Base mainnet; its replayed repo also reads Arbitrum) gets the rule-only program on its first reported chain, Base (v6.1.6, v6.1.7)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_A });
  assert.equal(r.isError, false, r.text);
  assert.equal(
    r.reply!.show_to_builder,
    [
      'Ready to apply (1):',
      '1. Arbitrum Mentorship Program: Cohort 2, $100K in prizes, closes in 32 days. Long odds: few prizes for many entries. Drafted: 19 of 22 answers. Needs your top 3 successes, funding raised before and current TVL range.',
      '',
      // L1c-3 (v6.1.10): the project's own chain (Base) first, rule-free then rule-bearing; then the chain-agnostic
      // FLOSS/fund; the Arc deploy (another chain) after them, past the cap.
      'One step away (3):',
      '2. Base Builder Grant Program, up to $5,000: add Base Builder Codes to the app and tell me if real people use it.',
      '3. Base Ecosystem Fund, pre-seed and seed investment. Their rule: a pre-seed or seed stage startup that chooses Base as its home.',
      '4. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.',
      '',
      'In person (2):',
      '5. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and the batch you want.',
      "6. Alliance ALL19, $400K at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      '',
      'Say yes and I apply.',
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
    [...FUTO_ONLY, '', ...inPersonBlock(2), '', 'I could not read the repo; matched on what you told me.', '', THAT_RULE_FIRST].join('\n'),
  );
  // The same repo with reads paused for the day (the daily cap): the repo likely exists, the users question stands.
  const { hit, LIMITS } = await import('./rate-limit');
  const capped = await installation();
  for (let n = 0; n < LIMITS.repoRead.limit; n++) await hit(`repoRead:${capped}`, LIMITS.repoRead.limit, LIMITS.repoRead.windowSeconds, NOW);
  const paused = await mcpCall(ctx(capped), 'find', { project: PROJECT_B });
  assert.deepEqual(paused.reply!.repo_notes, ['paused']);
  assert.equal(
    paused.reply!.show_to_builder,
    ['One step away (1):', '1. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.', '', ...inPersonBlock(2), '', 'Repo reads are paused until tomorrow; matched on what you told me.', '', USERS_FIRST].join('\n'),
  );
  // No repo and no live link: nothing to ask the users question of (B20c); the rule-bearing program stands alone as a
  // list of one (N-2 fix round 1), and the closing asks its rule first (I2, final).
  const c = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_C });
  assert.equal(c.isError, false, c.text);
  assert.equal(c.reply!.show_to_builder, IDEA_REPLY());
  for (const r of [b, c]) assert.doesNotMatch(r.reply!.show_to_builder as string, /FLOSS|real people use it/);
  for (const r of [b, c]) assert.match(r.reply!.agent_note as string, /more left out: [^\n]*Ask with filter\.all for the full list\./);
  for (const project of [PROJECT_B, PROJECT_C]) {
    const all = await mcpCall(ctx(await installation()), 'find', { project, filter: { all: true } });
    assert.equal((all.reply!.not_fit as { program_id: string; reason: string }[]).find((n) => n.program_id === 'floss-fund-zerodha')?.reason, 'needs a product people use', project.name);
  }
  for (const r of [b, c]) {
    assert.ok((r.reply!.gaps as { in_person: boolean }[]).every((g) => !g.in_person), JSON.stringify(ids(r.reply!.gaps)));
    assert.doesNotMatch(r.reply!.show_to_builder as string, /deploy the contract|a contract on/);
  }
  // filter.all still lists the in-person ones; the Monad Blitz pair needs a contract on Monad, so it is not a fit.
  const all = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_C, filter: { all: true } });
  const notFit = all.reply!.not_fit as { program_id: string; reason: string }[];
  assert.deepEqual(notFit.filter((n) => n.program_id.startsWith('monad-blitz')).map((n) => n.reason), ['needs a contract on Monad', 'needs a contract on Monad']);
  assert.ok(ids(all.reply!.gaps).includes('antler-us-residency'), JSON.stringify(ids(all.reply!.gaps)));
});

/** The web2 SaaS fixture: a public Next.js repo with a homepage and no chain anywhere. */
const dash = replayFetch('nextjs-dashboard');
const SAAS = { name: 'Dashboard', description: 'An admin dashboard.', repo_url: `https://github.com/${dash.repo}` };
const dashCtx = async () => ({ installationId: await installation(), builderId: null, now: NOW, gh: dash.fetch });
/** The VR persona: its own name and words, on the replayed public Next.js repo (code read), users said. */
const VR = { name: 'ALVR', description: 'Stream VR games from your PC to your headset over Wi-Fi', repo_url: `https://github.com/${dash.repo}`, users: true };

test('C54 (v6.1.8, Review Focus 1): the web2 SaaS fixture\'s default and full replies hold no chain step; contract programs are not a fit', async () => {
  const d = await mcpCall(await dashCtx(), 'find', { project: SAAS });
  assert.equal(d.isError, false, d.text);
  // N-2 (v6.1.9): one rule-free step, so the list is that one line, never Meta VR as line two; M1: the closing asks
  // the users question as a yes.
  assert.equal(
    d.reply!.show_to_builder,
    [
      'One step away (1):',
      '1. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.',
      '',
      ...inPersonBlock(2),
      '',
      USERS_FIRST,
    ].join('\n'),
  );
  assert.match(d.reply!.agent_note as string, /more left out: [^\n]*Ask with filter\.all for the full list\./);
  // C1 (final fix, B20b): the users question is the whole step; once said, FLOSS/fund is ready, never the bar.
  const said = await mcpCall(await dashCtx(), 'find', { project: { ...SAAS, users: true } });
  assert.match(blockOf(said.reply!.show_to_builder as string, 'Ready to apply'), /^1\. FLOSS\/fund, \$10,000 to \$100,000\. /m);
  assert.doesNotMatch(said.reply!.show_to_builder as string, /proof that |funded wallets/);
  const all = await mcpCall(await dashCtx(), 'find', { project: SAAS, filter: { all: true } });
  const show = all.reply!.show_to_builder as string;
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
      'Ready to apply (1):',
      '1. FLOSS/fund, $10,000 to $100,000. Needs your funding manifest link. First: publish a funding manifest on your site or repo.',
      '',
      'One step away (1):',
      META_VR_LINE(2),
      '',
      ...inPersonBlock(3),
      '',
      'Say yes and I apply.',
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
      'One step away (3):',
      // Fix round 1 (I1): the closing names the step, so the lines leave it out.
      '1. FLOSS/fund, $10,000 to $100,000: a public repo. First: publish a funding manifest on your site or repo.',
      META_VR_LINE(2),
      '3. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000: a public repo. Their rule: an OSI-approved open source license.',
      '',
      ...inPersonBlock(4),
      '',
      'Private repo: matched on what you told me.',
      '',
      'Nothing is ready yet. First: make the repo public. Tell me when it is done and I look again.',
    ].join('\n'),
  );
  assert.equal((hidden.reply!.show_to_builder as string).match(/make the repo public/g)!.length, 1);
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
  const started = await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'started' });
  assert.equal(started.isError, false, started.text);
  // Started alone pins it (a live claim): it heads the step list with its demo video and rule.
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
  assert.equal(show.split('\n').at(-1), 'Say yes and I apply.');
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
  assert.equal(show.match(/\bSay\b/g)?.length, 1, show);
  assert.equal(show.split('\n\n').at(-1), 'Say yes and I apply.');
});

test('L1e-2 and L1e-5 (v6.1.13, persona 7): a student project sees Thiel by default, and filter.all closes on its rule', async () => {
  const r = await mcpCall(await dashCtx(), 'find', { project: STUDENT });
  const show = r.reply!.show_to_builder as string;
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'thiel-fellowship');
  assert.ok(g, show);
  assert.equal(lineOf(show, g.n), `${g.n}. ${THIEL_LINE}`);
  const all = await mcpCall(await dashCtx(), 'find', { project: STUDENT, filter: { all: true } });
  const t = (all.reply!.gaps as G[]).find((x) => x.program_id === 'thiel-fellowship')!;
  assert.equal((all.reply!.show_to_builder as string).split('\n').at(-1), `Nothing is ready yet. Say "yes ${t.n}" if that rule fits you.`);
});

test('L1e-4 (v6.1.13, Review Focus 9, persona 4): after the users yes on FLOSS/fund, HeroDevs never asks it again', async () => {
  const c = await dashCtx();
  await mcpCall(c, 'find', { project: RIPGREP });
  const yes = await mcpCall(c, 'track', { program_id: 'floss', status: 'gap_done', item: 'users', project: RIPGREP });
  assert.equal(yes.isError, false, yes.text);
  const again = await mcpCall(c, 'find', { project: RIPGREP, filter: { all: true } });
  const show = again.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /real people use it/);
  const hero = [...(again.reply!.gaps as G[]), ...(again.reply!.ready as G[])].find((x) => x.program_id === 'herodevs-sustainability-fund');
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
    lines.push([after.reply!.show_to_builder as string, lineOf(show, 1), lineOf(show, 2), show.split('\n\n').at(-1)!]);
    assert.doesNotMatch(show, /Say yes/, show);
  }
  assert.deepEqual(lines[0], lines[1]);
  assert.deepEqual(lines[0], [
    // Review Focus 1 (v6.1.14): the closing names the answers, so the line does not.
    ['Thiel Fellowship, $250,000 over two years. Long odds: many apply, few are taken.', 'Thiel Fellowship needs your online application answers; then I draft it for you to send.'].join('\n'),
    '1. Thiel Fellowship, $250,000 over two years. Long odds: many apply, few are taken.',
    // Fix round 1 (T3-R1): FUTO is one real step away, code in a repo, with no yes of its own (T3-R5).
    FUTO_CODE.replace(/^1\./, '2.'),
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
      'One step away (1):',
      '1. Solana Foundation Grants, milestone grants: code in a repo. Their rule: a public good, meaning a significant open source contribution to the Solana ecosystem or a free community offering.',
      '',
      'In person (2):',
      '2. Y Combinator Winter 2027 Batch, $500K investment. Long odds: many apply, few are taken. Needs a YC account, your application answers and the batch you want.',
      "3. Alliance ALL19, $400K at admission, closes in 14 days. Long odds: many apply, few are taken. First: open the application with the first founder's email.",
      '',
      'Nothing is ready yet. Tell me when the code is in a repo and I look again.',
    ].join('\n'),
  );
  assert.doesNotMatch(show, /deploy the contract on|—|\b(coin|points|score|rank|grade|streak|token)s?\b/i);
  // The full list keeps the other chains' deploys, and the own chain's programs with their real gaps.
  const all = await mcpCall(ctx(await installation()), 'find', { project: SOL, filter: { all: true } });
  const shown = all.reply!.show_to_builder as string;
  for (const id of ['solana-foundation-grants', 'solana-incubator-cohort-6', 'base-ecosystem-fund', 'monad-blitz-oregon']) assert.ok(ids(all.reply!.gaps).includes(id), id);
  assert.match(shown, /\d+\. Base Ecosystem Fund, pre-seed and seed investment: deploy the contract on Base\. /);
  assert.match(shown, /\d+\. Solana Incubator Cohort 6, NYC incubator with relocation stipend: code in a repo\. /);
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
  assert.match(again.reply!.show_to_builder as string, /Solana Foundation Grants, milestone grants: code in a repo\./);
});

test('L12-7 (v6.1.14): a keyword hit whose only change is code in a repo shows on a chain as it does with none; a student on a chain still sees Thiel', async () => {
  const HOOK = { name: 'Hookswap', description: 'A Uniswap limit order tool' };
  const onEth = await mcpCall(ctx(await installation()), 'find', { project: { ...HOOK, chains: [{ chain: 'ethereum', mainnet: true }] } });
  const eth = onEth.reply!.show_to_builder as string;
  assert.equal(
    eth.split('\n\n')[0],
    [
      'One step away (3):',
      '1. Ethereum Security Subsidy Program, up to 30% of audit cost: code in a repo. First: set aside a security budget to co-fund the audit. Their rule: smart contracts for Ethereum mainnet with a defined audit scope (lines of code and contract count).',
      '2. Uniswap Foundation Open Grants, amount by milestone budget: code in a repo. Their rule: work that contributes to the Uniswap ecosystem and benefits people beyond your own product.',
      '3. Uniswap Foundation Security Fund (UFSF) Audit Subsidies, up to 100% audit subsidy: code in a repo. First: register a legal entity for KYB; finalize the contracts for audit. Their rule: smart contracts in the Uniswap ecosystem (a v4 hook or a Uniswap integration) with a date they will be ready for audit.',
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
  const c = await dashCtx();
  await mcpCall(c, 'find', { project: VR });
  const started = await mcpCall(c, 'track', { program_id: 'meta-vr-start-competition-2026', status: 'started', project: VR });
  assert.equal(started.isError, false, started.text);
  const [row] = await sql()`SELECT project_id FROM applications WHERE program_id = 'meta-vr-start-competition-2026' AND installation_id = ${c.installationId}`;
  assert.equal(row.project_id, `https://github.com/${dash.repo}`.toLowerCase());
  // Another project of the same builder: the VR claim does not pin, so the idea opens as it always does.
  const IDEA = { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' };
  const other = await mcpCall(c, 'find', { project: IDEA });
  const show = other.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /Meta VR/);
  assert.ok(show.endsWith(IDEA_REPLY()), show);
  // The claimed project itself still has it pinned.
  const own = await mcpCall(c, 'find', { project: VR });
  assert.equal(ids(own.reply!.gaps)[0], 'meta-vr-start-competition-2026');
});

test('L1d-1 (v6.1.11), C1 (v6.1.13): another agent\'s claim on another project reads that project\'s name on its line, by default and in filter.all, and leaves the yes count', async () => {
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
  const ready = r.reply!.ready as { program_id: string; claimed_since?: string; title: string }[];
  assert.ok(ids(ready).includes('y-combinator'));
  assert.equal(ready.find((p) => p.program_id === 'y-combinator')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
  assert.equal(ready.find((p) => p.program_id === 'alliance-all19')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
  const show = r.reply!.show_to_builder as string;
  const line = show.split('\n').find((l) => l.includes('Y Combinator'))!;
  assert.match(line, / Being handled by your other agent for another project\.$/);
  assert.match(show.split('\n').find((l) => /^\d+\. Alliance ALL19/.test(l))!, / Being handled by your other agent since 11:00 UTC\.$/);
  assert.equal(show.split('\n').filter((l) => l.includes('Being handled')).length, 2);
  // It is no yes: the same list less one to say yes to; it neither pins nor leads the list.
  assert.deepEqual(ids(ready), ids(before.reply!.ready));
  assert.match(r.reply!.agent_note as string, /claimed_since is claimed by another of the builder's agents: do not submit it\./);
  const all = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, filter: { all: true } });
  const allShow = all.reply!.show_to_builder as string;
  assert.match(allShow.split('\n').find((l) => l.includes('Y Combinator'))!, / Being handled by your other agent for another project\.$/);
  const allReady = all.reply!.ready as { program_id: string; claimed_since?: string }[];
  assert.equal(allReady.find((p) => p.program_id === 'y-combinator')?.claimed_since, new Date(NOW.getTime() - H).toISOString());
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
    '',
    ...inPersonBlock(2),
    '',
    'This repo is archived; programs want active work.',
    '',
    'Nothing is ready yet. First: tell me the live repo, and I look again.',
  ].join('\n'));
  assert.equal(show.match(/tell me the live repo/g)!.length, 1);
  assert.ok((r.reply!.agent_note as string).split('\n').includes(REPO_STEP_NOTE));
  const one = await mcpCall(c, 'find', { program_id: 'herodevs', project: ATOM });
  assert.equal(one.reply!.show_to_builder, [
    // FR-1 (final fix): the telling step is the action, so the line leaves it out.
    'HeroDevs Open Source Sustainability Fund, $2,500 to $15,000: the repo is archived. Their rule: an OSI-approved open source license.',
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
  assert.equal(empty.reply!.show_to_builder, IDEA_REPLY(['The repo is empty, so I matched on what you told me.']));
  for (const [mk, project] of [[ideaCtx, IDEA], [emptyCtx, EMPTY]] as const) {
    // Even after the builder says yes (users: true, or gap_done users): not a fit, never ready, never a step.
    const c = await mk();
    await mcpCall(c, 'track', { program_id: 'floss-fund-zerodha', status: 'gap_done', item: 'users' });
    const yes = await mcpCall(c, 'find', { project: { ...project, users: true }, filter: { all: true } });
    assert.ok(!ids(yes.reply!.ready).includes('floss-fund-zerodha') && !ids(yes.reply!.gaps).includes('floss-fund-zerodha'), yes.reply!.show_to_builder as string);
    assert.equal((yes.reply!.not_fit as { program_id: string; reason: string }[]).find((n) => n.program_id === 'floss-fund-zerodha')?.reason, 'needs a product people use');
    const one = await mcpCall(c, 'find', { program_id: 'floss-fund-zerodha', project: { ...project, users: true } });
    assert.equal(one.reply!.show_to_builder, 'FLOSS/fund, $10,000 to $100,000. Not a fit: needs a product people use.');
    assert.doesNotMatch(yes.reply!.show_to_builder as string, /real people use it/);
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
  assert.ok(g, all.reply!.show_to_builder as string);
  assert.equal(lineOf(all.reply!.show_to_builder as string, g.n), COLOSSEUM_LINE(g.n));
  // An idea that says crypto sees it in the default list, never as "a demo video" alone.
  const crypto = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: a crypto app that splits rent between roommates onchain' } });
  const show = crypto.reply!.show_to_builder as string;
  const c = (crypto.reply!.gaps as G[]).find((x) => x.program_id === 'colosseum-eternal');
  assert.ok(c, show);
  assert.equal(lineOf(show, c.n), COLOSSEUM_LINE(c.n));
  assert.doesNotMatch(show, /a demo video\. Their rule: the team has not raised/);
});

test('L1c-2 (v6.1.10, Review Focus 3): an idea that names no VR word never opens with the VR competition; one whose description says "Quest" does', async () => {
  const ideaCtx = async () => ({ installationId: await installation(), builderId: null, now: NOW });
  const plain = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: an app that splits rent and bills between roommates' } });
  assert.doesNotMatch(plain.reply!.show_to_builder as string, /Meta VR/);
  assert.match(plain.reply!.agent_note as string, /more left out/);
  const quest = await mcpCall(await ideaCtx(), 'find', { project: { name: 'Rent Split', description: 'An idea: a Quest app that splits rent and bills between roommates' } });
  assert.equal(quest.reply!.show_to_builder, [...META_VR_ONLY, '', ...inPersonBlock(2, true), '', RULE_FIRST].join('\n'));
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
      'One step away (3):',
      META_VR_LINE(1),
      '2. FLOSS/fund, $10,000 to $100,000: tell me if real people use it. First: publish a funding manifest on your site or repo.',
      '3. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000: tell me if real people use it. Their rule: an OSI-approved open source license.',
      '',
      ...inPersonBlock(4),
      '',
      // Fix round 1 (v6.1.12): the cheapest step shown closes the reply, the users question before the demo video.
      USERS_FIRST,
    ].join('\n'),
  );
  // An Atlassian Forge app sees Codegeist the same way.
  const forge = await mcpCall(await dashCtx(), 'find', { project: { ...QUEST, name: 'Sprinter', description: 'An Atlassian Forge app for Jira sprint reports' } });
  assert.match(blockOf(forge.reply!.show_to_builder as string, 'One step away'), /Codegeist/);
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
      'One step away (3):',
      META_VR_LINE(2),
      "3. PayPal AI Hackathon: Build What's Next with PayPal and AI, $67,500 in prizes, closes in 8 days: a demo video. First: join the hackathon with a Devpost account; sign up for a PayPal Developer account (sandbox). Their rules: meaningfully uses a PayPal API, SDK or developer capability together with an AI model, tool or platform; a public code repo with a visible open source license.",
      '4. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000. Their rule: an OSI-approved open source license.',
    ].join('\n'),
  );
  // Two days out it is listed first, ahead of the cap; a keyword hit, it leaves the one rule slot to HeroDevs (N1, v6.1.12).
  const late = (await at(new Date('2026-11-10T08:00:00Z'))).reply!;
  assert.equal(
    blockOf(late.show_to_builder as string, 'One step away'),
    [
      'One step away (3):',
      "2. PayPal AI Hackathon: Build What's Next with PayPal and AI, $67,500 in prizes, closes in 2 days: a demo video. First: join the hackathon with a Devpost account; sign up for a PayPal Developer account (sandbox). Their rules: meaningfully uses a PayPal API, SDK or developer capability together with an AI model, tool or platform; a public code repo with a visible open source license.",
      META_VR_LINE(3).replace('in 14 days', 'in 8 days'),
      '4. HeroDevs Open Source Sustainability Fund, $2,500 to $15,000. Their rule: an OSI-approved open source license.',
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
  once(archived.show_to_builder as string, 'This repo is archived; programs want active work.');
  // Its homepage is not a live link: the live bar is a gap.
  assert.ok(ids(archived.gaps).includes('f-live'), JSON.stringify(ids(archived.gaps)));
  const empty = await run('empty-repo');
  // An empty repo holds no proof of code (final review M6): with no live link, a program with a bar is not a fit.
  assert.ok((empty.not_fit as { program_id: string }[]).some((n) => n.program_id === 'f-live'), JSON.stringify(ids(empty.gaps)));
  const show = empty.show_to_builder as string;
  once(show, 'The repo is empty, so I matched on what you told me.');
  assert.doesNotMatch(show, /I read your repo/);
  assert.match(show, /Sign in once at https:\/\/earnkit\.com\/link\/abc and I remember you across agents\.$/);
  // Each sentence sits just before the closing line, after the lists.
  const blocks = show.split('\n\n');
  assert.equal(blocks.at(-2), 'The repo is empty, so I matched on what you told me.');
  // F9 (v6.1.12): Builder Codes reported on the empty repo: the two notes are one sentence.
  const codes = await run('empty-repo', { builder_codes: true });
  assert.deepEqual(codes.repo_notes, ['empty', 'no_builder_codes']);
  const codesShow = codes.show_to_builder as string;
  assert.equal(codesShow.split('\n\n').at(-2), 'The repo is empty and does not send Builder Codes yet, so I matched on what you told me.');
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
  const show = r.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /deploy the contract on Solana/);
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'solana-foundation-grants');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.deepEqual([g.gap.kind, g.also], ['rule', []]);
});

test('project A (R18a): Base Ecosystem Fund is one answer away; gap_done with its rule item makes it ready, no rule sentence (v6.1.6)', async () => {
  const id = await installation();
  const r = await mcpCall(ctx(id), 'find', { project: PROJECT_A, filter: { all: true } });
  assert.equal(r.isError, false, r.text);
  const show = r.reply!.show_to_builder as string;
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'base-ecosystem-fund');
  assert.ok(g, show);
  assert.deepEqual([g.gap.kind, g.gap.what, g.also], ['rule', BASE_RULE, []]);
  assert.match(g.gap.item, /^rule:[0-9a-f]{8}$/);
  const line = lineOf(blockOf(show, 'One step away'), g.n);
  // L1e-2 (v6.1.13): a ready program takes the closing's yes, so the rule reads as a plain sentence.
  assert.equal(line, `${g.n}. Base Ecosystem Fund, pre-seed and seed investment. Their rule: ${BASE_RULE}.`);
  assert.ok((r.reply!.agent_note as string).split('\n').includes('A "Their rule" gap is a program rule EarnKit cannot check. If the builder says it fits, call track gap_done with that gap\'s item, then find again. Their yes stands: when the program comes back ready, draft and submit it without asking again.'));
  const t = await mcpCall(ctx(id), 'track', { program_id: 'base-ecosystem-fund', status: 'gap_done', item: g.gap.item });
  assert.equal(t.isError, false, t.text);
  assert.deepEqual([t.reply!.show_to_builder, t.reply!.agent_note], ['Tracked. That rule counts as confirmed.', 'Call find again; the program comes back ready.']);
  const again = await mcpCall(ctx(id), 'find', { project: PROJECT_A, filter: { all: true } });
  const show2 = again.reply!.show_to_builder as string;
  const p = (again.reply!.ready as { program_id: string; n: number }[]).find((x) => x.program_id === 'base-ecosystem-fund');
  assert.ok(p, show2);
  const readyLine = lineOf(blockOf(show2, 'Ready to apply'), p.n);
  assert.match(readyLine, /Base Ecosystem Fund/);
  assert.doesNotMatch(readyLine, /Their rule/);
});

test('project A with filter.all: a demo-video gap and a rule share one gap line; every rule gap is in its line (v6.1.6)', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT_A, filter: { all: true } });
  const show = r.reply!.show_to_builder as string;
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
    const line = lineOf(r.reply!.show_to_builder as string, g.n);
    assert.equal(line, `${g.n}. Rule Grant, Up to $5,000: proof that real people use it. Their rule: a team of two or more.`);
    assert.doesNotMatch(line, /Say "yes/);
  } finally {
    await sql()`DELETE FROM programs WHERE id = 'f-rule-used'`;
  }
});

test('R18d: under filter.all, Antler (in person, rule only) says its rule and what attending takes; never in the default slot', async () => {
  const id = await installation();
  const d = await mcpCall(ctx(id), 'find', { project: PROJECT });
  assert.ok(!ids(d.reply!.gaps).includes('antler-us-residency'));
  const r = await mcpCall(ctx(await installation()), 'find', { project: PROJECT, filter: { all: true } });
  const g = (r.reply!.gaps as G[]).find((x) => x.program_id === 'antler-us-residency');
  assert.ok(g, JSON.stringify(ids(r.reply!.gaps)));
  assert.equal(
    lineOf(r.reply!.show_to_builder as string, g.n),
    `${g.n}. Antler US Residency, $500K to $1M investment. Their rule: at least one co-founder already has independent US work authorization; no visa sponsorship. First: work in person at Antler's NYC, SF or Austin office for up to 3 months.`,
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
  assert.ok(show.endsWith(` ${notice}`), show);
  assert.ok(show.split('\n\n').at(-1)!.startsWith('Say '), show);
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
  assert.ok(show.endsWith(` ${line}`), show);
  // The notice carries the link: the closing block offers it once.
  assert.equal(show.split(link).length, 2, show);
  const second = await mcpCall({ ...ctx(id, new Date(later.getTime() + H)), linkUrl: async () => link }, 'find', { project: PROJECT });
  assert.equal(second.reply!.linked_notice, null);
  assert.ok(!(second.reply!.show_to_builder as string).includes('unlinked'));

  const other = await linkedWith(OWNER_RECORD);
  await unlinkInstallation(other.id, other.builderId, NOW);
  const list = await mcpCall({ ...ctx(other.id, later), linkUrl: async () => link }, 'find', {});
  const listShow = list.reply!.show_to_builder as string;
  assert.equal(list.reply!.linked_notice, line);
  assert.ok(listShow.endsWith(`\n\n${line}`), listShow);
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
  // F5 (v6.1.12): the missing email is named once in the reply, by the Before block.
  const showA = a.reply!.show_to_builder as string;
  // (Alliance's setup step names the first founder's email, another answer.)
  assert.equal(showA.replace(/first founder's email/g, '').match(/\bemail\b/gi)?.length, 1, showA);
  assert.match(showA, /Still missing for these programs: [^\n]*your email/);
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
    assert.equal(pub.show_to_builder, ['Sign Grant, Up to $5,000: proof that real people use it.', `Sign in once at ${link} and I check that and remember you.`].join('\n'));
    assert.equal((pub.show_to_builder as string).match(/Sign in/g)!.length, 1);
    assert.equal(pub.sign_in, link);
    assert.ok((pub.agent_note as string).split('\n').includes('Show the sign-in link once as the reply gives it; once the builder has signed in, call find with program_id again.'));
    assert.doesNotMatch(pub.agent_note as string, /The builder makes each change/);
    // Nothing read (fix round 1, v6.1.14 F1): the sign-in promises only to remember, asked once.
    const priv = await call('f-sign', { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', private: true, users: true, live_url: 'https://ripgrep.dev', chains: [{ chain: 'base', mainnet: true }] });
    assert.equal((priv.show_to_builder as string).split('\n')[1], `Sign in once at ${link} and I remember you.`);
    // No link can be made (F2): the one-program reply still ends on the sign-in, without a link.
    const noLink = (await mcpCall({ ...ctx(await installation()), linkUrl: async () => { throw new Error('no link'); } }, 'find', { program_id: 'f-sign', project: { ...PROJECT, users: true } })).reply!;
    assert.equal(noLink.show_to_builder, ['Sign Grant, Up to $5,000: proof that real people use it.', 'Sign in once and I check that.'].join('\n'));
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
  const r = (list.ready as { program_id: string; n: number; in_person: boolean }[]).find((p) => !p.in_person)!;
  const listLine = lineOf(list.show_to_builder as string, r.n);
  const one = await mcpCall(ctx(await installation()), 'find', { program_id: r.program_id, project: PROJECT });
  assert.equal((one.reply!.show_to_builder as string).split('\n')[0], listLine.replace(/^\d+\. /, ''));
  const d = replayFetch('nextjs-dashboard');
  const onBase = { name: 'Dashboard', description: 'An admin dashboard.', repo_url: `https://github.com/${d.repo}`, live_url: 'https://dash.example.com', users: true, chains: [{ chain: 'base', mainnet: true }] };
  const c = async () => ({ installationId: await installation(), builderId: null, now: NOW, gh: d.fetch });
  const all = (await mcpCall(await c(), 'find', { project: onBase, filter: { all: true } })).reply!;
  const g = (all.gaps as G[]).find((x) => x.program_id === 'base-builder-grants')!;
  const gapListLine = lineOf(all.show_to_builder as string, g.n);
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
  assert.ok((first.reply!.show_to_builder as string).endsWith(` ${line}`), first.reply!.show_to_builder as string);
  const second = await mcpCall({ ...ctx(id, new Date(later.getTime() + H)), linkUrl: async () => null }, 'find', { project: PROJECT });
  assert.equal(second.reply!.linked_notice, null);
  // The open list says it too.
  const other = await linkedWith(OWNER_RECORD);
  await deleteBuilder(other.builderId, NOW);
  const list = await mcpCall({ ...ctx(other.id, later), linkUrl: async () => null }, 'find', {});
  assert.equal(list.reply!.linked_notice, line);
  assert.ok((list.reply!.show_to_builder as string).endsWith(`\n\n${line}`), list.reply!.show_to_builder as string);
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
  assert.ok(!JSON.stringify(r.reply!.ready).includes('Other why.'));
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
  assert.ok((next.reply!.show_to_builder as string).includes('\n\n2 answers wait for your approval again at earnkit.com/me.\n\n'), next.reply!.show_to_builder as string);
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
  assert.equal((await one('n5-live')).split('\n')[0], `Live Link Grant, Up to $5,000: put a live link up. ${LOOKED}`);
  // In the full list, after that program's line, once per find, every find while it is missing.
  for (let k = 0; k < 2; k++) {
    const all = (await mcpCall(c, 'find', { project, filter: { all: true } })).reply!.show_to_builder as string;
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
  assert.equal(near.reply!.show_to_builder, "I don't know that program.");
  for (const [name, id] of [['paypal hackathon', 'paypal-ai-hackathon'], ['thiel fellowship 2027', 'thiel-fellowship'], ['zerodha', 'floss-fund-zerodha']]) {
    const r = await mcpCall(ctx(await installation()), 'find', { program_id: name });
    assert.equal((r.reply!.program as { id: string }).id, id, name);
  }
  for (const name of ['l12-nope', 'base-nope', 'monad-xyz'])
    assert.equal((await mcpCall(ctx(await installation()), 'find', { program_id: name })).reply!.show_to_builder, "I don't know that program.", name);
  // F4 (v6.1.12, Review Focus 3): the common names; one match resolves, several are asked about, two by rank.
  // L1e-1 (v6.1.13, Review Focus 6): an organizer's first word that leads to one program resolves: floss, thiel.
  for (const [name, id] of [['ycombinator', 'y-combinator'], ['Thiel Foundation', 'thiel-fellowship'], ['monad blitz oregon', 'monad-blitz-oregon'], ['floss', 'floss-fund-zerodha'], ['thiel', 'thiel-fellowship']]) {
    const r = await mcpCall(ctx(await installation()), 'find', { program_id: name });
    assert.equal((r.reply!.program as { id: string }).id, id, name);
  }
  for (const [name, line] of [
    ['Base', "Did you mean Base Builder Grant Program or Base Ecosystem Fund?"],
    ['monad', "Did you mean Monad Blitz Oregon or Monad Blitz @广州 (Guangzhou)?"],
    ['Monad Blitz', "Did you mean Monad Blitz Oregon or Monad Blitz @广州 (Guangzhou)?"],
    ['uniswap', "Did you mean Uniswap Foundation Open Grants or Uniswap Foundation Security Fund (UFSF) Audit Subsidies?"],
    // Final fix (v6.1.12, I2): a bracketed parent organizer, two letters: no program.
    ['aws', "I don't know that program."],
    ['fi', "I don't know that program."],
  ]) assert.equal((await mcpCall(ctx(await installation()), 'find', { program_id: name })).reply!.show_to_builder, line, name);
  // Final fix (v6.1.12, I2): a loose name that is one program: the detail's first line names it.
  const kiro = await mcpCall(ctx(await installation()), 'find', { program_id: 'kiro' });
  assert.equal((kiro.reply!.program as { id: string }).id, 'kiroween-2026');
  assert.match(kiro.reply!.show_to_builder as string, /^Kiroween 2026, /);
  const none = await mcpCall(ctx(await installation()), 'find', { program_id: 'qqq-unknown' });
  assert.equal(none.reply!.show_to_builder, "I don't know that program.");
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
  // N3 (v6.1.12, Review Focus 2): answers still missing, so the line carries its needs and the closing names them;
  // the yes stands, and no second yes is asked.
  const lines = (after.reply!.show_to_builder as string).split('\n');
  // Review Focus 1 (v6.1.14): the closing names the needs, so line 1 does not.
  assert.equal(lines[0], 'Solana Foundation Grants, milestone grants. Drafted: 9 of 10 answers.');
  assert.equal(lines.at(-1), 'Solana Foundation Grants needs your requested amount; then I apply.');
  const list = await mcpCall(c, 'find', { project });
  const ready = (list.reply!.ready as { program_id: string; rule_yes?: true }[]).find((p) => p.program_id === 'solana-foundation-grants');
  assert.equal(ready?.rule_yes, true);
  const show = list.reply!.show_to_builder as string;
  assert.doesNotMatch(show, /Your yes stands/);
  // The others ready (as many as earlier tests left open) are asked for their yes after it.
  // F2 (fix round 1, v6.1.14): a proof gap is listed and this context gives no link, so the linkless sign-in ends it.
  assert.match(show.split('\n\n').at(-1)!, /^Solana Foundation Grants needs your requested amount; then I apply\.( Say yes and I apply(?: to all \d+\. Or say the numbers to skip)?\.)? Sign in once and I check that\.$/);
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
  assert.equal(one.reply!.show_to_builder, 'Kiroween 2026, $100,000 in prizes: tell me when you started this, a demo video and /.kiro directory at the repo root. First: join Kiroween 2026 with a Devpost account; sign up for a Kiro account (free credits by Dec 1). Their rule: built with Kiro.\nTell me when that is done and I apply.');
  const item = ((one.reply!.verdict as { gaps: { kind: string; item: string }[] }).gaps.find((x) => x.kind === 'new_work_after'))!.item;
  const t = await mcpCall(c, 'track', { program_id: 'kiroween-2026', status: 'gap_done', item, project: IDEA });
  assert.equal(t.reply!.show_to_builder, 'Tracked.');
  const again = await mcpCall(c, 'find', { program_id: 'kiroween-2026', project: IDEA });
  assert.equal(again.reply!.show_to_builder, 'Kiroween 2026, $100,000 in prizes: a demo video and /.kiro directory at the repo root. First: join Kiroween 2026 with a Devpost account; sign up for a Kiro account (free credits by Dec 1). Their rule: built with Kiro.\nTell me when that is done and I apply.');
  assert.ok(!(again.reply!.verdict as { gaps: { kind: string }[] }).gaps.some((x) => x.kind === 'new_work_after'));
  // A first-commit date in the project settles it too: after the start fits, before it does not.
  const late = await mcpCall(c, 'find', { program_id: 'ugreen-ai-nas-hackathon-2026', project: { ...IDEA, first_commit_at: '2026-10-25T00:00:00Z' } });
  assert.ok(!(late.reply!.verdict as { gaps: { kind: string }[] }).gaps.some((x) => x.kind === 'new_work_after'));
  const early = await mcpCall(c, 'find', { program_id: 'ugreen-ai-nas-hackathon-2026', project: { ...IDEA, first_commit_at: '2026-01-01T00:00:00Z' } });
  assert.equal((early.reply!.verdict as { status: string }).status, 'no');
});

test('O4 (v6.1.10): the no-project open list marks each in-person program', async () => {
  const r = await mcpCall(ctx(await installation()), 'find', {});
  const show = r.reply!.show_to_builder as string;
  const lines = show.split('\n');
  for (const l of ['Monad Blitz Oregon, $4,600 prize pool, closes in 6 days, in person.', 'Alliance ALL19, $400K at admission, closes in 14 days, in person.', 'Solana Incubator Cohort 6, NYC incubator with relocation stipend, closes in 30 days, in person.', 'Kiroween 2026, $100,000 in prizes, closes in 30 days.'])
    assert.ok(lines.includes(l), show);
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
  assert.equal(line, '1. Night Grant, Up to $5,000. Drafted: 3 of 4 answers. Needs your problem.');
  const night = (bare.reply!.ready as { program_id: string; need_you: string[]; needs: string[] }[]).find((p) => p.program_id === 'f1-night')!;
  assert.deepEqual([night.need_you, night.needs], [['the problem'], ['the problem']]);
  // Off the tonight list, named as waiting (F1).
  assert.doesNotMatch(show.split('\n\n').at(-1)!, /Night Grant/);
  assert.match(show, /Before tonight \(nothing is sent until these are in\): [^\n]*your problem for [^\n]*Night Grant/);
  // With a repo the same line, and the record is never asked for a project with its repo or site (lane 8 #10).
  const repo = await mcpCall(c, 'find', { project: { ...PROJECT, name: 'Night App' } });
  assert.ok(!(repo.reply!.record_missing as string[]).includes('a project with its repo or site'), JSON.stringify(repo.reply!.record_missing));
  // N5 (v6.1.12): a live link passed is the site, so it is not asked for either; with no link at all it is.
  assert.ok(!(bare.reply!.record_missing as string[]).includes('a project with its repo or site'), JSON.stringify(bare.reply!.record_missing));
  const none = await mcpCall(c, 'find', { project: { name: 'Night App', description: 'Night shifts for nurses.' } });
  assert.ok((none.reply!.record_missing as string[]).includes('a project with its repo or site'));
});

test('F3 and fix round 1 (v6.1.10), N3 (v6.1.12): the users yes and the rule yes stand for a fully ready program; with answers missing the closing names them', async () => {
  const CLI = { name: 'ripgrep', description: 'A line-oriented search tool for the command line.', live_url: 'https://ripgrep.dev' };
  const c = ctx(await installation());
  const ask = await mcpCall(c, 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  assert.equal((ask.reply!.show_to_builder as string).split('\n').at(-1), 'Say yes if they do and I draft it.');
  await mcpCall(c, 'track', { program_id: 'floss-fund-zerodha', status: 'gap_done', item: 'users', project: CLI });
  // FLOSS/fund still needs its manifest link: its line says so and the closing asks for it, never a second yes (N3,
  // v6.1.12), on the detail and in the list alike.
  const floss = await mcpCall(c, 'find', { program_id: 'floss-fund-zerodha', project: CLI });
  // Review Focus 1 (v6.1.14): the closing names the manifest link, so line 1 does not.
  assert.equal(floss.reply!.show_to_builder, ['FLOSS/fund, $10,000 to $100,000. First: publish a funding manifest on your site or repo.', 'FLOSS/fund needs your funding manifest link; then I apply.'].join('\n'));
  const listed = await mcpCall(c, 'find', { project: CLI });
  assert.match((listed.reply!.show_to_builder as string).split('\n\n').at(-1)!, /^FLOSS\/fund needs your funding manifest link; then I apply\.( Say yes and I apply(?: to all \d+\. Or say the numbers to skip)?\.)?$/);
  assert.equal((listed.reply!.show_to_builder as string).match(/funding manifest link/g)!.length, 1, listed.reply!.show_to_builder as string);
  // Fully ready (the one answer is the agent's draft): the yes stands, for the users yes and the rule yes alike.
  const { programFixture } = await import('./fixtures/program');
  const { ruleItem } = await import('./eligibility');
  await upsertProgram(programFixture({ id: 'f3-used', title: 'Used Grant', eligibility: [{ kind: 'users' }] }), 'file', NOW);
  await upsertProgram(programFixture({ id: 'f3-rule', title: 'Rule Grant', eligibility: [{ kind: 'rule', note: 'a solo builder' }] }), 'file', NOW);
  // L1e-4 (v6.1.13): the users yes said to FLOSS/fund is a fact about the project, so this program's users question is
  // answered too; the yes to send was said to FLOSS/fund alone, so the closing asks it here.
  const used0 = await mcpCall(c, 'find', { program_id: 'f3-used', project: CLI });
  assert.equal(used0.reply!.show_to_builder, ['Used Grant, Up to $5,000. Drafted: 1 of 1 answer.', 'Say yes and I apply.'].join('\n'));
  assert.doesNotMatch(used0.reply!.show_to_builder as string, /real people use it/);
  // Final round (I2): users: true the agent passed settles the users item (ready), but the builder said nothing, so
  // the closing asks for the yes; only gap_done users (the builder's yes relayed) makes it stand.
  const passed = await mcpCall(c, 'find', { program_id: 'f3-used', project: { ...CLI, users: true } });
  assert.equal((passed.reply!.verdict as { status: string }).status, 'ready');
  assert.equal(passed.reply!.show_to_builder, ['Used Grant, Up to $5,000. Drafted: 1 of 1 answer.', 'Say yes and I apply.'].join('\n'));
  assert.doesNotMatch(JSON.stringify(passed.reply), /yes stands/);
  await mcpCall(c, 'track', { program_id: 'f3-used', status: 'gap_done', item: 'users', project: CLI });
  const used = await mcpCall(c, 'find', { program_id: 'f3-used', project: CLI });
  assert.equal(used.reply!.show_to_builder, ['Used Grant, Up to $5,000. Drafted: 1 of 1 answer.', 'Your yes stands for Used Grant: I apply now.'].join('\n'));
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
    `https://github.com:8443/${rec.repo}`, `${repo}.git?x=1`, `https://me@github.com/${rec.repo}`, `https://GitHub.com/${owner.toUpperCase()}/${name}/`,
  ];
  for (const spelled of spellings) {
    const c = ctx(await installation());
    assert.equal(await status(c, 'rf3-demo', PROJECT), 'gap', spelled);
    const done = await mcpCall(c, 'track', { program_id: 'rf3-demo', status: 'gap_done', item: 'demo_video', project: { ...PROJECT, repo_url: spelled } });
    assert.equal(done.isError, false, done.text);
    assert.equal(await status(c, 'rf3-demo', PROJECT), 'ready', spelled);
    // And the other way: the find spelled so reads the step marked on the plain link.
    assert.equal(await status(c, 'rf3-demo', { ...PROJECT, repo_url: spelled }), 'ready', spelled);
  }
  // Found by name first: the step done and the claim move to the repo key on the first find with the repo.
  const c = ctx(await installation());
  const NAMED = { name: 'Keyed App', description: 'Grants for builders.' };
  assert.equal(await status(c, 'rf3-demo', NAMED), 'gap');
  await mcpCall(c, 'track', { program_id: 'rf3-demo', status: 'gap_done', item: 'demo_video' });
  await mcpCall(c, 'track', { program_id: 'rf3-two', status: 'started', project: NAMED });
  assert.equal(await status(c, 'rf3-demo', { ...NAMED, repo_url: `${repo}/tree/main` }), 'ready');
  const owned = 'i:' + c.installationId;
  assert.deepEqual((await sql()`SELECT DISTINCT project_key FROM gaps_done WHERE owner = ${owned}`).map((r) => r.project_key), [repo.toLowerCase()]);
  const [claimRow] = await sql()`SELECT project_id FROM applications WHERE owner = ${owned} AND program_id = 'rf3-two'`;
  assert.equal(claimRow.project_id, repo.toLowerCase());
  // A step under both keys keeps the newer time.
  const older = new Date(NOW.getTime() - 2 * H);
  await sql()`INSERT INTO gaps_done (owner, installation_id, project_key, program_id, item, at) VALUES (${owned}, ${c.installationId}, 'name:keyed app', 'rf3-demo', 'demo_video', ${new Date(NOW.getTime() + H)})`;
  await sql()`UPDATE gaps_done SET at = ${older} WHERE owner = ${owned} AND project_key = ${repo.toLowerCase()}`;
  await mcpCall(c, 'find', { program_id: 'rf3-demo', project: { ...NAMED, repo_url: repo } });
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

test('L13-8, L12-1 (v6.1.14): another agent\'s claim with no project holds the program on this list, by default and in filter.all, out of the yes', async () => {
  const { id, builderId } = await linkedWith(OWNER_RECORD);
  const { claim } = await import('../v6/claims');
  const [other] = await sql()`INSERT INTO installations (token_hash, client_name) VALUES (${'find-l138-' + Math.random()}, 'Cursor') RETURNING id`;
  const { linkInstallation } = await import('../v6/builders');
  await linkInstallation(other.id as number, builderId, NOW);
  await claim(`b:${builderId}`, 'arbitrum-mentorship-cohort-2', null, other.id as number, new Date(NOW.getTime() - H));
  for (const filter of [undefined, { all: true }]) {
    const r = await mcpCall({ ...ctx(id), builderId, evidence: LIVE }, 'find', { project: PROJECT, ...(filter ? { filter } : {}) });
    const ready = r.reply!.ready as { program_id: string; claimed_since?: string }[];
    assert.equal(ready.find((p) => p.program_id === 'arbitrum-mentorship-cohort-2')?.claimed_since, new Date(NOW.getTime() - H).toISOString(), JSON.stringify(filter));
    const show = r.reply!.show_to_builder as string;
    assert.match(show.split('\n').find((l) => l.includes('Arbitrum Mentorship Program'))!, / Being handled by your other agent since 11:00 UTC\.$/);
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
    // More go tonight than the default list shows.
    const shown = (byDefault.reply!.ready as { in_person: boolean }[]).filter((p) => !p.in_person).length;
    assert.ok(tonight.programs.length > shown, `${tonight.programs.length} vs ${shown}`);
    const line = (r: typeof all) => /Applying tonight to [^\n]+?\. Say stop to hold any\./.exec(r.reply!.show_to_builder as string)?.[0];
    assert.ok(line(byDefault));
    assert.equal(line(byDefault), line(all));
    assert.match(byDefault.reply!.agent_note as string, /Tonight's list names programs past the shown list: call find with program_id for each one's fields before you send it\./);
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
