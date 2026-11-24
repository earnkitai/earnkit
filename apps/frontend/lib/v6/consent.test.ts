/**
 * v3.8 E12 (plan item 8, L2, L10): the onboarding form behind `form`: save with one consent step, the 18-or-over
 * answer (under 18: no listing, no submit, not in the corpus), wallet optional, silent name enrichment, withdraw on
 * /me, delete clearing the people row, and the copy rules. Off, /me/consent is 404 and delete keeps the person.
 */
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../v5/db';
import { deleteBuilder, getRecord, upsertBuilder } from './builders';
import { csrfToken } from './me-view';
import { consentPost } from './me-routes';
import { createSession } from './sessions';
import { CONSENT_ITEMS, CONSENT_SAVED, CONSENT_WITHDRAWN, PRIVACY_SECTIONS, START_COPY, UNDER_18_SAVED, WITHDRAW_COPY, consentOf } from './consent';
import { EMPTY_RECORD, mergeRecord } from './record';

after(() => sql().end());

const SECRET = 'consent-test-secret-0123456789abcdef012345';
const NOW = new Date('2026-11-24T09:00:00Z');
const DAY = NOW.toISOString().slice(0, 10);
before(() => {
  process.env.EARNKIT_AUTH_SECRET = SECRET;
  process.env.EARNKIT_URL = 'https://earnkit.test';
});
afterEach(() => {
  delete process.env.EARNKIT_FLAGS;
});

let gh = 950_000 + Math.floor(Math.random() * 40_000);
async function signedIn(name: string | null = 'Ada Lovelace') {
  const b = await upsertBuilder({ github_id: ++gh, login: `consent${gh}`, name, avatar_url: null }, NOW);
  const { token } = await createSession(b.id, NOW);
  return { b, cookie: `ek_me=${token}`, csrf: csrfToken(b.id, DAY, SECRET, token) };
}
const post = (form: Record<string, string>, cookie: string) =>
  new Request('https://earnkit.test/me/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: 'https://earnkit.test' },
    body: new URLSearchParams(form).toString(),
  });
const noteOf = (r: Response) => new URL(r.headers.get('location') ?? '/', 'https://earnkit.test').searchParams.get('note');
const deps = { now: NOW };

test('off: /me/consent is 404 and nothing is saved', async () => {
  const s = await signedIn();
  const r = await consentPost(post({ csrf: s.csrf, action: 'save', fill: 'on', adult: 'yes' }, s.cookie), deps);
  assert.equal(r.status, 404);
  assert.equal((await getRecord(s.b.id)).consent, undefined);
});

test('save: the ticks, the age and the wallet; the name filled from GitHub when empty', async () => {
  process.env.EARNKIT_FLAGS = 'form';
  const s = await signedIn();
  const r = await consentPost(post({ csrf: s.csrf, action: 'save', fill: 'on', submit: 'on', list: 'on', corpus: 'on', adult: 'yes', wallet: ' 0xabc ' }, s.cookie), deps);
  assert.equal(r.status, 303);
  assert.equal(noteOf(r), CONSENT_SAVED);
  const rec = await getRecord(s.b.id);
  assert.deepEqual(rec.consent, { fill: true, submit: true, list: true, corpus: true, adult: true, wallet: '0xabc', at: NOW.toISOString(), version: '2026-11-24' });
  assert.equal(rec.person.name, 'Ada Lovelace');
});

test('under 18: not listed, nothing submitted, not in the corpus, whatever was ticked', async () => {
  process.env.EARNKIT_FLAGS = 'form';
  const s = await signedIn(null);
  const r = await consentPost(post({ csrf: s.csrf, action: 'save', fill: 'on', submit: 'on', list: 'on', corpus: 'on', adult: 'no' }, s.cookie), deps);
  assert.equal(noteOf(r), UNDER_18_SAVED);
  const rec = await getRecord(s.b.id);
  assert.deepEqual({ ...rec.consent, at: undefined }, { fill: true, submit: false, list: false, corpus: false, adult: false, at: undefined, version: '2026-11-24' });
  assert.equal(rec.policy.agent_may_submit, false);
  assert.equal(rec.policy.auto_apply, false);
});

test('no age answer and a long wallet go back to the form by a fixed key; a bad csrf saves nothing', async () => {
  process.env.EARNKIT_FLAGS = 'form';
  const s = await signedIn();
  const noAge = await consentPost(post({ csrf: s.csrf, action: 'save', fill: 'on' }, s.cookie), deps);
  assert.equal(noAge.headers.get('location'), '/me/start?e=adult');
  const long = await consentPost(post({ csrf: s.csrf, action: 'save', adult: 'yes', wallet: 'x'.repeat(121) }, s.cookie), deps);
  assert.equal(long.headers.get('location'), '/me/start?e=wallet');
  await consentPost(post({ csrf: 'forged', action: 'save', adult: 'yes' }, s.cookie), deps);
  assert.equal((await getRecord(s.b.id)).consent, undefined);
});

test('withdraw on /me turns all four off at once and stops agent submits', async () => {
  process.env.EARNKIT_FLAGS = 'form';
  const s = await signedIn();
  await consentPost(post({ csrf: s.csrf, action: 'save', fill: 'on', submit: 'on', list: 'on', corpus: 'on', adult: 'yes' }, s.cookie), deps);
  const r = await consentPost(post({ csrf: s.csrf, action: 'withdraw' }, s.cookie), deps);
  assert.equal(noteOf(r), CONSENT_WITHDRAWN);
  const rec = await getRecord(s.b.id);
  assert.deepEqual([rec.consent?.fill, rec.consent?.submit, rec.consent?.list, rec.consent?.corpus], [false, false, false, false]);
  assert.equal(rec.consent?.withdrawn_at, NOW.toISOString());
  assert.equal(rec.policy.agent_may_submit, false);
});

test('an agent cannot write consent through the record', () => {
  const m = mergeRecord(EMPTY_RECORD, { consent: { ...consentOf({ fill: true, submit: true, list: true, corpus: true, adult: true, wallet: '' }, NOW) } }, 'agent', NOW);
  assert.deepEqual(m.problems, ['consent: not a field']);
});

test('delete clears the people row with the form on, and keeps it with it off', async () => {
  for (const on of [true, false]) {
    if (on) process.env.EARNKIT_FLAGS = 'form';
    else delete process.env.EARNKIT_FLAGS;
    const s = await signedIn();
    const [p] = await sql()`INSERT INTO people (builder_id, github_login) VALUES (${s.b.id}, ${s.b.login}) RETURNING id`;
    await sql()`INSERT INTO installations (token_hash, builder_id, person_id) VALUES (${'cons-' + Math.random()}, ${s.b.id}, ${p.id})`;
    await deleteBuilder(s.b.id, NOW);
    const left = await sql()`SELECT id FROM people WHERE id = ${p.id}`;
    assert.equal(left.length, on ? 0 : 1, `form ${on ? 'on' : 'off'}`);
  }
});

test('the copy follows plan 23.3: no em or en dashes, no semicolons, no exclamation marks (no-token.test.ts guards the wording)', () => {
  const all = [
    ...CONSENT_ITEMS.map(([, w]) => w), ...Object.values(START_COPY), ...Object.values(WITHDRAW_COPY), CONSENT_SAVED, CONSENT_WITHDRAWN, UNDER_18_SAVED,
    ...PRIVACY_SECTIONS.flatMap((s) => [s.title, ...s.lines]),
  ];
  for (const line of all) {
    assert.doesNotMatch(line, /[–—;!]/, line);
  }
});
