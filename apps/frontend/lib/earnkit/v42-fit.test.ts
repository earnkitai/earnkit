import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MatchProjectsInput, matchProjects, type MatchDeps } from './match-projects';
import { NO_USERS_YET, NEEDS_USERS, productOdds, productScore, traction, type ProgramFacts } from './match';

/**
 * v4.2 Task 4 (F5, F6, F7): odds use what the builder told EarnKit; one lead (the money line's program); a
 * submitted entry stays submitted. The pure and matcher parts run without a database; the rest are below.
 */
const T_NOW = new Date('2026-10-08T12:00:00Z');
const program: ProgramFacts = {
  id: 'base-x', title: 'Base X', chains: ['base'], any_chain: false, existing_work: 'allowed', tag: null,
  starts_at: null, investment: false, min_product_score: 0,
};
const deps = (): MatchDeps => ({
  now: T_NOW,
  cache: { load: async () => null, save: async () => {} },
  checks: {
    probe: async () => {},
    getCode: async () => '0x6080',
    cache: { get: async () => null, set: async () => {} },
    txCounter: async () => 0,
  },
  programs: [program],
});
const said = (has_users: boolean | null) => ({ 'name:tipjar': { mainnet: [], testnet: [], live_url: 'https://tipjar.xyz', has_users, not_mine: false } });
const ADDR = '0x1111111111111111111111111111111111111111';
const local = { name: 'tipjar', chains: ['base'], contracts: [ADDR], live_url: 'https://tipjar.xyz', last_commit_at: '2026-10-01T00:00:00Z' };

test('F5: productOdds with a told "has users" never says no users yet when the measured count is 0', () => {
  const p = { ...productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true }, []), score: 0 };
  const t = { tx_count: 0, live_ok: true, commits_90d: 3 };
  const score = traction(t);
  assert.equal(productOdds(p, t, score).low_reason, NO_USERS_YET, 'nothing told: still no users yet');
  const told = productOdds(p, t, score, { saidUsers: true });
  assert.notEqual(told.odds, 'low');
  assert.notEqual(told.low_reason, NO_USERS_YET);
  // A told "no" still reads no users yet.
  assert.equal(productOdds(p, t, score, { saidNoUsers: true }).low_reason, NO_USERS_YET);
});

test('F5: a repo the builder said has users is not low for "no users yet" or "needs real users" (local and told-in-matcher)', async () => {
  const r = await matchProjects(MatchProjectsInput.parse({ local_repos: [local], said: said(true) }), deps());
  const f = r.fits[0];
  assert.notEqual(f.product.low_reason, NO_USERS_YET, JSON.stringify(f.product));
  assert.notEqual(f.product.odds, 'low', JSON.stringify(f.product));
  for (const v of f.verdicts) assert.ok(!v.missing.includes('real_users') && v.note !== NEEDS_USERS, JSON.stringify(v));
  // Nothing told: the measured zero still reads low, no users yet.
  const none = await matchProjects(MatchProjectsInput.parse({ local_repos: [local], said: said(null) }), deps());
  assert.equal(none.fits[0].product.low_reason, NO_USERS_YET, JSON.stringify([none.fits[0].product, f.product]));
});

// ---- F6: one lead, the money line's program (database)

import { after } from 'node:test';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { committedProgram } from './fixtures/program-file';
import { dropPrograms } from './fixtures/programs-cleanup';
import { walletOffered } from './fixtures/wallet-step';
import { padPool } from './fixtures/rank-pool';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { productOdds as odds2, productScore as score2, traction as traction2, type Detection } from './match';
import type { RepoFit } from './present';
import { openEntries, submittedEntry } from './projects';
import { tools } from './tools';

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v42-fit-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
const RUN = String(process.pid % 100000);
const made: string[] = [];
const parked: string[] = [];
after(async () => {
  if (!process.env.DATABASE_URL) return;
  if (parked.length > 0) await sql()`UPDATE programs SET status = 'active' WHERE id = ANY(${parked}::text[])`;
  await dropPrograms(made);
  await sql().end();
});

function matchFor(key: string, ids: string[]) {
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const p = score2({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const t = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...p, traction: traction2(t), ...odds2(p, t, p.score) };
  const facts = { name: key.split('/')[1], url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{
    repo: key.split('/')[1], repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true,
    verdicts: ids.map((id) => ({ program_id: id, program: id, status: 'likely' as const, missing: [], effort: 'none' as const, note: null })),
  }];
  return (async () => ({ checked: 1, scored: 1, fits })) as never;
}

test('F6: the lead is the money line\'s program (closing soonest), not the first fit line; find and score agree', db, async () => {
  await padPool(9);
  await upsertProgram(ProgramFile.parse(committedProgram('base-builder-grants')));
  const closing = `v42fit-${randomBytes(4).toString('hex')}-${process.pid}`;
  made.push(closing);
  await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, ends_at, status, existing_work)
    VALUES (${closing}, 'Org', 'Soon Fund', 'x', 'https://example.com', 'https://example.com/apply', '$1,000', 'x', now() + interval '6 days', 'active', 'allowed')`;
  // Only these two are open, so the test never depends on today's real program list (restored after).
  parked.push(...(await sql()<{ id: string }[]>`UPDATE programs SET status = 'closed' WHERE status = 'active' AND id NOT IN (${closing}, 'base-builder-grants') RETURNING id`).map((r) => r.id));
  const t = `ek_f6_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `96${RUN}`, username: `f6${RUN}`.slice(0, 15), name: 'F6', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  await walletOffered(c.id);
  const key = `f6${RUN}/kit`;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: matchFor(key, ['base-builder-grants', closing]) };
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: c.id, repoKey: key, login: `f6${RUN}`, gh: fakeGitHub({ [key]: { id: 7301, owner: `f6${RUN}`, installation: 7301 } }) });
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb)
    || jsonb_build_object('apply_asked', (SELECT jsonb_object_agg(id, now()::text) FROM programs)) WHERE builder_id = ${c.id}`;
  const r = (await mcpCall(ctx, 'find', {})).reply!;
  const lead = (r.lead as { program_id: string } | undefined)?.program_id;
  const money = String(r.show_to_builder).split('\n')[1];
  assert.ok(money.includes('Soon Fund'), `the money line names the closing program: ${r.show_to_builder}`);
  assert.equal(lead, closing, 'lead follows the money line');
  const sc = (await mcpCall({ ...ctx }, 'score', {})).reply!;
  // Score's own matcher reads the database (the fixture program has no chains there): its lead is still its own money line's.
  const scLead = (sc.lead as { program_id: string } | undefined)?.program_id;
  const [scTitle] = await sql()<{ title: string }[]>`SELECT title FROM programs WHERE id = ${scLead ?? ''}`;
  assert.ok(scTitle && String(sc.show_to_builder).split('\n')[1].includes(scTitle.title.replace(/^the\s+/i, '')), `${scLead}: ${sc.show_to_builder}`);
});

// ---- F7: a submitted entry stays submitted

test('F7: tell submitted marks the confirmed row (ownEntry reads it by id, by repo, by name); never a second row', db, async () => {
  const [{ id: inst }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash) VALUES (${`v42f7-${RUN}-${randomBytes(3).toString('hex')}`}) RETURNING id`;
  const program = `v42f7-${randomBytes(4).toString('hex')}-${process.pid}`;
  made.push(program);
  await sql()`INSERT INTO programs (id, organizer, title, description, source_url, submission_url, reward, summary, ends_at, status, existing_work)
    VALUES (${program}, 'Org', 'Grants F7', 'x', 'https://example.com', 'https://example.com/apply', '$1', 'x', now() + interval '20 days', 'active', 'allowed')`;
  const repo = `https://github.com/f7${RUN}/kit`;
  const draft = async (name: string, repoUrl: string | null) => (await sql()<{ id: number }[]>`
    INSERT INTO projects (program_id, name, repo_url, bonus_repo_key, installation_id, confirmed_at)
    VALUES (${program}, ${name}, ${repoUrl}, ${repoUrl}, ${inst}, now()) RETURNING id`)[0].id;
  const rows = async () => (await sql()<{ id: number; submitted: boolean }[]>`SELECT id, submission_confirmed_at IS NOT NULL AS submitted FROM projects WHERE program_id = ${program} ORDER BY id`).map((r) => ({ id: r.id, submitted: r.submitted }));
  const ctx = { installationId: inst };

  // The SQL ownEntry runs for a repo call: the one draft row, matched on bonus_repo_key, payout_wallet IS NULL.
  const id1 = await draft('Kit', repo);
  const own = await sql()<{ id: number }[]>`SELECT id FROM projects WHERE program_id = ${program} AND installation_id = ${inst} AND payout_wallet IS NULL AND bonus_repo_key = ${repo}`;
  assert.deepEqual(own.map((x) => x.id), [id1]);
  assert.equal((await openEntries(inst)).find((e) => e.id === id1)?.submitted, false, 'asked "Did you submit it?" until told');

  // An old agent's call carries a project without the repo: the draft row (which has one) is still the entry.
  await tools.tell({ submitted: { program_id: program, project: { name: 'Kit' } } }, ctx);
  assert.deepEqual(await rows(), [{ id: id1, submitted: true }], 'one row, now submitted');
  assert.equal((await openEntries(inst)).find((e) => e.id === id1)?.submitted, true);

  // By project id (the lead's): same row, no second one.
  const id2 = await draft('Other', `${repo}2`);
  await tools.tell({ submitted: { program_id: program, project_id: id2 } }, ctx);
  assert.deepEqual((await rows()).map((x) => x.submitted), [true, true]);
  assert.equal((await rows()).length, 2);
  assert.equal((await submittedEntry(inst, program, id2))?.id, id2);

  // Repeating it changes nothing.
  await tools.tell({ submitted: { program_id: program, project_id: id2 } }, ctx);
  assert.equal((await rows()).length, 2);
});
