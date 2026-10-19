import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { fakeGitHub } from './fixtures/fake-github';
import { appEnv, installApp } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { rescorePerson } from './person-score';
import { isoWeekOf } from './weeks';
import { attachToX, xSignInCallback } from './x-install';
import { SIGN_IN_NOTES, signinGet } from './x-link';
import type { XOAuthDeps, XUser } from './x-oauth';

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'replies-test-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
/** D12: the rank phrase as 12.3 reads it: "#N of M builders" or a top percent. */
const RANK = '(: (#\\d+ of \\d+ builders?|[Tt]op \\d+(\\.\\d)?% of builders))?';
function rule(reply: Record<string, unknown> | null) {
  const s = String(reply?.show_to_builder ?? '');
  assert.equal(links(s).length, 1, s);
  assert.equal((s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, 1, s);
  assert.ok(s.trimEnd().endsWith('?'), s);
  assert.match(s, /Ways to get funded/);
  return s;
}
async function agent(o: { x?: string } = {}) {
  const t = `ek_rep_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  if (o.x) assert.ok((await attachToX(own, { id: `98${RUN}${o.x.length}${o.x.charCodeAt(0)}`, username: `${o.x}${RUN}`.slice(0, 15), name: o.x, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  return { id: c.id, token: t, ctx: { installationId: c.id, ownInstallationId: c.own, sharedClient: false, xUserId: c.x } };
}

test('9.8 state 1, not signed in: the sign-in link and its question', db, async () => {
  const a = await agent();
  const s = rule((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(s, /You're not on the Bench yet\./);
  assert.match(s, /https:\/\/earnkit\.com\/signin\/[A-Za-z0-9_-]{22}/);
  const yes = await mcpCall(a.ctx, 'tell', { move_up: { kind: 'sign_in', project_key: null, answer: 'yes' } });
  assert.match(String(yes.reply?.agent_note), /sign_in_code/);
});

test('9.9 state 2, signed in with no project: the page and the GitHub question', db, async () => {
  const a = await agent({ x: 'abe' });
  const s = rule((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(s, new RegExp(`Your page: https://earnkit\\.com/abe${RUN}`, 'i'));
  assert.ok(s.endsWith("What's your GitHub, or a link to something you've made?"));
});

test('9.10 state 3, a project without the App: the install link; then state 4 once installed', db, async () => {
  const a = await agent({ x: 'bo' });
  const key = `bo${RUN}/kit`;
  const s = rule((await mcpCall(a.ctx, 'find', { identity: { project: { name: 'Kit', repo: `https://github.com/${key}` } } })).reply);
  assert.match(s, /Kit isn't counted yet\./);
  assert.match(s, /https:\/\/earnkit\.com\/github\/verify\?n=/);
  assert.match(s, /Want me to count it once that's done\?$/);
  await installApp({ builderId: a.id, repoKey: key, login: `bo${RUN}`, gh: fakeGitHub({ [key]: { id: 5001, owner: `bo${RUN}`, installation: 501 } }) });
  const four = rule((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(four, new RegExp(`Kit is on the Bench${RANK}\\.`));
});

test('9.11 state 5, shipping weekly: the streak in the stand line', db, async () => {
  const a = await agent({ x: 'cy' });
  const key = `cy${RUN}/app`;
  await mcpCall(a.ctx, 'find', { identity: { project: { name: 'App', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: a.id, repoKey: key, login: `cy${RUN}`, gh: fakeGitHub({ [key]: { id: 5002, owner: `cy${RUN}`, installation: 502 } }) });
  await rescorePerson(a.id, new Date());
  // The streak and the weeks it counts, so a rescore during the call keeps it.
  const weeks = [14, 7, 0].map((d) => isoWeekOf(new Date(Date.now() - d * 86_400_000)));
  await sql()`UPDATE builder_projects SET streak = 3, ship_weeks = ${weeks}::text[] WHERE builder_id = ${a.id} AND lower(project_key) = ${key}`;
  const s = rule((await mcpCall(a.ctx, 'score', {})).reply);
  assert.match(s, new RegExp(`App is on the Bench${RANK}\\. 3 weeks in a row\\.`));
});

const noLimit = { limit: async () => {} };
const fakeX = (user: XUser): XOAuthDeps => ({ exchange: async () => 'x-token', me: async () => user });
/** Opens the sign-in link in a browser, signs in with X, and reads the paste code off the done page. */
async function signInThrough(link: string, user: XUser): Promise<string | null> {
  const code = link.split('/').pop()!;
  const page = await signinGet(new Request(link), code, noLimit);
  if (page.status !== 200) return null;
  const html = await page.text();
  const to = new URL(/href="(https:\/\/x\.com\/i\/oauth2\/authorize[^"]+)"/.exec(html)![1].replaceAll('&amp;', '&'));
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  const done = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${to.searchParams.get('state')}`, { headers: { cookie } }), { x: fakeX(user), ...noLimit });
  return /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(await done!.text())?.[1] ?? null;
}

test('9.12 D5: X off: a new install is answered as signed in with no page: money, one question, no link at all', db, async () => {
  delete process.env.X_CLIENT_ID;
  try {
    const a = await agent();
    const s = String((await mcpCall(a.ctx, 'find', {})).reply?.show_to_builder);
    assert.equal(links(s).length, 0, s);
    assert.match(s, /Ways to get funded/);
    assert.equal((s.match(/\?/g) ?? []).length, 1, s);
    assert.ok(s.endsWith("What's your GitHub, or a link to something you've made?"), s);
  } finally {
    process.env.X_CLIENT_ID = 'cid';
  }
});

test('9.13 D14: the link score shows is minted for the calling installation; its code binds through find; that reply names the account first', db, async () => {
  const a = await agent();
  const s = rule((await mcpCall(a.ctx, 'score', {})).reply);
  assert.match(s, /You're not on the Bench yet\./);
  const link = links(s)[0];
  assert.match(link, /^https:\/\/earnkit\.com\/signin\/[A-Za-z0-9_-]{22}$/);
  const [row] = await sql()<{ installation_id: number }[]>`SELECT installation_id FROM x_signin_links WHERE link_hash = encode(sha256(${link.split('/').pop()!}::bytea), 'hex')`;
  assert.equal(row.installation_id, a.ctx.ownInstallationId);
  const handle = `dee${RUN}`.slice(0, 15);
  const code = await signInThrough(link, { id: `97${RUN}4`, username: handle, name: 'Dee', avatar: null });
  assert.ok(code, 'the done page shows a paste code');
  const bound = await mcpCall(a.ctx, 'find', { sign_in_code: code });
  assert.equal(bound.reply?.sign_in_note, SIGN_IN_NOTES.bound);
  const first = rule(bound.reply);
  assert.ok(first.startsWith(`Signed in as @${handle}.\n\n`), first);
  assert.match(first, new RegExp(`Your page: https://earnkit\\.com/${handle}`, 'i'));
  // Once: the next reply goes straight to where they stand.
  const c = (await connectInstallation(String(a.token)))!;
  const next = rule((await mcpCall({ ...a.ctx, installationId: c.id, xUserId: c.x }, 'find', {})).reply);
  assert.ok(next.startsWith('Where you stand'), next);
});

test('9.14 the first reply after the sign-in at install names the account, once', db, async () => {
  const a = await agent({ x: 'eve' });
  const first = rule((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(first.split('\n')[0], new RegExp(`^Signed in as @eve${RUN}\\.$`, 'i'));
  assert.ok(rule((await mcpCall(a.ctx, 'score', {})).reply).startsWith('Where you stand'));
});
