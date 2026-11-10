import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { programFixture } from '../v5/fixtures/program';
import { upsertProgram } from '../v5/programs';
import { upsertBuilder } from './builders';
import { addReviewer, removeReviewer, reviewerPrograms, reviewersPost } from './reviewers';

after(() => sql().end());

const NOW = new Date('2026-11-06T12:00:00Z');
const TOKEN = 'r'.repeat(40);
beforeEach(async () => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
  await upsertProgram(programFixture({ id: 'rev-grants', title: 'Rev Grants' }), 'file', NOW);
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_PROGRAMS_API;
});

let gh = 910_000;
const builder = (login: string) => upsertBuilder({ github_id: ++gh, login, name: null, avatar_url: null }, NOW);
const post = (body: unknown, auth: string | null = `Bearer ${TOKEN}`) =>
  reviewersPost(new Request('https://earnkit.test/api/programs/reviewers', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }));

test('addReviewer refuses a login nobody signed in with; after sign-in it adds, and reviewerPrograms lists the program', async () => {
  assert.deepEqual(await addReviewer('rev-grants', 'Grace', null), { ok: false, reason: 'no builder with that GitHub login has signed in' });
  const b = await builder('grace');
  assert.deepEqual(await addReviewer('rev-grants', 'GRACE', 'grace@example.com'), { ok: true, builder_id: b.id });
  assert.deepEqual(await reviewerPrograms(b.id), ['rev-grants']);
  assert.deepEqual(await addReviewer('no-such-program', 'grace', null), { ok: false, reason: 'unknown program' });
  assert.deepEqual(await removeReviewer('rev-grants', 'grace'), { ok: true, builder_id: b.id });
  assert.deepEqual(await reviewerPrograms(b.id), []);
});

test('reviewersPost: 404 while the API is off, 401 without the token, 200 with a body, 400 with the reason', async () => {
  const b = await builder('hopper');
  process.env.EARNKIT_PROGRAMS_API = 'off';
  assert.equal((await post({ program_id: 'rev-grants', github_login: 'hopper' })).status, 404);
  delete process.env.EARNKIT_PROGRAMS_API;
  assert.equal((await post({ program_id: 'rev-grants', github_login: 'hopper' }, null)).status, 401);
  assert.equal((await post({ program_id: 'rev-grants', github_login: 'hopper' }, 'Bearer nope')).status, 401);
  const ok = await post({ program_id: 'rev-grants', github_login: 'hopper', contact: 'hopper@example.com' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, builder_id: b.id });
  const [row] = await sql()`SELECT contact FROM program_reviewers WHERE builder_id = ${b.id}`;
  assert.equal(row.contact, 'hopper@example.com');
  const nobody = await post({ program_id: 'rev-grants', github_login: 'nobody-here' });
  assert.equal(nobody.status, 400);
  assert.deepEqual(await nobody.json(), { ok: false, error: 'no builder with that GitHub login has signed in' });
  assert.equal((await post({ program_id: 'rev-grants' })).status, 400);
  const gone = await post({ program_id: 'rev-grants', github_login: 'hopper', remove: true });
  assert.equal(gone.status, 200);
  assert.deepEqual(await reviewerPrograms(b.id), []);
});

test('a login two builders have used is refused; github_id picks the account, for adding and removing', async () => {
  const renamed = await upsertBuilder({ github_id: ++gh, login: 'Taken', name: null, avatar_url: null }, NOW);
  const now = await upsertBuilder({ github_id: ++gh, login: 'taken', name: null, avatar_url: null }, NOW);
  const AMBIGUOUS = 'two accounts have used that login; send github_id';
  assert.deepEqual(await addReviewer('rev-grants', 'taken', null), { ok: false, reason: AMBIGUOUS });
  const plain = await post({ program_id: 'rev-grants', github_login: 'taken' });
  assert.equal(plain.status, 400);
  assert.deepEqual(await plain.json(), { ok: false, error: AMBIGUOUS });
  const byId = await post({ program_id: 'rev-grants', github_login: 'taken', github_id: now.github_id });
  assert.equal(byId.status, 200);
  assert.deepEqual(await byId.json(), { ok: true, builder_id: now.id });
  assert.deepEqual(await reviewerPrograms(now.id), ['rev-grants']);
  assert.deepEqual(await reviewerPrograms(renamed.id), []);
  assert.deepEqual(await removeReviewer('rev-grants', 'taken'), { ok: false, reason: AMBIGUOUS });
  assert.equal((await post({ program_id: 'rev-grants', github_id: now.github_id, remove: true })).status, 200);
  assert.deepEqual(await reviewerPrograms(now.id), []);
  assert.deepEqual(await addReviewer('rev-grants', null, null, 999_999_999), { ok: false, reason: 'no builder with that GitHub id has signed in' });
});

test('L15-2 (v6.1.14): marking a reviewer again without a contact keeps the saved one; a new contact replaces it', async () => {
  const b = await builder('l15contact');
  const contactOf = async () => (await sql()`SELECT contact FROM program_reviewers WHERE builder_id = ${b.id} AND program_id = 'rev-grants'`)[0].contact;
  assert.equal((await post({ program_id: 'rev-grants', github_login: 'l15contact', contact: 'grants@example.com' })).status, 200);
  assert.equal((await post({ program_id: 'rev-grants', github_login: 'l15contact' })).status, 200);
  assert.equal(await contactOf(), 'grants@example.com');
  assert.equal((await post({ program_id: 'rev-grants', github_login: 'l15contact', contact: '  ' })).status, 200);
  assert.equal(await contactOf(), 'grants@example.com');
  await addReviewer('rev-grants', 'l15contact', 'new@example.com');
  assert.equal(await contactOf(), 'new@example.com');
});
