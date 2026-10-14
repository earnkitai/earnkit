import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as React from 'react';

/**
 * v2.12 T11 security fix: the card route itself, run as Next runs it (its own process: Next's
 * request storage needs a real AsyncLocalStorage before any next module loads, so every import
 * here is dynamic, after it is set).
 */
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
(globalThis as { React?: typeof React }).React = React; // the route's JSX under tsx
const load = async () => ({
  ...(await import('./db')),
  ...(await import('./share')),
  ...(await import('./profiles')),
  ...(await import('../../app/b/[slug]/card.png/route')),
});

const dbTest = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await (await load()).sql().end();
});

async function scored() {
  const { sql, ensureProfile } = await load();
  const id = 2_140_000_000 + Math.floor(Math.random() * 7_000_000);
  await ensureProfile(id, new Date());
  await sql()`UPDATE builder_profiles SET slug = ${`card${id}`} WHERE builder_id = ${id}`;
  // Final review I4: not public before the consent line is shown (checked below, then shown).
  const parts = { users: { points: 10, raw: { U: 40 } }, money: { points: 0, raw: {} }, staying: { points: 0, raw: {} }, recency: { points: 0, raw: {} }, consistency: { points: 0, raw: {} } };
  await sql()`INSERT INTO builder_scores (builder_id, day, score, percentile, parts, top_outcome, formula, calibration, held)
    VALUES (${id}, '2026-10-12', 41, 78, ${sql().json(parts)}, '{}', 'v1', 'v1-launch', false)`;
  return id;
}

test('11.11 the card follows the profile at once: hidden is a 404 (no-store), an old slug moves on, never an immutable or long cache', dbTest, async () => {
  const { sql, CARD_CACHE, setHidden, GET } = await load();
  // A real (Map-backed) Next data cache that nothing expires here (profileChanged() has no request
  // context in tests): the cached read stays stale after a hide, as a missed revalidation would.
  const store = new Map<string, unknown>();
  const g = globalThis as { __incrementalCache?: unknown };
  g.__incrementalCache = {
    generateCacheKey: async (k: string) => k,
    get: async (k: string) => (store.has(k) ? { value: store.get(k), isStale: false } : null),
    set: async (k: string, v: unknown) => void store.set(k, v),
  };
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  const get = (slug: string) => GET(new Request(`http://x/b/${slug}/card.png`), { params: Promise.resolve({ slug }) });
  try {
    const id = await scored();
    const slug = `card${id}`;
    const before = await get(slug);
    assert.equal(before.status, 404, 'v2.12.1 T6: not claimed with X yet: not public');
    assert.equal(before.headers.get('cache-control'), 'no-store');
    await sql()`UPDATE builder_profiles SET consent_shown_at = now(), x_user_id = ${String(id)}, x_handle = ${`c${id}`.slice(0, 15)} WHERE builder_id = ${id}`;
    const ok = await get(slug);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.equal(ok.headers.get('cache-control'), CARD_CACHE);
    assert.doesNotMatch(CARD_CACHE, /immutable/);
    assert.ok(Number(/s-maxage=(\d+)/.exec(CARD_CACHE)![1]) <= 600 && /max-age=0\b/.test(CARD_CACHE));

    // Hidden (through setHidden, as "hide" does): a 404 on the very next request, never stored.
    await setHidden(id, true);
    const hidden = await get(slug);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.headers.get('cache-control'), 'no-store');
    await setHidden(id, false);
    assert.equal((await get(slug)).status, 200);

    // A new slug (an X handle set or cleared): the old one moves on at once, never the old card.
    await sql()`UPDATE builder_profiles SET slug = ${`cardn${id}`} WHERE builder_id = ${id}`;
    await sql()`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${slug}, ${id})`;
    const moved = await get(slug);
    assert.equal(moved.status, 308);
    assert.equal(moved.headers.get('location'), `/b/cardn${id}/card.png`);
    assert.equal(moved.headers.get('cache-control'), 'no-store');

    assert.ok(store.size > 0, 'the cached read was really cached');
    delete process.env.EARNKIT_BUILDER_SCORE;
    assert.equal((await get(`cardn${id}`)).status, 404, 'flag off');
  } finally {
    delete g.__incrementalCache;
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

// ---- v2.12.1 T11: the card and the share link at earnkit.com/<x-handle>.

const loadV2121 = async () => ({
  ...(await import('./db')),
  ...(await import('./share')),
  ...(await import('./profiles')),
  card: (await import('../../app/[handle]/card.png/route')).GET,
  share: (await import('../../app/[handle]/share/route')).GET,
  bCard: (await import('../../app/b/[slug]/card.png/route')).GET,
  ...(await import('../../app/[handle]/card-response')),
});

test('11.6 /<handle>/card.png: a PNG for a claimed page, the headline of the latest moment; hidden or unclaimed a no-store 404; another case a 308; flag off 404', dbTest, async () => {
  const { sql, CARD_CACHE, card, bCard } = await loadV2121();
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  const id = 2_146_000_000 + Math.floor(Math.random() * 400_000);
  const handle = `Cd${id}`.slice(0, 15);
  const get = (h: string) => card(new Request(`http://x/${h}/card.png`), { params: Promise.resolve({ handle: h }) });
  try {
    await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, x_name, x_avatar_url) VALUES
      (${id}, ${`cd${id}`}, ${`7${id}`}, ${handle}, 'Card Person', 'https://pbs.twimg.com/profile_images/1/a_normal.jpg')`;
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped) VALUES (${id}, 'k', 'App', 'app', false, true)`;
    const ok = await get(handle);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.equal(ok.headers.get('cache-control'), CARD_CACHE);
    const png = new Uint8Array(await ok.arrayBuffer());
    assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47], 'a PNG, drawn even though the X picture could not be fetched (the letter instead)');
    const lower = await get(handle.toLowerCase());
    assert.equal(lower.status, 308);
    assert.equal(lower.headers.get('location'), `/${handle}/card.png`);
    await sql()`UPDATE builder_profiles SET hidden = true WHERE builder_id = ${id}`;
    const hidden = await get(handle);
    assert.deepEqual([hidden.status, hidden.headers.get('cache-control')], [404, 'no-store']);
    await sql()`UPDATE builder_profiles SET hidden = false, x_user_id = NULL WHERE builder_id = ${id}`;
    assert.equal((await get(handle)).status, 404, 'unclaimed: no card');
    // A reserved handle's card is at /b/<handle>/card.png, drawn the same way.
    const r = await bCard(new Request('http://x/b/mcp/card.png'), { params: Promise.resolve({ slug: 'mcp' }) });
    assert.ok(r.status === 404 || r.status === 200 || r.status === 308);
    delete process.env.EARNKIT_BUILDER_SCORE;
    assert.equal((await get(handle)).status, 404, 'flag off');
  } finally {
    await sql()`DELETE FROM builder_projects WHERE builder_id = ${id}`;
    await sql()`DELETE FROM builder_profiles WHERE builder_id = ${id}`;
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

test('11.7 /<handle>/share: a 302 to the X intent with the headline and the page; never a target from the request', dbTest, async () => {
  const { sql, share } = await loadV2121();
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  const id = 2_146_500_000 + Math.floor(Math.random() * 400_000);
  const handle = `Sh${id}`.slice(0, 15);
  try {
    await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle, card_moments) VALUES
      (${id}, ${`sh${id}`}, ${`6${id}`}, ${handle}, '{"latest": "people"}'::jsonb)`;
    await sql()`INSERT INTO builder_projects (builder_id, project_key, name, kind, confirmed, shipped, people) VALUES
      (${id}, 'https://tokens.example', 'tokens.example', 'app', true, true, 140), (${id}, 'k2', 'Two', 'app', false, true, 0)`;
    const res = await share(new Request(`http://x/${handle}/share?next=https://evil.example`), { params: Promise.resolve({ handle }) });
    assert.equal(res.status, 302);
    const u = new URL(res.headers.get('location')!);
    assert.equal(u.origin, 'https://x.com');
    assert.equal(u.searchParams.get('text'), '140 people use tokens.example on EarnKit.');
    assert.equal(u.searchParams.get('url'), `https://earnkit.com/${handle}`);
    // The rank moment without a rank that reads well: what they shipped.
    await sql()`UPDATE builder_profiles SET card_moments = '{"latest": "rank"}'::jsonb WHERE builder_id = ${id}`;
    const r2 = await share(new Request(`http://x/${handle}/share`), { params: Promise.resolve({ handle }) });
    assert.equal(new URL(r2.headers.get('location')!).searchParams.get('text'), 'Shipped 2 apps with AI on EarnKit.');
  } finally {
    await sql()`DELETE FROM builder_projects WHERE builder_id = ${id}`;
    await sql()`DELETE FROM builder_profiles WHERE builder_id = ${id}`;
    if (was === undefined) delete process.env.EARNKIT_BUILDER_SCORE;
    else process.env.EARNKIT_BUILDER_SCORE = was;
  }
});

test('11.8 the card reads at X\'s mobile preview: Funnel Display, a big headline, a 30px footer; the picture only from X, 3 s, jpeg or png', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { avatarData, headlineSize } = await loadV2121();
  const src = readFileSync(join(import.meta.dirname, '../../app/[handle]/card-response.tsx'), 'utf8');
  assert.match(src, /name: 'Funnel Display'/);
  assert.match(src, /fontSize: 30/);
  assert.match(src, /AbortSignal\.timeout\(3_000\)/);
  for (const w of [500, 700]) assert.ok(readFileSync(join(import.meta.dirname, `../../assets/fonts/funnel-display-latin-${w}.woff`)).byteLength > 1000);
  // At about 500px wide (X's mobile preview, 0.42 of 1200), the headline stays 22px or more.
  for (const h of ['Shipped 3 apps with AI', '140 people use tokens.fun', '#3 of 40 builders on EarnKit', '12,345 people use my-very-long-project-name'])
    assert.ok(headlineSize(h) * 0.42 >= 21.8, h);
  // Never the "Builder" fallback or a score on the card.
  assert.doesNotMatch(src, /'Builder'|of 100|FALLBACK_NAME/);
  const png = new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  assert.equal(await avatarData('https://pbs.twimg.com/x1.png', async () => png), 'data:image/png;base64,iVBORw==');
  const html = new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
  assert.equal(await avatarData('https://pbs.twimg.com/x2.svg', async () => html), null);
  assert.equal(await avatarData('https://pbs.twimg.com/x3.jpg', async () => { throw new Error('down'); }), null);
  assert.equal(await avatarData(null), null);
});
