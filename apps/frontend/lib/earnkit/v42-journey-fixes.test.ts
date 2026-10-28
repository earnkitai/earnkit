import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitGate, type FitRepo, type NewProgram } from './alerts';
import { checkFitsAsk, setupDoneReply } from './bench-reply';
import { eligibilityLine } from './tools';
import { after } from 'node:test';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { appEnv } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { CHECK_FITS_NOTE, scoreApplies } from './bench-find';
import { scoreFits } from './stand-view';

/** v4.2 Task 10: fixes found by re-running the simulated builder journeys (pure parts). */
const rows = [{ program: 'Base Builder Grant Program', upTo: '$5,000', closes: 'Rolling' }];

test('G1: fits not known yet: the fit-check question; known and none: the table alone, no question', () => {
  const asked = setupDoneReply('Dev', 'skipped', rows, 'x', { check: 'VaultPilot' });
  assert.ok(asked.endsWith('Want me to check which of these fits VaultPilot?'), asked);
  assert.equal(checkFitsAsk('Kit'), 'Want me to check which of these fits Kit?');
  const none = setupDoneReply('Dev', 'skipped', rows, 'x', { noAsk: true });
  assert.ok(none.endsWith('| Base Builder Grant Program | $5,000 | Rolling |'), none);
  assert.doesNotMatch(none, /\?|closest/);
});

test('G1: a told "has users" on a verified live link overrides a stored "no users yet"; without it the repo stays low', () => {
  const program = { id: 'p', title: 'P', chains: ['base'], any_chain: true, investment: false, min_product_score: 0, existing_work: 'allowed', tag: null, starts_at: null } as unknown as NewProgram;
  const repo = {
    key: 'a/b', name: 'b', url: 'https://github.com/a/b', homepage: null, created_at: '2026-01-01T00:00:00Z', live_verified: true, tx_count: null,
    chains: { base: { mainnet: true, testnet: false, evidence: 'deployed', basis: 'deployed' } },
    product: { odds: 'low', tier: 'product', score: 5, missing: [], traction: 3, low_reason: 'no users yet' },
    said: null,
  } as unknown as FitRepo;
  assert.equal(fitGate(program, repo, { apply: true }), 'odds');
  const told = { ...repo, said: { mainnet: [], testnet: [], live_url: null, has_users: true, not_mine: false } } as FitRepo;
  assert.notEqual(fitGate(program, told, { apply: true }), 'odds');
});

test('G3: a told users claim reads "confirm users", not "needs real users"', () => {
  assert.equal(eligibilityLine('a/b', { status: 'after_step', missing: [], effort: null, note: 'confirm: users.' }), 'a/b fits after one step: confirm users.');
});

appEnv();
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
let n = 0;
async function person(tag: string) {
  n++;
  const t = `ek_v42jf_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `jf${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `93${RUN}${n}${tag.length}`, username: handle, name: 'Jo Fix', avatar: null }, new Date())).ok);
  return { c: (await connectInstallation(t))!, handle };
}

test('G1: the yes to the fit-check question is the instruction to run find', db, async () => {
  const { c, handle } = await person('ck');
  const key = `${handle}/kit`;
  await sql()`UPDATE builder_profiles SET main_project_key = ${key}, standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', jsonb_build_object('kind', 'qualify', 'key', ${key}::text, 'check', true)) WHERE builder_id = ${c.id}`;
  const r = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: false } as never, 'tell', { move_up: { kind: 'qualify', project_key: key, answer: 'yes' } });
  assert.equal(r.reply?.agent_note, CHECK_FITS_NOTE);
  assert.equal(String(r.reply?.show_to_builder ?? ''), '');
});

test('G1: the told-facts overlay in scoreFits affects only the told repo', db, async () => {
  const { c, handle } = await person('ov');
  const repo = (key: string) => ({
    key, name: key.split('/')[1], url: `https://github.com/${key}`, homepage: 'https://x.app', created_at: '2026-01-01T00:00:00Z', live_verified: true, tx_count: null, said: null,
    chains: { base: { basis: 'deployed', mainnet: true, testnet: false, evidence: 'a contract with code on Base mainnet' } },
    product: { odds: 'low', tier: 'product', score: 5, missing: [], traction: 3, low_reason: 'no users yet' },
  });
  const a = `${handle}/told`; const b = `${handle}/untold`;
  await sql()`UPDATE installations SET fit_repos = ${sql().json([repo(a), repo(b)] as never)} WHERE id = ${c.id}`;
  await sql()`INSERT INTO builder_repo_facts (installation_id, login, repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine)
    VALUES (${c.id}, '', ${a}, '{}', '{}', 'https://x.app', true, false)`;
  const now = new Date();
  const { cards } = await scoreApplies(c.id, null, now);
  const withTold = await scoreFits(c.id, a, { cards, skip: new Set(), now });
  const withoutTold = await scoreFits(c.id, b, { cards, skip: new Set(), now });
  assert.ok(withTold.length > 0, 'the told repo fits');
  assert.equal(withoutTold.length, 0, 'the untold repo stays low');
});
