import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools } from './tools';
import { EVENT_LOG_FLAG } from './events';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, dropAvalanche, find, fitsFor, install, person, withEnv } from './fixtures/find';
import { NO_OFFER_LINE, NO_PROJECT_LINE, OTHER_PROJECT_ASK, POST_UPDATE_ASK, SUGGEST_ASK, UPDATES_ASK_JOINING, benchBuildAsk, buildingNowLine, cantShowLine, grantsAsk, takenLine } from './bench-reply';
import { BENCH_BUILD_ID, TWIST_QUESTION } from './fresh-build';
import { mainProjectOf } from './main-project';
import { mondayOf } from './weeks';
import { coinBranchProof } from './proof-branch';
import { reservedIdProblem } from './program-file';
import { readStats } from './stats';
import { listPrograms } from './programs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.13.1 O2: the reply-side fixes of the first-run audit, through the real tools under the Bench
 * flag: B1 (no project: the starter build with no program), B2 (the claim link with no project), B4
 * (no ask while a build is in progress), B6 (the one project can change until it is confirmed), the
 * page link once claimed, build_offer with no note, the last line one question that fits, and the
 * coin gate for any confirmed main project.
 */

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
process.env.EARNKIT_AUTH_SECRET ||= 'v2131-onboarding-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});

const RUN = randomBytes(3).toString('hex');
let seq = 0;
const uniq = (p: string) => `${p}${RUN}${++seq}`;
const ON = { EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', EARNKIT_URL: undefined, [EVENT_LOG_FLAG]: 'on', ...X_ON };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
/** Only this file's starter (no program names it), so no program qualifies for a fresh build: the build with no program. */
const STARTER_ID = `o2-tip-${RUN}`;
const OWN_FRESH = { deployOn: () => true, hostOn: true, canBuild: true, starters: { [STARTER_ID]: { ...TESTED_STARTERS['arc-tipjar'], id: STARTER_ID } } };
const named = (repo: string) => ({ agent_can_build: true, identity: { github_login: repo.split('/')[0], project: { name: repo.split('/')[1], what: 'a thing', repo } } });
const links = (t: string) => t.match(/https?:\/\/\S+/g) ?? [];
const openCodes = (id: number) => sql()<{ repo_key: string }[]>`SELECT repo_key FROM proof_branches WHERE builder_id = ${id} AND used_at IS NULL AND closed_at IS NULL AND expires_at > now()`;
type R = { show_to_builder: string; agent_note?: string; build_offer?: Record<string, unknown>; move_up?: { kind: string }; kit?: unknown };

test('O2.1 B1, B2, B4, item 7: no project and no program to build for: the starter build with no program, the claim link, no note on build_offer; the yes builds, hosts and sets the one project, entering nothing; mid-build only "Building"', dbTest, () =>
  on(async () => {
    const id = await install();
    const ctx = { installationId: id, freshDeps: OWN_FRESH } as never;
    const r = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    const lines = r.show_to_builder.split('\n');
    assert.equal(lines[1], NO_PROJECT_LINE);
    assert.match(lines[2], /^Claim your page with X: https:\/\/earnkit\.com\/claim\/[a-z0-9]+$/);
    assert.equal(links(r.show_to_builder).length, 1, 'the claim link is the only link');
    assert.ok(r.show_to_builder.endsWith(benchBuildAsk('a tip jar')), r.show_to_builder);
    assert.deepEqual(r.build_offer, { program_id: BENCH_BUILD_ID, starter_id: STARTER_ID }, 'no agent_note under the flag');
    assert.equal(r.move_up?.kind, 'build');
    const sc = (await tools.score({}, ctx)) as R;
    assert.ok(sc.show_to_builder.endsWith(benchBuildAsk('a tip jar')));
    assert.equal(sc.build_offer?.agent_note, undefined);
    // The yes: the build path for the reserved id; one question first.
    const yes = (await tools.tell({ move_up: { kind: 'build', project_key: null, answer: 'yes' } }, ctx)) as R;
    assert.ok(yes.agent_note?.includes(`program_id: '${BENCH_BUILD_ID}'`), yes.agent_note);
    const start = (await tools.prepare({ program_id: BENCH_BUILD_ID, build: { start: true, program_id: BENCH_BUILD_ID } }, ctx)) as R;
    assert.ok(start.show_to_builder.startsWith(TWIST_QUESTION), start.show_to_builder);
    // B4 at the twist step: no build offer again.
    const mid0 = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    assert.equal(mid0.build_offer, undefined);
    assert.equal(mid0.move_up, undefined);
    const repo = `${uniq('podder')}/podtips`;
    const twist = (await tools.prepare({
      program_id: BENCH_BUILD_ID,
      build: {
        program_id: BENCH_BUILD_ID, twist: 'tips for my podcast listeners', name: 'Podcast Tips', description: 'USDC tips for my podcast listeners.',
        feature: 'Listeners leave a note for the next podcast episode.', for_whom: 'for your podcast listeners', wallet: `0x${'1a'.repeat(20)}`,
        repo_url: `https://github.com/${repo}`,
      },
    }, ctx)) as R;
    assert.match(twist.show_to_builder, /^Building Podcast Tips: /);
    assert.ok(twist.kit);
    // B4: mid-build, find and score say only "Building", ask nothing, offer nothing.
    for (const mid of [await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH }), (await tools.score({}, ctx)) as R]) {
      assert.equal(mid.show_to_builder.split('\n')[1], buildingNowLine('Podcast Tips'));
      assert.doesNotMatch(mid.show_to_builder, /Want me|Ways to get funded|How to move up/);
      assert.equal(mid.move_up, undefined);
      assert.equal(mid.build_offer, undefined);
    }
    // The deploy set the one project (as buildShip does); the live link ends the build, entering no program.
    const slug = uniq('podtips');
    await sql()`INSERT INTO contract_deploys (installation_id, builder_key, repo_key, chain, tx_hash, status, cost_micro_usd, address, owner_ok)
      VALUES (${id}, ${`o2-${id}`}, ${repo}, 'arc', ${`0x${'ab'.repeat(32)}`}, 'deployed', 1, ${`0x${'cd'.repeat(20)}`}, true)`;
    await sql()`INSERT INTO hosted_sites (slug, login, repo_key, installation_id, bytes, files, status) VALUES (${slug}, ${repo.split('/')[0]}, ${repo}, ${id}, 1, 1, 'live')`;
    await sql()`UPDATE builder_profiles SET main_project_key = ${repo} WHERE builder_id = ${id}`;
    const done = (await tools.prepare({ program_id: BENCH_BUILD_ID, project: { name: 'Podcast Tips', repo_url: `https://github.com/${repo}`, live_url: `https://${slug}.earnkit.com/` }, build: { program_id: BENCH_BUILD_ID } }, ctx)) as R;
    assert.match(done.show_to_builder, new RegExp(`^Podcast Tips is live: .*${slug}`), done.show_to_builder);
    assert.doesNotMatch(done.show_to_builder, /entry|Want me to prepare/i);
    assert.equal((await sql()`SELECT 1 FROM projects WHERE installation_id = ${id}`).length, 0, 'no program entered');
    const after = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH, ...NO_MATCH });
    assert.doesNotMatch(after.show_to_builder, /^Building/m);
    assert.equal(await mainProjectOf(id), repo);
  }),
);

test('O2.1b flag off: the reserved build id is refused (no program by that name)', dbTest, () =>
  withEnv({ ...ON, EARNKIT_BENCH: undefined }, async () => {
    const id = await install();
    const r = (await tools.prepare({ program_id: BENCH_BUILD_ID, build: { start: true, program_id: BENCH_BUILD_ID } }, { installationId: id, freshDeps: OWN_FRESH } as never)) as R;
    assert.equal(r.show_to_builder, '');
    assert.match(r.agent_note ?? '', /can't start a build/);
  }),
);

test('O2.1c no project, nothing EarnKit can build (deploys off): no "Pick something", no question pointing nowhere, the claim link', dbTest, () =>
  on(async () => {
    const id = await install();
    const r = await find(id, { agent_can_build: true }, { freshDeps: { ...OWN_FRESH, deployOn: () => false } });
    assert.doesNotMatch(r.show_to_builder, /Pick something to build/);
    assert.match(r.show_to_builder, /^You're not on the Bench yet\. Tell me what you'd like to build and I'll help you start\.$/m);
    assert.match(r.show_to_builder, /^Claim your page with X: https:\/\/earnkit\.com\/claim\//m);
    assert.equal(r.build_offer, undefined);
    assert.doesNotMatch(r.show_to_builder, /Circle|needs a live/);
  }),
);

test('O2.4 B6: a newer project replaces an unconfirmed one (its open code cleared, the new one gets a code); not_mine clears it; once confirmed it never changes', dbTest, () =>
  on(async () => {
    const id = await install();
    const a = `${uniq('wrong')}/linux`;
    const b = `${uniq('maya')}/recipes`;
    await find(id, named(a), NO_MATCH);
    assert.equal(await mainProjectOf(id), a);
    assert.deepEqual((await openCodes(id)).map((r) => r.repo_key), [a]);
    const r = await find(id, named(b), NO_MATCH);
    assert.equal(await mainProjectOf(id), b);
    assert.deepEqual((await openCodes(id)).map((x) => x.repo_key), [b], "the old key's open code is closed");
    assert.equal((await sql()`SELECT 1 FROM proof_branches WHERE builder_id = ${id} AND repo_key = ${a} AND closed_at IS NOT NULL`).length, 1, 'closed, never deleted');
    assert.equal((r.proof as { repo?: string } | undefined)?.repo, b);
    // Fix round 1 (ruling 2): the agent is told once to delete any branch it pushed for the old key.
    const rm = (r as unknown as { remove_branch?: { remove: string; agent_note: string } }).remove_branch;
    assert.match(rm?.remove ?? '', /^git push origin :refs\/heads\/earnkit-[a-z2-7]{12}$/);
    assert.match(rm?.agent_note ?? '', /project changed/);
    assert.equal((await find(id, named(b), NO_MATCH) as unknown as { remove_branch?: unknown }).remove_branch, undefined, 'told once');
    assert.match(r.show_to_builder, /recipes/);
    // not_mine on the current one clears it; the next project the agent names is the one.
    await tools.tell({ repo_facts: [{ repo: b, not_mine: true }] }, { installationId: id } as never);
    assert.equal(await mainProjectOf(id), null);
    assert.deepEqual([...(await openCodes(id))], []);
    const c = `${uniq('maya')}/cooking`;
    await find(id, named(c), NO_MATCH);
    assert.equal(await mainProjectOf(id), c);
    // not_mine on another repo changes nothing.
    await tools.tell({ repo_facts: [{ repo: a, not_mine: true }] }, { installationId: id } as never);
    assert.equal(await mainProjectOf(id), c);
    // Confirmed: set once.
    const key = `${uniq('conf')}/recipes`;
    const p = await person({ main: key, claimed: uniq('cf'), projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    await find(p, named(`${uniq('other')}/thing`), NO_MATCH);
    assert.equal(await mainProjectOf(p), key);
    await tools.tell({ repo_facts: [{ repo: key, not_mine: true }] }, { installationId: p } as never);
    assert.equal(await mainProjectOf(p), key, 'not_mine never clears a confirmed project');
  }),
);

test('O2.5 once claimed: find and score show "Your page: https://earnkit.com/<handle>" right after the stand line', dbTest, () =>
  on(async () => {
    const key = `${uniq('page')}/recipes`;
    const handle = uniq('pg');
    const id = await person({ main: key, claimed: handle, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    const f = await find(id, {}, NO_MATCH);
    assert.equal(f.show_to_builder.split('\n')[2], `Your page: https://earnkit.com/${handle}`);
    const s = (await tools.score({}, { installationId: id } as never)) as R;
    assert.equal(s.show_to_builder.split('\n')[2], `Your page: https://earnkit.com/${handle}`);
  }),
);

test('O2.9 the last line is one question that fits: no open-all-year grant for another chain, a project being checked is asked the updates yes', dbTest, () =>
  on(async () => {
    const ava = await avalanche();
    const id = await install();
    const r = await find(id, named(`${uniq('maya')}/hello`), NO_MATCH);
    assert.ok(!r.show_to_builder.includes(ava.title), 'a chain grant that does not fit the project is never shown');
    assert.doesNotMatch(r.show_to_builder, /Ways to get funded/);
    assert.ok(r.show_to_builder.endsWith(UPDATES_ASK_JOINING), r.show_to_builder);
    assert.doesNotMatch(r.show_to_builder, /How to move up\n.*on the Bench/, 'not on the Bench yet');
    assert.equal(r.move_up?.kind, 'updates');
    assert.equal(r.show_to_builder.split('\n').filter((l) => l.includes('?')).length, 1, 'one question');
  }),
);

/** A fake GitHub repo read for the coin gate: `/repos/<key>` as GitHub answers it (default: a User's own repo, not a fork). */
const repoFetch = (meta: Record<string, unknown> = {}) => {
  const reads: string[] = [];
  const f = (async (u: RequestInfo | URL) => {
    const url = new URL(String(u));
    reads.push(url.pathname);
    const m = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (!m) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ id: 4242, full_name: `${m[1]}/${m[2]}`, fork: false, is_template: false, owner: { login: m[1], type: 'User' }, ...meta }), { status: 200 });
  }) as typeof fetch;
  return { f, reads };
};
const setProof = (id: number, key: string, proof: string) => sql()`UPDATE builder_sources SET proof = ${proof} WHERE builder_id = ${id} AND kind = 'repo' AND ref = ${key}`;

test('O2.10 a coin (revised ruling): a Bench-confirmed main project proven by control (a line, a sign-in) passes with no line after one repo read; repo_owner gets the proof branch; a repo another person holds is taken; a sign-in repo now a fork does not pass', dbTest, () =>
  on(async () => {
    const key = `${uniq('coin')}/recipes`;
    const id = await person({ main: key, claimed: uniq('cn'), projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    const ok = repoFetch();
    assert.deepEqual(await coinBranchProof(id, key, new Date(), { ghFetch: ok.f }), { ok: true });
    assert.deepEqual(ok.reads, [`/repos/${key}`], 'one launch-time read of the repo');
    // repo_owner (discovery, from history): never a shortcut; the proof branch is asked.
    const org = `${uniq('coinorg')}/app`;
    const p2 = await person({ main: org, claimed: uniq('co'), projects: [{ key: org, name: 'App', confirmed: true }] });
    await setProof(p2, org, 'repo_owner');
    const g2 = await coinBranchProof(p2, org, new Date(), { ghFetch: repoFetch({ owner: { login: org.split('/')[0], type: 'Organization' } }).f });
    assert.ok('proof' in g2, JSON.stringify(g2));
    // Another person holds the repo: taken (never the shortcut).
    const held = `${uniq('held')}/recipes`;
    const holder = await person({ main: held, claimed: uniq('h1'), projects: [{ key: held, name: 'Recipe planner', confirmed: true }] });
    const p3 = await person({ main: held, claimed: uniq('h2'), projects: [{ key: held, name: 'Recipe planner', confirmed: true }] });
    await sql()`UPDATE builder_sources SET verified_at = now() - interval '1 day' WHERE builder_id = ${holder}`;
    assert.deepEqual(await coinBranchProof(p3, held, new Date(), { ghFetch: repoFetch().f }), { line: takenLine('recipes') });
    // A sign-in repo that became a fork.
    const fk = `${uniq('fork')}/recipes`;
    const p4 = await person({ main: fk, claimed: uniq('fk'), projects: [{ key: fk, name: 'Recipe planner', confirmed: true }] });
    await setProof(p4, fk, 'github_signin');
    assert.deepEqual(await coinBranchProof(p4, fk, new Date(), { ghFetch: repoFetch().f }), { ok: true }, 'a sign-in passes while the repo reads the same');
    const g4 = await coinBranchProof(p4, fk, new Date(), { ghFetch: repoFetch({ fork: true }).f });
    assert.ok(!('ok' in g4), 'now a fork: no shortcut');
  }),
);

test('O2 fix round 1 (ruling 3): every state ends on one question with a yes route: grants, the suggestion, a different project (failed and taken; taken never offers an entry), the week\'s update', dbTest, () =>
  on(async () => {
    const tell = (id: number, m: Record<string, unknown>) => tools.tell({ move_up: m }, { installationId: id } as never) as Promise<R>;
    const lastQ = (t: string) => t.split('\n').filter((l) => l.includes('?'));
    // Confirmed, updates declined, nothing pending: grants that fit; the yes lists them or says none.
    const key = `${uniq('gr')}/recipes`;
    const id = await person({ main: key, claimed: uniq('gr'), seen: { declined: { [`updates:${key}`]: new Date().toISOString() } }, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    const r = await find(id, {}, NO_MATCH);
    assert.ok(r.show_to_builder.endsWith(grantsAsk('Recipe planner')), r.show_to_builder);
    assert.equal(lastQ(r.show_to_builder).length, 1);
    const g = await tell(id, { kind: 'grants', project_key: key, answer: 'yes' });
    assert.ok(g.show_to_builder.length > 0, 'the yes answers');
    // Posting on and done this week: the week's update.
    await sql()`UPDATE builder_profiles SET updates_on_at = now(), updates_scheduled_at = now() WHERE builder_id = ${id}`;
    assert.ok((await find(id, {}, NO_MATCH)).show_to_builder.endsWith(POST_UPDATE_ASK));
    // O3 fix round 1: another person's row for the same key this week is not this person's post.
    const other = await install();
    const monday = mondayOf(new Date());
    await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, facts) VALUES (${other}, ${key}, ${monday}, 'Not theirs.', '{}'::jsonb)`;
    assert.ok((await find(id, {}, NO_MATCH)).show_to_builder.endsWith(POST_UPDATE_ASK), 'only their own post counts');
    // O3: their own post this week: never offered again (it would replace it); grants instead.
    await sql()`UPDATE project_updates SET builder_id = ${id} WHERE project_key = ${key} AND week = ${monday}`;
    assert.ok((await find(id, {}, NO_MATCH)).show_to_builder.endsWith(grantsAsk('Recipe planner')));
    await sql()`DELETE FROM project_updates WHERE project_key = ${key}`;
    // No project, nothing to build: the suggestion; the yes suggests.
    const n = await install();
    const s0 = await find(n, { agent_can_build: true }, { freshDeps: { ...OWN_FRESH, deployOn: () => false } });
    assert.ok(s0.show_to_builder.includes(NO_OFFER_LINE) && s0.show_to_builder.endsWith(SUGGEST_ASK), s0.show_to_builder);
    const sy = await tell(n, { kind: 'suggest', project_key: null, answer: 'yes' });
    assert.match(sy.show_to_builder, /^A few small things you could build this week:\n- /);
    // Failed (the branch never showed in the hour): a different project; the yes asks the agent for it.
    const f = await install();
    const fk = `${uniq('fl')}/recipes`;
    await find(f, named(fk), NO_MATCH);
    await sql()`UPDATE proof_branches SET issued_at = issued_at - interval '2 hours', expires_at = expires_at - interval '2 hours' WHERE builder_id = ${f}`;
    const fr = await find(f, {}, NO_MATCH);
    assert.equal(fr.show_to_builder.split('\n')[1], cantShowLine('recipes'), fr.show_to_builder);
    assert.ok(fr.show_to_builder.endsWith(OTHER_PROJECT_ASK), fr.show_to_builder);
    const fy = await tell(f, { kind: 'other_project', project_key: fk, answer: 'yes' });
    assert.match(fy.agent_note ?? '', /identity\.project/);
    // Taken, with a program that fits the held repo: never an entry, never its program, a different project.
    const ava = await avalanche();
    const held = `${uniq('tk')}/recipes`;
    await person({ main: held, claimed: uniq('t1'), projects: [{ key: held, name: 'Recipe planner', confirmed: true }] });
    const t = await install();
    const tr = await find(t, named(held), { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(ava.id, held) }) });
    assert.equal(tr.show_to_builder.split('\n')[1], takenLine('recipes'), tr.show_to_builder);
    assert.ok(!tr.show_to_builder.includes(ava.title), 'no program for a held repo');
    assert.equal(tr.lead, undefined);
    assert.notEqual(tr.move_up?.kind, 'enter');
    assert.ok(tr.show_to_builder.endsWith(OTHER_PROJECT_ASK), tr.show_to_builder);
    // needs_agent (a client that can't push): the updates yes, without "on the Bench".
    const c = await install();
    const cr = await find(c, { ...named(`${uniq('na')}/recipes`), agent_can_build: false }, NO_MATCH);
    assert.ok(cr.show_to_builder.endsWith(UPDATES_ASK_JOINING), cr.show_to_builder);
  }),
);

test('O2 fix round 1 (ruling 5): programs:check refuses the reserved id', () => {
  assert.equal(reservedIdProblem({ id: 'earnkit-bench' }), 'id: "earnkit-bench" is reserved for the Bench\'s starter build with no program');
  assert.equal(reservedIdProblem({ id: 'EarnKit-Bench' }) !== null, true);
  assert.equal(reservedIdProblem({ id: 'arc-microgrants' }), null);
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'programs-sync.mts'), 'utf8');
  assert.ok(src.indexOf('reservedIdProblem(result.data)') > 0 && src.indexOf('reservedIdProblem(result.data)') < src.indexOf('process.exit(1)'), 'a problem before the exit');
  assert.ok(!readdirSync(join(import.meta.dirname, '..', '..', '..', '..', 'programs')).includes('earnkit-bench.json'));
});

test('O2 fix round 1 (item 6): the no-program build\'s events (program_id earnkit-bench) never count as an entry, a program, a fit, the feed, stats or the bonus', dbTest, () =>
  on(async () => {
    const before = await readStats();
    const id = await install();
    const repo = `${uniq('ev')}/podtips`;
    for (const type of ['built', 'hosted'] as const)
      await sql()`INSERT INTO builder_events (type, installation_id, repo_key, program_id, dedupe_key, detail) VALUES (${type}, ${id}, ${repo}, ${BENCH_BUILD_ID}, ${`${type}:o2:${id}`}, '{}'::jsonb)`;
    const after = await readStats();
    for (const k of ['programs_open', 'bonus_programs_open'] as const) assert.equal(after[k as keyof typeof after], before[k as keyof typeof before], k);
    assert.equal((await sql()`SELECT 1 FROM projects WHERE installation_id = ${id} OR program_id = ${BENCH_BUILD_ID}`).length, 0, 'no entry');
    assert.equal((await sql()`SELECT 1 FROM programs WHERE id = ${BENCH_BUILD_ID}`).length, 0, 'no program');
    assert.ok(!(await listPrograms()).some((p) => p.id === BENCH_BUILD_ID), 'never a fit or an idea');
    assert.equal((await sql()`SELECT 1 FROM bonus_ledger WHERE program_id = ${BENCH_BUILD_ID}`.catch(() => [])).length, 0, 'no bonus');
    assert.equal((await sql()`SELECT 1 FROM feed_cards WHERE builder_id = ${id}`.catch(() => [])).length, 0, 'no feed card');
  }),
);

test('O2 fix round 1 (minors): the twist step says "Building your tip jar"; invalid repo_facts clear nothing; flag off writes no done_at', dbTest, () =>
  on(async () => {
    const id = await install();
    const ctx = { installationId: id, freshDeps: OWN_FRESH } as never;
    await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    await tools.tell({ move_up: { kind: 'build', project_key: null, answer: 'yes' } }, ctx);
    await tools.prepare({ program_id: BENCH_BUILD_ID, build: { start: true, program_id: BENCH_BUILD_ID } }, ctx);
    const mid = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
    assert.equal(mid.show_to_builder.split('\n')[1], buildingNowLine('your tip jar'));
    // not_mine inside input tell's schema refuses changes nothing.
    const k = `${uniq('inv')}/recipes`;
    const p = await install();
    await find(p, named(k), NO_MATCH);
    await tools.tell({ repo_facts: [{ repo: k, not_mine: true, bogus: 1 }] }, { installationId: p } as never).catch(() => null);
    assert.equal(await mainProjectOf(p), k);
    // Flag off: the live link writes no done_at.
    await withEnv({ EARNKIT_BENCH: undefined }, async () => {
      const src = readFileSync(join(import.meta.dirname, 'tools.ts'), 'utf8');
      assert.match(src, /if \(live && benchEnabled\(\)\) await saveBuild\(ctx\.installationId, \{ \.\.\.stored, done_at/);
    });
  }),
);
