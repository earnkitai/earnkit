import { after, mock, test } from 'node:test';
import { checkFitsAsked, pathQuiet, walletOffered } from './fixtures/wallet-step';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { padPool } from './fixtures/rank-pool';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { QUALIFY_BASE_YES_NOTE, QUALIFY_STEPS_NOTE, TITLES_NOTE, QUALIFY_NOTE } from './bench-find';
import {
  TITLES_ASK, benchReply, grantHook, qualifyAsk, qualifyGap, qualifySteps, stateAsk, type BenchView, type OpenGrant, type QualifyOffer, type QualifyStep,
} from './bench-reply';
import { grantOf, qualifyOffer, qualifyPlan, qualifyStatus } from './base-qualify';
import { BASE_GRANTS_ID } from './builder-code';
import { UPDATE_LINES, titlesAskDue } from './updates';
import { listPrograms } from './programs';
import { codesSettled } from './builder-codes-check';
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
const rule = (s: string, asks = 1) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), asks, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}/u, s);
  return s;
};

const BASE: OpenGrant = { org: 'Base', amount: '$5,000', chain: 'Base' };
const HEAD = { title: 'Base', when: 'rolling' };
const GUIDE = 'https://docs.base.org/base-chain/builder-codes/builder-codes';

test('the hook names the grant from its program facts', () => {
  const card = (o: Partial<Card>): Card => ({ id: 'p', title: 'P', summary: '', tag: null, each_time: [], status: 'active', ...o });
  // v3.1 cold read: the hook names the program ("Base Builder Grant Program" reads "Base Builder Grants").
  const named = grantOf(card({ title: 'Base Builder Grant Program', organizer: 'Base', chains: ['base'], max_award_usd: 5000 }));
  assert.deepEqual(named, { ...BASE, name: 'Base Builder Grants' });
  assert.equal(grantHook(named!), 'Base Builder Grants pay up to $5,000 for apps on Base.');
  // Without a program name, the organizer.
  assert.equal(grantHook(BASE), 'Base pays up to $5,000 for apps on Base.');
  const arc = grantOf(card({ title: 'Arc Microgrant', organizer: 'Arc House (Circle)', any_chain: true, max_award_usd: 10000 }))!;
  assert.equal(grantHook(arc), 'Arc Microgrant pays up to $10,000 for apps.');
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
  const none = qualifyPlan(BASE, qualifyStatus(at(repo({})), false), HEAD)!;
  assert.deepEqual([none.missing, none.steps], [['base', 'codes'], ['base', 'codes', 'use']]);
  // Deployed on Base, no live link or users: Base met.
  const live = qualifyPlan(BASE, qualifyStatus(at(repo(deployed)), false), HEAD)!;
  assert.deepEqual([live.missing, live.steps], [['codes', 'use'], ['codes', 'use']]);
  // Testnet only: the matcher's mainnet_deploy reason.
  const testnet = qualifyPlan(BASE, qualifyStatus(at(repo({ base: { mainnet: false, testnet: true, evidence: 'config', basis: 'config' } as never })), true), HEAD)!;
  assert.deepEqual(testnet.steps.includes('codes'), false, 'Builder Codes found: dropped');
  assert.ok(testnet.missing.includes('base'));
  // v3.1 GTM W3: contracts the builder or the agent reported on Base (or confirmed): never "Put your app on Base."
  assert.equal(qualifyStatus(null, null, true).base, 'met');
  assert.equal(qualifyStatus(at(repo({})), false, true).base, 'met');
  assert.ok(!qualifyPlan(BASE, qualifyStatus(null, null, true), HEAD)!.steps.includes('base'));
  // Never matched and the check never ran: every step, none named missing.
  const unknown = qualifyPlan(BASE, qualifyStatus(null, null), HEAD)!;
  assert.deepEqual([unknown.missing, unknown.steps], [[], ['base', 'codes', 'use']]);
  // Every step known met: no offer (never a claim of eligibility).
  const users = repo(deployed, { homepage: 'https://kit.app', tx_count: 500, live_verified: true });
  assert.equal(qualifyStatus(at(users), true).use, 'met');
  assert.equal(qualifyPlan(BASE, qualifyStatus(at(users), true), HEAD), null);
});

test('the no-fit copy, word for word', () => {
  const off = (missing: QualifyStep[], steps: QualifyStep[] = missing) => ({ missing, steps });
  // v4.3 (owner-approved): the gap names exactly the steps left; "N steps away" only when each is known missing.
  const TAG = "Builder Codes are a one-line tag that credits your app's Base transactions to you.";
  assert.equal(qualifyGap('Kit', off(['base', 'codes', 'use'])), `Kit is 3 steps away: put the app on Base, add Builder Codes and get people using it. ${TAG}`);
  assert.equal(qualifyGap('Kit', off(['use'])), 'Kit is one step away: get people using it.');
  // Fix round 1: one named thing beside "the 3 steps" is never said; partly unknown is "To qualify, ... needs to".
  assert.equal(qualifyGap('Kit', off(['base'], ['base', 'codes', 'use'])), `To qualify, Kit needs to put the app on Base, add Builder Codes and get people using it. ${TAG}`);
  assert.equal(qualifyGap('Kit', off([], ['base', 'codes', 'use'])), `To qualify, Kit needs to put the app on Base, add Builder Codes and get people using it. ${TAG}`);
  // v4.3: the question by the first step left.
  assert.equal(qualifyAsk(BASE, ['base', 'codes', 'use'], 'Kit'), 'Want help putting Kit on Base?');
  assert.equal(qualifyAsk(BASE, ['codes', 'use'], 'Kit'), 'Want me to add Builder Codes to Kit?');
  assert.equal(qualifyAsk(BASE, ['use'], 'Kit'), "Want the next step toward Base's $5,000 grant?");
  const all = rule(qualifySteps(BASE, ['base', 'codes', 'use']));
  assert.equal(all, [
    "3 steps to qualify for Base's $5,000 grant:",
    '1. Put your app on Base.',
    `2. Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic: ${GUIDE}`,
    '3. Have a live product people use.',
    '',
    'Want help with step 1 now?',
  ].join('\n'));
  assert.equal(rule(qualifySteps(BASE, ['use'])), [
    "Your next step toward Base's $5,000 grant:",
    '1. Have a live product people use.',
    '',
    'Want help with it now?',
  ].join('\n'));

  // v4.3: the ranked reply: the standing, then the head and the gap, then the question; no ship line.
  const q: QualifyOffer = { program_id: BASE_GRANTS_ID, grant: BASE, missing: ['codes', 'use'], steps: ['codes', 'use'], title: 'Base Builder Grant Program', when: 'rolling' };
  const project = { key: 'maya/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const v = { state: 'ranked', variant: null, project, link: null, handle: 'maya' } as const;
  const view: BenchView = { ...v, rank: '#3 of 12 builders', streak: 4, target: null, handle: 'maya', fund: [], due: [], held: null, qualify: q, ask: stateAsk({ ...v, qualify: q }) };
  assert.equal(view.ask.kind, 'qualify');
  assert.equal(rule(benchReply(view)), [
    'Kit · #3 of 12 builders · 4 weeks in a row',
    '',
    `Base Builder Grants: $5,000, rolling. Kit is 2 steps away: add Builder Codes and get people using it. ${TAG}`,
    '',
    'Want me to add Builder Codes to Kit?',
  ].join('\n'));
  // Some steps unknown: "To qualify, ... needs to", the question by the first step left.
  const unsure: QualifyOffer = { ...q, missing: ['base'], steps: ['base', 'codes', 'use'] };
  assert.equal(rule(benchReply({ ...view, qualify: unsure, ask: stateAsk({ ...v, qualify: unsure }) })), [
    'Kit · #3 of 12 builders · 4 weeks in a row',
    '',
    `Base Builder Grants: $5,000, rolling. To qualify, Kit needs to put the app on Base, add Builder Codes and get people using it. ${TAG}`,
    '',
    'Want help putting Kit on Base?',
  ].join('\n'));
  // No offer: the ship step as before.
  assert.equal(stateAsk(v).line, 'Want me to suggest one small thing to ship?');
  // The titles question comes before it, once.
  assert.equal(stateAsk({ ...v, titles: true, qualify: q }).line, TITLES_ASK);
  assert.equal(TITLES_ASK, 'Show what you shipped (commit titles) on your page so grant teams see real progress? Your code stays private.');
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

/** A signed-in builder whose one project is ranked (pool of 13), the connect offer shown. `fit`: Base's grant fits it. */
async function rankedBuilder(tag: string, o: { private: boolean; chains: Detection; codes: boolean | null; fit?: boolean }) {
  const t = `ek_v31rf${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c0 = (await connectInstallation(t))!;
  const handle = `rf${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(c0.own, { id: `95${tag}${RUN}`, username: handle, name: 'Kit Builder', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `${handle}/kit`.toLowerCase();
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = o.fit ? { tx_count: 120, live_ok: true, commits_90d: 25 } : { tx_count: 0, live_ok: false, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = {
    name: 'kit', url: `https://github.com/${key}`, homepage: o.fit ? 'https://kit.app' : null, created_at: '2025-01-01T00:00:00Z', chains: o.chains,
    commits_in_window: {}, product, tx_count: tr.tx_count, commits_90d: 25, ...(o.fit && { live_verified: true }),
  };
  // No verdicts: no program fits this project (with `fit`: Base's grant, likely).
  const verdicts: RepoFit['verdicts'] = o.fit ? [{ program_id: BASE_GRANTS_ID, program: BASE_GRANTS_ID, status: 'likely', missing: [], effort: 'none', note: null }] : [];
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, verdicts, ...(o.fit && { live_verified: true }) }];
  const commits = [0, 1, 2, 3].map((w) => ({ sha: `c${w}`, message: `Ship feature ${w}`, date: new Date(Date.now() - w * 7 * DAY - DAY).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: 9500 + Number(RUN.slice(-2)) + tag.charCodeAt(0), owner: handle, installation: 95, private: o.private, commits } });
  // The Builder Codes check reads the fake GitHub (never the network).
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, codesFetch: gh as typeof fetch, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  // As a first run does: step 2, then the repo named (the refresh already ran, so it never reads GitHub).
  await mcpCall({ ...ctx, matchProjects: (async () => ({ checked: 0, scored: 0, fits: [] })) as never }, 'find', {});
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  if (o.codes !== null) await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${key}, ${o.codes}, ${new Date()}) ON CONFLICT (repo_key) DO UPDATE SET found = EXCLUDED.found, checked_at = EXCLUDED.checked_at`;
  // v4.8 Task 1: the path leads while it has a program to name; parked here, so the connect offer shows.
  await pathQuiet(c.id);
  const r3 = await mcpCall(ctx, 'find', {});
  assert.equal((r3.reply?.move_up as { kind: string }).kind, 'connect', show(r3));
  return { c, ctx, key, handle };
}
const start = async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);
};
const baseCards = async () => (await listPrograms()).filter((p) => p.id === BASE_GRANTS_ID) as unknown as Card[];

test('no fit: the path to Base\'s grant; its yes returns the remaining steps and is remembered', db, async () => {
  await start();
  const deployed: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const { c, ctx, key } = await rankedBuilder('q', { private: false, chains: deployed, codes: false });
  // The connect yes (no Best fit, a public repo: no titles question).
  assert.doesNotMatch(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } })), /Your code stays private/);

  // v4.8 Task 1: the path names Base's grant (the only program left unparked), its approved gap, then "Want the steps?".
  await pathQuiet(c.id, { except: [BASE_GRANTS_ID] });
  const r = await mcpCall(ctx, 'find', {});
  const s = rule(show(r));
  assert.ok(s.startsWith("Kit, your closest money is Base Builder Grant: up to $5,000. Kit is 2 steps away: add Builder Codes and get people using it. Builder Codes are a one-line tag that credits your app's Base transactions to you."), s);
  assert.ok(s.endsWith('\n\nWant the steps?'), s);
  assert.deepEqual(r.reply?.move_up, { kind: 'qualify', project_key: key, agent_note: QUALIFY_NOTE });

  // The hook asked for the steps, so its yes is the steps (Task 2's gap stage does them).
  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), qualifySteps(BASE, ['codes', 'use']));
  assert.equal(yes.reply?.agent_note, QUALIFY_STEPS_NOTE);
  // Answered once.
  assert.equal(show(await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } })), 'Okay.');
  // Fix round 1: the yes is remembered: the next find moves on to the ship step, never the same question.
  await checkFitsAsked(c.id);
  const next = await mcpCall(ctx, 'find', {});
  const n = rule(show(next));
  assert.ok(n.includes('Want me to suggest one small thing to ship?'), n);
  assert.doesNotMatch(n, /pays? up to|steps/);
  assert.equal((next.reply?.move_up as { kind: string }).kind, 'ship');

  // The offer returns after 30 days (a yes or a no), and never for a builder who told EarnKit about Base's grant.
  const cards = await baseCards();
  assert.equal(cards.length, 1);
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
  const offer = (seen: Record<string, unknown>) => qualifyOffer(c.id, key, { cards, skip: new Set(), seen: seen as never, now, declineMs: 30 * DAY, codesFetch: ctx.codesFetch });
  assert.equal(await offer({ qualify_given: { [key]: ago(29) } }), null);
  assert.deepEqual((await offer({ qualify_given: { [key]: ago(31) } }))?.steps, ['codes', 'use']);
  assert.equal(await offer({ declined: { [`qualify:${key}`]: ago(29) } }), null);
  assert.deepEqual((await offer({ declined: { [`qualify:${key}`]: ago(31) } }))?.steps, ['codes', 'use']);
  await sql()`INSERT INTO builder_program_status (installation_id, program_id, status) VALUES (${c.id}, ${BASE_GRANTS_ID}, 'applied')`;
  assert.equal(await offer({}), null, 'already reported to Base');
});

test('v4.2 Task 10 (G5): a no to the titles question keeps them private and says so', db, async () => {
  await start();
  const { c, ctx, key } = await rankedBuilder('tn', { private: true, chains: {}, codes: null });
  await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } });
  const no = await mcpCall(ctx, 'tell', { move_up: { kind: 'titles', project_key: key, answer: 'no' } });
  assert.equal(show(no), 'Got it, your commit titles stay private.');
  const [p] = await sql()<{ on: boolean }[]>`SELECT ship_titles_at IS NOT NULL AS on FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.equal(p.on, false);
});

test('a private repo: the titles question after the connect yes, once; its yes turns titles on', db, async () => {
  await start();
  const { c, ctx, key, handle } = await rankedBuilder('t', { private: true, chains: {}, codes: null });
  // Fix round 1: only the log's own project (the main one) is asked about.
  assert.equal(await titlesAskDue(c.id, key, new Date()), true);
  assert.equal(await titlesAskDue(c.id, 'someone/else', new Date()), false);
  const r4 = await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } });
  const s4 = rule(show(r4));
  assert.equal(s4.split('\n').slice(0, 2).join('\n'), [`You're live: https://earnkit.com/${handle}`, 'Show what you shipped (commit titles) on your page so grant teams see real progress? Your code stays private.'].join('\n'));
  assert.equal(s4.split('\n').length, 2);
  assert.deepEqual(r4.reply?.move_up, { kind: 'titles', project_key: key, agent_note: TITLES_NOTE });

  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'titles', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), UPDATE_LINES.titlesOn);
  const [p] = await sql()<{ on: boolean }[]>`SELECT ship_titles_at IS NOT NULL AS on FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.ok(p.on, 'titles on');
  // Never asked again; the next reply is the path's Base hook (v4.8 Task 1). Not on Base is known, Builder Codes and
  // users are not, so v4.3's gap: "To qualify, ... needs to" (never "3 steps away").
  await pathQuiet(c.id, { except: [BASE_GRANTS_ID] });
  const next = rule(show(await mcpCall(ctx, 'find', {})));
  assert.doesNotMatch(next, /Your code stays private|still needs|steps away/);
  assert.ok(next.includes('To qualify, Kit needs to put the app on Base, add Builder Codes and get people using it.'), next);
  assert.ok(next.endsWith('\n\nWant the steps?'), next);
  // Fix round 1: the offer started the Builder Codes check for the App-proven repo (once a day, the attempts table).
  await codesSettled();
  assert.equal((await sql()`SELECT 1 FROM repo_builder_codes_attempts WHERE repo_key = ${key}`).length, 1, 'the check was attempted');
  // v4.3 final review F4: the yes to "Want help putting Kit on Base?" is the steps with no second question, and a
  // note to help with step 1 now.
  const yes2 = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(rule(show(yes2), 0), qualifySteps(BASE, ['base', 'codes', 'use'], false));
  assert.equal(yes2.reply?.agent_note, QUALIFY_BASE_YES_NOTE);
});

test('a private repo with a Best fit: the connect yes offers the draft, never the titles question', db, async () => {
  await start();
  const deployed: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const { ctx, key, handle } = await rankedBuilder('a', { private: true, chains: deployed, codes: true, fit: true });
  const r4 = await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } });
  const s4 = rule(show(r4));
  assert.equal(s4.split('\n').slice(0, 3).join('\n'), [
    `You're live: https://earnkit.com/${handle}`,
    'Next, I can write your Base Builder Grant Program application. You just check it and send.',
    'Want me to?',
  ].join('\n'));
  assert.doesNotMatch(s4, /Your code stays private/);
  assert.equal((r4.reply?.move_up as { kind: string }).kind, 'apply');
  await codesSettled();
});
