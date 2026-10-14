import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { bindX } from './claim';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { tools } from './tools';
import { scoreReply } from './score-tool';
import { EVENT_LOG_FLAG } from './events';
import { HEADS, SEND_LINK_LINE } from './where-you-stand';
import type { ReaderDeps } from './source-readers';

/**
 * v2.12.1 T8: find's three-part reply through the real tool, flag on: the target user, apps none
 * live, someone with traction, nothing found; the claim link only with X set; the one-time "Your
 * page is ready"; news only when something real happened; the card and move-up answers; the 8 s
 * refresh budget; flag off is v2.11. The person's projects and standing are seeded as Task 4's
 * rescore writes them, with the refresh guard set (read_at now), so find reads them as they are.
 */

process.env.EARNKIT_AUTH_SECRET ||= 'v2121-find-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const NOW = new Date();
const DAY = 86_400_000;
const X_ON = { X_CLIENT_ID: 'v2121-x-id', X_CLIENT_SECRET: 'v2121-x-secret' };

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const was: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    was[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(was)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
/** The builder score flag on (and the event log), with X sign-in set unless `x` is false. */
const scoreOn = <T>(fn: () => Promise<T>, o: { x?: boolean } = {}) =>
  withEnv({ EARNKIT_BUILDER_SCORE: 'on', [EVENT_LOG_FLAG]: 'on', ...(o.x === false ? { X_CLIENT_ID: undefined, X_CLIENT_SECRET: undefined } : X_ON) }, fn);

async function install(): Promise<number> {
  const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v2121-find-${randomBytes(8).toString('hex')}`}) RETURNING id`;
  return id;
}

type Seed = { key: string; name: string; what?: string | null; kind?: string; shipped?: boolean; confirmed?: boolean; people?: number; sends_tx?: boolean; untracked?: string | null };
/** A person as Task 4's rescore leaves them: a profile, a live row (refreshed just now) and their projects. */
async function person(o: { projects: Seed[]; score?: number; ranked?: boolean; seen?: Record<string, unknown> }): Promise<number> {
  const id = await install();
  await sql()`INSERT INTO builder_profiles (builder_id, slug, standing_seen) VALUES (${id}, ${`v2121f-${id}`}, ${sql().json((o.seen ?? {}) as never)})`;
  await sql()`
    INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, computed_at, read_at)
    VALUES (${id}, ${o.score ?? 0}, '{}'::jsonb, ${o.ranked ?? false}, ${o.projects.filter((p) => p.shipped !== false).length}, 0, 'v2', 'v2-launch', now(), now())`;
  for (const [i, p] of o.projects.entries())
    await sql()`
      INSERT INTO builder_projects (builder_id, project_key, name, what, link, kind, confirmed, shipped, people, sends_tx, untracked_contract, last_active_at)
      VALUES (${id}, ${p.key}, ${p.name}, ${p.what ?? null}, null, ${p.kind ?? 'app'}, ${p.confirmed ?? false}, ${p.shipped ?? true}, ${p.people ?? 0},
        ${p.sends_tx ?? false}, ${p.untracked ?? null}, ${new Date(NOW.getTime() - i * DAY)})`;
  return id;
}

/** A program the target user's tip jar fits (a copy of Avalanche Team1 Mini Grants: up to $10K, rolling). */
let program: { id: string; title: string } | null = null;
async function avalanche() {
  if (program) return program;
  const p = { ...committedProgram('avalanche-team1-mini-grants'), id: `v2121-ava-${randomBytes(4).toString('hex')}`, status: 'active' };
  await upsertProgram(ProgramFile.parse(p));
  program = { id: p.id, title: p.title };
  return program;
}
const GOOD = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };
const fitsFor = (programId: string) => [
  {
    repo: 'TipJar', repo_url: 'https://github.com/lee/tipjar', key: 'lee/tipjar',
    verdicts: [{ program_id: programId, program: programId, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }],
    product: GOOD,
  },
];

type Found = { programs: { title: string }[]; show_to_builder: string; claim?: { link: string }; move_up?: { kind: string; project_key: string | null }; lead?: { program_id: string }; note: string };
const find = (id: number, input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  tools.find(input, { installationId: id, ...extra } as never) as Promise<Found>;

/** Every open program's title (names are exempt from the copy rule's word list). */
const titles = (r: Found) => (r.programs ?? []).map((x) => x.title);

/** The copy rule: no technical word, no em dash, no emoji, no v2.12 line; names (program titles, project names) are exempt. */
function plain(reply: string, names: string[]) {
  let text = reply;
  for (const n of names) text = text.split(n).join('');
  assert.doesNotMatch(text, /\b(outcome|percentile|verified source|contract|wallet address|builder code|repo|commit|onchain|base|arc|monad|tempo|ethereum|robinhood chain)\b/i, reply);
  assert.doesNotMatch(text, /—|[\u{1F300}-\u{1FAFF}]/u, reply);
  assert.doesNotMatch(reply, /\bscore\b|\btop \d+%.*builders\b|earnkit\.com\/b\/|Say hide anytime/, reply);
  assert.ok((reply.match(/\?/g) ?? []).length <= 1, `one question at most: ${reply}`);
  // Never a period right after a link.
  assert.doesNotMatch(reply, /earnkit\.com\/\S+\.(\s|$)/, reply);
}

test('8.12 the target user: 3 live apps, no users, a program for the tip jar (spec example 1, unranked)', dbTest, () =>
  scoreOn(async () => {
    const p = await avalanche();
    const id = await person({
      projects: [
        { key: 'lee/tipjar', name: 'TipJar', what: 'a tip jar', sends_tx: true },
        { key: 'lee/recipes', name: 'Recipes', what: 'A recipe planner.' },
        { key: 'lee/budget', name: 'Budget', what: 'a budget tracker' },
      ],
    });
    const r = await find(id, { local_repos: [{ name: 'TipJar' }] }, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id) }) });
    const link = r.claim?.link;
    assert.match(link ?? '', /^earnkit\.com\/claim\/[a-z2-7]{12}$/);
    assert.equal(r.show_to_builder,
`Where you stand
You've shipped 3 apps with AI: a tip jar, a recipe planner and a budget tracker.
Claim your page with X: ${link}

Ways to earn right now
Your tip jar fits ${p.title}: up to $10K, open all year. I can prepare the entry.

How to move up
Your tip jar has a payment side people could use. Want me to make it count the people who pay you? You won't have to do anything.`);
    assert.deepEqual(r.lead, { program_id: p.id, repo: 'TipJar' });
    assert.deepEqual(r.move_up && { kind: r.move_up.kind, project_key: r.move_up.project_key }, { kind: 'tag_future', project_key: 'lee/tipjar' });
    plain(r.show_to_builder, [p.title, 'TipJar', ...titles(r)]);
    // Without X sign-in: no claim link anywhere.
    const off = await withEnv({ X_CLIENT_ID: undefined, X_CLIENT_SECRET: undefined }, () => find(id));
    assert.doesNotMatch(off.show_to_builder, /Claim your page/);
    assert.ok(!('claim' in off));
  }),
);

test('8.13 apps the agent named, none live (ruling S15): named, "None is live yet.", and the one yes puts one online', dbTest, () =>
  scoreOn(async () => {
    const id = await person({
      projects: [
        { key: 'lee/recipes', name: 'Recipes', what: 'a recipe planner', shipped: false },
        { key: 'lee/budget', name: 'Budget', what: 'a budget tracker', shipped: false },
        { key: 'lee/tipjar', name: 'TipJar', what: 'a tip jar', shipped: false },
      ],
    });
    await avalanche();
    const r = await find(id);
    // The open-all-year program is the shared test database's biggest one: its line is checked by shape.
    // None is live, so no entry is offered with the program.
    const earn = /\n\nWays to earn right now\nYou could win (up to \$[\d.]+K?M?) from (.+); it's open all year\.\n\n/.exec(r.show_to_builder);
    assert.ok(earn, r.show_to_builder);
    assert.equal(r.show_to_builder,
`Where you stand
You've made 3 apps with AI: a recipe planner, a budget tracker and a tip jar. None is live yet.
Claim your page with X: ${r.claim!.link}

Ways to earn right now
You could win ${earn[1]} from ${earn[2]}; it's open all year.

How to move up
Want me to put your recipe planner online? It takes a few minutes and you won't have to do anything.`);
    assert.deepEqual(r.move_up && { kind: r.move_up.kind, project_key: r.move_up.project_key }, { kind: 'go_live', project_key: 'lee/recipes' });
    // A chat-only agent with hosting off can't put it online: the link ask.
    const chat = await find(id, { agent_can_build: false });
    assert.ok(chat.show_to_builder.endsWith(`How to move up\n${SEND_LINK_LINE}`), chat.show_to_builder);
    assert.match(chat.note, /identity\.projects/);
    plain(r.show_to_builder, titles(r));
  }),
);

test('8.14 someone with traction leads with the rank; people not counted yet are the step (spec example 2)', dbTest, () =>
  scoreOn(async () => {
    const id = await person({
      score: 100, ranked: true,
      projects: [
        { key: 'tf', name: 'tokens.fun', kind: 'contract', confirmed: true, people: 12, untracked: `base:0x${'a'.repeat(40)}` },
        { key: 'lee/x2', name: 'X2', confirmed: true, people: 3 },
        ...['c', 'd', 'e', 'f'].map((k) => ({ key: `lee/${k}`, name: k.toUpperCase(), confirmed: true })),
      ],
    });
    const r = await find(id);
    // The shared test database ranks other files' people too: either wording reads well at the top.
    assert.match(r.show_to_builder, /^Where you stand\nYou're (#1 of \d+ builders? on EarnKit|in the top [12]% of people building with AI)\. You've shipped 6 projects, and 2 of them have people using them\.\nClaim your page with X: earnkit\.com\/claim\/[a-z2-7]{12}\n\n(Ways to earn right now\n[^\n]+\n\n)?How to move up\ntokens\.fun has people using it who aren't counted yet\. Want me to count them\? I'll send you a link to show it's yours\.$/);
    assert.equal(r.move_up?.kind, 'count_past');
    plain(r.show_to_builder, ['tokens.fun', ...titles(r)]);
  }),
);

test('8.15 nothing found: no claim line, an open-all-year program to earn from, the send-a-link step, and no rank', dbTest, () =>
  scoreOn(async () => {
    const id = await person({ projects: [] });
    // Fix round 1: every reply has a way to earn. With no build on, the best open-all-year program.
    await avalanche();
    const r = await find(id);
    assert.match(r.show_to_builder, /^Where you stand\nI couldn't find anything you've made yet\.\n\nWays to earn right now\nYou could win .+ from .+; it's open all year\.\n\nHow to move up\n/);
    assert.ok(r.show_to_builder.endsWith(SEND_LINK_LINE));
    assert.ok(!('move_up' in r));

  }),
);

test('8.16 a fresh install with identity: the three parts in order within 10 s, though the reader takes 20 s', dbTest, () =>
  scoreOn(async () => {
    const id = await install();
    const sleep = () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow')), 20_000).unref());
    const slow = new Proxy({}, { get: (_t, k) => (k === 'now' ? NOW : sleep) }) as ReaderDeps;
    const p = await avalanche();
    const t0 = Date.now();
    const r = await find(
      id,
      { identity: { github_login: 'leev2121', projects: [{ name: 'TipJar', what: 'a tip jar', repo: 'leev2121/tipjar' }] }, local_repos: [{ name: 'TipJar' }] },
      { readerDeps: slow, matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id) }) },
    );
    assert.ok(Date.now() - t0 < 10_000, `took ${Date.now() - t0} ms`);
    const heads = r.show_to_builder.split('\n').filter((l) => (Object.values(HEADS) as string[]).includes(l));
    assert.deepEqual(heads, [HEADS.stand, HEADS.earn, HEADS.up], r.show_to_builder);
    plain(r.show_to_builder, [p.title, 'TipJar', 'tipjar', ...titles(r)]);
    assert.match(r.claim?.link ?? '', /^earnkit\.com\/claim\//);
  }),
);

test('8.17 a v2.11 builder\'s first find with the flag on: "Your page is ready" once, the link once; then the claim line', dbTest, () =>
  scoreOn(async () => {
    const id = await person({ projects: [{ key: 'lee/tipjar', name: 'TipJar', what: 'a tip jar' }] });
    await sql()`UPDATE installations SET programs_checked_at = ${new Date(NOW.getTime() - 3 * DAY)} WHERE id = ${id}`;
    const one = await find(id);
    const link = one.claim!.link;
    assert.ok(one.show_to_builder.startsWith(`Since you last checked: Your EarnKit page is ready. Claim it with X: ${link}\n\nWhere you stand\n`), one.show_to_builder);
    assert.equal(one.show_to_builder.split(link).length, 2, 'the link shows once');
    assert.doesNotMatch(one.show_to_builder, /Claim your page with X/);
    const two = await find(id);
    assert.doesNotMatch(two.show_to_builder, /page is ready/);
    assert.match(two.show_to_builder, new RegExp(`^Claim your page with X: ${link.replace(/\./g, '\\.')}$`, 'm'));
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'page_ready_shown' AND installation_id = ${id}`;
    assert.equal(n, 1);
    // A brand-new builder (no find before) never sees it; nor does a v2.11 builder with nothing found (no page yet).
    const fresh = await person({ projects: [{ key: 'lee/a', name: 'A' }] });
    assert.doesNotMatch((await find(fresh)).show_to_builder, /page is ready/);
    const empty = await install();
    await sql()`UPDATE installations SET programs_checked_at = ${new Date(NOW.getTime() - 3 * DAY)} WHERE id = ${empty}`;
    const none = await find(empty, {}, { readerDeps: new Proxy({}, { get: (_t, k) => (k === 'now' ? NOW : async () => { throw new Error('offline'); }) }) });
    assert.doesNotMatch(none.show_to_builder, /page is ready|Claim/);
  }),
);

test('8.18 news only when something real happened; the card is asked only when nothing else asks; its yes is the claim link first', dbTest, () =>
  scoreOn(async () => {
    const seen = { people: { 'lee/notes': 2 }, at: new Date(NOW.getTime() - 3 * DAY).toISOString() };
    const id = await person({ seen, projects: [{ key: 'lee/notes', name: 'Notes', what: 'a notes app', confirmed: true, people: 14 }] });
    const r = await find(id);
    assert.ok(r.show_to_builder.startsWith('Since you last checked: 12 new people used Notes this week. Want a card to share it?\n\nWhere you stand\nYou\'ve shipped 1 app, and people are using it.\n'), r.show_to_builder);
    assert.ok(!r.show_to_builder.includes(HEADS.up), 'no step: the card is the one question');
    const [p] = await sql()<{ card_moments: { latest?: string }; standing_seen: { people?: Record<string, number> } }[]>`
      SELECT card_moments, standing_seen FROM builder_profiles WHERE builder_id = ${id}`;
    assert.equal(p.card_moments.latest, 'people');
    assert.equal(p.standing_seen.people?.['lee/notes'], 14);
    // Nothing new since: no news.
    assert.doesNotMatch((await find(id)).show_to_builder, /Since you last checked/);
    const yes = (await tools.tell({ card: 'yes' }, { installationId: id } as never)) as { show_to_builder: string };
    assert.match(yes.show_to_builder, /^Claim your page with X first: earnkit\.com\/claim\/[a-z2-7]{12}$/);
    // A first look records where they stand and says nothing.
    const first = await person({ projects: [{ key: 'lee/n2', name: 'N2', confirmed: true, people: 40 }] });
    assert.doesNotMatch((await find(first)).show_to_builder, /Since you last checked/);
  }),
);

test('8.19 a claimed person: their page, work not confirmed yet is the step, and its yes re-issues the link (T7 carry); the card yes is the share link', dbTest, () =>
  scoreOn(async () => {
    const id = await person({ projects: [{ key: 'lee/tipjar', name: 'TipJar', what: 'a tip jar', confirmed: false }] });
    const handle = `v2121${randomBytes(3).toString('hex')}`;
    const bound = await bindX(id, { id: `v2121x${randomBytes(6).toString('hex')}`, username: handle, name: handle, avatar: null }, NOW);
    assert.equal(bound.ok, true);
    // bindX clears the refresh guard; set it again so find reads the seeded projects.
    await sql()`UPDATE builder_live SET read_at = now() WHERE builder_id = ${id}`;
    const r = await find(id);
    assert.match(r.show_to_builder, new RegExp(`^Your page: earnkit\\.com/${handle}$`, 'm'));
    assert.ok(r.show_to_builder.endsWith("How to move up\nYour tip jar isn't confirmed as yours yet, so it doesn't count. Want a link to show it's yours? It takes one tap."), r.show_to_builder);
    assert.deepEqual(r.move_up && { kind: r.move_up.kind, project_key: r.move_up.project_key }, { kind: 'confirm', project_key: 'lee/tipjar' });
    assert.ok(!('claim' in r));
    const yes = (await tools.tell({ move_up: { kind: 'confirm', project_key: 'lee/tipjar', answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string };
    assert.match(yes.show_to_builder, /^Open this to show it's yours\. It works for 30 minutes: https:\/\/earnkit\.com\/claim\/wallet\?t=\S+$/);
    // v2.12.1 T9: a no is "Okay." and that step is not offered again for 30 days.
    const no = (await tools.tell({ move_up: { kind: 'confirm', project_key: 'lee/tipjar', answer: 'no' } }, { installationId: id } as never)) as { show_to_builder: string };
    assert.equal(no.show_to_builder, 'Okay.');
    const card = (await tools.tell({ card: 'yes' }, { installationId: id } as never)) as { show_to_builder: string };
    assert.equal(card.show_to_builder, `Post it: https://earnkit.com/${handle}/share`);
    // The score tool: the same view without programs, and the same step.
    const s = await scoreReply({ installationId: id }, NOW);
    assert.match(s.show_to_builder, /^Where you stand\nYou've shipped 1 app with AI: a tip jar\.\nYour page: /);
    // Fix round 1: one way to earn in the score reply too.
    assert.equal(s.show_to_builder.split('\n\n')[1]?.split('\n')[0], HEADS.earn);
    assert.notEqual(s.move_up?.kind, 'confirm', 'declined: not offered again for 30 days');
  }),
);

test('8.20 the flag off: find is v2.11 (no headings, no profile) and tell ignores move_up as an empty tell', dbTest, async () => {
  const id = await install();
  const r = await find(id);
  assert.doesNotMatch(r.show_to_builder, /Where you stand|Claim your page/);
  const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_profiles WHERE builder_id = ${id}`;
  assert.equal(n, 0);
  await assert.rejects(tools.tell({ move_up: { answer: 'yes' } }, { installationId: id } as never), /Pass at least one/);
});

test('8.21 a shared client never sees the view: find is the v2.11 short reply, and move_up gets an agent note', dbTest, () =>
  scoreOn(async () => {
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${`v2121-find-s-${randomBytes(6).toString('hex')}`}, true) RETURNING id`;
    const r = await find(id, {}, { sharedClient: true });
    assert.doesNotMatch(r.show_to_builder, /Where you stand/);
    const t = (await tools.tell({ move_up: { answer: 'yes' } }, { installationId: id, sharedClient: true } as never)) as { show_to_builder?: string; agent_note?: string };
    assert.equal(t.show_to_builder ?? '', '');
    assert.match(t.agent_note ?? '', /serves many builders/);
  }),
);

test('8.22 (fix round 1) a project that only waits on people using it: the earn part says what it could win', dbTest, () =>
  scoreOn(async () => {
    const p = await avalanche();
    const id = await person({ projects: [{ key: 'lee/recipes', name: 'Recipes', what: 'a recipe planner', confirmed: true }] });
    const fits = [{
      repo: 'Recipes', repo_url: 'https://github.com/lee/recipes', key: 'lee/recipes',
      verdicts: [{ program_id: p.id, program: p.id, status: 'maybe' as const, missing: ['real_users' as const], effort: 'hours' as const, note: null }],
      product: { ...GOOD, missing: [] }, facts: { created_at: '2024-01-01T00:00:00Z', claims: [] },
    }];
    const r = await find(id, { local_repos: [{ name: 'Recipes' }] }, { matchProjects: async () => ({ checked: 1, scored: 1, fits }) });
    assert.match(r.show_to_builder, new RegExp(`\\n\\nWays to earn right now\\nYour recipe planner could win up to \\$10K from ${p.title} once people use it\\.(\\n|$)`), r.show_to_builder);
    plain(r.show_to_builder, [p.title, ...titles(r)]);
  }),
);

test('8.23 (fix round 1) the server decides the step: a note-following agent without kind gets the confirm link; a wrong kind changes nothing', dbTest, () =>
  scoreOn(async () => {
    const id = await person({ projects: [{ key: 'lee/tipjar', name: 'TipJar', what: 'a tip jar', confirmed: false }] });
    const handle = `v2121${randomBytes(3).toString('hex')}`;
    assert.equal((await bindX(id, { id: `v2121y${randomBytes(6).toString('hex')}`, username: handle, name: handle, avatar: null }, NOW)).ok, true);
    await sql()`UPDATE builder_live SET read_at = now() WHERE builder_id = ${id}`;
    for (const move_up of [{ project_key: 'lee/tipjar', answer: 'yes' as const }, { kind: 'coin', project_key: 'x', answer: 'yes' as const }]) {
      const yes = (await tools.tell({ move_up }, { installationId: id } as never)) as { show_to_builder: string };
      assert.match(yes.show_to_builder, /^Open this to show it's yours\. It works for 30 minutes: https:\/\/earnkit\.com\/claim\/wallet\?t=\S+$/);
    }
    // An unclaimed person whose step is not confirm: a claimed-only kind passed by the agent is ignored.
    const other = await person({ projects: [{ key: 'lee/n', name: 'Notes', what: 'a notes app', confirmed: false }] });
    const r = (await tools.tell({ move_up: { kind: 'confirm', answer: 'yes' } }, { installationId: other } as never)) as { show_to_builder: string; agent_note?: string };
    // v2.12.1 T9: no step to answer: "Okay." and nothing changes.
    assert.equal(r.show_to_builder, 'Okay.');
    assert.equal(r.agent_note, undefined);
  }),
);

test('8.24 (fix round 1) the score reply has one way to earn: the best program a remembered project can win, else an open-all-year one', dbTest, () =>
  scoreOn(async () => {
    const id = await person({ projects: [{ key: 'lee/notes', name: 'Notes', what: 'a notes app', confirmed: true }] });
    const s = await scoreReply({ installationId: id }, NOW);
    const parts = s.show_to_builder.split('\n\n');
    assert.equal(parts[1].split('\n')[0], HEADS.earn, s.show_to_builder);
    assert.equal(parts[1].split('\n').length, 2, 'one earn line');
    assert.match(parts[1], /open all year/);
  }),
);
