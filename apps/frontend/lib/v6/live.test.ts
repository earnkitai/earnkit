import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubLinks, isApp, rdapOrg, readLive } from './live';
import { fakeRdap, fakeSite, SITES_RECORDED_AT } from './fixtures/site';

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const STATIC_120 = `<!doctype html><html><head><title>Hello</title></head><body><p>${'Plain words on one page. '.repeat(5).slice(0, 120)}</p></body></html>`;

test('the site recordings were made on the pinned date', () => {
  assert.equal(SITES_RECORDED_AT, '2026-11-06');
});

test('a Next.js page with /_next/static scripts loads and is an app', async () => {
  const site = fakeSite();
  const l = await readLive('https://onchainreaction.vercel.app/', { probe: site.probe, rdap: fakeRdap().rdap, now: NOW });
  assert.equal(l.url_ok, true);
  assert.equal(l.is_app, true);
  assert.equal(l.title, 'Onchain Reaction');
  assert.equal(l.domain, 'onchainreaction.vercel.app');
  // A shared host's registration is the host's, not the project's.
  assert.equal(l.domain_age_days, null);
  assert.equal(site.calls.length, 1);
});

test('a 120-character static page is not an app', async () => {
  const site = fakeSite({ 'https://plain.example.org/': { status: 200, body: STATIC_120 } });
  const l = await readLive('https://plain.example.org/', { probe: site.probe, rdap: fakeRdap({ 'example.org': { registered_at: null } }).rdap, now: NOW });
  assert.equal(l.url_ok, true);
  assert.equal(l.is_app, false);
  assert.equal(isApp(STATIC_120), false);
});

test('a 404 is not ok, with its status; a 402 the same', async () => {
  const site = fakeSite();
  const l = await readLive('https://gone.example.org/', { probe: site.probe, rdap: fakeRdap({ 'example.org': { registered_at: null } }).rdap, now: NOW });
  assert.equal(l.url_ok, false);
  assert.equal(l.status, 404);
  assert.equal(l.is_app, null);
  const paused = await readLive('https://logbook.astral.global', { probe: site.probe, rdap: fakeRdap({ 'astral.global': { registered_at: null } }).rdap, now: NOW });
  assert.equal(paused.url_ok, false);
  assert.equal(paused.status, 402);
});

test('RDAP sets domain_age_days; an RDAP failure leaves it null with a note', async () => {
  const site = fakeSite();
  const l = await readLive('https://earnkit.com/', { probe: site.probe, rdap: fakeRdap().rdap, now: NOW });
  assert.equal(l.url_ok, true);
  assert.equal(l.is_app, true);
  assert.equal(l.domain, 'earnkit.com');
  assert.equal(l.domain_age_days, Math.floor((NOW.getTime() - Date.parse('2007-06-29T09:58:47Z')) / DAY));
  assert.equal(l.note, null);
  const down = await readLive('https://earnkit.com/', { probe: site.probe, rdap: async () => { throw new Error('down'); }, now: NOW });
  assert.equal(down.domain_age_days, null);
  assert.equal(down.note, 'domain_age_days not read: rdap');
});

test('a github.com/owner/repo link in the page is in github_links', async () => {
  const html = `<html><body><a href="https://github.com/Acme/Widget">code</a><a href="https://github.com/acme/widget/tree/main">again</a>
    <a href="https://github.com/sponsors/acme">sponsor</a><a href="https://github.com/acme">profile</a><a href='http://www.github.com/b/c.git'>b</a></body></html>`;
  assert.deepEqual(githubLinks(html), ['https://github.com/acme/widget', 'https://github.com/b/c']);
  const site = fakeSite({ 'https://acme.example.org/': { status: 200, body: html } });
  const l = await readLive('https://acme.example.org/', { probe: site.probe, rdap: fakeRdap({ 'example.org': { registered_at: null } }).rdap, now: NOW });
  assert.ok(l.github_links.includes('https://github.com/acme/widget'));
});

test('a null url gives all nulls and no live url', async () => {
  const site = fakeSite();
  const l = await readLive(null, { probe: site.probe, rdap: fakeRdap().rdap, now: NOW });
  assert.deepEqual(l, {
    url: null, url_ok: null, status: null, is_app: null, domain: null, domain_age_days: null, title: null, github_links: [], note: 'no live url',
  });
  assert.equal(site.calls.length, 0);
});

test('isApp: a form, a bundle script or a wallet marker', () => {
  assert.equal(isApp('<html><body><form action="/x"></form></body></html>'), true);
  assert.equal(isApp('<script src="/static/js/main.4f2a.js"></script>'), true);
  assert.equal(isApp('<script src="/assets/index.js?v=2"></script>'), true);
  assert.equal(isApp('<script src="https://cdn.example.org/analytics.js"></script><p>hi</p>'), false);
  assert.equal(isApp('<button>Connect Wallet</button>'), true);
  assert.equal(isApp('<p>Uses RainbowKit</p>'), true);
});

test('a failed load is told in fixed words, never the error text', async () => {
  const cases: [Error, string][] = [
    [Object.assign(new Error('no answer within 10 s'), { name: 'SafeFetchError' }), 'site did not load: no answer in time'],
    [new Error('redirects to another site (evil.example)'), 'site redirects to another site'],
    [new Error("x.example doesn't point to a public address"), 'site does not point to a public address'],
    [new Error("x.example doesn't resolve"), 'site domain does not resolve'],
    [Object.assign(new Error('shows an error page (Bad Gateway)'), { name: 'ErrorPageError' }), 'site shows an error page'],
    [new Error("couldn't fetch it (ECONNRESET token=abc)"), 'site did not load'],
  ];
  for (const [err, note] of cases) {
    const l = await readLive('https://x.example.org/', { probe: async () => { throw err; }, rdap: async () => ({ registered_at: null }), now: NOW });
    assert.equal(l.url_ok, false);
    assert.equal(l.note?.split('; ')[0], note);
  }
  const words = /score|rank|grade|points|coin|token|streak|—/i;
  for (const [, note] of cases) assert.ok(!words.test(note), note);
  // A redirect past the one followed, through the real probe.
  const site = fakeSite({
    'https://hop.example.org/': { status: 301, body: '', location: 'https://hop.example.org/a' },
    'https://hop.example.org/a': { status: 302, body: '', location: 'https://hop.example.org/b' },
  });
  const hop = await readLive('https://hop.example.org/', { probe: site.probe, rdap: async () => ({ registered_at: null }), now: NOW });
  assert.equal(hop.note?.split('; ')[0], 'site redirects more than once');
});

test('rdapOrg sends a User-Agent and the RDAP Accept header (rdap.org answers 403 without one)', async () => {
  const seen: { url: string; headers: Headers }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json({ events: [{ eventAction: 'registration', eventDate: '2007-06-29T09:58:47Z' }] });
  }) as typeof fetch;
  assert.deepEqual(await rdapOrg('earnkit.com', f), { registered_at: '2007-06-29T09:58:47.000Z' });
  assert.equal(seen[0].url, 'https://rdap.org/domain/earnkit.com');
  assert.equal(seen[0].headers.get('user-agent'), 'Mozilla/5.0 (compatible; EarnKit-verifier/1)');
  assert.equal(seen[0].headers.get('accept'), 'application/rdap+json, application/json');
  const refused = (async () => new Response('', { status: 403 })) as typeof fetch;
  await assert.rejects(rdapOrg('earnkit.com', refused), /rdap 403/);
});

test('an http:// site reads "site is not https"', async () => {
  const site = fakeSite();
  const l = await readLive('http://plain.example.org/', { probe: site.probe, rdap: async () => ({ registered_at: null }), now: NOW });
  assert.equal(l.url_ok, false);
  assert.equal(l.note?.split('; ')[0], 'site is not https');
  assert.equal(site.calls.length, 0);
});
