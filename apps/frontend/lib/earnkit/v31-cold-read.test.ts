import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub, type FakeCommit } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { productOdds, productScore, traction, type Detection, type Verdict } from './match';
import type { RepoFit } from './present';
import {
  mainProjectNameFor, NOT_ON_GITHUB_YET,
} from './bench-find';
import {
  LOVABLE_PROMPT_ASK, MOMENT_ASK, nextBuild, NO_GITHUB_HINT, POST_HEAD, TITLES_ASK, WALLET_ASK, baseStartSteps, benchReply, builtWith, connectAsk, grantHook,
  grantProgramName, liveNoGithub, pickRepoAsk, qualifySteps, walletOffer, youreIn,
  type BenchView,
} from './bench-reply';
import { ASKS_HINT, walletSetupAsk } from './bench-reply';
import { proofAsk } from './post-reply';
import { factsAck } from './builder-memory';
import { siteFormLine, youAddLine } from './submit-kit';
import { BUILDER_CODES_FIRST } from './builder-code';
import { writePost, type PostHistory } from './post-writer';
import { chainFitLine, eligibilityLine } from './tools';
import { moneyHeader, noFitLine, presentFirstMessage, APPLIED_OUTSIDE, type Card, type FirstMessage } from './present';
import { ANSWER_FIRST_NOTE } from './stand-text';
import { SERVER_INSTRUCTIONS } from './mcp';

/**
 * v3.1 cold-read fixes (owner-approved spec, docs/design-docs-and-implementation-plans/v3.1-cold-read-fixes.md): the
 * approved copy word for word, the bugs (no empty connect yes, repo facts acknowledged, one name, "applied"), the status
 * line and points line throttles (v4.0 Task 11: the coin ask's paths and the backing line are retired), and the wallet step's gate. Every reply: at most one https link, one question at most
 * (exactly one where it asks), no emoji, never an em dash.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-cold-read-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const clean = (s: string) => {
  assert.ok(links(s).length <= 1, s);
  assert.ok(questions(s) <= 1, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}/u, s);
  assert.doesNotMatch(s, /EARN points/, s);
  return s;
};
const asks = (s: string) => {
  clean(s);
  assert.equal(questions(s), 1, s);
  return s;
};
const LINK = 'https://earnkit.com/github/verify?n=abc';
const BASE = { org: 'Base', amount: '$5,000', chain: 'Base', name: 'Base Builder Grants' };

test('the approved copy, word for word', () => {
  assert.equal(youreIn('maya'), "You're in, @maya. Really glad you're here.");
  assert.equal(grantHook(BASE), 'Base Builder Grants pay up to $5,000 for apps on Base.');
  assert.equal(grantProgramName('Base Builder Grant Program'), 'Base Builder Grants');
  assert.equal(grantProgramName('Circle Developer Grants'), 'Circle Developer Grants');
  assert.equal(pickRepoAsk(LINK, false), [
    `**Step 2 of 3:** connect your app's code on GitHub so I can match you to the right programs. Read-only, one click: ${LINK}`,
    '',
    'Done?',
  ].join('\n'));
  assert.equal(pickRepoAsk(LINK, true), [
    `**Step 2 of 3:** connect your app's code on GitHub so I can match you to the right programs. Read-only, one click: ${LINK}`,
    '',
    'Built it in Lovable or Bolt? Connect GitHub there first (Lovable: Project settings, then Git. Bolt: the GitHub icon, top right).',
    '',
    'Done?',
  ].join('\n'));
  assert.equal(liveNoGithub('lovable', 'MealMate', LINK),
    `Lovable puts MealMate's code on GitHub in two clicks: Project settings, then Git, then GitHub. Then connect it here: ${LINK}\nDone?`);
  assert.equal(liveNoGithub('bolt', 'MealMate', LINK), `Bolt puts MealMate's code on GitHub from the GitHub icon, top right. Then connect it here: ${LINK}\nDone?`);
  assert.equal(liveNoGithub(null, 'MealMate', LINK),
    `Lovable or Bolt put your code on GitHub in two clicks (Lovable: Project settings, Git. Bolt: GitHub icon, top right). Then connect it here: ${LINK}\nDone?`);
  assert.deepEqual([builtWith('https://mealmate.lovable.app'), builtWith('https://x.bolt.host/'), builtWith('https://tipflow.xyz')], ['lovable', 'bolt', null]);
  assert.equal(baseStartSteps(BASE), [
    "Here's the path to Base's $5,000 grant:",
    '1. Build your app in Lovable or Bolt. Describe the idea and they write the code.',
    '2. Connect it to GitHub inside Lovable or Bolt.',
    "3. Connect GitHub here and I'll tell you what's left.",
    'Want me to write your Lovable prompt?',
  ].join('\n'));
  assert.equal(LOVABLE_PROMPT_ASK, 'Want me to write your Lovable prompt?');
  assert.equal(connectAsk('https://earnkit.com/kit'), 'Make your shipping log public on https://earnkit.com/kit so grant teams can see it?');
  assert.equal(proofAsk('Base Builder Grant Program'), "Congrats on the Base Builder Grant Program. Got the announcement link? I'll turn it into a post.");
  assert.deepEqual([MOMENT_ASK, POST_HEAD], ['Looks right?', 'Your post for X:']);
  assert.equal(qualifySteps(BASE, ['codes']), [
    "Your next step toward Base's $5,000 grant:",
    "1. Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic: https://docs.base.org/base-chain/builder-codes/builder-codes",
    '',
    'Want help with it now?',
  ].join('\n'));
  assert.equal(moneyHeader(4, { title: 'Base Builder Grant Program', max_award_usd: 5000 }), '4 programs are open. Your best fit: Base Builder Grant Program, up to $5,000.');
  assert.equal(moneyHeader(1, null), '1 program is open.');
  assert.equal(noFitLine('VaultPilot'), "VaultPilot doesn't fit an open program yet.");
  assert.equal(chainFitLine('no arc code found in this repo', 'Circle', 'VaultPilot'), "Circle wants apps that settle on Arc, Circle's chain. VaultPilot has no Arc code yet.");
  assert.equal(eligibilityLine('kai/vaultpilot', { status: 'no', note: 'no arc code found in this repo' }, { org: 'Circle', name: 'VaultPilot' }),
    "Circle wants apps that settle on Arc, Circle's chain. VaultPilot has no Arc code yet.");
  assert.equal(TITLES_ASK, 'Show what you shipped (commit titles) on your page so grant teams see real progress? Your code stays private.');
  assert.equal(walletOffer('https://earnkit.com/claim/wallet?t=x'), 'Prove your Base wallet so your contracts show on your page. One signature, no fee: https://earnkit.com/claim/wallet?t=x\nDone?');
  assert.equal(WALLET_ASK, 'Done?');
  assert.equal(APPLIED_OUTSIDE, 'applied');
  assert.match(ANSWER_FIRST_NOTE, /first answer it in one short line from show_to_builder and facts only/);
  assert.match(SERVER_INSTRUCTIONS, /answer it in one short line from facts in the reply, never invented/);
  assert.ok(SERVER_INSTRUCTIONS.length < 800, String(SERVER_INSTRUCTIONS.length));
  for (const s of [pickRepoAsk(LINK, false), liveNoGithub('lovable', 'MealMate', LINK), baseStartSteps(BASE),
    connectAsk('https://earnkit.com/kit'), proofAsk('X'), TITLES_ASK, walletOffer('https://earnkit.com/claim/wallet?t=x')]) asks(s);
  for (const s of [youreIn('maya'), grantHook(BASE), NO_GITHUB_HINT, NOT_ON_GITHUB_YET]) clean(s);
});

test('bug 2: repo facts are acknowledged in one short line, from their own words', () => {
  assert.equal(factsAck([{ mainnet_chains: [{ chain: 'base', mainnet: true }], has_users: true }]), 'Noted: live on Base with users.');
  assert.equal(factsAck([{ has_users: false }]), 'Noted: no users yet.');
  assert.equal(factsAck([{ testnet_chains: [{ chain: 'arc' }] }]), 'Noted: on Arc testnet.');
  assert.equal(factsAck([{ not_mine: true }]), "Noted: that project isn't yours.");
  assert.equal(factsAck([{}]), 'Noted.');
  assert.equal(factsAck([]), null);
});

test('email-only investment forms: one line with the link, never "I filled 0 of 1 answer"', () => {
  const p = {
    investment: true, organizer: 'a16z', title: 'a16z speedrun SR008', submission_url: 'https://speedrun.a16z.com/apply',
    submission_requirements: [{ key: 'email', label: 'Email', required: true }],
  } as never;
  assert.equal(siteFormLine(p, 'your email'), "a16z speedrun's application is on their site and starts with your email: https://speedrun.a16z.com/apply");
  assert.equal(siteFormLine({ ...(p as object), investment: false } as never, null), null);
});

/** A ranked view for benchReply. */
const view = (o: Partial<BenchView> = {}): BenchView => ({
  state: 'ranked', variant: null, project: { key: 'kit/kit', name: 'Kit', confirmed: true, live: true, weeks: 3 }, rank: '#1 of 13 builders', streak: 3,
  target: null, handle: 'kit', link: null, fund: [], due: [], ask: { kind: 'ship', project_key: 'kit/kit', line: 'Want me to suggest one small thing to ship?' }, held: null,
  ...o,
});

test('status line and ship line: shown only when changed or once a week; a reply is never empty', () => {
  const STAND = 'Kit · #1 of 13 builders · 3 weeks in a row';
  // v4.7 T4: the ship ask's why line takes the ship line's place (once a week, as it was), its own paragraph.
  assert.equal(benchReply(view()), `${STAND}\n\nShipping this week keeps your 3-week streak and lifts your score.\n\nWant me to suggest one small thing to ship?`);
  // v4.7 T4 fix round 0 (R14): the ship ask's why on every ship ask, the weekly line or not.
  assert.equal(benchReply(view({ standingShown: false, nagShown: false })), 'Shipping this week keeps your 3-week streak and lifts your score.\n\nWant me to suggest one small thing to ship?');
  // Nothing else to say: the standing, never an empty reply (and never the ship line alone).
  assert.equal(benchReply(view({ standingShown: false, nagShown: false, ask: { kind: 'none', project_key: 'kit/kit', line: '' } })), STAND);
  assert.equal(benchReply(view({ standingShown: false, nagShown: true, ask: { kind: 'none', project_key: 'kit/kit', line: '' } })), `${STAND}\nShip code this week.`);
});

let n = 0;
type B = { ctx: Parameters<typeof mcpCall>[0]; id: number; key: string; handle: string; gh: ReturnType<typeof fakeGitHub> };
/** A ranked builder (signed in with X, the repo proven by the App and read public); `wallet`: a proven wallet. */
async function builder(tag: string, o: { key?: string; wallet?: boolean; base?: boolean; commits?: FakeCommit[] } = {}): Promise<B> {
  n++;
  const t = `ek_cr_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `cr${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `96${RUN}${n}${tag.length}`, username: handle, name: 'cr', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = o.key ?? `cr${tag}${RUN}/kit`;
  const chains: Detection = o.base ? { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } } : {};
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 0, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 0, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts: [] }];
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never,
    tokenDeps: { check: async () => true },
  } as Parameters<typeof mcpCall>[0];
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 8100 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key.toLowerCase()]: { id: gid, owner: handle, installation: gid + 1, ...(o.commits && { commits: o.commits }) } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  // The setup's own find already said the standing and the points line: the test's first find is a fresh look.
  await sql()`UPDATE builder_profiles SET standing_seen = (COALESCE(standing_seen, '{}'::jsonb) - 'status_seen' - 'nag_week' - 'ship_asked' - 'wallet_asked')
    || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  if (o.wallet !== false) await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${(c.id + 3000).toString(16).padStart(40, '0')}`}, ${c.id}) ON CONFLICT DO NOTHING`;
  return { ctx, id: c.id, key, handle, gh };
}
const find = (b: B) => mcpCall(b.ctx, 'find', {});
const tell = (b: B, args: Record<string, unknown>) => mcpCall(b.ctx, 'tell', args);
const seen = async (id: number) => ((await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0]?.s ?? {});

/** A signed-in builder with no project yet (the connect step). */
async function newcomer(tag: string) {
  n++;
  const t = `ek_crn_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const own = (await connectInstallation(t))!.own;
  const handle = `cn${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `95${RUN}${n}${tag.length}`, username: handle, name: 'cn', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  return { ctx, id: c.id, handle };
}

test('"You\'re in" only on the first reply; bug 1: a connect yes with nothing connected is never empty', db, async () => {
  const p = await newcomer('w');
  const first = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  asks(first);
  assert.ok(first.startsWith(`You're in, @${p.handle}. Really glad you're here.\n\n`), first);
  assert.doesNotMatch(first, /Step 2 of 2|isn't counted yet/);
  const second = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.doesNotMatch(second, /You're in/, second);
  // v3.1 answerable replies (spec 6): the same day, the short form (the money line and the Lovable or Bolt hint once a day).
  assert.equal(second, `Connect your app's code so I can match it (read-only, one click): ${second.match(/https:\/\/\S+/)?.[0]}\nDone?`);
  const yes = await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } });
  const s = show(yes);
  asks(s);
  assert.ok(s.startsWith(`${NOT_ON_GITHUB_YET} Once it's there, connect it here: https://earnkit.com/github/verify?n=`), s);
  assert.equal((yes.reply?.move_up as { kind: string }).kind, 'pick_repo');
});

test('a live Lovable app and a GitHub no: its GitHub steps with the link, never the Base walk-through; a second no rests', db, async () => {
  const p = await newcomer('l');
  await mcpCall(p.ctx, 'find', { agent_can_build: false, identity: { project: { name: 'MealMate', live_url: 'https://mealmate.lovable.app' } } });
  const no = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'no' } }));
  asks(no);
  assert.match(no, /^Lovable puts MealMate's code on GitHub in two clicks: Project settings, then Git, then GitHub\. Then connect it here: https:\/\/earnkit\.com\/github\/verify\?n=\S+\nDone\?$/, no);
  const again = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.match(again, /^Lovable puts MealMate's code/, again);
  assert.doesNotMatch(again, /start building on Base/);
  const no2 = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'no' } }));
  assert.match(no2, /^No rush\./, no2);
});

test('the status line only when it changed, the points line once a week; score always shows where they stand', db, async () => {
  const b = await builder('s', { wallet: true });
  const one = show(await find(b));
  clean(one);
  // v4.7.1 T1: the standing is v4.7's paragraph, never the old "Kit is on EarnKit." line while it has a part.
  assert.match(one, /^Score \d+\. No grants won yet\./, one);
  // v4.3: with no fit, Base's grant reply (its money and gap, then its question); it carries no ship line.
  assert.match(one, /\nBase Builder Grants: \$5,000, rolling\. [^\n]+\n\n(?:Also open: [^\n]+\n\n)?Want [^\n]*\?$/, one);
  // Later replies this week: once the one-time questions are asked, nothing else to say, so the unchanged standing alone
  // (no points line again this week).
  let r2 = await find(b);
  for (let i = 0; i < 5 && questions(show(r2)) > 0; i++) {
    const m = r2.reply?.move_up as { kind: string; project_key: string | null } | undefined;
    if (m) await tell(b, { move_up: { kind: m.kind, project_key: m.project_key, answer: 'no' } });
    r2 = await find(b);
  }
  const two = show(r2);
  assert.doesNotMatch(two, /points/, two);
  // v4.7.2 T2 (no program left): the quiet reply ends with ASKS_HINT, its own paragraph, after the one money line.
  assert.equal(two.split('\n\n').at(-1), ASKS_HINT, two);
  assert.equal(two.slice(0, -ASKS_HINT.length).trim().split('\n').length, 1, two);
  const st = await seen(b.id);
  assert.equal(typeof st.status_seen, 'string');
  assert.equal(typeof st.nag_week, 'string');
  // v4.7 T2: score always says where they stand: its standing paragraph first (never points).
  const sr = await mcpCall(b.ctx, 'score', {});
  const score = show(sr);
  assert.ok(score.startsWith(String(sr.reply?.standing)), score);
  assert.match(score, /^Score \d+\. No grants won yet\./, score);
  assert.doesNotMatch(score, /points/, score);
});

test('the wallet step (v4.0 setup step 3): every builder once the App connects, Base contracts or not; the older Base step never shows', db, async () => {
  const none = await builder('n', { wallet: false });
  const a = show(await find(none));
  assert.equal(a, walletSetupAsk('Kit', links(a)[0] ?? ''), a);
  assert.doesNotMatch(a, /Prove your Base wallet/, a);
  const based = await builder('b', { wallet: false });
  await sql()`INSERT INTO builder_repo_facts (installation_id, login, repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine, at)
    VALUES (${based.id}, '', ${based.key.toLowerCase()}, ${['base']}, ${[]}, null, null, false, now())`;
  const b = show(await find(based));
  assert.equal(b, walletSetupAsk('Kit', links(b)[0] ?? ''), b);
  asks(b);
  // Asked once: the next reply never offers the older step either.
  assert.doesNotMatch(show(await find(based)), /Prove your Base wallet|Step 3 of 3/);
});

test('bug 2 and 3: repo facts acknowledged; the name given in prepare wins in every later reply', db, async () => {
  const b = await builder('r');
  const r = await tell(b, { repo_facts: [{ repo: b.key, mainnet_chains: ['base'], has_users: true }] });
  assert.equal(show(r), 'Noted: live on Base with users.');
  await mcpCall(b.ctx, 'prepare', { program_id: 'base-builder-grants', project: { name: 'KitFlow', repo_url: `https://github.com/${b.key}` } }).catch(() => null);
  // v4.7 T2: score leads with the standing paragraph (no name). v4.7.1 T1: so does find's; its step carries the name.
  const s = show(await find(b));
  assert.match(s, /\. To qualify, KitFlow needs to add Builder Codes, /, s);
  assert.equal(s.split('\n').at(-1), 'Want me to add Builder Codes to KitFlow?', s);
  // Security review: the name is used for an eligibility line only about the builder's own one project.
  assert.equal(await mainProjectNameFor(b.id, `https://github.com/${b.key}`), 'KitFlow');
  assert.equal(await mainProjectNameFor(b.id, 'someone/else'), null);
  // A shared client (one agent, many builders) never reads the stored name into a program's eligibility line.
  const shared = { ...(b.ctx as object), sharedClient: true } as Parameters<typeof mcpCall>[0];
  const g = await mcpCall(shared, 'find', { program_id: 'circle-developer-grants', repo: b.key });
  assert.doesNotMatch(show(g), /KitFlow/, show(g));
});

test('bug 4: an application told as sent is saved as "applied", never "applied outside EarnKit"', db, async () => {
  const b = await builder('t');
  const r = await tell(b, { program_status: [{ program_id: 'base-builder-grants', status: 'applied' }] });
  assert.ok(Array.isArray(r.reply?.saved), JSON.stringify(r.reply));
  assert.ok((r.reply!.saved as string[]).includes('base-builder-grants: applied'), JSON.stringify(r.reply!.saved));
});

// --- Round 2 (the coordinator's cold read of journeys-coldread) --------------------------------------------------------

test('round 2: draft lines: "You add N more in the form", the Builder Code step with a plain guide path', () => {
  assert.equal(youAddLine(['your email']), 'You add 1 more in the form: your email.');
  assert.equal(youAddLine(['your email', 'your X handle']), 'You add 2 more in the form: your email and your X handle.');
  const twelve = ['your email', 'your X handle', ...Array.from({ length: 10 }, (_, i) => `answer ${i}`)];
  assert.equal(youAddLine(twelve), 'You add 12 more in the form: your email, your X handle and 10 short answers.');
  assert.equal(BUILDER_CODES_FIRST, "Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic (guide: docs.base.org/base-chain/builder-codes/builder-codes).");
  assert.doesNotMatch(BUILDER_CODES_FIRST, /https?:\/\//);
});

test('round 2: weekly posts are about the finished week: "Last week:", never "This week:"', () => {
  const history: PostHistory = [];
  for (let week = 1; week <= 26; week++) {
    for (const name of ['Recipes', null]) {
      const p = writePost({ moment: 'weekly', name, week, summary: 'Added CSV export.', note: null }, history);
      if (!p) continue;
      assert.doesNotMatch(p.text, /\bThis week\b/i, p.text);
      history.unshift(p);
    }
  }
  assert.ok(history.some((p) => /Last week: added CSV export\./.test(p.text)), JSON.stringify(history.slice(0, 5)));
});

/** Minimal open cards for the money table. */
const NOW = new Date('2026-10-10T12:00:00Z');
const level = (l: 'Easy' | 'Medium' | 'Hard') => ({ level: l, estimate: false, rated: true, basis: 'x' }) as Card['difficulty'];
const grantCard = (id: string, title: string, l: 'Easy' | 'Medium' | 'Hard', usd: number): Card =>
  ({ id, title, summary: `up to $${usd} · rolling`, tag: null, each_time: [], ends_at: null, max_award_usd: usd, builder_fields: 1, difficulty: level(l) }) as Card;
const hardGrant = grantCard('hard-g', 'Hard Grant', 'Hard', 50_000);
const mediumGrant = grantCard('medium-g', 'Medium Grant', 'Medium', 5_000);
const invest: Card = { ...grantCard('vc', 'Big Fund', 'Easy', 1_000_000), investment: true };
const msg = (m: Partial<FirstMessage>): FirstMessage =>
  ({ alerts: [], campaigns: [], cards: [], repos: null, workingOn: [], agentCanBuild: true, sponsorEntries: null, now: NOW, more: true, ...m }) as FirstMessage;
const GOOD = { score: 6, tier: 'product' as const, missing: [], traction: 8, odds: 'good' as const, low_reason: null };
const verdict = (program_id: string, status: Verdict['status'], note: string | null): Verdict => ({ program_id, program: program_id, status, missing: [], effort: 'none', note });
const one = (...verdicts: Verdict[]) => ({ checked: 1, fits: [{ repo: 'kit', repo_url: null, verdicts, product: GOOD }] }) as unknown as FirstMessage['repos'];
const rows = (t: string) => t.split('\n').filter((l) => /^\| (?!Program|---)/.test(l)).map((l) => l.split('|')[1].trim());

test('round 2: money tables put what the builder can get first (grants by difficulty), long shots last; no project asks for a guide', () => {
  const noRepo = presentFirstMessage(msg({ cards: [invest, hardGrant, mediumGrant] }));
  assert.deepEqual(rows(noRepo), ['Medium Grant', 'Hard Grant', 'Big Fund']);
  assert.match(noRepo, /\n\nWant the guide for [^?\n]+\?$/, noRepo);
  assert.doesNotMatch(noRepo, /Want me to start on/);
  clean(noRepo);
  // Every matched row a long shot (an investment): the open grants first, the long shot after.
  const longOnly = presentFirstMessage(msg({ cards: [invest, hardGrant, mediumGrant], repos: one(verdict('vc', 'likely', null)) }));
  const at = (s: string) => longOnly.indexOf(`| ${s} |`);
  assert.ok(at('Medium Grant') >= 0 && at('Medium Grant') < at('Big Fund') && at('Hard Grant') < at('Big Fund'), longOnly);
  assert.match(longOnly, /^3 programs are open\.\n\n/, longOnly);
});

test('round 2: a "confirm: ..." note (the builder\'s own statement) never shows in the table', () => {
  const t = presentFirstMessage(msg({ cards: [mediumGrant], repos: one(verdict('medium-g', 'after_step', 'confirm: mainnet and users')) }));
  assert.doesNotMatch(t, /confirm:/, t);
  assert.match(t, /\| Medium Grant \|[^\n]*\| kit \|/, t);
});

test('round 2: after the walk-through, its question stands until the Lovable prompt; then find gives the next step, never "Is your app\'s code on GitHub yet?"', db, async () => {
  const p = await newcomer('k');
  await mcpCall(p.ctx, 'find', { agent_can_build: false });
  await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'no' } });
  await mcpCall(p.ctx, 'tell', { move_up: { kind: 'base_start', project_key: null, answer: 'yes' } });
  // v4.0: setup step 3 once (the GitHub no answered step 2), then the walk-through's question.
  assert.match(show(await mcpCall(p.ctx, 'find', { agent_can_build: false })), /\*\*Step 3 of 3:\*\*/);
  // Before the prompt is written: the walk-through's question again.
  const before = await mcpCall(p.ctx, 'find', { agent_can_build: false });
  assert.equal(asks(show(before)), LOVABLE_PROMPT_ASK);
  assert.equal((before.reply?.move_up as { kind: string }).kind, 'base_help');
  assert.equal(show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'base_help', project_key: null, answer: 'yes' } })), '');
  for (const r of [await mcpCall(p.ctx, 'find', { agent_can_build: false }), await mcpCall(p.ctx, 'score', {})]) {
    const s = asks(show(r));
    const link = links(s)[0];
    assert.ok(link?.startsWith('https://earnkit.com/github/verify?n='), s);
    assert.equal(s, nextBuild(link!));
    assert.doesNotMatch(s, /Is your app's code on GitHub yet\?/);
  }
});

