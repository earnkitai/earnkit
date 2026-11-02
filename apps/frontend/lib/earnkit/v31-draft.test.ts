import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { READY_ASK } from './ready-copy';
import { sql } from './db';
import { walletOffered } from './fixtures/wallet-step';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile, type SubmissionRequirement } from './program-file';
import { upsertProgram } from './programs';
import { profileData } from './bench-data';
import { BASE_GRANTS_ID, BUILDER_CODES_FIRST, builderCodesFound } from './builder-code';
import { DRAFT_FIRST_NOTE, DRAFT_NOTE, PAGE_IN_ANSWER, withPageLink } from './draft-application';
import { OPEN_PREFILLED, SENT_ASK, draftReadyLine } from './submit-kit';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/** v3.1 Task 9 (spec 3.2, D7, R12, R13, R15): "Apply with this page": prepare drafts the application, never submits. */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-draft-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
type Field = { key: string; label: string; answer: string; missing?: true };
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const firstLink = (s: string): string => links(s)[0] ?? '';
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const fieldsOf = (r: R) => ((r.reply?.draft as { fields: Field[] }).fields);
let n = 0;

/** A ranked builder (signed in with X, the repo proven by the App) the matcher fits for `programs`. */
async function builder(tag: string, programs: string[] = []) {
  n++;
  const t = `ek_v31d_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `vd${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `96${RUN}${n}${tag.length}`, username: handle, name: 'vd', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  // v4.0: setup step 3 answered (this test is about another reply).
  await walletOffered(c.id);
  const key = `vd${tag}${RUN}/kit`;
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
  const gid = 7000 + n * 10 + (Number(RUN) % 7);
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } }) });
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_projects SET link = 'https://kit.app' WHERE builder_id = ${c.id}`;
  return { ctx, id: c.id, key, handle, project: { name: 'Kit', repo_url: `https://github.com/${key}`, live_url: 'https://kit.app' } };
}
type B = Awaited<ReturnType<typeof builder>>;
const prepare = (b: B, args: Record<string, unknown>) => mcpCall(b.ctx, 'prepare', { project: b.project, ...args });

const BASE = committedProgram('base-builder-grants');
const BASE_REQS = BASE.submission_requirements as SubmissionRequirement[];
/** Base answers as an agent drafts them (links in full), never a personal detail. */
const baseAnswers = (): Record<string, string> => ({
  project_name_description: 'Kit: fans tip creators onchain in one tap',
  live_product_url: 'https://kit.app',
  demo_loom: 'https://www.loom.com/share/kit-demo',
  track: (BASE_REQS.find((r) => r.key === 'track')!.options ?? [])[0],
  usage_numbers: '120 transactions in 90 days',
  primary_challenge: 'User acquisition; Go-to-market strategy',
});

test('(a) the first call without answers returns the requirements and DRAFT_FIRST_NOTE, nothing shown', db, async () => {
  const b = await builder('a');
  const r = await prepare(b, { program_id: BASE_GRANTS_ID });
  assert.equal(r.isError, false, r.text);
  assert.equal(show(r), '');
  assert.equal(r.reply?.agent_note, DRAFT_FIRST_NOTE);
  const reqs = r.reply?.requirements as { key: string; from: string; options?: string[] }[];
  assert.deepEqual(reqs.map((x) => x.key), BASE_REQS.map((x) => x.key));
  assert.deepEqual(reqs.find((x) => x.key === 'primary_challenge')?.options, BASE_REQS.find((x) => x.key === 'primary_challenge')?.options);
  assert.equal(reqs.find((x) => x.key === 'full_name')?.from, 'builder');
  assert.equal((r.reply?.ship_log as { page: string }).page, `earnkit.com/${b.handle}`);
  assert.equal(r.reply?.draft, undefined, 'nothing drafted yet');
  // Nothing recorded: no entry, no status.
  const [{ c }] = await sql()<{ c: number }[]>`SELECT count(*)::int AS c FROM projects WHERE installation_id = ${b.id}`;
  assert.equal(c, 0);
  // Refusals: a closed program says so; an upcoming one is never called closed.
  const id = `v31-draft-${process.pid}`;
  await upsertProgram(ProgramFile.parse({ ...committedProgram('arc-microgrants'), id, status: 'closed' }));
  const closed = await prepare(b, { program_id: id });
  assert.equal(closed.isError, true);
  assert.match(closed.text, /This program is closed\./);
});

test('(b) Task 16 step 6, Base: how many answers are filled, what the builder adds, the Builder Codes line, one prefilled Google link with primary_challenge repeated, "Sent it?"', db, async () => {
  const b = await builder('b');
  // The stored answer, under a day old: the draft says it without reading GitHub (R13).
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${b.key.toLowerCase()}, false, now())`;
  const r = await prepare(b, { program_id: BASE_GRANTS_ID, answers: baseAnswers() });
  assert.equal(r.isError, false, r.text);
  const s = show(r);
  const link = firstLink(s);
  assert.equal(links(s).length, 1, s);
  assert.ok(link.startsWith(`${BASE.form.url}?usp=pp_url&`), link);
  assert.deepEqual(new URL(link).searchParams.getAll('entry.475374687'), ['User acquisition', 'Go-to-market strategy']);
  // The owner-approved copy, word for word (no points line: no points for applying).
  assert.equal(s, [
    'Your Base Builder Grant Program application is ready. I filled 7 of 16 answers from your work.',
    // v3.1 cold read round 2: one short line, the form's own first two items and a count, never the whole list.
    'You add 9 more in the form: your full name, your email and 7 short answers.',
    BUILDER_CODES_FIRST,
    '',
    `Open the form, your answers are already in it: ${link}`,
    'Sent it?',
  ].join('\n'));
  assert.equal(SENT_ASK, 'Sent it?');
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /points/);
  const draft = r.reply?.draft as { mode: string; url: string; prefilled_url: string };
  assert.equal(draft.mode, 'prefilled_link');
  assert.equal(draft.url, BASE.submission_url);
  assert.equal(draft.prefilled_url, link);
  assert.equal(r.reply?.builder_codes, false);
  assert.equal(r.reply?.agent_note, DRAFT_NOTE);
  // Found: the line names the repo.
  await sql()`UPDATE repo_builder_codes SET found = true WHERE repo_key = ${b.key.toLowerCase()}`;
  const found = await prepare(b, { program_id: BASE_GRANTS_ID, answers: baseAnswers() });
  assert.equal(show(found).split('\n')[2], builderCodesFound(b.key.toLowerCase()));
  // A read that fails (no App installation answers): nothing about Builder Codes (Review Focus 5).
  await sql()`DELETE FROM repo_builder_codes WHERE repo_key = ${b.key.toLowerCase()}`;
  const unknown = await prepare(b, { program_id: BASE_GRANTS_ID, answers: baseAnswers() });
  assert.doesNotMatch(show(unknown), /Builder Codes/);
  assert.equal(unknown.reply?.builder_codes, null);
  // Nothing recorded.
  const [{ c }] = await sql()<{ c: number }[]>`SELECT count(*)::int AS c FROM builder_program_status WHERE installation_id = ${b.id}`;
  assert.equal(c, 0);
});

test('(c) Base answers with https links: exactly one https link in show_to_builder; draft.fields keep the full links', db, async () => {
  const b = await builder('c');
  const r = await prepare(b, { program_id: BASE_GRANTS_ID, answers: { ...baseAnswers(), founding_team: 'Lee builds Kit, see https://lee.dev' } });
  const s = show(r);
  assert.equal(links(s).length, 1, s);
  assert.ok(firstLink(s).startsWith('https://docs.google.com/forms/'), s);
  // Prefilled: the answers are in the form, not repeated in the reply.
  assert.ok(s.startsWith(`${draftReadyLine(BASE.title, 8, 16)}\n`), s);
  assert.ok(s.includes(`\n\n${OPEN_PREFILLED} ${firstLink(s)}\n`), s);
  assert.doesNotMatch(s.replace(/https?:\/\/\S+/g, ''), /lee\.dev|kit-demo/);
  const fields = fieldsOf(r);
  assert.equal(fields.find((f) => f.key === 'live_product_url')?.answer, 'https://kit.app');
  assert.equal(fields.find((f) => f.key === 'demo_loom')?.answer, 'https://www.loom.com/share/kit-demo');
  assert.equal(fields.find((f) => f.key === 'founding_team')?.answer, 'Lee builds Kit, see https://lee.dev');
  // The prefilled link carries the full values.
  const q = new URL(firstLink(s)).searchParams;
  assert.equal(q.get(BASE.form.fields.live_product_url), 'https://kit.app');
});

test('(d) Circle (Questbook): copy and paste, the form link as the one link', db, async () => {
  const b = await builder('d');
  const circle = committedProgram('circle-developer-grants');
  const first = await prepare(b, { program_id: circle.id });
  assert.equal(first.reply?.agent_note, DRAFT_FIRST_NOTE, 'its fields come from the project');
  const answers = { business: 'Kit lets fans tip creators in USDC.', integrations: 'USDC payments on Arc', roadmap: 'Arc mainnet in Q1', milestones: 'Ship tips on Arc; 100 creators' };
  const r = await prepare(b, { program_id: circle.id, answers });
  assert.equal(r.isError, false, r.text);
  const s = show(r);
  assert.deepEqual(links(s), [circle.submission_url]);
  // The page link in the first answer lost its scheme in the shown text: the builder is told to add it (fix round 1).
  assert.ok(s.endsWith(`\n\nAdd https:// to each link when you paste.\nPaste each answer into the form: ${circle.submission_url}\nSent it?`), s);
  assert.ok(s.startsWith(`${draftReadyLine(circle.title, 4, 4)}\n\n`), 'nothing to add: no "You add" line');
  // Copy and paste: the answers block between the explanation and the paste line (Task 9's).
  for (const req of circle.submission_requirements as SubmissionRequirement[]) assert.ok(s.includes(`\n\n${req.label}\n`), req.key);
  assert.doesNotMatch(s, /You add/);
  const draft = r.reply?.draft as { mode: string; prefilled_url?: string };
  assert.equal(draft.mode, 'copy_paste');
  assert.equal(draft.prefilled_url, undefined);
  assert.equal(r.reply?.builder_codes, undefined, 'Builder Codes only for Base');
  assert.equal(questions(s), 1, s);
});

test('(e) Alliance: the email field, the continues line, the form link', db, async () => {
  const b = await builder('e');
  const alliance = committedProgram('alliance-all19');
  // Its one field is the builder's (never drafted by the agent): drafted at once, the email a blank.
  const r = await prepare(b, { program_id: alliance.id });
  assert.equal(r.isError, false, r.text);
  const s = show(r);
  assert.deepEqual(links(s), [alliance.submission_url]);
  // v3.1 cold read: EarnKit fills nothing here (the form lives on Alliance's site), so never "I filled 0 of 1 answer".
  assert.equal(s, [
    `Alliance's application is on their site and starts with the first founder's email: ${alliance.submission_url}`,
    SENT_ASK,
  ].join('\n'));
});

test('(f) the page link goes into the first free-text answer once, never over max_chars', db, async () => {
  const page = 'https://earnkit.com/lee';
  const reqs: SubmissionRequirement[] = [
    { key: 'name', label: 'Name', type: 'text', required: true, from: 'builder', kind: 'contact' },
    { key: 'site', label: 'Site', type: 'url', required: true, from: 'project' },
    { key: 'pitch', label: 'Pitch', type: 'text', required: true, from: 'project' },
    { key: 'more', label: 'More', type: 'text', required: false, from: 'project' },
  ] as SubmissionRequirement[];
  const v = { name: 'Lee', site: 'https://kit.app', pitch: 'Kit lets fans tip creators', more: 'Later' };
  assert.deepEqual(withPageLink(reqs, v, page), { ...v, pitch: `Kit lets fans tip creators. ${PAGE_IN_ANSWER(page)}` });
  assert.equal(PAGE_IN_ANSWER(page), 'Weekly ship log: https://earnkit.com/lee');
  // Once: an answer that holds the page already is kept.
  const twice = withPageLink(reqs, withPageLink(reqs, v, page), page);
  assert.equal(twice.pitch.split('earnkit.com/lee').length, 2);
  assert.deepEqual(withPageLink(reqs, { ...v, pitch: 'See earnkit.com/lee.' }, page), { ...v, pitch: 'See earnkit.com/lee.' });
  // Never over max_chars.
  const capped = reqs.map((r) => (r.key === 'pitch' ? { ...r, max_chars: 40 } : r));
  assert.deepEqual(withPageLink(capped, v, page), v);
  // The first answered one: an empty first free-text answer is skipped.
  assert.deepEqual(withPageLink(reqs, { ...v, pitch: '' }, page), { ...v, pitch: '', more: `Later. ${PAGE_IN_ANSWER(page)}` });
  // Through prepare: Base's one-liner carries the page, in full for the form, without the scheme for the builder.
  const b = await builder('f');
  const r = await prepare(b, { program_id: BASE_GRANTS_ID, answers: baseAnswers() });
  const one = fieldsOf(r).find((f) => f.key === 'project_name_description')!;
  assert.equal(one.answer, `Kit: fans tip creators onchain in one tap. ${PAGE_IN_ANSWER(`https://earnkit.com/${b.handle}`)}`);
  assert.equal(fieldsOf(r).filter((f) => f.answer.includes(`earnkit.com/${b.handle}`)).length, 1, 'once');

  assert.equal(new URL(firstLink(show(r))).searchParams.get(BASE.form.fields.project_name_description), one.answer);
});

test('(g) tell program_status applied then find: the program is no longer the Best fit and the page reads "Applied to <title>"', db, async () => {
  const id = `v31-draft-g-${process.pid}`;
  const p = ProgramFile.parse({ ...BASE, id, title: `Draft g ${RUN}`, summary: 'up to $5,000', ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), status: 'active' });
  await upsertProgram(p);
  const b = await builder('g', [id]);
  // v4.8 Task 1: the path's hook names the fit, offered as a draft. v4.10 Task 4 (R1): a fresh session opens with the
  // ready set instead. v4.10.2 Task 1 (R1): Base's form copied owes 12 answers (the contact details, team, usage, demo,
  // contract address, revenue, the 3-month plan, its code, the main challenge and the credits), more than one reply
  // holds, so the fit is said apart with its count.
  assert.match(show(await mcpCall(b.ctx, 'find', {})), new RegExp(`^\\S+, I've [^]*\\nAlso open: ${p.title}, up to \\$5,000, needs 12 answers from you\\.[^]*\\n${READY_ASK.replace(/[.?]/g, '\\$&')}$`), 'the Best fit, said apart from the ready set');
  const r = await prepare(b, { program_id: id, answers: baseAnswers() });
  assert.ok(show(r).endsWith(SENT_ASK));
  const told = await mcpCall(b.ctx, 'tell', { program_status: [{ program_id: id, status: 'applied' }] });
  assert.equal(told.isError, false, told.text);
  const after = show(await mcpCall(b.ctx, 'find', {}));
  assert.doesNotMatch(after, new RegExp(p.title), after);
  const page = await profileData(b.id, new Date());
  assert.deepEqual(page?.project?.programs, [{ title: p.title, won: false, applied: true }]);
});

test('(h) one question mark in show_to_builder (outside its link, "Sent it?"); no em dash', db, async () => {
  const b = await builder('h');
  for (const [program_id, answers] of [[BASE_GRANTS_ID, baseAnswers()], ['alliance-all19', {}]] as const) {
    const s = show(await prepare(b, { program_id, answers }));
    assert.ok(s.length > 0);
    assert.equal(questions(s), 1, s);
    assert.doesNotMatch(s, /—/, s);
    assert.equal(links(s).length, 1, s);
  }
});

/** A fetch that counts its calls and answers as GitHub with no App installation (404). */
function countingFetch() {
  const calls: string[] = [];
  const f = (async (u: string | URL | Request) => {
    calls.push(String(u));
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

test('(i) fix round 1 (security): another builder\'s repo named in the draft reads no stored answer and starts no check', db, async () => {
  const a = await builder('ia');
  const b = await builder('ib');
  const other = b.key.toLowerCase();
  // b's repo has a stored answer: a never reads it, by project.repo_url or answers.repo_url.
  await sql()`INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${other}, true, now())`;
  const spy = countingFetch();
  const actx = { ...a.ctx, codesFetch: spy.f };
  for (const args of [
    { project: { ...a.project, repo_url: `https://github.com/${b.key}` }, answers: baseAnswers() },
    { project: { name: 'Kit' }, answers: { ...baseAnswers(), repo_url: `https://github.com/${b.key}` } },
  ]) {
    const r = await mcpCall(actx, 'prepare', { program_id: BASE_GRANTS_ID, ...args });
    assert.equal(r.isError, false, r.text);
    assert.doesNotMatch(show(r), /Builder Codes/, show(r));
    assert.equal(r.reply?.builder_codes, null);
  }
  // Unknown (no stored answer): a's call starts no check, so b's once-a-day attempt is untouched.
  await sql()`DELETE FROM repo_builder_codes WHERE repo_key = ${other}`;
  await mcpCall(actx, 'prepare', { program_id: BASE_GRANTS_ID, project: { ...a.project, repo_url: `https://github.com/${b.key}` }, answers: baseAnswers() });
  assert.equal(spy.calls.length, 0, spy.calls.join(' '));
  const bspy = countingFetch();
  await mcpCall({ ...b.ctx, codesFetch: bspy.f }, 'prepare', { program_id: BASE_GRANTS_ID, project: b.project, answers: baseAnswers() });
  assert.ok(bspy.calls.length > 0, "b's own draft still checks its repo");
});

test('(j) fix round 1: a copy-and-paste draft whose answers lost a scheme says to add it; shown answers keep one question and no em dash', db, async () => {
  const b = await builder('j');
  const circle = committedProgram('circle-developer-grants');
  const answers = { business: 'Why Kit? Fans tip creators — in USDC.', integrations: 'USDC on Arc, see https://kit.app/arc', roadmap: 'Arc mainnet in Q1', milestones: '100 creators' };
  const r = await prepare(b, { program_id: circle.id, answers });
  const s = show(r);
  assert.ok(s.includes(`\n\nAdd https:// to each link when you paste.\nPaste each answer into the form: ${circle.submission_url}\n${SENT_ASK}`), s);
  assert.ok(s.includes('\n\nDetails on your business\nWhy Kit. Fans tip creators, in USDC. Weekly ship log: earnkit.com/'), s);
  assert.ok(s.includes('USDC on Arc, see kit.app/arc'), s);
  assert.equal(questions(s), 1, s);
  assert.doesNotMatch(s, /—/);
  assert.deepEqual(links(s), [circle.submission_url]);
  // The agent-facing fields keep the raw values.
  assert.equal(fieldsOf(r).find((f) => f.key === 'business')?.answer, `${answers.business} Weekly ship log: https://earnkit.com/${b.handle}`);
  assert.equal(fieldsOf(r).find((f) => f.key === 'integrations')?.answer, answers.integrations);
  // No link in the answers (a shared client: no ship log, so no page link): no line. The prefilled Base draft never has it.
  const plain = show(await mcpCall({ ...b.ctx, sharedClient: true }, 'prepare', { program_id: circle.id, project: b.project, answers: { ...answers, integrations: 'USDC on Arc' } }));
  assert.ok(plain.includes(`\n\nPaste each answer into the form: ${circle.submission_url}`), plain);
  assert.doesNotMatch(plain, /Add https:\/\//);
  const base = show(await prepare(b, { program_id: BASE_GRANTS_ID, answers: baseAnswers() }));
  assert.doesNotMatch(base, /Add https:\/\//);
});

test('(k) fix round 1: an upcoming program is refused as not open yet, never "closed"', db, async () => {
  const b = await builder('k');
  const upcoming = committedProgram('monad-nitro');
  assert.equal(upcoming.status, 'upcoming');
  const r = await prepare(b, { program_id: upcoming.id });
  assert.equal(r.isError, true);
  assert.match(r.text, /This program is not open yet\./);
  assert.doesNotMatch(r.text, /closed/);
});
