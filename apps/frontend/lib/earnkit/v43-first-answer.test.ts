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
import { QUALIFY_NOTE, QUALIFY_STEPS_NOTE, QUALIFY_STEPS_NOTE_HOSTED, alsoOpen, standingFields } from './bench-find';
import { ANSWER_FIRST_NOTE } from './stand-text';
import {
  QUALIFY_CODES_CHECK_NOTE, QUALIFY_CODES_NOTE, alsoLine, walletSetupAsk, TOKEN_SENTENCE, benchReply, qualifyAsk, qualifyCodesYes, qualifyGap, qualifyHead, qualifySteps, stateAsk,
  type BenchView, type OpenGrant, type QualifyOffer, type QualifyStep,
} from './bench-reply';
import { BASE_GRANTS_ID } from './builder-code';
import { productOdds, productScore, traction, type Detection } from './match';
import { presentFirstMessage, programUpdates, type Card, type RepoFit } from './present';

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

// ---- v4.3 Task 2: the full list never contradicts itself ----

const FULL_TABLE = [
  '| Program | Amount | Difficulty | Ends |',
  '|---|---|---|---|',
  '| Base Builder Grant Program | $5,000 | Medium | rolling |',
  '| Arc Microgrants: Built with Arc Studio | 500 USDC × 8 grants | Medium | Nov 1, 11:59 PM ET |',
  '| Circle Developer Grants | $5,000 to $100,000 USDC grants | Hard | rolling |',
  '| a16z speedrun SR008 | $1M investment | Hard | Nov 1, 11:59 PM PT |',
  '| Alliance ALL19 | $400K at admission investment | Hard | Nov 18, 11:59 PM UTC |',
].join('\n');

test("v4.3 Task 2: the owner's find {more: true}: head and gap, the full table, the same one question; never doesn't fit", db, async () => {
  await start();
  const { c, ctx, key } = await ownerBuilder('m');
  const r = await mcpCall(ctx, 'find', { more: true });
  const s = show(r);
  assert.equal(s, [OWNER_COPY.split('\n')[0], '', FULL_TABLE, '', 'Want me to add Builder Codes to EarnKit?'].join('\n'));
  assert.doesNotMatch(s, /doesn't fit|Updates:|Also open|\d+ programs are open|Want the guide/);
  assert.equal(s.split('?').length - 1, 1, s);
  assert.deepEqual(r.reply?.move_up, { kind: 'qualify', project_key: key, agent_note: QUALIFY_NOTE });
  // The stored ask is written, so the yes is answered as asked.
  const [{ a }] = await sql()<{ a: { kind: string; qualify?: { first?: string; name?: string } } | null }[]>`SELECT standing_seen->'bench_ask' AS a FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.equal(a?.kind, 'qualify');
  assert.equal(a?.qualify?.first, 'codes');
  assert.equal(a?.qualify?.name, 'EarnKit');
  const yes = await mcpCall(ctx, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(show(yes), qualifyCodesYes('EarnKit'));
  // Days later (Arc Microgrants closes within 3 days): still the table, never an "Updates:" line repeating it.
  mock.timers.setTime(Date.parse('2026-10-29T12:00:00Z'));
  const later = show(await mcpCall(ctx, 'find', { more: true }));
  assert.match(later, /\| Arc Microgrants: Built with Arc Studio \|/, later);
  assert.doesNotMatch(later, /doesn't fit|Updates:/, later);
});

test('v4.3 Task 2: a ranked reply with the full list puts the table right before its one question', () => {
  const project = { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 3 };
  const v = { state: 'ranked', variant: null, project, link: null, handle: 'maya' } as const;
  const view: BenchView = {
    ...v, rank: '#3 of 12 builders', streak: 3, target: null, fund: [], due: [], held: null, standingShown: true, nagShown: true,
    ask: { kind: 'ship', project_key: 'maya/kit', line: 'Want me to suggest one small thing to ship?' },
  };
  const plain = benchReply(view);
  const full = benchReply({ ...view, fullTable: '| Program |\n|---|\n| A |' });
  assert.equal(full, plain.replace('\nWant me to suggest one small thing to ship?', '\n\n| Program |\n|---|\n| A |\n\nWant me to suggest one small thing to ship?'));
  assert.ok(full.endsWith('\n\nWant me to suggest one small thing to ship?'), full);
  // No table: unchanged.
  assert.equal(benchReply({ ...view, fullTable: null }), plain);
});

test("v4.3 Task 2: a shared client's find {more: true} keeps the table path with no doesn't fit line", db, async () => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-29T12:00:00Z') });
  const t = `ek_v43fash_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: true, matchProjects: (async () => ({ checked: 1, scored: 1, fits: [] })) as never };
  const input = { more: true, repos: ['https://github.com/someone/app'] };
  await mcpCall(ctx, 'find', input);
  const s = show(await mcpCall(ctx, 'find', input));
  assert.match(s, /\| Program \| Amount \| Difficulty \| Ends \|/, s);
  assert.match(s, /\| Arc Microgrants: Built with Arc Studio \|/, s);
  assert.doesNotMatch(s, /doesn't fit/, s);
  assert.doesNotMatch(s, /Updates: [^\n]*Arc Microgrants/, s);
});

test('v4.3 Task 2, the old path: an update for a program in the table is dropped; one not in it still shows', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const card = (id: string, o: Partial<Card> = {}): Card => ({
    id, title: `${id} Grants`, summary: '$1,000 · rolling', tag: null, each_time: [], status: 'active', chains: ['base'], max_award_usd: 1000, reward: '$1,000 per grant', ...o,
  });
  // Five grants fill the table (MAX_OTHERS); the investment sorts after them, so it is not in it.
  const cards: Card[] = [
    card('g1', { closes_in_days: 2, ends_at: new Date('2026-10-31T12:00:00Z') }), card('g2'), card('g3'), card('g4'), card('g5'),
    card('fund', { investment: true, closes_in_days: 3, ends_at: new Date('2026-11-01T12:00:00Z') }),
  ];
  const repos = { checked: 1, scored: 1, fits: [] } as never;
  const s = presentFirstMessage({
    alerts: [], campaigns: [], cards, repos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now, more: true,
    updates: programUpdates(cards, false), projectName: 'EarnKit',
  });
  assert.match(s, /\| g1 Grants \|/, s);
  assert.doesNotMatch(s, /\| fund Grants \|/, s);
  assert.match(s, /\nUpdates: fund Grants closes in 3 days\.\n/, s);
  assert.doesNotMatch(s, /g1 Grants closes|doesn't fit/, s);
  // Only updates for programs in the table: no "Updates:" line at all.
  const only = presentFirstMessage({
    alerts: [], campaigns: [], cards: cards.slice(0, 5), repos, workingOn: [], agentCanBuild: true, sponsorEntries: null, now, more: true,
    updates: programUpdates(cards.slice(0, 5), false), projectName: 'EarnKit',
  });
  assert.doesNotMatch(only, /Updates:|doesn't fit/, only);
});

// ---- v4.3 Task 2 fix round 1 ----

test('fix round 1 (R3): with the full list, a nudge-owned reply and step 3 get no table', () => {
  const project = { key: 'maya/kit', name: 'Kit', confirmed: true, live: true, weeks: 3 };
  const v = { state: 'ranked', variant: null, project, link: null, handle: 'maya' } as const;
  const table = '| Program |\n|---|\n| A |';
  const nudged: BenchView = {
    ...v, rank: null, streak: 3, target: null, fund: [], due: [], held: null, standingShown: true,
    nudge: 'Arc Microgrants closes Nov 1. Want me to draft it?', nudgeOwns: true,
    ask: { kind: 'apply', project_key: 'maya/kit', line: '', program_id: 'arc-microgrants' },
  };
  const plainNudge = benchReply(nudged);
  assert.equal(benchReply({ ...nudged, fullTable: table }), plainNudge);
  assert.doesNotMatch(plainNudge, /\| Program \|/);
  assert.equal(plainNudge.split('?').length - 1, 1, plainNudge);
  const step3: BenchView = {
    ...v, rank: null, streak: 3, target: null, fund: [], due: [], held: null,
    ask: { kind: 'wallet_setup', project_key: 'maya/kit', line: 'Step 3 of 3: add your reward wallet. Done?' },
  };
  assert.equal(benchReply({ ...step3, fullTable: table }), 'Step 3 of 3: add your reward wallet. Done?');
  assert.equal(benchReply({ ...step3, state: 'not_counted', fullTable: table }), benchReply({ ...step3, state: 'not_counted' }));
});

test('fix round 1 (F5): a signed-out scoring builder\'s find {more: true} keeps the present.ts tables, never "doesn\'t fit" above them', db, async () => {
  await start();
  const t = `ek_v43faso_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits: [] })) as never };
  const input = { more: true, identity: { project: { name: 'Kit', repo: 'https://github.com/someone/kit' } } };
  const r = await mcpCall(ctx, 'find', input);
  const s = show(r);
  assert.match(s, /\| Program \| Amount \| Difficulty \| Ends \|/, s);
  assert.doesNotMatch(s, /doesn't fit|EarnKit gets you paid for building/, s);
  assert.equal(r.reply?.move_up, undefined);
  const [{ a }] = await sql()<{ a: unknown }[]>`SELECT standing_seen->'bench_ask' AS a FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.equal(a, null);
});

test('fix round 1 (F5): a signed-in builder whose project is not counted keeps the present.ts tables with find {more: true}', db, async () => {
  await start();
  const t = `ek_v43fanc_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c0 = (await connectInstallation(t))!;
  const handle = `fanc${RUN}`.slice(0, 15);
  assert.ok((await attachToX(c0.own, { id: `97nc${RUN}`, username: handle, name: 'Nc Builder', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, codesFetch: fakeGitHub({}) as typeof fetch, matchProjects: (async () => ({ checked: 1, scored: 1, fits: [] })) as never };
  const input = { identity: { project: { name: 'Kit', repo: `https://github.com/${handle}/kit` } } };
  await mcpCall(ctx, 'find', input);
  const r = await mcpCall(ctx, 'find', { ...input, more: true });
  const s = show(r);
  assert.match(s, /\| Program \| Amount \| Difficulty \| Ends \|/, s);
  assert.doesNotMatch(s, /doesn't fit|isn't counted/, s);
  assert.equal(r.reply?.move_up, undefined);
});

test('fix round 1 (F3): find {more: true} never claims the setup-done reply; the next find {} shows it', db, async () => {
  await start();
  const { c, ctx } = await ownerBuilder('s');
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'setup_done' - 'wallet_link_at') || jsonb_build_object('setup_asked', now()::text) WHERE builder_id = ${c.id}`;
  const s = show(await mcpCall(ctx, 'find', { more: true }));
  assert.match(s, /\| Program \| Amount \| Difficulty \| Ends \|/, s);
  assert.doesNotMatch(s, /You're all set|No worries/, s);
  const [{ done }] = await sql()<{ done: boolean }[]>`SELECT COALESCE(standing_seen ? 'setup_done', false) AS done FROM builder_profiles WHERE builder_id = ${c.id}`;
  assert.equal(done, false);
  const next = show(await mcpCall(ctx, 'find', {}));
  assert.match(next, /^No worries, add it whenever you're ready\./, next);
});

test('fix round 1 (F5): find {more: true} with step 3 due: the step 3 reply word for word, no table', db, async () => {
  await start();
  const { c, ctx } = await ownerBuilder('w');
  // Step 3 not answered yet (ownerBuilder marks it answered).
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'wallet_asked' - 'wallet_link_at' - 'setup_asked' WHERE builder_id = ${c.id}`;
  const r = await mcpCall(ctx, 'find', { more: true });
  const s = show(r);
  assert.equal((r.reply?.move_up as { kind: string }).kind, 'wallet_setup', s);
  const link = s.match(/no fee: (\S+)/)?.[1] ?? '';
  assert.equal(s, walletSetupAsk('EarnKit', link, s.includes(TOKEN_SENTENCE)));
  assert.doesNotMatch(s, /\| Program \|/, s);
});

test('v4.3 Task 3: standing is absent for 0 weeks, "1 week shipping" for 1, "n weeks shipping in a row" for more', () => {
  assert.deepEqual(standingFields(0), { streak: 0 });
  assert.deepEqual(standingFields(1), { streak: 1, standing: '1 week shipping' });
  assert.deepEqual(standingFields(6), { streak: 6, standing: '6 weeks shipping in a row' });
});

test('v4.3 Task 3: the answer-first note drops points and rank, answers where they stand from standing, and answers points', () => {
  assert.doesNotMatch(ANSWER_FIRST_NOTE, /their points, rank|how ranking works/);
  assert.match(ANSWER_FIRST_NOTE, /from standing and show_to_builder, never points or a rank/);
  assert.ok(ANSWER_FIRST_NOTE.includes("EarnKit doesn't use points. It tracks the weeks you ship."));
});

test('v4.3 Task 3: a find reply carries no points_total or points fact; rank_lines only when non-empty; standing matches the streak', db, async () => {
  await start();
  const { ctx } = await ownerBuilder('p');
  for (const args of [{}, { more: true }] as const) {
    const r = await mcpCall(ctx, 'find', { ...args });
    const reply = r.reply as Record<string, unknown>;
    assert.ok(!('points_total' in reply), JSON.stringify(Object.keys(reply)));
    assert.ok(!('points' in ((reply.facts as object) ?? {})), 'facts carry no points');
    assert.ok(!('points' in (((reply.facts as { about?: object })?.about) ?? {})), 'about carries no points');
    if ('rank_lines' in reply) assert.ok((reply.rank_lines as string[]).length > 0);
    const streak = Number(reply.streak ?? 0);
    assert.equal(reply.standing, standingFields(streak).standing);
  }
});

test('v4.3 Task 3: a not-yet-counted builder (no rank) gets no rank_lines and no points_total', db, async () => {
  await start();
  const t = `ek_v43fan_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  const r = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: false }, 'find', {});
  const reply = r.reply as Record<string, unknown>;
  assert.ok(!('points_total' in reply));
  assert.ok(!('rank_lines' in reply));
  assert.ok(!('standing' in reply) || typeof reply.standing === 'string');
});
