import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HighlightsCard from '../../app/[handle]/site/HighlightsCard';
import { sql } from './db';
import { PRIVATE_NAME } from './page-data';
import { claimContract } from './sources';
import { UPTIME_MIN_READS, basescanHref, githubFileHref, githubRepoHref, repoItem, siteHref, uptimeOf } from './site-data';

/** v3.1 Highlights redesign: the pure rules (uptime, proof links, the track record), the card's links, the stored deploy time. */

const db = { skip: !process.env.DATABASE_URL && 'no DATABASE_URL' };
after(async () => {
  if (process.env.DATABASE_URL) await sql().end();
});
const NOW = new Date('2026-10-21T12:00:00Z');
const DAY = 86_400_000;
/** `n` daily rows ending at `last`, up unless listed in `down`. */
const rows = (last: string, n: number, down: number[] = []) =>
  Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(`${last}T00:00:00Z`) - (n - 1 - i) * DAY).toISOString().slice(0, 10), up: !down.includes(i) }));

test('uptimeOf: N up days of the last 30 ending at the newest reading; fewer days for a young site; a day unread is not up', () => {
  assert.deepEqual(uptimeOf(rows('2026-10-21', 30), '2026-01-01', '2026-10-21'), { up: 30, of: 30 });
  assert.deepEqual(uptimeOf(rows('2026-10-21', 40, [0, 35]), '2026-01-01', '2026-10-21'), { up: 29, of: 30 }, 'only the window counts');
  // Read through yesterday (today's read not run yet): the window ends yesterday.
  assert.deepEqual(uptimeOf(rows('2026-10-20', 30, [29]), '2026-01-01', '2026-10-21'), { up: 29, of: 30 });
  // A young site: the window starts at its first reading.
  assert.deepEqual(uptimeOf(rows('2026-10-21', 10, [4]), '2026-10-12', '2026-10-21'), { up: 9, of: 10 });
  // Ten days since the first reading, seven of them read: the three unread days are not up.
  const gappy = rows('2026-10-21', 10).filter((_, i) => ![2, 5, 7].includes(i));
  assert.deepEqual(uptimeOf(gappy, '2026-10-12', '2026-10-21'), { up: 7, of: 10 });
});

test('uptimeOf: null under 7 readings in the window, with none, or when the newest is over a day old', () => {
  assert.equal(UPTIME_MIN_READS, 7);
  assert.equal(uptimeOf(rows('2026-10-21', 6), '2026-10-16', '2026-10-21'), null);
  assert.equal(uptimeOf([], '2026-10-16', '2026-10-21'), null);
  assert.deepEqual(uptimeOf(rows('2026-10-21', 7), '2026-10-15', '2026-10-21'), { up: 7, of: 7 });
  assert.equal(uptimeOf(rows('2026-10-19', 30), '2026-01-01', '2026-10-21'), null, 'stopped two days ago');
  // Many readings, but only 6 inside the last 30 days: no uptime.
  const old = [...rows('2026-08-01', 30), ...rows('2026-10-21', 6)];
  assert.equal(uptimeOf(old, '2026-07-03', '2026-10-21'), null);
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

test('HighlightsCard: a linked item opens in a new tab (noopener noreferrer) with the arrow; an unlinked one is no link; no empty sub line', () => {
  (globalThis as { React?: typeof React }).React = React;
  const html = renderToStaticMarkup(React.createElement(HighlightsCard, {
    items: [
      { icon: 'live', title: 'Live at kit.example', sub: 'Up 29 of the last 30 days', href: 'https://kit.example' },
      { icon: 'code', title: 'Builder Code in the repo', sub: 'Base, checked Oct 21' },
      { icon: 'repo', title: 'Building since Jun 2026', sub: '' },
      { icon: 'applied', title: 'Applied to X', sub: 'Oct 2026', href: '/programs/x?a="b"' },
    ],
  }));
  const links = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
  assert.equal(links.length, 2);
  for (const l of links) {
    assert.match(l, /target="_blank"/);
    assert.match(l, /rel="noopener noreferrer"/);
  }
  assert.match(links[1], /href="\/programs\/x\?a=&quot;b&quot;"/, 'React escapes the href');
  assert.equal((html.match(/opens in a new tab/g) ?? []).length, 2);
  assert.equal((html.match(/M7 7h10v10/g) ?? []).length, 2, 'one arrow per link');
  assert.ok(html.includes('Builder Code in the repo'));
  assert.ok(!/<span class="text-\[13px\] text-s-muted"><\/span>/.test(html), 'an empty sub is not rendered');
  assert.equal(renderToStaticMarkup(React.createElement(HighlightsCard, { items: [] })), '');
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
