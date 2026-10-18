import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { committedProgram } from './fixtures/program-file';
import { tools } from './tools';
import { bindX } from './claim';
import { mcpCall } from './fixtures/mcp-call';
import { EVENT_LOG_FLAG } from './events';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { X_ON, avalanche, claimX, dropAvalanche, dropPrograms, find, fitsFor, install, person, withEnv } from './fixtures/find';
import type { Starter } from './starters';
import { START_ASK, UPDATES_ASK, checkingBranchLine, claimAsk } from './bench-reply';

/**
 * v2.13 T8: find and score under the Bench flag through the real tools: the three parts (where you
 * stand, ways to get funded, how to move up), the one question in the spec's order, the proof in
 * the same turn, the weekly-posting yes; flag off is v2.12.2's reply.
 */

process.env.EARNKIT_AUTH_SECRET ||= 'v213-find-secret';
const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropAvalanche();
  await sql().end();
});

/** Per-run suffix for keys unique across people (repo keys, X handles). */
const RUN = randomBytes(3).toString('hex');
/** A string as a literal inside a RegExp. */
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const benchOn = <T>(fn: () => Promise<T>) => withEnv({ [EVENT_LOG_FLAG]: 'on', ...X_ON }, fn);

/**
 * 8.8's own world (fix round 1): a copy of Arc Microgrants closing in 3 days whose fresh build is a
 * starter only this run's registry knows. Other files (real registry) never pick it, and this
 * file's pick is only it. Deleted at the end of the case.
 */
const ARC_ID = `v213-arc-${RUN}`;
const STARTER_ID = `v213-tip-${RUN}`;
const OWN_STARTERS = { [STARTER_ID]: { ...TESTED_STARTERS['arc-tipjar'], id: STARTER_ID } as unknown as Starter };
const OWN_FRESH = { deployOn: () => true, hostOn: true, canBuild: true, starters: OWN_STARTERS };
async function arcCopy() {
  const p = { ...committedProgram('arc-microgrants'), id: ARC_ID, status: 'active', ends_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), fresh_build: { starter: STARTER_ID } };
  await upsertProgram(ProgramFile.parse(p));
}

test('8.6 a fresh install with identity.project: the project named, Confirming (v2.13.1: the proof branch), the https claim link, the proof in the same turn', dbTest, () =>
  benchOn(async () => {
    const id = await install();
    const r = await find(id, { identity: { github_login: `mayav${RUN}`, project: { name: 'Recipe planner', what: 'a recipe planner', repo: `mayav${RUN}/recipes` } } }, { matchProjects: async () => ({ checked: 1, scored: 0, fits: [] }) });
    const lines = r.show_to_builder.split('\n');
    assert.equal(lines[0], 'Where you stand');
    assert.equal(lines[1], checkingBranchLine('Recipe planner'));
    // v2.13.4 (spec 2): the https claim link is the one ask, last.
    assert.match(r.claim?.link ?? '', /^https:\/\/earnkit\.com\/claim\//);
    assert.ok(r.show_to_builder.endsWith(claimAsk(r.claim!.link, 'Recipe planner')), r.show_to_builder);
    assert.match((r.proof as { branch?: string } | undefined)?.branch ?? '', /^earnkit-[a-z2-7]{12}$/);
    assert.equal(r.schedule_daily_check, undefined, 'B18: no daily check under the flag');
  }),
);

test('8.7 a confirmed, claimed, ranked project: the spec 2a reply, and the updates yes turns posting on with the weekly task', dbTest, () =>
  benchOn(async () => {
    const p = await avalanche();
    const id = await person({ main: `mayaf${RUN}/recipes`, claimed: `mf${RUN}`, ranked: true, score: 60, projects: [{ key: `mayaf${RUN}/recipes`, name: 'Recipe planner', confirmed: true, weeks_shipping: 6 }] });
    const r = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id, `mayaf${RUN}/recipes`) }) });
    assert.match(r.show_to_builder, /^Recipe planner is on the Bench(: (top \d+(\.\d)?% of builders|#\d+ of \d+ builders?))?, 6 weeks shipping\.$/m);
    assert.match(r.show_to_builder, new RegExp(`^${esc(p.title)} pays up to \\$10K and fits Recipe planner; it's open all year\\.$`, 'm'));
    // v2.13.3 owner ruling A: the best fit's entry is asked first; a no to it, then the updates yes.
    assert.ok(r.show_to_builder.endsWith(`Want me to prepare an entry for ${p.title}?`), r.show_to_builder);
    assert.equal(r.move_up?.kind, 'enter');
    await tools.tell({ move_up: { kind: 'enter', project_key: `mayaf${RUN}/recipes`, answer: 'no' } }, { installationId: id } as never);
    const r2 = await find(id, {}, { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id, `mayaf${RUN}/recipes`) }) });
    assert.ok(r2.show_to_builder.endsWith(UPDATES_ASK), r2.show_to_builder);
    assert.equal(r2.move_up?.kind, 'updates');
    const yes = (await tools.tell({ move_up: { kind: 'updates', project_key: `mayaf${RUN}/recipes`, answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string; schedule_weekly_update?: string };
    assert.equal(yes.show_to_builder, "Done. I'll post what you ship here every week.");
    assert.ok(yes.schedule_weekly_update);
    // Answered once: the same yes again changes nothing.
    assert.equal(((await tools.tell({ move_up: { kind: 'updates', project_key: `mayaf${RUN}/recipes`, answer: 'yes' } }, { installationId: id } as never)) as { show_to_builder: string }).show_to_builder, 'Okay.');
    // B18: the weekly-task note once more on the next find, then not again; posting off and on again: once more.
    const match = { matchProjects: async () => ({ checked: 1, scored: 1, fits: fitsFor(p.id, `mayaf${RUN}/recipes`) }) };
    assert.ok((await find(id, {}, match)).schedule_weekly_update);
    assert.equal((await find(id, {}, match)).schedule_weekly_update, undefined);
    await tools.tell({ updates: { on: false } }, { installationId: id } as never);
    await tools.tell({ updates: { on: true } }, { installationId: id } as never);
    assert.ok((await find(id, {}, match)).schedule_weekly_update);
  }),
);

test('8.8 no project: ideas first and existing work; no build offer (v2.14 A18)', dbTest, () =>
  benchOn(async () => {
    await arcCopy();
    try {
      const id = await install();
      // v2.13.4 (spec 2): unclaimed, the X claim is the one ask.
      const r0 = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
      assert.ok(r0.show_to_builder.endsWith(claimAsk(r0.claim!.link, null)), r0.show_to_builder);
      await claimX(id);
      const r = await find(id, { agent_can_build: true }, { freshDeps: OWN_FRESH });
      assert.match(r.show_to_builder, /^You're not on the Bench yet\.$/m);
      assert.match(r.show_to_builder, /^Ways to get funded\n/m);
      assert.ok(r.show_to_builder.endsWith(START_ASK), r.show_to_builder);
      assert.equal(r.build_offer, undefined);
      assert.equal(r.move_up?.kind, 'start');
    } finally {
      await dropPrograms([ARC_ID]);
    }
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
    // v2.13.3 owner ruling A: the program's entry first.
    assert.deepEqual(r.move_up && { kind: r.move_up.kind, project_key: r.move_up.project_key }, { kind: 'enter', project_key: key });
    assert.ok(r.show_to_builder.endsWith(`Want me to prepare an entry for ${p.title}?`), r.show_to_builder);
    const tell = (m: Record<string, unknown>) => tools.tell({ move_up: m }, { installationId: id } as never) as Promise<{ show_to_builder: string }>;
    assert.equal((await tell({ kind: 'updates', project_key: key, answer: 'yes' })).show_to_builder, 'Okay.');
    assert.equal((await tell({ kind: 'enter', project_key: 'someone/else', answer: 'yes' })).show_to_builder, 'Okay.');
    const [{ on }] = await sql()<{ on: Date | null }[]>`SELECT updates_on_at AS on FROM builder_profiles WHERE builder_id = ${id}`;
    assert.equal(on, null, 'nothing turned on');
    assert.equal((await tell({ kind: 'enter', project_key: key, answer: 'no' })).show_to_builder, 'Okay.');
    // The next ask in the order: the updates yes.
    const again = await find(id, {}, match);
    assert.deepEqual(again.move_up && { kind: again.move_up.kind, project_key: again.move_up.project_key }, { kind: 'updates', project_key: key });
    assert.equal(((await tell({ kind: 'updates', project_key: key, answer: 'yes' })) as { show_to_builder: string }).show_to_builder, "Done. I'll post what you ship here every week.");
  }),
);

// ---- Restored from v2121-find.test.ts in v2.14 T3 fix round 1: the live privacy and MCP-schema rules ----

test('8.21 a shared client never sees the view: find is the v2.11 short reply, and move_up gets an agent note', dbTest, () =>
  benchOn(async () => {
    const [{ id }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, shared_client) VALUES (${`v213-find-s-${randomBytes(6).toString('hex')}`}, true) RETURNING id`;
    const r = await find(id, {}, { sharedClient: true });
    assert.doesNotMatch(r.show_to_builder, /Where you stand/);
    const t = (await tools.tell({ move_up: { answer: 'yes' } }, { installationId: id, sharedClient: true } as never)) as { show_to_builder?: string; agent_note?: string };
    assert.equal(t.show_to_builder ?? '', '');
    assert.match(t.agent_note ?? '', /serves many builders/);
  }),
);

test('8.25 (final fix wave) find.identity reaches the handler through the MCP schema: the login and the project are stored', dbTest, () =>
  benchOn(async () => {
    const id = await person({ projects: [] });
    const r = await mcpCall({ installationId: id }, 'find', {
      identity: { github_login: 'lee', project: { name: 'TipJar', what: 'a tip jar', live_url: 'https://tip.example.com' } },
    });
    assert.equal(r.isError, false, r.text);
    assert.match(String(r.reply?.show_to_builder), /^Where you stand\n/m);
    const [p] = await sql()<{ reported_github: string | null; identity: { projects?: { name: string; what: string | null }[] } | null }[]>`
      SELECT reported_github, identity FROM builder_profiles WHERE builder_id = ${id}`;
    assert.equal(p.reported_github, 'lee');
    assert.deepEqual(p.identity?.projects?.map((x) => [x.name, x.what]), [['TipJar', 'a tip jar']]);
  }),
);

test('8.26 (final fix wave) tell.card reaches the card handler through the MCP schema: the share link for a claimed page', dbTest, () =>
  benchOn(async () => {
    const id = await person({ projects: [{ key: 'lee/notes', name: 'Notes', what: 'a notes app', confirmed: true, people: 14 }] });
    const handle = `v213c${randomBytes(3).toString('hex')}`;
    assert.equal((await bindX(id, { id: `v213c${randomBytes(6).toString('hex')}`, username: handle, name: handle, avatar: null }, new Date())).ok, true);
    const r = await mcpCall({ installationId: id }, 'tell', { card: 'yes' });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.reply?.show_to_builder, `Post it: https://earnkit.com/${handle}/share`);
  }),
);

