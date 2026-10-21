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
import { applyAsk, bestFitLine, BENCH_HEADS } from './bench-reply';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';

/**
 * v3.1 Task 6 (spec 3.2): every ranked reply leads with its Best fit (the top apply candidate); rolling programs get
 * the draft offer when no fit closes within 30 days; the apply ask comes before the backing offer.
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
const WHY = 'You deployed on Base and your app is live.';
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
const ROLLING_BEST = bestFitLine({ program_id: ROLLING, title: ROLLING_TITLE, prize: 'up to $5K', when: 'rolling', why: WHY, codes: null });

test('(a) a rolling fit only: Best fit line first, then the rolling ask, once', db, async () => {
  assert.equal(ROLLING_BEST, `Best fit: ${ROLLING_TITLE}, up to $5K, rolling. ${WHY}`);
  assert.equal(applyAsk(ROLLING_TITLE, null), `${ROLLING_TITLE} is open now (rolling). Want me to draft your application from your ship log?`);
  assert.equal(applyAsk('Alliance ALL19', 'Nov 18'), 'Alliance ALL19 closes Nov 18. Want me to draft your application from your ship log?');
  assert.equal(bestFitLine({ program_id: 'x', title: 'X', prize: 'up to $5K', when: 'closes Nov 18', why: WHY, codes: 'Builder Codes found in kit.' }),
    `Best fit: X, up to $5K, closes Nov 18. ${WHY} Builder Codes found in kit.`);
  const b = await builder('a', [ROLLING]);
  const f = await find(b);
  const s = show(f);
  assert.ok(s.startsWith(`${ROLLING_BEST}\n\n${BENCH_HEADS.stand}\n`), s);
  assert.ok(s.endsWith(`${BENCH_HEADS.up}\n${applyAsk(ROLLING_TITLE, null)}`), s);
  assert.equal(kind(f), 'apply');
  assert.doesNotMatch(s, /—/);
  // Once: the next reply still leads with the Best fit, and asks the weekly step instead.
  const again = await find(b);
  assert.ok(show(again).startsWith(`${ROLLING_BEST}\n\n`), show(again));
  assert.doesNotMatch(show(again), /Want me to draft your application/);
  assert.notEqual(kind(again), 'apply');
});

test('(b) a fit closing in 20 days wins over a rolling one; one closing in 45 days does not', db, async () => {
  const soon = await dated('b20', 20);
  const far = await dated('b45', 45);
  const b = await builder('b', [ROLLING, soon.id, far.id]);
  const f = await find(b);
  const s = show(f);
  assert.ok(s.startsWith(`Best fit: ${soon.title}, up to $5K, closes ${soon.when}. ${WHY}\n\n`), s);
  assert.ok(s.endsWith(`${BENCH_HEADS.up}\n${applyAsk(soon.title, soon.when)}`), s);
  const c = await builder('b2', [ROLLING, far.id]);
  const t = show(await find(c));
  assert.ok(t.startsWith(`${ROLLING_BEST}\n\n`), t);
  assert.ok(t.endsWith(applyAsk(ROLLING_TITLE, null)), t);
});

test('(c) apply before backing: with both due, the apply ask shows; the next reply offers backing', db, () =>
  withEnv({ EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'v31-best-key' }, async () => {
    const b = await builder('c', [ROLLING], { week: true });
    const f = await find(b);
    assert.equal(kind(f), 'apply', show(f));
    assert.doesNotMatch(show(f), /back Kit onchain/, 'backing waits');
    const [m] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM coin_moments WHERE builder_id = ${b.id}`;
    assert.equal(m.n, 0, 'the backing moment is not claimed while it waits');
    const next = await find(b);
    assert.equal(kind(next), 'backing', show(next));
    assert.match(show(next), /Want to open backing for Kit\?$/);
    assert.ok(show(next).startsWith(`${ROLLING_BEST}\n\n`), 'the Best fit still leads');
  }));

test('(d) a no keeps the program off the Best fit line and the ask for 30 days', db, async () => {
  const b = await builder('d', [ROLLING]);
  assert.equal(kind(await find(b)), 'apply');
  assert.equal(show(await tell(b, { move_up: { kind: 'apply', project_key: b.key, answer: 'no' } })), 'Okay.');
  const unguard = () => sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'apply_asked' WHERE builder_id = ${b.id}`;
  await unguard();
  const s = show(await find(b));
  assert.doesNotMatch(s, /Best fit:/, s);
  assert.doesNotMatch(s, /Want me to draft your application/, s);
  assert.match(s, new RegExp(`${ROLLING_TITLE}: up to \\$5K, rolling\\.`), 'still a fit line');
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, ${['declined', `apply:${ROLLING}`]}::text[], to_jsonb(${new Date(Date.now() - 31 * DAY).toISOString()}::text))
    WHERE builder_id = ${b.id}`;
  await unguard();
  const back = show(await find(b));
  assert.ok(back.startsWith(`${ROLLING_BEST}\n\n`), back);
  assert.ok(back.endsWith(applyAsk(ROLLING_TITLE, null)), back);
});

test('(e) a taken repo or a program in builder_program_status: no Best fit line, no ask', db, async () => {
  const b = await builder('e', [ROLLING]);
  await sql()`INSERT INTO builder_program_status (installation_id, login, program_id, status, round_label) VALUES (${b.id}, '', ${ROLLING}, 'rejected', 'an older round')`;
  const s = show(await find(b));
  assert.doesNotMatch(s, /Best fit:/, s);
  assert.doesNotMatch(s, /Want me to draft your application/, s);
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
  assert.doesNotMatch(show(r), /Best fit:|Want me to draft your application/, show(r));
});

test('(g) score shows the same Best fit line as find', db, async () => {
  // 1 day: sooner than every other dated program, so score (every open program the repo's facts can win) picks it too.
  const p = await dated('g1', 1);
  const b = await builder('g', [ROLLING, p.id]);
  const f = show(await find(b));
  const best = `Best fit: ${p.title}, up to $5K, closes ${p.when}. ${WHY}`;
  assert.ok(f.startsWith(`${best}\n\n`), f);
  const s = show(keep(await mcpCall(b.ctx, 'score', {})));
  assert.ok(s.split('\n\n').includes(best), s);
  assert.equal(s.split('\n\n').find((x) => x.startsWith('Best fit:')), best);
});

test('(f) one https link and one question in every reply above', () => {
  assert.ok(replies.length >= 10, String(replies.length));
  for (const s of replies) {
    assert.ok(links(s).length <= 1, s);
    // The weekly target ("Ship code this week.") is a statement; every other step is the reply's one question.
    assert.equal(questions(s), /\n(Ship code this week|Ship this week to climb)/.test(s) ? 0 : 1, s);
    // The Best fit line is a statement: no link, no question.
    const best = s.split('\n').find((l) => l.startsWith('Best fit:'));
    if (best) assert.doesNotMatch(best, /https?:\/\/|\?/, best);
  }
});
