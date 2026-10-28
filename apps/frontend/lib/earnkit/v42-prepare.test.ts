import { after, test } from 'node:test';
import assert from 'node:assert/strict';
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
import { BASE_GRANTS_ID } from './builder-code';
import { isRealAnswer } from './submission';
import { closingNudge } from './nudges';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/** v4.2 Task 5 (F8, F14): drafts show only real answers; x_handle comes from the builder's X; the nudge yes opens the draft. */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v42-prepare-secret';

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
  const t = `ek_v42p_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
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

test('isRealAnswer: blank, the stand-in and template markers are not answers', () => {
  for (const t of ['', '   ', undefined, '(StudySplit: answer for x_handle)', '(answer for  email)', '<your email>', 'TBD', 'tbd.']) assert.equal(isRealAnswer(t), false, String(t));
  for (const t of ['@maya', 'Kit: fans tip creators', 'https://kit.app', 'To be determined by the market']) assert.equal(isRealAnswer(t), true, t);
});

test('F8: a stand-in answer is never prefilled or shown as an answer; it is listed under "You add"; x_handle comes from the X handle', db, async () => {
  const b = await builder('f8');
  const stand = (k: string) => `(Kit: answer for ${k})`;
  const answers = { ...baseAnswers(), full_name: stand('full_name'), email: stand('email'), telegram: '   ', x_handle: stand('x_handle') };
  const r = await prepare(b, { program_id: BASE_GRANTS_ID, answers });
  assert.equal(r.isError, false, r.text);
  const s = show(r);
  const link = firstLink(s);
  assert.doesNotMatch(r.text, /answer for/i, 'no stand-in anywhere in the reply');
  const u = new URL(link);
  for (const v of u.searchParams.values()) assert.doesNotMatch(v, /answer for/i);
  assert.equal(u.searchParams.get('entry.57269102'), b.handle, 'x_handle prefilled from the X handle');
  assert.equal(u.searchParams.get('entry.100652540'), null, 'full_name left blank');
  assert.equal(u.searchParams.get('entry.567744978'), null, 'email left blank');
  const f = fieldsOf(r);
  assert.equal(f.find((x) => x.key === 'x_handle')?.answer, b.handle);
  for (const k of ['full_name', 'email', 'telegram']) assert.equal(f.find((x) => x.key === k)?.missing, true, k);
  assert.match(s, /You add \d+ more in the form: your full name, your email/);
  // A real x_handle the agent supplies wins over the stored one.
  const own = await prepare(b, { program_id: BASE_GRANTS_ID, answers: { ...baseAnswers(), x_handle: '@someoneelse' } });
  assert.equal(fieldsOf(own).find((x) => x.key === 'x_handle')?.answer, '@someoneelse');
});

test('F14: the yes to the closing-soon nudge opens the existing draft with its link, never an empty reply', db, async () => {
  const b = await builder('f14');
  const id = `v42p-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await upsertProgram(ProgramFile.parse({ ...BASE, id, status: 'active', ends_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }));
  const [{ pid }] = await sql()<{ pid: number }[]>`INSERT INTO projects (program_id, name, installation_id, confirmed_at, application)
    VALUES (${id}, 'Kit', ${b.id}, now() - interval '5 days', ${sql().json({ answers: { ...baseAnswers(), x_handle: b.handle }, kinds: {}, fixes: [], at: new Date().toISOString() } as never)}) RETURNING id AS pid`;
  assert.ok(pid);
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', jsonb_build_object('kind', 'apply', 'key', ${b.key}::text, 'program_id', ${id}::text)) WHERE builder_id = ${b.id}`;
  const yes = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'apply', project_key: b.key, answer: 'yes' } });
  assert.equal(yes.isError, false, yes.text);
  const s = show(yes);
  assert.notEqual(s, '', 'never an empty reply');
  assert.match(s, /Open the form|https:\/\//);
  assert.ok(firstLink(s).startsWith(`${BASE.form.url}`), s);
  assert.doesNotMatch(s, /answer for/i);
  assert.equal(closingNudge('X', 'today').includes('Want to send it?'), true);
  await sql()`DELETE FROM projects WHERE id = ${pid}`;
});
