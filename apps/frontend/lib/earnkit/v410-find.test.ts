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
import { MENTOR_NOTE, SESSION_MS } from './conversation';
import { PUSHED_ASK, codesSettled } from './bench-find';
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
/** The owner's three: a16z speedrun closing in 19 hours, Circle a long shot (tag), Base's grant; nothing else open. */
async function ownerPrograms() {
  await sql()`UPDATE programs SET status = 'closed' WHERE investment AND id NOT LIKE ${`v410-${process.pid}-%`}`;
  const sr = await copy('a16z-speedrun', 'a16z', { hours: 19.5 });
  const circle = await copy('circle-developer-grants', 'circle', { extra: { tag: 'long shot' } });
  await only([sr.id, circle.id, 'base-builder-grants']);
  return { sr, circle };
}

let n = 0;
/**
 * The owner-like builder (v48-conversation.test.ts owner): X name "Jenil T", EarnKit's repo proven by the App, live and
 * on Base, six weeks shipping, setup step 3 done; a fresh session (the setup find's said moved back). `bank`: the
 * founding team, a demo and usage numbers held, so Base waits on its Builder Codes only.
 */
async function owner(tag: string, o: { bank?: boolean; client?: string } = {}) {
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
  if (o.bank !== false) {
    const base = (await getProgramRow('base-builder-grants'))!;
    await saveBank(c.id, `github.com/${key}`.toLowerCase(), 'base-builder-grants', base.submission_requirements, {
      founding_team: 'Jenil, solo founder', demo_loom: 'https://loom.com/share/earnkit', usage_numbers: '120 transactions',
    });
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
const OPENER = (handle: string) => new RegExp([
  "^Jenil, I've got 3 applications ready for you, worth up to \\$1\\.1M:",
  '',
  "1\\. Base Builder Grant: up to \\$5,000\\. Ready once I add Builder Codes \\(10 minutes, I'll do it\\)\\.",
  '2\\. a16z speedrun SR008: up to \\$1M investment, closes in (19|20) hours\\. Ready\\.',
  "3\\. Circle Developer Grants: \\$5K to \\$100K\\. Ready, but Circle looks for apps on Arc, so it's a long shot\\.",
  '',
  `Every answer is filled from your commits and your profile at earnkit\\.com/${handle}\\.`,
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
  const programs = (first.reply?.ready as { programs: { id: string; link: string; requirements: { key: string }[]; prefilled: Record<string, string>; record: string[] }[] }).programs;
  assert.deepEqual(programs.map((p) => p.id), ['base-builder-grants', sr.id, circle.id]);
  for (const p of programs) {
    assert.ok(p.requirements.length > 0, p.id);
    assert.ok(Array.isArray(p.record) && p.record.length > 0, p.id);
    assert.equal(typeof p.prefilled, 'object');
  }
  // What EarnKit holds is pre-filled: the banked team and the X handle.
  assert.equal(programs[0].prefilled.founding_team, 'Jenil, solo founder');
  assert.equal(programs[0].prefilled.x_handle, `@${b.handle}`);
  assert.equal(programs[0].link, 'https://forms.gle/urqjBJYJjR6Vqqre6');
  const seen = await seenOf(b.id);
  assert.equal((seen.bench_ask as { kind: string }).kind, 'ready');
  assert.deepEqual((await readyOf(b.id))?.ids, ['base-builder-grants', sr.id, circle.id]);
  // Nothing is drafted before the yes (declined and drafted exclusions stay right).
  assert.equal(seen.apply_yes, undefined);
  // R1: never the opener again in the session.
  assert.equal(again.show, "Your 3 applications are still ready. Reply yes and I'll finish them.");
  assert.equal(moveUp({ reply: again.reply } as R)?.kind, 'ready');
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), []);
});

test('yes: Base runs the gap stage, a16z and Circle open now (ready.open, the yes note); find opens Base once its code is in; "sent" tracks all three', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('ys');
  await find(b);
  const yes = await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
  assert.equal(show(yes), [
    "Adding Builder Codes now, then I'll open all three.",
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
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'yes' } }, says: 'yes' },
    { tell: { move_up: { kind: 'qualify', project_key: b.key, answer: 'yes' } }, says: 'ok', before: () => pushCodes(b) },
    { tell: { move_up: { kind: 'ready', project_key: b.key, answer: 'sent' } }, says: 'sent' },
  ], { builderId: b.id });
  assert.deepEqual(gateFailures(replies, { names: ['EarnKit', b.handle] }), [], replies.map((r) => r.show).join('\n---\n'));
});

test('skip 3 parks Circle and is a yes on the rest; 1, 2, 3 is a no; 4 is ignored', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('sk');
  await find(b);
  const r = await tell(b, { kind: 'ready', project_key: b.key, answer: 'skip', skip: [3] });
  assert.equal(show(r).split('\n\n').slice(0, 2).join('\n\n'), "Done, Circle is skipped. I'll finish Base and a16z now.\n\nAdding Builder Codes now, then I'll open both.");
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
  const four = await tell(out, { kind: 'ready', project_key: out.key, answer: 'skip', skip: [4] });
  assert.match(show(four), /^Adding Builder Codes now, then I'll open all three\./, show(four));
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
  assert.doesNotMatch(show(next), /applications? ready for you/, show(next));
  assert.notEqual(moveUp(next)?.kind, 'ready');
});

test('"sent" with sent_ids marks only those', db, async () => {
  const { sr, circle } = await ownerPrograms();
  const b = await owner('si');
  await find(b);
  await tell(b, { kind: 'ready', project_key: b.key, answer: 'yes' });
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
  assert.doesNotMatch(show(sh), /applications? ready for you/);
  assert.equal(sh.reply?.ready, undefined);
  assert.equal((await seenOf(shared.id)).ready, undefined);
  await only([]);
  const none = await owner('zero');
  const z = await find(none);
  assert.doesNotMatch(show(z), /applications? ready for you/);
  assert.notEqual(moveUp(z)?.kind, 'ready');
  assert.equal((await seenOf(none.id)).ready, undefined);
});

test('a builder-only field: its line says so, the answer is banked by kind and opens it, and the next program asking for it is pre-filled', db, async () => {
  const team = { key: 'founding_team', label: 'Tell us about the founding team', required: true, from: 'builder', kind: 'team', type: 'text', todo: 'a note on the founding team' };
  const reqs = [...committedProgram('circle-developer-grants').submission_requirements, team];
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
  assert.match(show(await find(b)), /^Your application is open with every answer in place\. Reply "sent" once it's in/);
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
