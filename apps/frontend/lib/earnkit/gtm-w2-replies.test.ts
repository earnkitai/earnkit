import './fixtures/no-network-checks';
import type { ProofFetch } from './outcome-proof';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { walletOffered } from './fixtures/wallet-step';
import { withEnv } from './fixtures/find';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { lastFinishedMonday } from './weeks';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { BASE_GRANTS_ID } from './builder-code';
import {
  CHECKIN_ASK, CHECKIN_ON, NEXT_STEP_LATER, SHIP_ASK, grantHook, liveNoGithub,
} from './bench-reply';
import { CHECKIN_MAX_ASKS, CHECKIN_NOTE, CHECKIN_YES_NOTE, checkinAskDue, EMAIL_ASK_NOTE, NOT_ON_GITHUB_YET, openGrant } from './bench-find';
import { outcomeCongrats } from './post-reply';
import { appliedLine } from './tools';
import { reachOf } from './agent-reach';
import { listPrograms } from './programs';
import { highlights } from './site-data';
import { profileData, type ProfileData } from './bench-data';
import type { Card } from './present';

/**
 * GTM W2 (2026-10-23): the reply journey fixes, through the real MCP tools/call path. Value before the ask; the
 * Lovable/Bolt no-GitHub path; hosted agents' notes and the weekly ship question; the coin offered first once proven,
 * a private repo's coin under its public name, the launch reply and the backers answer; tell submitted; an outcome's
 * congrats and Highlight; an App already installed; the Monday check-in and the email move_up. Every reply: at most one
 * https link, at most one question, no em dash or emoji.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'gtm-w2-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
type Ctx = Parameters<typeof mcpCall>[0];
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const rule = (s: string, asks = 1) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), asks, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}|community round|EARN points/u, s);
  return s;
};
const moveUp = (r: R) => r.reply?.move_up as { kind: string; project_key: string | null; agent_note: string } | undefined;
const seen = async (id: number) => ((await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0]?.s ?? {});
const tellMove = (ctx: Ctx, kind: string, answer: 'yes' | 'no', project_key: string | null = null) => mcpCall(ctx, 'tell', { move_up: { kind, project_key, answer } });

let nextX = 0;
/** A builder signed in with X at install (a page, no project yet), on agent `client`. */
async function signedIn(tag: string, client = 'Claude Code') {
  const t = `ek_w2_${tag}_${RUN}_${randomBytes(6).toString('hex')}`;
  await saveInstallation(t, undefined, false, client);
  const own = (await connectInstallation(t))!.own;
  const username = `w2${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `96${RUN}${++nextX}`, username, name: 'Maya Ortiz', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }), readerDeps } as never as Ctx;
  return { id: c.id, own: c.own, ctx, username, login: username.toLowerCase() };
}

/** The open grant the replies name (the listed programs' first, as find orders them). */
async function grantLine(): Promise<string> {
  const g = openGrant((await listPrograms()) as Card[], new Date(), new Set());
  assert.ok(g, 'an open grant is listed');
  return grantHook(g);
}

test('copy: word for word, one question each', () => {
  // v3.1 cold read: a live app with no GitHub hears its tool's two clicks, then the connect link.
  assert.equal(liveNoGithub('lovable', 'MealMate', 'https://x.test/l'),
    "Lovable puts MealMate's code on GitHub in two clicks: Project settings, then Git, then GitHub. Then connect it here: https://x.test/l\nDone?");
  assert.equal(liveNoGithub('bolt', 'MealMate', 'https://x.test/l'),
    "Bolt puts MealMate's code on GitHub from the GitHub icon, top right. Then connect it here: https://x.test/l\nDone?");
  assert.equal(liveNoGithub(null, 'MealMate', 'https://x.test/l'),
    'Lovable or Bolt put your code on GitHub in two clicks (Lovable: Project settings, Git. Bolt: GitHub icon, top right). Then connect it here: https://x.test/l\nDone?');
  assert.equal(CHECKIN_ASK, 'Want me to check in here every Monday?');
  assert.equal(outcomeCongrats('accepted', 'Base Builder Grant Program'), 'Congrats on getting into the Base Builder Grant Program.');
  assert.equal(outcomeCongrats('funded', null), 'Congrats.');
  assert.equal(appliedLine('a16z speedrun SR008'), 'Saved: you applied to the a16z speedrun SR008.');
  for (const s of [liveNoGithub('lovable', 'MealMate', 'https://x.test/l'), CHECKIN_ASK]) rule(s);
  for (const s of [NEXT_STEP_LATER, CHECKIN_ON]) rule(s, 0);
  // Hosted agents (no folder) and the agents that can schedule (Grok Bot registers as Cursor).
  assert.deepEqual(reachOf('Grok', false), { hosted: true, schedules: true });
  assert.deepEqual(reachOf('Cursor', false), { hosted: false, schedules: true });
  assert.deepEqual(reachOf('Muse', false), { hosted: true, schedules: false });
  assert.deepEqual(reachOf('Claude Code', false), { hosted: false, schedules: false });
  assert.deepEqual(reachOf('Claude Code', true), { hosted: true, schedules: true });
  assert.match(CHECKIN_NOTE, /weekly routine \(a scheduled task or cron\).*calls find and shows its show_to_builder/);
  assert.match(CHECKIN_YES_NOTE, /calls find and shows its show_to_builder/);
  assert.match(EMAIL_ASK_NOTE, /weekly_email: \{ answer: 'yes', email \}/);
});

test('value before the ask: the first reply names the open grant before the GitHub step, one link, one question', db, async () => {
  const p = await signedIn('v');
  const s = rule(show(await mcpCall(p.ctx, 'find', {})));
  // v4.0 approved copy 2: the welcome reply is the welcome and step 2 alone (the intro, step 1, named the grant).
  const lines = s.split('\n');
  assert.equal(lines[0], `You're in, @${p.username}. Really glad you're here.`);
  assert.equal(lines[1], '');
  assert.match(lines[2], /^\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you to the right programs\. Read-only, one click: /);
  assert.ok(!s.includes(await grantLine()), s);
  // v3.1 cold read: "You're in" only on the first reply after sign-in.
  assert.doesNotMatch(show(await mcpCall(p.ctx, 'find', {})), /You're in/);
  // A later day's full pitch (not the welcome) still names the open grant before the GitHub step.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || '{"pitch_day":"2000-01-01"}'::jsonb WHERE builder_id = ${p.id}`;
  const later = rule(show(await mcpCall(p.ctx, 'find', {})));
  assert.equal(later.split('\n')[0], await grantLine());
  assert.ok(later.indexOf('pays up to $') < later.indexOf('github/verify'), 'money before the GitHub step');
});

test('Lovable app, no GitHub: the live link routes into the connect step, then Lovable\'s own GitHub steps (never the Base walk-through); never "Okay.", the host or "Where does it live"', db, async () => {
  const p = await signedIn('l', 'Grok');
  const identity = { project: { name: 'MealMate', what: 'a meal planner', live_url: 'https://mealmate.lovable.app' } };
  const r1 = await mcpCall(p.ctx, 'find', { agent_can_build: false, identity });
  // v4.0 approved copy 2: a link-only project has no GitHub: the Lovable or Bolt hint (its own question) under step 2.
  const s1 = rule(show(r1), 2);
  assert.match(s1, new RegExp(`^You're in, @${p.username}\\. Really glad you're here\\.\n\n`));
  assert.doesNotMatch(s1, /isn't counted yet|Step 2 of 2/);
  assert.match(s1, /\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you to the right programs\. Read-only, one click: https:\/\/earnkit\.com\/github\/verify\?n=\S+\n\nBuilt it in Lovable or Bolt\?/);
  assert.doesNotMatch(s1, /Where does|lovable\.app|coding agent/i);
  assert.equal(moveUp(r1)?.kind, 'pick_repo');
  // The next find never says "You're in" again, nor the host.
  const s2 = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.doesNotMatch(s2, /You're in|lovable\.app/i);
  // "No GitHub": Lovable's own steps with the connect link, never "Okay." or the Base walk-through.
  const no = await tellMove(p.ctx, 'pick_repo', 'no');
  const ns = rule(show(no));
  assert.match(ns, /^Lovable puts MealMate's code on GitHub in two clicks: Project settings, then Git, then GitHub\. Then connect it here: https:\/\/earnkit\.com\/github\/verify\?n=\S+\nDone\?$/);
  assert.doesNotMatch(ns, /start building on Base/);
  assert.equal(moveUp(no)?.kind, 'pick_repo');
  assert.ok((await seen(p.id)).github_no_app, 'remembered');
  // Every later reply shows the same steps; a "done" with nothing connected says so (never an empty reply).
  assert.match(show(await mcpCall(p.ctx, 'find', { agent_can_build: false })), /^Lovable puts MealMate's code on GitHub/);
  const notYet = await tellMove(p.ctx, 'pick_repo', 'yes');
  assert.match(rule(show(notYet)), new RegExp(`^${NOT_ON_GITHUB_YET.replace(/[.']/g, (c) => `\\${c}`)} Lovable puts MealMate's code on GitHub`));
  // A second no: "No rush.", never "Okay.".
  assert.equal(show(await tellMove(p.ctx, 'pick_repo', 'no')), NEXT_STEP_LATER);
  // The programs table on a chat-only agent never sends the builder to another agent.
  assert.doesNotMatch(show(await mcpCall(p.ctx, 'find', { agent_can_build: false, more: true })), /coding agent|Claude Code, Cursor|can't build or deploy/);
  // An older reply's "Where does it live on GitHub?" answered no is the same path, never "Okay.".
  const q = await signedIn('q', 'Grok');
  await mcpCall(q.ctx, 'find', { agent_can_build: false, identity: { project: { live_url: 'https://other.lovable.app' } } });
  assert.doesNotMatch(show(await mcpCall(q.ctx, 'find', {})), /isn't counted yet/);
  const old = await tellMove(q.ctx, 'repo_behind', 'no', 'https://other.lovable.app');
  assert.match(show(old), /^Lovable puts your app's code on GitHub in two clicks/);
});

/** A signed-in builder whose one public project is ranked (App-proven, recent code), quiet steps already asked. */
async function ranked(tag: string, client: string, o: { seen?: Record<string, unknown> } = {}) {
  const p = await signedIn(tag, client);
  await walletOffered(p.id);
  const key = `${p.login}/kit`;
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 0, live_ok: false, commits_90d: 3 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: null, created_at: '2025-01-01T00:00:00Z', chains: {}, commits_in_window: {}, product, tx_count: 0, commits_90d: 3 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, verdicts: [] } as never];
  const commits = [7, 14, 21].map((d, i) => ({ sha: `r${i}`, message: `Ship feature ${i}`, date: new Date(Date.now() - d * 86_400_000).toISOString() }));
  const gid = Number(`63${RUN}`) + nextX;
  const gh = fakeGitHub({ [key]: { id: Number(`78${RUN}`) + nextX, owner: p.login, installation: gid, commits } });
  const ctx = { ...(p.ctx as object), codesFetch: gh as typeof fetch, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never } as never as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: p.id, repoKey: key, login: p.login, gh });
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${p.id} AND kind = 'repo'`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || ${sql().json({
    connect_done: new Date().toISOString(), new_repo_asked: new Date().toISOString(), qualify_given: { [key]: new Date().toISOString() }, ...(o.seen ?? {}),
  } as never)}::jsonb WHERE builder_id = ${p.id}`;
  return { ...p, ctx, key, gh, gid };
}

test('hosted agent: the Monday check-in once (its routine in the note), notes never say "this folder" or git log, the ship question once a week', db, async () => {
  const b = await ranked('h', 'Claude Code');
  // The agent says it can't build: no folder, and it can schedule (a hosted agent).
  const c1 = await mcpCall(b.ctx, 'find', { agent_can_build: false });
  const s1 = rule(show(c1));
  assert.equal(s1.split('\n').at(-1), CHECKIN_ASK);
  assert.deepEqual([moveUp(c1)?.kind, moveUp(c1)?.agent_note], ['checkin', CHECKIN_NOTE]);
  const yes = await tellMove(b.ctx, 'checkin', 'yes', b.key);
  assert.equal(show(yes), CHECKIN_ON);
  assert.equal(yes.reply?.agent_note, CHECKIN_YES_NOTE);
  assert.deepEqual(((await seen(b.id)).checkin as { answer: string }).answer, 'yes');
  // Never asked again; the quiet reply asks the ship question, its note for an agent with no folder.
  const c2 = await mcpCall(b.ctx, 'find', {});
  assert.equal(rule(show(c2)).split('\n').filter((l) => l === SHIP_ASK).length, 1);
  assert.equal(moveUp(c2)?.kind, 'ship');
  assert.doesNotMatch(moveUp(c2)!.agent_note, /this folder|git log/);
  const shipYes = await tellMove(b.ctx, 'ship', 'yes', b.key);
  assert.doesNotMatch(String(shipYes.reply?.agent_note), /this folder|git log/);
  // Within 7 days: no ship question again (no question at all, no move_up).
  const c3 = await mcpCall(b.ctx, 'find', {});
  const s3 = rule(show(c3), 0);
  assert.doesNotMatch(s3, /check in|suggest one small thing/);
  assert.equal(moveUp(c3), undefined);
  // 8 days on, it may be asked again.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('ship_asked', (now() - interval '8 days')::text) WHERE builder_id = ${b.id}`;
  assert.equal(moveUp(await mcpCall(b.ctx, 'find', {}))?.kind, 'ship');
  // A local coding agent that can't schedule: no check-in, its ship note keeps the folder.
  const local = await ranked('k', 'Claude Code');
  const l1 = await mcpCall(local.ctx, 'find', {});
  assert.equal(moveUp(l1)?.kind, 'ship');
  assert.match(moveUp(l1)!.agent_note, /this folder/);
});

test('App already installed: switching the main repo proves it at once, never "install" or "Step 2 of 2" again', db, async () => {
  const b = await ranked('a', 'OpenClaw', { seen: { checkin_asked: new Date().toISOString() } });
  const other = `${b.login}/vault`;
  // The same installation (the builder picked all repos) covers the second repo.
  b.gh.repos[other] = { id: Number(`79${RUN}`) + nextX, owner: b.login, installation: b.gid, commits: [{ sha: 'v1', message: 'Vault', date: new Date(Date.now() - 3 * 86_400_000).toISOString() }] };
  const was = globalThis.fetch;
  globalThis.fetch = b.gh as typeof fetch;
  try {
    const r = await mcpCall(b.ctx, 'tell', { main_project: other });
    assert.equal(show(r), `EarnKit now ranks github.com/${other}.`);
    const f = show(await mcpCall(b.ctx, 'find', {}));
    assert.doesNotMatch(f, /Step 2 of 2|Install the read-only|isn't connected/, f);
  } finally {
    globalThis.fetch = was;
  }
  // Security review: the same login but an App installation that isn't on this builder's own verification proves nothing.
  const { proveCovered } = await import('./repo-proof');
  const stranger = `${b.login}/taken`;
  b.gh.repos[stranger] = { id: Number(`78${RUN}`) + nextX, owner: b.login, installation: b.gid + 1, commits: [{ sha: 't1', message: 'Taken', date: new Date().toISOString() }] };
  globalThis.fetch = b.gh as typeof fetch;
  try {
    assert.equal(await proveCovered(b.id, stranger), false, 'a login alone never proves a repo');
  } finally {
    globalThis.fetch = was;
  }
  // A repo on another account the installation doesn't cover: its own install link, never "Step 2 of 2".
  const third = 'someoneelse/thing';
  await sql()`UPDATE builder_profiles SET main_project_key = ${third} WHERE builder_id = ${b.id}`;
  const s = rule(show(await mcpCall(b.ctx, 'find', {})));
  assert.doesNotMatch(s, /Step 2 of 2|You're in/, s);
  assert.match(s, /Install the read-only EarnKit app on it too \(one click\): https:\/\/earnkit\.com\/github\/verify\?n=\S+\nDone\?$/);
});

test('tell submitted with no entry here records the application as applied (never an error); the draft note says the same', db, async () => {
  const p = await signedIn('s');
  const r = await mcpCall(p.ctx, 'tell', { submitted: { program_id: BASE_GRANTS_ID } });
  assert.equal(r.isError, false, r.text);
  const [{ title }] = await sql()<{ title: string }[]>`SELECT title FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  assert.equal(rule(show(r), 0), appliedLine(title));
  const [row] = await sql()<{ status: string }[]>`SELECT status FROM builder_program_status WHERE installation_id = ${p.id} AND program_id = ${BASE_GRANTS_ID}`;
  assert.equal(row?.status, 'applied');
  const { DRAFT_NOTE } = await import('./draft-application');
  assert.match(DRAFT_NOTE, /call tell with submitted: \{ program_id \}/);
});

test('an acceptance told: a short congrats, the outcome post with a checked proof, and the Highlight shows Accepted (never Applied)', db, async () => {
  const b = await ranked('o', 'Claude Code', { seen: { checkin_asked: new Date().toISOString() } });
  const [{ hosts, xs, title }] = await sql()<{ hosts: string[]; xs: string[]; title: string }[]>`SELECT proof_hosts AS hosts, x_handles AS xs, title FROM programs WHERE id = ${BASE_GRANTS_ID}`;
  await sql()`UPDATE programs SET proof_hosts = ${['docs.base.org/get-started/']}::text[] WHERE id = ${BASE_GRANTS_ID}`;
  try {
    const ctx = { ...(b.ctx as object), proofFetch: (async () => `<p>October recipients: Kit by @${b.username}.</p>`) as ProofFetch } as never as Ctx;
    await mcpCall(ctx, 'tell', { submitted: { program_id: BASE_GRANTS_ID } });
    const d = (await profileData(b.id, new Date())) as ProfileData;
    // v3.1 Highlights competence (2026-10-25): an application alone is never a Highlight.
    assert.ok(!(await highlights(b.id, d, new Date())).some((h) => h.title.includes(title)), 'applied: no row');
    // No proof link yet (v3.1 cold read): one line asks for the announcement it turns into a post.
    const none = await mcpCall(ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted' }] });
    assert.equal(rule(show(none)), `Congrats on the ${title}. Got the announcement link? I'll turn it into a post.`);
    const r = await mcpCall(ctx, 'tell', { program_status: [{ program_id: BASE_GRANTS_ID, status: 'accepted', proof_url: 'https://docs.base.org/get-started/grant-recipients-october' }] });
    const s = rule(show(r));
    // v4.0 Task 8 fix round 1 (ruling 3): the accepted nudge's approved line with the post's link.
    assert.match(s, new RegExp(`^You got into ${title.replace(/[.]/g, '\\.')}\\. Huge, well earned\\. Want to share it\\? https://earnkit\\.com/${b.username}/post/[a-z2-7]{10}$`));
    const d2 = (await profileData(b.id, new Date())) as ProfileData;
    const items = (await highlights(b.id, d2, new Date())).map((h) => h.title);
    assert.ok(items.includes(`Accepted into ${title}`), items.join(' | '));
    assert.ok(!items.includes(`Applied to ${title}`), items.join(' | '));
  } finally {
    await sql()`UPDATE programs SET proof_hosts = ${hosts}::text[], x_handles = ${xs}::text[] WHERE id = ${BASE_GRANTS_ID}`;
  }
});

/* ---- The coin (EARNKIT_RAISING on, a fake tokens.fun) ---- */

const ON = { EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'gtm-w2-key', RESEND_API_KEY: 'gtm-w2-resend' };
let n = 0;
type B = { ctx: Ctx; id: number; key: string; handle: string };
/** A ranked builder with a proven wallet (as v3-backing.test.ts): `name` the builder's own name for it, `private` repo. */
async function coinBuilder(tag: string, o: { name?: string; private?: boolean; programs?: string[]; connect?: boolean } = {}): Promise<B> {
  n++;
  const t = `ek_w2c_${tag}_${RUN}_${randomBytes(6).toString('hex')}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `wc${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `95${RUN}${n}${tag.length}`, username: handle, name: 'wc', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `wc${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const verdicts = (o.programs ?? []).map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null }));
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts }];
  const deploy = async (d: { projectId: number; name: string; symbol: string }) => {
    const url = `https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`;
    await sql()`UPDATE projects SET token_url = ${url}, token_status = 'launched', coin_launched_at = now(), token_name = ${d.name}, token_symbol = ${d.symbol},
      coin_address = ${`0x${randomBytes(20).toString('hex')}`} WHERE id = ${d.projectId}`;
    return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: url };
  };
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never,
    tokenDeps: {
      available: () => true, limit: async () => {}, check: async () => true, deploy,
      gate: { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }), appProven: async () => true, screen: async () => {} },
    },
  } as never as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: o.name ?? 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 8000 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key.toLowerCase()]: { id: gid, owner: handle, installation: gid + 1, private: o.private } }) });
  if (!o.connect) await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  if (!o.private) await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${(c.id + 2000).toString(16).padStart(40, '0')}`}, ${c.id}) ON CONFLICT DO NOTHING`;
  return { ctx, id: c.id, key, handle };
}
/** Last week's ship-log row of the one project, with code (approved unless `approved: false`). */
async function codeWeek(b: B, approved = true) {
  await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${b.id}, ${b.key}, ${lastFinishedMonday(new Date())},
      ${sql().json({ shipped_code: { n: 3 }, checked: true, ...(approved && { approved: true }) } as never)})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = EXCLUDED.facts`;
}

test('v4.0 Task 11: no backing offer after an approved week with code; the apply step comes (connect still first)', db, () => withEnv(ON, async () => {
  const b = await coinBuilder('r', { programs: [BASE_GRANTS_ID] });
  await codeWeek(b);
  const f = await mcpCall(b.ctx, 'find', {});
  const s = rule(show(f));
  assert.doesNotMatch(s, /I can launch|\bcoin|backing/i, s);
  assert.notEqual(moveUp(f)?.kind, 'backing');
}));

test('v4.0 Task 11: the connect yes (weeks approved: proven) carries no backing offer', db, () => withEnv(ON, async () => {
  const b = await coinBuilder('c', { connect: true });
  await codeWeek(b, false);
  const f = await mcpCall(b.ctx, 'find', {});
  assert.equal(moveUp(f)?.kind, 'connect', show(f));
  const y = await tellMove(b.ctx, 'connect', 'yes', b.key);
  const s = rule(show(y));
  assert.match(s, /^You're live: https:\/\/earnkit\.com\/\S+/, s);
  assert.doesNotMatch(s, /I can launch|\bcoin/i, s);
  assert.notEqual(moveUp(y)?.kind, 'backing');
}));

test('the email question is a move_up: a no is saved, never asked again', db, () => withEnv(ON, async () => {
  const b = await coinBuilder('e');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'connect_done' WHERE builder_id = ${b.id}`;
  await codeWeek(b, false);
  const f = await mcpCall(b.ctx, 'find', {});
  assert.equal(moveUp(f)?.kind, 'connect', show(f));
  // Backing declined first, so the connect yes ends in the email question.
  await sql()`INSERT INTO coin_moments (builder_id, project_key, moment, answer) VALUES (${b.id}, ${b.key}, 'first_week', 'no') ON CONFLICT DO NOTHING`;
  const y = await tellMove(b.ctx, 'connect', 'yes', b.key);
  assert.match(show(y), /Monday summary by email/);
  assert.deepEqual([moveUp(y)?.kind, moveUp(y)?.agent_note], ['weekly_email', EMAIL_ASK_NOTE]);
  assert.equal(show(await tellMove(b.ctx, 'weekly_email', 'no', b.key)), 'No weekly email.');
}));

test('final review: a news line keeps the check-in, ship cooldown and no-folder memory (takeNews)', db, async () => {
  const at = new Date().toISOString();
  const b = await ranked('n', 'OpenClaw', { seen: { checkin_asked: at, checkin: 'no', ship_asked: at, no_folder: true } });
  const { standBase, takeNews } = await import('./stand-view');
  const s = (await standBase(b.id))!;
  await takeNews(b.id, {}, s.base, new Date(), false);
  const [r] = await sql()<{ seen: Record<string, unknown> }[]>`SELECT standing_seen AS seen FROM builder_profiles WHERE builder_id = ${b.id}`;
  assert.deepEqual([r.seen.checkin_asked, r.seen.checkin, r.seen.ship_asked, r.seen.no_folder], [at, 'no', at, true]);
});

test('v3.1 reply format: the MCP route sends show_to_builder with a blank line between lines (Grok Bot markdown)', db, async () => {
  const p = await signedIn('f', 'Cursor');
  const r = await mcpCall(p.ctx, 'find', {}, { format: true });
  const s = String(r.reply?.show_to_builder);
  assert.match(s, /^You're in, @\S+\. Really glad you're here\.\n\n/);
  assert.doesNotMatch(s.replace(/\n\n/g, ''), /\n(?!\d+\. )/, 'no single newline outside a list');
});

test('v3.2: an unanswered check-in comes back a week later, at most 3 asks; an answer ends it', db, async () => {
  const now = new Date();
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  assert.equal(checkinAskDue({}, now), true);
  assert.equal(checkinAskDue({ checkin_asked: days(3) }, now), false, 'asked this week');
  assert.equal(checkinAskDue({ checkin_asked: days(8) }, now), true, 'asked once, a week ago, never answered');
  assert.equal(checkinAskDue({ checkin_asked: days(8), checkin_asks: CHECKIN_MAX_ASKS }, now), false);
  // The owner's case: asked once 8 days ago, no answer; the next quiet reply asks again.
  const b = await ranked('r', 'Cursor', { seen: { checkin_asked: days(8) } });
  const c1 = await mcpCall(b.ctx, 'find', { agent_can_build: false });
  assert.equal(moveUp(c1)?.kind, 'checkin');
  assert.equal((await seen(b.id)).checkin_asks, 2);
  // Asked again just now: not in the next reply.
  const c2 = await mcpCall(b.ctx, 'find', { agent_can_build: false });
  assert.notEqual(moveUp(c2)?.kind, 'checkin');
});
