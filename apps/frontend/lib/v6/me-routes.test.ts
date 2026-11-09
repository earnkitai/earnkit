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
const post = (path: string, form: Record<string, string | string[]>, o: { cookie?: string; type?: string; body?: string } = {}) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return new Request(`https://earnkit.test${path}`, {
    method: 'POST',
    headers: { 'content-type': o.type ?? 'application/x-www-form-urlencoded', ...(o.cookie ? { cookie: o.cookie } : {}) },
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

test('editPost on person.name saves with set_by builder', async () => {
  const { b, cookie, csrf } = await signedIn();
  const r = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Ada Lovelace' }, { cookie }), deps);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/me#person');
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
  assert.equal((await editPost(post('/me/edit', { csrf, path: 'projects.kit.one_liner', value: 'Grants for builders' }, { cookie }), deps)).headers.get('location'), '/me#projects');
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
    refused(b.id, await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: bad }, { cookie }), deps), 'Most per night: a whole number from 1 to 20.');
  }
  // Every bad field gets its own line, in the page's labels.
  const two = await policyPost(post('/me/policy', { csrf, auto_apply: 'on', max_per_night: '50', max_ask_usd: '-5', 'categories[]': ['grant', '<script>'] }, { cookie }), deps);
  refused(b.id, two, 'Most per night: a whole number from 1 to 20.\nNever above (USD): a number of 0 or more.\nCategories: pick one of the options.');
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
  refused(b.id, wrong, 'Type your GitHub login exactly to delete.');
  assert.ok(await getBuilder(b.id));
  assert.equal((await sql()`SELECT count(*)::int AS n FROM applications WHERE owner = ${'b:' + b.id}`)[0].n, 1);
  const r = await deletePost(post('/me/delete', { csrf, confirm: 'deleteme' }, { cookie }), deps);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
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
  assert.equal((await unlinkPost(post('/me/unlink', { csrf, installation_id: String(theirs) }, { cookie }), deps)).status, 303);
  // An id no installation can have is a line, never a 500 (v6.1.7 B3).
  for (const id of ['1099511627776', '2147483648', '99999999999999999999', 'abc', '', '0', '-1', '1e3'])
    refused(b.id, await unlinkPost(post('/me/unlink', { csrf, installation_id: id }, { cookie }), deps), FIELD);
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${theirs}`)[0].builder_id, other.b.id);
  await unlinkPost(post('/me/unlink', { csrf, installation_id: String(mine) }, { cookie }), deps);
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
const linkInst = async () => (await sql()`INSERT INTO installations (token_hash, client_name, created_at) VALUES (${'me-link-' + Math.random()}, 'Claude Code', ${NOW}) RETURNING id`)[0].id as number;
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
  // Denied is dead: a link after it does nothing and says so.
  refused(b.id, await linkPost(post('/me/link', { csrf, code, action: 'link' }, { cookie }), deps), 'That link expired. Ask your agent for a new one.');
  assert.equal(await instBuilder(id), null);
  // A code EarnKit never makes is not valid, for either button.
  for (const bad of ['nope', 'x'.repeat(1024), '%3Cscript%3E'])
    for (const action of ['link', 'deny']) refused(b.id, await linkPost(post('/me/link', { csrf, code: bad, action }, { cookie }), deps), 'This link is not valid.');
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
  refused(second.b.id, r, 'That link expired. Ask your agent for a new one.');
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
