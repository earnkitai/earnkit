import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { tools } from './tools';
import { EVENT_LOG_FLAG } from './events';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, claimX, dropAvalanche, find, fitsFor, install, person, withEnv } from './fixtures/find';
import { NOT_ON_BENCH, OTHER_PROJECT_ASK, STATE_COPY, VARIANT_COPY, shipAsk } from './bench-reply';
import { mainProjectOf } from './main-project';

/**
 * v2.13.1 O2: the reply-side fixes of the first-run audit, through the real tools under the Bench
 * flag: B1 (no project: the starter build with no program), B2 (the claim link with no project), B4
 * (no ask while a build is in progress), B6 (the one project can change until it is confirmed), the
 * page link once claimed, build_offer with no note, the last line one question that fits, and the
 * coin gate for any confirmed main project.
 */

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
const ON = { EARNKIT_URL: undefined, [EVENT_LOG_FLAG]: 'on', ...X_ON };
const on = <T>(fn: () => Promise<T>) => withEnv(ON, fn);
const NO_MATCH = { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) };
/** Only this file's starter (no program names it), so no program qualifies for a fresh build: the build with no program. */
const STARTER_ID = `o2-tip-${RUN}`;
const OWN_FRESH = { deployOn: () => true, hostOn: true, canBuild: true, starters: { [STARTER_ID]: { ...TESTED_STARTERS['arc-tipjar'], id: STARTER_ID } } };
const named = (repo: string) => ({ agent_can_build: true, identity: { github_login: repo.split('/')[0], project: { name: repo.split('/')[1], what: 'a thing', repo } } });
type R = { show_to_builder: string; agent_note?: string; build_offer?: Record<string, unknown>; move_up?: { kind: string }; kit?: unknown };

test('O2.1c no project, nothing EarnKit can build (deploys off): no "Pick something", no question pointing nowhere (v2.14 T7: no claim link)', dbTest, () =>
  on(async () => {
    const id = await install();
    const r = await find(id, { agent_can_build: true }, { freshDeps: { ...OWN_FRESH, deployOn: () => false } });
    assert.doesNotMatch(r.show_to_builder, /Pick something to build/);
    // v2.13.3 (3), ruling A: the stand line alone, then existing work and money it can win.
    assert.match(r.show_to_builder, /^You're not on the Bench yet\.$/m);
    // v2.14 T9: signed out: the sign-in link is the one ask.
    assert.equal(r.move_up?.kind, 'sign_in');
    assert.equal((r as { claim?: unknown }).claim, undefined);
    assert.equal(r.build_offer, undefined);
    // An open program may be named with what it needs (v2.13.3 (2)), never the raw tag.
    assert.doesNotMatch(r.show_to_builder, /needs a live/);
  }),
);

test('O2.4 B6: a newer project replaces an unconfirmed one; not_mine clears it; once confirmed it never changes', dbTest, () =>
  on(async () => {
    const id = await install();
    const a = `${uniq('wrong')}/linux`;
    const b = `${uniq('maya')}/recipes`;
    await find(id, named(a), NO_MATCH);
    assert.equal(await mainProjectOf(id), a);
    const r = await find(id, named(b), NO_MATCH);
    assert.equal(await mainProjectOf(id), b);
    // v2.14 spec 2: no proof branch for either key, so nothing to close or delete.
    assert.equal((r as unknown as { proof?: unknown }).proof, undefined);
    assert.equal((r as unknown as { remove_branch?: unknown }).remove_branch, undefined);
    assert.equal(r.move_up?.kind, 'sign_in', 'v2.14 T9: signed out, the project is not named yet');
    // not_mine on the current one clears it; the next project the agent names is the one.
    await tools.tell({ repo_facts: [{ repo: b, not_mine: true }] }, { installationId: id } as never);
    assert.equal(await mainProjectOf(id), null);
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

test('O2.9 the last line is one question that fits: no open-all-year grant for another chain, a project being checked is never asked the updates yes (v2.14 spec 3)', dbTest, () =>
  on(async () => {
    const ava = await avalanche();
    const id = await install();
    await claimX(id); // v2.13.4: the asks after the X claim
    const r = await find(id, named(`${uniq('maya')}/hello`), NO_MATCH);
    // v2.13.3 (2): a chain grant is named only with what it needs ("for an Avalanche app"), never as a fit.
    assert.ok(!r.show_to_builder.includes(`${ava.title} pays`), 'a chain grant that does not fit the project is never claimed');
    assert.match(r.show_to_builder, /^Ways to get funded$/m);
    assert.doesNotMatch(r.show_to_builder, /How to move up\n.*on the Bench/, 'not on the Bench yet');
    assert.doesNotMatch(r.show_to_builder, /post what you ship/);
    assert.notEqual(r.move_up?.kind, 'updates');
    assert.equal(r.show_to_builder.split('\n').filter((l) => l.includes('?')).length, 1, 'one question');
  }),
);

test('O2 fix round 1 (ruling 3): every state ends on one question with a yes route: grants, the suggestion, a different project (taken never offers an entry)', dbTest, () =>
  on(async () => {
    const tell = (id: number, m: Record<string, unknown>) => tools.tell({ move_up: m }, { installationId: id } as never) as Promise<R>;
    const lastQ = (t: string) => t.split('\n').filter((l) => l.includes('?'));
    // Confirmed, nothing pending: the community round once (ruling A), then one small thing to ship (v2.14 A16).
    const key = `${uniq('gr')}/recipes`;
    const id = await person({ main: key, claimed: uniq('gr'), projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    await find(id, {}, NO_MATCH);
    const r = await find(id, {}, NO_MATCH);
    assert.ok(r.show_to_builder.endsWith(shipAsk('Recipe planner')), r.show_to_builder);
    assert.equal(lastQ(r.show_to_builder).length, 1);
    const g = await tell(id, { kind: 'suggest', project_key: key, answer: 'yes' });
    assert.match(g.agent_note ?? '', /one small thing/);
    // No project, nothing to build: v2.13.3 ruling A, existing work; the yes asks the agent for it.
    const n = await install();
    await claimX(n); // v2.13.4: the asks after the X claim
    const s0 = await find(n, { agent_can_build: true }, { freshDeps: { ...OWN_FRESH, deployOn: () => false } });
    assert.ok(s0.show_to_builder.includes(NOT_ON_BENCH) && s0.show_to_builder.endsWith(STATE_COPY.no_project.ask()), s0.show_to_builder);
    const sy = await tell(n, { kind: 'start', project_key: null, answer: 'yes' });
    assert.match(sy.agent_note ?? '', /identity/);
    // Taken, with a program that fits the held repo: never an entry, never its program, a different project.
    const ava = await avalanche();
    const held = `${uniq('tk')}/recipes`;
    const h1 = await person({ main: held, claimed: uniq('t1'), projects: [{ key: held, name: 'Recipe planner', confirmed: true }] });
    // v2.14 T6 fix round 1: only an App hold keeps a repo from another person.
    await sql()`UPDATE builder_sources SET proof = 'github_app', app_checked_at = now() WHERE builder_id = ${h1} AND kind = 'repo'`;
    const t = await install();
    await claimX(t);
    const tr = await find(t, named(held), { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(ava.id, held) }) });
    assert.ok(tr.show_to_builder.includes(`Where you stand\n${VARIANT_COPY.taken.stand('Recipes')}\n`), tr.show_to_builder);
    assert.ok(!tr.show_to_builder.includes(`${ava.title} pays`), 'no program claimed for a held repo');
    assert.equal(tr.lead, undefined);
    assert.notEqual(tr.move_up?.kind, 'enter');
    assert.ok(tr.show_to_builder.endsWith(OTHER_PROJECT_ASK), tr.show_to_builder);
    // needs_agent (a client that can't push): O5 N15, never the weekly-posting yes it can't schedule.
    const c = await install();
    await claimX(c);
    const cr = await find(c, { ...named(`${uniq('na')}/recipes`), agent_can_build: false }, NO_MATCH);
    assert.match(cr.show_to_builder, /Recipes isn't counted yet\./, cr.show_to_builder);
    assert.equal(lastQ(cr.show_to_builder).length, 1);
  }),
);
