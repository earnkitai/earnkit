import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { withEnv } from './fixtures/find';
import { padPool } from './fixtures/rank-pool';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { lastFinishedMonday } from './weeks';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { pickRepoAgain } from './bench-reply';
import { EMAIL_ON, WHICH_EMAIL } from './digest';
import { APPROVED_LINE } from './weekly-moment';
import { AMOUNT_HEADER, upToCell } from './entry-text';
import { FIND_DESCRIPTION_BENCH, TOOL_DESCRIPTIONS } from './mcp';
import { ANSWER_FIRST_NOTE } from './stand-text';
import { aboutFacts, type ReplyFacts } from './reply-facts';
import { POINTS_PAGE_LINE } from './points';
import { CHECKIN_INSTEAD_NOTE } from './tools';

/**
 * v3.1 answerable replies (design doc v3.1-answerable-replies.md), through the real MCP tools/call path: find's and
 * score's facts per builder state (none of another builder's, none on a shared client without a signed-in builder),
 * the weekly email yes without an address, the shortened repeat connect pitch, and the
 * jargon lines. Every reply: at most one https link, one question at most, no em dash or emoji.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'answerable-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
type Ctx = Parameters<typeof mcpCall>[0];
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const facts = (r: R) => r.reply?.facts as ReplyFacts;
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const rule = (s: string, asks = 1) => {
  assert.ok(links(s).length <= 1, s);
  assert.equal(questions(s), asks, s);
  assert.doesNotMatch(s, /—|\p{Extended_Pictographic}|EARN points|Backing open/u, s);
  return s;
};
const ON = { EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'answerable-key', RESEND_API_KEY: 'answerable-resend' };

let nextX = 0;
/** A builder signed in with X at install (a page, no project yet), on agent `client`. */
async function signedIn(tag: string, client = 'Claude Code') {
  const t = `ek_ans_${tag}_${RUN}_${randomBytes(6).toString('hex')}`;
  await saveInstallation(t, undefined, false, client);
  const own = (await connectInstallation(t))!.own;
  const username = `an${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `93${RUN}${++nextX}`, username, name: 'Maya Ortiz', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }), readerDeps } as never as Ctx;
  return { id: c.id, own: c.own, ctx, username };
}

let n = 0;
type B = { ctx: Ctx; id: number; key: string; handle: string };
/** A ranked builder with a proven reward wallet and a fake coin deploy (as gtm-w2-replies.test.ts). */
async function coinBuilder(tag: string): Promise<B> {
  n++;
  const t = `ek_ansc_${tag}_${RUN}_${randomBytes(6).toString('hex')}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `ac${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `92${RUN}${n}${tag.length}`, username: handle, name: 'ac', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `ac${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const repoFacts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts: repoFacts, live_verified: true, verdicts: [] }];
  const deploy = async (d: { projectId: number; name: string; symbol: string }) => {
    const url = `https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`;
    await sql()`UPDATE projects SET token_url = ${url}, token_status = 'launched', coin_launched_at = now(), token_name = ${d.name}, token_symbol = ${d.symbol},
      coin_address = ${`0x${randomBytes(20).toString('hex')}`} WHERE id = ${d.projectId}`;
    return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: url };
  };
  const no = async () => { throw new Error('offline'); };
  const readerDeps = new Proxy({}, { get: (_t, k) => (k === 'now' ? new Date() : k === 'ghSpent' ? () => false : k === 'ghFetch' ? undefined : no) });
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never, readerDeps,
    tokenDeps: {
      available: () => true, limit: async () => {}, check: async () => true, deploy,
      gate: { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }), appProven: async () => true, screen: async () => {} },
    },
  } as never as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 7000 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key.toLowerCase()]: { id: gid, owner: handle, installation: gid + 1 } }) });
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${(c.id + 3000).toString(16).padStart(40, '0')}`}, ${c.id}) ON CONFLICT DO NOTHING`;
  await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, summary, facts) VALUES (${c.id}, ${key}, ${lastFinishedMonday(new Date())}, 'Added streak rewards in USDC.',
      ${sql().json({ shipped_code: { n: 3 }, checked: true, approved: true } as never)})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = EXCLUDED.facts, summary = EXCLUDED.summary`;
  return { ctx, id: c.id, key, handle };
}

test('copy: the jargon lines and the answer note', () => {
  assert.equal(APPROVED_LINE, 'Thanks. Last week is on your page.');
  assert.equal(EMAIL_ON, 'Done. Your summary comes every Monday.');
  assert.equal(WHICH_EMAIL, 'Which email should your Monday summary go to?');
  assert.equal(pickRepoAgain('https://x.test/l'), "Connect your app's code so I can match it (read-only, one click): https://x.test/l\nDone?");
  rule(pickRepoAgain('https://x.test/l'));
  // Money tables say "Up to" (grants and investments aren't prizes), the cell without its own "up to".
  assert.equal(AMOUNT_HEADER, 'Amount');
  assert.equal(upToCell('up to $5,000'), '$5,000');
  assert.equal(upToCell('500 USDC × 20 grants'), '500 USDC × 20 grants');
  // find points "what can I earn" at more: true; every description stays under 800 characters.
  assert.match(FIND_DESCRIPTION_BENCH, /more: true for what can I earn, what fits me, show programs\./);
  for (const [k, d] of Object.entries(TOOL_DESCRIPTIONS)) assert.ok((d as string).length < 800, `${k} ${(d as string).length}`);
  assert.match(ANSWER_FIRST_NOTE, /from show_to_builder and facts only; if that answer needs a link, use the one in facts/);
  // about: existing copy only; no deletion policy invented; v4.0 Task 11: no backers line (Backing is retired).
  const about = aboutFacts();
  assert.deepEqual(Object.keys(about), ['earnkit', 'ranking', 'points', 'builder_code', 'data']);
  assert.equal(about.data, 'You can hide your page anytime (say hide my page).');
  assert.equal(about.points, POINTS_PAGE_LINE);
  assert.match(about.builder_code, /^A Builder Code is a one-line tag Base uses to see your traffic\./);
  for (const s of Object.values(about)) assert.doesNotMatch(s, /—|EARN points|delete/i);
});

test('facts: a shared client without a signed-in builder gets about alone (find and score)', db, async () => {
  const t = `ek_ans_shared_${RUN}_${randomBytes(6).toString('hex')}`;
  await saveInstallation(t, undefined, true, 'Muse');
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: true, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Ctx;
  for (const tool of ['find', 'score'] as const) {
    const f = facts(await mcpCall(ctx, tool, {}));
    assert.deepEqual(Object.keys(f), ['about'], tool);
  }
});

test('facts: signed in, no repo: the page, points and what they are for, Earned and applications; no rank or wallet', db, () => withEnv(ON, async () => {
  const p = await signedIn('s');
  const r = await mcpCall(p.ctx, 'find', { agent_can_build: false });
  const f = facts(r);
  assert.deepEqual(f.page, { url: `https://earnkit.com/${p.username}`, public: true });
  assert.deepEqual(f.points, { total: 0, this_week: 0, what_for: POINTS_PAGE_LINE });
  assert.equal(f.rank, undefined);
  assert.equal(f.wallet, undefined);
  assert.equal('coin' in f, false);
  assert.deepEqual(f.earned, { usd: 0 });
  assert.deepEqual(f.applications, []);
  assert.ok(f.about.earnkit);
  assert.match(String(r.reply?.note), /from show_to_builder and facts only/);
  // A program guide (find program_id) carries the facts and the answer-first note too.
  const g = await mcpCall(p.ctx, 'find', { program_id: 'base-builder-grants' });
  assert.ok(facts(g)?.page, g.text);
  assert.match(String(g.reply?.note), /from show_to_builder and facts only/);
  // A hidden page says so; the told application shows with the builder's own status.
  await mcpCall(p.ctx, 'tell', { profile: 'hide' });
  await mcpCall(p.ctx, 'tell', { program_status: [{ program_id: 'base-builder-grants', status: 'applied' }] });
  const h = facts(await mcpCall(p.ctx, 'score', {}));
  assert.equal(h.page?.public, false);
  assert.deepEqual(h.applications, [{ program: 'Base Builder Grant Program', status: 'applied' }]);
}));

test('the connect pitch: in full once a day, then its link and question alone', db, async () => {
  const p = await signedIn('p');
  const first = rule(show(await mcpCall(p.ctx, 'find', {})));
  // v4.0 approved copy 2: the full pitch (the welcome reply: no money line; GitHub unknown: no Lovable or Bolt hint).
  assert.match(first, /\*\*Step 2 of 3:\*\* connect your app's code on GitHub so I can match you to the right programs\./);
  assert.doesNotMatch(first, /Lovable or Bolt/);
  for (const tool of ['find', 'score'] as const) {
    const again = rule(show(await mcpCall(p.ctx, tool, {})));
    assert.equal(again, pickRepoAgain(links(again)[0]!), tool);
  }
  // The next day: the full pitch again.
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || '{"pitch_day": "2020-01-01"}'::jsonb WHERE builder_id = ${p.id}`;
  const next = show(await mcpCall(p.ctx, 'find', {}));
  assert.match(next, /pays? up to \$/);
  assert.match(next, /\*\*Step 2 of 3:\*\*/);
});

test('weekly email yes without an address: asks which email unless one is on file; with one, done', db, () => withEnv(ON, async () => {
  const p = await signedIn('e');
  const r = await mcpCall(p.ctx, 'tell', { weekly_email: { answer: 'yes' } });
  assert.equal(rule(show(r)), WHICH_EMAIL);
  assert.match(String(r.reply?.agent_note), /which email to use/);
  assert.doesNotMatch(String(r.reply?.agent_note), /check in/);
  await mcpCall(p.ctx, 'tell', { weekly_email: { answer: 'yes', email: 'maya@example.com' } });
  // With an address on file, a plain yes ("remind me every Monday") is done: the address is already theirs.
  assert.equal(show(await mcpCall(p.ctx, 'tell', { weekly_email: { answer: 'yes' } })), EMAIL_ON);
  assert.equal(show(await mcpCall(p.ctx, 'tell', { weekly_email: { answer: 'yes', email: 'maya@example.com' } })), EMAIL_ON);
  // A client that can schedule, check-in never answered: the note may offer the check-in instead (one question).
  const g = await signedIn('g', 'Grok');
  const gr = await mcpCall(g.ctx, 'tell', { weekly_email: { answer: 'yes' } });
  assert.ok(String(gr.reply?.agent_note).includes(CHECKIN_INSTEAD_NOTE));
  await mcpCall(g.ctx, 'tell', { move_up: { kind: 'checkin', project_key: null, answer: 'no' } });
  assert.ok(!String((await mcpCall(g.ctx, 'tell', { weekly_email: { answer: 'yes' } })).reply?.agent_note).includes(CHECKIN_INSTEAD_NOTE));
}));

test('a ranked builder: facts carry rank, streak, wallet and last week (v4.0 Task 11: never a project coin)', db, () => withEnv(ON, async () => {
  await padPool(12, 5);
  const b = await coinBuilder('k');
  // score's facts: everything the builder's own questions need, nothing of another builder's.
  const f = facts(await mcpCall(b.ctx, 'score', {}));
  assert.deepEqual(f.page, { url: `https://earnkit.com/${b.handle}`, public: true });
  assert.ok(f.rank && /^#\d+ of \d+ builders$|^Top \d+% of builders$/.test(f.rank.line), JSON.stringify(f.rank));
  assert.equal(typeof f.rank?.score, 'number');
  assert.equal(typeof f.streak, 'number');
  assert.match(f.wallet ?? '', /^0x[0-9a-f]{4}…[0-9a-f]{4}$/);
  assert.equal('coin' in f, false);
  assert.equal(f.shipped_last_week?.week, lastFinishedMonday(new Date()));
  assert.equal(f.shipped_last_week?.summary, 'Added streak rewards in USDC.');
  const json = JSON.stringify(f);
  for (const other of ['pad', 'an', 'acs'].map((x) => `"${x}`)) assert.ok(!json.includes(`earnkit.com/${other}`), json);
  process.stdout.write(`# facts example: ${json}\n`);
}));

test('"Your entries" says what the builder last told: accepted after applied, never "applied" again', async () => {
  const { entryStatusWord } = await import('./present');
  assert.deepEqual(['applied', 'accepted', 'funded', 'won', 'rejected', undefined].map(entryStatusWord), ['applied', 'accepted', 'funded', 'won', 'not selected', 'applied']);
});
