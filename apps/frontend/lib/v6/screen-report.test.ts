import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Applicant } from './applicants';
import { codeRows, contract, evidence, liveRows, NOW, daysAgo, teamRows } from './fixtures/evidence-builder';
import { csvReport, markdownReport, type ScreenRow } from './screen-report';
import { reviewerLine } from './tier-words';
import { place } from './tiers';

const BANNED = /score|rank|grade|points|coin|token|streak|—/i;
const app = (o: Partial<Applicant>): Applicant => ({
  ref: 'r', name: 'N', repo_url: null, live_url: null, contracts: [], pitch: 'SECRET PITCH TEXT', problems: [], ...o,
});
const row = (a: Applicant, e: ReturnType<typeof evidence> | null, x = { identical_pitch: 0, shared_contributors: 0 }): ScreenRow => {
  const p = place(e, x, undefined, NOW);
  return { applicant: a, evidence: e, placement: p, line: reviewerLine(p, e) };
};
const ROWS: ScreenRow[] = [
  row(app({ ref: 'u1', name: 'Used, Inc.' }), evidence({
    repo: 'a/used', live: liveRows({ url: 'https://used.xyz/', url_ok: true }),
    onchain: [contract({ tx_90d: 400, senders_90d: 90, funded_senders_90d: 40, funded_sample: 50 })],
    code: codeRows({ last_push_at: daysAgo(3), commits_90d: 20 }), team: teamRows({ contributors_90d: 2, logins: ['x'] }),
    depth: { integrations: ['onchainkit'], chains_mainnet: ['base'], chains_testnet: [] },
  })),
  row(app({ ref: 'l1', name: 'Live "One"' }), evidence({ live: liveRows({ url: 'https://live.xyz/', url_ok: true, note: 'domain_age_days not read: rdap' }) })),
  row(app({ ref: 'b1', name: 'Builder' }), evidence({
    repo: 'a/b', code: codeRows({ last_push_at: daysAgo(5), commits_90d: 4, note: 'issues not read: budget' }), team: teamRows(),
    notes: ['not read: budget'],
  })),
  row(app({ ref: 'f1', name: 'Copy' }), evidence({ repo: 'a/f', code: codeRows({ template_overlap: 0.8, template_name: 'create-next-app', files_own: 2, last_push_at: daysAgo(1), commits_90d: 2 }) })),
  row(app({ ref: 'v1', name: 'Nothing', problems: ['repo link not on GitHub'] }), evidence({ notes: ['repo not on github'] })),
  row(app({ ref: 'v2', name: 'Private', problems: ['no repo found'] }), evidence({ notes: ['not read: budget'] })),
];

test('markdown: one heading per tier present in order, totals that add up, problems and flags shown', () => {
  const md = markdownReport('base-builder-grants', ROWS, NOW);
  assert.match(md, /^# base-builder-grants screening, 2026-11-06/);
  const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, ['Totals', 'used (1)', 'live (1)', 'building (1)', 'flagged (1)', 'unverified (2)', 'What EarnKit could not read']);
  const totals = [...md.matchAll(/^\| (used|live|building|flagged|unverified|all) \| (\d+) \|$/gm)];
  const sum = totals.filter((m) => m[1] !== 'all').reduce((s, m) => s + Number(m[2]), 0);
  assert.equal(sum, ROWS.length);
  assert.equal(totals.find((m) => m[1] === 'all')?.[2], String(ROWS.length));
  assert.match(md, /### Used, Inc\. \(u1\)\n\nused: /);
  assert.match(md, /- flag: template, 80% of files match the create-next-app starter/);
  assert.match(md, /- problem: repo link not on GitHub/);
  assert.match(md, /- repo: a\/used/);
});

test('markdown: the closing section groups not-read notes with refs; no pitch, no em dash, no banned word', () => {
  const md = markdownReport('p', ROWS, NOW);
  const closing = md.slice(md.indexOf('## What EarnKit could not read'));
  assert.match(closing, /- not read: budget: b1, v2/);
  assert.match(closing, /- issues not read: budget: b1/);
  assert.match(closing, /- domain_age_days not read: rdap: l1/);
  assert.ok(!md.includes('SECRET PITCH'));
  assert.ok(!BANNED.test(md), md.match(BANNED)?.[0]);
});

test('markdown: nothing unread says so', () => {
  const md = markdownReport('p', [ROWS[0]], NOW);
  assert.match(md, /## What EarnKit could not read\n\nEverything listed was read\./);
});

test('csv: the header and one line per applicant, commas and quotes quoted, no pitch', () => {
  const csv = csvReport(ROWS);
  const lines = csv.trimEnd().split('\n');
  assert.equal(
    lines[0],
    'ref,name,tier,flags,outside_senders_90d,funded_senders_90d,senders_90d,chains_mainnet,last_push_at,contributors_90d,template_name,template_overlap,own_share,url_ok,line,problems',
  );
  assert.equal(lines.length, ROWS.length + 1);
  // #15 (v6.1.15): outside_senders_90d and its alias funded_senders_90d carry the same value side by side.
  assert.ok(lines[1].startsWith('u1,"Used, Inc.",used,,40,40,90,base,'), lines[1]);
  assert.ok(lines[2].startsWith('l1,"Live ""One""",live,'));
  assert.ok(lines[4].startsWith('f1,Copy,flagged,template,'));
  assert.ok(!csv.includes('SECRET PITCH'));
  assert.ok(!/—/.test(csv));
});

test('csv: a cell that a spreadsheet would run as a formula is defused', () => {
  const csv = csvReport([row(app({ ref: 'x', name: '=HYPERLINK("http://evil")' }), evidence())]);
  assert.ok(csv.split('\n')[1].startsWith(`x,"'=HYPERLINK(""http://evil"")"`));
});
