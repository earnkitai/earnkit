import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HighlightsCard from '../../app/[handle]/site/HighlightsCard';
import { sql } from './db';
import { PRIVATE_NAME } from './page-data';
import { claimContract } from './sources';
import { UPTIME_MIN_READS, basescanHref, githubFileHref, githubRepoHref, liveSub, repoItem, siteHref } from './site-data';
import { backfillContractOrigins, ORIGIN_RETRY_MS } from './contract-origins';

/** v3.1 Highlights redesign: the pure rules (uptime, proof links, the track record), the card's links, the stored and backfilled deploy time. */

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

test('proof links: https sites only, Basescan for an address only, GitHub paths escaped per segment, never a climb out', () => {
  assert.equal(siteHref('https://www.kit.example'), 'https://www.kit.example');
  assert.equal(siteHref('https://kit.example/'), 'https://kit.example');
  assert.equal(siteHref('https://BÜCHER.example'), 'https://xn--bcher-kva.example');
  for (const bad of ['http://kit.example', 'javascript:alert(1)', 'kit.example', 'https://user:pw@kit.example', 'https://exa mple.com', '"><script>'])
    assert.equal(siteHref(bad), null, bad);
  const a = `0x${'AB'.repeat(20)}`;
  assert.equal(basescanHref(a), `https://basescan.org/address/0x${'ab'.repeat(20)}`);
  for (const bad of ['0x123', `0x${'g'.repeat(40)}`, `${a}/../x`, `javascript:${a}`]) assert.equal(basescanHref(bad), null, bad);
  assert.equal(githubRepoHref('Lee/Tip.Jar'), 'https://github.com/lee/tip.jar');
  assert.equal(githubRepoHref('not a repo'), null);
  assert.equal(githubRepoHref('a/b/c'), null);
  assert.equal(githubFileHref('lee/kit', 'main', 'src/onchain/tx.ts'), 'https://github.com/lee/kit/blob/main/src/onchain/tx.ts');
  assert.equal(githubFileHref('lee/kit', 'feat/x y', 'src/a b#c?.ts'), 'https://github.com/lee/kit/blob/feat/x%20y/src/a%20b%23c%3F.ts');
  assert.equal(githubFileHref('lee/kit', null, 'a.ts'), 'https://github.com/lee/kit/blob/HEAD/a.ts', 'GitHub reads HEAD as the default branch');
  for (const bad of ['../x.ts', 'src/../../x.ts', './a.ts', '', 'src//a.ts']) assert.equal(githubFileHref('lee/kit', 'main', bad), null, bad);
  assert.equal(githubFileHref('nope', 'main', 'a.ts'), null);
});

test('repoItem: since the repo was made, its commits in the read\'s year; "in the last year" only for an older repo; no date, no item', () => {
  const href = 'https://github.com/lee/kit';
  assert.deepEqual(repoItem('Kit', { created_at: '2024-02-10T00:00:00Z', commits_year: 1312 }, href, NOW), {
    icon: 'repo', title: 'Building Kit since Feb 2024', sub: '1,312 commits in the last year', href,
  });
  assert.deepEqual(repoItem('Kit', { created_at: '2026-06-01T00:00:00Z', commits_year: 1 }, null, NOW), { icon: 'repo', title: 'Building Kit since Jun 2026', sub: '1 commit' });
  assert.deepEqual(repoItem(PRIVATE_NAME, { created_at: '2026-06-01T00:00:00Z', commits_year: 4 }, null, NOW)?.title, 'Building since Jun 2026');
  assert.equal(repoItem('Kit', { created_at: '2026-06-01T00:00:00Z' }, null, NOW)?.sub, '', 'a reading from before the count: no sub line');
  assert.equal(repoItem('Kit', { commits_year: 4 }, null, NOW), null);
  assert.equal(repoItem('Kit', { created_at: 'soon' }, null, NOW), null);
  assert.equal(repoItem('Kit', { created_at: '2026-11-01T00:00:00Z' }, null, NOW), null, 'never a future date');
  assert.equal(repoItem('Kit', null, null, NOW), null);
});

test('HighlightsCard: another site opens in a new tab (noopener noreferrer) with the arrow; a program guide in the same tab; an unlinked item is no link; no empty sub line', () => {
  (globalThis as { React?: typeof React }).React = React;
  const html = renderToStaticMarkup(React.createElement(HighlightsCard, {
    items: [
      { icon: 'live', title: 'Live at kit.example', sub: 'Up 29 of the last 30 days checked', href: 'https://kit.example/?a="b"' },
      { icon: 'code', title: 'Builder Code in the repo', sub: 'Base, checked Oct 21' },
      { icon: 'repo', title: 'Building since Jun 2026', sub: '' },
      { icon: 'applied', title: 'Applied to X', sub: 'Oct 2026', href: '/programs/x' },
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
  assert.ok(html.includes('Builder Code in the repo'));
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
