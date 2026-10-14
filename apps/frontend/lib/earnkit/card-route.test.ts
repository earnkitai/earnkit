import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as React from 'react';

/**
 * v2.12 T11 security fix, v2.12.1 T11/T12: the card routes themselves, run as Next runs them (its own process: Next's
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

test('11.11 (v2.12.1 T12) /b/<v2.12 slug>/card.png: unclaimed or hidden is a no-store 404, claimed moves to the page\'s card (308), an old slug too; flag off 404', dbTest, async () => {
  const { sql, setHidden, ensureProfile, GET } = await load();
  const was = process.env.EARNKIT_BUILDER_SCORE;
  process.env.EARNKIT_BUILDER_SCORE = 'on';
  const get = (slug: string) => GET(new Request(`http://x/b/${slug}/card.png`), { params: Promise.resolve({ slug }) });
  const id = 2_140_000_000 + Math.floor(Math.random() * 7_000_000);
  try {
    await ensureProfile(id, new Date());
    const slug = `card${id}`;
    await sql()`UPDATE builder_profiles SET slug = ${slug} WHERE builder_id = ${id}`;
    const before = await get(slug);
    assert.equal(before.status, 404, 'not claimed with X yet: not public');
    assert.equal(before.headers.get('cache-control'), 'no-store');
    const handle = `c${id}`.slice(0, 15);
    await sql()`UPDATE builder_profiles SET x_user_id = ${String(id)}, x_handle = ${handle} WHERE builder_id = ${id}`;
    const moved = await get(slug);
    assert.equal(moved.status, 308);
    assert.equal(moved.headers.get('location'), `/${handle}/card.png`);
    assert.equal(moved.headers.get('cache-control'), 'no-store');
    await setHidden(id, true);
    const hidden = await get(slug);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.headers.get('cache-control'), 'no-store');
    await setHidden(id, false);
    // An old slug (history) moves to the same card.
    await sql()`UPDATE builder_profiles SET slug = ${`cardn${id}`} WHERE builder_id = ${id}`;
    await sql()`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${slug}, ${id})`;
    assert.equal((await get(slug)).headers.get('location'), `/${handle}/card.png`);
    delete process.env.EARNKIT_BUILDER_SCORE;
    assert.equal((await get(`cardn${id}`)).status, 404, 'flag off');
  } finally {
    await sql()`DELETE FROM profile_slug_history WHERE builder_id = ${id}`;
    await sql()`DELETE FROM builder_profiles WHERE builder_id = ${id}`;
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
    // A reserved handle's card is at /b/<handle>/card.png, drawn the same way (@oauth, used by no other test).
    const rid = id + 1;
    await sql()`UPDATE builder_profiles SET x_handle = NULL, x_user_id = NULL WHERE lower(x_handle) = 'oauth'`;
    await sql()`INSERT INTO builder_profiles (builder_id, slug, x_user_id, x_handle) VALUES (${rid}, ${`cr${rid}`}, ${`5${rid}`}, 'oauth')`;
    try {
      const r = await bCard(new Request('http://x/b/oauth/card.png'), { params: Promise.resolve({ slug: 'oauth' }) });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/png');
      assert.deepEqual([...new Uint8Array(await r.arrayBuffer()).slice(1, 4)], [0x50, 0x4e, 0x47]);
      const root = await card(new Request('http://x/oauth/card.png'), { params: Promise.resolve({ handle: 'oauth' }) });
      assert.deepEqual([root.status, root.headers.get('location')], [308, '/b/oauth/card.png']);
    } finally {
      await sql()`DELETE FROM builder_profiles WHERE builder_id = ${rid}`;
    }
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
