import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { person, install } from './fixtures/find';
import { builderTokensJson, builderTokensResponse } from './builder-tokens-json';
import { REF_COOKIE, cleanRef, refCookieToSet, refSourceOfQuery } from './ref-cookie';
import { noteReferral } from './installations';

/** v4.0 Task 10: the public read tokens.fun lists builder tokens from, and installs that came from tokens.fun counted. */
const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date('2026-10-21T12:00:00Z');
const RUN = randomBytes(2).toString('hex');
let n = 0;
const addr = () => `0x${randomBytes(20).toString('hex')}`;

async function builder(status: string, symbol: string, o: { hidden?: boolean; score?: number } = {}) {
  n++;
  const key = `t10${RUN}o${n}/app${n}`;
  const id = await person({ projects: [{ key, name: `App ${n}`, confirmed: true }], main: key, claimed: `t10${RUN}${n}`, score: o.score ?? 50, ranked: true });
  await sql()`UPDATE builder_profiles SET x_name = 'Maya Lee', x_avatar_url = 'https://pbs.twimg.com/maya.jpg', hidden = ${o.hidden ?? false} WHERE builder_id = ${id}`;
  const coin = addr();
  await sql()`INSERT INTO builder_tokens (builder_id, x_user_id, status, symbol, coin_address) VALUES (${id}, ${`x${id}`}, ${status}, ${symbol}, ${coin})`;
  return { id, coin, handle: `t10${RUN}${n}` };
}

test('(a) a launched token lists with all fields; a declined one and a hidden profile do not', db, async () => {
  const ok = await builder('launched', 'AAA', { score: 61 });
  const declined = await builder('declined', 'BBB');
  const hidden = await builder('launched', 'CCC', { hidden: true });
  const rows = await builderTokensJson(NOW);
  const mine = rows.filter((r) => [ok, declined, hidden].some((b) => b.handle === r.handle));
  assert.equal(mine.length, 1);
  const r = mine[0];
  assert.equal(r.coin, ok.coin);
  assert.equal(r.symbol, 'AAA');
  assert.equal(r.handle, ok.handle);
  assert.equal(r.name, 'Maya Lee');
  assert.equal(r.photo, 'https://pbs.twimg.com/maya.jpg');
  assert.equal(r.shipping, 61);
  assert.equal(r.streak, 0);
  assert.equal(r.page, `https://earnkit.com/${ok.handle}`);
  const i = rows.findIndex((x) => x.handle === ok.handle);
  for (let k = 1; k < rows.length; k++) assert.ok((rows[k - 1].shipping ?? -1) >= (rows[k].shipping ?? -1), 'shipping desc');
  assert.ok(i >= 0);
});

test('(b) 200 with Cache-Control public max-age=60 and the tokens.fun CORS header; empty list is 200', async () => {
  const res = await builderTokensResponse(async () => []);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://tokens.fun');
  assert.deepEqual(await res.json(), []);
  const bad = await builderTokensResponse(async () => { throw new Error('x'); });
  assert.equal(bad.status, 503);
  assert.equal(bad.headers.get('Cache-Control'), 'no-store');
});

test('(c) ?ref=tokensfun sets the cookie once; an install after it records ref_source, never a builder', db, async () => {
  assert.equal(refSourceOfQuery('tokensfun'), 'tokensfun');
  assert.equal(refSourceOfQuery('evil'), null);
  assert.equal(refSourceOfQuery('somehandle'), null, 'a handle is not a source in a query');
  assert.equal(cleanRef('tokensfun'), 'tokensfun');
  assert.equal(refCookieToSet('tokensfun', null, true)?.startsWith(`${REF_COOKIE}=tokensfun; Path=/; Max-Age=2592000`), true);
  assert.equal(refCookieToSet('tokensfun', `${REF_COOKIE}=someone`, true), null, 'first visit wins');
  const id = await install();
  await noteReferral(id, 'tokensfun');
  const [r] = await sql()<{ ref_source: string | null; ref_builder_id: number | null }[]>`SELECT ref_source, ref_builder_id FROM installations WHERE id = ${id}`;
  assert.deepEqual(r, { ref_source: 'tokensfun', ref_builder_id: null });
  await noteReferral(id, 'tokensfun');
  const other = await install();
  await noteReferral(other, 'nobody');
  const [o] = await sql()<{ ref_source: string | null }[]>`SELECT ref_source FROM installations WHERE id = ${other}`;
  assert.equal(o.ref_source, null);
});

test('v4.0 final review 10: a test installation\'s token (EARNKIT_TEST_INSTALLATIONS, the public stats\' rule) never lists', db, async () => {
  const own = await builder('launched', 'TST');
  const grouped = await builder('launched', 'TSU');
  const real = await builder('launched', 'TSV');
  // A second installation of `grouped`'s builder is the test one.
  const [{ id: other }] = await sql()<{ id: number }[]>`INSERT INTO installations (token_hash, builder_id) VALUES (${`t10-grp-${RUN}`}, ${grouped.id}) RETURNING id`;
  const prev = process.env.EARNKIT_TEST_INSTALLATIONS;
  process.env.EARNKIT_TEST_INSTALLATIONS = `${own.id},${other}`;
  try {
    const handles = (await builderTokensJson(NOW)).map((r) => r.handle);
    assert.ok(!handles.includes(own.handle), 'the test installation itself');
    assert.ok(!handles.includes(grouped.handle), 'a builder with a test installation in its group');
    assert.ok(handles.includes(real.handle));
  } finally {
    if (prev === undefined) delete process.env.EARNKIT_TEST_INSTALLATIONS;
    else process.env.EARNKIT_TEST_INSTALLATIONS = prev;
  }
});
