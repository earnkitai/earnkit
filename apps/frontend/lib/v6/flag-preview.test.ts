/** v3.8 owner/test preview: owner and test accounts get the shipping flags per request; everyone else follows EARNKIT_FLAGS. */
import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { sql } from '../v5/db';
import { FLAGS, PREVIEW_FLAGS, flagsOn } from '../v5/flags';
import { saveInstallation } from '../v5/installations';
import { createMcpServer } from '../v5/mcp';
import { readStats } from '../v5/stats';
import { POST as mcpPost } from '../../app/mcp/route';
import { GET as authorizeGet } from '../../app/oauth/authorize/route';
import { GET as consentGet } from '../../app/me/consent/route';
import { registerClient } from '../v5/oauth';
import { linkInstallation, upsertBuilder } from './builders';
import { PREVIEW_REASONS, isPreviewCaller, previewForBuilder, previewForCookie, previewForInstallation, withCallerFlags } from './flag-preview';
import { createSession } from './sessions';

after(() => sql().end());

const ENV_KEYS = ['EARNKIT_FLAGS', 'EARNKIT_OWNER_LOGINS', 'EARNKIT_DOGFOOD_LOGINS', 'EARNKIT_TEST_INSTALLATIONS', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'EARNKIT_URL', 'EARNKIT_AUTH_SECRET'];
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

const NOW = new Date();
let n = 0;
const uniq = (p: string) => `${p}-${process.pid}-${++n}`;
let gh = 910_000;
const builder = (login: string) => upsertBuilder({ github_id: ++gh, login, name: null, avatar_url: null }, NOW);
/** A fresh installation, linked to `login`'s builder when given; returns its token and id. */
async function install(clientName: string | null, login?: string) {
  const token = uniq('ek_preview');
  const id = await saveInstallation(token, clientName);
  const b = login ? await builder(login) : null;
  if (b) await linkInstallation(id, b.id, NOW);
  return { token, id, builderId: b?.id ?? null };
}
const flagReason = (id: number, reason: string) => sql()`UPDATE people SET test_reason = ${reason}, test_reason_source = 'test-fixture' WHERE id = (SELECT person_id FROM installations WHERE id = ${id})`;

test('the preview flags are the shipping flags with code on main (auto_live since E6r; not private_rows yet)', () => {
  assert.deepEqual([...PREVIEW_FLAGS], ['auto_live', 'install_signin', 'x_signin', 'track_v2', 'draft_check', 'form', 'reply_fields', 'copy_v38', 'screen_v2']);
  assert.ok(PREVIEW_FLAGS.every((f) => (FLAGS as readonly string[]).includes(f)));
  assert.deepEqual([...PREVIEW_REASONS], ['owner', 'test', 'persona', 'dogfood']);
});

test('isPreviewCaller: owner, test, persona and dogfood reasons and the env lists; never a real person or a repro', () => {
  const none = { reasons: [], login: null, xHandle: null };
  assert.equal(isPreviewCaller(none, {}), false);
  assert.equal(isPreviewCaller({ ...none, reasons: [null], login: 'someone' }, {}), false);
  assert.equal(isPreviewCaller({ ...none, reasons: ['repro'] }, {}), false);
  for (const r of PREVIEW_REASONS) assert.equal(isPreviewCaller({ ...none, reasons: [null, r] }, {}), true, r);
  assert.equal(isPreviewCaller({ ...none, login: 'JENIL04' }, {}), true);
  assert.equal(isPreviewCaller({ ...none, login: 'jenilt' }, {}), true);
  assert.equal(isPreviewCaller({ ...none, xHandle: '@boss' }, { EARNKIT_OWNER_LOGINS: 'boss' }), true);
  assert.equal(isPreviewCaller({ ...none, login: 'bot' }, { EARNKIT_DOGFOOD_LOGINS: 'bot' }), true);
  assert.equal(isPreviewCaller({ ...none, installationId: 42 }, { EARNKIT_TEST_INSTALLATIONS: '41,42' }), true);
});

test('previewForInstallation: by the installation person, the linked builder and the env lists', async () => {
  assert.equal(await previewForInstallation((await install(null)).id), false);
  assert.equal(await previewForInstallation((await install('Claude Code', uniq('real'))).id), false);
  assert.equal(await previewForInstallation((await install('l33-repro-1')).id), false);
  assert.equal(await previewForInstallation((await install('claude_test')).id), true);
  assert.equal(await previewForInstallation((await install('Lane 1h')).id), true);
  assert.equal(await previewForInstallation((await install('my-dogfood-agent')).id), true);
  for (const r of PREVIEW_REASONS) {
    const i = await install(null);
    await flagReason(i.id, r);
    assert.equal(await previewForInstallation(i.id), true, r);
  }
  // The owner's own GitHub login, linked: owner by the built-in list (and its person is flagged owner at link).
  assert.equal(await previewForInstallation((await install(null, 'jenilt')).id), true);
  const listed = await install(null, uniq('listed'));
  assert.equal(await previewForInstallation(listed.id), false);
  process.env.EARNKIT_OWNER_LOGINS = (await sql()`SELECT login FROM builders WHERE id = ${listed.builderId}`)[0].login;
  assert.equal(await previewForInstallation(listed.id), true);
  const plain = await install(null);
  process.env.EARNKIT_TEST_INSTALLATIONS = String(plain.id);
  assert.equal(await previewForInstallation(plain.id), true);
  assert.equal(await previewForInstallation(-1), false);
});

test('previewForBuilder and previewForCookie: the /me session builder; no or a dead session is no caller', async () => {
  const real = await builder(uniq('realb'));
  assert.equal(await previewForBuilder(real.id), false);
  const owner = await builder('jenil04');
  assert.equal(await previewForBuilder(owner.id), true);
  const persona = await install(null, uniq('persona'));
  await sql()`UPDATE people SET test_reason = 'persona' WHERE builder_id = ${persona.builderId}`;
  assert.equal(await previewForBuilder(persona.builderId!), true);
  const { token } = await createSession(owner.id, NOW);
  assert.equal(await previewForCookie(`ek_me=${token}`), true);
  assert.equal(await previewForCookie(`ek_me=${(await createSession(real.id, NOW)).token}`), false);
  assert.equal(await previewForCookie(null), false);
  assert.equal(await previewForCookie('ek_me=forged'), false);
  assert.equal(await previewForCookie(`ek_me=${token}`, new Date(NOW.getTime() + 31 * 86_400_000)), false);
});

test('withCallerFlags: the preview turns on PREVIEW_FLAGS for that request only; a failed lookup follows EARNKIT_FLAGS', async () => {
  assert.deepEqual(await withCallerFlags(async () => true, async () => flagsOn()), FLAGS.filter((f) => PREVIEW_FLAGS.includes(f)));
  assert.deepEqual(await withCallerFlags(async () => false, async () => flagsOn()), []);
  assert.deepEqual(flagsOn(), []);
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    assert.deepEqual(await withCallerFlags(async () => { throw new Error('db down'); }, async () => flagsOn()), []);
    process.env.EARNKIT_FLAGS = 'form';
    assert.deepEqual(await withCallerFlags(async () => { throw new Error('db down'); }, async () => flagsOn()), ['form']);
  } finally {
    console.error = log;
  }
  assert.equal(errors.length, 2);
  // Two requests at once keep their own context.
  const [a, b] = await Promise.all([
    withCallerFlags(async () => true, async () => { await new Promise((r) => setTimeout(r, 5)); return flagsOn(); }),
    withCallerFlags(async () => false, async () => { await new Promise((r) => setTimeout(r, 1)); return flagsOn(); }),
  ]);
  assert.equal(a.length, PREVIEW_FLAGS.length);
  assert.deepEqual(b, ['form']);
  // EARNKIT_FLAGS already on for every preview flag: no lookup at all.
  process.env.EARNKIT_FLAGS = PREVIEW_FLAGS.join(',');
  let looked = false;
  await withCallerFlags(async () => (looked = true), async () => null);
  assert.equal(looked, false);
});

const IP = '203.0.113.77';
const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-real-ip': IP };
const call = (id: number, name: string, args: unknown) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const viaRoute = async (token: string, body: unknown) =>
  (await mcpPost(new Request('https://earnkit.test/mcp', { method: 'POST', headers: { ...HEADERS, authorization: `Bearer ${token}` }, body: JSON.stringify(body) }))).text();
/** main's path for the same call: the server and transport with no flag context at all. */
async function direct(installationId: number, builderId: number | null, body: unknown): Promise<string> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createMcpServer({ installationId, builderId, ip: IP }).connect(transport);
  return (await transport.handleRequest(new Request('https://earnkit.test/mcp', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) }))).text();
}
const CALLS = [
  LIST,
  call(2, 'find', { project: { name: 'X', description: 'An app for paying developers.' } }),
  call(3, 'record', {}),
  call(4, 'track', { program_id: 'no-such', status: 'skipped' }),
  call(5, 'screen', {}),
];

test('MCP: a real builder gets the same bytes as with no flag context (EARNKIT_FLAGS unset) for tools/list, find, record, track, screen', async () => {
  for (const linked of [false, true]) {
    const real = await install('Claude Code', linked ? uniq('linked') : undefined);
    const base = await install('Claude Code', linked ? uniq('linked') : undefined);
    assert.equal(await previewForInstallation(real.id), false);
    // The one thing that differs between the two builders is their own login, named once in find's first reply.
    const login = async (b: number | null) => (b === null ? null : ((await sql()`SELECT login FROM builders WHERE id = ${b}`)[0].login as string));
    const [lr, lb] = [await login(real.builderId), await login(base.builderId)];
    const same = (text: string, l: string | null) => (l ? text.split(l).join('LOGIN') : text);
    for (const body of CALLS) assert.equal(same(await viaRoute(real.token, body), lr), same(await direct(base.id, base.builderId, body), lb), JSON.stringify(body));
  }
});

test('MCP: the owner and each test reason get the flags (find advertises catalog; track describes the v2 statuses)', async () => {
  const real = await install('Claude Code');
  const realList = await viaRoute(real.token, LIST);
  assert.doesNotMatch(realList, /"catalog"/);
  const callers = [await install(null, 'jenil04'), await install('claude_test'), await install('Lane 2'), await install('my-dogfood-agent')];
  const owned = await install(null);
  await flagReason(owned.id, 'owner');
  for (const c of [...callers, owned]) {
    const list = await viaRoute(c.token, LIST);
    assert.match(list, /"catalog"/);
    assert.notEqual(list, realList);
  }
  // The real builder's next call is untouched by the owner's before it.
  assert.equal(await viaRoute(real.token, LIST), realList);
});

test('a preview lookup that fails follows EARNKIT_FLAGS; the owner is still previewed when it works', async () => {
  const owner = await install(null, 'jenil04');
  const log = console.error;
  console.error = () => {};
  // An installation id beyond int4 makes the lookup query itself fail: no preview.
  const failing = await withCallerFlags(() => previewForInstallation(2 ** 40), async () => flagsOn());
  console.error = log;
  assert.deepEqual(failing, []);
  assert.match(await viaRoute(owner.token, LIST), /"catalog"/);
});

const ORIGIN = 'https://earnkit.test';
const CB = 'https://claude.ai/api/mcp/auth_callback';
async function authorize(cookie: string | null) {
  const { client_id } = await registerClient({ redirect_uris: [CB], client_name: 'Claude' });
  const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CB, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 's' });
  return authorizeGet(new Request(`${ORIGIN}/oauth/authorize?${q}`, { headers: { 'x-real-ip': `198.51.100.${++n % 250}`, ...(cookie ? { cookie } : {}) } }));
}
const meCookie = async (login: string) => `ek_me=${(await createSession((await builder(login)).id, NOW)).token}`;

test('sign-in and /me: a real or absent session follows EARNKIT_FLAGS; the owner session gets install sign-in and the form', async () => {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'Iv1.client';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'shh';
  process.env.EARNKIT_URL = ORIGIN;
  process.env.EARNKIT_AUTH_SECRET = 'preview-test-secret-0123456789abcdef';
  const real = await meCookie(uniq('signin-real'));
  const owner = await meCookie('jenilt');
  const anon = await authorize(null);
  const asReal = await authorize(real);
  // The anonymous approval, as on main: no GitHub redirect, no install cookie.
  assert.equal(asReal.status, anon.status);
  assert.doesNotMatch(asReal.headers.get('location') ?? '', /github\.com/);
  assert.equal(asReal.headers.get('set-cookie'), anon.headers.get('set-cookie'));
  const asOwner = await authorize(owner);
  assert.equal(asOwner.status, 302);
  assert.match(asOwner.headers.get('location') ?? '', /^https:\/\/github\.com\/login\/oauth\/authorize/);
  const consent = (cookie: string | null) => consentGet(new Request(`${ORIGIN}/me/consent`, { headers: cookie ? { cookie } : {} }));
  assert.equal((await consent(null)).status, 404);
  assert.equal((await consent(real)).status, 404);
  assert.equal((await consent(owner)).status, 303);
});

test('stats: preview traffic stays out of the real counts', async () => {
  const before = await readStats(NOW);
  const owner = await install(null, 'jenil04');
  const tester = await install('claude_test');
  for (const c of [owner, tester]) for (const body of CALLS.slice(1)) await viaRoute(c.token, body);
  const after = await readStats(NOW);
  for (const k of ['installs_real', 'people_real', 'installs_verified', 'people_verified', 'people_verified_active_7d', 'people_verified_applied', 'people_verified_won'] as const)
    assert.equal(after[k], before[k], k);
  assert.equal(after.installs - before.installs, 2);
});
