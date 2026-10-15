import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { tools } from './tools';
import { EVENT_LOG_FLAG } from './events';
import { FRESH_ON } from './fixtures/fresh-build';
import { X_ON, avalanche, find, fitsFor, install, person, withEnv } from './fixtures/find';
import { UPDATES_ASK, buildAsk, confirmingLine } from './bench-reply';

/**
 * v2.13 T8: find and score under the Bench flag through the real tools: the three parts (where you
 * stand, ways to get funded, how to move up), the one question in the spec's order, the proof in
 * the same turn, the weekly-posting yes; flag off is v2.12.2's reply.
 */

process.env.EARNKIT_BUILDER_SCORE = 'on';
process.env.EARNKIT_BENCH = 'on';
process.env.EARNKIT_AUTH_SECRET ||= 'v213-find-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

/** Per-run suffix for keys unique across people (repo keys, X handles). */
const RUN = randomBytes(3).toString('hex');
const benchOn = <T>(fn: () => Promise<T>) => withEnv({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: 'on', [EVENT_LOG_FLAG]: 'on', ...X_ON }, fn);

/** A copy of Arc Microgrants (its fresh build is the tip jar) closing in 3 days, so the fresh pick has a dated program today. */
async function arcCopy() {
  const p = { ...committedProgram('arc-microgrants'), id: `v213-arc-${RUN}`, status: 'active', ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString() };
  await upsertProgram(ProgramFile.parse(p));
}

test('8.6 a fresh install with identity.project: the project named, Confirming, the claim link, the proof in the same turn', dbTest, () =>
  benchOn(async () => {
    const id = await install();
    const r = await find(id, { identity: { github_login: `mayav${RUN}`, project: { name: 'Recipe planner', what: 'a recipe planner', repo: `mayav${RUN}/recipes` } } }, { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) });
    const lines = r.show_to_builder.split('\n');
    assert.equal(lines[0], 'Where you stand');
    assert.equal(lines[1], confirmingLine('Recipe planner'));
    assert.match(lines[2], /^Claim your page with X: earnkit\.com\/claim\//);
    assert.match(r.proof?.line ?? '', /^token: /);
    assert.equal(r.schedule_daily_check, undefined, 'B18: no daily check under the flag');
  }),
);

test('8.7 a confirmed, claimed, ranked project: the spec 2a reply, and the updates yes turns posting on with the weekly task', dbTest, () =>
  benchOn(async () => {
    const p = await avalanche();
    const id = await person({ main: `mayaf${RUN}/recipes`, claimed: `mf${RUN}`, ranked: true, score: 60, projects: [{ key: `mayaf${RUN}/recipes`, name: 'Recipe planner', confirmed: true, weeks_shipping: 6 }] });
    const r = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id, `mayaf${RUN}/recipes`) }) });
    assert.match(r.show_to_builder, /^Recipe planner is on the Bench(: (top \d+(\.\d)?% of builders|#\d+ of \d+ builders))?, 6 weeks shipping\.$/m);
    assert.match(r.show_to_builder, new RegExp(`^${p.title} pays up to \\$10K and fits Recipe planner; it's open all year\\.$`, 'm'));
    assert.ok(r.show_to_builder.endsWith(UPDATES_ASK));
    assert.equal(r.move_up?.kind, 'updates');
    const yes = (await tools.tell({ move_up: { kind: 'updates', project_key: `mayaf${RUN}/recipes`, answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string; schedule_weekly_update?: string };
    assert.equal(yes.show_to_builder, "Done. I'll post what you ship here every week.");
    assert.ok(yes.schedule_weekly_update);
  }),
);

test('8.8 no project: ideas first, one build offer (spec 2b); its yes starts the build', dbTest, () =>
  benchOn(async () => {
    await arcCopy();
    try {
      const id = await install();
      const r = await find(id, { agent_can_build: true }, { freshDeps: FRESH_ON });
      assert.match(r.show_to_builder, /^You're not on the Bench yet\. Pick something to build and you're on it today\.$/m);
      assert.match(r.show_to_builder, /^Ways to get funded\n.+ pays .+ for .+\.$/m);
      assert.ok(r.show_to_builder.endsWith(buildAsk('a tip jar on Arc')));
      assert.ok(r.build_offer?.program_id);
      assert.deepEqual(r.move_up && { kind: r.move_up.kind, project_key: r.move_up.project_key }, { kind: 'build', project_key: null });
      // The yes starts the v2.11 build path for the program the ask named.
      const yes = (await tools.tell({ move_up: { kind: 'build', project_key: null, answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string; agent_note?: string };
      assert.equal(yes.show_to_builder, '');
      assert.ok(yes.agent_note?.includes(`build: { start: true, program_id: '${r.build_offer!.program_id}' }`), yes.agent_note);
    } finally {
      // Closed again at once, so no other file's fresh pick sees it.
      await sql()`UPDATE programs SET status = 'closed' WHERE id = ${`v213-arc-${RUN}`}`;
    }
  }),
);

test('8.9 flag off: the v2.12.2 reply ("Ways to earn right now"), no proof, no rank lines (review focus 4)', dbTest, () =>
  withEnv({ EARNKIT_BUILDER_SCORE: 'on', EARNKIT_BENCH: undefined, [EVENT_LOG_FLAG]: 'on', ...X_ON }, async () => {
    const id = await install();
    const r = await find(id, { identity: { projects: [{ name: 'TipJar', what: 'a tip jar', repo: `leeoff${RUN}/tipjar` }] } }, { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) });
    assert.ok(!r.show_to_builder.includes('Ways to get funded'));
    assert.ok(!r.show_to_builder.includes('Bench'));
    assert.match(r.show_to_builder, /^Ways to earn right now$/m);
    assert.equal(r.proof, undefined);
    assert.equal(r.rank_lines, undefined);
  }),
);

test('8.10 score under the flag: the same three parts, with rank_lines and the streak', dbTest, () =>
  benchOn(async () => {
    const id = await person({ main: `mayas${RUN}/recipes`, claimed: `ms${RUN}`, ranked: true, score: 60, projects: [{ key: `mayas${RUN}/recipes`, name: 'Recipe planner', confirmed: true, weeks_shipping: 3, streak: 3 }] });
    const r = (await tools.score({}, { installationId: id } as never)) as { show_to_builder: string; rank_lines: string[]; streak: number };
    assert.equal(r.show_to_builder.split('\n')[0], 'Where you stand');
    assert.equal(r.streak, 3);
    assert.ok(Array.isArray(r.rank_lines));
  }),
);

test('8.11 the yes is answered as asked: another kind is "Okay." and changes nothing; a no keeps that ask away 30 days', dbTest, () =>
  benchOn(async () => {
    const p = await avalanche();
    const key = `mayan${RUN}/recipes`;
    const id = await person({ main: key, claimed: `mn${RUN}`, projects: [{ key, name: 'Recipe planner', confirmed: true }] });
    const match = { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id, key) }) };
    const r = await find(id, {}, match);
    assert.equal(r.move_up?.kind, 'updates');
    const tell = (m: Record<string, unknown>) => tools.tell({ move_up: m }, { installationId: id } as never) as Promise<{ show_to_builder: string }>;
    assert.equal((await tell({ kind: 'post_update', project_key: key, answer: 'yes' })).show_to_builder, 'Okay.');
    assert.equal((await tell({ kind: 'updates', project_key: 'someone/else', answer: 'yes' })).show_to_builder, 'Okay.');
    const [{ on }] = await sql()<{ on: Date | null }[]>`SELECT updates_on_at AS on FROM builder_profiles WHERE builder_id = ${id}`;
    assert.equal(on, null, 'nothing turned on');
    assert.equal((await tell({ kind: 'updates', project_key: key, answer: 'no' })).show_to_builder, 'Okay.');
    // The next ask in the order: the program's entry.
    const again = await find(id, {}, match);
    assert.deepEqual(again.move_up && { kind: again.move_up.kind, project_key: again.move_up.project_key }, { kind: 'enter', project_key: key });
    assert.ok(again.show_to_builder.endsWith(`Want me to prepare an entry for ${p.title}?`), again.show_to_builder);
    const enter = (await tell({ kind: 'enter', project_key: key, answer: 'yes' })) as { show_to_builder: string; lead?: { program_id: string } };
    assert.deepEqual(enter.lead, { program_id: p.id });
  }),
);
