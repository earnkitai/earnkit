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
import { PUSHED_ASK, READY_CODES_NOT_YET, READY_SET, codesSettled } from './bench-find';
import { READY_ASK, READY_NOTE, READY_YES_NOTE } from './ready-copy';
import { converse, gateFailures } from './fixtures/converse';

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
 * only the field the agent drafts (DRAFTED), for a walk about the other two.
 */
async function ownerPrograms(o: { tagged?: boolean; drafted?: boolean } = {}) {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const sr = await copy('a16z-speedrun', 'a16z', { hours: 19.5 });
  const extra = { ...(o.tagged !== false && { tag: 'long shot' }), ...(o.drafted && { submission_requirements: DRAFTED }) };
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
 * false` leaves none.
 */
async function owner(tag: string, o: { bank?: boolean | 'team'; contact?: boolean; contract?: boolean; client?: string; hosted?: boolean } = {}) {
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
  if (o.contact) {
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
 * v4.10.1 Task 1: the owner's real set (team, demo, usage and money raised banked): Base names the contact item and its
 * main challenge, a16z the email its form opens with, Circle (its real file) its integrations, roadmap and milestones;
 * none is "Ready", and as Circle's fields wait for a second ask, "every other answer" is not said.
 */
/**
 * v4.10.1 Task 1: what the owner's set still owes once the bank holds the team, demo, usage and money raised: the
 * contact details (one item, by slot), Base's revenue, main challenge and credits, and Circle's integrations, roadmap
 * and milestones (each its own key). A walk answers them on its yes, so Base waits on its Builder Codes only.
 */
const OWED = {
  contact: { name: 'Jenil Thakker', email: 'jenil@example.com', telegram: '@jenilt' },
  'other:revenue': 'No revenue yet', 'other:primary_challenge': 'User acquisition', 'other:credits': 'Privy and AWS',
  'other:integrations': 'None yet; it settles in USDC on Base', 'other:roadmap': 'Q1: payouts on Arc', 'other:milestones': 'Milestone 1: Arc payouts live',
};
const yesAll = (b: B, m: Record<string, unknown> = {}) => tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: OWED, ...m });
/** v4.10.1 Task 1: a grant form's one field the agent drafts (Circle's business details), for copies with their own fields. */
const DRAFTED = committedProgram('circle-developer-grants').submission_requirements.filter((r: { key: string }) => r.key === 'business');
const OPENER = (handle: string) => new RegExp([
  "^Jenil, I've got 3 applications drafted for you, worth up to \\$1M, plus a \\$100K long shot:",
  '',
  '1\\. Base Builder Grant: up to \\$5,000\\. Needs your contact details \\(name, email and Telegram\\), how it makes money today, main challenge right now and 1 more first\\.',
  '2\\. a16z speedrun SR008: up to \\$1M investment, closes in (19|20) hours\\. Needs your email first\\.',
  "3\\. Circle Developer Grants: \\$5K to \\$100K\\. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first, and Circle looks for apps on Arc, so it's a long shot\\.",
  '',
  `I've filled what I can from your commits and your profile at earnkit\\.com/${handle}\\.`,
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
  assert.deepEqual(programs.map((p) => p.id), ['base-builder-grants', sr.id, circle.id]);
  // Final fix (M4): the record is sent once, never a copy per program.
  assert.ok(Array.isArray(ready.record) && ready.record.length > 0);
  for (const p of programs) {
    assert.ok(p.requirements.length > 0, p.id);
    assert.equal(p.record, undefined, p.id);
    assert.equal(typeof p.prefilled, 'object');
  }
  // What EarnKit holds is pre-filled: the banked team and the X handle.
  assert.equal(programs[0].prefilled.founding_team, 'Jenil, solo founder');
  assert.equal(programs[0].prefilled.x_handle, `@${b.handle}`);
  assert.equal(programs[0].link, 'https://forms.gle/urqjBJYJjR6Vqqre6');
  // v4.10.1 Task 1: what the agent would have to invent is asked, each field under its own key (the contact details as
  // one item, by slot); the X handle is held, so never asked.
  const asks = (ready.programs as unknown as { asks: { kind: string; key: string; slot?: string }[] }[]).map((p) => p.asks.map((a) => a.slot ? `${a.kind}.${a.slot}` : a.kind));
  assert.deepEqual(asks, [
    ['contact.name', 'contact.email', 'contact.telegram', 'other:revenue', 'other:primary_challenge', 'other:credits'],
    ['contact.email'],
    ['other:integrations', 'other:roadmap', 'other:milestones'],
  ]);
  assert.doesNotMatch(first.show, /\bready\b/i, first.show);
  const seen = await seenOf(b.id);
  assert.equal((seen.bench_ask as { kind: string }).kind, 'ready');
  assert.deepEqual((await readyOf(b.id))?.ids, ['base-builder-grants', sr.id, circle.id]);
  // Nothing is drafted before the yes (declined and drafted exclusions stay right).
  assert.equal(seen.apply_yes, undefined);
  // R1: never the opener again in the session. v4.10.1 Task 2 (5): each program by name, with its money, its hours left
  // under 48 and what it still needs; never "still ready" while the set needs anything.
  assert.match(again.show, new RegExp([
    "^Here's where your 3 applications stand:",
    '',
    '- Base: up to \\$5,000\\. Needs your contact details \\(name, email and Telegram\\), how it makes money today, main challenge right now and 1 more first\\.',
    '- a16z: up to \\$1M investment, closes in (19|20) hours\\. Needs your email first\\.',
    '- Circle: \\$5K to \\$100K\\. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first\\.',
    '',
    "Reply yes and I'll finish them\\.$",
  ].join('\\n')), again.show);
  assert.doesNotMatch(again.show, /still ready/);
  assert.equal(moveUp({ reply: again.reply } as R)?.kind, 'ready');
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), []);
});

test('yes: Base runs the gap stage, a16z and Circle open now (ready.open, the yes note); find opens Base once its code is in; "sent" tracks all three', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('ys');
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
  assert.deepEqual(yes.reply?.ready, { open: [{ id: sr.id, title: sr.title, link: 'https://speedrun.a16z.com/apply' }, { id: circle.id, title: circle.title, link: 'https://circle.questbook.app/' }] });
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
  await ownerPrograms();
  const b = await owner('gw');
  const replies = await converse(b.ctx as never, [
    { find: {} },
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'yes', answers: OWED } }, says: 'yes, Jenil Thakker, jenil@example.com, @jenilt, no revenue yet, user acquisition, Privy and AWS, none yet, payouts on Arc in Q1' },
    { tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } }, says: 'ok', before: () => pushCodes(b) },
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'sent' } }, says: 'sent' },
  ], { builderId: b.id });
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

test('skip 3 parks Circle and is a yes on the rest; 1, 2, 3 is a no; 4 is ignored', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('sk');
  await find(b);
  const r = await yesAll(b, { answer: 'skip', skip: [3] });
  assert.equal(show(r).split('\n\n').slice(0, 2).join('\n\n'), "Done, Circle is skipped. I'll finish Base and a16z now.\n\nAdding Builder Codes now, then I'll open Base.");
  assert.ok(show(r).endsWith(PUSHED_ASK), show(r));
  const seen = await seenOf(b.id);
  assert.ok((seen.declined as Record<string, string>)[`apply:${circle.id}`]);
  assert.ok((seen.declined as Record<string, string>)[`path:${circle.id}`]);
  assert.deepEqual(Object.keys(seen.apply_yes as object).sort(), ['base-builder-grants', sr.id].sort());
  assert.deepEqual((r.reply?.ready as { open: { id: string }[] }).open.map((p) => p.id), [sr.id]);

  const all = await owner('sa');
  await find(all);
  const no = await tell(all, { kind: 'ready', project_key: all.key, answer: 'skip', skip: [1, 2, 3] });
  assert.match(show(no), /^No problem, I'll set Base, a16z and Circle aside\./, show(no));
  assert.equal((await seenOf(all.id)).apply_yes, undefined);

  const out = await owner('s4');
  await find(out);
  const four = await yesAll(out, { answer: 'skip', skip: [4] });
  assert.match(show(four), /^Adding Builder Codes now, then I'll open Base\./, show(four));
  assert.deepEqual(Object.keys(((await seenOf(out.id)).declined as object | undefined) ?? {}), []);
});

test('no parks all three for 30 days; the next session never opens the same set', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('no');
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
  const { sr, circle } = await ownerPrograms();
  const b = await owner('si');
  await find(b);
  await yesAll(b);
  const sent = await tell(b, { kind: 'ready', project_key: b.key, answer: 'sent', sent_ids: [sr.id] });
  assert.match(show(sent), /^Nice, I'm tracking it\./, show(sent));
  const applied = await sql()<{ program_id: string }[]>`SELECT program_id FROM builder_program_status WHERE installation_id = ${b.id} AND status = 'applied'`;
  assert.deepEqual(applied.map((x) => x.program_id), [sr.id]);
  assert.deepEqual((await readyOf(b.id))?.opened, [circle.id]);
});

test('readySet through the real path: declined, applied and drafted within 30 days are left out (decision e)', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const ids = async (b: B) => ((((await find(b)).reply?.ready as { programs: { id: string }[] } | undefined)?.programs) ?? []).map((p) => p.id);
  const d = await owner('xd');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('declined', jsonb_build_object(${`apply:${circle.id}`}::text, now()::text)) WHERE builder_id = ${d.id}`;
  assert.deepEqual(await ids(d), ['base-builder-grants', sr.id]);
  const a = await owner('xa');
  await mcpCall(a.ctx as never, 'tell', { program_status: [{ program_id: sr.id, status: 'applied' }] });
  await newSession(a.id);
  assert.deepEqual(await ids(a), ['base-builder-grants', circle.id]);
  const y = await owner('xy');
  await sql()`UPDATE builder_profiles SET standing_seen = standing_seen || jsonb_build_object('apply_yes', jsonb_build_object('base-builder-grants', now()::text)) WHERE builder_id = ${y.id}`;
  assert.deepEqual(await ids(y), [sr.id, circle.id]);
  // A draft older than 30 days is no exclusion.
  const old = await owner('xo');
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
  const a16zLine = (txt: string) => txt.split('\n').find((l) => l.startsWith('2. a16z'));
  const none = await owner('hn', { bank: false });
  // v4.10.1 Task 1 (R2): the email its form opens with is the builder's too, named first.
  assert.match(a16zLine(show(await find(none)))!, /^2\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Needs your email, team list and any money you've raised first\.$/);
  const yes = await tell(none, { kind: 'ready', project_key: none.key, answer: 'yes' });
  assert.ok(!(yes.reply?.ready as { open: { id: string }[] }).open.some((p) => p.id === sr.id), show(yes));
  assert.doesNotMatch(show(yes), /a16z: https/, show(yes));
  const team = await owner('ht', { bank: 'team', contact: true });
  assert.match(a16zLine(show(await find(team)))!, /^2\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Needs any money you've raised first\.$/);
  const both = await owner('hb', { contact: true });
  assert.match(a16zLine(show(await find(both)))!, /^2\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Ready\.$/);
});

test('fix 1 (H1): the brief\'s answer is banked as team and raised and opens a16z, never asked again', db, async () => {
  const sr = await copy('a16z-speedrun', 'a16z-only', { hours: 30 });
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id <> ${sr.id}`;
  await only([sr.id]);
  const b = await owner('hq', { bank: false });
  assert.match(show(await find(b)), /\n1\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Needs your email, team list and any money you've raised first\.\n/);
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
  await ownerPrograms();
  const b = await owner('ip');
  b.gh.repos[b.key].files = { 'src/app.ts': 'export const x = 1;' };
  (b.ctx as { codesFetch?: typeof fetch }).codesFetch = b.gh;
  await find(b);
  await yesAll(b);
  const first = await find(b);
  assert.equal(show(first), `${READY_CODES_NOT_YET}\n\n${PUSHED_ASK}`);
  const parked = await find(b);
  assert.match(show(parked), /^I'll keep Base Builder Grant for when it's done\.\n\nYour 2 applications are open with every answer in place:\n- a16z: up to \$1M investment, closes in (19|20) hours\.\n- Circle: \$5K to \$100K\.\n\nReply "sent" once they're in, and I'll track them for you\.$/, show(parked));
  assert.equal(moveUp(parked)?.kind, 'ready');
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  assert.ok(declined['path:base-builder-grants'] && declined['apply:base-builder-grants']);
  const r = await readyOf(b.id);
  assert.deepEqual([r?.waiting, (r as { codes?: string[] })?.codes], [[], []]);
  assert.ok(r?.skipped.includes('base-builder-grants'));

  const no = await owner('in');
  await find(no);
  const yes = await yesAll(no);
  assert.equal(moveUp(yes)?.kind, 'qualify');
  const said = await tell(no, { kind: 'qualify', project_key: no.key, answer: 'no' });
  assert.match(show(said), /^No problem, I'll set Base Builder Grant aside\.\n\nYour 2 applications are open with every answer in place:\n- a16z: up to \$1M investment, closes in (19|20) hours\.\n- Circle: \$5K to \$100K\.\n\nReply "sent" once they're in, and I'll track them for you\.$/, show(said));
  assert.equal(moveUp(said)?.kind, 'ready');
  // Fix 1 (M2): "sent" right after the yes (kind qualify, Base's codes pending) still tracks the open pages.
  const early = await owner('ie');
  await find(early);
  await yesAll(early);
  assert.match(show(await tell(early, { kind: 'qualify', project_key: early.key, answer: 'sent' })), /^Nice, I'm tracking them\./);
  // ... and never for another project's key.
  const other = await owner('io');
  await find(other);
  await yesAll(other);
  assert.equal(show(await tell(other, { kind: 'qualify', project_key: 'someone/else', answer: 'sent' })), 'Okay.');
});

test('fix 1 (M6): "skip 1 3" keeps a16z; "skip 2" on a 2-program set keeps Base', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('m13');
  await find(b);
  const r = await yesAll(b, { answer: 'skip', skip: [1, 3] });
  assert.ok(show(r).startsWith("Done, Base and Circle are skipped. I'll finish a16z now.\n\nIt is open with every answer in place:\n- a16z: https://speedrun.a16z.com/apply"), show(r));
  const declined = (await seenOf(b.id)).declined as Record<string, string>;
  assert.ok(declined['apply:base-builder-grants'] && declined[`apply:${circle.id}`] && !declined[`apply:${sr.id}`]);
  await only([sr.id, 'base-builder-grants']);
  const two = await owner('m2');
  assert.match(show(await find(two)), /I've got 2 applications drafted for you/);
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

test('final fix (I1): the opener names each program\'s needs; the yes asks for them once, at most 4; one split answer finishes them', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('i1', { bank: false });
  const opener = await find(b);
  const lines = show(opener).split('\n');
  // Base's real form: the contact item, then the team, usage and demo, then 4 more; a16z's brief: the email, team, raised.
  assert.ok(lines.includes('1. Base Builder Grant: up to $5,000. Needs your contact details (name, email and Telegram), team list, usage numbers and 4 more first.'), show(opener));
  assert.ok(lines.some((l) => /^2\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Needs your email, team list and any money you've raised first\.$/.test(l)), show(opener));
  // v4.10.1 Task 1: more is owed than one ask holds, so never "every other answer is filled".
  assert.ok(lines.some((l) => l.startsWith("I've filled what I can from your commits")), show(opener));
  assert.doesNotMatch(show(opener), /Every (?:other )?answer/, show(opener));
  const asks = (opener.reply?.ready as { programs: { id: string; asks: { kind: string }[] }[] }).programs.map((p) => [p.id, p.asks.map((a) => a.kind)]);
  assert.deepEqual(asks, [
    ['base-builder-grants', ['contact', 'contact', 'contact', 'team', 'traction', 'demo_video', 'other:revenue', 'other:primary_challenge', 'other:credits']],
    [sr.id, ['contact', 'team', 'raised']],
    [circle.id, ['other:integrations', 'other:roadmap', 'other:milestones']],
  ]);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  // One ask for the set, in the yes itself: a16z closes first, so its fields lead; past 4, the rest are named for next.
  assert.equal(show(yes), [
    "Adding Builder Codes now, then I'll open Base.",
    '',
    "Base also needs your usage numbers, demo video, how it makes money today and 2 more. I'll ask for them next. Circle also needs your Circle and Arc integrations, product roadmap and proposed grant milestones. I'll ask for them next.",
    '',
    "a16z needs your email, team list and any money you've raised first. Reply with them and I'll finish it.",
  ].join('\n'), show(yes));
  assert.equal(moveUp(yes)?.kind, 'ready');
  assert.deepEqual(asksOf(yes), ['contact', 'team', 'raised']);
  assert.deepEqual((yes.reply?.ready as { need: { asks: { kind: string; slots?: string[] }[] } }).need.asks[0].slots, ['email']);
  // The push is the agent's work: its note says so; the builder's ask is stored.
  assert.match(noteOf(yes), /commit and push it .* and call find/);
  assert.equal(((await seenOf(b.id)).bench_ask as { kind: string; need?: boolean }).need, true);
  // One reply, split by the agent: a16z opens; the email is banked by slot, so Base never asks for it again.
  const answered = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { contact: { email: 'jenil@example.com' }, team: 'Just me, Jenil', raised: 'Nothing raised yet' } });
  assert.equal(show(answered), [
    '1 of 3 is open with every answer in place:',
    '- a16z: https://speedrun.a16z.com/apply',
    '',
    "Base also needs your main challenge right now and the credits you want. I'll ask for them next. Circle also needs your Circle and Arc integrations, product roadmap and proposed grant milestones. I'll ask for them next.",
    '',
    "Base needs your contact details (name and Telegram), usage numbers, demo video and how it makes money today first. Reply with them and I'll finish it.",
  ].join('\n'), show(answered));
  assert.deepEqual(openIds(answered), [sr.id]);
  assert.deepEqual(asksOf(answered), ['contact', 'traction', 'demo_video', 'other:revenue']);
  assert.deepEqual(await bankOf(b.id), { contact: JSON.stringify({ email: 'jenil@example.com' }), team: 'Just me, Jenil', raised: 'Nothing raised yet' });
});

test('final fix (I1): answers on the first yes finish every program in one turn; the gate passes the walk', db, async () => {
  await ownerPrograms({ drafted: true });
  const b = await owner('i1y', { bank: false });
  // v4.10.1 Task 1: everything the set owes, in one reply (8 answers, the most one tell takes).
  const answers = { ...ALL_FOUR, contact: OWED.contact, 'other:revenue': 'No revenue yet', 'other:primary_challenge': 'User acquisition', 'other:credits': 'Privy and AWS' };
  const replies = await converse(b.ctx as never, [
    { find: {} },
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'yes', answers } }, says: "yes, just me, nothing raised, 120 transactions, demo at loom.com/share/earnkit, Jenil Thakker, jenil@example.com, @jenilt, no revenue yet, user acquisition, Privy and AWS" },
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
  const { contact, ...kinds } = await bankOf(b.id);
  assert.deepEqual([kinds, JSON.parse(contact)], [ALL_FOUR, { name: 'Jenil Thakker', email: 'jenil@example.com', telegram: '@jenilt' }]);
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

test('final fix (I1, I3): past 4 fields a program waits, named; a no parks the asked one and the waiting one is asked next', db, async () => {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const alpha = await grant('alpha', 'Alpha Grants', [field('founding_team', 'team'), field('pitch_video', 'demo_video', 'url'), field('team_location', 'other', 'text', 'team location')], 30);
  const beta = await grant('beta', 'Beta Grants', [field('usage_numbers', 'traction'), { ...field('consent_terms', 'other', 'choice', 'consent to the terms'), options: ['Yes', 'No'] }, field('requested_amount_usd', 'other', 'text', 'requested amount')]);
  await only([alpha.id, beta.id]);
  const b = await owner('cap', { bank: false });
  const opener = show(await find(b));
  assert.match(opener, /\n1\. Alpha Grants: \$5K to \$100K\. Needs your team list, demo video and team location first\.\n2\. Beta Grants: \$5K to \$100K\. Needs your usage numbers, consent to the terms and requested amount first\.\n/, opener);
  // v4.10.1 Task 1: Beta waits for a second ask, so never "every other answer".
  assert.match(opener, /\n\nI've filled what I can from your commits/, opener);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(show(yes), [
    'Beta also needs your usage numbers, consent to the terms and requested amount. I\'ll ask for them next.',
    '',
    "Alpha needs your team list, demo video and team location first. Reply with them and I'll finish it.",
  ].join('\n'), show(yes));
  assert.deepEqual(asksOf(yes), ['team', 'demo_video', 'other:team_location']);
  const no = await tell(b, { kind: 'ready', project_key: b.key, answer: 'no' });
  assert.equal(show(no), "No problem, I'll set Alpha aside.\n\nBeta needs your usage numbers, consent to the terms and requested amount first. Reply with them and I'll finish it.", show(no));
  assert.equal(moveUp(no)?.kind, 'ready');
  assert.ok(((await seenOf(b.id)).declined as Record<string, string>)[`apply:${alpha.id}`]);
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
  const b = await owner('i5', { bank: true });
  await find(b);
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  // The agent pushes and calls find (GAP_DO_NOTE): the codes are in, but Base still needs the builder's answers.
  pushCodes(b);
  const after = await find(b);
  assert.deepEqual(openIds(after), []);
  assert.match(show(after), /^a16z and Base need your contact details \(name, email and Telegram\), how it makes money today, main challenge right now and the credits you want first\. Reply with them and I'll finish them\.$/, show(after));
  const r = (await readyOf(b.id))!;
  assert.deepEqual([r.waiting.includes('base-builder-grants'), (r as { codes?: string[] }).codes], [true, []]);
  const done = await yesAll(b);
  assert.ok(show(done).startsWith('All three are open with every answer in place:'), show(done));
});

test('final fix (M8): a hosted agent\'s yes never says "I\'ll do it": the codes ask first, then the set\'s one ask', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const h = await owner('hy', { hosted: true });
  // v4.10.1 Task 1: Base names what it owes first (the hosted codes line itself: v410-ready.test.ts).
  assert.doesNotMatch(show(await find(h)), /I'll do it/);
  const yes = await yesAll(h);
  assert.doesNotMatch(show(yes), /I'll do it|Adding Builder Codes now/, show(yes));
  assert.match(show(yes), /^2 of 3 are open with every answer in place:\n- a16z: https:\/\/speedrun\.a16z\.com\/apply\n- Circle: https:\/\/circle\.questbook\.app\/\n\n/, show(yes));
  assert.ok(show(yes).endsWith(HELP_DONE_ASK), show(yes));
  assert.deepEqual(openIds(yes), [sr.id, circle.id]);
  assert.equal(moveUp(yes)?.kind, 'qualify');
  // With answers owed, the hosted yes still asks for the codes first; once they are found, the one ask follows.
  const owes = await owner('hn2', { hosted: true, bank: false });
  await find(owes);
  const y2 = await tell(owes, { kind: 'ready', project_key: owes.key, answer: 'yes' });
  assert.ok(show(y2).endsWith(HELP_DONE_ASK), show(y2));
  assert.doesNotMatch(show(y2), /Reply with them/, show(y2));
  pushCodes(owes);
  const ok = await tell(owes, { kind: 'qualify', project_key: owes.key, answer: 'yes' });
  assert.match(show(ok), /a16z needs your email, team list and any money you've raised first\. Reply with them and I'll finish it\.$/, show(ok));
});

test('final fix (M7, M3): a ready ask whose set expired is dropped, never "Okay."; "skip 1 2 3 4" is taken', db, async () => {
  await ownerPrograms();
  const b = await owner('m7');
  await find(b);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{ready,at}', to_jsonb(${new Date(Date.now() - 31 * 86_400_000).toISOString()}::text)) WHERE builder_id = ${b.id}`;
  const r = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.notEqual(show(r), 'Okay.');
  assert.notEqual(((await seenOf(b.id)).bench_ask as { kind?: string } | undefined)?.kind, 'ready');
  const s = await owner('m3');
  await find(s);
  const all = await tell(s, { kind: 'ready', project_key: s.key, answer: 'skip', skip: [1, 2, 3, 4] });
  assert.match(show(all), /^No problem, I'll set Base, a16z and Circle aside\./, show(all));
  // The yes refreshes the set's time (M7), so a set answered late doesn't expire the next day.
  const y = await owner('m7y');
  await find(y);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{ready,at}', to_jsonb(${new Date(Date.now() - 29 * 86_400_000).toISOString()}::text)) WHERE builder_id = ${y.id}`;
  await tell(y, { kind: 'ready', project_key: y.key, answer: 'yes' });
  assert.ok(Date.now() - Date.parse(((await seenOf(y.id)).ready as { at: string }).at) < 60_000);
});

test('final fix (I2): untagged Circle on a project not on Arc is a long shot, last; every "Ready." agrees with the programs table', db, async () => {
  const { circle } = await ownerPrograms({ tagged: false });
  const b = await owner('i2');
  const replies = await converse(b.ctx as never, [{ find: {} }, { says: 'what can I apply to', find: { ask: 'programs' } }], { builderId: b.id });
  const [opener, table] = replies.map((r) => r.show);
  const lines = opener.split('\n').filter((l) => /^\d\. /.test(l));
  // v4.10.1 Task 1: its real form asks what the agent would invent, so it needs them, never "Ready".
  assert.equal(lines.at(-1), "3. Circle Developer Grants: $5K to $100K. Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first, and Circle looks for apps on Arc, so it's a long shot.", opener);
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
  assert.ok(lines.some((l) => /Base Builder Grant: .*Needs your contact details/.test(l)) && cell('Base Builder Grant'), table);
});

// ---------------------------------------------------------------------------------------------------------------------
// v4.10.1 Task 1: honest needs. What the agent would have to invent is asked; what EarnKit holds is filled.

test('v4.10.1 (1): Circle\'s real form reads "Needs" with its fields, never "Ready"; its roadmap and milestones take distinct answers', db, async () => {
  const { circle } = await ownerPrograms();
  const b = await owner('c1', { contact: true });
  const opener = await find(b);
  const line = show(opener).split('\n').find((l) => l.startsWith('3. Circle'))!;
  assert.match(line, /Needs your Circle and Arc integrations, product roadmap and proposed grant milestones first/, show(opener));
  assert.doesNotMatch(line, /Ready/);
  // The contact details are banked and the bank holds the rest, so a16z is ready and Base owes its three own answers.
  assert.match(show(opener), /\n2\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Ready\.\n/, show(opener));
  assert.match(show(opener), /\n1\. Base Builder Grant: up to \$5,000\. Needs how it makes money today, your main challenge right now and the credits you want first\.\n/, show(opener));
  // Base's 3 and Circle's 3 are past one ask of 4, so never "every other answer".
  assert.match(show(opener), /\n\nI've filled what I can from your commits/, show(opener));
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
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('cb');
  await find(b);
  // The yes asks the contact item once for both programs: Base's name, email and Telegram and a16z's email.
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  const need = (yes.reply?.ready as { need: { asks: { kind: string; slots?: string[]; programs: string[] }[] } }).need;
  assert.deepEqual(need.asks.find((a) => a.kind === 'contact'), { kind: 'contact', ask: 'your contact details (name, email and Telegram)', programs: [sr.id, 'base-builder-grants'], slots: ['email', 'name', 'telegram'] });
  // Only the email given: a16z opens, and Base asks for the name and Telegram only.
  const some = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { contact: { email: 'jenil@example.com' } } });
  assert.ok(openIds(some).includes(sr.id), show(some));
  assert.match(show(some), /Base needs your contact details \(name and Telegram\), how it makes money today, main challenge right now and the credits you want first\./, show(some));
  assert.equal(JSON.parse((await bankOf(b.id)).contact).email, 'jenil@example.com');
  // A new builder state later (a fresh find on a new set): the banked email is pre-filled, never asked.
  const next = await owner('cb2', { contact: true });
  await only([sr.id]);
  const r = await find(next);
  assert.match(show(r), /\n1\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Ready\.\n/, show(r));
  assert.equal((r.reply?.ready as { programs: { prefilled: Record<string, string> }[] }).programs[0].prefilled.email, 'jenil@example.com');
  // One ask covers everything, so it is "every answer".
  assert.match(show(r), /\n\nEvery answer is filled from your commits/, show(r));
});

test('v4.10.1 (2): an opted-in email and an owned Base contract are filled, never asked', db, async () => {
  const sr = await copy('a16z-speedrun', 'a16z-em', { hours: 30 });
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id <> ${sr.id}`;
  await only([sr.id, 'base-builder-grants']);
  const b = await owner('em');
  await sql()`INSERT INTO digest_subscriptions (installation_id, login, email, asked_at, opted_in_at) VALUES (${b.id}, '', 'jenil@example.com', now(), now())
    ON CONFLICT (installation_id, login) DO UPDATE SET email = EXCLUDED.email, opted_in_at = now(), unsubscribed_at = NULL`;
  const hex = (n: number) => `0x${(BigInt(b.id) * 1000n + BigInt(n)).toString(16).padStart(40, '0')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${hex(1)}, ${b.id})`;
  await sql()`INSERT INTO wallet_contracts (chain, address, wallet, created_at, counts) VALUES
    ('base', ${hex(2)}, ${hex(1)}, now() - interval '2 days', true), ('ethereum', ${hex(3)}, ${hex(1)}, now(), true)`;
  const r = await find(b);
  const programs = (r.reply?.ready as { programs: { id: string; prefilled: Record<string, string>; asks: { kind: string; slot?: string }[] }[] }).programs;
  const base = programs.find((p) => p.id === 'base-builder-grants')!;
  const a16z = programs.find((p) => p.id === sr.id)!;
  assert.equal(a16z.prefilled.email, 'jenil@example.com');
  assert.deepEqual(a16z.asks, []);
  assert.equal(base.prefilled.email, 'jenil@example.com');
  // The Base contract, not the newer one on another chain.
  assert.equal(base.prefilled.contract_address, hex(2));
  assert.deepEqual(base.asks.filter((a) => a.kind === 'contact').map((a) => a.slot), ['name', 'telegram']);
  assert.match(show(r), /\n2\. a16z speedrun SR008: up to \$1M investment, closes in \d+ hours\. Ready\.\n/, show(r));
  assert.match(show(r), /Base Builder Grant: up to \$5,000\. Needs your contact details \(name and Telegram\), how it makes money today/, show(r));
  // Base's 4 fit the one ask, so "every other answer" is true here.
  assert.match(show(r), /\n\nEvery other answer is filled from your commits/, show(r));
});

test('v4.10.1 fix round 1 (I2): one unsplit reply never gives Base\'s revenue, challenge and credits the same text', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('fb', { contact: true });
  const opener = show(await find(b));
  assert.match(opener, /Needs how it makes money today, your main challenge right now and the credits you want first\./, opener);
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  const r = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', blanks: 'no revenue yet, user acquisition, Privy' });
  // Nothing filled: the same three are asked again, for the agent's split.
  assert.deepEqual(asksOf(r), ['other:revenue', 'other:primary_challenge', 'other:credits']);
  assert.deepEqual(openIds(r), []);
  const given = ((await seenOf(b.id)).ready as { given: Record<string, Record<string, string>> }).given['base-builder-grants'] ?? {};
  assert.deepEqual(given, {});
  // Split, each its own answer.
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes', answers: { 'other:revenue': 'No revenue yet', 'other:primary_challenge': 'User acquisition', 'other:credits': 'Privy' } });
  const split = ((await seenOf(b.id)).ready as { given: Record<string, Record<string, string>> }).given['base-builder-grants'];
  assert.deepEqual(split, { revenue: 'No revenue yet', primary_challenge: 'User acquisition', credits: 'Privy' });
});

test('v4.10.1 fix round 1: with no owned Base contract, Base needs its contract address, never "Ready"', db, async () => {
  await only(['base-builder-grants']);
  const b = await owner('nc', { contact: true, contract: false });
  const r = await find(b);
  const base = (r.reply?.ready as { programs: { asks: { kind: string }[]; prefilled: Record<string, string> }[] }).programs[0];
  assert.equal(base.prefilled.contract_address, undefined);
  assert.ok(base.asks.some((a) => a.kind === 'other:contract_address'), JSON.stringify(base.asks));
  assert.match(show(r), /Needs your contract address on Base, how it makes money today, main challenge right now and 1 more first\./, show(r));
  // Held (an owned contract): never asked.
  const held = await owner('hc', { contact: true });
  const h = (( await find(held)).reply?.ready as { programs: { asks: { kind: string }[]; prefilled: Record<string, string> }[] }).programs[0];
  assert.match(h.prefilled.contract_address, /^0x[0-9a-f]{40}$/);
  assert.ok(!h.asks.some((a) => a.kind === 'other:contract_address'));
});
