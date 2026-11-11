import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { getBuilder, getRecord, linkInstallation, saveRecord, upsertBuilder } from './builders';
import { csrfToken, problemShown, seenOf } from './me-view';
import { createLinkCode } from './link-routes';
import { approvePost, deletePost, editPost, linkPost, meGet, policyPost, signoutPost, unlinkPost } from './me-routes';
import { answerFor, mergeRecord } from './record';
import { createSession } from './sessions';

after(() => sql().end());

const SECRET = 'me-test-secret-0123456789abcdef0123456789';
const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = NOW.toISOString().slice(0, 10);
before(() => {
  process.env.EARNKIT_AUTH_SECRET = SECRET;
  process.env.EARNKIT_URL = 'https://earnkit.test';
});

let gh = 700_000;
async function signedIn(login = `me${gh}`) {
  const b = await upsertBuilder({ github_id: ++gh, login, name: null, avatar_url: null }, NOW);
  const { token } = await createSession(b.id, NOW);
  return { b, token, cookie: `ek_me=${token}`, csrf: csrfToken(b.id, DAY, SECRET, token) };
}
/** A /me form post; from EarnKit's own page (Origin) unless `origin` says otherwise (null: no Origin header). */
const post = (path: string, form: Record<string, string | string[]>, o: { cookie?: string; type?: string; body?: string; origin?: string | null; referer?: string } = {}) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  const origin = o.origin === undefined ? 'https://earnkit.test' : o.origin;
  return new Request(`https://earnkit.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': o.type ?? 'application/x-www-form-urlencoded', ...(o.cookie ? { cookie: o.cookie } : {}),
      ...(origin !== null ? { origin } : {}), ...(o.referer ? { referer: o.referer } : {}),
    },
    body: o.body ?? body.toString(),
  });
};
const deps = { now: NOW };
/** The signed line a 303 to /me carries: its key (problem or note), the text, and whether builder `who`'s page would show it. */
const lineOf = (r: Response, who: number) => {
  const loc = new URL(r.headers.get('location') ?? '/', 'https://earnkit.test');
  const key = loc.searchParams.has('problem') ? 'problem' : loc.searchParams.has('note') ? 'note' : null;
  const text = key ? loc.searchParams.get(key)! : null;
  return { status: r.status, path: loc.pathname, key, text, shown: key !== null && text !== null && problemShown(key, text, loc.searchParams.get('sig') ?? '', who, NOW, SECRET) === text };
};
/** L21-11 (v6.1.16): a save comes back to /me with the signed `Saved.` note, the saved control in `at` and the block's
 *  anchor: "person.name#person". Empty when it is not a signed Saved. for this builder. */
const savedTo = (r: Response, who = 0) => {
  const loc = new URL(r.headers.get('location') ?? '/', 'https://earnkit.test');
  // L27-10 (v6.1.16): a section's Save (and the policy form) is /me?saved={section}#{section}, unsigned.
  const section = loc.searchParams.get('saved');
  if (r.status === 303 && loc.pathname === '/me' && section) return `${section}${loc.hash}`;
  const ok = r.status === 303 && loc.pathname === '/me' && loc.searchParams.get('note') === 'Saved.' && (who === 0 || problemShown('note', 'Saved.', loc.searchParams.get('sig') ?? '', who, NOW, SECRET) === 'Saved.');
  return ok ? `${loc.searchParams.get('at')}${loc.hash}` : '';
};
const refused = (who: number, r: Response, text: string) => assert.deepEqual(lineOf(r, who), { status: 303, path: '/me', key: 'problem', text, shown: true });
const FIELD = 'That cannot be changed here.';
const EXPIRED_PAGE = 'This page expired. Reload it and try again.';

test('me refuses without a session', async () => {
  const { b, csrf } = await signedIn();
  const before = await getRecord(b.id);
  const calls = [
    editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Mallory' }), deps),
    approvePost(post('/me/approve', { csrf, path: 'answers.problem', action: 'approve' }), deps),
    policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: '3' }), deps),
    deletePost(post('/me/delete', { csrf, confirm: b.login }), deps),
    signoutPost(post('/me/signout', { csrf }), deps),
    unlinkPost(post('/me/unlink', { csrf, installation_id: '1' }), deps),
    linkPost(post('/me/link', { csrf, code: 'x'.repeat(22), action: 'link' }), deps),
  ];
  for (const r of await Promise.all(calls)) assert.equal(r.status, 403);
  assert.deepEqual(await getRecord(b.id), before);
  assert.ok(await getBuilder(b.id));
});

test('a wrong or old csrf comes back to /me with the expired line and nothing changes (v6.1.7 C5)', async () => {
  const { b, cookie, token } = await signedIn();
  const other = csrfToken(b.id + 1, DAY, SECRET, token);
  const old = csrfToken(b.id, new Date(NOW.getTime() - 2 * 86_400_000).toISOString().slice(0, 10), SECRET, token);
  for (const csrf of ['', 'nope', other, old]) {
    const r = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Mallory' }, { cookie }), deps);
    refused(b.id, r, EXPIRED_PAGE);
  }
  assert.equal((await getRecord(b.id)).person.name, undefined);
});

test('meGet without a session redirects to /docs#record', async () => {
  for (const cookie of [undefined, 'ek_me=forged']) {
    const r = await meGet(new Request('https://earnkit.test/me', { headers: cookie ? { cookie } : {} }), deps);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location')?.replace(/^https:\/\/[^/]+/, ''), '/docs#record');
    assert.equal(await r.text(), '');
  }
  // Behind the proxy the request URL is the internal one; the Location is the public origin, like every other redirect.
  const inside = await meGet(new Request('http://10.0.0.7:8080/me'), deps);
  assert.equal(inside.headers.get('location'), 'https://earnkit.test/docs#record');
  const { cookie } = await signedIn();
  const ok = await meGet(new Request('https://earnkit.test/me', { headers: { cookie } }), deps);
  assert.notEqual(ok.status, 302);
});

test('L21-14 (v6.1.16): signed out, /me?link=<code> goes to /link/<code>, which signs in and returns to the code', async () => {
  const code = 'A'.repeat(22);
  const r = await meGet(new Request(`https://earnkit.test/me?link=${code}`), deps);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `https://earnkit.test/link/${code}`);
  // Anything that is not code-shaped keeps /docs#record; nothing of it reaches the Location.
  for (const bad of ['nope', '..%2F..%2Fadmin', 'A'.repeat(23), ''])
    assert.equal((await meGet(new Request(`https://earnkit.test/me?link=${bad}`), deps)).headers.get('location'), 'https://earnkit.test/docs#record', bad);
  // Signed in, the page renders as before.
  const { cookie } = await signedIn();
  assert.notEqual((await meGet(new Request(`https://earnkit.test/me?link=${code}`, { headers: { cookie } }), deps)).status, 302);
});

test('editPost on person.name saves with set_by builder', async () => {
  const { b, cookie, csrf } = await signedIn();
  const r = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Ada Lovelace' }, { cookie }), deps);
  assert.equal(r.status, 303);
  assert.equal(savedTo(r, b.id), 'person.name#person');
  const rec = await getRecord(b.id);
  assert.equal(rec.person.name, 'Ada Lovelace');
  assert.equal(rec.meta['person.name'].set_by, 'builder');
  // An empty value clears it; a bad one comes back as a problem in builder words; an unknown path is a line too.
  const bad = await editPost(post('/me/edit', { csrf, path: 'person.email', value: 'not-an-email' }, { cookie }), deps);
  assert.equal(bad.status, 303);
  const problem = new URL(bad.headers.get('location')!, 'https://earnkit.test').searchParams.get('problem')!;
  assert.match(problem, /^Email: /);
  assert.ok(!problem.includes('person.'));
  const sig = new URL(bad.headers.get('location')!, 'https://earnkit.test').searchParams.get('sig')!;
  assert.equal(problemShown('problem', problem, sig, b.id, NOW, SECRET), problem);
  assert.equal(problemShown('problem', 'Crafted text.', sig, b.id, NOW, SECRET), null);
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'meta.x', value: '1' }, { cookie }), deps), FIELD);
  assert.equal((await editPost(post('/me/edit', { csrf, path: 'person.technical', value: 'on' }, { cookie }), deps)).status, 303);
  assert.equal((await getRecord(b.id)).person.technical, true);
  await editPost(post('/me/edit', { csrf, path: 'person.name', value: '' }, { cookie }), deps);
  assert.equal((await getRecord(b.id)).person.name, undefined);
});

test('editPost on a project field and a project answer', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { projects: [{ id: 'kit', name: 'Kit' }] }, 'agent', NOW).record, NOW);
  assert.equal(savedTo(await editPost(post('/me/edit', { csrf, path: 'projects.kit.one_liner', value: 'Grants for builders' }, { cookie }), deps)), 'projects.kit.one_liner#projects');
  assert.equal((await getRecord(b.id)).projects[0].one_liner, 'Grants for builders');
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'projects.nope.name', value: 'x' }, { cookie }), deps), FIELD);
});

test('approvePost sets approved_at and answerFor then returns the text', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { answers: { problem: { text: 'Builders miss grants.' } } }, 'agent', NOW).record, NOW);
  assert.equal(answerFor(await getRecord(b.id), null, 'problem'), null);
  const seen = seenOf(await getRecord(b.id), 'answers.problem');
  const r = await approvePost(post('/me/approve', { csrf, path: 'answers.problem', action: 'approve', seen }, { cookie }), deps);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/me#approvals');
  const rec = await getRecord(b.id);
  assert.equal(rec.meta['answers.problem'].approved_at, NOW.toISOString());
  assert.deepEqual(answerFor(rec, null, 'problem'), { text: 'Builders miss grants.', short: null });
  await approvePost(post('/me/approve', { csrf, path: 'answers.problem', action: 'unapprove' }, { cookie }), deps);
  assert.equal(answerFor(await getRecord(b.id), null, 'problem'), null);
  refused(b.id, await approvePost(post('/me/approve', { csrf, path: 'person.name', action: 'approve' }, { cookie }), deps), FIELD);
});

test('an approval is bound to the text seen: an agent write since the render is not approved', async () => {
  const { b, cookie, csrf } = await signedIn();
  const t1 = new Date(NOW.getTime() - 60_000);
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { answers: { team: { text: 'Two founders.' } } }, 'agent', t1).record, t1);
  const stale = seenOf(await getRecord(b.id), 'answers.team');
  assert.equal(stale, t1.toISOString());
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { answers: { team: { text: 'Ten founders, trust me.' } } }, 'agent', NOW).record, NOW);
  const r = await approvePost(post('/me/approve', { csrf, path: 'answers.team', action: 'approve', seen: stale }, { cookie }), deps);
  assert.equal(r.status, 303);
  const loc = new URL(r.headers.get('location')!, 'https://earnkit.test');
  assert.equal(loc.searchParams.get('problem'), 'This text changed since you opened the page. Read it again.');
  assert.equal(answerFor(await getRecord(b.id), null, 'team'), null);
  // Without seen it is refused too (the field had meta).
  await approvePost(post('/me/approve', { csrf, path: 'answers.team', action: 'approve' }, { cookie }), deps);
  assert.equal(answerFor(await getRecord(b.id), null, 'team'), null);
  const fresh = seenOf(await getRecord(b.id), 'answers.team');
  const ok = await approvePost(post('/me/approve', { csrf, path: 'answers.team', action: 'approve', seen: fresh }, { cookie }), deps);
  assert.equal(ok.headers.get('location'), '/me#approvals');
  assert.deepEqual(answerFor(await getRecord(b.id), null, 'team'), { text: 'Ten founders, trust me.', short: null });
});

test('policy changes only through /me/policy; the skip list is the one edit row', async () => {
  const { b, cookie, csrf } = await signedIn();
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'policy.auto_apply', value: 'on' }, { cookie }), deps), FIELD);
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'policy.max_per_night', value: '20' }, { cookie }), deps), FIELD);
  assert.equal((await getRecord(b.id)).policy.auto_apply, false);
  assert.equal((await editPost(post('/me/edit', { csrf, path: 'policy.never', value: 'base-builder-grants\nzz-other' }, { cookie }), deps)).status, 303);
  assert.deepEqual((await getRecord(b.id)).policy.never, ['base-builder-grants', 'zz-other']);
});

test('policyPost turns auto_apply on with max_per_night 3', async () => {
  const { b, cookie, csrf } = await signedIn();
  const r = await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: '3', 'categories[]': ['grant', 'bounty'], max_ask_usd: '', agent_may_submit: 'on' }, { cookie }), deps);
  assert.equal(r.status, 303);
  const p = (await getRecord(b.id)).policy;
  assert.equal(p.auto_apply, true);
  assert.equal(p.max_per_night, 3);
  assert.deepEqual(p.categories, ['grant', 'bounty']);
  assert.equal(p.agent_may_submit, true);
  assert.equal((await getRecord(b.id)).meta['policy.auto_apply'].set_by, 'builder');
  // Unticked boxes are off.
  await policyPost(post('/me/policy', { csrf, max_per_night: '3', 'categories[]': ['grant'] }, { cookie }), deps);
  assert.equal((await getRecord(b.id)).policy.auto_apply, false);
  assert.equal((await getRecord(b.id)).policy.agent_may_submit, false);
});

test('a /me/policy post with one bad value changes nothing and names the field (v6.1.7 B1, Review Focus 5)', async () => {
  const { b, cookie, csrf } = await signedIn();
  const before = await getRecord(b.id);
  const r = await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: '50', 'categories[]': ['grant'], agent_may_submit: 'on' }, { cookie }), deps);
  refused(b.id, r, 'Most per night: a whole number from 1 to 20.');
  assert.deepEqual(await getRecord(b.id), before, 'auto apply, categories and the rest stay as they were');
  for (const bad of ['2.5', 'abc', '0']) {
    refused(b.id, await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: bad, 'categories[]': ['grant'] }, { cookie }), deps), 'Most per night: a whole number from 1 to 20.');
  }
  // Every bad field gets its own line, in the page's labels.
  const two = await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: '50', max_ask_usd: '-5', 'categories[]': ['grant', '<script>'] }, { cookie }), deps);
  refused(b.id, two, 'Most per night: a whole number from 1 to 20.\nSkip awards above (USD): a number of 0 or more.\nCategories: pick one of the options.');
  assert.deepEqual(await getRecord(b.id), before);
});

test('edit problems read as plain words, never the checker\'s (v6.1.7 C4)', async () => {
  const { b, cookie, csrf } = await signedIn();
  const cases: [string, string, string][] = [
    ['person.bio', 'x'.repeat(300), 'Short bio: at most 280 characters.'],
    ['person.based_country', 'USA', 'Country: two capital letters, like US.'],
    ['person.based_country', 'us', 'Country: two capital letters, like US.'],
    ['person.name', 'x'.repeat(10_240), 'Name: at most 80 characters.'],
    ['company.stage', 'unicorn', 'Stage: pick one of the options.'],
    ['traction.waitlist', '-5', 'Waitlist: a whole number from 0 to 10,000,000.'],
    ['traction.waitlist', '2.5', 'Waitlist: a whole number from 0 to 10,000,000.'],
    ['company.raised_usd', 'lots', 'Raised (USD): a number from 0 to 1,000,000,000.'],
    ['docs.deck_url', 'javascript:alert(1)', 'Deck link: a link starting with https://.'],
    ['person.email', 'not-an-email', 'Email: an email address.'],
  ];
  for (const [path, value, line] of cases) refused(b.id, await editPost(post('/me/edit', { csrf, path, value }, { cookie }), deps), line);
  const rec = await getRecord(b.id);
  assert.equal(rec.person.bio, undefined);
  assert.equal(rec.company.stage, undefined);
});

test('delete removes everything', async () => {
  const { b, cookie, csrf } = await signedIn('deleteme');
  const inst = (await sql()`INSERT INTO installations (token_hash) VALUES (${'me-' + Math.random()}) RETURNING id`)[0].id as number;
  await linkInstallation(inst, b.id, NOW);
  await sql()`INSERT INTO applications (installation_id, owner, program_id, status, at) VALUES (${inst}, ${'b:' + b.id}, 'zz-me-del', 'applied', ${NOW})`;
  await sql()`INSERT INTO link_codes (code, installation_id, created_at, expires_at, nonce) VALUES (${'me-del-' + inst}, ${inst}, ${NOW}, ${new Date(NOW.getTime() + 900_000)}, 'n')`;
  const wrong = await deletePost(post('/me/delete', { csrf, confirm: 'someone-else' }, { cookie }), deps);
  refused(b.id, wrong, 'Type your GitHub login to delete.');
  assert.ok(await getBuilder(b.id));
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${'b:' + b.id}`)[0].n, 1);
  const r = await deletePost(post('/me/delete', { csrf, confirm: 'deleteme' }, { cookie }), deps);
  assert.equal(r.status, 303);
  // L21-9 (v6.1.16): the home page says the account is deleted.
  assert.equal(r.headers.get('location'), '/?deleted=1');
  assert.match(r.headers.get('set-cookie') ?? '', /^ek_me=;.*Max-Age=0/);
  assert.equal(await getBuilder(b.id), null);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM sessions WHERE builder_id = ${b.id}`)[0].n, 0);
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${inst}`)[0].builder_id, null);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${'b:' + b.id}`)[0].n, 0);
  assert.equal((await sql()`SELECT count(*)::int AS n FROM link_codes WHERE installation_id = ${inst}`)[0].n, 0);
});

test('signoutPost ends the session; unlinkPost unlinks only the builder\'s own installation', async () => {
  const { b, cookie, csrf } = await signedIn();
  const other = await signedIn();
  const mine = (await sql()`INSERT INTO installations (token_hash) VALUES (${'me-' + Math.random()}) RETURNING id`)[0].id as number;
  const theirs = (await sql()`INSERT INTO installations (token_hash) VALUES (${'me-' + Math.random()}) RETURNING id`)[0].id as number;
  await linkInstallation(mine, b.id, NOW);
  await linkInstallation(theirs, other.b.id, NOW);
  // L21-15 (v6.1.16): an agent that is not the builder's says so.
  refused(b.id, await unlinkPost(post('/me/unlink', { csrf, installation_id: String(theirs) }, { cookie }), deps), 'That agent is not on your account.');
  // An id no installation can have is a line, never a 500 (v6.1.7 B3).
  for (const id of ['1099511627776', '2147483648', '99999999999999999999', 'abc', '', '0', '-1', '1e3'])
    refused(b.id, await unlinkPost(post('/me/unlink', { csrf, installation_id: id }, { cookie }), deps), FIELD);
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${theirs}`)[0].builder_id, other.b.id);
  // L21-7, L21-10 (v6.1.16): the note names the agent as /me shows it; an unnamed one by its link day.
  const gone = await unlinkPost(post('/me/unlink', { csrf, installation_id: String(mine) }, { cookie }), deps);
  assert.deepEqual(lineOf(gone, b.id), { status: 303, path: '/me', key: 'note', text: 'Unlinked an agent linked Nov 6.', shown: true });
  refused(b.id, await unlinkPost(post('/me/unlink', { csrf, installation_id: String(mine) }, { cookie }), deps), 'That agent is not on your account.');
  assert.deepEqual({ ...(await sql()`SELECT builder_id, linked_at FROM installations WHERE id = ${mine}`)[0] }, { builder_id: null, linked_at: null });
  // The refused id and the other builder's agent carry no unlink mark (B10).
  assert.equal((await sql()`SELECT unlinked_at FROM installations WHERE id = ${theirs}`)[0].unlinked_at, null);
  const out = await signoutPost(post('/me/signout', { csrf }, { cookie }), deps);
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await meGet(new Request('https://earnkit.test/me', { headers: { cookie } }), deps)).status, 302);
});

test('a non-form body is 415 and a 100 KB body is 413', async () => {
  const { cookie, csrf } = await signedIn();
  const json = await editPost(post('/me/edit', {}, { cookie, type: 'application/json', body: JSON.stringify({ csrf, path: 'person.name', value: 'x' }) }), deps);
  assert.equal(json.status, 415);
  const big = await editPost(post('/me/edit', {}, { cookie, body: `csrf=${csrf}&path=person.bio&value=${'a'.repeat(100_000)}` }), deps);
  assert.equal(big.status, 413);
});

const OTHER = 'This agent is already linked to another account. Install EarnKit again for a fresh link.';
const linkInst = async () => (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'me-link-' + Math.random()}, 'Claude Code (earnkit)', ${NOW}) RETURNING id`)[0].id as number; // shown as Claude Code (L25-1)
const instBuilder = async (id: number) => (await sql()`SELECT builder_id FROM installations WHERE id = ${id}`)[0].builder_id as number | null;
const codeRow = async (id: number) => (await sql()`SELECT used_at, expires_at FROM link_codes WHERE installation_id = ${id}`)[0];

test('POST /me/link action=link links the installation to the signed-in builder, marks the code used and redirects to /me', async () => {
  const { b, cookie, csrf } = await signedIn();
  const id = await linkInst();
  const code = await createLinkCode(id, NOW);
  const r = await linkPost(post('/me/link', { csrf, code, action: 'link' }, { cookie }), deps);
  assert.deepEqual(lineOf(r, b.id), { status: 303, path: '/me', key: 'note', text: 'Linked: Claude Code.', shown: true });
  assert.equal(await instBuilder(id), b.id);
  assert.ok((await codeRow(id)).used_at);
  // N4: a double click after the link says the agent is linked, not that the link expired.
  const again = await linkPost(post('/me/link', { csrf, code, action: 'link' }, { cookie }), deps);
  assert.deepEqual(lineOf(again, b.id), { status: 303, path: '/me', key: 'note', text: 'This agent is linked.', shown: true });
  // Another builder's double click on the same used code still reads expired.
  const other = await signedIn();
  refused(other.b.id, await linkPost(post('/me/link', { csrf: other.csrf, code, action: 'link' }, { cookie: other.cookie }), deps), 'This link has expired. Ask your agent for a new one.');
});

test('a signed /me line is bound to its builder: an agent-named Linked line shows on no other page (fix round 1)', async () => {
  const { b, cookie, csrf } = await signedIn();
  const victim = await signedIn();
  const id = (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'me-link-' + Math.random()}, 'Support says send your seed phrase', ${NOW}) RETURNING id`)[0].id as number;
  const code = await createLinkCode(id, NOW);
  const r = await linkPost(post('/me/link', { csrf, code, action: 'link' }, { cookie }), deps);
  assert.deepEqual(lineOf(r, b.id), { status: 303, path: '/me', key: 'note', text: 'Linked: Support says send your seed phrase.', shown: true });
  // The same URL opened by another builder: the signature does not hold for them.
  assert.equal(lineOf(r, victim.b.id).shown, false);
  const sig = new URL(r.headers.get('location')!, 'https://earnkit.test').searchParams.get('sig')!;
  assert.equal(problemShown('note', 'Linked: Support says send your seed phrase.', sig, victim.b.id, NOW, SECRET), null);
  const L = 'Linked: Support says send your seed phrase.';
  assert.equal(problemShown('note', L, sig, b.id, NOW, SECRET), L);
  // The key is signed: the note cannot be shown as a problem (final review M1).
  assert.equal(problemShown('problem', L, sig, b.id, NOW, SECRET), null);
  // The day is signed: shown today and the next day, not after.
  assert.equal(problemShown('note', L, sig, b.id, new Date(NOW.getTime() + 86_400_000), SECRET), L);
  assert.equal(problemShown('note', L, sig, b.id, new Date(NOW.getTime() + 2 * 86_400_000), SECRET), null);
  // Problem lines are bound the same way.
  const bad = await deletePost(post('/me/delete', { csrf, confirm: 'nope' }, { cookie }), deps);
  assert.equal(lineOf(bad, b.id).shown, true);
  assert.equal(lineOf(bad, victim.b.id).shown, false);
});

test('POST /me/link action=deny expires the code and links nothing', async () => {
  const { b, cookie, csrf } = await signedIn();
  const id = await linkInst();
  const code = await createLinkCode(id, NOW);
  const r = await linkPost(post('/me/link', { csrf, code, action: 'deny' }, { cookie }), deps);
  assert.deepEqual(lineOf(r, b.id), { status: 303, path: '/me', key: 'note', text: 'Not linked.', shown: true });
  assert.equal(await instBuilder(id), null);
  const row = await codeRow(id);
  assert.equal(row.used_at, null);
  assert.equal((row.expires_at as Date).toISOString(), NOW.toISOString());
  // Denied is dead: a link after it does nothing and says so, as the Not me said it (Low 16, v6.1.13).
  assert.deepEqual(lineOf(await linkPost(post('/me/link', { csrf, code, action: 'link' }, { cookie }), deps), b.id), { status: 303, path: '/me', key: 'note', text: 'Not linked.', shown: true });
  const { meData } = await import('./me-view');
  // L21-6 (v6.1.16): the banner's title says it; no body repeats it.
  assert.deepEqual((await meData(b, new Date(NOW.getTime() + 60_000), 'sess', code)).link, { title: 'Not linked.', code: null, text: '', parts: null });
  assert.equal(await instBuilder(id), null);
  // A code EarnKit never makes is not one of ours, for either button (L21-17, v6.1.16).
  for (const bad of ['nope', 'x'.repeat(1024), '%3Cscript%3E'])
    for (const action of ['link', 'deny']) refused(b.id, await linkPost(post('/me/link', { csrf, code: bad, action }, { cookie }), deps), 'This link is not one of ours.');
  // A code-shaped code EarnKit never made: not one of ours, never "expired".
  refused(b.id, await linkPost(post('/me/link', { csrf, code: 'Q'.repeat(22), action: 'link' }, { cookie }), deps), 'This link is not one of ours.');
});

test('POST /me/link without the csrf comes back with the expired line and links nothing', async () => {
  const { cookie, b, token } = await signedIn();
  const id = await linkInst();
  const code = await createLinkCode(id, NOW);
  for (const csrf of [undefined, 'nope', csrfToken(b.id + 1, DAY, SECRET, token)]) {
    const r = await linkPost(post('/me/link', { ...(csrf === undefined ? {} : { csrf }), code, action: 'link' }, { cookie }), deps);
    refused(b.id, r, EXPIRED_PAGE);
  }
  assert.equal(await instBuilder(id), null);
  assert.equal((await codeRow(id)).used_at, null);
});

test('a second action=link on a used code links nothing and comes back with the expired line', async () => {
  const first = await signedIn();
  const second = await signedIn();
  const id = await linkInst();
  const code = await createLinkCode(id, NOW);
  await linkPost(post('/me/link', { csrf: first.csrf, code, action: 'link' }, { cookie: first.cookie }), deps);
  const r = await linkPost(post('/me/link', { csrf: second.csrf, code, action: 'link' }, { cookie: second.cookie }), deps);
  refused(second.b.id, r, 'This link has expired. Ask your agent for a new one.');
  assert.equal(await instBuilder(id), first.b.id);
});

test('POST /me/link on an installation linked to another account meanwhile comes back with the exact sentence', async () => {
  const mine = await signedIn();
  const theirs = await signedIn();
  const id = await linkInst();
  const code = await createLinkCode(id, NOW);
  await linkInstallation(id, theirs.b.id, NOW);
  const r = await linkPost(post('/me/link', { csrf: mine.csrf, code, action: 'link' }, { cookie: mine.cookie }), deps);
  refused(mine.b.id, r, OTHER);
  assert.equal(await instBuilder(id), theirs.b.id);
  assert.equal((await codeRow(id)).used_at, null);
  refused(mine.b.id, await linkPost(post('/me/link', { csrf: mine.csrf, code, action: 'maybe' }, { cookie: mine.cookie }), deps), FIELD);
});

test('a csrf minted under one session fails under another session of the same builder (security L4)', async () => {
  const { b, cookie, csrf } = await signedIn();
  const { token: second } = await createSession(b.id, NOW);
  const r = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Mallory' }, { cookie: `ek_me=${second}` }), deps);
  refused(b.id, r, EXPIRED_PAGE);
  assert.equal((await getRecord(b.id)).person.name, undefined);
  const ok = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Pat' }, { cookie }), deps);
  assert.equal(ok.status, 303);
  assert.equal((await getRecord(b.id)).person.name, 'Pat');
  // Task 5's /me/link verifies with the same session too.
  const id = await linkInst();
  const code = await createLinkCode(id, NOW);
  const other = await linkPost(post('/me/link', { csrf, code, action: 'link' }, { cookie: `ek_me=${second}` }), deps);
  refused(b.id, other, EXPIRED_PAGE);
  assert.equal(await instBuilder(id), null);
});

test('B10: /me/unlink sets unlinked_at, and that agent\'s next find says it was unlinked, once', async () => {
  const { find } = await import('../v5/find');
  const { b, cookie, csrf } = await signedIn();
  const inst = (await sql()`INSERT INTO installations (token_hash) VALUES (${'me-unl-' + Math.random()}) RETURNING id`)[0].id as number;
  await linkInstallation(inst, b.id, NOW);
  assert.equal((await unlinkPost(post('/me/unlink', { csrf, installation_id: String(inst) }, { cookie }), deps)).status, 303);
  const [row] = await sql()`SELECT builder_id, unlinked_at FROM installations WHERE id = ${inst}`;
  assert.equal(row.builder_id, null);
  assert.equal((row.unlinked_at as Date).toISOString(), NOW.toISOString());
  const link = 'https://earnkit.test/link/abcdefghijklmnop';
  const ctx = { installationId: inst, builderId: null, now: new Date(NOW.getTime() + 60_000), linkUrl: async () => link };
  const first = (await find(ctx, {})) as { linked_notice: string | null; show_to_builder: string };
  const line = `This agent was unlinked from your account. Sign in once at ${link} to link it again.`;
  assert.equal(first.linked_notice, line);
  assert.ok(first.show_to_builder.endsWith(line), first.show_to_builder);
  assert.equal((await sql()`SELECT unlinked_at FROM installations WHERE id = ${inst}`)[0].unlinked_at, null);
  const second = (await find({ ...ctx, now: new Date(NOW.getTime() + 120_000) }, {})) as { linked_notice: string | null };
  assert.equal(second.linked_notice, null);
});

test('B17: the builder\'s edit of an approved answer leaves no approved short behind; prefill then sends the text', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { answers: { problem: { text: 'Teams lose time on payouts.', short: 'Payouts; we serve 5,000 paying customers.' } } }, 'agent', NOW).record, NOW);
  const seen = seenOf(await getRecord(b.id), 'answers.problem');
  await approvePost(post('/me/approve', { csrf, path: 'answers.problem', action: 'approve', seen }, { cookie }), deps);
  assert.deepEqual(answerFor(await getRecord(b.id), null, 'problem'), { text: 'Teams lose time on payouts.', short: 'Payouts; we serve 5,000 paying customers.' });
  const r = await editPost(post('/me/edit', { csrf, path: 'answers.problem', value: 'Teams lose time on payouts. We have no customers yet.' }, { cookie }), deps);
  assert.equal(savedTo(r), 'answers.problem#answers');
  const rec = await getRecord(b.id);
  assert.equal(rec.answers.problem?.short, undefined);
  assert.deepEqual(answerFor(rec, null, 'problem'), { text: 'Teams lose time on payouts. We have no customers yet.', short: null });
});

test('B19: the team list is editable on /me: a role, a new member, a removal', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { team: [{ name: 'Cut Person', role: 'CEO' }, { name: 'Hidden Partner', role: 'CFO' }] }, 'agent', NOW).record, NOW);
  assert.equal(savedTo(await editPost(post('/me/edit', { csrf, path: 'team.0.role', value: 'Founder' }, { cookie }), deps)), 'team.0.role#team');
  await editPost(post('/me/edit', { csrf, path: 'team.2.name', value: 'Sam Cofounder' }, { cookie }), deps);
  await editPost(post('/me/edit', { csrf, path: 'team.1.name', value: '' }, { cookie }), deps);
  await editPost(post('/me/edit', { csrf, path: 'team.1.role', value: '' }, { cookie }), deps);
  const rec = await getRecord(b.id);
  assert.deepEqual(rec.team, [{ name: 'Cut Person', role: 'Founder' }, { name: 'Sam Cofounder' }]);
  assert.equal(rec.meta.team.set_by, 'builder');
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'team.5.name', value: 'x' }, { cookie }), deps), FIELD);
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'team.0.github', value: 'x' }, { cookie }), deps), FIELD);
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'team.0.name', value: 'x'.repeat(81) }, { cookie }), deps), 'Member 1: at most 80 characters.');
});

test('C43 and C53: standing approval on with no category is refused; an unknown chain is named', async () => {
  const { b, cookie, csrf } = await signedIn();
  const before = await getRecord(b.id);
  refused(b.id, await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: '5', agent_may_submit: 'on' }, { cookie }), deps), 'Pick at least one category.');
  refused(b.id, await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: '50' }, { cookie }), deps), 'Most per night: a whole number from 1 to 20.\nPick at least one category.');
  assert.deepEqual(await getRecord(b.id), before);
  // Off with none ticked is fine: nothing is sent alone.
  assert.equal(savedTo(await policyPost(post('/me/policy', { csrf, max_per_night: '5' }, { cookie }), deps)), 'policy#policy');
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { projects: [{ id: 'kit', name: 'Kit' }] }, 'agent', NOW).record, NOW);
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'projects.kit.chains_claimed', value: 'base, solana, notachain' }, { cookie }), deps), 'Not a known chain: notachain.');
});

test('v6.1.9 N7 and N8: renaming a team member drops the old github, x and email; chains match in any case and every bad one is named', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { team: [{ name: 'Cut Person' }, { name: 'Hidden Partner', role: 'COO', github: 'hiddenp', x: 'hp', email: 'hp@example.com' }], projects: [{ id: 'kit', name: 'Kit' }] }, 'agent', NOW).record, NOW);
  // The same name, or a fix of its case or spacing, keeps github, x and email (Task 3 review Minor, final M10).
  for (const [value, saved] of [['Hidden Partner', 'Hidden Partner'], ['hidden  partner', 'hidden partner']]) {
    await editPost(post('/me/edit', { csrf, path: 'team.1.name', value }, { cookie }), deps);
    assert.deepEqual((await getRecord(b.id)).team[1], { name: saved, role: 'COO', github: 'hiddenp', x: 'hp', email: 'hp@example.com' }, value);
  }
  await editPost(post('/me/edit', { csrf, path: 'team.1.name', value: 'New Person' }, { cookie }), deps);
  assert.deepEqual((await getRecord(b.id)).team[1], { name: 'New Person', role: 'COO' });
  await editPost(post('/me/edit', { csrf, path: 'team.1.role', value: 'CTO' }, { cookie }), deps);
  assert.deepEqual((await getRecord(b.id)).team[1], { name: 'New Person', role: 'CTO' });
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'projects.kit.chains_claimed', value: 'Base, foo, bar' }, { cookie }), deps), 'Not a known chain: foo, bar.');
  assert.equal(savedTo(await editPost(post('/me/edit', { csrf, path: 'projects.kit.chains_claimed', value: 'Base, ARC' }, { cookie }), deps)), 'projects.kit.chains_claimed#projects');
  assert.deepEqual((await getRecord(b.id)).projects[0].chains_claimed, ['base', 'arc']);
  // Review Focus 5 (v6.1.12, F10): a chain given twice, in any case or with an empty slot, is saved once, in first order.
  for (const [value, saved] of [['base,,base', ['base']], ['Base, base', ['base']], ['base, ARC, Arc', ['base', 'arc']], ['arc, base, ARC, base', ['arc', 'base']]] as const) {
    await editPost(post('/me/edit', { csrf, path: 'projects.kit.chains_claimed', value }, { cookie }), deps);
    assert.deepEqual((await getRecord(b.id)).projects[0].chains_claimed, saved, value);
  }
});

test('L13-14 (v6.1.14): /me chains one per line read as commas do; an unknown one is still named alone', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { projects: [{ id: 'kit', name: 'Kit' }] }, 'agent', NOW).record, NOW);
  assert.equal(savedTo(await editPost(post('/me/edit', { csrf, path: 'projects.kit.chains_claimed', value: 'base\nsolana\r\nArc, base' }, { cookie }), deps)), 'projects.kit.chains_claimed#projects');
  assert.deepEqual((await getRecord(b.id)).projects[0].chains_claimed, ['base', 'solana', 'arc']);
  refused(b.id, await editPost(post('/me/edit', { csrf, path: 'projects.kit.chains_claimed', value: 'base\nnotachain' }, { cookie }), deps), 'Not a known chain: notachain.');
});

/** Where a 303 to /me lands: the query's `at` or `saved` and the anchor. */
const placeOf = (r: Response) => {
  const loc = new URL(r.headers.get('location') ?? '/', 'https://earnkit.test');
  return { at: loc.searchParams.get('at'), saved: loc.searchParams.get('saved'), hash: loc.hash };
};

test('L27-8, L27-10 (v6.1.16): one Save per section: the changed fields save together, untouched ones keep who set them, and the page says Saved. there', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { person: { email: 'agent@example.com' } }, 'agent', NOW).record, NOW);
  const r = await editPost(post('/me/edit', { csrf, section: 'person', 'person.name': 'Ada Lovelace', 'person.location': 'London', 'person.email': 'agent@example.com', 'person.bio': '' }, { cookie }), deps);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/me?saved=person#person');
  const rec = await getRecord(b.id);
  assert.equal(rec.person.name, 'Ada Lovelace');
  assert.equal(rec.person.location, 'London');
  // The email was not changed on the page: it stays the agent's.
  assert.equal(rec.meta['person.email'].set_by, 'agent');
  assert.equal(rec.meta['person.name'].set_by, 'builder');
  // Nothing changed is still Saved. there.
  assert.equal((await editPost(post('/me/edit', { csrf, section: 'person', 'person.name': 'Ada Lovelace' }, { cookie }), deps)).headers.get('location'), '/me?saved=person#person');
});

test('L27-8, L27-9 (v6.1.16, fix round 1 M1): a section save keeps every valid field and names only the bad ones beside the form; a failed delete beside the delete form', async () => {
  const { b, cookie, csrf } = await signedIn();
  const before = await getRecord(b.id);
  const r = await editPost(post('/me/edit', { csrf, section: 'person', 'person.name': 'Grace', 'person.location': 'Paris', 'person.linkedin': 'not a link', 'person.technical': 'maybe' }, { cookie }), deps);
  refused(b.id, r, 'Saved.\nNot saved: LinkedIn: a link starting with https://.\nNot saved: Technical founder: choose yes or no.');
  assert.deepEqual(placeOf(r), { at: 'person', saved: null, hash: '#person' });
  const kept = await getRecord(b.id);
  assert.equal(kept.person.name, 'Grace');
  assert.equal(kept.person.location, 'Paris');
  assert.equal(kept.person.linkedin ?? null, before.person.linkedin ?? null);
  // Only bad fields: nothing saved, only the Not saved lines.
  const only = await editPost(post('/me/edit', { csrf, section: 'person', 'person.linkedin': 'nope' }, { cookie }), deps);
  refused(b.id, only, 'Not saved: LinkedIn: a link starting with https://.');
  for (const l of lineOf(r, b.id).text!.split('\n')) assert.match(l, /^[A-Z][^—]*\.$/, l);
  // A bad chain is named by its field.
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { projects: [{ id: 'kit', name: 'Kit' }] }, 'agent', NOW).record, NOW);
  refused(b.id, await editPost(post('/me/edit', { csrf, section: 'projects', 'projects.kit.name': 'Kit 2', 'projects.kit.chains_claimed': 'base, notachain' }, { cookie }), deps), 'Saved.\nNot saved: Chains: not a known chain: notachain.');
  assert.equal((await getRecord(b.id)).projects.find((p) => p.id === 'kit')?.name, 'Kit 2');
  // The policy form stays all or nothing (v6.1.7 B1).
  const pol = await getRecord(b.id);
  refused(b.id, await policyPost(post('/me/policy', { csrf, max_per_night: '50', max_ask_usd: '1000' }, { cookie }), deps), 'Most per night: a whole number from 1 to 20.');
  assert.deepEqual((await getRecord(b.id)).policy, pol.policy);
  // Standing approval has its own form; an unknown section changes nothing.
  refused(b.id, await editPost(post('/me/edit', { csrf, section: 'policy', 'policy.auto_apply': 'true' }, { cookie }), deps), FIELD);
  refused(b.id, await editPost(post('/me/edit', { csrf, section: 'nope' }, { cookie }), deps), FIELD);
  const d = await deletePost(post('/me/delete', { csrf, confirm: 'someone-else' }, { cookie }), deps);
  refused(b.id, d, 'Type your GitHub login to delete.');
  assert.deepEqual(placeOf(d), { at: 'delete', saved: null, hash: '#delete' });
  assert.ok(await getBuilder(b.id));
});

test('L27-8 (v6.1.16): team rows save together, a removed member last so the other rows keep their numbers; the skip list saves with the policy form', async () => {
  const { b, cookie, csrf } = await signedIn();
  await saveRecord(b.id, mergeRecord(await getRecord(b.id), { team: [{ name: 'One' }, { name: 'Two', role: 'CTO' }] }, 'agent', NOW).record, NOW);
  const r = await editPost(post('/me/edit', { csrf, section: 'team', 'team.0.name': '', 'team.1.role': 'CEO', 'team.2.name': 'Three' }, { cookie }), deps);
  assert.equal(r.headers.get('location'), '/me?saved=team#team');
  assert.deepEqual((await getRecord(b.id)).team.map((m) => [m.name, m.role ?? null]), [['Two', 'CEO'], ['Three', null]]);
  const p = await policyPost(post('/me/policy', { csrf, max_per_night: '3', never: 'Base Builder Grants\nzz-other' }, { cookie }), deps);
  assert.equal(p.headers.get('location'), '/me?saved=policy#policy');
  assert.deepEqual((await getRecord(b.id)).policy.never, ['Base Builder Grants', 'zz-other']);
  const bad = await policyPost(post('/me/policy', { csrf, max_per_night: '50' }, { cookie }), deps);
  assert.deepEqual(placeOf(bad), { at: 'policy', saved: null, hash: '#policy' });
});

test('L31-3 (v6.1.16 Task 17): every /me post needs a same-origin Origin or Referer, before the csrf check', async () => {
  const { b, cookie, csrf } = await signedIn();
  const NOT_FROM_US = 'That form did not come from EarnKit.';
  const handlers: [typeof editPost, string, Record<string, string>][] = [
    [editPost, '/me/edit', { csrf, path: 'person.name', value: 'Origin Test' }],
    [approvePost, '/me/approve', { csrf, path: 'person.name', action: 'approve', seen: '' }],
    [policyPost, '/me/policy', { csrf }],
    [unlinkPost, '/me/unlink', { csrf, installation_id: '1' }],
    [linkPost, '/me/link', { csrf, code: 'x', action: 'deny' }],
    [deletePost, '/me/delete', { csrf, confirm: b.login }],
    [signoutPost, '/me/signout', { csrf }],
  ];
  for (const [handler, path, form] of handlers)
    for (const o of [{ origin: null }, { origin: 'https://evil.example' }, { origin: 'null' }, { origin: null, referer: 'https://evil.example/me' }, { origin: null, referer: 'not a url' }]) {
      const r = await handler(post(path, form, { cookie, ...o }), deps);
      assert.equal(r.status, 403, `${path} ${JSON.stringify(o)}`);
      assert.equal(await r.text(), NOT_FROM_US);
    }
  // Lane 24 re-pinned: a valid csrf with no Origin and no Referer is refused, and nothing is saved.
  assert.equal((await getRecord(b.id)).person.name ?? null, null);
  // A same-origin Referer with no Origin is accepted; a same-origin Origin is accepted.
  const byReferer = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Ref Test' }, { cookie, origin: null, referer: 'https://earnkit.test/me#person' }), deps);
  assert.equal(byReferer.status, 303);
  assert.equal((await getRecord(b.id)).person.name, 'Ref Test');
  const byOrigin = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Origin Test' }, { cookie }), deps);
  assert.equal(byOrigin.status, 303);
  assert.equal((await getRecord(b.id)).person.name, 'Origin Test');
});
