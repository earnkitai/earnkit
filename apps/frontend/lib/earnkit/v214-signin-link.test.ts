import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sql } from './db';
import { connectInstallation, saveInstallation } from './installations';
import { mcpCall } from './fixtures/mcp-call';
import { RateLimitError } from './rate-limit';
import { attachToX, xSignInCallback } from './x-install';
import { LINK_TEXT, SIGN_IN_NOTES, bindFromPaste, formatPaste, normalizePaste, pasteCode, signInLink, signinGet } from './x-link';
import type { XOAuthDeps, XUser } from './x-oauth';

process.env.EARNKIT_AUTH_SECRET ??= 'signin-link-test-secret';
process.env.X_CLIENT_ID = 'cid';
process.env.X_CLIENT_SECRET = 'sec';
process.env.EARNKIT_URL = 'https://earnkit.com';
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => { if (process.env.DATABASE_URL) await sql().end(); });

const RUN = String(process.pid % 100000);
const NOW = new Date();
const noLimit = { limit: async () => {} };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const person = (n: string): XUser => ({ id: `92${RUN}${[...n].map((c) => c.charCodeAt(0) % 10).join('')}`, username: `${n}${RUN}`.slice(0, 15), name: n, avatar: null });
const fakeX = (user: XUser): XOAuthDeps => ({ exchange: async () => 'x-token', me: async () => user });
async function install(name: string | null = 'Cursor') {
  const t = `ek_link_${RUN}_${Math.random().toString(36).slice(2)}`;
  await saveInstallation(t, undefined, false, name);
  return { ...(await connectInstallation(t))!, token: t };
}
/** Opens the link in a browser, signs in with X, and reads the paste code off the done page. */
async function signInThrough(link: string, user: XUser): Promise<{ status: number; html: string; code: string | null }> {
  const code = link.split('/').pop()!;
  const page = await signinGet(new Request(link), code, noLimit);
  if (page.status !== 200) return { status: page.status, html: await page.text(), code: null };
  const html = await page.text();
  const to = new URL(/href="(https:\/\/x\.com\/i\/oauth2\/authorize[^"]+)"/.exec(html)![1].replaceAll('&amp;', '&'));
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  const done = await xSignInCallback(new Request(`https://earnkit.com/x/callback?code=c&state=${to.searchParams.get('state')}`, { headers: { cookie } }), { x: fakeX(user), ...noLimit });
  const doneHtml = await done!.text();
  return { status: done!.status, html: doneHtml, code: /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec(doneHtml)?.[1] ?? null };
}
const ctxOf = (c: { id: number; own: number; shared: boolean }) => ({ installationId: c.id, ownInstallationId: c.own, sharedClient: c.shared });
const xOf = async (id: number) => (await sql()<{ x: string | null; b: number | null }[]>`SELECT x_user_id AS x, builder_id AS b FROM installations WHERE id = ${id}`)[0];

test('5.0 paste codes: 12 letters of the alphabet, shown as XXXX-XXXX-XXXX, read back leniently', () => {
  const c = pasteCode();
  assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
  assert.notEqual(pasteCode(), c);
  assert.match(formatPaste(c), /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizePaste(` ${formatPaste(c).toLowerCase()} `), c);
  assert.equal(normalizePaste('ABCD-EFGH-IJK1'), null, 'I and 1 are not in the alphabet');
  assert.equal(normalizePaste('A'.repeat(41)), null);
  assert.equal(normalizePaste(42), null);
});

test('5.1 the link: off without X, shown again while open, a new one after it expires, only its hash kept', db, async () => {
  const c = await install();
  delete process.env.X_CLIENT_ID;
  assert.equal(await signInLink(c.own, NOW), null);
  process.env.X_CLIENT_ID = 'cid';
  const a = await signInLink(c.own, NOW);
  assert.match(a!, /^https:\/\/earnkit\.com\/signin\/[A-Za-z0-9_-]{22}$/);
  assert.equal(await signInLink(c.own, new Date(NOW.getTime() + 60_000)), a);
  const later = await signInLink(c.own, new Date(NOW.getTime() + 24 * 3_600_000));
  assert.notEqual(later, a);
  const [row] = await sql()<{ link_hash: string; seed: string }[]>`SELECT link_hash, seed FROM x_signin_links WHERE installation_id = ${c.own} ORDER BY created_at LIMIT 1`;
  assert.equal(row.link_hash, sha256(a!.split('/').pop()!));
  assert.ok(!a!.includes(row.seed), 'the stored seed is not the code');
});

test('5.2 the page names the agent as it calls itself and warns before one Continue with X; a used or unknown link is 410', db, async () => {
  const c = await install('Cursor');
  const link = (await signInLink(c.own, NOW))!;
  const page = await signinGet(new Request(link), link.split('/').pop()!, noLimit);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes('an agent that calls itself &quot;Cursor&quot;, connected'), html);
  assert.ok(html.includes(LINK_TEXT.warning));
  assert.match(page.headers.get('set-cookie')!, /^__Host-eki-/);
  assert.equal((await signinGet(new Request('https://earnkit.com/signin/nope'), 'A'.repeat(22), noLimit)).status, 410);
  assert.equal((await signinGet(new Request('https://earnkit.com/signin/nope'), 'short', noLimit)).status, 410);
  const evil = await install('<b>Claude</b>');
  const l2 = (await signInLink(evil.own, NOW))!;
  const h2 = await (await signinGet(new Request(l2), l2.split('/').pop()!, noLimit)).text();
  assert.ok(h2.includes('calls itself &quot;&lt;b&gt;Claude&lt;/b&gt;&quot;') && !h2.includes('<b>Claude'), 'the name is escaped');
});

test('5.3 signing in through the link alone binds nothing (a forwarded link can\'t attach anyone); the code page warns', db, async () => {
  const c = await install();
  const r = await signInThrough((await signInLink(c.own, NOW))!, person('fay'));
  assert.equal(r.status, 200);
  assert.ok(r.code, 'the done page shows a paste code');
  assert.ok(r.html.includes(LINK_TEXT.codeWarning));
  // Launch ready L10: the code on its own line, never broken at a dash.
  assert.match(r.html, /<p class="ek-code">[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}<\/p>/);
  assert.equal(LINK_TEXT.codeWarning, 'Anyone you give this code to can act as your EarnKit page. Paste it only into the agent you are using right now.');
  assert.equal((await xOf(c.own)).x, null);
  const [l] = await sql()<{ paste_hash: string }[]>`SELECT paste_hash FROM x_signin_links WHERE installation_id = ${c.own} AND x_user_id IS NOT NULL`;
  assert.equal(l.paste_hash, sha256(r.code!.replaceAll('-', '')), 'only the code\'s hash is kept');
});

test('5.4 the paste code through find binds this installation first; the reply shows the page; one event', db, async () => {
  process.env.EARNKIT_EVENT_LOG = 'on';
  try {
    const c = await install();
    const gus = person('gus');
    const { code } = await signInThrough((await signInLink(c.own, NOW))!, gus);
    const r = await mcpCall(ctxOf(c), 'find', { sign_in_code: code });
    assert.equal(r.isError, false, r.text);
    assert.ok(String(r.reply?.show_to_builder).includes(`earnkit.com/${gus.username}`), r.text);
    assert.equal(r.reply?.sign_in_note, SIGN_IN_NOTES.bound);
    assert.equal((await xOf(c.own)).x, gus.id);
    const [e] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_events WHERE type = 'signed_in_by_code' AND installation_id = ${c.own}`;
    assert.equal(e.n, 1);
  } finally {
    delete process.env.EARNKIT_EVENT_LOG;
  }
});

test('5.5 another installation\'s code, a reused code and a late code are refused through find, nothing bound', db, async () => {
  const mine = await install();
  const other = await install();
  const hal = person('hal');
  const { code } = await signInThrough((await signInLink(mine.own, NOW))!, hal);
  const r = await mcpCall(ctxOf(other), 'find', { sign_in_code: code });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.reply?.sign_in_note, SIGN_IN_NOTES.bad);
  assert.equal((await xOf(other.own)).x, null);
  const ok = await mcpCall(ctxOf(mine), 'find', { sign_in_code: code });
  assert.equal(ok.reply?.sign_in_note, SIGN_IN_NOTES.bound);
  // Fix round 1 (6): the same code again from the same, now bound installation is a retry: signed in, nothing new.
  const again = await mcpCall(ctxOf(mine), 'find', { sign_in_code: code });
  assert.equal(again.reply?.sign_in_note, SIGN_IN_NOTES.bound, 'a retry after the bind');
  const used = await mcpCall(ctxOf(other), 'find', { sign_in_code: code });
  assert.equal(used.reply?.sign_in_note, SIGN_IN_NOTES.bad, 'one use: never another installation');
  const junk = await mcpCall(ctxOf(other), 'find', { sign_in_code: 'not a code' });
  assert.equal(junk.reply?.sign_in_note, SIGN_IN_NOTES.bad);
  const late = await install();
  const l = await signInThrough((await signInLink(late.own, NOW))!, person('ivy'));
  assert.deepEqual(await bindFromPaste(late.own, l.code, new Date(Date.now() + 16 * 60_000)), { ok: false });
  assert.equal((await xOf(late.own)).x, null);
});

test('5.6 D1: an installation already bound to another X can\'t take a code for a new one, and its links are 410', db, async () => {
  const c = await install();
  const jo = person('jo');
  const a = await signInThrough((await signInLink(c.own, NOW))!, jo);
  assert.ok((await bindFromPaste(c.own, a.code, new Date())).ok);
  assert.equal(await signInLink(c.own, NOW), null, 'bound: no link');
  // A link minted before the bind, still open: its page is gone (410).
  const code = `B${RUN}`.padEnd(22, 'B');
  await sql()`INSERT INTO x_signin_links (link_hash, installation_id, expires_at) VALUES (${sha256(code)}, ${c.own}, now() + interval '1 hour')`;
  assert.equal((await signinGet(new Request(`https://earnkit.com/signin/${code}`), code, noLimit)).status, 410);
  // A paste code for kim on this installation (as if signed in before the bind): refused by attachToX's other_x.
  const kim = person('kim');
  const paste = 'KKKKMMMMNNNN';
  await sql()`INSERT INTO x_signin_links (link_hash, installation_id, expires_at, x_user_id, x_handle, x_name, paste_hash, paste_expires_at)
    VALUES (${sha256(`K${code}`)}, ${c.own}, now() + interval '1 hour', ${kim.id}, ${kim.username}, ${kim.name}, ${sha256(paste)}, now() + interval '10 minutes')`;
  assert.deepEqual(await bindFromPaste(c.own, formatPaste(paste), new Date()), { ok: false });
  assert.equal((await xOf(c.own)).x, jo.id, 'still jo');
  const [p] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM builder_profiles WHERE x_user_id = ${kim.id}`;
  assert.equal(p.n, 0);
});

test('5.7 D2 no merge: an older installation with data signs in to an X that has a page: attached alone, its rows stay behind', db, async () => {
  const lia = person('lia');
  const pageInst = await install();
  const made = await attachToX(pageInst.own, lia, NOW);
  assert.ok(made.ok);
  const old = await install();
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${old.own}, ${`old${RUN}${old.own}`}, now()) ON CONFLICT DO NOTHING`;
  const ref = `https://old${RUN}${old.own}.example`;
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, proposed_by, state) VALUES (${old.own}, 'site', ${ref}, ${ref}, 'agent', 'proposed')`;
  const { code } = await signInThrough((await signInLink(old.own, NOW))!, lia);
  const b = await bindFromPaste(old.own, code, new Date());
  assert.ok(b.ok && b.root === made.root);
  const [kept] = await sql()<{ builder_id: number }[]>`SELECT builder_id FROM builder_sources WHERE ref = ${ref}`;
  assert.equal(kept.builder_id, old.own, 'the proposed row stays on the old installation');
  const [p] = await sql()<{ x_handle: string }[]>`SELECT x_handle FROM builder_profiles WHERE builder_id = ${made.root}`;
  assert.equal(p.x_handle, lia.username);
  assert.equal((await connectInstallation(old.token))!.id, made.root, 'the old installation acts as the page now');
});

test('5.8 a member of another root, with no page for the X: its builder_id is cleared and the page is made on it alone', db, async () => {
  const root = await install();
  const member = await install();
  await sql()`UPDATE installations SET builder_id = ${root.own} WHERE id = ${member.own}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at) VALUES (${root.own}, ${`r${RUN}${root.own}`}, now()) ON CONFLICT DO NOTHING`;
  const mo = person('mo');
  const { code } = await signInThrough((await signInLink(member.own, NOW))!, mo);
  const b = await bindFromPaste(member.own, code, new Date());
  assert.ok(b.ok && b.root === member.own, JSON.stringify(b));
  assert.deepEqual(await xOf(member.own), { x: mo.id, b: null });
  const [p] = await sql()<{ builder_id: number }[]>`SELECT builder_id FROM builder_profiles WHERE x_user_id = ${mo.id}`;
  assert.equal(p.builder_id, member.own);
  const [r] = await sql()<{ x: string | null }[]>`SELECT x_user_id AS x FROM builder_profiles WHERE builder_id = ${root.own}`;
  assert.equal(r.x, null, 'the old root is not claimed');
  assert.equal((await connectInstallation(root.token))!.id, root.own);
});

test('5.9 a root with members: the members are detached first (each its own anonymous root, nothing deleted), then the root binds', db, async () => {
  const root = await install();
  const m1 = await install();
  const m2 = await install();
  await sql()`UPDATE installations SET builder_id = ${root.own} WHERE id IN (${m1.own}, ${m2.own})`;
  await sql()`INSERT INTO answer_bank (installation_id, project_key, kind, answer, program_id) VALUES (${m1.own}, 'k', 'pitch', 'm1 answer', 'p')`;
  const ned = person('ned');
  const { code } = await signInThrough((await signInLink(root.own, NOW))!, ned);
  const b = await bindFromPaste(root.own, code, new Date());
  assert.ok(b.ok && b.root === root.own);
  for (const m of [m1, m2]) {
    assert.deepEqual(await xOf(m.own), { x: null, b: null });
    const c = (await connectInstallation(m.token))!;
    assert.equal(c.id, m.own, 'not the page');
    assert.equal(c.x, null);
  }
  const [a] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM answer_bank WHERE installation_id = ${m1.own}`;
  assert.equal(a.n, 1, 'nothing deleted');
  // The same through the token path (attachToX), with the X already holding a page elsewhere.
  const other = await install();
  const m3 = await install();
  await sql()`UPDATE installations SET builder_id = ${other.own} WHERE id = ${m3.own}`;
  const r = await attachToX(other.own, ned, new Date());
  assert.ok(r.ok && r.root === root.own);
  assert.deepEqual(await xOf(m3.own), { x: null, b: null });
});

test('5.10 v3: a hosted client\'s bad sign_in_code binds nothing; X off gives no link', db, async () => {
  const s = await install('Grok');
  await sql()`UPDATE installations SET shared_client = true WHERE id = ${s.own}`;
  const r = await mcpCall({ ...ctxOf(s), sharedClient: true }, 'find', { sign_in_code: 'ABCD-EFGH-JKMN' });
  assert.equal(r.isError, false, r.text);
  assert.ok(r.reply?.sign_in_note, 'the code is read, and refused');
  assert.equal((await xOf(s.own)).x, null);
  delete process.env.X_CLIENT_ID;
  try {
    assert.equal(await signInLink(s.own, NOW), null);
  } finally {
    process.env.X_CLIENT_ID = 'cid';
  }
});

test('5.11 fix 1: an unbound root whose page another X claimed can\'t sign in to an X that has a page; nothing changes', db, async () => {
  const pageInst = await install();
  const pia = person('pia');
  const made = await attachToX(pageInst.own, pia, NOW);
  assert.ok(made.ok);
  const r = await install();
  const m = await install();
  await sql()`UPDATE installations SET builder_id = ${r.own} WHERE id = ${m.own}`;
  await sql()`INSERT INTO builder_profiles (builder_id, slug, first_find_at, x_user_id, x_handle) VALUES (${r.own}, ${`y${RUN}${r.own}`}, now(), ${`93${RUN}${r.own}`}, NULL)`;
  const { code } = await signInThrough((await signInLink(r.own, NOW))!, pia);
  assert.deepEqual(await bindFromPaste(r.own, code, new Date()), { ok: false });
  assert.deepEqual(await xOf(r.own), { x: null, b: null });
  assert.deepEqual(await xOf(m.own), { x: null, b: r.own }, 'its member is still attached');
  // A member of that root is refused too (its group's page is the other X's).
  const { code: c2 } = await signInThrough((await signInLink(m.own, NOW))!, pia);
  assert.deepEqual(await bindFromPaste(m.own, c2, new Date()), { ok: false });
  assert.deepEqual(await xOf(m.own), { x: null, b: r.own });
});

test('5.12 fix 2: opening links is rate-limited per IP before any write (429)', db, async () => {
  const c = await install();
  const link = (await signInLink(c.own, NOW))!;
  const code = link.split('/').pop()!;
  const refused = await signinGet(new Request(link), code, { limit: async () => { throw new RateLimitError('x', 60); } });
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get('set-cookie'), null);
  const ip = `198.51.100.${Number(RUN) % 250}`;
  const req = () => new Request(link, { headers: { 'x-real-ip': ip } });
  for (let i = 0; i < 30; i++) assert.equal((await signinGet(req(), code)).status, 200);
  assert.equal((await signinGet(req(), code)).status, 429);
});

test('5.13 fix 3: the X user is written to the link this browser opened, not the newest one', db, async () => {
  const c = await install();
  const old = (await signInLink(c.own, NOW))!;
  const newer = (await signInLink(c.own, new Date(NOW.getTime() + 24 * 3_600_000 - 30 * 60_000)))!;
  assert.notEqual(newer, old);
  const r = await signInThrough(old, person('quin'));
  assert.ok(r.code);
  const rows = await sql()<{ link_hash: string; x: string | null }[]>`SELECT link_hash, x_user_id AS x FROM x_signin_links WHERE installation_id = ${c.own}`;
  const byHash = new Map(rows.map((x) => [x.link_hash, x.x]));
  assert.equal(byHash.get(sha256(old.split('/').pop()!)), person('quin').id);
  assert.equal(byHash.get(sha256(newer.split('/').pop()!)), null);
});

test('5.14 fix 5 and 7: a thrown error mid-bind rolls the detach back and gives the code back; the retry binds', db, async () => {
  const root = await install();
  const m = await install();
  await sql()`UPDATE installations SET builder_id = ${root.own} WHERE id = ${m.own}`;
  const rae = person('rae');
  const { code } = await signInThrough((await signInLink(root.own, NOW))!, rae);
  const fn = `t5_fail_${RUN}`;
  await sql().unsafe(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id = ${root.own} AND NEW.x_user_id IS NOT NULL THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`);
  await sql().unsafe(`CREATE TRIGGER ${fn} BEFORE UPDATE ON installations FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  try {
    await assert.rejects(bindFromPaste(root.own, code, new Date()), /injected/);
  } finally {
    await sql().unsafe(`DROP TRIGGER ${fn} ON installations`);
    await sql().unsafe(`DROP FUNCTION ${fn}()`);
  }
  assert.deepEqual(await xOf(root.own), { x: null, b: null });
  assert.deepEqual(await xOf(m.own), { x: null, b: root.own }, 'the detach rolled back');
  const [l] = await sql()<{ used_at: Date | null }[]>`SELECT used_at FROM x_signin_links WHERE installation_id = ${root.own} AND x_user_id IS NOT NULL`;
  assert.equal(l.used_at, null, 'the code is given back');
  const r = await mcpCall(ctxOf(root), 'find', { sign_in_code: code });
  assert.equal(r.reply?.sign_in_note, SIGN_IN_NOTES.bound, r.text);
  assert.deepEqual(await xOf(m.own), { x: null, b: null });
});

test('5.15 fix 7: held case, the installation a member of a third root: it alone joins the page; that root and its members stay', db, async () => {
  const pageInst = await install();
  const sol = person('sol');
  const made = await attachToX(pageInst.own, sol, NOW);
  assert.ok(made.ok);
  const third = await install();
  const me = await install();
  const sib = await install();
  await sql()`UPDATE installations SET builder_id = ${third.own} WHERE id IN (${me.own}, ${sib.own})`;
  const { code } = await signInThrough((await signInLink(me.own, NOW))!, sol);
  const b = await bindFromPaste(me.own, code, new Date());
  assert.ok(b.ok && b.root === made.root);
  assert.deepEqual(await xOf(me.own), { x: sol.id, b: made.root });
  assert.deepEqual(await xOf(sib.own), { x: null, b: third.own });
  assert.deepEqual(await xOf(third.own), { x: null, b: null });
  assert.equal((await connectInstallation(sib.token))!.id, third.own);
});

test('5.16 fix 2 (C): a failed after-step (discovery) once the bind committed: ok, and the code stays used', db, async () => {
  const c = await install();
  const tia = person('tia');
  const { code } = await signInThrough((await signInLink(c.own, NOW))!, tia);
  const fn = `t5_disc_${RUN}`;
  await sql().unsafe(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.builder_id = ${c.own} THEN RAISE EXCEPTION 'injected after'; END IF; RETURN NEW; END $$`);
  await sql().unsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON discovery_queue FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  let b: Awaited<ReturnType<typeof bindFromPaste>>;
  try {
    b = await bindFromPaste(c.own, code, new Date());
  } finally {
    await sql().unsafe(`DROP TRIGGER ${fn} ON discovery_queue`);
    await sql().unsafe(`DROP FUNCTION ${fn}()`);
  }
  assert.ok(b.ok);
  assert.equal((await xOf(c.own)).x, tia.id);
  const [l] = await sql()<{ used_at: Date | null }[]>`SELECT used_at FROM x_signin_links WHERE installation_id = ${c.own} AND x_user_id IS NOT NULL`;
  assert.notEqual(l.used_at, null);
});
