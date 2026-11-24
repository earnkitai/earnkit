/**
 * No token wording (v3.8 first ship, plan section 23.3): EarnKit never launches, offers or promises a token, an airdrop
 * or $EARN. Two checks:
 *
 * 1. The launch wording (`LAUNCH`) appears in no file of the product: the code and its frozen replies (every source and
 *    test under lib/, app/, scripts/ and db/), README.md and integrations/**. The allowlist is the OLD_TOOLS refusal
 *    of `launch_token` (kept only so an old call is refused) and third-party data (recorded repos, a starter template's
 *    file path).
 * 2. The bare word token appears in no text an agent or a visitor reads (site copy, llms.txt, the server instructions
 *    and every tool's description and input schema, README.md, integrations/**) except as an OAuth, bearer, CSRF,
 *    access or GitHub token.
 *
 * Program records (programs/*.json) are the programs' own words and are not scanned.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sql } from './db';
import { mcpInstructions, mcpListTools } from './fixtures/mcp-call';
import * as copy from './site-copy';
import { LLMS_TEXT } from './llms';

after(() => sql().end());

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FRONTEND = join(ROOT, 'apps', 'frontend');

const LAUNCH =
  /\$EARN\b|\bairdrop|\btoken[\s_-]*(?:launch|offer|sale|drop|reward|allocation|bonus|holder|ticker)|\blaunch\w*?[\s_-]+(?:(?:a|an|the|your|their|its|own|my|new)[\s_-]+)*tokens?\b|\btokenomics\b|\bmeme[\s-]?coins?\b|\bclanker\b|\bfee locker\b|\btrading fees?\b/gi;

/** Launch wording that may stay: [file relative to the repo, the exact match]. Keep this short. */
const LAUNCH_ALLOWED: [string, string][] = [
  // OLD_TOOLS keeps the old tool's name only so an old call is refused, and the route test pins that refusal.
  ['apps/frontend/lib/v5/old-tools.ts', 'launch_token'],
  ['apps/frontend/lib/v5/mcp-route.test.ts', 'launch_token'],
  // Third-party data: a starter template's file path (`app/components/actions/airdrop-card.tsx`) that code.ts uses to
  // tell boilerplate from a builder's own code. Never shown.
  ['apps/frontend/lib/v6/boilerplates.json', 'airdrop'],
];
/** Whole folders of third-party data recorded as fixtures (public repos' files, as GitHub served them). */
const THIRD_PARTY = ['apps/frontend/lib/v5/fixtures/repos/'];
const SELF = 'apps/frontend/lib/v5/no-token.test.ts';

const TOKEN = /\btokens?\b/gi;
/** The only kinds of token text may name: credentials, never a coin. */
const TOKEN_ALLOWED = /\b(?:oauth|bearer|csrf|access|refresh|form|session|github|api|auth(?:orization)?)[\s-]+tokens?\b/gi;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|js|json|md|txt|sql)$/.test(name)) out.push(p);
  }
  return out;
}

const PRODUCT = [
  ...['lib', 'app', 'scripts', 'db'].flatMap((d) => walk(join(FRONTEND, d))),
  join(ROOT, 'README.md'),
  ...walk(join(ROOT, 'integrations')),
].map((p) => relative(ROOT, p));

/** The launch matches in `text` not allowed for `file`. Pure. */
function launchHits(file: string, text: string): string[] {
  return [...text.matchAll(LAUNCH)]
    .map((m) => m[0])
    .filter((hit) => !LAUNCH_ALLOWED.some(([f, a]) => f === file && a === hit));
}

/** The bare token words left in `text` once the credential phrases are taken out. Pure. */
const tokenHits = (text: string): string[] => [...text.replace(TOKEN_ALLOWED, '').matchAll(TOKEN)].map((m) => m[0]);

test('LAUNCH catches the token-launch wording and lets credentials and look-alikes through', () => {
  const caught = ['Launch your token today', 'a token launch', 'Want a token offer?', 'claim $EARN', 'the airdrop', 'Airdrops for builders',
    'launch_token', 'token sale', 'launched a new token', 'You keep 40% of trading fees', 'memecoin', 'via Clanker', 'tokenomics'];
  for (const s of caught) assert.ok(launchHits('x', s).length > 0, s);
  const passed = ['the OAuth token', 'a bearer token', 'EARNKIT_PROGRAMS_TOKEN', 'TokenFi Inc.', 'launch the app', 'launched on mainnet',
    'earned', 'Token-2022 program', 'the access token expires'];
  for (const s of passed) assert.deepEqual(launchHits('x', s), [], s);
});

test('the bare word check passes credential phrases only', () => {
  assert.deepEqual(tokenHits('signs OAuth tokens, a bearer token, the CSRF token, an access token, GITHUB_TOKEN'), []);
  assert.deepEqual(tokenHits('your token goes live'), ['token']);
  assert.deepEqual(tokenHits('a token for your entry, and an OAuth token'), ['token']);
});

test('no launch, offer, $EARN or airdrop wording in the code, its frozen replies, README.md or integrations/**', () => {
  assert.ok(PRODUCT.length > 200, `only ${PRODUCT.length} files read`);
  assert.ok(PRODUCT.includes('README.md') && PRODUCT.some((p) => p.startsWith('integrations/')));
  const bad: string[] = [];
  for (const file of PRODUCT) {
    if (file === SELF || THIRD_PARTY.some((d) => file.startsWith(d))) continue;
    for (const hit of launchHits(file, readFileSync(join(ROOT, file), 'utf8'))) bad.push(`${file}: ${hit}`);
  }
  assert.deepEqual(bad, []);
});

test('the allowlist is used: each entry still matches, so a stale one is removed', () => {
  for (const [file, hit] of LAUNCH_ALLOWED) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    assert.ok([...text.matchAll(LAUNCH)].some((m) => m[0] === hit), `${file}: ${hit} no longer appears`);
  }
});

test('no bare token in site copy, llms.txt, README.md or integrations/**', () => {
  const texts: [string, string][] = [
    ...Object.entries(copy).map(([k, v]) => [`site-copy ${k}`, JSON.stringify(v) ?? ''] as [string, string]),
    ['llms.txt', LLMS_TEXT],
    ['README.md', readFileSync(join(ROOT, 'README.md'), 'utf8')],
    ...walk(join(ROOT, 'integrations')).map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')] as [string, string]),
  ];
  const bad = texts.flatMap(([name, t]) => tokenHits(t).map((h) => `${name}: ${h}`));
  assert.deepEqual(bad, []);
});

test('no token wording in the server instructions or any tool description and input schema, as an agent reads them', async () => {
  const [r] = await sql()`INSERT INTO installations (token_hash) VALUES (${'no-token-' + Math.random()}) RETURNING id`;
  const ctx = { installationId: r.id as number, builderId: null, now: new Date('2026-11-24T12:00:00Z'), gh: (async () => new Response('', { status: 404 })) as typeof fetch };
  const tools = await mcpListTools(ctx);
  assert.ok(tools.length >= 4);
  const text = JSON.stringify(tools) + (await mcpInstructions(ctx));
  assert.deepEqual(tokenHits(text), []);
  assert.deepEqual(launchHits('tools/list', text), []);
});
