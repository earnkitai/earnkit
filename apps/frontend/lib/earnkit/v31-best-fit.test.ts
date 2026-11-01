import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { withEnv } from './fixtures/find';
import { pathQuiet } from './fixtures/wallet-step';
import { codesSettled } from './bench-find';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { closeDayOf } from './entry-text';
import { lastFinishedMonday } from './weeks';
import { applyAsk, qualifyLine } from './bench-reply';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v3.1 Task 6 (spec 3.2): every ranked reply names its Best fit (the top apply candidate; Task 16: the apply step, then
 * the money line); rolling programs get the draft offer when no fit closes within 30 days; the apply ask comes before
 * the backing offer.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-best-fit-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await codesSettled();
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const DAY = 86_400_000;
const ROLLING = 'base-builder-grants';
const ROLLING_TITLE = 'Base Builder Grant Program';
type R = Awaited<ReturnType<typeof mcpCall>>;
type Ctx = Parameters<typeof mcpCall>[0];
type B = { ctx: Ctx; id: number; key: string; handle: string };
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
const questions = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length;
const kind = (r: R) => (r.reply?.move_up as { kind?: string } | undefined)?.kind;
/** Every reply this file checks, for (f). */
const replies: string[] = [];
const keep = (r: R) => {
  replies.push(show(r));
  return r;
};
let n = 0;

/** A dated program (a copy of Base Builder Grants) closing `days` from now. */
async function dated(tag: string, days: number) {
  const base = committedProgram(ROLLING);
  const id = `v31-best-${process.pid}-${tag}`;
  const ends = new Date(Date.now() + days * DAY);
  const p = ProgramFile.parse({ ...base, id, title: `Best ${tag} ${RUN}`, summary: 'up to $5,000', ends_at: ends.toISOString(), status: 'active' });
  await upsertProgram(p);
  return { id, title: p.title, when: closeDayOf({ summary: p.summary, ends_at: ends })! };
}

/** A ranked builder (signed in with X, the repo proven by the App and public) the matcher fits for `programs`. */
async function builder(tag: string, programs: string[], o: { week?: boolean } = {}): Promise<B> {
  n++;
  const t = `ek_v31bf_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `bf${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `96${RUN}${n}${tag.length}`, username: handle, name: 'bf', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const key = `bf${tag}${RUN}/kit`;
  const fits = repoFits(key, programs);
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never,
    tokenDeps: { check: async () => true },
  } as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 8000 + n * 10 + (Number(RUN) % 7);
  const gh = fakeGitHub({ [key]: { id: gid, owner: handle, installation: gid + 1 } });
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh });
  // v3.1 Task 7: the background Builder Codes check reads this fake (its tree answers 404: nothing is said or stored).
  ctx.codesFetch = gh;
  // The connect weeks are another task's moment: answered, so they never take the step here.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${`0x${(c.id + 2000).toString(16).padStart(40, '0')}`}, ${c.id}) ON CONFLICT DO NOTHING`;
  if (o.week)
    await sql()`
      INSERT INTO project_updates (builder_id, project_key, week, facts) VALUES (${c.id}, ${key}, ${lastFinishedMonday(new Date())},
        ${sql().json({ shipped_code: { n: 3 }, checked: true, approved: true } as never)})
      ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts`;
  return { ctx, id: c.id, key, handle };
}
function repoFits(key: string, programs: string[]): RepoFit[] {
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  return [{
    repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: programs.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
}
const find = async (b: B) => keep(await mcpCall(b.ctx, 'find', {}));
const tell = (b: B, args: Record<string, unknown>) => mcpCall(b.ctx, 'tell', args);
/** Task 16: the money line a ranked reply names its Best fit with (after the apply step was asked). */
const ROLLING_BEST = qualifyLine({ title: ROLLING_TITLE, amount: '$5,000', when: 'rolling' });

/** v4.8 Task 1: the path's hook for a fit (conversation.ts pathReply): its money line, then the draft offer. */
const hookOf = (title: string, when: string | null) =>
  new RegExp(`^bf, ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ${when ? 'closes [^:]+' : 'is open now'}: up to \\$5,000\\.( [^\\n]+)?(\\n\\nOpen now: [^\\n]+ in grants\\.[^\\n]*)?\\n\\nI can draft your application from your commits( and live product)? in a few minutes\\. Want me to start\\?$`);
/** The same hook again in the session: one line that points back. */
// v4.8.1 Task 3 (R4): "{program} is still your best move: up to $5,000[, closes {when}]. Want me to start?".
const pointerOf = (title: string) =>
  new RegExp(`^${title.replace(/\s+Program$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is still your best move: up to \\$5,000(, closes [^.]+)?\\. Want me to start\\?$`);

test('(a) a rolling fit only: the path hooks it; the next find in the session points back, never the same block', db, async () => {
  assert.equal(ROLLING_BEST, `You qualify for the ${ROLLING_TITLE}, up to $5,000.`);
  assert.equal(applyAsk(ROLLING_TITLE, '$5,000', null), `${ROLLING_TITLE} is still open, up to $5,000. I can draft it in a minute.\nWant me to?`);
  assert.equal(applyAsk('Alliance ALL19', '$400,000 investment', 'Nov 18'), 'Alliance ALL19 closes Nov 18, up to $400,000 investment. I can draft it in a minute.\nWant me to?');
  const b = await builder('a', [ROLLING]);
  const f = await find(b);
  const s = show(f);
  assert.match(s, hookOf('Base Builder Grant', null), s);
  assert.equal(kind(f), 'apply');
  assert.doesNotMatch(s, /—/);
  // v4.8 Task 1 (Repeats): the same step again this session is a one-line pointer, the same easy reply.
  const again = await find(b);
  assert.match(show(again), pointerOf(ROLLING_TITLE));
  assert.equal(show(again), 'Base Builder Grant is still your best move: up to $5,000. Want me to start?');
  assert.equal(kind(again), 'apply');
});

test('(b) the fit closing first leads; a dated fit leads a rolling one (bestMove, step 1)', db, async () => {
  const soon = await dated('b20', 20);
  const far = await dated('b45', 45);
  const b = await builder('b', [ROLLING, soon.id, far.id]);
  const s = show(await find(b));
  assert.match(s, hookOf(soon.title, soon.when), s);
  const c = await builder('b2', [ROLLING, far.id]);
  const t = show(await find(c));
  assert.match(t, hookOf(far.title, far.when), t);
});

test('(c) v4.0 Task 11: no backing offer before apply, even with EARNKIT_RAISING on and a week with code; the hook drafts', db, () =>
  withEnv({ EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'v31-best-key' }, async () => {
    const b = await builder('c', [ROLLING], { week: true });
    const f = await find(b);
    assert.equal(kind(f), 'apply', show(f));
    assert.doesNotMatch(show(f), /I can launch|\bcoin/);
    assert.match(show(f), hookOf('Base Builder Grant', null), show(f));
  }));

test('(d) a no parks the program for the path for 30 days; then it leads again', db, async () => {
  const b = await builder('d', [ROLLING]);
  assert.equal(kind(await find(b)), 'apply');
  // Final review F7: a path no is one line, then find's next step in the same reply.
  assert.ok(show(await tell(b, { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } })).startsWith("No problem, I'll set "));
  const s = show(await find(b));
  assert.doesNotMatch(s, /Base Builder Grant is open now|I can draft it/, s);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(jsonb_set(standing_seen, ${['declined', `apply:${ROLLING}`]}::text[], to_jsonb(${new Date(Date.now() - 31 * DAY).toISOString()}::text)),
      ${['declined', `path:${ROLLING}`]}::text[], to_jsonb(${new Date(Date.now() - 31 * DAY).toISOString()}::text)) - 'said'
    WHERE builder_id = ${b.id}`;
  const back = show(await find(b));
  assert.match(back, hookOf('Base Builder Grant', null), back);
});

test('(e) a taken repo or a program in builder_program_status: no Best fit, no ask', db, async () => {
  const b = await builder('e', [ROLLING]);
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, round_label) VALUES (${b.id}, '', ${ROLLING}, 'rejected', 'an older round')`;
  // v4.8 Task 1: every other program parked for the path, so any apply ask could only be the program told about.
  await pathQuiet(b.id, { except: [ROLLING] });
  const r0 = await find(b);
  const s = show(r0);
  assert.doesNotMatch(s, /I can draft it|Want me to start\?/, s);
  assert.notEqual(kind(r0), 'apply');
  assert.doesNotMatch(s, /Base Builder Grant/, s);
  // Another person holds the repo.
  const t = `ek_v31bf_e2_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `95${RUN}${n}`, username: `bfe2${RUN}`.slice(0, 15), name: 'bf', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const fits = repoFits(b.key, [ROLLING]);
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never } as Ctx;
  const r = keep(await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${b.key}` } } }));
  assert.match(show(r), /already on the leaderboard under another account/, show(r));
  assert.doesNotMatch(show(r), /You qualify|I can draft it/, show(r));
});

test('(g) score names the same program as find', db, async () => {
  // 1 day: sooner than every other dated program, so the path's hook (closing first) is it.
  const p = await dated('g1', 1);
  const b = await builder('g', [ROLLING, p.id]);
  const f = show(await find(b));
  assert.match(f, hookOf(p.title, p.when), f);
  const r = keep(await mcpCall(b.ctx, 'score', {}));
  const s = show(r);
  // v4.7 T2: the standing paragraph leads, and its next deadline is the same program; then the path's step (said this
  // session already, so its pointer).
  assert.ok(s.startsWith(`${r.reply?.standing}\n\n`), s);
  // v4.8.1 final fix (R-3): a day out, the standing says the hours left.
  assert.match(String(r.reply?.standing), new RegExp(`Next: ${p.title} closes in 2[34] hours\\.$`), String(r.reply?.standing));
  assert.match(s.split('\n\n').at(-1)!, pointerOf(p.title), s);
});

test('(f) one https link and one question in every reply above', () => {
  assert.ok(replies.length >= 8, String(replies.length));
  for (const s of replies) {
    assert.ok(links(s).length <= 1, s);
    // Task 16: every reply asks exactly one question.
    assert.equal(questions(s), 1, s);
    // The money line is a statement: no link, no question.
    const best = s.split('\n').find((l) => l.startsWith('You qualify for'));
    if (best) assert.doesNotMatch(best, /https?:\/\/|\?/, best);
  }
});
