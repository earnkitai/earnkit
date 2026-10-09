import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RedirectError, SafeFetchError, safeFetchBytes, type Transport, type TransportResponse } from './safe-fetch';
import { iconCandidates, launchLogo, markFor, pickIconHref, resolveLogo } from './token-logo';
import { imageTypeOf } from './tokens';

// No test here touches the network: pages, images, previews and transports are fakes.

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const GIF = Buffer.from('GIF89a......');
const PAGE = 'https://tipjar.xyz/app';

test('imageTypeOf: PNG, JPEG and WebP by bytes; GIF, SVG and HTML are null', () => {
  assert.equal(imageTypeOf(PNG), 'image/png');
  assert.equal(imageTypeOf(JPEG), 'image/jpeg');
  assert.equal(imageTypeOf(WEBP), 'image/webp');
  for (const b of [GIF, SVG, Buffer.from('<!doctype html>'), Buffer.alloc(0)]) assert.equal(imageTypeOf(b), null);
});

test('6.1 pickIconHref: touch icon, then the largest raster icon of 128 px+, then og:image; never SVG, ICO or http', () => {
  const og = '<meta property="og:image" content="https://cdn.tipjar.xyz/og.png">';
  // apple-touch-icon wins over everything.
  assert.equal(
    pickIconHref(`<link rel="icon" sizes="192x192" href="/i.png"><link rel="apple-touch-icon" href="/touch.png">${og}`, PAGE),
    'https://tipjar.xyz/touch.png',
  );
  // The largest raster icon, 192 over 32.
  assert.equal(
    pickIconHref('<link rel="icon" sizes="32x32" href="/s.png"><link rel="icon" sizes="192x192" href="/i.png">', PAGE),
    'https://tipjar.xyz/i.png',
  );
  // A 64 px PNG alone is under 128: og:image.
  assert.equal(pickIconHref(`<link rel="icon" sizes="64x64" href="/s.png">${og}`, PAGE), 'https://cdn.tipjar.xyz/og.png');
  // SVG (by type or extension) and ICO are never picked.
  assert.equal(
    pickIconHref(
      '<link rel="icon" type="image/svg+xml" sizes="512x512" href="/i"><link rel="icon" sizes="256x256" href="/i.svg">' +
        `<link rel="shortcut icon" sizes="256x256" href="/favicon.ico"><link rel="apple-touch-icon" href="/t.svg">${og}`,
      PAGE,
    ),
    'https://cdn.tipjar.xyz/og.png',
  );
  // Relative hrefs resolve against the page; http links are dropped.
  assert.equal(pickIconHref('<link rel="apple-touch-icon" href="t.png">', PAGE), 'https://tipjar.xyz/t.png');
  assert.equal(pickIconHref('<link rel="apple-touch-icon" href="http://tipjar.xyz/t.png">', PAGE), null);
  assert.equal(pickIconHref('<meta content="http://x.io/og.png" property="og:image">', PAGE), null);
  // Attribute order doesn't matter; &amp; in a link is decoded.
  assert.equal(pickIconHref("<meta content='https://x.io/og.png?a=1&amp;b=2' property='og:image'>", PAGE), 'https://x.io/og.png?a=1&b=2');
  assert.equal(pickIconHref('<p>no icons</p>', PAGE), null);
  // Pre-flight P24: every candidate in order, for resolveLogo to try in turn.
  assert.deepEqual(iconCandidates(`<link rel="apple-touch-icon" href="/t.png"><link rel="icon" sizes="192x192" href="/i.png">${og}`, PAGE), [
    'https://tipjar.xyz/t.png',
    'https://tipjar.xyz/i.png',
    'https://cdn.tipjar.xyz/og.png',
  ]);
});

const fakes = (o: {
  html?: string | Error;
  images?: Record<string, Buffer | Error>;
  preview?: string | null;
}) => {
  const seen = { pages: [] as string[], images: [] as string[], previews: [] as string[] };
  return {
    seen,
    deps: {
      page: async (u: string) => {
        seen.pages.push(u);
        if (o.html instanceof Error || o.html === undefined) throw o.html ?? new SafeFetchError('answered 404, not 200');
        return o.html;
      },
      image: async (u: string) => {
        seen.images.push(u);
        const b = o.images?.[u];
        if (!b || b instanceof Error) throw b ?? new SafeFetchError('answered 404, not 200');
        return b;
      },
      preview: async (k: string) => {
        seen.previews.push(k);
        return o.preview ?? null;
      },
    },
  };
};

test('6.2 resolveLogo: the site icon, then og:image, then the custom preview, then null', async () => {
  const html =
    '<link rel="apple-touch-icon" href="/t.png"><meta property="og:image" content="https://tipjar.xyz/og.jpg">';
  const PREVIEW = 'https://repository-images.githubusercontent.com/1/abc';
  const a = { liveUrl: 'https://tipjar.xyz', repoKey: 'github.com/alice/tipjar' };

  // The site's icon first; the preview is never read.
  let f = fakes({ html, images: { 'https://tipjar.xyz/t.png': PNG, 'https://tipjar.xyz/og.jpg': JPEG }, preview: PREVIEW });
  assert.deepEqual(await resolveLogo(a, f.deps), { bytes: PNG, type: 'image/png', from: 'site' });
  assert.deepEqual(f.seen.previews, []);

  // The icon fails: og:image.
  f = fakes({ html, images: { 'https://tipjar.xyz/og.jpg': JPEG }, preview: PREVIEW });
  assert.deepEqual(await resolveLogo(a, f.deps), { bytes: JPEG, type: 'image/jpeg', from: 'site' });
  assert.deepEqual(f.seen.images, ['https://tipjar.xyz/t.png', 'https://tipjar.xyz/og.jpg']);

  // An SVG served as an icon (whatever its type header) and a file over 1 MB are skipped.
  f = fakes({ html, images: { 'https://tipjar.xyz/t.png': SVG, 'https://tipjar.xyz/og.jpg': Buffer.concat([PNG, Buffer.alloc(1_000_001)]) }, preview: PREVIEW });
  f.deps.image = (async (u: string) => {
    f.seen.images.push(u);
    return u === PREVIEW ? WEBP : u.endsWith('t.png') ? SVG : Buffer.concat([PNG, Buffer.alloc(1_000_001)]);
  }) as typeof f.deps.image;
  // ...so the custom preview, read once.
  assert.deepEqual(await resolveLogo(a, f.deps), { bytes: WEBP, type: 'image/webp', from: 'preview' });
  assert.deepEqual(f.seen.previews, ['github.com/alice/tipjar']);

  // The page fails: the preview.
  f = fakes({ html: new SafeFetchError('redirects to another site (x.io)'), images: { [PREVIEW]: PNG }, preview: PREVIEW });
  assert.equal((await resolveLogo(a, f.deps))?.from, 'preview');

  // Nothing anywhere: null (the caller sends the mark). No repo: no preview read.
  f = fakes({ html: '<p>hi</p>', preview: null });
  assert.equal(await resolveLogo(a, f.deps), null);
  f = fakes({ html: '<p>hi</p>', preview: PREVIEW });
  assert.equal(await resolveLogo({ liveUrl: 'https://tipjar.xyz', repoKey: null }, f.deps), null);
  assert.deepEqual(f.seen.previews, []);
  // No live link: no page read.
  f = fakes({ images: { [PREVIEW]: PNG }, preview: PREVIEW });
  assert.equal((await resolveLogo({ liveUrl: null, repoKey: a.repoKey }, f.deps))?.from, 'preview');
  assert.deepEqual(f.seen.pages, []);
  // A throwing preview moves on.
  f = fakes({ html: '<p>hi</p>' });
  f.deps.preview = async () => { throw new Error('graphql down'); };
  assert.equal(await resolveLogo(a, f.deps), null);
});

test('6.2 (H6) a private repo, or one without a fresh public read, never has its preview read', async () => {
  const PREVIEW = 'https://repository-images.githubusercontent.com/1/abc';
  const repoUrl = 'https://github.com/Alice/TipJar';
  const run = async (repoPrivate: boolean, shown: string[]) => {
    const f = fakes({ images: { [PREVIEW]: PNG }, preview: PREVIEW });
    const out = await launchLogo({ liveUrl: null, repoUrl, repoPrivate }, { ...f.deps, publicKeys: async () => new Set(shown) });
    return { out, previews: f.seen.previews };
  };
  const pub = await run(false, ['github.com/alice/tipjar']);
  assert.equal(pub.out?.from, 'preview');
  assert.deepEqual(pub.previews, ['github.com/alice/tipjar']);
  for (const [priv, shown] of [[true, ['github.com/alice/tipjar']], [false, []]] as const) {
    const r = await run(priv, [...shown]);
    assert.equal(r.out, null);
    assert.deepEqual(r.previews, [], 'the preview is never read');
  }
  // A failed public-read check fails closed.
  const f = fakes({ preview: PREVIEW, images: { [PREVIEW]: PNG } });
  assert.equal(await launchLogo({ liveUrl: null, repoUrl, repoPrivate: false }, { ...f.deps, publicKeys: async () => { throw new Error('db'); } }), null);
  assert.deepEqual(f.seen.previews, []);
});

test('6.2 githubPreview: only a custom image of a repo GitHub says is public', async () => {
  const { githubPreview } = await import('./token-logo');
  const prev = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'test-token';
  const answer = (repository: unknown) => (async (_u: unknown, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)) as { variables: { owner: string; name: string } };
    assert.deepEqual(q.variables, { owner: 'alice', name: 'tipjar' });
    return Response.json({ data: { repository } });
  }) as typeof fetch;
  try {
    const img = 'https://repository-images.githubusercontent.com/1/abc';
    assert.equal(await githubPreview('github.com/alice/tipjar', answer({ isPrivate: false, usesCustomOpenGraphImage: true, openGraphImageUrl: img })), img);
    assert.equal(await githubPreview('github.com/alice/tipjar', answer({ isPrivate: false, usesCustomOpenGraphImage: false, openGraphImageUrl: img })), null);
    assert.equal(await githubPreview('github.com/alice/tipjar', answer({ isPrivate: true, usesCustomOpenGraphImage: true, openGraphImageUrl: img })), null);
    assert.equal(await githubPreview('github.com/alice/tipjar', answer(null)), null);
    assert.equal(await githubPreview('gitlab.com/alice/tipjar', answer({})), null);
    delete process.env.GITHUB_TOKEN;
    assert.equal(await githubPreview('github.com/alice/tipjar', answer({})), null, 'no token: no read');
  } finally {
    if (prev === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prev;
  }
});

test('6.3 markFor: the same for the same id, different across ids, no text', () => {
  assert.deepEqual(markFor(7), markFor(7));
  // Golden values: launched tokens carry the mark's link onchain (immutable), so a change here
  // redraws every launched logo. Never update these to make a change pass.
  assert.deepEqual(markFor(1), { shape: 'diamond', from: '#e19647', to: '#58a51d', angle: 45 });
  assert.deepEqual(markFor(12345), { shape: 'circle', from: '#b547e1', to: '#a51d2f', angle: 135 });
  const marks = Array.from({ length: 40 }, (_, i) => JSON.stringify(markFor(i + 1)));
  assert.ok(new Set(marks).size >= 38, 'ids draw different marks');
  assert.ok(new Set(Array.from({ length: 40 }, (_, i) => markFor(i + 1).shape)).size === 4, 'every shape is used');
  const m = markFor(42);
  assert.deepEqual(Object.keys(m).sort(), ['angle', 'from', 'shape', 'to']);
  assert.match(m.from, /^#[0-9a-f]{6}$/);
  assert.match(m.to, /^#[0-9a-f]{6}$/);
  assert.ok(m.angle >= 0 && m.angle < 360);
});

test('safeFetchBytes: the SSRF rules of safeFetchText, a 1 MB default, no redirects', async () => {
  const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
  async function* body(...parts: Buffer[]) {
    for (const p of parts) yield p;
  }
  let accept: string | undefined;
  let path = '';
  const ok: Transport = async ({ url, accept: a }) => ((accept = a), (path = url.pathname + url.search), { status: 200, body: body(PNG) });
  assert.deepEqual(await safeFetchBytes('https://tipjar.xyz/i.png?v=2', { resolve, transport: ok }), PNG);
  assert.equal(accept, 'image/png,image/jpeg,image/webp');
  assert.equal(path, '/i.png?v=2');
  const big: Transport = async () => ({ status: 200, body: body(Buffer.alloc(600_000), Buffer.alloc(600_000)) });
  await assert.rejects(safeFetchBytes('https://tipjar.xyz/i.png', { resolve, transport: big }), /larger than 1000000 bytes/);
  const redirect: Transport = async () => ({ status: 302, location: 'https://169.254.169.254/', body: body() });
  await assert.rejects(safeFetchBytes('https://tipjar.xyz/i.png', { resolve, transport: redirect }), RedirectError);
  await assert.rejects(
    safeFetchBytes('https://tipjar.xyz/i.png', { resolve: async () => [{ address: '10.0.0.1', family: 4 }], transport: ok }),
    /doesn't point to a public address/,
  );
  await assert.rejects(safeFetchBytes('http://tipjar.xyz/i.png', { resolve, transport: ok }), /https only/);
});

test('P24: the default reads follow one same-site page redirect and one image redirect, never more', async () => {
  const resolve = async () => [{ address: '93.184.216.34', family: 4 as const }];
  async function* body(b: Buffer | string) {
    yield Buffer.from(b);
  }
  const routes: Record<string, () => TransportResponse> = {};
  const seen: string[] = [];
  const transport: Transport = async ({ url }) => {
    seen.push(url.href);
    const r = routes[url.href];
    return r ? r() : { status: 404, body: body('') };
  };
  const at = (status: number, location: string) => () => ({ status, location, body: body('') });
  const ok = (b: Buffer | string) => () => ({ status: 200, body: body(b) });
  const net = { resolve, transport };
  const page = '<link rel="apple-touch-icon" href="/t.png">';

  // apex -> www (same site): followed; the icon 302s to a CDN once: followed.
  routes['https://tipjar.xyz/'] = at(301, 'https://www.tipjar.xyz/');
  routes['https://www.tipjar.xyz/'] = ok(page);
  routes['https://tipjar.xyz/t.png'] = at(302, 'https://cdn.example.net/t.png');
  routes['https://cdn.example.net/t.png'] = ok(PNG);
  assert.deepEqual(await resolveLogo({ liveUrl: 'https://tipjar.xyz/', repoKey: null }, { net }), { bytes: PNG, type: 'image/png', from: 'site' });

  // A second image hop is refused: no logo.
  routes['https://cdn.example.net/t.png'] = at(302, 'https://cdn2.example.net/t.png');
  routes['https://cdn2.example.net/t.png'] = ok(PNG);
  seen.length = 0;
  assert.equal(await resolveLogo({ liveUrl: 'https://tipjar.xyz/', repoKey: null }, { net }), null);
  assert.ok(!seen.includes('https://cdn2.example.net/t.png'), 'never a second hop');

  // A page redirect to another site is refused: no image is read.
  routes['https://tipjar.xyz/'] = at(301, 'https://elsewhere.example/');
  routes['https://elsewhere.example/'] = ok(page);
  seen.length = 0;
  assert.equal(await resolveLogo({ liveUrl: 'https://tipjar.xyz/', repoKey: null }, { net }), null);
  assert.deepEqual(seen, ['https://tipjar.xyz/']);
});

test('the logo budget: a hanging read gives null when the budget runs out', async () => {
  const started = Date.now();
  const out = await resolveLogo(
    { liveUrl: 'https://tipjar.xyz', repoKey: null },
    { page: async () => '<link rel="apple-touch-icon" href="/t.png">', image: () => new Promise<Buffer>(() => {}), budgetMs: 50 },
  );
  assert.equal(out, null);
  assert.ok(Date.now() - started < 2_000, 'returns at the budget, not at the hang');
});

test('Ruling H7: an image_url that may carry a secret is refused', async () => {
  const { unsafeImageUrl } = await import('./tokens');
  for (const u of [
    'https://user:pass@tipjar.xyz/logo.png',
    'https://user@tipjar.xyz/logo.png',
    'https://tipjar.xyz/logo.png?token=abc',
    'https://tipjar.xyz/logo.png?X-Sig=1&SIG=2',
    'https://tipjar.xyz/logo.png?Key=abc',
    'https://raw.githubusercontent.com/alice/tipjar/main/logo.png?raw=true',
    'not a url',
  ])
    assert.equal(unsafeImageUrl(u), true, u);
  for (const u of [
    'https://tipjar.xyz/logo.png',
    'https://tipjar.xyz/logo.png?v=2&w=256',
    'https://raw.githubusercontent.com/alice/tipjar/main/logo.png',
    'https://tipjar.xyz/monkey.png?keys=1',
  ])
    assert.equal(unsafeImageUrl(u), false, u);
});
