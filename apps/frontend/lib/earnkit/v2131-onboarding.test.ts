import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools } from './tools';
import { EVENT_LOG_FLAG } from './events';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, dropAvalanche, find, install, person, withEnv } from './fixtures/find';
import { NO_PROJECT_LINE, UPDATES_ASK, benchBuildAsk, buildingNowLine } from './bench-reply';
import { BENCH_BUILD_ID, TWIST_QUESTION } from './fresh-build';
import { mainProjectOf } from './main-project';
import { coinBranchProof } from './proof-branch';

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
const openCodes = (id: number) => sql()<{ repo_key: string }[]>`SELECT repo_key FROM proof_branches WHERE builder_id = ${id} AND used_at IS NULL`;
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
    assert.deepEqual((await openCodes(id)).map((x) => x.repo_key), [b], "the old key's open code is cleared");
    assert.equal((r.proof as { repo?: string } | undefined)?.repo, b);
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
    assert.ok(r.show_to_builder.endsWith(UPDATES_ASK), r.show_to_builder);
    assert.equal(r.move_up?.kind, 'updates');
    assert.equal(r.show_to_builder.split('\n').filter((l) => l.includes('?')).length, 1, 'one question');
  }),
);

test('O2.10 a coin: the Bench-confirmed main project (any confirmed proof, here a proof line) passes with no line and no GitHub read; another repo does not', dbTest, () =>
  on(async () => {
    const key = `${uniq('coin')}/recipes`;
    const id = await person({ main: key, claimed: uniq('cn'), projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    const reads: string[] = [];
    const f = (async (u: RequestInfo | URL) => {
      reads.push(String(u));
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    assert.deepEqual(await coinBranchProof(id, key, new Date(), { ghFetch: f }), { ok: true });
    assert.deepEqual(reads, []);
    const other = await coinBranchProof(id, `${uniq('coin')}/other`, new Date(), { ghFetch: f });
    assert.ok(!('ok' in other), 'a repo that is not the confirmed main project still needs its proof branch');
  }),
);
