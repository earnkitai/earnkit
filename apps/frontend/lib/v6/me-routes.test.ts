import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { getBuilder, getRecord, linkInstallation, saveRecord, upsertBuilder } from './builders';
import { csrfToken, problemShown, seenOf } from './me-view';
import { approvePost, deletePost, editPost, meGet, policyPost, signoutPost, unlinkPost } from './me-routes';
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
  return { b, cookie: `ek_me=${token}`, csrf: csrfToken(b.id, DAY, SECRET) };
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
  ];
  for (const r of await Promise.all(calls)) assert.equal(r.status, 403);
  assert.deepEqual(await getRecord(b.id), before);
  assert.ok(await getBuilder(b.id));
});

test('a wrong csrf is 403 and nothing changes', async () => {
  const { b, cookie } = await signedIn();
  const other = csrfToken(b.id + 1, DAY, SECRET);
  for (const csrf of ['', 'nope', other]) {
    const r = await editPost(post('/me/edit', { csrf, path: 'person.name', value: 'Mallory' }, { cookie }), deps);
    assert.equal(r.status, 403);
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
  // An empty value clears it; a bad one comes back as a problem in builder words; an unknown path is 400.
  const bad = await editPost(post('/me/edit', { csrf, path: 'person.email', value: 'not-an-email' }, { cookie }), deps);
  assert.equal(bad.status, 303);
  const problem = new URL(bad.headers.get('location')!, 'https://earnkit.test').searchParams.get('problem')!;
  assert.match(problem, /^Email: /);
  assert.ok(!problem.includes('person.'));
  const sig = new URL(bad.headers.get('location')!, 'https://earnkit.test').searchParams.get('sig')!;
  assert.equal(problemShown(problem, sig, SECRET), problem);
  assert.equal(problemShown('Crafted text.', sig, SECRET), null);
  assert.equal((await editPost(post('/me/edit', { csrf, path: 'meta.x', value: '1' }, { cookie }), deps)).status, 400);
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
  assert.equal((await editPost(post('/me/edit', { csrf, path: 'projects.nope.name', value: 'x' }, { cookie }), deps)).status, 400);
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
  assert.equal((await approvePost(post('/me/approve', { csrf, path: 'person.name', action: 'approve' }, { cookie }), deps)).status, 400);
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
  assert.equal((await editPost(post('/me/edit', { csrf, path: 'policy.auto_apply', value: 'on' }, { cookie }), deps)).status, 400);
  assert.equal((await editPost(post('/me/edit', { csrf, path: 'policy.max_per_night', value: '20' }, { cookie }), deps)).status, 400);
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

test('delete removes everything', async () => {
  const { b, cookie, csrf } = await signedIn('deleteme');
  const inst = (await sql()`INSERT INTO installations (token_hash) VALUES (${'me-' + Math.random()}) RETURNING id`)[0].id as number;
  await linkInstallation(inst, b.id, NOW);
  await sql()`INSERT INTO applications (installation_id, owner, program_id, status, at) VALUES (${inst}, ${'b:' + b.id}, 'zz-me-del', 'applied', ${NOW})`;
  await sql()`INSERT INTO link_codes (code, installation_id, created_at, expires_at, nonce) VALUES (${'me-del-' + inst}, ${inst}, ${NOW}, ${new Date(NOW.getTime() + 900_000)}, 'n')`;
  const wrong = await deletePost(post('/me/delete', { csrf, confirm: 'someone-else' }, { cookie }), deps);
  assert.equal(wrong.status, 400);
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
  assert.equal((await sql()`SELECT builder_id FROM installations WHERE id = ${theirs}`)[0].builder_id, other.b.id);
  await unlinkPost(post('/me/unlink', { csrf, installation_id: String(mine) }, { cookie }), deps);
  assert.deepEqual({ ...(await sql()`SELECT builder_id, linked_at FROM installations WHERE id = ${mine}`)[0] }, { builder_id: null, linked_at: null });
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
