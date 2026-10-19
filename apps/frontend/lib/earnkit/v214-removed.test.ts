import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { mcpCall, mcpListTools } from './fixtures/mcp-call';
import { connectInstallation, saveInstallation } from './installations';
import { registerClient } from './oauth';
import { authorizeGet, tokenPost } from './oauth-routes';
import { attachToX, bindX, xSignInCallback } from './x-install';
import type { XOAuthDeps, XUser } from './x-oauth';

process.env.EARNKIT_AUTH_SECRET ??= 'removed-test-secret';
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
const FRONTEND = join(import.meta.dirname, '..', '..');
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);

test('7.1 the claim page, the join route and the join modules are gone', () => {
  for (const p of ['app/claim/[code]', 'app/claim/join', 'lib/earnkit/claim.ts', 'lib/earnkit/page-joins.ts', 'lib/earnkit/login-contests.ts'])
    assert.equal(existsSync(join(FRONTEND, p)), false, p);
  assert.equal(existsSync(join(FRONTEND, 'app/claim/wallet/route.ts')), true, 'A21: the wallet page stays');
  const lib = join(FRONTEND, 'lib/earnkit');
  for (const f of readdirSync(lib).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    const src = readFileSync(join(lib, f), 'utf8');
    assert.doesNotMatch(src, /\b(withProbation|onProbation|joinOnProvenTie|askJoin|answerJoin|offerPickup|answerPickup|claimLink|pendingNotice|settleLogin)\b/, f);
  }
});

test('7.2 the tables stay (no destructive migration)', db, async () => {
  for (const t of ['claim_codes', 'x_oauth_states', 'x_join_offers', 'page_joins', 'pending_joins', 'login_contest_rulings', 'proof_branches', 'proof_line_issues']) {
    const [r] = await sql()`SELECT 1 FROM information_schema.tables WHERE table_name = ${t}`;
    assert.ok(r, t);
  }
  const schema = readFileSync(join(FRONTEND, 'db/schema.sql'), 'utf8');
  // Three column drops predate v2.14 (programs, sponsor_campaigns); nothing else is ever dropped.
  const PRE_V214 = ['ALTER TABLE programs DROP COLUMN IF EXISTS key_requirement;', 'ALTER TABLE programs DROP COLUMN IF EXISTS builder_steps;',
    'ALTER TABLE sponsor_campaigns DROP COLUMN IF EXISTS fund_tx;'];
  let rest = schema;
  for (const line of PRE_V214) rest = rest.replace(line, '');
  assert.doesNotMatch(rest, /\bDROP TABLE\b|\bDROP COLUMN\b/i);
});

test('7.3 tools: tell takes no pickup; find never carries pick_up; a second agent on the page can do everything at once', db, async () => {
  const tell = (await mcpListTools({ installationId: 1 })).find((t) => t.name === 'tell')!;
  assert.equal((tell.inputSchema as { properties: Record<string, unknown> }).properties.pickup, undefined);
  const x = { id: `94${RUN}1`, username: `zoe${RUN}`.slice(0, 15), name: 'Zoe', avatar: null };
  const mk = async () => {
    const t = `ek_rm_${RUN}_${Math.random().toString(36).slice(2)}`;
    await saveInstallation(t, undefined, false);
    const own = (await connectInstallation(t))!.own;
    assert.ok((await attachToX(own, x, new Date())).ok);
    return (await connectInstallation(t))!;
  };
  await mk();
  const second = await mk();
  const r = await mcpCall({ installationId: second.id, ownInstallationId: second.own, sharedClient: false }, 'find', {});
  assert.equal(r.reply?.pick_up, undefined);
  assert.doesNotMatch(String(r.reply?.show_to_builder), /new agent was added|remove it\?|Linked to your page/);
  const hide = await mcpCall({ installationId: second.id, ownInstallationId: second.own, sharedClient: false }, 'tell', { profile: 'hide' });
  assert.doesNotMatch(hide.text, /joined|probation|after a day/i, 'no probation');
});

test('7.4 bindX writes the X profile and never asks anyone (no join_pending, no held)', db, async () => {
  const t = `ek_bx_${RUN}_${Date.now()}`;
  await saveInstallation(t, undefined, false);
  const own = (await connectInstallation(t))!.own;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${own}, ${`bx${RUN}`}, now())`;
  const user = { id: `95${RUN}1`, username: `bex${RUN}`.slice(0, 15), name: 'Bex', avatar: null };
  const r = await bindX(own, user, new Date());
  assert.deepEqual(r, { ok: true, handle: user.username, root: own });
  const other = await bindX(own, { ...user, id: `95${RUN}2` }, new Date());
  assert.deepEqual(other, { ok: false, reason: 'claimed_by_other' });
});

test('7.5 S4: the bind migration first detaches unanswered v2.13.4 joins (no deletes) and reruns as a no-op', db, async () => {
  const schema = readFileSync(join(FRONTEND, 'db/schema.sql'), 'utf8');
  const block = /-- v2\.14 bind:start\n([\s\S]*?)-- v2\.14 bind:end/.exec(schema)![1];
  const mk = async () => {
    const t = `ek_s4_${RUN}_${Math.random().toString(36).slice(2)}`;
    await saveInstallation(t, undefined, false);
    return (await connectInstallation(t))!.own;
  };
  const xid = `96${RUN}1`;
  const page = await mk();
  const old = await mk(); // on the page before the joins (eligible)
  const open = await mk(); // joined; nobody answered
  const kept = await mk(); // joined; the page's agent said no (keep it)
  await sql()`UPDATE installations SET builder_id = ${page} WHERE id IN (${old}, ${open}, ${kept})`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at, x_user_id, x_handle, claimed_at) VALUES (${page}, ${`sf${RUN}`}, now(), ${xid}, ${`sf${RUN}`}, now())`;
  const [{ j1 }] = await sql()<{ j1: number }[]>`
    INSERT INTO page_joins (root, from_root, members, eligible, x_user_id, joined_at) VALUES (${page}, ${open}, ${[open]}::int[], ${[page, old]}::int[], ${xid}, now() - interval '3 days')
    RETURNING id::int AS j1`;
  await sql()`
    INSERT INTO page_joins (root, from_root, members, eligible, x_user_id, joined_at, answers) VALUES (${page}, ${kept}, ${[kept]}::int[], ${[page, old]}::int[], ${xid}, now() - interval '3 days',
      ${sql().json({ [String(old)]: 'no' })})`;
  await sql()`INSERT INTO project_updates (builder_id, project_key, week, text, posted_by) VALUES (${page}, ${`s4p${RUN}${open}`}, date_trunc('week', now())::date, 'from the joiner', ${open})`;
  const before = (await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM page_joins`)[0].n;
  await sql().unsafe(block);
  await sql().unsafe(block);
  const rows = await sql()<{ id: number; b: number | null; x: string | null }[]>`
    SELECT id, builder_id AS b, x_user_id AS x FROM installations WHERE id IN (${page}, ${old}, ${open}, ${kept}) ORDER BY id`;
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(by[open], { id: open, b: null, x: null }, 'the unanswered join is detached and never bound');
  assert.deepEqual(by[kept], { id: kept, b: page, x: xid }, 'a join the page kept stays and is bound');
  assert.deepEqual(by[old], { id: old, b: page, x: xid });
  assert.equal(by[page].x, xid);
  const [j] = await sql()<{ detached: boolean }[]>`SELECT detached_at IS NOT NULL AS detached FROM page_joins WHERE id = ${j1}`;
  assert.ok(j.detached, 'the join row is stamped detached');
  assert.equal((await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM page_joins`)[0].n, before, 'no deletes');
  const [u] = await sql()<{ hidden: boolean }[]>`SELECT hidden FROM project_updates WHERE posted_by = ${open}`;
  assert.equal(u.hidden, true, "the detached agent's updates since the join are hidden (as answerNotice did)");
});

// ---- (c) carried from T4: a refused re-authorization keeps the installation's existing token.
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const LOOPBACK = 'http://127.0.0.1:33418/callback';
const noLimit = { limit: async () => {} };
const fakeX = (user: XUser): XOAuthDeps => ({ exchange: async () => 'x-token', me: async () => user });
async function codeFor(clientId: string, user: XUser): Promise<string> {
  const start = await authorizeGet(new Request(`https://earnkit.com/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: LOOPBACK, state: 's', code_challenge: CHALLENGE, code_challenge_method: 'S256' })}`), noLimit);
  const toX = new URL(start.headers.get('location')!);
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  const back = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${toX.searchParams.get('state')}`, { headers: { cookie } }), { x: fakeX(user), ...noLimit });
  return new URL(back!.headers.get('location')!).searchParams.get('code')!;
}
const exchange = (clientId: string, code: string) => tokenPost(new Request('https://earnkit.com/oauth/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `203.0.113.${Number(RUN) % 250}` },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: LOOPBACK, code_verifier: VERIFIER }),
}));

test('7.6 a re-authorization refused at the token exchange keeps the old token working', db, async () => {
  process.env.EARNKIT_URL = 'https://earnkit.com';
  const user = { id: `97${RUN}1`, username: `kay${RUN}`.slice(0, 15), name: 'Kay', avatar: null };
  const client = registerClient({ redirect_uris: [LOOPBACK], client_name: 'Claude Code' }).client_id;
  const first = await exchange(client, await codeFor(client, user));
  assert.equal(first.status, 200);
  const { access_token: token } = (await first.json()) as { access_token: string };
  const own = (await connectInstallation(token))!.own;
  const code = await codeFor(client, user);
  // The owner clears the X account before the re-authorization's token exchange: attachToX refuses.
  await sql()`INSERT INTO x_owner_clears (x_user_id, builder_id) VALUES (${user.id}, 0) ON CONFLICT DO NOTHING`;
  const again = await exchange(client, code);
  assert.equal(again.status, 400);
  assert.equal(((await again.json()) as { error: string }).error, 'invalid_grant');
  const still = await connectInstallation(token);
  assert.ok(still, 'the existing token still connects');
  assert.equal(still.own, own);
});
