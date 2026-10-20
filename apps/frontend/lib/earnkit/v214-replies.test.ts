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
import { signedOutNow, takeSignedIn } from './bench-find';
import { committedProgram } from './fixtures/program-file';
import { ProgramFile } from './program-file';
import { upsertProgram } from './programs';
import { SIGN_IN_NOTES, signinGet } from './x-link';
import type { XOAuthDeps, XUser } from './x-oauth';
import { endsOnRankedStep } from './fixtures/ranked-step';

appEnv();
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
process.env.EARNKIT_AUTH_SECRET ??= 'replies-test-secret';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });
const RUN = String(process.pid % 100000);
const NO_MATCH = (async () => ({ checked: 1, scored: 0, fits: [] })) as never;
const links = (s: string) => s.match(/https?:\/\/\S+/g) ?? [];
/** D12: the rank phrase as 12.3 reads it: "#N of M builders" or a top percent. */
/** Scoring and clarity (R16c): the ranked stand line is the score line. */
const RANK = ': Shipping \\d+ · (#\\d+ of \\d+ builders?|Top \\d+(\\.\\d)?% of builders) this week';
function rule(reply: Record<string, unknown> | null) {
  const s = String(reply?.show_to_builder ?? '');
  assert.equal(links(s).length, 1, s);
  // R8, L5: a ranked reply ends on the one statement, the weekly target (no question); every other on one question.
  const ranked = endsOnRankedStep(s);
  assert.equal((s.replace(/https?:\/\/\S+/g, '').match(/\?/g) ?? []).length, ranked ? 0 : 1, s);
  assert.ok(ranked || s.trimEnd().endsWith('?'), s);
  assert.match(s, /Ways to get funded/);
  return s;
}
async function agent(o: { x?: string } = {}) {
  const t = `ek_rep_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  if (o.x) assert.ok((await attachToX(own, { id: `98${RUN}${o.x.length}${o.x.charCodeAt(0)}`, username: `${o.x}${RUN}`.slice(0, 15), name: o.x, avatar: null }, new Date())).ok);
  const c = (await connectInstallation(t))!;
  // Fix round 1 (minor 4): repo matching stubbed, so nothing reaches for GitHub.
  return { id: c.id, token: t, ctx: { installationId: c.id, ownInstallationId: c.own, sharedClient: false, matchProjects: NO_MATCH } };
}

test('9.8 state 1, not signed in: the sign-in link and its question', db, async () => {
  const a = await agent();
  const s = rule((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(s, /You're not on the leaderboard yet\./);
  assert.match(s, /https:\/\/earnkit\.com\/signin\/[A-Za-z0-9_-]{22}/);
  const yes = await mcpCall(a.ctx, 'tell', { move_up: { kind: 'sign_in', project_key: null, answer: 'yes' } });
  assert.match(String(yes.reply?.agent_note), /sign_in_code/);
});

test('9.9 state 2, signed in with no project: the page and the repo picker (launch ready L2)', db, async () => {
  const a = await agent({ x: 'abe' });
  const s = rule((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(s, new RegExp(`Your page: earnkit\\.com/abe${RUN}`, 'i'));
  assert.match(s, /Install the read-only EarnKit app on the repo you want ranked \(one click\): https:\/\/earnkit\.com\/github\/verify\?n=/);
  assert.ok(s.endsWith("Want me to rank it once that's done?"));
  assert.doesNotMatch(s, /What's your GitHub/);
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
  assert.match(four, new RegExp(`Kit${RANK}\\.`));
});

test('9.11 R16a: shipping weekly is the ranked state; the streak lives in the score (the reply carries it, the stand line does not)', db, async () => {
  const a = await agent({ x: 'cy' });
  const key = `cy${RUN}/app`;
  await mcpCall(a.ctx, 'find', { identity: { project: { name: 'App', repo: `https://github.com/${key}` } } });
  await installApp({ builderId: a.id, repoKey: key, login: `cy${RUN}`, gh: fakeGitHub({ [key]: { id: 5002, owner: `cy${RUN}`, installation: 502 } }) });
  await rescorePerson(a.id, new Date());
  // The streak and the weeks it counts, so a rescore during the call keeps it.
  const weeks = [14, 7, 0].map((d) => isoWeekOf(new Date(Date.now() - d * 86_400_000)));
  await sql()`UPDATE builder_projects SET streak = 3, ship_weeks = ${weeks}::text[] WHERE builder_id = ${a.id} AND lower(project_key) = ${key}`;
  const reply = (await mcpCall(a.ctx, 'score', {})).reply;
  const s = rule(reply);
  assert.match(s, new RegExp(`App${RANK}\\.\n`));
  assert.doesNotMatch(s, /weeks in a row/);
  assert.equal(reply?.streak, 3);
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
  assert.match(s, /You're not on the leaderboard yet\./);
  const link = links(s)[0]!;
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
  assert.match(first, new RegExp(`Your page: earnkit\\.com/${handle}`, 'i'));
  // Once: the next reply goes straight to where they stand.
  const c = (await connectInstallation(String(a.token)))!;
  const next = rule((await mcpCall({ ...a.ctx, installationId: c.id }, 'find', {})).reply);
  assert.ok(next.startsWith('Where you stand'), next);
});

test('9.14 the first reply after the sign-in at install names the account, once', db, async () => {
  const a = await agent({ x: 'eve' });
  const first = rule((await mcpCall(a.ctx, 'find', {})).reply);
  assert.match(first.split('\n')[0], new RegExp(`^Signed in as @eve${RUN}\\.$`, 'i'));
  assert.ok(rule((await mcpCall(a.ctx, 'score', {})).reply).startsWith('Where you stand'));
});

test('9.15 fix round 1: signed out with a results question due: the sign-in question wins and the results question waits for the bind', db, async () => {
  const a = await agent();
  const prog = `rep-${RUN}-out`;
  const p = committedProgram('arc-microgrants');
  await upsertProgram(ProgramFile.parse({ ...p, id: prog, status: 'active', ends_at: new Date(Date.now() + 20 * 86_400_000).toISOString() }));
  await sql()`UPDATE programs SET results = '{"expected": "2026-01-01"}'::jsonb WHERE id = ${prog}`;
  const [{ id: pid }] = await sql()<{ id: number }[]>`INSERT INTO projects (program_id, name, installation_id, submitted_at) VALUES (${prog}, 'Kit', ${a.ctx.ownInstallationId}, now()) RETURNING id`;
  const out = await mcpCall(a.ctx, 'find', {});
  const s = rule(out.reply);
  assert.equal(links(s).length, 1);
  assert.match(links(s)[0]!, /\/signin\//);
  assert.ok(s.endsWith("Want me to put your work on the leaderboard once you're in?"), s);
  assert.equal(out.reply?.ask_outcome, undefined);
  const [row] = await sql()<{ at: Date | null }[]>`SELECT outcome_asked_at AS at FROM projects WHERE id = ${pid}`;
  assert.equal(row.at, null, 'not used up while signed out');
  const handle = `fio${RUN}`.slice(0, 15);
  const code = await signInThrough(links(s)[0]!, { id: `97${RUN}6`, username: handle, name: 'Fio', avatar: null });
  const bound = await mcpCall(a.ctx, 'find', { sign_in_code: code });
  const first = rule(bound.reply);
  assert.ok(first.startsWith(`Signed in as @${handle}.`), first);
  assert.ok(first.endsWith(`Did Kit win anything in ${p.title}?`), first);
  assert.equal((bound.reply?.ask_outcome as { project_id?: number } | undefined)?.project_id, pid);
  await sql()`DELETE FROM projects WHERE id = ${pid}`;
});

test('9.16 fix round 1 (minor 2): a sign-in link that fails to mint is still signed out (a retry question), never "no project"', db, async () => {
  const a = await agent();
  await sql().unsafe(`CREATE OR REPLACE FUNCTION rep_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.installation_id = ${Number(a.ctx.ownInstallationId)} THEN RAISE EXCEPTION 'test: mint fails'; END IF; RETURN NEW; END $$`);
  await sql().unsafe('CREATE TRIGGER rep_fail_link BEFORE INSERT ON x_signin_links FOR EACH ROW EXECUTE FUNCTION rep_fail_link()');
  const was = console.error;
  console.error = () => {};
  try {
    const r = await mcpCall(a.ctx, 'find', {});
    const s = String(r.reply?.show_to_builder);
    assert.match(s, /You're not on the leaderboard yet\./);
    assert.equal(links(s).length, 0, s);
    assert.match(s, /Ways to get funded/);
    assert.ok(s.endsWith("I couldn't make your sign-in link just now. Want me to try again?"), s);
    assert.equal((r.reply?.move_up as { kind?: string } | undefined)?.kind, 'sign_in');
    assert.doesNotMatch(s, /What's your GitHub/);
  } finally {
    console.error = was;
    await sql().unsafe('DROP TRIGGER IF EXISTS rep_fail_link ON x_signin_links');
  }
  // Once it can be made again, the link is back.
  assert.match(String((await mcpCall(a.ctx, 'find', {})).reply?.show_to_builder), /\/signin\/[A-Za-z0-9_-]{22}/);
});

test('9.17 fix round 1 (minor 1): a yes to an old build or grants ask clears it ("Okay.")', db, async () => {
  const a = await agent({ x: 'gil' });
  await mcpCall(a.ctx, 'find', {});
  for (const kind of ['build', 'grants', 'grants_later']) {
    await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json({ kind, key: null } as never)}::jsonb) WHERE builder_id = ${a.id}`;
    const r = await mcpCall(a.ctx, 'tell', { move_up: { kind, project_key: null, answer: 'yes' } });
    assert.equal(r.reply?.show_to_builder, 'Okay.', kind);
    const [x] = await sql()<{ ask: unknown }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${a.id}`;
    assert.equal(x.ask, null, kind);
  }
});

test('final fix 11: "Signed in as" is cleared only by a reply that can show it (a handle), never by a failed read', db, async () => {
  const t = `ek_rep_seen_${process.pid}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const own = (await connectInstallation(t))!.own;
  await sql()`UPDATE installations SET x_signed_in_unseen = true WHERE id = ${own}`;
  const unseen = async () => (await sql()<{ u: boolean }[]>`SELECT x_signed_in_unseen AS u FROM installations WHERE id = ${own}`)[0].u;
  assert.equal(await takeSignedIn(own, null), null);
  assert.equal(await unseen(), true, 'a reply with no handle (EMPTY_BASE) keeps it');
  assert.equal(await takeSignedIn(own, 'lee'), 'Signed in as @lee.');
  assert.equal(await unseen(), false);
  assert.equal(await takeSignedIn(own, 'lee'), null, 'once');
});

test('final fix 12: with X on, a failed signed-out read is signed out (the retry question), never signed in', db, async () => {
  const err = console.error;
  console.error = () => {};
  try {
    // An id past int4 makes the read fail in Postgres.
    assert.equal(await signedOutNow(2 ** 40, 2 ** 40), true);
  } finally {
    console.error = err;
  }
  const t = `ek_rep_so_${process.pid}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, 'Claude Code');
  const c = (await connectInstallation(t))!;
  assert.equal(await signedOutNow(c.id, c.own), true, 'not bound, no page: signed out');
  const x = process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_ID;
  try {
    assert.equal(await signedOutNow(2 ** 40, 2 ** 40), false, 'X off is never signed out (A5)');
  } finally {
    process.env.X_CLIENT_ID = x;
  }
});
