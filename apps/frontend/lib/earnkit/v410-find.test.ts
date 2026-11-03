import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
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
import { getProgramRow, upsertProgram } from './programs';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import { isoWeekOf } from './weeks';
import { saveBank } from './answer-bank';
import { BUILDER_CODES_SUFFIX } from './builder-code';
import { HELP_DONE_ASK, MENTOR_NOTE, SESSION_MS } from './conversation';
import { ALSO_LEAD_NOTE, PUSHED_ASK, READY_CODES_NOT_YET, READY_SET, UPDATING_NOTE, UPDATING_SAID, codesSettled } from './bench-find';
import { READY_ASK, READY_NOTE, READY_YES_NOTE } from './ready-copy';
import { converse, gateFailures } from './fixtures/converse';
import { startRefresh } from './stand-view';

/*
 * v4.10 Task 4 (R1, R4, R8): the ready set in find and its answers, through the real tools on the owner's shape (Base
 * one Builder Codes step away, an a16z speedrun copy closing in 19 hours, Circle a long shot).
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v410-find-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const BAD = /—|\bcoins?\b|\bpoints?\b|\p{Extended_Pictographic}/iu;
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const noteOf = (r: R) => String(r.reply?.agent_note ?? r.reply?.note ?? '');
const moveUp = (r: R) => r.reply?.move_up as { kind: string; project_key: string | null; agent_note: string } | undefined;
const seenOf = async (id: number) =>
  (await sql()<{ s: Record<string, unknown> }[]>`SELECT standing_seen AS s FROM builder_profiles WHERE builder_id = ${id}`)[0].s;
const readyOf = async (id: number) => (await seenOf(id)).ready as { ids: string[]; skipped: string[]; opened: string[]; waiting: string[] } | undefined;

async function only(ids: string[]) {
  await sql()`UPDATE programs SET status = 'closed' WHERE NOT (id = ANY(${ids}::text[]))`;
  await sql()`UPDATE programs SET status = 'active' WHERE id = ANY(${ids}::text[])`;
}
/** A program file copy with this run's id (dropped after), `hours` to its close (null: rolling). */
async function copy(from: string, tag: string, o: { hours?: number | null; extra?: Record<string, unknown> } = {}) {
  const file = committedProgram(from);
  const id = `v410-${process.pid}-${tag}`;
  const ends = o.hours == null ? null : new Date(Date.now() + o.hours * 3_600_000).toISOString();
  const p = ProgramFile.parse({ ...file, id, ends_at: ends, status: 'active', starts_at: null, ...o.extra });
  await upsertProgram(p);
  return p;
}
/**
 * The owner's three: a16z speedrun closing in 19 hours, Circle a long shot (tag; final fix I2: `tagged: false`, its real
 * file, a long shot only for being on Arc), Base's grant; nothing else open. v4.10.1 Task 1: `drafted`, Circle's form
 * only the field the agent drafts (DRAFTED), for a walk about the other two. v4.10.2 Task 2 (R3): the copy is a soft chain
 * long shot (chain_required off), so these walks keep their three; `required`, the committed file's flag (Circle is then
 * not eligible for a project not on Arc).
 */
async function ownerPrograms(o: { tagged?: boolean; drafted?: boolean; required?: boolean } = {}) {
  // v4.10.2 Task 1: with `drafted` and an owner who `fits`, all three are in the set (Base's 4 answers are its one ask).
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const sr = await copy('a16z-speedrun', 'a16z', { hours: 19.5 });
  const extra = { ...(o.tagged !== false && { tag: 'long shot' }), ...(o.drafted && { submission_requirements: DRAFTED }), ...(!o.required && { chain_required: false }) };
  const circle = await copy('circle-developer-grants', 'circle', { extra });
  await only([sr.id, circle.id, 'base-builder-grants']);
  return { sr, circle };
}

let n = 0;
/**
 * The owner-like builder (v48-conversation.test.ts owner): X name "Jenil T", EarnKit's repo proven by the App, live and
 * on Base, six weeks shipping, setup step 3 done; a fresh session (the setup find's said moved back). `bank`: the
 * founding team, a demo, usage numbers and money raised held (v4.10.1 Task 1: Base still owes its contact details,
 * revenue, main challenge and credits, and a16z the email). `contact`: the name, email and Telegram banked too.
 * Fix round 1: its contract on Base is an owned one (contractsOf), so Base's contract address is held; `contract:
 * false` leaves none. v4.10.2 Task 1: `code`, a Base Builder Code the builder named (builder_code_claims, so held);
 * `fits` is `contact` and `code`: Base then owes only its 4 own answers (revenue, the 3-month plan, the main challenge
 * and the credits), so it fits the set's one reply.
 */
async function owner(tag: string, o: { bank?: boolean | 'team'; contact?: boolean; code?: boolean; fits?: boolean; contract?: boolean; client?: string; hosted?: boolean } = {}) {
  n++;
  const t = `ek_v410_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, o.client ?? 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `jr${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `410${RUN}${n}${tag.length}`, username: handle, name: 'Jenil T', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `jr${tag}${RUN}/earnkit`;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'earnkit', url: `https://github.com/${key}`, homepage: 'https://earnkit.com', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'earnkit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts: [] }];
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'EarnKit', repo: `https://github.com/${key}`, live_url: 'https://earnkit.com' } } });
  const gid = 41000 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  const weeks = Array.from({ length: 6 }, (_, k) => isoWeekOf(new Date(Date.now() - k * 7 * 86_400_000)));
  await sql()`UPDATE builder_projects SET commit_weeks = ${weeks}::text[], shipped = true, kind = 'app' WHERE builder_id = ${c.id} AND lower(project_key) = lower(${key})`;
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  // Final fix (M8): an agent with no folder of the code (agent-reach.ts hosted).
  if (o.hosted) await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || '{"no_folder": true}'::jsonb WHERE builder_id = ${c.id}`;
  if (o.bank !== false) {
    const base = (await getProgramRow('base-builder-grants'))!;
    // Fix 1 (H1): money raised too (kind 'raised'), so a16z's founder brief is ready ("team" alone: only the team).
    const raised = { key: 'money_raised', label: "Any money you've raised", type: 'text', required: true, from: 'builder', kind: 'raised' } as (typeof base.submission_requirements)[number];
    await saveBank(c.id, `github.com/${key}`.toLowerCase(), 'base-builder-grants', [...base.submission_requirements, raised], {
      founding_team: 'Jenil, solo founder', demo_loom: 'https://loom.com/share/earnkit', usage_numbers: '120 transactions',
      ...(o.bank !== 'team' && { money_raised: 'Nothing raised yet' }),
    });
  }
  if (o.contract !== false) {
    const hex = (k: number) => `0x${(BigInt(c.id) * 1000n + BigInt(k)).toString(16).padStart(40, '0')}`;
    await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${hex(900)}, ${c.id}) ON CONFLICT DO NOTHING`;
    await sql()`INSERT INTO wallet_contracts (chain, address, wallet, created_at, counts) VALUES ('base', ${hex(901)}, ${hex(900)}, now() - interval '30 days', true) ON CONFLICT DO NOTHING`;
  }
  if (o.code || o.fits) await sql()`INSERT INTO builder_code_claims (code, builder_id, told) SELECT 'jenil_code', COALESCE(builder_id, id), true FROM installations WHERE id = ${c.id} ON CONFLICT DO NOTHING`;
  if (o.contact || o.fits) {
    const base = (await getProgramRow('base-builder-grants'))!;
    await saveBank(c.id, `github.com/${key}`.toLowerCase(), 'base-builder-grants', base.submission_requirements, { full_name: 'Jenil Thakker', email: 'jenil@example.com', telegram: '@jenilt' });
  }
  await newSession(c.id);
  return { ctx, id: c.id, key, gh, handle };
}
/** Two hours of quiet: the next call is a new session. */
async function newSession(id: number) {
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{said}', jsonb_build_object('at', ${new Date(Date.now() - SESSION_MS - 60_000).toISOString()}::text, 'keys', '[]'::jsonb)) WHERE builder_id = ${id}`;
}
type B = Awaited<ReturnType<typeof owner>>;
const find = (b: B, args: Record<string, unknown> = {}) => mcpCall(b.ctx as never, 'find', args);
const tell = (b: B, move_up: Record<string, unknown>) => mcpCall(b.ctx as never, 'tell', { move_up });
const pushCodes = (b: B) => {
  b.gh.repos[b.key].files = { 'src/codes.ts': `export const SUFFIX = '0x046d617961000a${BUILDER_CODES_SUFFIX}'; Attribution.toDataSuffix({ codes: ['bc_earnkit'] });` };
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
};
/**
 * v4.10.1 Task 1: what the owner's set may owe once the bank holds the team, demo, usage and money raised: the contact
 * details (one item, by slot), Base's revenue, main challenge and credits (v4.10.2 Task 1: and its 3-month plan, one
 * line), and Circle's integrations, roadmap and milestones (each its own key). A walk answers the set's on its yes (only
 * the asked kinds are taken), so Base waits on its Builder Codes only.
 */
const OWED = {
  contact: { name: 'Jenil Thakker', email: 'jenil@example.com', telegram: '@jenilt' },
  'other:revenue': 'No revenue yet', 'other:gtm_plan': 'Grow installs through builder posts on X', 'other:primary_challenge': 'User acquisition', 'other:credits': 'Privy and AWS',
  'other:integrations': 'None yet; it settles in USDC on Base', 'other:roadmap': 'Q1: payouts on Arc', 'other:milestones': 'Milestone 1: Arc payouts live',
};
const yesAll = (b: B, m: Record<string, unknown> = {}) => tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: OWED, ...m });
/** v4.10.1 Task 1: a grant form's one field the agent drafts (Circle's business details), for copies with their own fields. */
const DRAFTED = committedProgram('circle-developer-grants').submission_requirements.filter((r: { key: string }) => r.key === 'business');
/**
 * v4.10.2 Task 1 (R1): the owner's set with the team, demo, usage and money raised banked. Base owes 8 answers (its
 * contact details, revenue, the 3-month plan, its Builder Code, the main challenge and the credits), more than one reply
 * holds, so it is said apart ("Also open"); a16z's email and Circle's 3 make the set's 4.
 */
const OPENER = (handle: string) => new RegExp([
  "^Jenil, I've started 2 applications for you, a \\$1M accelerator and a \\$100K long shot\\. I need 4 answers from you first:",
  '',
  '1\\. a16z speedrun SR008: up to \\$1M, an accelerator, closes in (19|20) hours\\. Needs your email first\\.',
  "2\\. Circle Developer Grants: \\$5K to \\$100K\\. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first, and Circle looks for apps on Arc, so it's a long shot\\.",
  '',
  'Also open: Base Builder Grant, up to \\$5,000, needs 8 answers from you\\. Say "start Base" anytime\\.',
  '',
  `Every other answer is filled from your commits and your profile at earnkit\\.com/${handle}\\.`,
  // The route sets the one easy reply apart (fixtures/mcp-call.ts format).
  '',
  READY_ASK.replace(/[.?']/g, (c) => (c === "'" ? c : `\\${c}`)),
].join('\\n') + '$');

test('the first find opens with the set (section A), every program drafted for the agent; a second find gives the status', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('op');
  const replies = await converse(b.ctx as never, [{ find: {} }, { find: {} }], { builderId: b.id });
  const [first, again] = replies;
  assert.match(first.show, OPENER(b.handle), first.show);
  assert.doesNotMatch(first.show, BAD);
  assert.equal(first.reply?.note, `If they asked a question, answer it first in one short line from the facts. ${READY_NOTE} ${MENTOR_NOTE}`);
  assert.equal(moveUp({ reply: first.reply } as R)?.kind, 'ready');
  const ready = first.reply?.ready as { programs: { id: string; link: string; requirements: { key: string }[]; prefilled: Record<string, string>; record?: unknown }[]; record: string[] };
  const programs = ready.programs;
  assert.deepEqual(programs.map((p) => p.id), [sr.id, circle.id]);
  // Final fix (M4): the record is sent once, never a copy per program.
  assert.ok(Array.isArray(ready.record) && ready.record.length > 0);
  for (const p of programs) {
    assert.ok(p.requirements.length > 0, p.id);
    assert.equal(p.record, undefined, p.id);
    assert.equal(typeof p.prefilled, 'object');
  }
  // What EarnKit holds is pre-filled: the banked team (a16z's founder brief).
  assert.equal(programs[0].prefilled.founding_team, 'Jenil, solo founder');
  assert.equal(programs[1].link, 'https://circle.questbook.app/');
  // v4.10.2 Task 1 (R1): only the set's asks, at most 4; Base, left out, is named with its count (ready.also_open).
  const asks = (ready.programs as unknown as { asks: { kind: string; key: string; slot?: string }[] }[]).map((p) => p.asks.map((a) => a.slot ? `${a.kind}.${a.slot}` : a.kind));
  assert.deepEqual(asks, [['contact.email'], ['other:integrations', 'other:roadmap', 'other:milestones']]);
  assert.ok(asks.flat().length <= 4);
  assert.deepEqual((first.reply?.ready as { also_open: unknown }).also_open, [{ id: 'base-builder-grants', title: 'Base Builder Grant Program', amount: 'up to $5,000', answers: 8 }]);
  assert.doesNotMatch(first.show, /\bready\b/i, first.show);
  assert.doesNotMatch(first.show, /After that/, first.show);
  const seen = await seenOf(b.id);
  assert.equal((seen.bench_ask as { kind: string }).kind, 'ready');
  assert.deepEqual((await readyOf(b.id))?.ids, [sr.id, circle.id]);
  // Nothing is drafted before the yes (declined and drafted exclusions stay right).
  assert.equal(seen.apply_yes, undefined);
  // R1: never the opener again in the session. v4.10.1 Task 2 (5): each program by name, with its money, its hours left
  // under 48 and what it still needs; never "still ready" while the set needs anything.
  assert.match(again.show, new RegExp([
    "^Here's where your 2 applications stand:",
    '',
    '- a16z: up to \\$1M, an accelerator, closes in (19|20) hours\\. Needs your email first\\.',
    '- Circle: \\$5K to \\$100K\\. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first\\.',
    '',
    "Reply yes and I'll finish them\\.$",
  ].join('\\n')), again.show);
  assert.doesNotMatch(again.show, /still ready/);
  assert.equal(moveUp({ reply: again.reply } as R)?.kind, 'ready');
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), []);
});

test('v4.10.2 (R1): the owner\'s set with a soft-chain Circle: Base needs 11 answers, so it is said apart; the set is Circle\'s 3', db, async () => {
  const { circle } = await ownerPrograms();
  await only([circle.id, 'base-builder-grants']);
  // Builder 17 on 2026-11-02: nothing banked, no owned Base contract, no Builder Code, an opted-in email.
  const b = await owner('own', { bank: false, contract: false });
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email, asked_at, opted_in_at) VALUES (${b.id}, '', 'jenil@example.com', now(), now())
    ON CONFLICT (installation_id, login) DO UPDATE SET email = EXCLUDED.email, opted_in_at = now(), unsubscribed_at = NULL`;
  const replies = await converse(b.ctx as never, [{ find: {} }, { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'yes' } }, says: 'yes' }], { builderId: b.id });
  const [opener, yes] = replies;
  assert.equal(opener.show, [
    "Jenil, I've started 1 application for you, a $100K long shot. I need 3 answers from you first:",
    '',
    "1. Circle Developer Grants: $5K to $100K. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first, and Circle looks for apps on Arc, so it's a long shot.",
    '',
    'Also open: Base Builder Grant, up to $5,000, needs 11 answers from you. Say "start Base" anytime.',
    '',
    `Every other answer is filled from your commits and your profile at earnkit.com/${b.handle}.`,
    '',
    READY_ASK,
  ].join('\n'));
  const ready = opener.reply?.ready as { programs: { id: string; asks: unknown[] }[]; also_open: { id: string; answers: number }[] };
  assert.deepEqual(ready.programs.map((p) => [p.id, p.asks.length]), [[circle.id, 3]]);
  assert.deepEqual(ready.also_open.map((p) => [p.id, p.answers]), [['base-builder-grants', 11]]);
  // The yes asks the set's 3, never Base's, and no "After that".
  assert.equal(yes.show, "Circle needs your Circle and Arc integrations, product roadmap and proposed grant milestones first. Reply with them and I'll finish it.");
  assert.deepEqual(((yes.reply?.ready as { need?: { asks: { kind: string }[] } }).need?.asks ?? []).map((a) => a.kind), ['other:integrations', 'other:roadmap', 'other:milestones']);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

test('v4.10.2 (R1): a top program needing 5 answers goes to "also open" and the next, needing 2, is the set; a bank answer lowers the count', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const big = await grant('five', 'Five Grants', [field('founding_team', 'team'), field('pitch_video', 'demo_video', 'url'), field('usage_numbers', 'traction'), field('team_location', 'other', 'text', 'team location'), field('requested_amount_usd', 'other', 'text', 'requested amount')], 30);
  const small = await grant('two', 'Two Grants', [field('founding_team', 'team'), field('team_location', 'other', 'text', 'team location')], 60);
  await only([big.id, small.id]);
  const b = await owner('r1', { bank: false });
  const opener = await find(b);
  assert.match(show(opener), /^Jenil, I've started 1 application for you, worth up to \$100K\. I need 2 answers from you first:\n\n1\. Two Grants: \$5K to \$100K\. Needs your team list and team location first\.\n\nAlso open: Five Grants, \$5K to \$100K, needs 5 answers from you\. Say "start Five" anytime\.\n\n/, show(opener));
  assert.deepEqual((opener.reply?.ready as { programs: { id: string }[] }).programs.map((p) => p.id), [small.id]);
  // The opener's one easy reply stays last: the "also open" line asks nothing.
  assert.doesNotMatch(show(opener).split('\n\n').slice(0, -1).join('\n'), /\?/);
  // Banked in an earlier session (the team list, demo and usage): the big one needs 2, so it fits, and the small one's
  // team location is one of those 2 (an answer two programs ask is counted once).
  const later = await owner('r1b', { bank: 'team' });
  const r = await find(later);
  assert.deepEqual((r.reply?.ready as { programs: { id: string }[] }).programs.map((p) => p.id), [big.id, small.id]);
  assert.match(show(r), /^Jenil, I've started 2 applications for you, worth up to \$200K\. I need 2 answers from you first:\n/, show(r));
  assert.doesNotMatch(show(r), /Also open/, show(r));
});

test('v4.10.2 (R2, owner answer 2): the Builder Code is asked and kept as theirs; the 3-month plan is one line the agent expands', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const base = committedProgram('base-builder-grants');
  const keep = ['project_name_description', 'live_product_url', 'gtm_plan', 'builder_code'];
  const fields = Object.fromEntries(Object.entries(base.form.fields as Record<string, string>).filter(([k]) => keep.includes(k)));
  const p = await copy('base-builder-grants', 'code', { extra: { submission_requirements: base.submission_requirements.filter((r: { key: string }) => keep.includes(r.key)), form: { ...base.form, fields } } });
  await only([p.id]);
  const b = await owner('bc', { bank: false });
  const opener = await find(b);
  assert.match(show(opener), /\n1\. Base Builder Grant: up to \$5,000\. Needs your 3-month plan in one line and Base Builder Code \(from base\.dev\) first\.\n/, show(opener));
  const asks = (opener.reply?.ready as { programs: { asks: { kind: string; one_line?: boolean }[] }[] }).programs[0].asks;
  assert.deepEqual(asks.map((a) => [a.kind, a.one_line ?? false]), [['other:gtm_plan', true], ['other:builder_code', false]]);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(show(yes), "Base needs your 3-month plan in one line and Base Builder Code (from base.dev) first. Reply with both and I'll finish it.");
  assert.deepEqual((yes.reply?.ready as { need: { asks: { kind: string; one_line?: boolean }[] } }).need.asks.map((a) => [a.kind, a.one_line ?? false]), [['other:gtm_plan', true], ['other:builder_code', false]]);
  const done = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { 'other:builder_code': 'jenil_code', 'other:gtm_plan': 'Grow installs through builder posts on X' } });
  const open = (done.reply?.ready as { open: { id: string; prefilled: Record<string, string>; expand?: string[] }[] }).open;
  assert.deepEqual(open.map((x) => [x.id, x.prefilled.builder_code, x.prefilled.gtm_plan, x.expand]), [[p.id, 'jenil_code', 'Grow installs through builder posts on X', ['gtm_plan']]]);
  assert.match(noteOf(done), /one_line \(its expand list\) is the builder's one line: write the form's full answer from that line and the record only, adding no facts/, noteOf(done));
  // Kept as theirs (tell builder_code's claim): a later set holds it, never asks it again.
  const [claim] = await sql()<{ code: string }[]>`SELECT code FROM builder_code_claims WHERE builder_id = (SELECT COALESCE(builder_id, id) FROM installations WHERE id = ${b.id})`;
  assert.equal(claim?.code, 'jenil_code');
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'sent' });
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'ready' - 'apply_yes' - 'bench_ask' WHERE builder_id = ${b.id}`;
  await sql()`DELETE FROM builder_program_status WHERE installation_id = ${b.id}`;
  await newSession(b.id);
  const next = await find(b);
  const again = (next.reply?.ready as { programs: { prefilled: Record<string, string>; asks: { kind: string }[] }[] }).programs[0];
  assert.equal(again.prefilled.builder_code, 'jenil_code');
  assert.deepEqual(again.asks.map((a) => a.kind), ['other:gtm_plan']);
  // EarnKit's own code is never offered as theirs.
  const own = await owner('bce', { bank: false });
  await sql()`INSERT INTO builder_code_claims (code, builder_id, told) SELECT 'earnkit', COALESCE(builder_id, id), true FROM installations WHERE id = ${own.id}`;
  const r = await find(own);
  assert.ok((r.reply?.ready as { programs: { asks: { kind: string }[] }[] }).programs[0].asks.some((a) => a.kind === 'other:builder_code'), show(r));
});

test('yes: Base runs the gap stage, a16z and Circle open now (ready.open, the yes note); find opens Base once its code is in; "sent" tracks all three', db, async () => {
  const { sr, circle } = await ownerPrograms({ drafted: true });
  const b = await owner('ys', { fits: true });
  await find(b);
  // v4.10.1 Task 1: the builder gives what the set owes with the yes, so only Base's codes wait.
  const yes = await yesAll(b);
  // Final fix (M2): the adding line names what the codes open.
  assert.equal(show(yes), [
    "Adding Builder Codes now, then I'll open Base.",
    '',
    '2 of 3 are open with every answer in place:',
    '- a16z: https://speedrun.a16z.com/apply',
    '- Circle: https://circle.questbook.app/',
    '',
    PUSHED_ASK,
  ].join('\n'));
  const opened = (yes.reply?.ready as { open: { id: string; title: string; link: string; prefilled: Record<string, string> }[] }).open;
  assert.deepEqual(opened.map(({ id, title, link }) => ({ id, title, link })), [{ id: sr.id, title: sr.title, link: 'https://speedrun.a16z.com/apply' }, { id: circle.id, title: circle.title, link: 'https://circle.questbook.app/' }]);
  // v4.10.2 Task 1 (R8): each page carries what EarnKit holds for it, so prepare gets every answer.
  assert.equal(opened[0].prefilled.email, 'jenil@example.com');
  assert.ok(noteOf(yes).startsWith(`${READY_YES_NOTE} `), noteOf(yes));
  assert.match(noteOf(yes), /commit and push it .* and call find/);
  // The ok is the gap stage's re-check ask.
  assert.equal(moveUp(yes)?.kind, 'qualify');
  const seen = await seenOf(b.id);
  assert.deepEqual(Object.keys(seen.apply_yes as object).sort(), ['base-builder-grants', sr.id, circle.id].sort());
  assert.deepEqual((await readyOf(b.id))?.waiting, ['base-builder-grants']);
  assert.ok((seen.gap_did as Record<string, string>)['base-builder-grants']);
  // Pushed: the ok runs find, which re-checks and opens Base's page.
  pushCodes(b);
  const ok = await tell(b, { kind: 'qualify', project_key: b.key, answer: 'yes' });
  assert.equal(show(ok), [
    'All three are open with every answer in place:',
    '- a16z: https://speedrun.a16z.com/apply',
    '- Circle: https://circle.questbook.app/',
    '- Base: https://forms.gle/urqjBJYJjR6Vqqre6',
    '',
    'Reply "sent" once they\'re in, and I\'ll track them for you.',
  ].join('\n'), show(ok));
  assert.deepEqual((ok.reply?.ready as { open: { id: string }[] }).open.map((p) => p.id), ['base-builder-grants']);
  assert.equal(moveUp(ok)?.kind, 'ready');
  assert.deepEqual((await readyOf(b.id))?.waiting, []);
  // A plain yes is never "sent".
  assert.equal(show(await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' })), 'Reply "sent" once they\'re in, and I\'ll track them for you.');
  const sent = await tell(b, { kind: 'ready', project_key: b.key, answer: 'sent' });
  assert.match(show(sent), /^Nice, I'm tracking them\./, show(sent));
  const applied = await sql()<{ program_id: string }[]>`SELECT program_id FROM builder_program_status WHERE installation_id = ${b.id} AND status = 'applied' ORDER BY program_id`;
  assert.deepEqual(applied.map((x) => x.program_id), ['base-builder-grants', sr.id, circle.id].sort());
  assert.doesNotMatch(show(sent), BAD);
});

test('the gate passes the whole yes walk: opener, yes, ok after the push, sent', db, async () => {
  await ownerPrograms({ drafted: true });
  const b = await owner('gw', { fits: true });
  const replies = await converse(b.ctx as never, [
    { find: {} },
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'yes', answers: OWED } }, says: 'yes, Jenil Thakker, jenil@example.com, @jenilt, no revenue yet, user acquisition, Privy and AWS, none yet, payouts on Arc in Q1' },
    { tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } }, says: 'ok', before: () => pushCodes(b) },
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'sent' } }, says: 'sent' },
  ], { builderId: b.id });
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

test('skip 3 parks Circle and is a yes on the rest; 1, 2, 3 is a no; 4 is ignored', db, async () => {
  const { sr, circle } = await ownerPrograms({ drafted: true });
  const b = await owner('sk', { fits: true });
  await find(b);
  const r = await yesAll(b, { answer: 'skip', skip: [3] });
  assert.equal(show(r).split('\n\n').slice(0, 2).join('\n\n'), "Done, Circle is skipped. I'll finish Base and a16z now.\n\nAdding Builder Codes now, then I'll open Base.");
  assert.ok(show(r).endsWith(PUSHED_ASK), show(r));
  const seen = await seenOf(b.id);
  assert.ok((seen.declined as Record<string, string>)[`apply:${circle.id}`]);
  assert.ok((seen.declined as Record<string, string>)[`path:${circle.id}`]);
  assert.deepEqual(Object.keys(seen.apply_yes as object).sort(), ['base-builder-grants', sr.id].sort());
  assert.deepEqual((r.reply?.ready as { open: { id: string }[] }).open.map((p) => p.id), [sr.id]);

  const all = await owner('sa', { fits: true });
  await find(all);
  const no = await tell(all, { kind: 'ready', project_key: all.key, answer: 'skip', skip: [1, 2, 3] });
  assert.match(show(no), /^No problem, I'll set Base, a16z and Circle aside\./, show(no));
  assert.equal((await seenOf(all.id)).apply_yes, undefined);

  const out = await owner('s4', { fits: true });
  await find(out);
  const four = await yesAll(out, { answer: 'skip', skip: [4] });
  assert.match(show(four), /^Adding Builder Codes now, then I'll open Base\./, show(four));
  assert.deepEqual(Object.keys(((await seenOf(out.id)).declined as object | undefined) ?? {}), []);
});

test('no parks all three for 30 days; the next session never opens the same set', db, async () => {
  const { sr, circle } = await ownerPrograms({ drafted: true });
  const b = await owner('no', { fits: true });
  await find(b);
  const no = await tell(b, { kind: 'ready', project_key: b.key, answer: 'no' });
  assert.match(show(no), /^No problem, I'll set Base, a16z and Circle aside\./, show(no));
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  for (const id of ['base-builder-grants', sr.id, circle.id]) {
    assert.ok(declined[`apply:${id}`], id);
    assert.ok(declined[`path:${id}`], id);
  }
  await newSession(b.id);
  const next = await find(b);
  assert.doesNotMatch(show(next), /applications? (?:ready|drafted) for you/, show(next));
  assert.notEqual(moveUp(next)?.kind, 'ready');
});

test('"sent" with sent_ids marks only those', db, async () => {
  const { sr, circle } = await ownerPrograms({ drafted: true });
  const b = await owner('si', { fits: true });
  await find(b);
  await yesAll(b);
  const sent = await tell(b, { kind: 'ready', project_key: b.key, answer: 'sent', sent_ids: [sr.id] });
  assert.match(show(sent), /^Nice, I'm tracking it\./, show(sent));
  const applied = await sql()<{ program_id: string }[]>`SELECT program_id FROM builder_program_status WHERE installation_id = ${b.id} AND status = 'applied'`;
  assert.deepEqual(applied.map((x) => x.program_id), [sr.id]);
  assert.deepEqual((await readyOf(b.id))?.opened, [circle.id]);
});

test('readySet through the real path: declined, applied and drafted within 30 days are left out (decision e)', db, async () => {
  const { sr, circle } = await ownerPrograms({ drafted: true });
  const ids = async (b: B) => ((((await find(b)).reply?.ready as { programs: { id: string }[] } | undefined)?.programs) ?? []).map((p) => p.id);
  const d = await owner('xd', { fits: true });
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('declined', jsonb_build_object(${`apply:${circle.id}`}::text, now()::text)) WHERE builder_id = ${d.id}`;
  assert.deepEqual(await ids(d), ['base-builder-grants', sr.id]);
  const a = await owner('xa', { fits: true });
  await mcpCall(a.ctx as never, 'tell', { program_status: [{ program_id: sr.id, status: 'applied' }] });
  await newSession(a.id);
  assert.deepEqual(await ids(a), ['base-builder-grants', circle.id]);
  const y = await owner('xy', { fits: true });
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('apply_yes', jsonb_build_object('base-builder-grants', now()::text)) WHERE builder_id = ${y.id}`;
  assert.deepEqual(await ids(y), [sr.id, circle.id]);
  // A draft older than 30 days is no exclusion.
  const old = await owner('xo', { fits: true });
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('apply_yes', jsonb_build_object('base-builder-grants', ${new Date(Date.now() - 31 * 86_400_000).toISOString()}::text)) WHERE builder_id = ${old.id}`;
  assert.deepEqual(await ids(old), ['base-builder-grants', sr.id, circle.id]);
});

test('a shared client and a 0-program set keep the path: no set, nothing ready written', db, async () => {
  await ownerPrograms();
  const shared = await owner('sh');
  const sh = await mcpCall({ ...(shared.ctx as object), sharedClient: true } as never, 'find', {});
  assert.doesNotMatch(show(sh), /applications? (?:ready|drafted) for you/);
  assert.equal(sh.reply?.ready, undefined);
  assert.equal((await seenOf(shared.id)).ready, undefined);
  await only([]);
  const none = await owner('zero');
  const before = await seenOf(none.id);
  const z = await find(none);
  assert.doesNotMatch(show(z), /applications? (?:ready|drafted) for you/);
  assert.notEqual(moveUp(z)?.kind, 'ready');
  assert.equal((await seenOf(none.id)).ready, undefined);
  // Fix 1 (M5): byte for byte the v4.8.2 path's reply (the set off) from the same state.
  await sql()`UPDATE builder_profiles SET standing_seen = ${sql().json(before as never)}::jsonb WHERE builder_id = ${none.id}`;
  READY_SET.on = false;
  try {
    const path = await find(none);
    assert.equal(show(z), show(path));
    assert.equal(z.reply?.note, path.reply?.note);
    assert.deepEqual(moveUp(z), moveUp(path));
  } finally {
    READY_SET.on = true;
  }
});

test('a builder-only field: its line says so, the answer is banked by kind and opens it, and the next program asking for it is pre-filled', db, async () => {
  const team = { key: 'founding_team', label: 'Tell us about the founding team', required: true, from: 'builder', kind: 'team', type: 'text', todo: 'a note on the founding team' };
  const reqs = [...DRAFTED, team];
  const one = await copy('circle-developer-grants', 'team1', { extra: { title: 'Teamwork Grants', tag: 'needs a live product', chains: ['base'], submission_requirements: reqs } });
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  await only([one.id]);
  const b = await owner('tm', { bank: false });
  const r = await find(b);
  assert.match(show(r), /\n1\. Teamwork Grants: \$5K to \$100K\. Needs your team list first\.\n/, show(r));
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(show(yes), "Teamwork needs your team list first. Reply with it and I'll finish it.");
  const answered = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', blanks: 'Just me, Jenil' });
  assert.equal(show(answered), 'It is open with every answer in place:\n- Teamwork: https://circle.questbook.app/\n\nReply "sent" once it\'s in, and I\'ll track it for you.');
  const [bank] = await sql()<{ answer: string }[]>`SELECT answer FROM answer_bank WHERE installation_id = ${b.id} AND kind = 'team'`;
  assert.equal(bank?.answer, 'Just me, Jenil');
  // While its page waits for "sent", a later find points back to it; sent, the next set may open.
  assert.match(show(await find(b)), /^Your application is open with every answer in place:\n- Teamwork: \$5K to \$100K\.\n\nReply "sent" once it's in/);
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'sent' });
  // The next program that asks for the team: pre-filled, never asked again.
  const two = await copy('circle-developer-grants', 'team2', { extra: { title: 'Second Grants', tag: 'needs a live product', chains: ['base'], submission_requirements: reqs } });
  await only([one.id, two.id]);
  await newSession(b.id);
  const next = await find(b);
  const p = (next.reply?.ready as { programs: { id: string; prefilled: Record<string, string> }[] }).programs.find((x) => x.id === two.id)!;
  assert.equal(p.prefilled.founding_team, 'Just me, Jenil');
  assert.match(show(next), /Second Grants: \$5K to \$100K\. Ready\./, show(next));
});

test('fix 1 (H1): a16z\'s founder brief is ready only with the team, money raised and email held; else its line names them and it waits', db, async () => {
  const { sr } = await ownerPrograms();
  const a16zLine = (txt: string) => txt.split('\n').find((l) => /^\d\. a16z/.test(l));
  const none = await owner('hn', { bank: false });
  // v4.10.1 Task 1 (R2): the email its form opens with is the builder's too, named first.
  assert.match(a16zLine(show(await find(none)))!, /^1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Needs your email, team list and any money you've raised first\.$/);
  const yes = await tell(none, { kind: 'ready', project_key: none.key, answer: 'yes' });
  assert.ok(!(yes.reply?.ready as { open: { id: string }[] }).open.some((p) => p.id === sr.id), show(yes));
  assert.doesNotMatch(show(yes), /a16z: https/, show(yes));
  const team = await owner('ht', { bank: 'team', contact: true });
  assert.match(a16zLine(show(await find(team)))!, /^1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Needs any money you've raised first\.$/);
  const both = await owner('hb', { contact: true });
  assert.match(a16zLine(show(await find(both)))!, /^1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Ready\.$/);
});

test('fix 1 (H1): the brief\'s answer is banked as team and raised and opens a16z, never asked again', db, async () => {
  const sr = await copy('a16z-speedrun', 'a16z-only', { hours: 30 });
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id <> ${sr.id}`;
  await only([sr.id]);
  const b = await owner('hq', { bank: false });
  assert.match(show(await find(b)), /\n1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Needs your email, team list and any money you've raised first\.\n/);
  assert.equal(show(await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' })), "a16z needs your email, team list and any money you've raised first. Reply with them and I'll finish it.");
  // v4.10.1 Task 1 fix round 1 (I2): the whole reply never answers two fields (nor an email): unsplit, all stay owed.
  const half = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', blanks: 'just me, nothing raised' });
  assert.equal(show(half), "a16z needs your email, team list and any money you've raised first. Reply with them and I'll finish it.");
  const done = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { contact: 'jenil@example.com', team: 'just me', raised: 'nothing raised' } });
  assert.equal(show(done), 'It is open with every answer in place:\n- a16z: https://speedrun.a16z.com/apply\n\nReply "sent" once it\'s in, and I\'ll track it for you.');
  const kinds = await sql()<{ kind: string }[]>`SELECT kind FROM answer_bank WHERE installation_id = ${b.id} ORDER BY kind`;
  assert.deepEqual(kinds.map((k) => k.kind), ['contact', 'raised', 'team']);
});

test('fix 1 (I1): codes never pushed: the re-check says so once, then Base is parked and the open pages\' "sent" ask goes on; a no parks it too', db, async () => {
  await ownerPrograms({ drafted: true });
  const b = await owner('ip', { fits: true });
  b.gh.repos[b.key].files = { 'src/app.ts': 'export const x = 1;' };
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
  await find(b);
  await yesAll(b);
  const first = await find(b);
  assert.equal(show(first), `${READY_CODES_NOT_YET}\n\n${PUSHED_ASK}`);
  const parked = await find(b);
  assert.match(show(parked), /^I'll keep Base Builder Grant for when it's done\.\n\nYour 2 applications are open with every answer in place:\n- a16z: up to \$1M, an accelerator, closes in (19|20) hours\.\n- Circle: \$5K to \$100K\.\n\nReply "sent" once they're in, and I'll track them for you\.$/, show(parked));
  assert.equal(moveUp(parked)?.kind, 'ready');
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  assert.ok(declined['path:base-builder-grants'] && declined['apply:base-builder-grants']);
  const r = await readyOf(b.id);
  assert.deepEqual([r?.waiting, (r as { codes?: string[] })?.codes], [[], []]);
  assert.ok(r?.skipped.includes('base-builder-grants'));

  const no = await owner('in', { fits: true });
  await find(no);
  const yes = await yesAll(no);
  assert.equal(moveUp(yes)?.kind, 'qualify');
  const said = await tell(no, { kind: 'qualify', project_key: no.key, answer: 'no' });
  assert.match(show(said), /^No problem, I'll set Base Builder Grant aside\.\n\nYour 2 applications are open with every answer in place:\n- a16z: up to \$1M, an accelerator, closes in (19|20) hours\.\n- Circle: \$5K to \$100K\.\n\nReply "sent" once they're in, and I'll track them for you\.$/, show(said));
  assert.equal(moveUp(said)?.kind, 'ready');
  // Fix 1 (M2): "sent" right after the yes (kind qualify, Base's codes pending) still tracks the open pages.
  const early = await owner('ie', { fits: true });
  await find(early);
  await yesAll(early);
  assert.match(show(await tell(early, { kind: 'qualify', project_key: early.key, answer: 'sent' })), /^Nice, I'm tracking them\./);
  // ... and never for another project's key.
  const other = await owner('io', { fits: true });
  await find(other);
  await yesAll(other);
  assert.equal(show(await tell(other, { kind: 'qualify', project_key: 'someone/else', answer: 'sent' })), 'Okay.');
});

test('fix 1 (M6): "skip 1 3" keeps a16z; "skip 2" on a 2-program set keeps Base', db, async () => {
  const { sr, circle } = await ownerPrograms({ drafted: true });
  const b = await owner('m13', { fits: true });
  await find(b);
  const r = await yesAll(b, { answer: 'skip', skip: [1, 3] });
  assert.ok(show(r).startsWith("Done, Base and Circle are skipped. I'll finish a16z now.\n\nIt is open with every answer in place:\n- a16z: https://speedrun.a16z.com/apply"), show(r));
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  assert.ok(declined['apply:base-builder-grants'] && declined[`apply:${circle.id}`] && !declined[`apply:${sr.id}`]);
  await only([sr.id, 'base-builder-grants']);
  const two = await owner('m2', { fits: true });
  assert.match(show(await find(two)), /^Jenil, I've started 2 applications for you, worth up to \$5K, plus a \$1M accelerator\. I need 4 answers from you first:\n/);
  const t = await yesAll(two, { answer: 'skip', skip: [2] });
  assert.ok(show(t).startsWith("Done, a16z is skipped. I'll finish Base now.\n\nAdding Builder Codes now, then I'll open Base."), show(t));
  assert.ok(show(t).endsWith(PUSHED_ASK), show(t));
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.10 final fix: one ask for the set (I1), honest long shots (I2), nothing stranded (I3 to I5), M3, M7 and M8.

const asksOf = (r: R) => ((r.reply?.ready as { need?: { asks: { kind: string }[] } } | undefined)?.need?.asks ?? []).map((a) => a.kind);
const openIds = (r: R) => ((r.reply?.ready as { open?: { id: string }[] } | undefined)?.open ?? []).map((p) => p.id);
const bankOf = async (id: number) =>
  Object.fromEntries((await sql()<{ kind: string; answer: string }[]>`SELECT kind, answer FROM answer_bank WHERE installation_id = ${id}`).map((x) => [x.kind, x.answer]));
/** A grant copy the owner fits (on Base, live), with these fields only the builder can give. */
const field = (key: string, kind: string, type = 'text', todo?: string) => ({ key, label: key.replace(/_/g, ' '), required: true, from: 'builder', kind, type, ...(todo && { todo }) });
async function grant(tag: string, title: string, fields: Record<string, unknown>[], hours: number | null = null) {
  const reqs = [...DRAFTED, ...fields];
  return copy('circle-developer-grants', tag, { hours, extra: { title, tag: 'needs a live product', chains: ['base'], submission_requirements: reqs } });
}
const ALL_FOUR = { team: 'Just me, Jenil', raised: 'Nothing raised yet', traction: '120 transactions', demo_video: 'https://loom.com/share/earnkit' };

test('final fix (I1), v4.10.2 (R1): the opener names the set\'s needs and counts them; the yes asks them once, at most 4; one split answer finishes them', db, async () => {
  const { sr } = await ownerPrograms();
  const b = await owner('i1', { bank: false });
  const opener = await find(b);
  const lines = show(opener).split('\n');
  // Base (11) and Circle (3, past a16z's 3) don't fit one reply: said apart, with their counts. a16z's brief: 3.
  assert.equal(lines[0], "Jenil, I've started 1 application for you, a $1M accelerator. I need 3 answers from you first:", show(opener));
  assert.ok(lines.some((l) => /^1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Needs your email, team list and any money you've raised first\.$/.test(l)), show(opener));
  assert.ok(lines.includes('Also open: Base Builder Grant, up to $5,000, needs 11 answers from you. Circle Developer Grants, $5K to $100K, needs 3 answers from you. Say "start Base" and "start Circle" anytime.'), show(opener));
  assert.ok(lines.some((l) => l.startsWith('Every other answer is filled from your commits')), show(opener));
  const asks = (opener.reply?.ready as { programs: { id: string; asks: { kind: string }[] }[] }).programs.map((p) => [p.id, p.asks.map((a) => a.kind)]);
  assert.deepEqual(asks, [[sr.id, ['contact', 'team', 'raised']]]);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(show(yes), "a16z needs your email, team list and any money you've raised first. Reply with them and I'll finish it.", show(yes));
  assert.equal(moveUp(yes)?.kind, 'ready');
  assert.deepEqual(asksOf(yes), ['contact', 'team', 'raised']);
  assert.deepEqual((yes.reply?.ready as { need: { asks: { kind: string; slots?: string[] }[] } }).need.asks[0].slots, ['email']);
  assert.equal(((await seenOf(b.id)).bench_ask as { kind: string; need?: boolean }).need, true);
  // One reply, split by the agent: a16z opens; the email is banked by slot, so no later program asks for it again.
  const answered = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { contact: { email: 'jenil@example.com' }, team: 'Just me, Jenil', raised: 'Nothing raised yet' } });
  assert.equal(show(answered), 'It is open with every answer in place:\n- a16z: https://speedrun.a16z.com/apply\n\nReply "sent" once it\'s in, and I\'ll track it for you.', show(answered));
  assert.deepEqual(openIds(answered), [sr.id]);
  assert.deepEqual(await bankOf(b.id), { contact: JSON.stringify({ email: 'jenil@example.com' }), team: 'Just me, Jenil', raised: 'Nothing raised yet' });
});

test('final fix (I1): answers on the first yes finish every program in one turn; the gate passes the walk', db, async () => {
  await ownerPrograms({ drafted: true });
  const b = await owner('i1y', { fits: true });
  // v4.10.2 Task 1: everything the set owes (Base's 4), in one reply.
  const answers = { 'other:revenue': 'No revenue yet', 'other:gtm_plan': 'Grow installs through builder posts on X', 'other:primary_challenge': 'User acquisition', 'other:credits': 'Privy and AWS' };
  const replies = await converse(b.ctx as never, [
    { find: {} },
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'yes', answers } }, says: 'yes, no revenue yet, grow installs through builder posts on X, user acquisition, Privy and AWS' },
    { tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } }, says: 'ok', before: () => pushCodes(b) },
  ], { builderId: b.id });
  // The route sets the list apart from its header (fixtures/mcp-call.ts format).
  assert.equal(replies[1].show, [
    "Adding Builder Codes now, then I'll open Base.",
    '',
    '2 of 3 are open with every answer in place:',
    '',
    '- a16z: https://speedrun.a16z.com/apply',
    '- Circle: https://circle.questbook.app/',
    '',
    PUSHED_ASK,
  ].join('\n'));
  assert.match(replies[2].show, /^All three are open with every answer in place:/);
  const given = ((await seenOf(b.id)).ready as { given: Record<string, Record<string, string>> }).given['base-builder-grants'];
  assert.deepEqual(given, { revenue: 'No revenue yet', gtm_plan: 'Grow installs through builder posts on X', primary_challenge: 'User acquisition', credits: 'Privy and AWS' });
  // The 3-month plan is one line the agent writes out (ready.open's expand).
  const base = (replies[2].reply?.ready as { open: { id: string; expand?: string[]; prefilled: Record<string, string> }[] }).open.find((p) => p.id === 'base-builder-grants')!;
  assert.deepEqual([base.expand, base.prefilled.builder_code], [['gtm_plan'], 'jenil_code']);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

test('final fix (I1): answers are limited to the asked kinds; blanks answer only a lone field (fix round 1, I2)', db, async () => {
  const sr = await copy('a16z-speedrun', 'a16z-ab', { hours: 30 });
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id <> ${sr.id}`;
  await only([sr.id]);
  const b = await owner('i1b', { bank: false });
  await find(b);
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  // 'use_of_funds' is no kind asked: ignored; the one email slot takes a string. Fix round 1 (I2): with the team and
  // money raised both asked, the whole reply answers neither, so money raised is still owed.
  const part = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { team: 'Just me', use_of_funds: 'hire', contact: 'jenil@example.com' }, blanks: 'just me, nothing raised' });
  assert.equal(show(part), "a16z needs any money you've raised first. Reply with it and I'll finish it.", show(part));
  // Asked alone, the whole reply is its answer.
  const done = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', blanks: 'nothing raised' });
  assert.match(show(done), /^It is open with every answer in place:\n- a16z: /, show(done));
  assert.deepEqual(await bankOf(b.id), { team: 'Just me', raised: 'nothing raised', contact: JSON.stringify({ email: 'jenil@example.com' }) });
});

test('final fix (I1, I3), v4.10.2 (R1): a program past the set\'s 4 answers is said apart, never asked in the same reply; it can be the next set', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const alpha = await grant('alpha', 'Alpha Grants', [field('founding_team', 'team'), field('pitch_video', 'demo_video', 'url'), field('team_location', 'other', 'text', 'team location')], 30);
  const beta = await grant('beta', 'Beta Grants', [field('usage_numbers', 'traction'), { ...field('consent_terms', 'other', 'choice', 'consent to the terms'), options: ['Yes', 'No'] }, field('requested_amount_usd', 'other', 'text', 'requested amount')]);
  await only([alpha.id, beta.id]);
  const b = await owner('cap', { bank: false });
  const opener = show(await find(b));
  assert.match(opener, /^Jenil, I've started 1 application for you, worth up to \$100K\. I need 3 answers from you first:\n\n1\. Alpha Grants: \$5K to \$100K\. Needs your team list, demo video and team location first\.\n\nAlso open: Beta Grants, \$5K to \$100K, needs 3 answers from you\. Say "start Beta" anytime\.\n\nEvery other answer is filled/, opener);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(show(yes), "Alpha needs your team list, demo video and team location first. Reply with them and I'll finish it.", show(yes));
  assert.deepEqual(asksOf(yes), ['team', 'demo_video', 'other:team_location']);
  const no = await tell(b, { kind: 'ready', project_key: b.key, answer: 'no' });
  assert.match(show(no), /^No problem, I'll set Alpha aside\./, show(no));
  assert.ok(((await seenOf(b.id)).declined as Record<string, string>)[`apply:${alpha.id}`]);
  // The next session's set is Beta, its own 3.
  await newSession(b.id);
  const next = await find(b);
  assert.match(show(next), /\n1\. Beta Grants: \$5K to \$100K\. Needs your usage numbers, consent to the terms and requested amount first\.\n/, show(next));
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  // v4.10.1 Task 1: two fields of no bankable kind never share an answer: a plain 'other' fills neither.
  const plain = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { traction: 'no users yet', other: 'Yes, $5,000' } });
  assert.equal(show(plain), "Beta needs your consent to the terms and requested amount first. Reply with both and I'll finish it.", show(plain));
  assert.deepEqual(asksOf(plain), ['other:consent_terms', 'other:requested_amount_usd']);
  // Each under its own key: kept in the set, so neither is asked again.
  const done = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { 'other:consent_terms': 'Yes', 'other:requested_amount_usd': '$5,000' } });
  assert.equal(show(done), 'It is open with every answer in place:\n- Beta: https://circle.questbook.app/\n\nReply "sent" once it\'s in, and I\'ll track it for you.', show(done));
  assert.deepEqual(((await seenOf(b.id)).ready as { given: Record<string, Record<string, string>> }).given[beta.id], { consent_terms: 'Yes', requested_amount_usd: '$5,000' });
});

test('final fix (I3): a no to the only waiting program, nothing open: the ask goes, never "Your 0 applications"', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const one = await grant('solo', 'Teamwork Grants', [field('founding_team', 'team')]);
  await only([one.id]);
  const b = await owner('i3', { bank: false });
  await find(b);
  assert.equal(show(await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' })), "Teamwork needs your team list first. Reply with it and I'll finish it.");
  const no = await tell(b, { kind: 'ready', project_key: b.key, answer: 'no' });
  assert.match(show(no), /^No problem, I'll set Teamwork aside\./, show(no));
  assert.notEqual(((await seenOf(b.id)).bench_ask as { kind?: string } | undefined)?.kind, 'ready');
  for (const r of [no, await find(b), await find(b)]) assert.doesNotMatch(show(r), /Your 0 applications|0 of \d/, show(r));
});

test('v4.10.1 Task 2 (5): the repeat reply names each program with its money and hours, "still ready" only when true; a closed one drops out', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const soon = await grant('again-soon', 'Soon Grants', [], 30);
  const open = await grant('again-open', 'Open Grants', []);
  await only([soon.id, open.id]);
  const b = await owner('ag', { bank: false });
  const first = await find(b);
  assert.match(show(first), /\n1\. Soon Grants: \$5K to \$100K\. Ready\.\n2\. Open Grants: \$5K to \$100K\. Ready\.\n/, show(first));
  const again = await find(b);
  assert.match(show(again), /^Your 2 applications are still ready:\n- Soon: \$5K to \$100K, closes in (29|30) hours\. Ready\.\n- Open: \$5K to \$100K\. Ready\.\n\nReply yes and I'll finish them\.$/, show(again));
  assert.equal(moveUp(again)?.kind, 'ready');
  // A program closed since the opener is no longer named.
  await sql()`UPDATE programs SET status = 'closed' WHERE id = ${soon.id}`;
  assert.match(show(await find(b)), /^Your application is still ready:\n- Open: \$5K to \$100K\. Ready\.\n\nReply yes and I'll finish it\.$/);
  // Every program closed: never "Your 0 applications"; the path answers.
  await sql()`UPDATE programs SET status = 'closed' WHERE id = ${open.id}`;
  assert.doesNotMatch(show(await find(b)), /Your 0 applications|still ready|stands?:/);
});

test('v4.10.1 Task 2 fix round 1: every program of the set closed, a later yes never drafts or opens a closed program', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const one = await grant('gone-one', 'Gone Grants', []);
  const two = await grant('gone-two', 'Lost Grants', []);
  await only([one.id, two.id]);
  const b = await owner('gn', { bank: false });
  await find(b);
  await sql()`UPDATE programs SET status = 'closed' WHERE id = ANY(${[one.id, two.id]}::text[])`;
  const after = await find(b);
  assert.doesNotMatch(show(after), /Your 0 applications|Gone|Lost/, show(after));
  // The ask goes with its programs (as an expired set's, M7).
  assert.notEqual(((await seenOf(b.id)).bench_ask as { kind?: string } | undefined)?.kind, 'ready');
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  const ready = yes.reply?.ready as { open?: { id: string }[] } | undefined;
  assert.deepEqual(ready?.open ?? [], [], show(yes));
  // A plain answer: the stale ask is gone, so the yes has nothing to finish.
  assert.equal(show(yes), 'Okay.');
  assert.equal(moveUp(yes), undefined);
  assert.doesNotMatch(show(yes), /Gone|Lost|open with every answer/, show(yes));
  const seen = await seenOf(b.id);
  assert.deepEqual(Object.keys((seen.apply_yes ?? {}) as Record<string, unknown>).filter((k) => k.includes(one.id) || k.includes(two.id)), [], JSON.stringify(seen.apply_yes));
  assert.deepEqual((await readyOf(b.id))?.opened ?? [], []);
});

test('final fix (I4): "sent" for the open page while another waits on the builder: the follow-up asks for it, then it opens', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const open = await grant('open', 'Open Grants', []);
  const team = await grant('team', 'Teamwork Grants', [field('founding_team', 'team')]);
  await only([open.id, team.id]);
  const b = await owner('i4', { bank: false });
  await find(b);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(show(yes), "1 of 2 is open with every answer in place:\n- Open: https://circle.questbook.app/\n\nTeamwork needs your team list first. Reply with it and I'll finish it.", show(yes));
  // The builder sends the open one before answering: it is tracked, and the waiting one is not dropped.
  const sent = await tell(b, { kind: 'ready', project_key: b.key, answer: 'sent' });
  assert.equal(show(sent), "Nice, I'm tracking it.\n\nStill waiting on your team list for Teamwork. Reply with it and I'll finish it.", show(sent));
  assert.equal(moveUp(sent)?.kind, 'ready');
  const r = (await readyOf(b.id))!;
  assert.deepEqual([r.opened, r.waiting], [[], [team.id]]);
  const done = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { team: 'Just me' } });
  assert.deepEqual(openIds(done), [team.id]);
  assert.match(show(done), /Teamwork: https:\/\/circle\.questbook\.app\/\n\nReply "sent" once it's in/, show(done));
});

test('final fix (I5): Builder Codes found never open a program the builder still owes answers for', db, async () => {
  await ownerPrograms({ drafted: true });
  const b = await owner('i5', { fits: true });
  await find(b);
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  // The agent pushes and calls find (GAP_DO_NOTE): the codes are in, but Base still needs the builder's answers.
  pushCodes(b);
  const after = await find(b);
  assert.deepEqual(openIds(after), []);
  assert.match(show(after), /^Base needs how it makes money today, your 3-month plan in one line, your main challenge right now and the credits you want first\. Reply with them and I'll finish it\.$/, show(after));
  const r = (await readyOf(b.id))!;
  assert.deepEqual([r.waiting.includes('base-builder-grants'), (r as { codes?: string[] }).codes], [true, []]);
  const done = await yesAll(b);
  assert.ok(show(done).startsWith('All three are open with every answer in place:'), show(done));
});

test('final fix (M8): a hosted agent\'s yes never says "I\'ll do it": the codes ask first, then the set\'s one ask', db, async () => {
  const { sr, circle } = await ownerPrograms({ drafted: true });
  const h = await owner('hy', { hosted: true, fits: true });
  // v4.10.1 Task 1: Base names what it owes first (the hosted codes line itself: v410-ready.test.ts).
  assert.doesNotMatch(show(await find(h)), /I'll do it/);
  const yes = await yesAll(h);
  assert.doesNotMatch(show(yes), /I'll do it|Adding Builder Codes now/, show(yes));
  assert.match(show(yes), /^2 of 3 are open with every answer in place:\n- a16z: https:\/\/speedrun\.a16z\.com\/apply\n- Circle: https:\/\/circle\.questbook\.app\/\n\n/, show(yes));
  assert.ok(show(yes).endsWith(HELP_DONE_ASK), show(yes));
  assert.deepEqual(openIds(yes), [sr.id, circle.id]);
  assert.equal(moveUp(yes)?.kind, 'qualify');
  // With answers owed, the hosted yes still asks for the codes first; once they are found, the one ask follows.
  const owes = await owner('hn2', { hosted: true, fits: true });
  await find(owes);
  const y2 = await tell(owes, { kind: 'ready', project_key: owes.key, answer: 'yes' });
  assert.ok(show(y2).endsWith(HELP_DONE_ASK), show(y2));
  assert.doesNotMatch(show(y2), /Reply with them/, show(y2));
  pushCodes(owes);
  const ok = await tell(owes, { kind: 'qualify', project_key: owes.key, answer: 'yes' });
  assert.match(show(ok), /Base needs how it makes money today, your 3-month plan in one line, your main challenge right now and the credits you want first\. Reply with them and I'll finish it\.$/, show(ok));
});

test('final fix (M7, M3): a ready ask whose set expired is dropped, never "Okay."; "skip 1 2 3 4" is taken', db, async () => {
  await ownerPrograms({ drafted: true });
  const b = await owner('m7', { fits: true });
  await find(b);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{ready,at}', to_jsonb(${new Date(Date.now() - 31 * 86_400_000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  const r = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.notEqual(show(r), 'Okay.');
  assert.notEqual(((await seenOf(b.id)).bench_ask as { kind?: string } | undefined)?.kind, 'ready');
  const s = await owner('m3', { fits: true });
  await find(s);
  const all = await tell(s, { kind: 'ready', project_key: s.key, answer: 'skip', skip: [1, 2, 3, 4] });
  assert.match(show(all), /^No problem, I'll set Base, a16z and Circle aside\./, show(all));
  // The yes refreshes the set's time (M7), so a set answered late doesn't expire the next day.
  const y = await owner('m7y', { fits: true });
  await find(y);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{ready,at}', to_jsonb(${new Date(Date.now() - 29 * 86_400_000).toISOString()}::text)) WHERE builder_id = ${y.id}`;
  await tell(y, { kind: 'ready', project_key: y.key, answer: 'yes' });
  assert.ok(Date.now() - Date.parse(((await seenOf(y.id)).ready as { at: string }).at) < 60_000);
});

test('v4.10.2 (R3): the owner\'s real set (OWN=27): Circle is not eligible off Arc and Base needs 11 answers, so no set: the path answers', db, async () => {
  const { circle } = await ownerPrograms({ required: true });
  await only([circle.id, 'base-builder-grants']);
  // Builder 17 on 2026-11-02: nothing banked, no owned Base contract, no Builder Code, an opted-in email; not on Arc.
  const b = await owner('own3', { bank: false, contract: false });
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email, asked_at, opted_in_at) VALUES (${b.id}, '', 'jenil@example.com', now(), now())
    ON CONFLICT (installation_id, login) DO UPDATE SET email = EXCLUDED.email, opted_in_at = now(), unsubscribed_at = NULL`;
  const replies = await converse(b.ctx as never, [{ find: {} }, { says: 'what can I apply to', find: { ask: 'programs' } }, { says: 'Circle', find: { program: 'Circle' } }], { builderId: b.id });
  const [opener, table, pick] = replies;
  // The path's own move leads: Base, one Builder Codes step away (Go?), never Circle's integrations.
  assert.match(opener.show, /\nJenil, Base Builder Grant pays up to \$5,000\. To qualify, EarnKit needs to add Builder Codes/, opener.show);
  assert.match(opener.show, /\n\nI can add Builder Codes and push the change, about 10 minutes\. Go\?$/, opener.show);
  assert.notEqual(moveUp({ reply: opener.reply } as R)?.kind, 'ready', opener.show);
  assert.equal(opener.reply?.ready, undefined);
  assert.doesNotMatch(opener.show, /Circle/, opener.show);
  assert.doesNotMatch(opener.show, /integrations/, opener.show);
  // The programs table still lists it, with the fact why.
  assert.match(table.show, /Circle Developer Grants: .*Your fit: not yet, they look for apps on Arc\./, table.show);
  // Fix round 1 (2): picking it by name says why in one plain statement, then the path's move; never its form's asks.
  assert.ok(pick.show.split('\n\n').includes("Circle Developer Grants only takes an app on Arc, and EarnKit isn't one yet."), pick.show);
  assert.doesNotMatch(pick.show, /integrations/, pick.show);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

/**
 * v4.10.2 Task 5 (replay on the 2026-11-02 snapshot): the owner passed on Base's Builder Codes step, already raised once
 * (declined 'qualify:<key>', path_raised), so the path has no move; the set holds nothing (Base needs 11 answers, Circle
 * not eligible). The quiet reply leads with the money left out ("also open") and one yes/no; a repeat find says it as
 * the easy reply alone (program, money, the answers); the programs answer later is no session opener.
 */
async function passedOwner(tag: string) {
  const { circle } = await ownerPrograms({ required: true });
  await only([circle.id, 'base-builder-grants']);
  const b = await owner(tag, { bank: false, contract: false });
  const day = 86_400_000;
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen
      || jsonb_build_object('declined', jsonb_build_object(${`qualify:${b.key}`}::text, ${new Date(Date.now() - day).toISOString()}::text),
        'path_raised', jsonb_build_object('base-builder-grants', ${new Date(Date.now() - 3 * day).toISOString()}::text),
        'checkin', now()::text, 'ship_asked', now()::text)
    WHERE builder_id = ${b.id}`;
  return b;
}
// v4.10.3 Task 1 (R3, owner answer 3): the lead and its repeat name the draft's first round, and how many come after it.
const ROUND_1 = 'your team list, usage numbers, demo video and contract address on Base';
const ALSO_HEAD = `Base Builder Grant pays up to $5,000 and needs 12 answers from you. The first 4: ${ROUND_1}, and 8 more after these.`;
const ALSO_AGAIN = `Want me to start Base Builder Grant (up to $5,000, 12 answers from you, starting with ${ROUND_1})?`;

test('v4.10.2 Task 5: an empty set and a quiet path lead with the also-open money, one yes/no; repeats carry it in the easy reply', db, async () => {
  const b = await passedOwner('al1');
  const replies = await converse(b.ctx as never, [{ find: {} }, { find: {} }, { find: {} }, { says: 'what can I apply to', find: { ask: 'programs' } }], { builderId: b.id });
  const [lead, again, third] = replies;
  // The session opener: the money line first (v4.10.3 Task 1, R2: Circle not eligible adds nothing), a fact from the
  // record, the program with its first round, then the one easy reply.
  assert.equal(lead.show.split('\n\n')[0], 'Open for you now: up to $5,000 in grants.', lead.show);
  assert.match(lead.show, /You've shipped 6 weeks in a row/, lead.show);
  assert.ok(lead.show.split('\n\n').includes(ALSO_HEAD), lead.show);
  assert.equal(moveUp({ reply: lead.reply } as R)?.agent_note, ALSO_LEAD_NOTE);
  assert.deepEqual((lead.reply?.draft as { asks: { kind: string }[] }).asks.map((a) => a.kind), ['team', 'traction', 'demo_video', 'other:contract_address']);
  assert.match(lead.show, /\n\nWant me to start it\?$/, lead.show);
  assert.deepEqual([moveUp({ reply: lead.reply } as R)?.kind, moveUp({ reply: lead.reply } as R)?.project_key], ['apply', b.key]);
  assert.doesNotMatch(lead.show, /Reply "more"|Circle/, lead.show);
  // A repeat find: the easy reply alone, naming the program, the money and the answers (never "Reply more" alone).
  assert.equal(again.show, ALSO_AGAIN);
  assert.equal(third.show, ALSO_AGAIN);
  assert.equal(moveUp({ reply: again.reply } as R)?.kind, 'apply');
  assert.ok(!replies[3].first, 'the programs answer is mid-session, never an opener');
  for (const r of replies) assert.doesNotMatch(r.show, BAD, r.show);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

test('v4.10.2 Task 5: the also-open yes starts the draft (the path); a no parks it and the quiet reply goes back to "more"', db, async () => {
  const b = await passedOwner('al2');
  const lead = await find(b);
  assert.match(show(lead), /Want me to start it\?$/, show(lead));
  const yes = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  assert.equal((await seenOf(b.id)).path && ((await seenOf(b.id)).path as { stage: string; program_id: string }).program_id, 'base-builder-grants');
  assert.equal(((await seenOf(b.id)).path as { stage: string }).stage, 'draft');
  assert.ok(show(yes).length > 0, 'the draft reply');

  const c = await passedOwner('al3');
  await find(c);
  await tell(c, { kind: 'apply', project_key: c.key, answer: 'no' });
  const after = show(await find(c));
  assert.doesNotMatch(after, /Want me to start/, after);
  assert.ok(((await seenOf(c.id)).declined as Record<string, string>)['path:base-builder-grants'], 'parked for the path');
});

/**
 * v4.10.2 final fix (I1): the also-open yes starts the path's draft, and the draft asks from the same list the lead
 * counts (the Builder Code as the builder's own, the 3-month plan as one line, the unheld contact details as one item),
 * at most 4 answers a round, each round banked; "ready to paste" only after the last round. Count, asks and ready agree.
 */
test('v4.10.2 final fix (I1): the Base path draft asks every counted answer in rounds of at most 4, then says ready', db, async () => {
  const b = await passedOwner('rnd');
  const lead = show(await find(b));
  const total = Number(lead.match(/needs (\d+) answers from you/)?.[1]);
  assert.ok(total > 4, lead);
  const WORDS: Record<string, string> = { team: 'just me', traction: 'no users yet', demo_video: 'https://loom.com/share/x' };
  let r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes' });
  const seen: string[] = [];
  let asked = 0;
  let rounds = 0;
  for (; rounds < 6; rounds++) {
    const s = show(r);
    seen.push(s);
    if (/ready to paste/.test(s)) break;
    assert.doesNotMatch(s, /\bReady\b|every answer is filled/, s);
    assert.match(s, /Reply with (?:it|both|them) and I'll finish it\.$/, s);
    const asks = (r.reply?.draft as { asks: { kind: string; slots?: string[]; one_line?: boolean }[] }).asks;
    const n = asks.reduce((x, a) => x + (a.kind === 'contact' ? a.slots!.length : 1), 0);
    assert.ok(n >= 1 && n <= 4, `round ${rounds} asks ${n}: ${s}`);
    asked += n;
    const answers = Object.fromEntries(asks.map((a) => [a.kind, a.kind === 'contact'
      ? Object.fromEntries(a.slots!.map((sl) => [sl, sl === 'name' ? 'Jenil T' : `@${sl}${RUN}`]))
      : /builder_code/.test(a.kind) ? `bc_rnd${RUN}` : WORDS[a.kind] ?? `answer for ${a.kind}`]));
    r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', answers });
  }
  assert.ok(rounds >= 2, seen.join('\n---\n'));
  assert.equal(asked, total, `the lead's count is the asks: ${seen.join('\n---\n')}`);
  const all = seen.join('\n');
  assert.match(all, /your Base Builder Code/, all);
  assert.ok(all.includes('your 3-month plan in one line'), all);
  // Ready only on the last reply; the form line names no field EarnKit holds or was given.
  assert.equal(seen.filter((s) => /ready to paste/.test(s)).length, 1, all);
  assert.match(seen.at(-1)!, /ready to paste/);
  assert.doesNotMatch(seen.at(-1)!, /The form also asks for/, seen.at(-1)!);
  // The Builder Code is kept as theirs (the next ask never asks it again).
  const claims = await sql()<{ code: string }[]>`SELECT code FROM builder_code_claims WHERE builder_id = ${b.id}`;
  assert.ok(claims.some((c) => c.code === `bc_rnd${RUN}`), JSON.stringify(claims));
  for (const s of seen) assert.doesNotMatch(s, BAD, s);
});

/**
 * v4.10.3 Task 1 (R1, R2, R3; CTO dogfood of OWN=27 on 2026-11-03): the walk's shape, Base needing 12 answers (the set
 * empty), Circle not eligible, and an Alliance ALL19 copy ($400K accelerator). The lead opens with the money line: the
 * grant total (Base only: never Alliance's $400K, never Circle's), then Alliance's own amount and kind and its close
 * when it closes within 30 days; then Base with its first 4 asks named and "and 8 more", then the one yes/no.
 */
async function allianceOwner(tag: string, hours: number) {
  const b = await passedOwner(tag);
  const all = await copy('alliance-all19', `all${tag}`, { hours });
  await only([`v410-${process.pid}-circle`, 'base-builder-grants', all.id]);
  return { b, all };
}

test('v4.10.3 Task 1 (R1, R2): the empty-set lead opens with the grant total and Alliance closing in 15 days, then Base\'s first 4 asks', db, async () => {
  const { b } = await allianceOwner('h15', 15 * 24 + 1);
  const replies = await converse(b.ctx as never, [{ find: {} }, { find: {} }], { builderId: b.id });
  const [lead, again] = replies;
  const paras = lead.show.split('\n\n');
  assert.equal(paras[0], 'Open for you now: up to $5,000 in grants plus a $400K accelerator. Alliance closes in 15 days.', lead.show);
  assert.ok(paras.includes(ALSO_HEAD), lead.show);
  assert.equal(paras.at(-1), 'Want me to start it?', lead.show);
  // The investor money is never in the grant total, and Alliance is never the move.
  assert.doesNotMatch(lead.show, /\$405|\$400,000|start Alliance/, lead.show);
  assert.equal(moveUp({ reply: lead.reply } as R)?.kind, 'apply');
  assert.equal((await seenOf(b.id)).bench_ask && ((await seenOf(b.id)).bench_ask as { program_id: string }).program_id, 'base-builder-grants');
  // The repeat: the easy reply alone, still naming the first round's asks (never a bare count), and no money line again.
  assert.equal(again.show, ALSO_AGAIN);
  for (const r of replies) assert.doesNotMatch(r.show, BAD, r.show);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

test('v4.10.3 Task 1 (R1): Alliance closing in 30 days is named; in 31 days it is not', db, async () => {
  const { b: in30 } = await allianceOwner('h30', 30 * 24 - 1);
  const named = show(await find(in30)).split('\n\n')[0];
  assert.equal(named, 'Open for you now: up to $5,000 in grants plus a $400K accelerator. Alliance closes in 29 days.', named);
  const { b: in31 } = await allianceOwner('h31', 31 * 24);
  const lead = show(await find(in31));
  assert.equal(lead.split('\n\n')[0], 'Open for you now: up to $5,000 in grants.', lead);
  assert.doesNotMatch(lead, /Alliance|accelerator|\$400K/, lead);
});

test('v4.10.3 Task 1 (R3): a yes to the lead that answers its first round banks them as round 1; the draft asks the next round', db, async () => {
  const { b } = await allianceOwner('yr1', 15 * 24 + 1);
  const lead = await find(b);
  const asks = (lead.reply?.draft as { asks: { kind: string }[] }).asks;
  const WORDS: Record<string, string> = { team: 'just me', traction: 'no users yet', demo_video: 'https://loom.com/share/x', 'other:contract_address': '0x1234567890123456789012345678901234567890' };
  const answers = Object.fromEntries(asks.map((a) => [a.kind, WORDS[a.kind] ?? `answer for ${a.kind}`]));
  const yes = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', answers });
  const s = show(yes);
  assert.match(s, /^Here's your draft:/, s);
  // Round 2: 4 more, never round 1's asks again.
  assert.match(s, /\nFour blanks only you can fill \(4 more after these\): /, s);
  assert.doesNotMatch(s, /team list|usage numbers|demo video|contract address/, s);
  const next = (yes.reply?.draft as { asks: { kind: string }[] }).asks.map((a) => a.kind);
  assert.equal(next.length, 4);
  assert.ok(!next.some((k) => asks.some((a) => a.kind === k)), JSON.stringify(next));
  assert.match(noteOf(yes), /EarnKit kept the answers they gave with their yes/, noteOf(yes));
  const path = (await seenOf(b.id)).path as { stage: string; program_id: string };
  assert.deepEqual([path.stage, path.program_id], ['draft', 'base-builder-grants']);
  assert.doesNotMatch(s, BAD, s);
});

test('v4.10.3 fix round 1 (1): a yes answering 2 of the lead\'s 4 asks keeps those 2; the next reply asks the other 2 first, ready only at the end', db, async () => {
  const { b } = await allianceOwner('pt2', 15 * 24 + 1);
  const lead = await find(b);
  const total = Number(show(lead).match(/needs (\d+) answers from you/)?.[1]);
  const asks = (lead.reply?.draft as { asks: { kind: string }[] }).asks;
  assert.deepEqual(asks.map((a) => a.kind), ['team', 'traction', 'demo_video', 'other:contract_address']);
  let r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', answers: { team: 'just me', traction: 'no users yet' } });
  let s = show(r);
  assert.match(s, /^Here's your draft:/, s);
  assert.doesNotMatch(s, /ready to paste|team list|usage numbers/, s);
  const second = (r.reply?.draft as { asks: { kind: string; slots?: string[] }[] }).asks;
  assert.deepEqual(second.slice(0, 2).map((a) => a.kind), ['demo_video', 'other:contract_address'], s);
  assert.match(s, /: your demo video, your contract address on Base, /, s);
  let asked = 2;
  const seen = [s];
  for (let round = 0; round < 6 && !/ready to paste/.test(s); round++) {
    const now = (r.reply?.draft as { asks: { kind: string; slots?: string[] }[] }).asks;
    asked += now.reduce((x, a) => x + (a.kind === 'contact' ? a.slots!.length : 1), 0);
    const answers = Object.fromEntries(now.map((a) => [a.kind, a.kind === 'contact'
      ? Object.fromEntries(a.slots!.map((sl) => [sl, sl === 'name' ? 'Jenil T' : `@${sl}${RUN}`]))
      : /builder_code/.test(a.kind) ? `bc_pt2${RUN}` : `answer for ${a.kind}`]));
    r = await tell(b, { kind: 'apply', project_key: b.key, answer: 'yes', answers });
    s = show(r);
    seen.push(s);
  }
  assert.equal(seen.filter((x) => /ready to paste/.test(x)).length, 1, seen.join('\n---\n'));
  assert.match(seen.at(-1)!, /ready to paste/);
  assert.equal(asked, total, `every counted answer asked once: ${seen.join('\n---\n')}`);
});

test('v4.10.3 fix round 1 (7, R2): a builder with only an investor program open: no "$0", the investor clause alone or no money line', db, async () => {
  const b = await passedOwner('inv');
  const all = await copy('alliance-all19', 'allinv', { hours: 15 * 24 + 1 });
  await only([all.id]);
  const replies = await converse(b.ctx as never, [{ find: {} }, { find: {} }], { builderId: b.id });
  for (const r of replies) {
    assert.doesNotMatch(r.show, /\$0\b|in grants|\$400,000|\$400K in/, r.show);
    const money = r.show.split('\n\n').find((p) => p.startsWith('Open for you now:'));
    if (money) assert.equal(money, 'Open for you now: a $400K accelerator. Alliance closes in 15 days.', r.show);
    assert.doesNotMatch(r.show, BAD, r.show);
  }
  // The quiet reply here is the route's own (no lead: nothing to apply to but the accelerator); its copy and one ask hold.
  const rules = new Set(['copy', 'claim', 'easy_reply', 'repeat']);
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }).filter((f) => rules.has(f.rule)), [], replies.map((r) => r.show).join('\n---\n'));
});

test('v4.10.2 (R3): Circle not eligible beside a set is said in one plain line; on Arc it is eligible, a plain fit (never a long shot)', db, async () => {
  const { sr, circle } = await ownerPrograms({ required: true, tagged: false });
  const off = await owner('ne', { fits: true });
  const r = await find(off);
  const ready = r.reply?.ready as { programs: { id: string }[]; not_eligible?: { id: string; title: string }[] };
  assert.ok(!ready.programs.some((p) => p.id === circle.id), show(r));
  assert.ok(ready.programs.some((p) => p.id === sr.id), show(r));
  assert.deepEqual(ready.not_eligible, [{ id: circle.id, title: circle.title }]);
  const paras = show(r).split('\n\n');
  assert.ok(paras.includes("Circle Developer Grants is only for an app on Arc, so it doesn't fit EarnKit yet."), show(r));
  assert.doesNotMatch(show(r), /integrations/, show(r));
  assert.deepEqual(gateFailures([{ turn: 0, session: 0, first: true, hook: false, tool: 'find', input: {}, show: show(r), said: ['opener'], reply: r.reply } as never]).filter((f) => f.rule === 'easy_reply' || f.rule === 'copy'), []);
  // The same programs for a project on Arc: Circle is in the set as a fit, its needs asked.
  const on = await owner('arc', { fits: true });
  await sql()`UPDATE builder_projects SET chains = ARRAY['base', 'arc']::text[] WHERE builder_id = ${on.id}`;
  const a = await find(on);
  const set = (a.reply?.ready as { programs: { id: string; kind: string }[]; not_eligible?: unknown }).programs;
  assert.deepEqual(set.find((p) => p.id === circle.id)?.kind, 'fit', show(a));
  assert.equal((a.reply?.ready as { not_eligible?: unknown }).not_eligible, undefined);
  assert.match(show(a), /\d\. Circle Developer Grants: \$5K to \$100K\. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first\.\n/, show(a));
  assert.doesNotMatch(show(a), /long shot|doesn't fit/, show(a));
});

test('final fix (I2): untagged Circle on a project not on Arc is a long shot, last; every "Ready." agrees with the programs table', db, async () => {
  const { circle } = await ownerPrograms({ tagged: false });
  const b = await owner('i2');
  const replies = await converse(b.ctx as never, [{ find: {} }, { says: 'what can I apply to', find: { ask: 'programs' } }], { builderId: b.id });
  const [opener, table] = replies.map((r) => r.show);
  const lines = opener.split('\n').filter((l) => /^\d\. /.test(l));
  // v4.10.1 Task 1: its real form asks what the agent would invent, so it needs them, never "Ready".
  assert.equal(lines.at(-1), "2. Circle Developer Grants: $5K to $100K. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first, and Circle looks for apps on Arc, so it's a long shot.", opener);
  const last = (replies[0].reply?.ready as { programs: { id: string; kind: string }[] }).programs.at(-1)!;
  assert.deepEqual([last.id, last.kind], [circle.id, 'long_shot']);
  // The route says the table as lines ("{grant}: {money}, {when}. Your fit: {cell}.": fixtures/mcp-call.ts format).
  const cell = (name: string) => table.split('\n').find((l) => l.startsWith(`${name}: `))?.match(/Your fit: (.+)\.$/)?.[1];
  assert.equal(cell('Circle Developer Grants'), 'not yet, they look for apps on Arc', table);
  for (const l of lines) {
    const m = /^\d\. (.+?): .*\. (Ready(?: once [^,]*?)?)\.$/.exec(l);
    const name = m?.[1];
    if (!m || !name || !cell(name)) continue;
    // A grant the opener calls ready is one the table calls a fit or a step away; never "Not yet".
    assert.match(cell(name)!, /^(?:fits|1 step|\d+ steps)/i, `${l}\n${table}`);
  }
  // v4.10.2 Task 1 (R1): Base, past one reply's answers, is said apart; the table still lists it.
  assert.match(opener, /\nAlso open: Base Builder Grant, up to \$5,000, needs 8 answers from you\./, opener);
  assert.ok(cell('Base Builder Grant'), table);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.10.1 Task 1: honest needs. What the agent would have to invent is asked; what EarnKit holds is filled.

test('v4.10.1 (1): Circle\'s real form reads "Needs" with its fields, never "Ready"; its roadmap and milestones take distinct answers', db, async () => {
  const { circle } = await ownerPrograms();
  const b = await owner('c1', { contact: true });
  const opener = await find(b);
  const line = show(opener).split('\n').find((l) => /^\d\. Circle/.test(l))!;
  assert.match(line, /Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first/, show(opener));
  assert.doesNotMatch(line, /Ready/);
  // The contact details are banked and the bank holds the rest, so a16z is ready; Base owes its 5 own answers (revenue,
  // the 3-month plan, its Builder Code, the main challenge and the credits), past one reply, so it is said apart.
  assert.match(show(opener), /\n1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Ready\.\n/, show(opener));
  assert.match(show(opener), /\nAlso open: Base Builder Grant, up to \$5,000, needs 5 answers from you\./, show(opener));
  // Circle's 3 are the set's one ask, so "every other answer" is true.
  assert.match(show(opener), /\n\nEvery other answer is filled from your commits/, show(opener));
  const yes = await yesAll(b);
  assert.ok(openIds(yes).includes(circle.id), show(yes));
  const given = ((await seenOf(b.id)).ready as { given: Record<string, Record<string, string>> }).given;
  assert.deepEqual(given[circle.id], { integrations: OWED['other:integrations'], roadmap: OWED['other:roadmap'], milestones: OWED['other:milestones'] });
  // A roadmap answered under its own key is never banked as another program's milestones.
  assert.equal((await bankOf(b.id)).milestones, undefined);
});

test('v4.10.1 (2): a contact detail given once is banked by slot and never asked again; only the missing slots are named', db, async () => {
  const sr = await copy('a16z-speedrun', 'a16z-cb', { hours: 30 });
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id <> ${sr.id}`;
  // v4.10.2 Task 1: a grant asking the contact details only (Base's real form owes more than one reply holds).
  const contact = (key: string, label: string, slot: string) => ({ key, label, required: true, from: 'builder', kind: 'contact', type: 'text', todo: `your ${slot}` });
  const form = await grant('cb', 'Contact Grants', [contact('full_name', 'Full name', 'name'), contact('email', 'Email', 'email'), contact('telegram', 'Telegram username', 'Telegram')]);
  await only([sr.id, form.id]);
  const b = await owner('cb');
  await find(b);
  // The yes asks the contact item once for both programs: the grant's name, email and Telegram and a16z's email (3 answers).
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  const need = (yes.reply?.ready as { need: { asks: { kind: string; slots?: string[]; programs: string[] }[] } }).need;
  assert.deepEqual(need.asks.find((a) => a.kind === 'contact'), { kind: 'contact', ask: 'your contact details (name, email and Telegram)', programs: [sr.id, form.id], slots: ['email', 'name', 'telegram'] });
  // Only the email given: a16z opens, and the grant asks for the name and Telegram only.
  const some = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { contact: { email: 'jenil@example.com' } } });
  assert.ok(openIds(some).includes(sr.id), show(some));
  assert.match(show(some), /Contact needs your contact details \(name and Telegram\) first\./, show(some));
  assert.equal(JSON.parse((await bankOf(b.id)).contact).email, 'jenil@example.com');
  // A new builder state later (a fresh find on a new set): the banked email is pre-filled, never asked.
  const next = await owner('cb2', { contact: true });
  await only([sr.id]);
  const r = await find(next);
  assert.match(show(r), /\n1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Ready\.\n/, show(r));
  assert.equal((r.reply?.ready as { programs: { prefilled: Record<string, string> }[] }).programs[0].prefilled.email, 'jenil@example.com');
  assert.match(show(r), /\n\nEvery answer is filled from your commits/, show(r));
});

test('v4.10.1 (2), v4.10.2 (R8): an opted-in email and an owned Base contract are filled, never asked, in the set and in prepare', db, async () => {
  const sr = await copy('a16z-speedrun', 'a16z-em', { hours: 30 });
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id <> ${sr.id}`;
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('em', { contract: false });
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email, asked_at, opted_in_at) VALUES (${b.id}, '', 'jenil@example.com', now(), now())
    ON CONFLICT (installation_id, login) DO UPDATE SET email = EXCLUDED.email, opted_in_at = now(), unsubscribed_at = NULL`;
  const hex = (n: number) => `0x${(BigInt(b.id) * 1000n + BigInt(n)).toString(16).padStart(40, '0')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${hex(1)}, ${b.id})`;
  await sql()`INSERT INTO wallet_contracts (chain, address, wallet, created_at, counts) VALUES
    ('base', ${hex(2)}, ${hex(1)}, now() - interval '2 days', true), ('ethereum', ${hex(3)}, ${hex(1)}, now(), true)`;
  const r = await find(b);
  const ready = r.reply?.ready as { programs: { id: string; prefilled: Record<string, string>; asks: unknown[] }[]; also_open: { id: string; answers: number }[] };
  const a16z = ready.programs.find((p) => p.id === sr.id)!;
  assert.equal(a16z.prefilled.email, 'jenil@example.com');
  assert.deepEqual(a16z.asks, []);
  assert.match(show(r), /\n1\. a16z speedrun SR008: up to \$1M, an accelerator, closes in \d+ hours\. Ready\.\n/, show(r));
  // Base owes 7 (name, Telegram, revenue, the plan, its Builder Code, the challenge, the credits): the email and the
  // contract are held, so never counted.
  assert.deepEqual(ready.also_open.map((p) => [p.id, p.answers]), [['base-builder-grants', 7]]);
  // R8: prepare agrees: the held email and the Base contract (not the newer one on another chain) are in its kit, and
  // never one "you add".
  const prep = await mcpCall(b.ctx as never, 'prepare', { program_id: 'base-builder-grants', project: { name: 'EarnKit', repo_url: `https://github.com/${b.key}` }, answers: { project_name_description: 'EarnKit: grants for builders' } });
  const fields = (prep.reply?.draft as { fields: { key: string; answer: string; missing?: boolean }[] }).fields;
  const value = (k: string) => fields.find((f) => f.key === k && !f.missing)?.answer;
  assert.deepEqual([value('email'), value('contract_address'), value('x_handle')], ['jenil@example.com', hex(2), b.handle], JSON.stringify(fields));
  assert.equal(value('founding_team'), 'Jenil, solo founder');
});

test('v4.10.1 fix round 1 (I2): one unsplit reply never gives Base\'s revenue, plan, challenge and credits the same text', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('fb', { fits: true });
  const opener = show(await find(b));
  assert.match(opener, /Needs how it makes money today, your 3-month plan in one line, your main challenge right now and the credits you want first\./, opener);
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  const r = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', blanks: 'no revenue yet, user acquisition, Privy' });
  // Nothing filled: the same four are asked again, for the agent's split.
  assert.deepEqual(asksOf(r), ['other:revenue', 'other:gtm_plan', 'other:primary_challenge', 'other:credits']);
  assert.deepEqual(openIds(r), []);
  const given = ((await seenOf(b.id)).ready as { given: Record<string, Record<string, string>> }).given['base-builder-grants'] ?? {};
  assert.deepEqual(given, {});
  // Split, each its own answer.
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { 'other:revenue': 'No revenue yet', 'other:gtm_plan': 'Builder posts on X', 'other:primary_challenge': 'User acquisition', 'other:credits': 'Privy' } });
  const split = ((await seenOf(b.id)).ready as { given: Record<string, Record<string, string>> }).given['base-builder-grants'];
  assert.deepEqual(split, { revenue: 'No revenue yet', gtm_plan: 'Builder posts on X', primary_challenge: 'User acquisition', credits: 'Privy' });
});

test('v4.10.1 fix round 1: with no owned Base contract, Base needs its contract address, never "Ready"', db, async () => {
  // v4.10.2 Task 1: a grant needing nothing keeps a set, so Base's count shows ("also open").
  const open = await grant('nc-open', 'Open Grants', []);
  await only(['base-builder-grants', open.id]);
  const b = await owner('nc', { fits: true, contract: false });
  const r = await find(b);
  // Its 4 own answers and the contract address: 5, past one reply.
  assert.deepEqual((r.reply?.ready as { also_open: { id: string; answers: number }[] }).also_open.map((p) => [p.id, p.answers]), [['base-builder-grants', 5]]);
  assert.match(show(r), /Also open: Base Builder Grant, up to \$5,000, needs 5 answers from you\./, show(r));
  // Held (an owned contract): never asked, and Base's 4 are the set's.
  const held = await owner('hc', { fits: true });
  const h = ((await find(held)).reply?.ready as { programs: { id: string; asks: { kind: string }[]; prefilled: Record<string, string> }[] }).programs.find((p) => p.id === 'base-builder-grants')!;
  assert.match(h.prefilled.contract_address, /^0x[0-9a-f]{40}$/);
  assert.ok(!h.asks.some((a) => a.kind === 'other:contract_address'));
});

test('v4.10.1 final fix 2 (I1): a ready opener while the score is updating has no updating line; the agent still states no number', db, async () => {
  await ownerPrograms();
  const b = await owner('upd');
  // A refresh still running past find's wait: every reader call waits for open(), then fails.
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const calls: string[] = [];
  const wait = async (what?: unknown): Promise<never> => {
    calls.push(String(what));
    await gate;
    throw new Error('v410: not served');
  };
  const reader = { now: new Date(), gh: wait, ghGraphql: wait, ghFetch: wait, probe: wait, fetchText: wait, json: wait, contractOrigin: wait, walletCreations: wait };
  (b.ctx as { readerDeps?: unknown }).readerDeps = reader;
  // The setup find's own refresh settles first (a later call would join it).
  await startRefresh(b.id, { now: new Date(), start: Date.now() }).within();
  await sql()`UPDATE builder_live SET read_at = now() - interval '1 hour', computed_at = now() - interval '1 hour' WHERE builder_id = ${b.id}`;
  await sql()`UPDATE source_live SET read_at = now() - interval '1 hour' WHERE source_id IN (SELECT id FROM builder_sources WHERE builder_id = ${b.id})`;
  const opener = await find(b);
  open();
  assert.ok(calls.length > 0, 'the refresh asked the reader (it is still waiting)');
  assert.equal(moveUp(opener)?.kind, 'ready', show(opener));
  assert.equal(opener.reply?.numbers_updating, true, 'the refresh is still running');
  assert.equal(opener.reply?.numbers_note, UPDATING_NOTE);
  assert.doesNotMatch(show(opener), /updating/, show(opener));
  assert.equal((await seenOf(b.id)).said && ((await seenOf(b.id)).said as { keys: string[] }).keys.includes(UPDATING_SAID), false, 'the line waits for a reply with numbers');
});

test('v4.10.1 final fix 2 (I2): an answer turn that leaves only Builder Codes says Base waits on them before the push ask', db, async () => {
  await ownerPrograms({ drafted: true });
  const b = await owner('ff2', { fits: true });
  await find(b);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(moveUp(yes)?.kind, 'ready', show(yes));
  // a16z and Circle opened on the yes; Base's 4 answers now leave only its codes.
  const answered = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: OWED });
  assert.equal(show(answered), `Base opens once Builder Codes are in your repo. ${PUSHED_ASK}`, show(answered));
  assert.doesNotMatch(show(answered), BAD);
});
