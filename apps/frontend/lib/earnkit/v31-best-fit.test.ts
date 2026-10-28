import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { withEnv } from './fixtures/find';
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
/** Task 16 step 5: the apply step and its points line, the reply's end. */
const applyEnd = (title: string, when: string | null) => `\n${applyAsk(title, '$5,000', when)}`;

test('(a) a rolling fit only: the rolling ask, once; then the Best fit is the money line', db, async () => {
  assert.equal(ROLLING_BEST, `You qualify for the ${ROLLING_TITLE}, up to $5,000.`);
  assert.equal(applyAsk(ROLLING_TITLE, '$5,000', null), `${ROLLING_TITLE} is still open, up to $5,000. I can draft it in a minute.\nWant me to?`);
  assert.equal(applyAsk('Alliance ALL19', '$400,000 investment', 'Nov 18'), 'Alliance ALL19 closes Nov 18, up to $400,000 investment. I can draft it in a minute.\nWant me to?');
  const b = await builder('a', [ROLLING]);
  const f = await find(b);
  const s = show(f);
  assert.ok(s.endsWith(applyEnd(ROLLING_TITLE, null)), s);
  assert.equal(kind(f), 'apply');
  assert.doesNotMatch(s, /—/);
  // Once: the next reply names the Best fit as its money line, and asks the weekly step instead (v3.1 cold read: the
  // standing line was just shown and hasn't changed, so the Best fit leads).
  const again = await find(b);
  assert.equal(show(again).split('\n')[0], ROLLING_BEST, show(again));
  assert.doesNotMatch(show(again), /I can draft it/);
  assert.notEqual(kind(again), 'apply');
});

test('(b) a fit closing in 20 days wins over a rolling one; one closing in 45 days does not', db, async () => {
  const soon = await dated('b20', 20);
  const far = await dated('b45', 45);
  const b = await builder('b', [ROLLING, soon.id, far.id]);
  const f = await find(b);
  const s = show(f);
  assert.ok(s.endsWith(applyEnd(soon.title, soon.when)), s);
  assert.equal(show(await find(b)).split('\n')[0], qualifyLine({ title: soon.title, amount: '$5,000', when: `closes ${soon.when}` }));
  const c = await builder('b2', [ROLLING, far.id]);
  const t = show(await find(c));
  assert.ok(t.endsWith(applyEnd(ROLLING_TITLE, null)), t);
});

test('(c) v4.0 Task 11: no backing offer before apply, even with EARNKIT_RAISING on and a week with code; the apply step drafts', db, () =>
  withEnv({ EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'v31-best-key' }, async () => {
    const b = await builder('c', [ROLLING], { week: true });
    const f = await find(b);
    assert.equal(kind(f), 'apply', show(f));
    assert.doesNotMatch(show(f), /I can launch|\bcoin/);
    assert.ok(`\n${show(f)}`.endsWith(applyEnd(ROLLING_TITLE, null)), show(f));
  }));

test('(d) a no keeps the program off the ask (and the Best fit) for 30 days', db, async () => {
  const b = await builder('d', [ROLLING]);
  assert.equal(kind(await find(b)), 'apply');
  assert.equal(show(await tell(b, { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } })), 'Okay.');
  const unguard = () => sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'apply_asked' WHERE builder_id = ${b.id}`;
  await unguard();
  const s = show(await find(b));
  assert.doesNotMatch(s, /I can draft it/, s);
  // Still a fit: the money line names it (the first fit line), never as the ask (the unchanged standing isn't repeated).
  assert.equal(s.split('\n')[0], ROLLING_BEST, s);
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, ${['declined', `apply:${ROLLING}`]}::text[], to_jsonb(${new Date(Date.now() - 31 * DAY).toISOString()}::text))
    WHERE builder_id = ${b.id}`;
  await unguard();
  const back = show(await find(b));
  // v3.1 cold read: the points line was this week's already (at most once an ISO week).
  assert.ok(`\n${back}`.endsWith(`\n${applyAsk(ROLLING_TITLE, '$5,000', null)}`), back);
});

test('(e) a taken repo or a program in builder_program_status: no Best fit, no ask', db, async () => {
  const b = await builder('e', [ROLLING]);
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, round_label) VALUES (${b.id}, '', ${ROLLING}, 'rejected', 'an older round')`;
  const r0 = await find(b);
  const s = show(r0);
  assert.doesNotMatch(s, /I can draft it/, s);
  assert.notEqual(kind(r0), 'apply');
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

test('(g) score names the same Best fit as find', db, async () => {
  // 1 day: sooner than every other dated program, so score (every open program the repo's facts can win) picks it too.
  const p = await dated('g1', 1);
  const b = await builder('g', [ROLLING, p.id]);
  const f = show(await find(b));
  assert.ok(f.endsWith(applyEnd(p.title, p.when)), f);
  // Every other open program asked already, so score's step is to ship and its money line is the Best fit.
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
    || jsonb_build_object('apply_asked', (SELECT jsonb_object_agg(id, now()::text) FROM programs)) WHERE builder_id = ${b.id}`;
  const s = show(keep(await mcpCall(b.ctx, 'score', {})));
  assert.equal(s.split('\n')[1], qualifyLine({ title: p.title, amount: '$5,000', when: `closes ${p.when}` }), s);
});

test('(f) one https link and one question in every reply above', () => {
  assert.ok(replies.length >= 10, String(replies.length));
  for (const s of replies) {
    assert.ok(links(s).length <= 1, s);
    // Task 16: every reply asks exactly one question.
    assert.equal(questions(s), 1, s);
    // The money line is a statement: no link, no question.
    const best = s.split('\n').find((l) => l.startsWith('You qualify for'));
    if (best) assert.doesNotMatch(best, /https?:\/\/|\?/, best);
  }
});
