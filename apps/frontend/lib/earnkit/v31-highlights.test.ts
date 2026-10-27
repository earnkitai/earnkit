import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HighlightsCard from '../../app/[handle]/site/HighlightsCard';
import { sql } from './db';
import { PRIVATE_NAME } from './page-data';
import { claimContract } from './sources';
import { HIGHLIGHTS_MAX, UPTIME_MIN_READS, consistencyItem, contractsOf, explorerHref, githubRepoHref, liveSub, productsOf, siteHref } from './site-data';
import { backfillContractOrigins, ORIGIN_RETRY_MS } from './contract-origins';

/**
 * v3.1 Highlights redesign: the pure rules (uptime, proof links, contracts, products, consistency), the card's links, the
 * stored and backfilled deploy time. v3.1 Highlights competence (2026-10-25): the Builder Code, commit count and wallet
 * rows are gone.
 */

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date('2026-10-21T12:00:00Z');
test('liveSub: "Up N of the last D days checked" over the days EarnKit read (from 7), else since the first up day', () => {
  assert.equal(UPTIME_MIN_READS, 7);
  assert.equal(liveSub({ checked: 30, up: 28, first_up: '2026-01-04' }), 'Up 28 of the last 30 days checked');
  assert.equal(liveSub({ checked: 7, up: 7, first_up: '2026-10-12' }), 'Up 7 of the last 7 days checked');
  assert.equal(liveSub({ checked: 6, up: 6, first_up: '2026-10-12' }), 'Since Oct 2026');
  assert.equal(liveSub({ checked: 0, up: 0, first_up: '2025-03-01' }), 'Since Mar 2025');
});

test('proof links: https sites only, the chain\'s explorer for an address only, GitHub repo paths escaped per segment', () => {
  assert.equal(siteHref('https://www.kit.example'), 'https://www.kit.example');
  assert.equal(siteHref('https://kit.example/'), 'https://kit.example');
  assert.equal(siteHref('https://BÜCHER.example'), 'https://xn--bcher-kva.example');
  for (const bad of ['http://kit.example', 'javascript:alert(1)', 'kit.example', 'https://user:pw@kit.example', 'https://exa mple.com', '"><script>'])
    assert.equal(siteHref(bad), null, bad);
  const a = `0x${'AB'.repeat(20)}`;
  assert.equal(explorerHref('base', a), `https://basescan.org/address/0x${'ab'.repeat(20)}`);
  assert.equal(explorerHref('ethereum', a), `https://etherscan.io/address/0x${'ab'.repeat(20)}`);
  assert.equal(explorerHref('arbitrum', a), `https://arbiscan.io/address/0x${'ab'.repeat(20)}`);
  assert.equal(explorerHref('optimism', a), `https://optimistic.etherscan.io/address/0x${'ab'.repeat(20)}`);
  assert.equal(explorerHref('polygon', a), `https://polygonscan.com/address/0x${'ab'.repeat(20)}`);
  assert.equal(explorerHref('arc', a), null, 'not a wallet chain');
  for (const bad of ['0x123', `0x${'g'.repeat(40)}`, `${a}/../x`, `javascript:${a}`]) assert.equal(explorerHref('base', bad), null, bad);
  assert.equal(githubRepoHref('Lee/Tip.Jar'), 'https://github.com/lee/tip.jar');
  assert.equal(githubRepoHref('not a repo'), null);
  assert.equal(githubRepoHref('a/b/c'), null);
});

test('contractsOf: "N contracts on <chain>" on one chain, "N contracts on K chains" on several; since the earliest dated, linked to it; never a wallet', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((x) => `0x${x.repeat(40)}`);
  assert.equal(contractsOf([]), null);
  assert.deepEqual(contractsOf([{ chain: 'base', address: a, at: new Date('2025-06-10T00:00:00Z') }]), {
    icon: 'contract', title: '1 contract on Base', sub: 'Since Jun 2025', href: `https://basescan.org/address/${a}`,
  });
  assert.deepEqual(contractsOf([
    { chain: 'arbitrum', address: a, at: '2025-02-01T00:00:00Z' }, { chain: 'arbitrum', address: b, at: null }, { chain: 'arbitrum', address: c, at: '2024-11-01T00:00:00Z' },
  ]), { icon: 'contract', title: '3 contracts on Arbitrum', sub: 'Since Nov 2024', href: `https://arbiscan.io/address/${c}` });
  assert.deepEqual(contractsOf([
    { chain: 'base', address: a, at: '2025-02-01T00:00:00Z' }, { chain: 'ethereum', address: b, at: '2023-07-01T00:00:00Z' }, { chain: 'polygon', address: c, at: '2025-03-01T00:00:00Z' },
  ]), { icon: 'contract', title: '3 contracts on 3 chains', sub: 'Since Jul 2023', href: `https://etherscan.io/address/${b}` });
  assert.deepEqual(contractsOf([{ chain: 'optimism', address: a, at: null }]), { icon: 'contract', title: '1 contract on Optimism', sub: '', href: `https://optimistic.etherscan.io/address/${a}` });
  const many = Array.from({ length: 1200 }, (_, i) => ({ chain: 'base', address: `0x${i.toString(16).padStart(40, '0')}`, at: null }));
  assert.equal(contractsOf(many)?.title, '1,200 contracts on Base');
  assert.equal(contractsOf([{ chain: 'arc', address: a, at: null }]), null, 'a chain outside WALLET_CHAINS never counts');
});

test('productsOf: from 2 hosts, oldest first, at most 3 named then "and N more", linked to the oldest', () => {
  const p = (host: string) => ({ host, ref: `https://${host}` });
  assert.equal(productsOf([]), null);
  assert.equal(productsOf([p('kit.example')]), null, 'one product is the live item');
  assert.deepEqual(productsOf([p('kit.example'), p('tip.example')]), { icon: 'products', title: 'Shipped 2 products', sub: 'kit.example, tip.example', href: 'https://kit.example' });
  assert.equal(productsOf([p('a.example'), p('b.example'), p('c.example')])?.sub, 'a.example, b.example, c.example');
  assert.deepEqual(productsOf(['a', 'b', 'c', 'd', 'e'].map((x) => p(`${x}.example`))), {
    icon: 'products', title: 'Shipped 5 products', sub: 'a.example, b.example, c.example and 2 more', href: 'https://a.example',
  });
});

test('consistencyItem: the weeks with code of the 52, from one; "Building <name> since" from the repo\'s created_at; no name when private; empty sub when unknown', () => {
  const href = 'https://github.com/lee/kit';
  const grid = (on: number) => Array.from({ length: 52 }, (_, i) => ({ on: i < on }));
  assert.deepEqual(consistencyItem('Kit', grid(38), { created_at: '2024-02-10T00:00:00Z' }, href, NOW), {
    icon: 'consistency', title: 'Shipped in 38 of the last 52 weeks', sub: 'Building Kit since Feb 2024', href,
  });
  assert.deepEqual(consistencyItem('Kit', grid(1), { created_at: '2026-06-01T00:00:00Z' }, null, NOW), { icon: 'consistency', title: 'Shipped in 1 of the last 52 weeks', sub: 'Building Kit since Jun 2026' });
  assert.equal(consistencyItem(PRIVATE_NAME, grid(4), { created_at: '2026-06-01T00:00:00Z' }, null, NOW)?.sub, 'Building since Jun 2026');
  assert.equal(consistencyItem('Kit', grid(4), null, null, NOW)?.sub, '', 'no reading: no sub line');
  assert.equal(consistencyItem('Kit', grid(4), { created_at: 'soon' }, null, NOW)?.sub, '');
  assert.equal(consistencyItem('Kit', grid(4), { created_at: '2026-11-01T00:00:00Z' }, null, NOW)?.sub, '', 'never a future date');
  assert.equal(consistencyItem('Kit', grid(0), { created_at: '2024-02-10T00:00:00Z' }, href, NOW), null, 'no week with code: no item');
  assert.equal(HIGHLIGHTS_MAX, 5);
});

test('HighlightsCard: another site opens in a new tab (noopener noreferrer) with the arrow; a program guide in the same tab; an unlinked item is no link; no empty sub line', () => {
  (globalThis as { React?: typeof React }).React = React;
  const html = renderToStaticMarkup(React.createElement(HighlightsCard, {
    items: [
      { icon: 'live', title: 'Live at kit.example', sub: 'Up 29 of the last 30 days checked', href: 'https://kit.example/?a="b"' },
      { icon: 'products', title: 'Shipped 2 products', sub: 'kit.example, tip.example' },
      { icon: 'users', title: 'Used by 240 people in the last 30 days', sub: '25% came back' },
      { icon: 'consistency', title: 'Shipped in 4 of the last 52 weeks', sub: '' },
      { icon: 'won', title: 'Won X', sub: 'Oct 2026', href: '/programs/x' },
      { icon: 'experience', title: 'Writing code since 2019', sub: 'On GitHub since Mar 2019' },
    ],
  }));
  const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
  assert.equal(links.length, 2);
  assert.match(links[0], /target="_blank"/);
  assert.match(links[0], /rel="noopener noreferrer"/);
  assert.match(links[0], /href="https:\/\/kit.example\/\?a=&quot;b&quot;"/, 'React escapes the href');
  assert.doesNotMatch(links[1], /target=|rel=/, 'a program guide is EarnKit\'s own page: the same tab');
  assert.equal((html.match(/opens in a new tab/g) ?? []).length, 1);
  assert.equal((html.match(/M7 7h10v10/g) ?? []).length, 1, 'the new-tab arrow on the external link only');
  assert.equal((html.match(/m9 18 6-6-6-6/g) ?? []).length, 1, 'a chevron on the guide link');
  for (const l of links) assert.match(l, /hover:bg-s-panel-hover hover:ring-s-line/, 'a visible, subtle hover');
  assert.ok(html.includes('Shipped 2 products'));
  // v3.1 Highlights competence: the new rows' lucide icons (layers, calendar-check, terminal).
  for (const d of ['m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65', 'm9 16 2 2 4-4', 'm4 17 6-6-6-6']) assert.ok(html.includes(`d="${d}"`), d);
  // v3.1 Used by: lucide users.
  assert.ok(html.includes('d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"') && html.includes('Used by 240 people in the last 30 days'));
  assert.ok(!/<span class="text-\[13px\] text-s-muted"><\/span>/.test(html), 'an empty sub is not rendered');
  assert.equal(renderToStaticMarkup(React.createElement(HighlightsCard, { items: [] })), '');
});

test('backfillContractOrigins: dates verified Base contracts with none from Blockscout, each asked once (again only after a week when it had no time), at most `limit`', db, async () => {
  const builderId = 800_000 + Math.floor(Math.random() * 90_000);
  const ref = () => `base:0x${randomBytes(20).toString('hex')}`;
  const [dated, undated, blank, arc, proposed, has] = [ref(), ref(), ref(), `arc:0x${randomBytes(20).toString('hex')}`, ref(), ref()];
  await sql()`INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proof, proposed_by, deployed_at) VALUES
    (${builderId}, 'contract', ${dated}, 'k', 'verified', 'deployer', 'server', null),
    (${builderId}, 'contract', ${undated}, 'k', 'verified', 'deployer', 'server', null),
    (${builderId}, 'contract', ${blank}, 'k', 'verified', 'deployer', 'server', null),
    (${builderId}, 'contract', ${arc}, 'k', 'verified', 'deployer', 'server', null),
    (${builderId}, 'contract', ${proposed}, 'k', 'proposed', null, 'server', null),
    (${builderId}, 'contract', ${has}, 'k', 'verified', 'deployer', 'server', '2024-01-01T00:00:00Z')`;
  const asked: string[] = [];
  // A failed read is logged (by source id, never the address); captured here so the run stays quiet.
  const logs: unknown[][] = [];
  const log = console.error;
  console.error = (...a: unknown[]) => void logs.push(a);
  after(() => {
    console.error = log;
  });
  const origin = async (r: string) => {
    asked.push(r);
    if (r === undated) throw new Error('blockscout 500');
    return { deployer: null, created_at: r === dated ? '2025-06-10T08:00:00Z' : null };
  };
  assert.deepEqual(await backfillContractOrigins(NOW, { origin, only: [builderId], limit: 2 }), { due: 2, dated: 1 });
  assert.deepEqual(await backfillContractOrigins(NOW, { origin, only: [builderId] }), { due: 1, dated: 0 });
  assert.deepEqual(asked.sort(), [blank, dated, undated].sort(), 'never Arc, a proposed one or one already dated; each once');
  const at = async (r: string) => (await sql()<{ at: Date | null }[]>`SELECT deployed_at AS at FROM builder_sources WHERE builder_id = ${builderId} AND ref = ${r}`)[0].at;
  assert.equal((await at(dated))?.toISOString(), '2025-06-10T08:00:00.000Z');
  assert.equal(await at(undated), null);
  assert.equal((await at(has))?.toISOString(), '2024-01-01T00:00:00.000Z');
  // The same run again: nothing is asked; a week later the two without a time are asked again.
  assert.deepEqual(await backfillContractOrigins(new Date(NOW.getTime() + 3_600_000), { origin, only: [builderId] }), { due: 0, dated: 0 });
  assert.deepEqual(await backfillContractOrigins(new Date(NOW.getTime() + ORIGIN_RETRY_MS), { origin, only: [builderId] }), { due: 2, dated: 0 });
  console.error = log;
  assert.equal(logs.length, 2);
  assert.ok(logs.every((l) => l[0] === '[origins] read' && !String(l).includes(undated.slice(5))));
  await sql()`DELETE FROM builder_sources WHERE builder_id = ${builderId}`;
});

test('claimContract keeps the Blockscout creation time discovery read (no extra call) as deployed_at; a later claim never clears it', db, async () => {
  const builderId = 900_000 + Math.floor(Math.random() * 90_000);
  const wallet = `0x${randomBytes(20).toString('hex')}`;
  const ref = `base:0x${randomBytes(20).toString('hex')}`;
  const [{ id }] = await sql()<{ id: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by) VALUES (${builderId}, 'contract', ${ref}, ${ref}, 'proposed', 'server') RETURNING id::int AS id`;
  const r = await claimContract(id, builderId, ref, { deployer: wallet, created_at: '2025-06-10T08:00:00Z', earnkitDeployed: false, repo: null }, new Set([wallet]));
  assert.ok('proof' in r);
  const [row] = await sql()<{ at: Date | null }[]>`SELECT deployed_at AS at FROM builder_sources WHERE id = ${id}`;
  assert.equal(row.at?.toISOString(), '2025-06-10T08:00:00.000Z');
  // An unreadable time (EarnKit's own deploys read none) stores nothing.
  const ref2 = `base:0x${randomBytes(20).toString('hex')}`;
  const [{ id: id2 }] = await sql()<{ id: number }[]>`
    INSERT INTO builder_sources (builder_id, kind, ref, project_key, state, proposed_by) VALUES (${builderId}, 'contract', ${ref2}, ${ref2}, 'proposed', 'server') RETURNING id::int AS id`;
  await claimContract(id2, builderId, ref2, { deployer: null, created_at: null, earnkitDeployed: true }, new Set());
  const [row2] = await sql()<{ at: Date | null; state: string }[]>`SELECT deployed_at AS at, state FROM builder_sources WHERE id = ${id2}`;
  assert.deepEqual([row2.at, row2.state], [null, 'verified']);
  await sql()`DELETE FROM builder_sources WHERE builder_id = ${builderId}`;
});
