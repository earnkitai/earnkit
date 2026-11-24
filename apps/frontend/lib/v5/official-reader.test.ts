/**
 * v3.8 G-A: the official-page reader and the check around it, against the pages Growth's acceptance run met (trimmed
 * fixtures in fixtures/pages/, served by a fake transport; never the network). GET only; an honest user agent first,
 * a browser-like EarnKit-verifier once on a bot wall; the whole page read; a thin page or a 5xx shell searched in its
 * embedded data and its platform's public source; a page still walled goes live information only on a program platform
 * or a domain tied to the organizer; forms.gle expanded to its form.
 */
import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';
import { getProgram } from './programs';
import { BLOCKED_REASON, writePost } from './programs-api';
import { embeddedText, expandShortLink, pageText, readOfficial, type PageReader } from './official-page';
import {
  HttpStatusError,
  PAGE_MAX_BYTES,
  PageBlockedError,
  PageShellError,
  SafeFetchError,
  VERIFIER_BROWSER_UA,
  VERIFIER_UA,
  probeLink,
  requestOptions,
  safeProbe,
  safeReadPage,
  type Resolver,
  type Transport,
} from './safe-fetch';

after(() => sql().end());

const PAGES = join(import.meta.dirname, 'fixtures', 'pages');
const page = (name: string) => readFileSync(join(PAGES, name), 'utf8');

type Answer = { status: number; body: string; contentType?: string; location?: string };
/** A site: per URL, the answer to each user agent (`browser` for VERIFIER_BROWSER_UA, else `plain`). */
type Site = Record<string, { plain: Answer; browser?: Answer }>;

/** A resolver and transport serving `site` in `chunk`-byte pieces, recording each request's URL and user agent. */
function serve(site: Site, chunk = 4_096) {
  const requests: { url: string; ua: string | undefined }[] = [];
  const resolve: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const transport: Transport = async ({ url, userAgent }) => {
    requests.push({ url: url.href, ua: userAgent });
    const entry = site[url.href];
    const a: Answer = entry ? (userAgent === VERIFIER_BROWSER_UA && entry.browser ? entry.browser : entry.plain) : { status: 404, body: 'Not Found' };
    const bytes = Buffer.from(a.body);
    return {
      status: a.status,
      contentType: a.contentType ?? 'text/html; charset=utf-8',
      ...(a.location && { location: a.location }),
      body: (async function* () {
        for (let i = 0; i < bytes.byteLength; i += chunk) yield new Uint8Array(bytes.subarray(i, i + chunk));
      })(),
    };
  };
  const read: PageReader = (url, opts) => safeReadPage(url, { resolve, transport, ...(opts?.json && { accept: 'application/json' }) });
  return { resolve, transport, requests, read };
}

const html = (body: string) => ({ status: 200, body });
/** A page that loads (a form, an overview), for the write's link probe. */
const LOADS = { plain: html('<html><body><p>Apply here</p></body></html>') };
const DORAHACKS = 'https://dorahacks.io/hackathon/delphi-agent-competition2/detail';
const DEVPOST = 'https://cognizant-agenticweb.devpost.com/';
const BINANCE = 'https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf';
const BINANCE_API = 'https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode=95f5dbe0ea674a48a739b59e046648bf';
const ETHGLOBAL = 'https://ethglobal.com/events/agenticmarkets';
const INK = 'https://docs.inkonchain.com/ink-builder-program/spark-program';
const XLAYER = 'https://web3.okx.com/xlayer/build-x-series';
const XLAYER_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLScyVnDmyzxRyBxszLUWbwV5kVbpmZJ3JS6oyOxqjALRvhR1kg/viewform';
const FE = 'https://fe-lang.org/contest/';
const FE_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSd2pqUkJzFpZMu5FVQP-NtetrIoB6nI-pHG1MLTOQhCpsLKqg/viewform';
const INK_OVERVIEW = 'https://docs.inkonchain.com/ink-builder-program/overview';
const INK_FORM = 'https://forms.inkonchain.com/spark-builder-program';

// ---- the reader (item 1, 4) ----

test('item 1: every fetch is a GET, never HEAD; the default user agent names EarnKit-verifier and links /docs#verifier', () => {
  const o = requestOptions({ url: new URL('https://example.org/x'), address: '93.184.216.34', family: 4, signal: new AbortController().signal });
  assert.equal(o.method, 'GET');
  assert.equal((o.headers as Record<string, string>)['user-agent'], VERIFIER_UA);
  assert.equal(VERIFIER_UA, 'Mozilla/5.0 (compatible; EarnKit-verifier/1; +https://earnkit.com/docs#verifier)');
  assert.match(VERIFIER_BROWSER_UA, /^Mozilla\/5\.0 \(Windows NT.*Chrome\/.*\(compatible; EarnKit-verifier\/1; \+https:\/\/earnkit\.com\/docs#verifier\)$/);
});

test('item 1: a readable page is read once, with the plain verifier user agent', async () => {
  const s = serve({ [FE]: { plain: html(page('fe-contest.html')) } });
  assert.match(await s.read(FE), /\$5,000 in prizes/);
  assert.deepEqual(s.requests, [{ url: FE, ua: VERIFIER_UA }]);
});

test('item 1: a bot wall (Devpost 403 Cloudflare, DoraHacks 405 AWS WAF, Binance 202 challenge) gets one more try as a browser-like EarnKit-verifier', async () => {
  const devpost = serve({ [DEVPOST]: { plain: { status: 403, body: page('devpost-cloudflare-403.html') }, browser: html('<html><body><p>$10,000 in prizes</p></body></html>') } });
  assert.match(await devpost.read(DEVPOST), /\$10,000 in prizes/);
  assert.deepEqual(devpost.requests.map((r) => r.ua), [VERIFIER_UA, VERIFIER_BROWSER_UA]);

  const dora = serve({ [DORAHACKS]: { plain: { status: 405, body: page('dorahacks-waf-405.html') } } });
  const err = await dora.read(DORAHACKS).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof PageBlockedError);
  assert.equal(err.status, 405);
  assert.equal(err.wall, 'Human Verification');
  assert.deepEqual(dora.requests.map((r) => r.ua), [VERIFIER_UA, VERIFIER_BROWSER_UA]);

  const binance = serve({ [BINANCE]: { plain: { status: 202, body: page('binance-waf-202.html') } } });
  await assert.rejects(binance.read(BINANCE), (e: unknown) => e instanceof PageBlockedError && e.status === 202 && e.wall === 'AWS WAF');
  // An empty 202 (what Binance sends some callers) is a challenge too.
  await assert.rejects(serve({ [BINANCE]: { plain: { status: 202, body: '' } } }).read(BINANCE), PageBlockedError);
});

test('item 4: the whole page is read (Ink Spark\'s amount sits past 64 KB), and a quote split across chunks, multibyte included, is found', async () => {
  const ink = page('ink-spark-program.html');
  assert.ok(Buffer.byteLength(ink.slice(0, ink.indexOf('500-20,000 USDC'))) > 65_536);
  const s = serve({ [INK]: { plain: html(ink) } }, 1_000);
  assert.ok((await s.read(INK)).includes('500-20,000 USDC'));
  // "€5,000" with the euro sign's three bytes cut between chunks.
  const body = `<html><body><p>${'x'.repeat(98)}€5,000 AI for good grant</p></body></html>`;
  const at = Buffer.from(body).indexOf(Buffer.from('€'));
  const split = serve({ 'https://soonami.io/venturethon': { plain: html(body) } }, at + 1);
  assert.ok((await split.read('https://soonami.io/venturethon')).includes('€5,000 AI for good grant'));
});

test('item 4: a page over the hard cap is cut there, never refused; 4 MB', async () => {
  assert.equal(PAGE_MAX_BYTES, 4 * 1024 * 1024);
  const s = serve({ 'https://big.example/': { plain: html(`<html><body><p>${'a'.repeat(5_000)}</p><p>Too far</p></body></html>`) } });
  const got = await safeReadPage('https://big.example/', { resolve: s.resolve, transport: s.transport, maxBytes: 2_000 });
  assert.equal(got.length, 2_000);
});

test('the reader keeps every guard: a private address and a redirect to another site are refused', async () => {
  const s = serve({ 'https://hop.example/': { plain: { status: 302, body: '', location: 'https://elsewhere.example/' } } });
  await assert.rejects(safeReadPage('https://hop.example/', s), /redirects to another site \(elsewhere\.example\)/);
  const inside: Resolver = async () => [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(safeReadPage('https://inside.example/', { resolve: inside, transport: s.transport }), SafeFetchError);
  for (const u of ['http://x.example/', 'https://x.example:8443/', 'https://93.184.216.34/']) await assert.rejects(safeReadPage(u, s), SafeFetchError);
});

test('a 5xx answer is a PageShellError carrying what it sent', async () => {
  const s = serve({ [ETHGLOBAL]: { plain: { status: 500, body: page('ethglobal-500-shell.html') } } });
  await assert.rejects(s.read(ETHGLOBAL), (e: unknown) => e instanceof PageShellError && e.status === 500 && e.html.includes('submissionDeadline'));
});

test('item 2: a 405 challenge is a wall to the link probe and the daily check, not a missing page; a plain 405 is still a 4xx', async () => {
  const s = serve({ [DORAHACKS]: { plain: { status: 405, body: page('dorahacks-waf-405.html') } }, 'https://plain.example/': { plain: { status: 405, body: 'Method Not Allowed' } } });
  await assert.rejects(safeProbe(DORAHACKS, s), (e: unknown) => e instanceof HttpStatusError && e.wall === 'Human Verification');
  assert.deepEqual(await probeLink(DORAHACKS, s), { ok: true });
  assert.deepEqual(await probeLink('https://plain.example/', s), { ok: false, why: '4xx' });
});

// ---- thin pages and platform sources (item 5) ----

test('item 5: ETHGlobal\'s 500 shell is read through its RSC data and its prizes page', async () => {
  const s = serve({
    [ETHGLOBAL]: { plain: { status: 500, body: page('ethglobal-500-shell.html') } },
    [`${ETHGLOBAL}/prizes`]: { plain: html(page('ethglobal-prizes.html')) },
  });
  const got = await readOfficial(ETHGLOBAL, s.read);
  assert.equal(got.kind, 'page');
  if (got.kind !== 'page') return;
  assert.match(got.thin!, /answered 500/);
  assert.ok(got.text.includes('2026-12-06T17:00:00.000Z'));
  assert.ok(got.text.includes('Hedera $15,000'));
});

test('item 5: a walled Binance announcement is read through the public CMS API by its article code', async () => {
  const s = serve({
    [BINANCE]: { plain: { status: 202, body: page('binance-waf-202.html') } },
    [BINANCE_API]: { plain: { status: 200, body: page('binance-article.json'), contentType: 'application/json' } },
  });
  const got = await readOfficial(BINANCE, s.read);
  assert.equal(got.kind, 'page');
  if (got.kind !== 'page') return;
  assert.ok(got.text.startsWith('Agent ID Hackathon:'));
  assert.ok(got.text.includes('valued at 60,000 USDC'));
  assert.ok(got.text.includes('2026-12-09 08:00 (UTC)'));
  assert.equal(s.requests.find((r) => r.url === BINANCE_API)?.ua, VERIFIER_UA);
});

test('item 5: embeddedText reads __NEXT_DATA__ and JSON-LD strings; never a script of another type', () => {
  const h = `<script id="__NEXT_DATA__" type="application/json">{"props":{"prize":"$20,000 in prizes","n":5}}</script>
    <script type="application/ld+json">{"@type":"Event","endDate":"Submit by May 1"}</script>
    <script>var x = "$999,999 in prizes";</script>`;
  const t = embeddedText(h);
  assert.ok(t.includes('$20,000 in prizes'));
  assert.ok(t.includes('Submit by May 1'));
  assert.ok(!t.includes('999,999'));
});

test('item 4: inline tags join their text as a browser shows it (Devpost\'s `$<span>10,000</span>`); hidden inline text still never counts; blocks still separate words', () => {
  // Devpost's markup, as served on Nov 24, 2026.
  const devpost = '<strong><span data-currency="true">$<span data-currency-value>10,000</span></span></strong> in cash';
  assert.equal(pageText(devpost), '$10,000 in cash');
  assert.equal(pageText('<p>Win <span style="display:none">$999,999</span><b>$5,000</b></p>'), 'Win $5,000');
  assert.equal(pageText('<div>Prizes</div><div>$5,000</div><p>a<br>b</p>'), 'Prizes $5,000 a b');
});

// ---- shorteners (item 3) ----

test('item 3: forms.gle expands to its Google Form (usp dropped); one landing elsewhere is refused; other links are unchanged', async () => {
  const hops: Record<string, string> = {
    'https://forms.gle/EoDNbxQ65dev1wFd9': `${XLAYER_FORM}?usp=send_form`,
    'https://forms.gle/evil': 'https://evil.example/forms/x',
  };
  const next = async (u: string) => hops[u] ?? Promise.reject(new Error('no redirect'));
  assert.equal(await expandShortLink('https://forms.gle/EoDNbxQ65dev1wFd9', next), XLAYER_FORM);
  await assert.rejects(expandShortLink('https://forms.gle/evil', next), /forms\.gle link does not lead to a form \(it goes to evil\.example\)/);
  assert.equal(await expandShortLink('https://bit.ly/abc', next), 'https://bit.ly/abc');
  assert.equal(await expandShortLink(XLAYER_FORM, next), XLAYER_FORM);
});

// ---- the write route, Growth's programs (items 2-5) ----

const TOKEN = 'r'.repeat(40);
const TODAY = new Date().toISOString().slice(0, 10);
beforeEach(() => {
  process.env.EARNKIT_PROGRAMS_TOKEN = TOKEN;
});
afterEach(() => {
  delete process.env.EARNKIT_PROGRAMS_TOKEN;
  delete process.env.EARNKIT_FLAGS;
});

/** A program as Growth wrote it; reward and summary state the money (`$<pool or max> in prizes` unless given). */
const program = (id: string, over: Record<string, unknown>) => ({
  id,
  organizer: `Org ${id}`,
  title: 'Builder Challenge',
  description: 'A challenge for builders.',
  reward: `$${Number(over.pool_usd ?? over.max_award_usd).toLocaleString('en-US')} in prizes`,
  summary: `$${Number(over.pool_usd ?? over.max_award_usd).toLocaleString('en-US')} in prizes`,
  starts_at: null,
  ends_at: '2027-12-01T00:00:00Z',
  status: 'active',
  verified_at: TODAY,
  existing_work: 'allowed',
  setup: [],
  each_time: [],
  chains: [],
  any_chain: true,
  rules: [],
  category: 'hackathon',
  needs_repo: false,
  submission_requirements: [{ key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' }],
  ...over,
});

const FOUND = { found_by_query: 'G-A rerun', found_by_source: 'v38-acceptance' };
const write = async (body: Record<string, unknown>, site: Site, redirects: Record<string, string> = {}) => {
  const s = serve(site);
  const res = await writePost(
    new Request('https://earnkit.com/api/programs/write', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', ...FOUND, ...body }),
    }),
    { probe: (u) => safeProbe(u, s), readPage: s.read, redirect: async (u) => redirects[u] ?? Promise.reject(new Error('no redirect')) },
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

test('item 2: Delphi on DoraHacks, walled after both tries, goes live information only with the blocked reason', async () => {
  const out = await write(
    {
      amount_quote: '$7,250 in prizes',
      deadline_quote: '11 December: Competition closes',
      program: program('ga-delphi', { source_url: DORAHACKS, submission_url: DORAHACKS, pool_usd: 7250, max_award_usd: 3000, ends_at: '2026-12-11T17:00:00Z' }),
    },
    { [DORAHACKS]: { plain: { status: 405, body: page('dorahacks-waf-405.html') } } },
  );
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.info_only, true);
  assert.equal(out.json.organizer, 'new');
  assert.match(String(out.json.reason), new RegExp(`information only: ${BLOCKED_REASON}`));
  const live = (await getProgram('ga-delphi'))!.file;
  assert.equal(live.info_only, true);
  assert.equal(live.submit, 'builder');
});

test('item 2: a Devpost page walled after both tries goes live information only', async () => {
  const out = await write(
    { amount_quote: '$10,000 in prizes', deadline_quote: 'January 11, 2027 at 16:00 UTC', program: program('ga-agenticweb', { source_url: DEVPOST, submission_url: DEVPOST, pool_usd: 10000, ends_at: '2027-01-11T16:00:00Z' }) },
    { [DEVPOST]: { plain: { status: 403, body: page('devpost-cloudflare-403.html') } } },
  );
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.info_only, true);
});

test('item 2: a walled page on an unknown domain is refused with a reason; on a domain the organizer\'s tracked handle names it goes live information only', async () => {
  const url = 'https://walled-org.xyz/grants';
  const site: Site = { [url]: { plain: { status: 403, body: page('devpost-cloudflare-403.html') } } };
  const body = (handle?: string) => ({
    amount_quote: 'Up to $10,000',
    deadline_quote: 'Closes December 1, 2027',
    ...(handle && { handle }),
    program: program('ga-walled', { source_url: url, submission_url: url, max_award_usd: 10000 }),
  });
  const no = await write(body(), site);
  assert.equal(no.status, 400);
  assert.match(String((no.json.problems as string[])[0]), /^official page: https:\/\/walled-org\.xyz\/grants blocked our reader \(Cloudflare\), and it is neither on a known program platform nor on a domain tied to Org ga-walled; .*track action add_private/);
  assert.equal(await getProgram('ga-walled'), null);

  await sql()`INSERT INTO tracked_handles (handle, profile_domain) VALUES ('walledorg', 'walled-org.xyz') ON CONFLICT (handle) DO UPDATE SET profile_domain = EXCLUDED.profile_domain`;
  const yes = await write(body('@walledorg'), site);
  assert.equal(yes.status, 200, JSON.stringify(yes.json));
  assert.equal(yes.json.organizer, 'confirmed');
  assert.equal(yes.json.info_only, true);
});

test('A1 still holds: a readable page with a wrong quote is refused (Fe, "$999,999 in prizes"); the right quotes go live', async () => {
  const fe = (amount: string) => ({
    amount_quote: amount,
    deadline_quote: 'Submit by November 24',
    program: program('ga-fe', {
      organizer: 'Argot Collective',
      source_url: FE,
      submission_url: FE_FORM,
      pool_usd: 5000,
      max_award_usd: 2500,
      ends_at: `${new Date().getUTCFullYear() + 1}-11-24T23:59:00Z`,
    }),
  });
  const site: Site = { [FE]: { plain: html(page('fe-contest.html')) }, [FE_FORM]: LOADS };
  const wrong = await write(fe('$999,999 in prizes'), site);
  assert.equal(wrong.status, 400);
  assert.deepEqual(wrong.json.problems, ['amount_quote: not on the official page word for word']);
  assert.equal(await getProgram('ga-fe'), null);
  const right = await write(fe('$5,000 in prizes'), site);
  assert.equal(right.status, 200, JSON.stringify(right.json));
  assert.equal(right.json.info_only, false);
});

test('item 3: X Layer\'s page links forms.gle: the expanded form counts as on the page, and a forms.gle submission_url is stored as its form', async () => {
  const site: Site = { [XLAYER]: { plain: html(page('xlayer-build-x-series.html')) }, [XLAYER_FORM]: LOADS };
  const redirects = { 'https://forms.gle/EoDNbxQ65dev1wFd9': `${XLAYER_FORM}?usp=send_form` };
  const body = (submission: string) => ({
    amount_quote: '100,000 USDT prize pool',
    deadline_quote: 'December 7, 2026, at 23:59 UTC',
    program: program('ga-xlayer', { source_url: XLAYER, submission_url: submission, form: { platform: 'google', url: submission }, pool_usd: 100000, max_award_usd: 20000, ends_at: '2026-12-07T23:59:00Z' }),
  });
  const sent = await write(body(XLAYER_FORM), site, redirects);
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.info_only, false);

  const short = await write(body('https://forms.gle/EoDNbxQ65dev1wFd9'), site, redirects);
  assert.equal(short.status, 200, JSON.stringify(short.json));
  const live = (await getProgram('ga-xlayer'))!.file;
  assert.equal(live.submission_url, XLAYER_FORM);
  assert.equal(live.form?.url, XLAYER_FORM);
  assert.equal(live.info_only, undefined);

  const bad = await write(body('https://forms.gle/nowhere'), site, { 'https://forms.gle/nowhere': 'https://evil.example/x' });
  assert.equal(bad.status, 400);
  assert.match(String((bad.json.problems as string[])[0]), /^submission_url: forms\.gle link does not lead to a form/);
});

test('item 4: Ink Spark\'s own page (amounts past 64 KB) passes as the official page, and its form is linked there', async () => {
  const out = await write(
    {
      amount_quote: '500-20,000 USDC',
      deadline_quote: 'The team reviews applications in rolling batches',
      program: program('ga-ink', {
        category: 'grant',
        source_url: INK_OVERVIEW,
        official_url: INK,
        submission_url: INK_FORM,
        max_award_usd: 20000,
        min_award_usd: 500,
        ends_at: null,
        reward: '500 USDC to 20,000 USDC per project',
        summary: '500 USDC to 20,000 USDC, rolling review',
      }),
    },
    { [INK]: { plain: html(page('ink-spark-program.html')) }, [INK_OVERVIEW]: LOADS, [INK_FORM]: LOADS },
  );
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.info_only, false);
});

test('item 5: ETHGlobal Agentic Markets (500 shell) and the Binance Agent ID announcement (WAF 202) go live from their platform sources', async () => {
  const eth = await write(
    {
      amount_quote: 'Hedera $15,000',
      deadline_quote: '2026-12-06T17:00:00.000Z',
      program: program('ga-ethglobal', { source_url: ETHGLOBAL, submission_url: ETHGLOBAL, pool_usd: 25000, max_award_usd: 15000, ends_at: '2026-12-06T17:00:00Z' }),
    },
    { [ETHGLOBAL]: { plain: { status: 500, body: page('ethglobal-500-shell.html') } }, [`${ETHGLOBAL}/prizes`]: { plain: html(page('ethglobal-prizes.html')) } },
  );
  assert.equal(eth.status, 200, JSON.stringify(eth.json));

  const bn = await write(
    {
      amount_quote: '60,000 USDC',
      deadline_quote: '2026-12-09 08:00 (UTC)',
      program: program('ga-binance', { source_url: BINANCE, submission_url: BINANCE, pool_usd: 60000, ends_at: '2026-12-09T08:00:00Z' }),
    },
    {
      [BINANCE]: { plain: { status: 202, body: page('binance-waf-202.html') } },
      [BINANCE_API]: { plain: { status: 200, body: page('binance-article.json'), contentType: 'application/json' } },
    },
  );
  assert.equal(bn.status, 200, JSON.stringify(bn.json));
  assert.equal(bn.json.info_only, false);
});

test('item 5: a shell whose quotes are not in it is refused with the private-row hint; a short static page is not', async () => {
  const url = 'https://shell.example.org/event';
  const out = await write(
    { amount_quote: '$9,000 in prizes', deadline_quote: 'Closes December 1, 2027', program: program('ga-shell', { source_url: url, submission_url: url, pool_usd: 9000 }) },
    { [url]: { plain: { status: 500, body: '<html><head><script src="/a.js"></script></head><body><div id="root"></div></body></html>' } } },
  );
  assert.equal(out.status, 400);
  const problems = out.json.problems as string[];
  assert.equal(problems[0], 'amount_quote: not on the official page word for word');
  assert.match(problems.at(-1)!, /^official page: https:\/\/shell\.example\.org\/event answered 500 with an error shell, .*save it for the builder as a private row \(track action add_private\)$/);
});
