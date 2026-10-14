import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_SHARED, scoreReply } from './score-tool';
import { listPrograms, upsertProgram } from './programs';
import { ProgramFile } from './program-file';
import { committedProgram } from './fixtures/program-file';
import { siteShowsUse, verifiedProject } from './builder-score';
import { discover } from './discovery';
import type { ReaderDeps } from './source-readers';
import { profileCode } from './discovery-clues';
import { sql } from './db';

/**
 * The score tool's own cases. v2.12.1 T12: v2.12's score reply (score out of 100, top N%, the
 * earnkit.txt fill steps and the card offer) is gone; the v2.12.1 reply (where you stand, ways to
 * earn, how to move up) is covered by v2121-find.test.ts and v2121-journey.test.ts.
 */
const NOW = new Date('2026-10-12T12:00:00Z');

test('8.5 a shared client gets one plain line and nothing is read', async () => {
  assert.deepEqual(await scoreReply({ installationId: 1, sharedClient: true }, NOW), { show_to_builder: SCORE_SHARED });
});

// ---- With a database.

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const T = 2_141_000_000 + Math.floor(Math.random() * 200_000) * 20;
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await sql()`DELETE FROM builder_sources WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM discovery_queue WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_projects WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_live WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql()`DELETE FROM builder_profiles WHERE builder_id BETWEEN ${T} AND ${T + 19}`;
  await sql().end();
});
const SECRET = 's'.repeat(40);
async function withEnv<R>(env: Record<string, string>, fn: () => Promise<R>): Promise<R> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}
const profile = (id: number, o: { held?: boolean } = {}) =>
  sql()`INSERT INTO builder_profiles (builder_id, slug, held) VALUES (${id}, ${`s${id}`}, ${o.held ?? false})`;
const source = (id: number, kind: string, ref: string, state: string, proof: string | null = null, project_key = ref) =>
  sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by) VALUES (${id}, ${kind}, ${ref}, ${project_key}, ${state}, ${proof}, 'server')`;
const project = (id: number, key: string, confirmed: boolean, people: number, money: number) =>
  sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people, money_usd)
    VALUES (${id}, ${key}, 'app', 'app', ${confirmed}, true, ${people}, ${money})`;

test('8.12 (v2.12.1 S9) discovery no longer reads earnkit.txt: a repo-linked site keeps its repo_link proof', dbTest, async () => {
  const id = T + 5;
  await profile(id);
  await source(id, 'site', 'https://app.lee.dev', 'verified', 'repo_link', `lee${T}/app`);
  await source(id, 'site', `https://lee${T}.github.io/app/`, 'verified', 'repo_link', `lee${T}/app`);
  await sql()`INSERT INTO discovery_queue (builder_id, reason) VALUES (${id}, 'local_repo')`;
  const read: string[] = [];
  const no = async () => {
    throw new Error('unexpected');
  };
  const reader: ReaderDeps = {
    gh: no, ghGraphql: no, tokenTransfers: no, probe: no, json: no, baseTxs: no, contractOrigin: no, arcLogs: no, arcHead: no, arcSender: no, usdPerNative: no, walletCreations: no, now: NOW,
    fetchText: async (url) => {
      read.push(url);
      if (url === 'https://app.lee.dev/earnkit.txt') return `profile: ${profileCode(id, 'https://app.lee.dev', SECRET)}\n`;
      throw new Error('not found');
    },
  };
  await withEnv({ EARNKIT_AUTH_SECRET: SECRET }, () => discover(NOW, { deadline: Date.now() + 30_000, reader, login: async () => null, only: [id] }));
  assert.deepEqual(read, []);
  const rows = await sql()<{ ref: string; proof: string }[]>`SELECT ref, proof FROM builder_sources WHERE builder_id = ${id} ORDER BY id`;
  assert.deepEqual(rows.map((r) => r.proof), ['repo_link', 'repo_link']);
  assert.equal(siteShowsUse({ ...rows[0], project_key: `lee${T}/app` }), false);
});

test('9.8 listPrograms carries agent_completable, so the score tool never names a program the agent cannot complete', dbTest, async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const hard = { ...committedProgram('colosseum-worlds-fair'), id: `t9s-col-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  const easy = { ...committedProgram('arc-microgrants'), id: `t9s-arc-${stamp}`, status: 'active', ends_at: '2099-01-01T00:00:00Z' };
  await upsertProgram(ProgramFile.parse(hard));
  await upsertProgram(ProgramFile.parse(easy));
  const cards = await listPrograms();
  assert.equal(cards.find((c) => c.id === hard.id)?.agent_completable, false);
  assert.equal(cards.find((c) => c.id === easy.id)?.agent_completable, true);
  await sql()`UPDATE programs SET status = 'closed' WHERE id IN (${hard.id}, ${easy.id})`;
});

test('9.9 (v2.12.1 T12) odds read the person\'s live confirmed project: its people and money, for that repo only, never while a rescore is held', dbTest, async () => {
  const id = T + 15;
  await profile(id);
  await project(id, `Lee${T}/App`, true, 60, 600);
  await project(id, `lee${T}/draft`, false, 900, 9000);
  assert.deepEqual(await verifiedProject(id, `lee${T}/app`), { users: 60, money_usd: 600 });
  assert.equal(await verifiedProject(id, `lee${T}/draft`), null, 'not confirmed: nothing counts');
  assert.equal(await verifiedProject(id, `lee${T}/other`), null);
  assert.equal(await verifiedProject(T + 16, `lee${T}/app`), null, 'no profile: v2.10 traction');
  await sql()`INSERT INTO builder_live (builder_id, score, parts, ranked, shipped, people, formula, calibration, pending, computed_at)
    VALUES (${id}, 10, '{}', true, 1, 60, 'v2', 'v2-launch', ${sql().json({ score: 90 } as never)}, now())`;
  assert.equal(await verifiedProject(id, `lee${T}/app`), null, 'held for review: v2.10 traction');
  await sql()`DELETE FROM builder_live WHERE builder_id = ${id}`;
  await sql()`UPDATE builder_profiles SET held = true WHERE builder_id = ${id}`;
  assert.equal(await verifiedProject(id, `lee${T}/app`), null);
});
