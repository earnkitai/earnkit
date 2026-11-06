import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from '../v5/db';
import { replayFetch } from '../v5/fixtures/github';
import { blockscout } from './explorers';
import { replayExplorer } from './fixtures/explorer';
import { fakeRdap, fakeSite } from './fixtures/site';
import { run, type RunDeps } from './screen';

after(() => sql().end());
beforeEach(async () => {
  await sql()`DELETE FROM evidence_cache`;
});

const NOW = new Date('2026-11-06T12:00:00Z');
const CSV = join(import.meta.dirname, 'fixtures', 'applicants.csv');
const BASE = 'https://base.blockscout.com/api/v2';
const FAST = { gapMs: 0, sleep: async () => {} };
const BANNED = /score|rank|grade|points|coin|token|streak|—/i;
/** The four recorded repos as one GitHub: the first recording that knows a URL answers it. */
function github() {
  const recs = ['earnkit', 'onchain-reaction', 'nextjs-dashboard', 'astral-logbook'].map((s) => replayFetch(`../../../v6/fixtures/repos/${s}`));
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    for (const r of recs) {
      const res = await r.fetch(input, init);
      if (res.status !== 404) return res;
    }
    return new Response('not recorded', { status: 404 });
  }) as typeof fetch;
  return { fetch: f, calls };
}
/** abi.ninja is not recorded: a page linking its repo stands in. */
const ABI = { 'https://abi.ninja/': { status: 200, body: '<html><title>ABI Ninja</title><a href="https://github.com/BuidlGuidl/abi.ninja">GitHub</a></html>' } };
function deps(gh = github()): RunDeps & { lines: string[]; gh: ReturnType<typeof github> } {
  const lines: string[] = [];
  return {
    lines, gh, now: NOW, log: (s: string) => lines.push(s),
    evidence: {
      gh: gh.fetch, explorer: (c, f) => (c === 'base' ? blockscout(BASE, f, FAST) : null),
      explorerFetch: replayExplorer('onchain-reaction').fetch, probe: fakeSite(ABI).probe, rdap: fakeRdap().rdap,
    },
  };
}
const outDir = () => mkdtempSync(join(tmpdir(), 'ek-screen-'));

test('run over the fixture CSV writes both files and places each applicant', async () => {
  const out = outDir();
  const d = deps();
  try {
    const r = await run([CSV, '--program', 'base-builder-grants', '--chain', 'base', '--out', out], d);
    assert.equal(r.code, 0);
    assert.deepEqual(readdirSync(out).sort(), ['base-builder-grants-2026-11-06.csv', 'base-builder-grants-2026-11-06.md']);
    const md = readFileSync(join(out, 'base-builder-grants-2026-11-06.md'), 'utf8');
    const csv = readFileSync(join(out, 'base-builder-grants-2026-11-06.csv'), 'utf8');
    const tierOf = new Map(r.rows.map((x) => [x.applicant.ref, x.placement.tier]));
    assert.ok(['live', 'used'].includes(tierOf.get('ek-2')!), String(tierOf.get('ek-2')));
    assert.equal(tierOf.get('ek-6'), 'unverified');
    assert.match(md, /### Lab Notes \(ek-6\)\n\nunverified: [^\n]+\n(- [^\n]+\n)*- problem: repo link not on GitHub/);
    // Four applicants sent one pitch: each is flagged, and the pitch itself is never written.
    for (const ref of ['ek-3', 'ek-4', 'ek-7', 'ek-8']) assert.equal(tierOf.get(ref), 'flagged', ref);
    assert.ok(!md.includes('easiest onchain app') && !csv.includes('easiest onchain app'));
    // The site-only applicant: the repo comes from its page, and the report says so; it is not recorded, so it reads as private or missing.
    const abi = r.rows.find((x) => x.applicant.ref === 'ek-5')!;
    assert.equal(abi.evidence?.repo, 'buidlguidl/abi.ninja');
    assert.deepEqual(abi.applicant.problems, ['repo taken from the site link: buidlguidl/abi.ninja']);
    assert.match(md, /- problem: repo taken from the site link: buidlguidl\/abi\.ninja/);
    // Nothing resolves for the address-only row: screened with what it has, and said so.
    assert.ok(r.rows.find((x) => x.applicant.ref === 'ek-8')!.applicant.problems.includes('no repo found'));
    assert.equal(csv.trimEnd().split('\n').length, 9);
    assert.ok(!BANNED.test(md + csv + d.lines.join('\n')));
    // One line per applicant as it goes, then the summary.
    assert.equal(d.lines.filter((l) => /^ek-\d /.test(l)).length, 8);
    assert.ok(d.lines.some((l) => /^Reads used: GitHub \d+, explorer \d+, site \d+$/.test(l)));
    assert.ok(d.lines.some((l) => l.includes(join(out, 'base-builder-grants-2026-11-06.md'))));
    assert.ok(r.reads.github > 0 && r.reads.explorer > 0 && r.reads.site > 0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a run with --no-cache makes the same GitHub calls twice; with the cache the second run reads less', async () => {
  const out = outDir();
  try {
    const a = deps();
    await run([CSV, '--program', 'p', '--out', out, '--no-cache'], a);
    const b = deps();
    await run([CSV, '--program', 'p', '--out', out, '--no-cache'], b);
    assert.ok(a.gh.calls.length > 0);
    assert.deepEqual(b.gh.calls, a.gh.calls);
    assert.equal((await sql()`SELECT key FROM evidence_cache`).length, 0);
    const c = deps();
    await run([CSV, '--program', 'p', '--out', out], c);
    const e = deps();
    await run([CSV, '--program', 'p', '--out', out], e);
    assert.ok(e.gh.calls.length < c.gh.calls.length);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('fails fast with a plain message: unknown chain, unknown threshold, no program, a CSV that cannot be read', async () => {
  const out = outDir();
  try {
    const cases: [string[], RegExp][] = [
      [[CSV, '--program', 'p', '--chain', 'foo', '--out', out], /^Unknown chain foo\. Known: .*base/],
      [[CSV, '--program', 'p', '--thresholds', '{"nope":1}', '--out', out], /^Unknown threshold nope\. Known: used_funded_senders/],
      [[CSV, '--program', 'p', '--thresholds', '{"used_funded_senders":"x"}', '--out', out], /^Threshold used_funded_senders must be a number/],
      [[CSV, '--out', out], /^Usage: pnpm screen/],
      [[join(out, 'missing.csv'), '--program', 'p', '--out', out], /^Could not read the CSV/],
    ];
    for (const [args, re] of cases) {
      const d = deps();
      const r = await run(args, d);
      assert.equal(r.code, 1, args.join(' '));
      assert.match(d.lines.join('\n'), re);
    }
    assert.deepEqual(readdirSync(out), []);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('--thresholds merges over the defaults: a lower bar moves a placement', async () => {
  const out = outDir();
  try {
    const r = await run([CSV, '--program', 'p', '--out', out, '--no-cache', '--thresholds', '{"flag_identical_pitch":10}'], deps());
    assert.notEqual(r.rows.find((x) => x.applicant.ref === 'ek-7')!.placement.tier, 'flagged');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('one GitHub budget for the run: once stopped, no applicant reads GitHub', async () => {
  const out = outDir();
  try {
    const d = deps();
    const budget = { remaining: 10, stopped: true };
    const r = await run([CSV, '--program', 'p', '--out', out, '--no-cache'], { ...d, evidence: { ...d.evidence, budget } });
    assert.equal(r.code, 0);
    assert.equal(d.gh.calls.length, 0);
    assert.equal(r.reads.github, 0);
    for (const ref of ['ek-1', 'ek-2', 'ek-3', 'ek-4']) assert.deepEqual(r.rows.find((x) => x.applicant.ref === ref)!.evidence?.notes, ['not read: budget'], ref);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('duplicate refs stay apart through the run', async () => {
  const out = outDir();
  try {
    const csv = join(out, 'dup.csv');
    writeFileSync(csv, 'ref,name,url\nx,One,https://earnkit.com/\nx,Two,https://onchainreaction.vercel.app/\n');
    const d = deps();
    const r = await run([csv, '--program', 'p', '--out', join(out, 'o'), '--no-cache'], d);
    assert.deepEqual(r.rows.map((x) => [x.applicant.ref, x.applicant.name]), [['x', 'One'], ['x (2)', 'Two']]);
    assert.deepEqual(r.rows[1].applicant.problems.filter((p) => p === 'duplicate ref'), ['duplicate ref']);
    assert.ok(d.lines.includes('x (2) Two: live'), d.lines.join('\n'));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
