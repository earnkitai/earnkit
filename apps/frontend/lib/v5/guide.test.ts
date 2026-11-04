import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guideLines, guideText } from './guide';
import { ProgramFile } from './program-file';
import type { ProgramRow } from './programs';
import { programFixture } from './fixtures/program';

const rowOf = (file: ReturnType<typeof programFixture>): ProgramRow => ({
  id: file.id, file, source: 'file', created_at: new Date(0), updated_at: new Date(0), verified_at: null, stale_since: null,
});
const real = (id: string): ProgramRow =>
  rowOf(ProgramFile.parse(JSON.parse(readFileSync(join(import.meta.dirname, '../../../../programs', `${id}.json`), 'utf8'))));

test('base-builder-grants: money, closes, eligibility in plain words, fields, rules', () => {
  const g = guideText(real('base-builder-grants'));
  assert.equal(g.title, 'Base Builder Grant Program');
  assert.equal(g.money, '$5K');
  assert.equal(g.closes, 'Rolling, apply anytime');
  assert.ok(g.eligibility.includes('a live product'));
  assert.ok(g.eligibility.includes('on Base'));
  assert.ok(g.fields.length > 0);
  assert.deepEqual(g.fields[0], { label: 'Full name', todo: 'your full name' });
  assert.equal(g.rules.length, 7);
  assert.ok(g.sources.some((s) => s.label === 'program page' && s.url === 'https://docs.base.org/get-started/builders'));
});

test('closes: a date, rolling, not open yet, closed', () => {
  assert.equal(guideText(rowOf(programFixture({ id: 'a-a', ends_at: '2026-12-01T20:00:00Z', summary: 'Up to $5,000 · 11:59 PM PT' }))).closes, 'Closes Dec 1');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-b' }))).closes, 'Rolling, apply anytime');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-c', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [] }))).closes, 'Not open yet');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-d', status: 'closed' }))).closes, 'Closed');
});

test('past rounds, focus, best bet and sources come from the record', () => {
  const g = guideText(rowOf(programFixture({
    id: 'a-e',
    past_rounds: [{ label: 'Round 1', source_url: 'https://example.com/r1', winners: 20, submissions: 400, themes: [{ theme: 'payments', count: 5 }] }],
    focus: { areas: ['payments', 'agents'], source_url: 'https://example.com/focus', ecosystem: 'Base' },
    best_bet: 'a payments agent',
  })));
  assert.equal(g.past_rounds.length, 1);
  assert.match(g.past_rounds[0], /Round 1: 20 of about 400 entries won/);
  assert.match(g.past_rounds[0], /payments \(5\)/);
  assert.equal(g.focus, 'Base wants payments, agents');
  assert.equal(g.best_bet, 'a payments agent');
  assert.deepEqual(g.sources.map((s) => s.label), ['program page', 'past winners', 'priorities']);
});

test('a program with nothing extra has empty lists and nulls', () => {
  const g = guideText(rowOf(programFixture({ id: 'a-f' })));
  assert.deepEqual(g.past_rounds, []);
  assert.equal(g.focus, null);
  assert.equal(g.best_bet, null);
  assert.deepEqual(g.eligibility, []);
});

test('guideLines: the rules, one per line', () => {
  const g = guideText(real('base-builder-grants'));
  const lines = guideLines(g);
  assert.equal(lines[0], 'Rules:');
  assert.equal(lines.length, 1 + g.rules.length);
  assert.deepEqual(guideLines({ ...g, rules: [] }), []);
});

test('a focus with no ecosystem and no chains names the program, not an empty word', () => {
  const g = guideText(rowOf(programFixture({ id: 'a-g', title: 'Any Grants', chains: [], any_chain: true, focus: { areas: ['agents'], source_url: 'https://example.com/f' } })));
  assert.equal(g.focus, 'Any Grants wants agents');
});
