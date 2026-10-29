import { after, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { walletOffered } from './fixtures/wallet-step';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { padPool } from './fixtures/rank-pool';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { QUALIFY_NOTE, QUALIFY_STEPS_NOTE, QUALIFY_STEPS_NOTE_HOSTED, alsoOpen } from './bench-find';
import {
  QUALIFY_CODES_CHECK_NOTE, QUALIFY_CODES_NOTE, alsoLine, benchReply, qualifyAsk, qualifyCodesYes, qualifyGap, qualifyHead, qualifySteps, stateAsk,
  type BenchView, type OpenGrant, type QualifyOffer, type QualifyStep,
} from './bench-reply';
import { BASE_GRANTS_ID } from './builder-code';
import { productOdds, productScore, traction, type Detection } from './match';
import type { Card, RepoFit } from './present';

/**
 * v4.3 Task 1 (owner-approved copy): "what can I earn" for a ranked builder with no fit names the money (Base's grant,
 * its amount and when), the one gap in plain words, up to two other open grants, and one question by the first step.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v43-first-answer-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
// A Wednesday before Arc Microgrants: Built with Arc Studio closes (Nov 1).
const WEDNESDAY = Date.parse('2026-10-21T12:00:00Z');
after(async () => {
  mock.timers.reset();
  if (process.env.DATABASE_URL) await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');

const BASE: OpenGrant = { org: 'Base', amount: '$5,000', chain: 'Base', name: 'Base Builder Grants' };
const GUIDE = 'https://docs.base.org/base-chain/builder-codes/builder-codes';
const OWNER_COPY = [
  "Base Builder Grants: $5,000, rolling. EarnKit is one step away: add Builder Codes, a one-line tag that credits your app's Base transactions to you.",
  '',
  'Also open: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Circle Developer Grants, $5,000 to $100,000 USDC grants.',
  '',
  'Want me to add Builder Codes to EarnKit?',
].join('\n');

const offer = (missing: QualifyStep[], steps: QualifyStep[] = missing): QualifyOffer => ({
  program_id: BASE_GRANTS_ID, grant: BASE, missing, steps, title: 'Base Builder Grant Program', when: 'rolling',
});

test('the head: the program, its amount and when', () => {
  assert.equal(qualifyHead(offer(['codes'])), 'Base Builder Grants: $5,000, rolling.');
  assert.equal(qualifyHead({ ...offer(['codes']), when: 'closes Nov 1' }), 'Base Builder Grants: $5,000, closes Nov 1.');
});

test('the gap: steps known missing, Builder Codes explained once', () => {
  const tag = "a one-line tag that credits your app's Base transactions to you";
  // One step, Builder Codes last.
  assert.equal(qualifyGap('EarnKit', offer(['codes'])), `EarnKit is one step away: add Builder Codes, ${tag}.`);
  // Two steps, Builder Codes not last: its own sentence after the gap.
  assert.equal(qualifyGap('Kit', offer(['codes', 'use'])), `Kit is 2 steps away: add Builder Codes and get people using it. Builder Codes are ${tag}.`);
  // Two steps, Builder Codes last.
  assert.equal(qualifyGap('Kit', offer(['base', 'codes'])), `Kit is 2 steps away: put the app on Base and add Builder Codes, ${tag}.`);
  assert.equal(qualifyGap('Kit', offer(['base', 'codes', 'use'])), `Kit is 3 steps away: put the app on Base, add Builder Codes and get people using it. Builder Codes are ${tag}.`);
  assert.equal(qualifyGap('Kit', offer(['use'])), 'Kit is one step away: get people using it.');
  // Partly unknown (the Builder Codes check returned null): never "one step away".
  assert.equal(qualifyGap('Kit', offer([], ['codes'])), `To qualify, Kit needs to add Builder Codes, ${tag}.`);
  assert.equal(qualifyGap('Kit', offer(['base'], ['base', 'codes', 'use'])), `To qualify, Kit needs to put the app on Base, add Builder Codes and get people using it. Builder Codes are ${tag}.`);
});

test('also open: none, one, two; rolling omits when', () => {
  assert.equal(alsoLine([]), null);
  assert.equal(alsoLine([{ title: 'Circle Developer Grants', amount: '$5,000 to $100,000 USDC grants', when: 'rolling' }]), 'Also open: Circle Developer Grants, $5,000 to $100,000 USDC grants.');
  assert.equal(
    alsoLine([
      { title: 'Arc Microgrants', amount: '500 USDC × 8 grants', when: 'closes Nov 1' },
      { title: 'Circle Developer Grants', amount: '$5,000 to $100,000 USDC grants', when: 'rolling' },
    ]),
    'Also open: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Circle Developer Grants, $5,000 to $100,000 USDC grants.',
  );
});

test('the question by the first step', () => {
  assert.equal(qualifyAsk(BASE, ['codes'], 'EarnKit'), 'Want me to add Builder Codes to EarnKit?');
  assert.equal(qualifyAsk(BASE, ['codes', 'use'], 'EarnKit'), 'Want me to add Builder Codes to EarnKit?');
  assert.equal(qualifyAsk(BASE, ['base', 'codes', 'use'], 'EarnKit'), 'Want help putting EarnKit on Base?');
  assert.equal(qualifyAsk(BASE, ['use'], 'EarnKit'), "Want the next step toward Base's $5,000 grant?");
  // Fix round 1 (R1): an agent with no folder of the code is asked for the steps; the other first steps are unchanged.
  assert.equal(qualifyAsk(BASE, ['codes'], 'EarnKit', true), 'Want the steps to add Builder Codes to EarnKit?');
  assert.equal(qualifyAsk(BASE, ['base', 'codes'], 'EarnKit', true), 'Want help putting EarnKit on Base?');
  const v = { state: 'ranked', variant: null, project: { key: 'a/b', name: 'EarnKit', confirmed: true, live: true, weeks: 1 }, link: null, handle: 'a' } as const;
  assert.equal(stateAsk({ ...v, qualify: offer(['codes']), hosted: true }).line, 'Want the steps to add Builder Codes to EarnKit?');
  assert.equal(qualifyCodesYes('EarnKit'), `Adding Builder Codes to EarnKit. Base's guide: ${GUIDE}`);
  assert.doesNotMatch(qualifyCodesYes('EarnKit'), /\?/);
});

test('the ranked qualify reply: no ship line, no money line; the standing above the head when shown', () => {
  const q: QualifyOffer = offer(['codes']);
  const project = { key: 'earnkitai/earnkit', name: 'EarnKit', confirmed: true, live: true, weeks: 6 };
  const v = { state: 'ranked', variant: null, project, link: null, handle: 'jenil' } as const;
  const also = [
    { title: 'Arc Microgrants', amount: '500 USDC × 8 grants', when: 'closes Nov 1' },
    { title: 'Circle Developer Grants', amount: '$5,000 to $100,000 USDC grants', when: 'rolling' },
  ];
  const view: BenchView = {
    ...v, rank: '#3 of 12 builders', streak: 6, target: null, fund: [], due: [], held: null, qualify: q, also, standingShown: false,
    ask: stateAsk({ ...v, qualify: q }),
  };
  assert.equal(view.ask.kind, 'qualify');
  assert.equal(benchReply(view), OWNER_COPY);
  const shown = benchReply({ ...view, standingShown: true });
  assert.ok(shown.endsWith(`\n\n${OWNER_COPY}`), shown);
  assert.doesNotMatch(shown, /Ship code/);
  // No other open grant: no Also open line.
  assert.equal(benchReply({ ...view, also: [] }), [OWNER_COPY.split('\n')[0], '', 'Want me to add Builder Codes to EarnKit?'].join('\n'));
});

test('also open: grants only, shown and open, never the qualify program; two at most, by relevance', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const card = (id: string, o: Partial<Card> = {}): Card => ({
    id, title: `${id} Grants`, summary: `$1,000 · rolling`, tag: null, each_time: [], status: 'active', chains: ['arc'], max_award_usd: 1000, reward: '$1,000 per grant', ...o,
  });
  const cards: Card[] = [
    card('base-builder-grants', { chains: ['base'], max_award_usd: 5000, summary: 'up to $5,000 · rolling' }),
    card('invest', { investment: true, chains: ['base'] }),
    card('hack', { title: 'Hack: Online', reward: '$50K in prizes', chains: ['base'], summary: '$50K in prizes · closes Oct 25' }),
    card('inperson', { in_person: true, chains: ['base'] }),
    card('sponsor', { sponsored: true, chains: ['base'] }),
    card('campaign', { earnkit_campaign: true, chains: ['base'] } as Partial<Card>),
    card('hidden', { chains: ['base'] }),
    card('closed', { status: 'closed', chains: ['base'] }),
    card('upcoming', { status: 'upcoming', chains: ['base'] }),
    card('ended', { ends_at: new Date('2026-10-20T00:00:00Z'), chains: ['base'] }),
    card('rolling-arc'),
    card('soon-arc', { title: 'Soon Arc: Built with Studio', summary: '500 USDC × 8 grants · closes Nov 1, 11:59 PM ET', ends_at: new Date('2026-11-02T04:59:00Z'), reward: '500 USDC per grant' }),
    card('any-chain', { chains: [], any_chain: true, summary: 'up to $2,000 · rolling' }),
  ];
  const got = alsoOpen(cards, now, new Set(['hidden']), 'base-builder-grants');
  // byRelevance: any chain before other chains; then the sooner deadline (rolling last).
  assert.deepEqual(got, [
    { title: 'any-chain Grants', amount: '$2,000', when: 'rolling' },
    { title: 'Soon Arc: Built with Studio', amount: '500 USDC × 8 grants', when: 'closes Nov 1' },
  ]);
  assert.equal(alsoLine(got), 'Also open: any-chain Grants, $2,000. Soon Arc, 500 USDC × 8 grants, closes Nov 1.');
  // Only excluded kinds left: none.
  assert.deepEqual(alsoOpen(cards.filter((c) => !['rolling-arc', 'soon-arc', 'any-chain'].includes(c.id)), now, new Set(['hidden']), 'base-builder-grants'), []);
});

/** A signed-in builder whose one project EarnKit is ranked; Base's grant has only Builder Codes missing. */
async function ownerBuilder(tag: string, o: { hosted?: boolean; codes?: boolean | null } = {}) {
  const t = `ek_v43fa${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c0 = (await connectInstallation(t))!;
  const handle = `fa${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(c0.own, { id: `96${tag}${RUN}`, username: handle, name: 'Ek Builder', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `${handle}/earnkit`.toLowerCase();
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 0, live_ok: false, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const deployed: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const facts = { name: 'earnkit', url: `https://github.com/${key}`, homepage: null, created_at: '2025-01-01T00:00:00Z', chains: deployed, commits_in_window: {}, product, tx_count: 0, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'earnkit', repo_url: `https://github.com/${key}`, key, product, facts, verdicts: [] }];
  const commits = [0, 1, 2, 3, 4, 5].map((w) => ({ sha: `c${w}`, message: `Ship feature ${w}`, date: new Date(Date.now() - w * 7 * DAY - DAY).toISOString() }));
  const gh = fakeGitHub({ [key]: { id: 9600 + Number(RUN.slice(-2)) + tag.charCodeAt(0), owner: handle, installation: 96, private: false, commits } });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, codesFetch: gh as typeof fetch, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall({ ...ctx, matchProjects: (async () => ({ checked: 0, scored: 0, fits: [] })) as never }, 'find', {});
  await mcpCall(ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  // Builder Codes checked: not found. People use it (the builder said so), so only Builder Codes is missing.
  if (o.codes !== null) await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${key}, ${o.codes ?? false}, ${new Date()}) ON CONFLICT (repo_key) DO UPDATE SET found = EXCLUDED.found, checked_at = EXCLUDED.checked_at`;
  // A hosted agent (no folder of the code: find told agent_can_build: false, remembered as no_folder).
  if (o.hosted) await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || '{"no_folder": true}'::jsonb WHERE builder_id = ${c.id}`;
  await sql()`INSERT INTO builder_repo_facts (installation_id, login, repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine, at)
    VALUES (${c.id}, '', ${key}, ${['base']}, ${[]}, null, true, false, now())`;
  const r3 = await mcpCall(ctx, 'find', {});
  assert.equal((r3.reply?.move_up as { kind: string }).kind, 'connect', show(r3));
  await mcpCall(ctx, 'tell', { move_up: { kind: 'connect', project_key: key, answer: 'yes' } });
  return { c, ctx, key };
}
const start = async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: WEDNESDAY });
  await padPool(12);
};

test("the owner's state through find: the approved copy, byte for byte; the yes adds Builder Codes, no question", db, async () => {
  await start();
  const { c, ctx, key } = await ownerBuilder('y');
  const r = await mcpCall(ctx, 'find', {});
  assert.equal(show(r), OWNER_COPY);
  assert.deepEqual(r.reply?.move_up, { kind: 'qualify', project_key: key, agent_note: QUALIFY_NOTE });

  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), qualifyCodesYes('EarnKit'));
  assert.doesNotMatch(show(yes), /\?/);
  assert.equal(yes.reply?.agent_note, QUALIFY_CODES_NOTE);
  assert.equal(yes.reply?.move_up, undefined);
  // Remembered: the next find asks nothing about qualifying.
  const [{ g }] = await sql()<{ g: Record<string, string> | null }[]>`SELECT standing_seen->'qualify_given' AS g FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.equal(typeof g?.[key], 'string');
  const next = await mcpCall(ctx, 'find', {});
  assert.notEqual((next.reply?.move_up as { kind?: string } | undefined)?.kind, 'qualify');
  assert.doesNotMatch(show(next), /Builder Codes/);
});

test('a no to the codes question is remembered and never asked again', db, async () => {
  await start();
  const { c, ctx, key } = await ownerBuilder('n');
  const r = await mcpCall(ctx, 'find', {});
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'qualify', show(r));
  await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'no' } });
  const [{ d }] = await sql()<{ d: Record<string, string> | null }[]>`SELECT standing_seen->'declined' AS d FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.equal(typeof d?.[`qualify:${key}`], 'string');
  const next = await mcpCall(ctx, 'find', {});
  assert.notEqual((next.reply?.move_up as { kind?: string } | undefined)?.kind, 'qualify');
  assert.doesNotMatch(show(next), /Builder Codes|qualify/);
});

test('fix round 1 (R1): a hosted agent is asked for the steps; its yes is the steps reply with the hosted note', db, async () => {
  await start();
  const { ctx, key } = await ownerBuilder('h', { hosted: true });
  // A hosted agent can schedule: the one-time Monday check-in comes first; its no.
  const first = await mcpCall(ctx, 'find', {});
  const m = first.reply?.move_up as { kind: string } | undefined;
  if (m?.kind === 'checkin') await mcpCall(ctx, 'tell', { move_up: { kind: 'checkin', project_key: key, answer: 'no' } });
  const r = m?.kind === 'checkin' ? await mcpCall(ctx, 'find', {}) : first;
  const s = show(r);
  assert.equal(s, OWNER_COPY.replace('Want me to add Builder Codes to EarnKit?', 'Want the steps to add Builder Codes to EarnKit?'));
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'qualify');
  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), qualifySteps(BASE, ['codes']));
  assert.equal(yes.reply?.agent_note, QUALIFY_STEPS_NOTE_HOSTED);
  assert.doesNotMatch(show(yes), /Adding Builder Codes/);
});

test('fix round 1: Builder Codes unknown: the gap says "To qualify", the yes tells the agent to check before adding', db, async () => {
  await start();
  const { ctx, key } = await ownerBuilder('u', { codes: null });
  const s = show(await mcpCall(ctx, 'find', {}));
  assert.match(s, /^Base Builder Grants: \$5,000, rolling\. To qualify, EarnKit needs to add Builder Codes, /, s);
  assert.ok(s.endsWith('\n\nWant me to add Builder Codes to EarnKit?'), s);
  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), qualifyCodesYes('EarnKit'));
  assert.equal(yes.reply?.agent_note, QUALIFY_CODES_CHECK_NOTE);
  assert.match(QUALIFY_CODES_CHECK_NOTE, /first check .*Only if it is not already there, add it/);
});

test('fix round 1: a stored ask from before v4.3 (no first, no name) answers a yes with the steps reply', db, async () => {
  await start();
  const { c, ctx, key } = await ownerBuilder('o');
  const old = { kind: 'qualify', key, program_id: BASE_GRANTS_ID, qualify: { grant: BASE, steps: ['codes', 'use'] } };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(old as never)}::jsonb) WHERE builder_id = ${c.id}`;
  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), qualifySteps(BASE, ['codes', 'use']));
  assert.equal(yes.reply?.agent_note, QUALIFY_STEPS_NOTE);
});
