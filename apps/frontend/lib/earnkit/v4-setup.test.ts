import './fixtures/no-network-checks';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './db';
import { mcpCall } from './fixtures/mcp-call';
import { appEnv } from './fixtures/app-install';
import { connectInstallation, saveInstallation } from './installations';
import { attachToX } from './x-install';
import { NO_GITHUB_HINT, benchReply, pickRepoAgain, pickRepoAsk, stateAsk, type BenchView } from './bench-reply';

/**
 * v4.0 Task 3 (docs/design-docs-and-implementation-plans/v4-builder-tokens.md, "Approved copy" 1 and 2): setup steps 1
 * and 2 word for word; the Lovable or Bolt hint only when the builder has no GitHub (said so, a link-only project, or a
 * Lovable or Bolt live link), never assumed.
 */
appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'v4-setup-test-secret';

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
type R = Awaited<ReturnType<typeof mcpCall>>;
const show = (r: R) => String(r.reply?.show_to_builder ?? '');
const linkOf = (s: string) => s.match(/https:\/\/\S+/)?.[0] ?? '';
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HINT = 'Built it in Lovable or Bolt? Connect GitHub there first (Lovable: Project settings, then Git. Bolt: the GitHub icon, top right).';
const intro = (open: string | null, link: string) => [
  '**EarnKit gets you paid for building.**',
  '',
  `Every week I read what you ship, rank you against other builders, and find grants and programs you qualify for.${open ? ` ${open}` : ''}`,
  '',
  'Setup takes about a minute:',
  `1. Sign in with X: ${link}`,
  '2. Connect your code',
  '3. Add your wallet',
  '',
  'Done with step 1?',
].join('\n');
const step2 = (link: string, hint: boolean) =>
  `**Step 2 of 3:** connect your app's code on GitHub so I can match you to the right programs. Read-only, one click: ${link}\n\n${hint ? `${HINT}\n\n` : ''}Done?`;

test('the copy, word for word: the hint sentence and step 2 with and without it', () => {
  assert.equal(NO_GITHUB_HINT, HINT);
  const L = 'https://earnkit.com/github/verify?n=abc';
  assert.equal(pickRepoAsk(L, false), step2(L, false));
  assert.equal(pickRepoAsk(L, true), step2(L, true));
});

test('step 1: the intro with the open grant from its data (amount and organizer), and without one', () => {
  const link = 'https://earnkit.com/signin/abc';
  const v: BenchView = {
    state: 'signed_out', variant: null, project: null, rank: null, streak: 0, target: null, handle: null, link, fund: [], due: [], held: null,
    ask: stateAsk({ state: 'signed_out', variant: null, project: null, link }), open: { org: 'Base', amount: '$5,000', chain: 'Base', name: 'Base Builder Grants' },
  };
  assert.equal(benchReply(v), intro('Up to $5,000 is open from Base right now.', link));
  assert.equal(benchReply({ ...v, open: { org: 'Circle', amount: '$10,000', chain: null } }), intro('Up to $10,000 is open from Circle right now.', link));
  assert.equal(benchReply({ ...v, open: null }), intro(null, link));
  const retry = benchReply({ ...v, link: null, ask: stateAsk({ state: 'signed_out', variant: null, project: null, link: null }) });
  assert.ok(retry.endsWith("I couldn't make your sign-in link just now. Want me to try again?"), retry);
  assert.ok(retry.startsWith('**EarnKit gets you paid for building.**\n\n'), retry);
});

test('step 2 view: the hint only when view.noGithub', () => {
  const link = 'https://earnkit.com/github/verify?n=abc';
  const v = (noGithub: boolean): BenchView => ({ state: 'no_project', variant: null, project: null, rank: null, streak: 0, target: null, handle: 'maya', link, fund: [], due: [], held: null, welcome: true, noGithub, ask: stateAsk({ state: 'no_project', variant: null, project: null, link, noGithub }) });
  assert.equal(benchReply(v(false)), `You're in, @maya. Really glad you're here.\n\n${step2(link, false)}`);
  assert.equal(benchReply(v(true)), `You're in, @maya. Really glad you're here.\n\n${step2(link, true)}`);
});

let n = 0;
/** A signed-in builder with no project yet (the connect step). */
async function newcomer(tag: string) {
  n++;
  const t = `ek_v4s_${tag}_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const own = (await connectInstallation(t))!.own;
  const handle = `v4s${tag}${RUN}`.slice(0, 15);
  assert.ok((await attachToX(own, { id: `94${RUN}${n}${tag.length}`, username: handle, name: 'v4s', avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  return { ctx, id: c.id, handle };
}

test('(a) signed out: the intro block with the sign-in link in item 1, ending "Done with step 1?", no token', db, async () => {
  const t = `ek_v4s_out_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Grok');
  const c = (await connectInstallation(t))!;
  const ctx = { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: async () => ({ checked: 0, scored: 0, fits: [] }) } as never as Parameters<typeof mcpCall>[0];
  const s = show(await mcpCall(ctx, 'find', { agent_can_build: false }));
  const link = linkOf(s);
  assert.match(link, /^https:\/\/\S+\/signin\/[A-Za-z0-9_-]{22}$/, s);
  const grant = s.match(/ (Up to \$[\d,]+ is open from [^.\n]+ right now\.)\n/)?.[1] ?? null;
  assert.equal(s, intro(grant, link));
  assert.ok(s.endsWith('Done with step 1?'), s);
  assert.doesNotMatch(s, /token|coin/i, s);
});

test('(b) first reply after sign-in, GitHub unknown: the welcome, step 2 of 3 with its link, no Lovable or Bolt hint', db, async () => {
  const p = await newcomer('b');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.ok(s.startsWith(`You're in, @${p.handle}. Really glad you're here.`), s);
  assert.match(s, /\*\*Step 2 of 3:\*\*/);
  const link = linkOf(s);
  assert.match(link, /^https:\/\/earnkit\.com\/github\/verify\?n=/, s);
  assert.equal(s, `You're in, @${p.handle}. Really glad you're here.\n\n${step2(link, false)}`);
  assert.doesNotMatch(s, /Built it in Lovable or Bolt\?/);
  // A connect yes with nothing connected and GitHub unknown: no hint either.
  const yes = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } }));
  assert.doesNotMatch(yes, /Built it in Lovable or Bolt/, yes);
});

test('(c) a link-only main project (Lovable): the welcome step 2 carries the hint', db, async () => {
  const p = await newcomer('c');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false, identity: { project: { name: 'MealMate', live_url: 'https://mealmate.lovable.app' } } }));
  assert.ok(s.startsWith(`You're in, @${p.handle}. Really glad you're here.`), s);
  assert.match(s, /\*\*Step 2 of 3:\*\*/);
  assert.ok(s.includes(HINT), s);
  assert.ok(s.endsWith(`${HINT}\n\nDone?`), s);
});

test('(c) a link-only main project on any host: the hint', db, async () => {
  const p = await newcomer('k');
  const s = show(await mcpCall(p.ctx, 'find', { agent_can_build: false, identity: { project: { name: 'Tiply', live_url: 'https://tiply.example.com' } } }));
  assert.match(s, /\*\*Step 2 of 3:\*\*/, s);
  assert.ok(s.includes(HINT), s);
});

test('(c) standing_seen.github_no set: step 2 again (connect after all) carries the hint', db, async () => {
  const p = await newcomer('g');
  await mcpCall(p.ctx, 'find', { agent_can_build: false });
  await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'no' } });
  const s = show(await mcpCall(p.ctx, 'tell', { move_up: { kind: 'pick_repo', project_key: null, answer: 'yes' } }));
  assert.match(s, new RegExp(`^${esc('**Step 2 of 3:**')}`), s);
  assert.ok(s.includes(HINT), s);
});

test('(d) the same-day repeat keeps its short form', db, async () => {
  const p = await newcomer('d');
  await mcpCall(p.ctx, 'find', { agent_can_build: false });
  const second = show(await mcpCall(p.ctx, 'find', { agent_can_build: false }));
  assert.equal(second, pickRepoAgain(linkOf(second)));
  assert.doesNotMatch(second, /You're in|Built it in Lovable/);
});
