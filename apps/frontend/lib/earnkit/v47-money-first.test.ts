import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { walletOffered } from './fixtures/wallet-step';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { closeDayOf } from './entry-text';
import { applyAsk, stateAsk, stripeDraftLine, stripeDraftNote, type BenchProject } from './bench-reply';
import { tokenOfferDue } from './wallet-offer';
import { APPLY_UNANSWERED_MAX } from './bench-find';
import { alertEvents } from './alert-mail';
import { upgradeToken, walletMessage, walletPost } from './wallet-proof';
import { retryDroppedBuilderTokens } from './builder-token';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v4.7 Task 3: the first reply is money only. A ranked builder with an open fit not applied to hears that fit's
 * amount, deadline and the one step first, and nothing else asks in front of it; the Stripe ask rides on a draft for
 * a program that wants revenue; the token is offered only after an application or a draft; a wallet proof launches
 * nothing; llms.txt says when the token is offered.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v47-money-first-secret';
// v4.7.3 T1: the Stripe link needs the Stripe box's own secret.
process.env.EARNKIT_STRIPE_SECRET ??= 'v47-money-first-stripe-secret-0123456789-abcdefghijklmnopqrstuvwxyz';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  delete process.env.EARNKIT_BUILDER_TOKENS;
  delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const kind = (r: R) => (r.reply?.move_up as { kind?: string } | undefined)?.kind;
const seen = async (id: number) =>
  (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;
let n = 0;

/** A copy of `from` (an open program), closing `days` from now (null: rolling), `wants_revenue` as given. */
async function program(tag: string, o: { from?: string; days?: number | null; wants?: boolean } = {}) {
  const base = committedProgram(o.from ?? 'base-builder-grants');
  const id = `v47-mf-${process.pid}-${tag}`;
  const ends = o.days === null || o.days === undefined ? null : new Date(Date.now() + o.days * DAY);
  const { wants_revenue: _w, ...rest } = base as Record<string, unknown>;
  const p = ProgramFile.parse({
    ...rest, id, title: `Money ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends?.toISOString() ?? null, status: 'active',
    ...(o.wants !== undefined && { wants_revenue: o.wants }),
  });
  await upsertProgram(p);
  return { id, title: p.title, when: ends ? closeDayOf({ summary: p.summary, ends_at: ends })! : null, reqs: p.submission_requirements };
}

/** A ranked builder (X, the repo proven by the App) the matcher fits for `programs`, with a verified site. */
async function builder(tag: string, programs: string[], o: { site?: boolean } = {}) {
  n++;
  const t = `ek_v47mf_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `mf${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `47${RUN}${n}${tag.length}`, username: handle, name: 'mf', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `mf${tag}${RUN}/kit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: programs.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 4700 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  // The connect weeks are another task's moment: answered, so they never take the step here.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  if (o.site !== false)
    await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proof, state, proposed_by)
      VALUES (${c.id}, 'site', 'https://kit.app', ${key}, 'earnkit_txt', 'verified', 'server')`;
  return { ctx, id: c.id, key, handle };
}
type B = Awaited<ReturnType<typeof builder>>;
const find = (b: B) => mcpCall(b.ctx, 'find', {});
/** Every answer filled, so prepare shows the ready draft. */
const answersFor = (reqs: { key: string; type: string; options?: string[] }[]) =>
  Object.fromEntries(reqs.map((r) => [r.key, r.type === 'url' ? 'https://kit.app/demo' : r.type === 'email' ? 'lee@kit.app' : r.options ? r.options[0] : 'Kit lets fans tip creators on Base.']));
const prepare = (b: B, p: { id: string; reqs: unknown }) =>
  mcpCall(b.ctx, 'prepare', { program_id: p.id, project: { name: 'Kit', repo_url: `https://github.com/${b.key}`, live_url: 'https://kit.app' }, answers: answersFor(p.reqs as never), coach_asked: true });

test('Review Focus 3: the first ranked find leads with the open fit\'s amount and deadline; its ask is apply; never a stripe kind', db, async () => {
  const p = await program('a', { days: 20 });
  const b = await builder('a', [p.id]);
  const r = await find(b);
  const s = show(r);
  // The money alone: the fit, its amount, its deadline and the one step (no standing or ship line in front of it).
  assert.ok(s.startsWith(`${p.title} closes ${p.when}, up to $5,000.`), s);
  assert.equal(s, applyAsk(p.title, '$5,000', p.when));
  assert.ok(['apply', 'qualify'].includes(kind(r)!), String(kind(r)));
  assert.doesNotMatch(s, /Ship code this week|Stripe|token|check-in/i);
  // Fix round 1 (R11): every ranked find while the fit is open and unapplied asks it (no post, moment, stripe, token,
  // check-in or ship ask in its place), up to APPLY_UNANSWERED_MAX showings (fix round 2: then it stands aside).
  for (let i = 1; i < APPLY_UNANSWERED_MAX; i++) {
    const again = await find(b);
    assert.equal(kind(again), 'apply', show(again));
    assert.equal(show(again), applyAsk(p.title, '$5,000', p.when));
    assert.doesNotMatch(JSON.stringify(again.reply), /"kind":"stripe"|connect\/stripe/);
  }
  assert.equal((await seen(b.id)).stripe_asked, undefined, 'find never claims the Stripe ask');
});

test('the quieter asks wait while an open fit is unapplied, and come back once it is told applied', db, async () => {
  const p = await program('w', { days: 20 });
  const b = await builder('w', [p.id]);
  assert.equal(kind(await find(b)), 'apply');
  await mcpCall(b.ctx, 'tell', { submitted: { program_id: p.id } });
  const after = await find(b);
  assert.notEqual(kind(after), 'apply', show(after));
  assert.doesNotMatch(show(after), /I can draft it/);
});

test('fix round 1: a draft prepare showed, or a yes to drafting, ends the re-ask for that program; it comes back after DECLINE_MS', db, async () => {
  const p = await program('d', { days: 20 });
  const b = await builder('d', [p.id]);
  assert.equal(kind(await find(b)), 'apply');
  // A direct prepare (no apply ask answered) that shows the draft.
  const prep = await prepare(b, p);
  assert.ok(prep.reply?.draft, show(prep));
  assert.equal(typeof ((await seen(b.id)).apply_yes as Record<string, string>)[p.id], 'string');
  const after = await find(b);
  assert.notEqual(kind(after), 'apply', show(after));
  assert.doesNotMatch(show(after), /I can draft it/);
  // 31 days later, still open and unapplied: asked again.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, ${['apply_yes', p.id]}::text[], to_jsonb(${new Date(Date.now() - 31 * DAY).toISOString()}::text))
    WHERE builder_id = ${b.id}`;
  assert.equal(kind(await find(b)), 'apply');
  // The yes to the apply ask records it too.
  const q = await program('e', { days: 20 });
  const c = await builder('e', [q.id]);
  assert.equal(kind(await find(c)), 'apply');
  await mcpCall(c.ctx, 'tell', { move_up: { kind: 'apply', project_key: c.key, answer: 'yes' } });
  const next = await find(c);
  assert.notEqual(kind(next), 'apply', show(next));
  assert.doesNotMatch(show(next), /I can draft it/);
});

test('fix round 2 (R12): three unanswered showings stand the apply ask aside for DECLINE_MS; then another ask shows; it comes back', db, async () => {
  assert.equal(APPLY_UNANSWERED_MAX, 3);
  const p = await program('u', { days: 20 });
  const b = await builder('u', [p.id]);
  for (let i = 0; i < 3; i++) assert.equal(kind(await find(b)), 'apply', `showing ${i + 1}`);
  const fourth = await find(b);
  assert.notEqual(kind(fourth), 'apply', show(fourth));
  assert.doesNotMatch(show(fourth), /I can draft it/);
  assert.ok(['ship', 'checkin', 'wallet', 'token', 'new_repo', 'titles', 'share', 'post', undefined].includes(kind(fourth)), `another ask resumes: ${kind(fourth)}`);
  const s = await seen(b.id);
  assert.equal(typeof (s.declined as Record<string, string>)[`apply:${p.id}`], 'string', 'set aside as a no would be');
  assert.equal(typeof (s.apply_silent as Record<string, string>)[p.id], 'string', 'marked as silence');
  assert.equal((s.apply_unanswered as Record<string, number>)[p.id], undefined, 'count cleared');
  // 31 days later: it comes back.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, ${['declined', `apply:${p.id}`]}::text[], to_jsonb(${new Date(Date.now() - 31 * DAY).toISOString()}::text))
    WHERE builder_id = ${b.id}`;
  assert.equal(kind(await find(b)), 'apply');
  // An answer (here a no) resets the count.
  const q = await program('v', { days: 20 });
  const c = await builder('v', [q.id]);
  await find(c);
  await find(c);
  assert.equal(((await seen(c.id)).apply_unanswered as Record<string, number>)[q.id], 2);
  await mcpCall(c.ctx, 'tell', { move_up: { kind: 'apply', project_key: c.key, answer: 'no' } });
  assert.equal(((await seen(c.id)).apply_unanswered as Record<string, number>)[q.id], undefined, 'answered: reset');
});

test('final review: the lead and the money line name the program the apply ask asks (the first fit drafted already)', db, async () => {
  const p1 = await program('l1', { days: 10 });
  const p2 = await program('l2', { days: 20 });
  const b = await builder('l', [p1.id, p2.id]);
  // A draft of the first fit in hand: money first asks the second.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{apply_yes}',
      jsonb_build_object(${p1.id}::text, ${new Date().toISOString()}::text)) WHERE builder_id = ${b.id}`;
  const r = await find(b);
  assert.equal(kind(r), 'apply', show(r));
  assert.equal(((await seen(b.id)).bench_ask as { program_id?: string }).program_id, p2.id);
  assert.equal((r.reply?.lead as { program_id?: string } | undefined)?.program_id, p2.id);
  assert.ok(show(r).startsWith(`${p2.title} closes ${p2.when}`), show(r));
});

test('final review R19: a fit set aside for silence still gets its closing alert; an explicit no drops it', db, async () => {
  const p = await program('s', { days: 2 });
  const b = await builder('s', [p.id]);
  for (let i = 0; i < APPLY_UNANSWERED_MAX; i++) assert.equal(kind(await find(b)), 'apply');
  await find(b);
  const s = await seen(b.id);
  assert.equal(typeof (s.apply_silent as Record<string, string>)[p.id], 'string', 'stood aside for silence');
  const closingFor = async () => (await alertEvents(b.id, new Date())).some((e) => e.kind === 'closing' && e.key.startsWith(`closing:${p.id}:`));
  assert.equal(await closingFor(), true);
  // An explicit no (a later no rewrites the declined time): no closing alert.
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, ${['declined', `apply:${p.id}`]}::text[], to_jsonb(${new Date(Date.now() + 1000).toISOString()}::text))
    WHERE builder_id = ${b.id}`;
  assert.equal(await closingFor(), false);
});

test('fix round 1 (R11): stateAsk puts the apply ask before an event post', () => {
  const project: BenchProject = { key: 'kit/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const apply = { program_id: 'p', title: 'Grant', amount: '$5,000', when: 'Nov 18' };
  const v = { state: 'ranked' as const, variant: null, project, link: null, handle: 'kit', apply, post: { kind: 'live' } as never };
  assert.equal(stateAsk(v).kind, 'apply');
  assert.equal(stateAsk({ ...v, apply: null }).kind, 'post');
});

test('stateAsk has no stripe kind: the ranked order goes apply, share, check-in, wallet, token, then the rest', () => {
  const project: BenchProject = { key: 'kit/kit', name: 'Kit', confirmed: true, live: false, weeks: 4 };
  const v = { state: 'ranked' as const, variant: null, project, link: null, handle: 'kit', stripe: 'https://earnkit.com/connect/stripe?t=x' } as never;
  assert.equal(stateAsk(v).kind, 'ship');
  const apply = { program_id: 'p', title: 'Grant', amount: '$5,000', when: 'Nov 18' };
  assert.equal(stateAsk({ ...(v as object), apply, checkin: true, tokenOffer: true, newRepo: true, titles: true } as never).kind, 'apply');
});

test('prepare for a wants_revenue program offers the Stripe line once; a second draft does not', db, async () => {
  const p = await program('s', { days: 20, wants: true });
  const b = await builder('s', [p.id]);
  const first = await prepare(b, p);
  const note = String(first.reply?.agent_note ?? '');
  const line = note.match(/Connect Stripe read-only so this draft can show verified revenue: (https:\/\/earnkit\.com\/connect\/stripe\?t=\S+?)"/);
  assert.ok(line, note);
  assert.ok(note.includes(stripeDraftNote(line![1])), note);
  assert.equal(stripeDraftLine('L'), 'Connect Stripe read-only so this draft can show verified revenue: L');
  assert.doesNotMatch(show(first), /Stripe/, 'a line in the note, never a second question in the reply');
  assert.equal(typeof (await seen(b.id)).stripe_asked, 'string', 'claimed with stripe_asked');
  const second = await prepare(b, p);
  assert.doesNotMatch(String(second.reply?.agent_note ?? ''), /Stripe/);
});

test('prepare for a program that does not want revenue never offers it; nor without a verified site', db, async () => {
  const p = await program('x', { days: 20, wants: false });
  const b = await builder('x', [p.id]);
  assert.doesNotMatch(String((await prepare(b, p)).reply?.agent_note ?? ''), /Stripe/);
  assert.equal((await seen(b.id)).stripe_asked, undefined);
  const q = await program('y', { days: 20, wants: true });
  const nosite = await builder('y', [q.id], { site: false });
  assert.doesNotMatch(String((await prepare(nosite, q)).reply?.agent_note ?? ''), /Stripe/);
  assert.equal((await seen(nosite.id)).stripe_asked, undefined);
});

test('the committed program files: wants_revenue on the programs whose application asks for revenue or traction', () => {
  for (const id of ['base-builder-grants', 'circle-developer-grants', 'colosseum-worlds-fair'])
    assert.equal((committedProgram(id) as { wants_revenue?: boolean }).wants_revenue, true, id);
  for (const id of ['a16z-speedrun', 'alliance-all19', 'arc-microgrants', 'arc-microgrants-studio', 'ethglobal-mumbai', 'monad-metropolis'])
    assert.equal((committedProgram(id) as { wants_revenue?: boolean }).wants_revenue, undefined, id);
  assert.equal(ProgramFile.safeParse({ ...committedProgram('base-builder-grants'), wants_revenue: 'yes' }).success, false);
});

test('tokenOfferDue is false with no application and true after one', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  try {
    const p = await program('t', { days: 20 });
    const b = await builder('t', [p.id]);
    await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${b.id}, now())`;
    assert.equal(await tokenOfferDue(b.id), false, 'no application or draft yet');
    await sql()`INSERT INTO builder_program_status (installation_id, program_id, login, status) VALUES (${b.id}, ${p.id}, '', 'applied')`;
    assert.equal(await tokenOfferDue(b.id), true, 'after one application');
    // Fix round 1 (R9): a draft in their hands (apply_yes) is the money step too.
    const d = await builder('t2', [p.id]);
    await sql()`INSERT INTO person_wallets (wallet, builder_id, recipient_at) VALUES (${`0x${randomBytes(20).toString('hex')}`}, ${d.id}, now())`;
    assert.equal(await tokenOfferDue(d.id), false);
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('apply_yes', jsonb_build_object(${p.id}::text, now()::text)) WHERE builder_id = ${d.id}`;
    assert.equal(await tokenOfferDue(d.id), true, 'after a draft-yes');
  } finally {
    delete process.env.EARNKIT_BUILDER_TOKENS;
  }
});

test('Review Focus 4: proving a wallet with token_offered set (v4.0\'s step 3) launches nothing, now or on the hourly retry', db, async () => {
  process.env.EARNKIT_BUILDER_TOKENS = 'on';
  process.env.TOKENSFUN_DEPLOY_API_KEY = 'v47-key';
  try {
    const p = await program('l', { days: 20 });
    const b = await builder('l', [p.id]);
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('token_offered', now()::text) WHERE builder_id = ${b.id}`;
    let launched = 0;
    const fetchFake = (async () => {
      launched++;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const t = upgradeToken(b.id, new Date())!;
    const acct = privateKeyToAccount(generatePrivateKey());
    const signature = await acct.signMessage({ message: walletMessage(b.handle, t) });
    const req = new Request('https://earnkit.com/claim/wallet', {
      method: 'POST', headers: { origin: 'https://earnkit.com', 'content-type': 'application/json' },
      body: JSON.stringify({ t, wallet: acct.address, signature }),
    });
    const res = await walletPost(req, {
      limit: async () => {}, discover: async () => {}, builderToken: { fetch: fetchFake, check: async () => true },
      verify: (a) => verifyMessage({ address: a.address as `0x${string}`, message: a.message, signature: a.signature as `0x${string}` }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await sql()`SELECT 1 FROM person_wallets WHERE builder_id = ${b.id}`).length, 1, 'the wallet is proven');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await retryDroppedBuilderTokens(new Date(), { fetch: fetchFake, check: async () => true, only: [b.id] })).tried, 0, 'no yes, no retry');
    assert.equal(launched, 0, 'the fake launcher is never called');
    assert.equal((await sql()`SELECT 1 FROM builder_tokens WHERE builder_id = ${b.id}`).length, 0);
  } finally {
    delete process.env.EARNKIT_BUILDER_TOKENS;
    delete process.env.TOKENSFUN_DEPLOY_API_KEY;
  }
});

test('llms.txt says the token is offered once they have applied or drafted an application, never on adding a wallet', () => {
  const txt = readFileSync(join(__dirname, 'llms', 'v213.txt'), 'utf8');
  assert.doesNotMatch(txt, /adds their wallet/);
  assert.ok(txt.includes("A builder token on tokens.fun, offered once they've applied or drafted an application (they can say no): 40% of its trading fees to the builder."));
});
