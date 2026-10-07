import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeFile, ReportOutcome, matchOutcome, outcomeQuestion, winLine, type EntryRef } from './outcomes';

const entries: EntryRef[] = [
  { id: 1, repo_url: 'https://github.com/a/tipjar.git', name: 'TipJar', live_url: 'https://www.tipjar.example/app/' },
  { id: 2, repo_url: 'https://github.com/b/nanocrawl', name: 'NanoCrawl', live_url: null },
  { id: 3, repo_url: null, name: 'Twin', live_url: null },
  { id: 4, repo_url: null, name: 'twin ', live_url: null },
];

test('matchOutcome: a repo matches in any form (normalized)', () => {
  assert.equal(matchOutcome({ repo: 'github.com/A/TipJar' }, entries), 1);
  assert.equal(matchOutcome({ repo: 'https://github.com/a/tipjar/' }, entries), 1);
  assert.equal(matchOutcome({ repo: 'github.com/x/unknown' }, entries), null);
});

test('matchOutcome: a live link matches by host and path, ignoring www. and a trailing slash', () => {
  assert.equal(matchOutcome({ live_url: 'tipjar.example/app' }, entries), 1);
  assert.equal(matchOutcome({ live_url: 'https://TipJar.example/app' }, entries), 1);
  assert.equal(matchOutcome({ live_url: 'https://tipjar.example/other' }, entries), null);
});

test('matchOutcome: a name matches case-insensitively only when exactly one entry has it', () => {
  assert.equal(matchOutcome({ name: 'nanocrawl' }, entries), 2);
  assert.equal(matchOutcome({ name: '  NANOCRAWL ' }, entries), 2);
  assert.equal(matchOutcome({ name: 'Twin' }, entries), null, 'two entries share the name, no other key');
  assert.equal(matchOutcome({ name: 'Nobody' }, entries), null);
});

test('matchOutcome: the repo wins over the name when both are given and disagree', () => {
  assert.equal(matchOutcome({ repo: 'github.com/b/nanocrawl', name: 'TipJar' }, entries), 2);
  // A repo that matches nothing is no match, even if the name would match.
  assert.equal(matchOutcome({ repo: 'github.com/z/z', name: 'TipJar' }, entries), null);
  // A live link that misses falls back to the name.
  assert.equal(matchOutcome({ live_url: 'https://nope.example', name: 'TipJar' }, entries), 1);
});

test('winLine: money first with the prize; without one, the name and the program', () => {
  assert.equal(winLine({ prize_usd: 500, program_title: 'Arc Microgrants', name: 'TipJar' }), 'you won $500 in Arc Microgrants with TipJar');
  assert.equal(winLine({ prize_usd: 10000, program_title: 'Avalanche Team1 Mini Grants', name: 'TipJar' }), 'you won $10,000 in Avalanche Team1 Mini Grants with TipJar');
  assert.equal(winLine({ prize_usd: null, program_title: 'Arc Microgrants', name: 'TipJar' }), 'TipJar won in Arc Microgrants');
});

test('outcomeQuestion is the spec\'s question', () => {
  assert.equal(outcomeQuestion('TipJar', 'Arc Microgrants'), 'Did TipJar win anything in Arc Microgrants?');
});

const file = {
  program_id: 'arc-microgrants',
  round_label: 'Arc Microgrants 2026',
  source_url: 'https://community.arc.io/x',
  captured_at: '2026-10-22',
  results: [{ repo: 'github.com/a/tipjar', result: 'won', prize_usd: 500 }],
};

test('OutcomeFile: parses a valid file; refuses a result naming nothing, a non-https source, an unknown result', () => {
  assert.ok(OutcomeFile.safeParse(file).success);
  const noKey = OutcomeFile.safeParse({ ...file, results: [{ result: 'won' }] });
  assert.ok(!noKey.success);
  assert.ok(noKey.error.issues.some((i) => i.message === 'each result names a repo, name or live link'));
  assert.ok(!OutcomeFile.safeParse({ ...file, source_url: 'http://community.arc.io/x' }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, results: [{ name: 'X', result: 'champion' }] }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, results: [] }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, captured_at: 'Oct 22' }).success);
  assert.ok(!OutcomeFile.safeParse({ ...file, results: [{ name: 'X', result: 'won', prize_usd: -1 }] }).success);
});

test('ReportOutcome: the builder reports won, placed, finalist or not_selected; never unknown', () => {
  assert.ok(ReportOutcome.safeParse({ project_id: 1, result: 'won', prize_usd: 500 }).success);
  assert.ok(!ReportOutcome.safeParse({ project_id: 1, result: 'unknown' }).success);
  assert.ok(!ReportOutcome.safeParse({ project_id: 0, result: 'won' }).success);
  assert.ok(!ReportOutcome.safeParse({ project_id: 1, result: 'won', basis: 'announcement' }).success);
});
