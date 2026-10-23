import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from './db';
import { install } from './fixtures/find';
import { DATA, siteOf } from './fixtures/profile-data';
import { noteReferral } from './installations';
import { checkAuthorize, exchangeCode, issueCode, registerClient } from './oauth';
import { authorizeGet, tokenPost } from './oauth-routes';
import { ensureProfile } from './profiles';
import { REF_COOKIE, REF_MAX_AGE_S, cleanRef, refCookieToSet, refFromCookieHeader } from './ref-cookie';
import { CTA_INSTALL, PROFILE_CTA_TEXT, PROFILE_CTA_TITLE } from './site-copy';
import BenchProfileView from '../../app/[handle]/BenchProfileView';

/**
 * v3.1 GTM W1: referral attribution, measure only. A builder's page remembers its handle in a 30-day first-party cookie;
 * /oauth/authorize carries it in the signed code; the token exchange stores the referring builder once on a new
 * installation (never the builder's own); owner_people counts it. Plus the visitor card on every profile.
 */
(globalThis as { React?: typeof React }).React = React;
process.env.EARNKIT_AUTH_SECRET ??= 'referral-test-secret';
process.env.EARNKIT_URL = 'https://earnkit.com';
// The anonymous approval path (X sign-in not configured): authorize answers the client at once.
delete process.env.X_CLIENT_ID;
delete process.env.X_CLIENT_SECRET;

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});

const VERIFIER = 'r'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const LOOPBACK = 'http://127.0.0.1:41234/callback';
const noLimit = { limit: async () => {} };

test('ref-cookie: a valid X handle only, lowercase; the first page in 30 days keeps the credit; Lax, Secure over https', () => {
  assert.equal(cleanRef('Maya_Builds'), 'maya_builds');
  for (const bad of ['', 'a'.repeat(16), 'maya-b', 'maya;x=1', '../x', 'maya b', null, 3]) assert.equal(cleanRef(bad), null, String(bad));
  assert.equal(refFromCookieHeader('a=1; ek_ref=Maya; b=2'), 'maya');
  assert.equal(refFromCookieHeader('ek_ref=bad-handle'), null);
  assert.equal(refFromCookieHeader(null), null);
  assert.equal(REF_COOKIE, 'ek_ref');
  assert.equal(REF_MAX_AGE_S, 2_592_000);
  assert.equal(refCookieToSet('Maya', '', true), 'ek_ref=maya; Path=/; Max-Age=2592000; SameSite=Lax; Secure');
  assert.equal(refCookieToSet('Maya', 'x=1', false), 'ek_ref=maya; Path=/; Max-Age=2592000; SameSite=Lax');
  assert.equal(refCookieToSet('Kai', 'ek_ref=maya', true), null, 'already remembered');
  assert.equal(refCookieToSet('Kai', 'ek_ref=not-valid', true), 'ek_ref=kai; Path=/; Max-Age=2592000; SameSite=Lax; Secure', 'an invalid one is replaced');
  assert.equal(refCookieToSet('not a handle', '', true), null);
});

test('the signed code carries the handle and only a valid one; the exchange returns it', () => {
  const clientId = registerClient({ redirect_uris: [LOOPBACK], client_name: 'Claude Code' }).client_id;
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: LOOPBACK, code_challenge: CHALLENGE, code_challenge_method: 'S256' });
  const form = (code: string) => new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: LOOPBACK, code_verifier: VERIFIER });
  const c = checkAuthorize(params);
  assert.ok(!('error' in c));
  assert.equal(exchangeCode(form(issueCode(c.req, null).searchParams.get('code')!)).ref, null);
  assert.equal(exchangeCode(form(issueCode({ ...c.req, ref: 'Maya' }, null).searchParams.get('code')!)).ref, 'maya');
  assert.equal(exchangeCode(form(issueCode({ ...c.req, ref: 'x;y' }, null).searchParams.get('code')!)).ref, null);
});

/** A claimed public page with a fresh X handle; returns its builder id and handle. */
async function referrer(): Promise<{ id: number; handle: string }> {
  const id = await install();
  await ensureProfile(id, new Date());
  const handle = `rf_${randomBytes(5).toString('hex')}`;
  await sql()`UPDATE builder_profiles SET x_handle = ${handle}, x_user_id = ${`8${Date.now() % 1e9}${Math.floor(Math.random() * 1e6)}`} WHERE builder_id = ${id}`;
  return { id, handle };
}

async function installVia(cookie: string | null): Promise<{ id: number; code: string; clientId: string }> {
  const clientId = registerClient({ redirect_uris: [LOOPBACK], client_name: 'Claude Code' }).client_id;
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: LOOPBACK, state: 's', code_challenge: CHALLENGE, code_challenge_method: 'S256' });
  const res = await authorizeGet(new Request(`https://earnkit.com/oauth/authorize?${q}`, { headers: cookie ? { cookie } : {} }), noLimit);
  assert.equal(res.status, 302);
  const code = new URL(res.headers.get('location')!).searchParams.get('code')!;
  const id = await exchangeFor(clientId, code);
  return { id, code, clientId };
}
async function exchangeFor(clientId: string, code: string): Promise<number> {
  const tok = await tokenPost(new Request('https://earnkit.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `198.51.100.${process.pid % 250}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: LOOPBACK, code_verifier: VERIFIER }),
  }));
  assert.equal(tok.status, 200);
  const { access_token } = (await tok.json()) as { access_token: string };
  const [row] = await sql()<{ id: number }[]>`SELECT id FROM installations WHERE token_hash = ${createHash('sha256').update(access_token).digest('hex')}`;
  return row.id;
}
const refOf = async (id: number) =>
  (await sql()<{ ref_builder_id: number | null; ref_at: Date | null }[]>`SELECT ref_builder_id, ref_at FROM installations WHERE id = ${id}`)[0];

test('an install from a builder page stores that builder once; no cookie or an unknown, hidden or own page stores nothing; owner_people counts it', db, async () => {
  const r = await referrer();
  // The page's handle in any case, from the cookie the page set.
  const a = await installVia(`other=1; ${REF_COOKIE}=${r.handle.toUpperCase()}`);
  const ra = await refOf(a.id);
  assert.equal(ra.ref_builder_id, r.id);
  assert.ok(ra.ref_at);
  // A replayed code is not a new installation: nothing changes.
  assert.equal(await exchangeFor(a.clientId, a.code), a.id);
  assert.deepEqual(await refOf(a.id), ra);

  assert.equal((await refOf((await installVia(null)).id)).ref_builder_id, null, 'no cookie');
  assert.equal((await refOf((await installVia(`${REF_COOKIE}=nobody_${process.pid % 1000}`)).id)).ref_builder_id, null, 'no such page');
  assert.equal((await refOf((await installVia(`${REF_COOKIE}=bad-handle`)).id)).ref_builder_id, null, 'not a handle');

  // The first credit stays.
  const other = await referrer();
  await noteReferral(a.id, other.handle);
  assert.equal((await refOf(a.id)).ref_builder_id, r.id);
  // A hidden page earns nothing.
  const hidden = await referrer();
  await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${hidden.id}`;
  assert.equal((await refOf((await installVia(`${REF_COOKIE}=${hidden.handle}`)).id)).ref_builder_id, null, 'hidden');
  // The builder's own installation (a second agent in their group) is never credited to them.
  const own = await install();
  await sql()`UPDATE installations SET builder_id = ${r.id} WHERE id = ${own}`;
  await noteReferral(own, r.handle);
  assert.equal((await refOf(own)).ref_builder_id, null, 'own');
  await noteReferral(r.id, r.handle);
  assert.equal((await refOf(r.id)).ref_builder_id, null, 'own root');

  // owner_people: the count, the builder's own excluded, right after last_seen_at (the owner tracker's columns follow).
  const b = await installVia(`${REF_COOKIE}=${r.handle}`);
  assert.equal((await refOf(b.id)).ref_builder_id, r.id);
  await sql()`UPDATE installations SET ref_builder_id = ${r.id} WHERE id = ${own}`; // even if one slipped in, it is not counted
  const [row] = await sql()<Record<string, unknown>[]>`SELECT * FROM owner_people WHERE builder_id = ${r.id}`;
  assert.equal(row.referred_installs, 2);
  const keys = Object.keys(row);
  assert.equal(keys[keys.indexOf('last_seen_at') + 1], 'referred_installs');
  const [none] = await sql()<{ referred_installs: number }[]>`SELECT referred_installs FROM owner_people WHERE builder_id = ${other.id}`;
  assert.equal(none.referred_installs, 0);
});

test('schema: the referral columns are additive and idempotent, owner_people keeps its column order with referred_installs after last_seen_at', () => {
  const schema = readFileSync(join(import.meta.dirname, '../../db/schema.sql'), 'utf8');
  assert.match(schema, /ALTER TABLE installations ADD COLUMN IF NOT EXISTS ref_builder_id integer;/);
  assert.match(schema, /ALTER TABLE installations ADD COLUMN IF NOT EXISTS ref_at timestamptz;/);
  assert.ok(schema.indexOf('ADD COLUMN IF NOT EXISTS ref_builder_id') < schema.indexOf('CREATE OR REPLACE VIEW owner_people'), 'the columns exist before the view reads them');
  assert.equal(schema.split('CREATE OR REPLACE VIEW owner_people').length - 1, 1, 'one definition, so a rerun never drops a column');
  assert.match(schema, /AS last_seen_at,\n {2}\(SELECT count\(\*\) FROM installations r WHERE r\.ref_builder_id = p\.builder_id[^\n]*AS referred_installs,\n/);
});

test('the profile: a calm "Get your own page" panel at the bottom with the header\'s install sheet, and the page remembered', () => {
  const h = renderToStaticMarkup(React.createElement(BenchProfileView, { data: DATA, site: siteOf(DATA), page: 1 }));
  const card = h.match(/<section aria-label="Get your own page" data-ek-get-page=""[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(card, 'the panel');
  assert.match(card[0], /bg-s-panel/);
  assert.ok(card[1].includes(`>${PROFILE_CTA_TITLE}</p>`));
  assert.ok(card[1].includes(PROFILE_CTA_TEXT));
  // The install pill (InstallButton opens the same AddToAgent sheet as the header).
  assert.match(card[1], new RegExp(`<button type="button" class="[^"]*">${CTA_INSTALL}</button>`));
  // After the Activity and Highlights cards, before the footer.
  assert.ok(h.indexOf('aria-label="Activity and highlights"') < h.indexOf('data-ek-get-page'));
  assert.ok(h.indexOf('data-ek-get-page') < h.indexOf('<footer'));
  assert.equal(PROFILE_CTA_TITLE, 'Get your own page');
  assert.doesNotMatch(PROFILE_CTA_TEXT, /\u2014|\u2013|!|\p{Extended_Pictographic}/u);
  assert.ok(PROFILE_CTA_TEXT.split(' ').length <= 16, 'one short line');
  // RefMark is a client component that sets the cookie in the browser only.
  const mark = readFileSync(join(import.meta.dirname, '../../app/[handle]/RefMark.tsx'), 'utf8');
  assert.match(mark, /^'use client';/);
  assert.match(mark, /refCookieToSet\(handle, document\.cookie/);
});
