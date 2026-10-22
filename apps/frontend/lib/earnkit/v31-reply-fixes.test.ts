import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { padPool } from './fixtures/rank-pool';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { QUALIFY_STEPS_NOTE, TITLES_NOTE, QUALIFY_NOTE } from './bench-find';
import {
  TITLES_ASK, benchReply, grantHook, qualifyAsk, qualifyMissing, qualifySteps, stateAsk, type BenchView, type OpenGrant, type QualifyOffer,
} from './bench-reply';
import { grantOf, qualifyOffer, qualifyPlan, qualifyStatus } from './base-qualify';
import { BASE_GRANTS_ID } from './builder-code';
import { UPDATE_LINES } from './updates';
import { PICK_PAGE, APP_PAGE } from './github-app';
import { matchRepo, productOdds, productScore, traction, type Detection, type ProgramFacts, type RepoFacts } from './match';
import type { Card, RepoFit } from './present';

/**
 * 2026-10-22 owner-approved reply fixes: no points in the first two replies, the honest hook ("for apps on Base"), the
 * no-fit path to Base Builder Grants (its steps only from the program's rules and the matcher's missing reasons), plain
 * words on step 2 and the App pages, and a private repo's titles question. Each reply: at most one https link, exactly
 * one question.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-reply-fixes-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const rule = (s: string) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}/u, s);
  return s;
};

const BASE: OpenGrant = { org: 'Base', amount: '$5,000', chain: 'Base' };
const GUIDE = 'https://docs.base.org/base-chain/builder-codes/builder-codes';

test('the hook names the grant from its program facts', () => {
  const card = (o: Partial<Card>): Card => ({ id: 'p', title: 'P', summary: '', tag: null, each_time: [], status: 'active', ...o });
  assert.deepEqual(grantOf(card({ organizer: 'Base', chains: ['base'], max_award_usd: 5000 })), BASE);
  assert.equal(grantHook(BASE), 'Base pays up to $5,000 for apps on Base.');
  const arc = grantOf(card({ organizer: 'Arc House (Circle)', any_chain: true, max_award_usd: 10000 }))!;
  assert.equal(grantHook(arc), 'Arc House pays up to $10,000 for apps.');
  assert.equal(grantOf(card({ organizer: 'Base', chains: ['base'] })), null, 'no award: no hook');
});

test('the no-fit path: missing reasons from the matcher, steps only those not known met', () => {
  const base: ProgramFacts = { id: BASE_GRANTS_ID, title: 'Base Builder Grant Program', chains: ['base'], any_chain: false, existing_work: 'allowed', tag: 'needs a live product', starts_at: null, investment: false, min_product_score: 0 };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const product = { ...ps, traction: traction({ tx_count: 0, live_ok: false, commits_90d: 25 }), ...productOdds(ps, { tx_count: 0, live_ok: false, commits_90d: 25 }, ps.score) };
  const repo = (chains: Detection, o: Partial<RepoFacts> = {}): RepoFacts => ({ name: 'kit', url: 'https://github.com/m/kit', homepage: null, created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, ...o });
  const at = (f: RepoFacts) => ({ v: matchRepo(f, [base])[0] ?? null, chains: f.chains });
  const deployed: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };

  // Not on Base at all: no row; Base missing, use unknown; no Builder Codes.
  const none = qualifyPlan(BASE, qualifyStatus(at(repo({})), false))!;
  assert.deepEqual([none.missing, none.steps], [['base', 'codes'], ['base', 'codes', 'use']]);
  // Deployed on Base, no live link or users: Base met.
  const live = qualifyPlan(BASE, qualifyStatus(at(repo(deployed)), false))!;
  assert.deepEqual([live.missing, live.steps], [['codes', 'use'], ['codes', 'use']]);
  // Testnet only: the matcher's mainnet_deploy reason.
  const testnet = qualifyPlan(BASE, qualifyStatus(at(repo({ base: { mainnet: false, testnet: true, evidence: 'config', basis: 'config' } as never })), true))!;
  assert.deepEqual(testnet.steps.includes('codes'), false, 'Builder Codes found: dropped');
  assert.ok(testnet.missing.includes('base'));
  // Never matched and the check never ran: every step, none named missing.
  const unknown = qualifyPlan(BASE, qualifyStatus(null, null))!;
  assert.deepEqual([unknown.missing, unknown.steps], [[], ['base', 'codes', 'use']]);
  // Every step known met: no offer (never a claim of eligibility).
  const users = repo(deployed, { homepage: 'https://kit.app', tx_count: 500, live_verified: true });
  assert.equal(qualifyStatus(at(users), true).use, 'met');
  assert.equal(qualifyPlan(BASE, qualifyStatus(at(users), true)), null);
});

test('the no-fit copy, word for word', () => {
  assert.equal(qualifyMissing('Kit', ['base', 'codes', 'use']), 'To qualify, Kit still needs to go live on Base, add Builder Codes and get people using it.');
  assert.equal(qualifyMissing('Kit', ['use']), 'To qualify, Kit still needs to get people using it.');
  assert.equal(qualifyMissing('Kit', []), null);
  assert.equal(qualifyAsk(BASE, 3), "Want the 3 steps to qualify for Base's $5,000 grant?");
  assert.equal(qualifyAsk(BASE, 2), "Want the 2 steps toward Base's $5,000 grant?");
  assert.equal(qualifyAsk(BASE, 1), "Want the next step toward Base's $5,000 grant?");
  const all = rule(qualifySteps(BASE, ['base', 'codes', 'use']));
  assert.equal(all, [
    "3 steps to qualify for Base's $5,000 grant:",
    '1. Build your app on Base.',
    `2. Add Builder Codes, Base's first step: ${GUIDE}`,
    '3. Have a live product people use.',
    '',
    'We check for Builder Codes daily, and your agent drafts the application when you qualify.',
    'Want help with the first one now?',
  ].join('\n'));
  assert.equal(rule(qualifySteps(BASE, ['use'])), [
    "Your next step toward Base's $5,000 grant:",
    '1. Have a live product people use.',
    '',
    'We check for Builder Codes daily, and your agent drafts the application when you qualify.',
    'Want help with the first one now?',
  ].join('\n'));

  // The ranked reply: the standing, the hook, what is missing, the one question, the ship points line.
  const q: QualifyOffer = { program_id: BASE_GRANTS_ID, grant: BASE, missing: ['codes', 'use'], steps: ['base', 'codes', 'use'] };
  const project = { key: 'maya/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const v = { state: 'ranked', variant: null, project, link: null, handle: 'maya' } as const;
  const view: BenchView = { ...v, rank: '#3 of 12 builders', streak: 4, target: null, handle: 'maya', fund: [], due: [], held: null, qualify: q, ask: stateAsk({ ...v, qualify: q }) };
  assert.equal(view.ask.kind, 'qualify');
  assert.equal(rule(benchReply(view)), [
    'Kit · #3 of 12 builders · 4 weeks in a row',
    'Base pays up to $5,000 for apps on Base.',
    'To qualify, Kit still needs to add Builder Codes and get people using it.',
    "Want the 3 steps to qualify for Base's $5,000 grant?",
    'Ship code this week: up to +100 points',
  ].join('\n'));
  // No offer: the ship step as before.
  assert.equal(stateAsk(v).line, 'Want me to suggest one small thing to ship?');
  // The titles question comes before it, once.
  assert.equal(stateAsk({ ...v, titles: true, qualify: q }).line, TITLES_ASK);
});

test('a closed or unlisted Base grant keeps the ship step', async () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const card = (o: Partial<Card>): Card => ({ id: BASE_GRANTS_ID, title: 'Base Builder Grant Program', summary: '', tag: null, each_time: [], status: 'active', organizer: 'Base', chains: ['base'], max_award_usd: 5000, ...o });
  const o = { skip: new Set<string>(), seen: {}, now, declineMs: 30 * DAY };
  assert.equal(await qualifyOffer(1, 'm/kit', { ...o, cards: [card({ status: 'closed' })] }), null);
  assert.equal(await qualifyOffer(1, 'm/kit', { ...o, cards: [] }), null, 'unlisted: not in the cards');
  assert.equal(await qualifyOffer(1, 'm/kit', { ...o, cards: [card({})], skip: new Set([BASE_GRANTS_ID]) }), null, 'hidden or entered');
  assert.equal(await qualifyOffer(1, 'm/kit', { ...o, cards: [card({})], seen: { declined: { 'qualify:m/kit': now.toISOString() } } }), null, 'a no within 30 days');
});

test('the App pages in plain words, with GitHub\'s own labels', () => {
  assert.equal(PICK_PAGE.none, 'Nothing was picked. Choose Only select repositories and pick your app. Then ask your agent for a new link.');
  assert.equal(APP_PAGE.notListed, "EarnKit can't read your app's code yet. Choose Only select repositories and pick your app. Then ask your agent for a new link.");
  assert.match(PICK_PAGE.noneCounted, /Made from someone's template\? Make a copy in your own account, then connect that\./);
});

/** A signed-in builder whose one project is ranked (pool of 13) with the connect offer answered. */
async function rankedBuilder(tag: string, o: { private: boolean; chains: Detection; codes: boolean | null }) {
  const t = `ek_v31rf${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c0 = (await connectInstallation(t))!;
  const handle = `rf${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(c0.own, { id: `95${tag}${RUN}`, username: handle, name: 'Kit Builder', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `${handle}/kit`.toLowerCase();
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 0, live_ok: false, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: null, created_at: '2025-01-01T00:00:00Z', chains: o.chains, commits_in_window: {}, product, tx_count: 0, commits_90d: 25 };
  // No verdicts: no program fits this project.
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, verdicts: [] }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  const commits = [0, 1, 2, 3].map((w) => ({ sha: `c${w}`, message: `Ship feature ${w}`, date: new Date(Date.now() - w * 7 * DAY - DAY).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: 9500 + Number(RUN.slice(-2)) + tag.charCodeAt(0), owner: handle, installation: 95, private: o.private, commits } });
  // As a first run does: step 2, then the repo named (the refresh already ran, so it never reads GitHub).
  await mcpCall({ ...ctx, matchProjects: (async () => ({ checked: 0, scored: 0, fits: [] })) as never }, 'find', {});
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  if (o.codes !== null) await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${key}, ${o.codes}, ${new Date()}) ON CONFLICT (repo_key) DO UPDATE SET found = EXCLUDED.found, checked_at = EXCLUDED.checked_at`;
  const r3 = await mcpCall(ctx, 'find', {});
  assert.equal((r3.reply?.move_up as { kind: string }).kind, 'connect', show(r3));
  return { c, ctx, key, handle };
}

test('no fit: the path to Base\'s grant, and its yes returns the remaining steps', db, async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);
  const deployed: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const { ctx, key } = await rankedBuilder('q', { private: false, chains: deployed, codes: false });
  // The connect yes (no Best fit, a public repo: no titles question).
  assert.doesNotMatch(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } })), /Your code stays private/);

  const r = await mcpCall(ctx, 'find', {});
  const s = rule(show(r));
  const lines = s.split('\n');
  assert.match(lines[0], /^Kit · #\d+ of 13 builders · \d+ weeks? in a row$/);
  assert.deepEqual(lines.slice(1, 4), [
    'Base pays up to $5,000 for apps on Base.',
    'To qualify, Kit still needs to add Builder Codes and get people using it.',
    "Want the 2 steps toward Base's $5,000 grant?",
  ]);
  assert.match(lines[4], /^Ship code this week( to (hold|pass|move toward) #\d+)?: up to \+100 points$/);
  assert.equal(lines.length, 5);
  assert.deepEqual(r.reply?.move_up, { kind: 'qualify', project_key: key, agent_note: QUALIFY_NOTE });

  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(rule(show(yes)), [
    "Your next 2 steps toward Base's $5,000 grant:",
    `1. Add Builder Codes, Base's first step: ${GUIDE}`,
    '2. Have a live product people use.',
    '',
    'We check for Builder Codes daily, and your agent drafts the application when you qualify.',
    'Want help with the first one now?',
  ].join('\n'));
  assert.equal(yes.reply?.agent_note, QUALIFY_STEPS_NOTE);
  // Answered once.
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } })), 'Okay.');

  // A no keeps it away 30 days: the ship step comes back.
  rule(show(await mcpCall(ctx, 'find', {})));
  await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'no' } });
  const after = rule(show(await mcpCall(ctx, 'find', {})));
  assert.ok(after.includes('Want me to suggest one small thing to ship?'), after);
  assert.doesNotMatch(after, /Base pays/);
});

test('a private repo: the titles question after the connect yes, once; its yes turns titles on', db, async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);
  const { c, ctx, key, handle } = await rankedBuilder('t', { private: true, chains: {}, codes: null });
  const r4 = await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } });
  const s4 = rule(show(r4));
  assert.equal(s4.split('\n').slice(0, 2).join('\n'), [`You're live: https://earnkit.com/${handle}`, 'Show what you shipped on your page? Your code stays private.'].join('\n'));
  assert.match(s4.split('\n')[2], /^\+\d+ points added · \d+ total$/);
  assert.deepEqual(r4.reply?.move_up, { kind: 'titles', project_key: key, agent_note: TITLES_NOTE });

  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'titles', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), UPDATE_LINES.titlesOn);
  const [p] = await sql()<{ on: boolean }[]>`SELECT ship_titles_at IS NOT NULL AS on FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.ok(p.on, 'titles on');
  // Never asked again; the next reply is the no-fit path (not on Base; Builder Codes and users unknown: named only as steps).
  const next = rule(show(await mcpCall(ctx, 'find', {})));
  assert.doesNotMatch(next, /Your code stays private/);
  assert.ok(next.includes("Base pays up to $5,000 for apps on Base.\nTo qualify, Kit still needs to go live on Base.\nWant the 3 steps to qualify for Base's $5,000 grant?"), next);
});
