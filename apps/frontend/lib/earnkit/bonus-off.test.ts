import './fixtures/no-network-checks';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { bonusOn, bookingFor } from './bonus-rounds';
import { feeTable } from './policy';
import { createMcpServer, toolDescriptions } from './mcp';
import { statsLine } from './landing';
import { REPO_HELD, enteredText } from './entry-text';
import TermsPage, { generateMetadata } from '../../app/terms/page';
import { GET as llms } from '../../app/llms.txt/route';

// The components are compiled with the classic JSX runtime here (as feed.test.ts).
(globalThis as { React?: typeof React }).React = React;
// Test hygiene (plan): flag off is production, v2.12.2 with the score on.
process.env.EARNKIT_BUILDER_SCORE = 'on';
const on = () => { process.env.EARNKIT_BUILDER_SCORE = 'on'; process.env.EARNKIT_BENCH = 'on'; };
const off = () => { delete process.env.EARNKIT_BENCH; };

/** Every tool as an MCP client lists it: names, descriptions and every field's description. */
async function listedTools() {
  const server = createMcpServer({ installationId: 1 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}
const contractsField = async () => {
  const confirm = (await listedTools()).find((t) => t.name === 'confirm')!;
  return (confirm.inputSchema.properties as Record<string, { description?: string }>).contracts.description ?? '';
};
const BONUS_SENTENCE = /Their real users count toward the builder bonus once verified/;

test('13.1 bonusOn is false under the flag: every program, so every deposit books to the Safe; flag off: today', () => {
  const p = { status: 'active', builder_bonus: true, campaign: null, starts_at: new Date('2026-10-01'), ends_at: new Date('2026-12-01') };
  off();
  assert.equal(bonusOn(p), true);
  assert.equal(bookingFor(p as never, new Date('2026-10-15')).destination, 'round');
  on();
  try {
    assert.equal(bonusOn(p), false);
    assert.deepEqual(bookingFor(p as never, new Date('2026-10-15')), { destination: 'safe', reason: 'builder bonus off' });
  } finally { off(); }
});

test('13.2 the terms\' fee table: 40 / 10 / 50 under the flag, no builder bonus row or paragraph; flag off: today\'s', () => {
  off();
  assert.ok(feeTable().some(([k]) => k === 'Builder bonus'));
  assert.match(renderToStaticMarkup(React.createElement(TermsPage)), /builder bonus/i);
  assert.match(generateMetadata().description, /builder bonus/);
  on();
  try {
    assert.deepEqual(feeTable(), [['Your project', '40%'], ['MINI buyback', '10%'], ['EarnKit', '50%']]);
    const terms = renderToStaticMarkup(React.createElement(TermsPage));
    assert.doesNotMatch(terms, /bonus/i);
    assert.match(terms, /Coins launched before this change keep the split they launched with\./);
    assert.doesNotMatch(generateMetadata().description, /bonus/i);
  } finally { off(); }
});

test('13.3 no tool description, field description or llms.txt line mentions the bonus under the flag; flag off: today\'s', async () => {
  on();
  try {
    for (const d of Object.values(toolDescriptions(true, true))) assert.doesNotMatch(d, /bonus/i, d);
    // F25: confirm's `contracts` field keeps its first sentence, never the bonus one.
    const contracts = await contractsField();
    assert.match(contracts, /the project's Base contracts \(up to 5\)\.$/);
    assert.doesNotMatch(JSON.stringify(await listedTools()), /bonus/i);
    const body = await (await llms()).text();
    assert.doesNotMatch(body, /bonus/i);
    assert.match(body, /40% of trading fees/);
    assert.match(body, /## The Bench/);
  } finally { off(); }
  // Flag off: llms.txt byte for byte today's, and confirm's `contracts` still says the bonus sentence.
  assert.equal(await (await llms()).text(), readFileSync(new URL('./llms/v212.txt', import.meta.url), 'utf8'));
  assert.match(await contractsField(), BONUS_SENTENCE);
});

test('13.4 the bonus pages are 404 under the flag; the sitemap lists no round', async () => {
  for (const f of ['../../app/bonus/[round]/page.tsx', '../../app/admin/bonus/[round]/page.tsx'])
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /if \(benchEnabled\(\)\) notFound\(\)/, f);
  assert.match(readFileSync(new URL('../../app/sitemap.ts', import.meta.url), 'utf8'), /!benchEnabled\(\)/);
});

test('13.5 sponsor campaigns are untouched: no campaign file imports the Bench switch', () => {
  for (const f of ['./campaigns.ts', './sponsor-rules.ts', './escrow.ts'])
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /benchEnabled/, f);
});

test('13.5b the hero stats line and the held-repo line say no bonus under the flag; flag off: today\'s', () => {
  const stats = { installs: 312, bonus_paid_eth: 0.42 } as Parameters<typeof statsLine>[0];
  const held = { programTitle: 'Arc Microgrants', coin: { status: 'skipped' as const }, bonus: null, repoHeld: true };
  off();
  assert.equal(statsLine(stats), '312 agents earning · 0.42 ETH builder bonus paid');
  assert.equal(enteredText(held), `Entered in Arc Microgrants. ${REPO_HELD}`);
  on();
  try {
    assert.equal(statsLine(stats), '312 agents earning');
    assert.equal(statsLine({ ...stats, installs: 3 }), null);
    assert.equal(enteredText(held), 'Entered in Arc Microgrants. Another entry of this repo already holds its token here.');
  } finally { off(); }
});
