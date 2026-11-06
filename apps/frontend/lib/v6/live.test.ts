import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubLinks, isApp, readLive } from './live';
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
