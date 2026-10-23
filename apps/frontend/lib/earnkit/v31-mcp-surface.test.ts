import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { mcpCall, mcpListTools } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { install, withEnv } from './fixtures/find';
import { committedProgram } from './fixtures/program-file';
import { dropRunPrograms } from './fixtures/programs-cleanup';
import { TESTED_STARTERS } from './fixtures/fresh-build';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { lastFinishedMonday } from './weeks';
import { COIN_YES_NOTE } from './coin-moments';
import { EntryError } from './campaigns';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { CONFIRM_BACKING_DESCRIPTION, SERVER_INSTRUCTIONS, TOOL_DESCRIPTIONS, toolDescriptions } from './mcp';
import { CONFIRM_ENTRY_GONE, tools } from './tools';
import { COIN_BLOCKED } from './coin-moments';
import { productOdds, productScore, traction, type Detection } from './match';
import type { RepoFit } from './present';
import type { TokenFlowDeps } from './token-launch';

/**
 * v3.1 P0 Task 10 (spec 3.4, D1): the agent sees find, prepare (draft only), tell and score; confirm is registered only
 * while EARNKIT_RAISING is on, and only opens Backing (the coin launch by project_id). find offers no build.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v31-mcp-surface-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (!process.env.DATABASE_URL) return;
  await dropRunPrograms();
  await sql().end();
});
const RUN = String(process.pid % 100000);
const ON = { EARNKIT_RAISING: 'on', TOKENSFUN_DEPLOY_API_KEY: 'v31-surface-key' };
const OFF = { EARNKIT_RAISING: undefined };
const show = (r: { reply: Record<string, unknown> | null }) => String(r.reply?.show_to_builder ?? '');
let n = 0;

/** A fake tokens.fun deploy that records each launch as tokens.ts would. */
function tokenDeps() {
  const calls = { deploy: 0, wallets: [] as string[], symbols: [] as string[] };
  const deps = {
    available: () => true,
    limit: async () => {},
    check: async () => true,
    gate: { repo: async () => ({ fork: false, hasCommits: true, aheadOfParent: null }), appProven: async () => true, screen: async () => {} },
    deploy: async (d: { projectId: number; name: string; symbol: string; creatorWallet: string }) => {
      calls.deploy++;
      calls.wallets.push(d.creatorWallet);
      calls.symbols.push(d.symbol);
      const url = `https://tokens.fun/coin/0x${randomBytes(20).toString('hex')}`;
      await sql()`UPDATE projects SET token_url = ${url}, token_status = 'launched', coin_launched_at = now(), token_name = ${d.name}, token_symbol = ${d.symbol} WHERE id = ${d.projectId}`;
      return { status: 'launched' as const, name: d.name, symbol: d.symbol, tokens_fun: url };
    },
  } as unknown as TokenFlowDeps;
  return { calls, deps };
}

type Ctx = Parameters<typeof mcpCall>[0];
/** A ranked builder (X, the repo proven by the App and public) with a proven wallet and an approved week with code. */
async function ranked(tag: string, key = `v31s${tag}${RUN}/kit`) {
  n++;
  const t = `ek_v31s_${tag}_${RUN}_${randomBytes(4).toString('hex')}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  const handle = `v31s${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `97${RUN}${n}${tag.length}`, username: handle, name: 'v31s', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const chains: Detection = { base: { mainnet: true, testnet: false, evidence: 'deployed contract', basis: 'deployed' } };
  const ps = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
  const tr = { tx_count: 120, live_ok: true, commits_90d: 25 };
  const product = { ...ps, traction: traction(tr), ...productOdds(ps, tr, ps.score) };
  const facts = { name: 'kit', url: `https://github.com/${key}`, homepage: 'https://kit.app', created_at: '2025-01-01T00:00:00Z', chains, commits_in_window: {}, product, live_verified: true, tx_count: 120, commits_90d: 25 };
  const fits: RepoFit[] = [{ repo: 'kit', repo_url: `https://github.com/${key}`, key, product, facts, live_verified: true, verdicts: [] }];
  const { calls, deps } = tokenDeps();
  const ctx = {
    installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: (async () => ({ checked: 1, scored: 1, fits })) as never, tokenDeps: deps,
  } as Ctx;
  await mcpCall(ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } });
  const gid = 7300 + n * 10 + (Number(RUN) % 7);
  const owner = key.split('/')[0];
  await installApp({ builderId: c.id, repoKey: key, login: handle, gh: fakeGitHub({ [key.toLowerCase()]: owner === handle
    ? { id: gid, owner: handle, installation: gid + 1 }
    : { id: gid, owner, ownerType: 'Organization', admins: [handle], installation: gid + 1 } }) });
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('connect_done', now()::text) WHERE builder_id = ${c.id}`;
  await sql()`UPDATE builder_sources SET public_at = now() WHERE builder_id = ${c.id} AND kind = 'repo'`;
  const wallet = `0x${(c.id + 2000).toString(16).padStart(40, '0')}`;
  await sql()`INSERT INTO person_wallets (wallet, builder_id) VALUES (${wallet}, ${c.id}) ON CONFLICT DO NOTHING`;
  await sql()`
    INSERT INTO project_updates (builder_id, project_key, week, facts)
    VALUES (${c.id}, ${key}, ${lastFinishedMonday(new Date())}, ${sql().json({ shipped_code: { n: 3 }, checked: true, approved: true } as never)})
    ON CONFLICT (project_key, week) DO UPDATE SET facts = project_updates.facts || EXCLUDED.facts`;
  return { ctx, id: c.id, key, calls, wallet };
}

test('(a) tools/list: find, prepare, score, tell with the flag off', () => withEnv(OFF, async () => {
  const listed = await mcpListTools({ installationId: 1 });
  assert.deepEqual(listed.map((t) => t.name).sort(), ['find', 'prepare', 'score', 'tell']);
  assert.equal(toolDescriptions(false).confirm, undefined);
  // prepare says it only drafts (Task 9's carry-over): never "the confirm line", never submits.
  const prepare = listed.find((t) => t.name === 'prepare')!.description!;
  assert.ok(prepare.startsWith(
    'Draft an application from the ship log. Pass program_id, project (name, repo_url, live_url) and answers you drafted from the repo, by requirement key; the first call without answers lists the requirements. It never submits: the builder sends the form. Follow agent_note.',
  ), prepare);
  assert.doesNotMatch(prepare, /confirm/);
}));

test('(b) flag on: confirm is listed with project_id required and no program_id', () => withEnv(ON, async () => {
  const listed = await mcpListTools({ installationId: 1 });
  assert.deepEqual(listed.map((t) => t.name).sort(), ['confirm', 'find', 'prepare', 'score', 'tell']);
  const confirm = listed.find((t) => t.name === 'confirm')!;
  assert.equal(confirm.description, CONFIRM_BACKING_DESCRIPTION);
  assert.equal(CONFIRM_BACKING_DESCRIPTION,
    "The builder's yes to opening Backing. Pass project_id, yes: true, wallet and token exactly as tell coin returned them; check: true reads a launching coin. Then follow agent_note.");
  assert.deepEqual(confirm.inputSchema.required, ['project_id']);
  const props = confirm.inputSchema.properties as Record<string, unknown>;
  for (const gone of ['program_id', 'project', 'answers', 'skip_token', 'contracts', 'deployer_signature', 'submitted']) assert.ok(!(gone in props), gone);
  for (const k of ['project_id', 'yes', 'check', 'token', 'wallet', 'image_url', 'image_data', 'builder_x', 'agent']) assert.ok(k in props, k);
  // Strict: an entry's fields are an error before the tool runs.
  const r = await mcpCall({ installationId: 1 }, 'confirm', { project_id: 1, program_id: 'base-builder-grants', yes: true });
  assert.equal(r.isError, true);
  assert.match(r.text, /Unrecognized key/);
}));

test('(c) flag on: the Backing yes (move_up backing yes, then confirm { project_id, yes }) still launches through the fake tokens.fun deploy', db, () => withEnv(ON, async () => {
  const b = await ranked('c');
  const offer = await mcpCall(b.ctx, 'find', {});
  assert.equal((offer.reply?.move_up as { kind: string }).kind, 'backing', show(offer));
  const yes = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'backing', project_key: b.key, answer: 'yes' } });
  assert.equal(yes.reply?.agent_note, COIN_YES_NOTE, yes.text);
  assert.match(COIN_YES_NOTE, /^Call confirm with project_id/);
  const { project_id, wallet, token } = yes.reply as { project_id: number; wallet: string; token: { name: string; symbol: string } };
  assert.equal(typeof project_id, 'number');
  const launched = await mcpCall(b.ctx, 'confirm', { project_id, yes: true, wallet, token });
  assert.equal(launched.isError, false, launched.text);
  assert.equal(launched.reply?.status, 'launched', launched.text);
  assert.equal(b.calls.deploy, 1);
  assert.deepEqual(b.calls.wallets, [wallet]);
  assert.deepEqual(b.calls.symbols, [token.symbol]);
  const [p] = await sql()<{ token_status: string; creator_wallet: string }[]>`SELECT token_status, creator_wallet FROM projects WHERE id = ${project_id}`;
  assert.deepEqual({ ...p }, { token_status: 'launched', creator_wallet: wallet });
  // check: true reads it back; nothing launches again.
  const check = await mcpCall(b.ctx, 'confirm', { project_id, check: true });
  assert.equal(check.isError, false, check.text);
  assert.equal(b.calls.deploy, 1);
  // earnkitai/earnkit never gets a Backing offer.
  const own = await ranked('co', 'earnkitai/earnkit');
  const ownFind = await mcpCall(own.ctx, 'find', {});
  assert.doesNotMatch(show(ownFind), /backing/i, show(ownFind));
  assert.notEqual((ownFind.reply?.move_up as { kind?: string } | undefined)?.kind, 'backing');
}));

test('(d) confirm with program_id: CONFIRM_ENTRY_GONE', async () => {
  assert.equal(CONFIRM_ENTRY_GONE, "EarnKit drafts applications now; the builder sends them on the program's site. Call prepare for a draft.");
  // Thrown before anything is read or written (no database touched).
  for (const input of [
    { program_id: 'base-builder-grants', project: { name: 'Kit' }, answers: {}, yes: true },
    { program_id: 'base-builder-grants', skip_token: true },
    { program_id: 'arc-microgrants', project_id: 7, yes: true },
    { program_id: 'base-builder-grants', submitted: {} },
  ])
    await assert.rejects(tools.confirm(input, { installationId: 1 }), (err: unknown) => err instanceof EntryError && err.message === CONFIRM_ENTRY_GONE, JSON.stringify(input));
});

test('(e) find (more: true and a shared client) has no build_offer, no "Ideas" section; a no_project Bench reply has no idea line', db, () => withEnv({ ...OFF, DEPLOYER_PRIVATE_KEY: `0x${'11'.repeat(32)}` }, async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  // A program a build would lead with (a tested starter, closing soon), and one with its own pitch that once made the idea line.
  const starter = `v31s-tip-${stamp}`;
  const fresh = { ...committedProgram('arc-microgrants'), id: `v31s-fresh-${stamp}`, title: 'V31 Tip Grants', status: 'active', ends_at: new Date(Date.now() + 36 * 3600_000).toISOString(), fresh_build: { starter } };
  const pitched = { ...committedProgram('arc-microgrants'), id: `v31s-pitch-${stamp}`, title: 'V31 Pitch Grants', status: 'active', ends_at: '2099-01-01T00:00:00Z', needs_repo: false, max_award_usd: 1000, pitch: { who: 'V31 Pitch', for: 'tip jars' } };
  delete (pitched as { tag?: string }).tag;
  await upsertProgram(ProgramFile.parse(fresh));
  await upsertProgram(ProgramFile.parse(pitched));
  const freshDeps = { deployOn: () => true, hostOn: true, starters: { [starter]: { ...TESTED_STARTERS['arc-tipjar'], id: starter, tested_at: new Date().toISOString().slice(0, 10) } } } as never;
  const inst = await install();
  for (const [label, ctx, args] of [
    ['more', { installationId: inst, freshDeps }, { more: true, agent_can_build: true }],
    ['shared', { installationId: inst, sharedClient: true, freshDeps }, { agent_can_build: true }],
    ['shared, more', { installationId: inst, sharedClient: true, freshDeps }, { more: true }],
  ] as const) {
    const r = await mcpCall(ctx as Ctx, 'find', args);
    assert.equal(r.isError, false, `${label}: ${r.text}`);
    assert.equal(r.reply?.build_offer, undefined, `${label}: ${r.text}`);
    assert.doesNotMatch(show(r), /Ideas I can build|Ideas for these programs|Want me to build it\?/, `${label}: ${show(r)}`);
  }
  // A signed-in builder with no project (Task 16 step 2): the repo picker, never an idea line.
  const t = `ek_v31s_np_${RUN}_${randomBytes(4).toString('hex')}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  assert.ok((await attachToX(own, { id: `96${RUN}${randomBytes(2).readUInt16BE()}`, username: `v31snp${RUN}`.slice(0, 15), name: 'np', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const r = await mcpCall({ installationId: c.id, ownInstallationId: c.own, sharedClient: false, freshDeps } as Ctx, 'find', {});
  const s = show(r);
  assert.match(s, /^You're in, @\S+\. I find grants your app qualifies for and write the applications\.\n(?:[^\n]+ pays? up to \$[\d,]+ for apps(?: on [^\n]+)?\.\n)?Connect your app's code on GitHub so I can match it/, s);
  assert.doesNotMatch(s, / pays .* for tip jars\.|V31 Pitch pays/, s);
  assert.equal(r.reply?.build_offer, undefined);
}));

test('(f) every description under 800 characters, no em dash, no tool name in builder text', () => withEnv(ON, async () => {
  const texts: [string, string][] = [['SERVER_INSTRUCTIONS', SERVER_INSTRUCTIONS], ...Object.entries(TOOL_DESCRIPTIONS)];
  for (const raising of [ON, OFF])
    for (const t of await withEnv(raising, () => mcpListTools({ installationId: 1 }))) texts.push([`listed ${t.name}`, t.description ?? '']);
  for (const [label, d] of texts) {
    assert.ok(d.length < 800, `${label}: ${d.length}`);
    assert.doesNotMatch(d, /—/, label);
  }
  // The instructions never send an entry through confirm (it only opens Backing, named by the yes's agent_note).
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /confirm/);
}));

test('(g) the builder text of a Backing offer, yes and launch never names a tool', db, () => withEnv(ON, async () => {
  const tool = /\b(find|prepare|confirm|tell|score|move_up|project_id)\b/;
  const b = await ranked('f');
  const offer = await mcpCall(b.ctx, 'find', {});
  assert.doesNotMatch(show(offer), tool, show(offer));
  const yes = await mcpCall(b.ctx, 'tell', { move_up: { kind: 'backing', project_key: b.key, answer: 'yes' } });
  assert.doesNotMatch(show(yes), tool, show(yes));
  const { project_id, wallet, token } = yes.reply as { project_id: number; wallet: string; token: object };
  const launched = await mcpCall(b.ctx, 'confirm', { project_id, yes: true, wallet, token });
  assert.equal(launched.reply?.status, 'launched', launched.text);
  assert.doesNotMatch(show(launched), tool, show(launched));
}));

test('(h) fix round 1: prepare { host: true } on a curated program returns the draft (no "Ready to submit?", no confirm note), host beside it', db, () => withEnv(OFF, async () => {
  const b = await ranked('h');
  const project = { name: 'Kit', repo_url: `https://github.com/${b.key}`, live_url: 'https://kit.app' };
  const reqs = committedProgram('base-builder-grants').submission_requirements as { key: string; options?: string[] }[];
  const answers = {
    project_name_description: 'Kit: fans tip creators onchain in one tap',
    live_product_url: 'https://kit.app',
    demo_loom: 'https://www.loom.com/share/kit-demo',
    track: (reqs.find((r) => r.key === 'track')!.options ?? [])[0],
    usage_numbers: '120 transactions in 90 days',
    primary_challenge: 'User acquisition; Go-to-market strategy',
  };
  const first = await mcpCall(b.ctx, 'prepare', { program_id: 'base-builder-grants', project, host: true });
  assert.equal(first.isError, false, first.text);
  assert.ok(Array.isArray(first.reply?.requirements), first.text);
  assert.ok(first.reply?.host, first.text);
  const r = await mcpCall(b.ctx, 'prepare', { program_id: 'base-builder-grants', project, answers, host: true });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.reply?.draft, r.text);
  assert.ok(r.reply?.host, r.text);
  assert.ok(show(r).endsWith('Sent it?'), show(r));
  assert.doesNotMatch(show(r), /Ready to submit\?/);
  assert.doesNotMatch(String(r.reply?.agent_note ?? ''), /confirm|skip_token/);
  const [{ c }] = await sql()<{ c: number }[]>`SELECT count(*)::int AS c FROM projects WHERE installation_id = ${b.id}`;
  assert.equal(c, 0, 'nothing entered');
}));

test('(i) fix round 1: /llms.txt describes the draft flow; confirm (Backing only) is named only with EARNKIT_RAISING on', async () => {
  const { GET } = await import('../../app/llms.txt/route');
  const read = async () => (await GET()).text();
  const on = await withEnv(ON, read);
  const off = await withEnv(OFF, read);
  const line = "- confirm: only opens Backing, by project_id, after the builder's yes.";
  assert.ok(on.includes(line), on);
  assert.ok(!off.includes('- confirm'), off);
  for (const text of [on, off]) {
    assert.match(text, /prepare drafts the application/);
    assert.match(text, /tell program_status applied/);
    assert.doesNotMatch(text, /confirm line|One "yes" at the confirmation|skip_token|submit kit|launches its token/);
    // Final fix 3: prepare's draft path returns no guide, so the text never says it shows one.
    assert.doesNotMatch(text, /prepare shows it/);
    assert.doesNotMatch(text, /—/);
  }
});

test('(j) final fix 1: tell token ask with EARNKIT_RAISING off offers no coin (no confirm to call); on, the Backing yes reaches confirm and launches', db, async () => {
  // Off: not available, no coin, no note pointing at a tool that isn't registered, nothing recorded.
  await withEnv({ ...OFF, TOKENSFUN_DEPLOY_API_KEY: 'v31-surface-key' }, async () => {
    const b = await ranked('jo');
    const r = await mcpCall(b.ctx, 'tell', { token: 'ask' });
    assert.equal(r.isError, false, r.text);
    assert.equal(show(r), COIN_BLOCKED.off, r.text);
    assert.equal(r.reply?.coin, undefined, r.text);
    assert.doesNotMatch(r.text, /confirm|tell with coin/, r.text);
    const [{ c }] = await sql()<{ c: number }[]>`SELECT count(*)::int AS c FROM coin_moments WHERE builder_id = ${b.id}`;
    assert.equal(c, 0, 'no offer recorded');
    assert.ok(!(await mcpListTools({ installationId: b.id })).some((t) => t.name === 'confirm'));
  });
  // On: the offer, the yes, confirm { project_id } launches through the fake deploy.
  await withEnv(ON, async () => {
    const b = await ranked('jn');
    const asked = await mcpCall(b.ctx, 'tell', { token: 'ask' });
    assert.deepEqual(asked.reply?.coin, { project_key: b.key }, asked.text);
    const yes = await mcpCall(b.ctx, 'tell', { coin: { project_key: b.key, answer: 'yes', wallet: b.wallet } });
    assert.equal(yes.reply?.agent_note, COIN_YES_NOTE, yes.text);
    const { project_id, wallet, token } = yes.reply as { project_id: number; wallet: string; token: { name: string; symbol: string } };
    assert.ok((await mcpListTools({ installationId: b.id })).some((t) => t.name === 'confirm'));
    const launched = await mcpCall(b.ctx, 'confirm', { project_id, yes: true, wallet, token });
    assert.equal(launched.isError, false, launched.text);
    assert.equal(launched.reply?.status, 'launched', launched.text);
    assert.equal(b.calls.deploy, 1);
  });
});
