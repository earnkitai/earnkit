import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDay, programZone } from './deadline';
import { digestBody } from './digest';
import { closeDayOf, deadlineLabel, endsOf, summaryCloses } from './entry-text';
import { landingFrom } from './landing';
import { ProgramFile } from './program-file';
import { programCard } from './programs';
import type { Card } from './present';
import { heroChipText } from './site-copy';
import { ANSWER_FIRST_NOTE } from './stand-text';
import { statsFrom } from './stats';
import { committedProgram } from './fixtures/program-file';

/** v4.7 Task 1: one source for every deadline day, the open-money figure, and the points note. */

const ENDS = new Date('2026-11-02T07:59:59Z');
const NOW = new Date('2026-10-30T12:00:00Z');
const PROGRAMS = join(import.meta.dirname, '../../../../programs');
const files = () =>
  readdirSync(PROGRAMS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(PROGRAMS, f), 'utf8')));

test('programZone: tz, else the summary suffix, else UTC', () => {
  assert.equal(programZone({ summary: 'up to $1M · closes Nov 1, 11:59 PM PT' }), 'America/Los_Angeles');
  assert.equal(programZone({ summary: '500 USDC · closes Nov 1, 11:59 PM ET' }), 'America/New_York');
  assert.equal(programZone({ summary: '$5K · closes Nov 1, 11:59 PM CT' }), 'America/Chicago');
  assert.equal(programZone({ summary: '$5K · closes Nov 1, 11:59 PM UTC' }), 'UTC');
  assert.equal(programZone({ summary: '$5K · closes Nov 1, 11:59 PM GMT' }), 'UTC');
  assert.equal(programZone({ summary: '$5K · closes Nov 1' }), 'UTC');
  assert.equal(programZone({ summary: '$5K · closes Nov 1, 11:59 PM PT', tz: 'Asia/Kolkata' }), 'Asia/Kolkata');
  assert.equal(programZone({ summary: '$5K · rolling', tz: null }), 'UTC');
});

test('closeDay: ends_at in the program zone (PT and ET give Nov 1; no zone gives the UTC day)', () => {
  assert.equal(closeDay({ summary: 'up to $1M · closes Nov 1, 11:59 PM PT', ends_at: ENDS }), 'Nov 1');
  // ET: 11:59 PM ET on Nov 1 is 04:59 UTC on Nov 2 (arc-microgrants-studio).
  assert.equal(closeDay({ summary: '500 USDC · closes Nov 1, 11:59 PM ET', ends_at: new Date('2026-11-02T04:59:00Z') }), 'Nov 1');
  assert.equal(closeDay({ summary: 'up to $1M · closes Nov 1, 11:59 PM ET', ends_at: ENDS }), 'Nov 2', '07:59 UTC is already Nov 2 in ET');
  assert.equal(closeDay({ summary: 'up to $1M', ends_at: ENDS }), 'Nov 2');
  assert.equal(closeDay({ summary: 'up to $1M', tz: 'America/Los_Angeles', ends_at: ENDS }), 'Nov 1');
  // The landing cache serializes dates as strings.
  assert.equal(closeDay({ summary: 'up to $1M · closes Nov 1, 11:59 PM PT', ends_at: ENDS.toISOString() }), 'Nov 1');
  assert.equal(closeDay({ summary: 'up to $5,000 · rolling', ends_at: ENDS }), null);
  assert.equal(closeDay({ summary: 'up to $5,000', ends_at: null }), null);
  assert.equal(closeDay({ summary: 'up to $5,000' }), null);
});

test('closeDayOf: ends_at in the zone wins over the summary text; the summary only without ends_at', () => {
  assert.equal(closeDayOf({ summary: 'x · closes Nov 3, 11:59 PM PT', ends_at: ENDS }), 'Nov 1');
  assert.equal(closeDayOf({ summary: 'x · closes Nov 3, 11:59 PM PT', ends_at: null }), 'Nov 3');
  assert.equal(closeDayOf({ summary: 'x · rolling', ends_at: null }), null);
});

test('deadlineLabel: the program zone abbreviation when known, else UTC', () => {
  assert.equal(deadlineLabel(ENDS), 'Nov 2, 7:59 AM UTC');
  assert.equal(deadlineLabel(ENDS, 'America/Los_Angeles'), 'Nov 1, 11:59 PM PT');
  assert.equal(deadlineLabel(ENDS, 'America/New_York'), 'Nov 2, 2:59 AM ET');
  assert.equal(deadlineLabel(new Date('2026-11-01T00:00:00Z')), 'Oct 31');
  assert.equal(endsOf({ summary: 'up to $1M', tz: 'America/Los_Angeles', ends_at: ENDS }), 'Nov 1, 11:59 PM PT');
});

test('the program file schema takes an IANA tz and rejects an invalid one; the card carries it', () => {
  const p = committedProgram('a16z-speedrun');
  assert.equal(ProgramFile.safeParse({ ...p, tz: 'America/Los_Angeles' }).success, true);
  assert.equal(ProgramFile.safeParse({ ...p, tz: 'Pacific Time' }).success, false);
  assert.equal(ProgramFile.safeParse({ ...p, tz: 'Mars/Olympus' }).success, false);
  assert.equal(ProgramFile.safeParse(p).success, true, 'tz is optional');
});

test('every committed program: its summary "closes" day agrees with ends_at in the zone (a16z: Nov 1)', () => {
  const a16z = committedProgram('a16z-speedrun');
  assert.equal(closeDay({ ...a16z, ends_at: new Date(a16z.ends_at) }), 'Nov 1');
  assert.equal(summaryCloses(a16z.summary)!.startsWith('Nov 1,'), true);
  for (const f of files()) {
    const closes = summaryCloses(f.summary);
    if (!closes || !f.ends_at) continue;
    assert.equal(closeDay({ ...f, ends_at: new Date(f.ends_at) }), /^\w{3} \d{1,2}/.exec(closes)![0], f.id);
  }
});

const card = (id: string, o: Partial<Card> = {}): Card => ({
  id, title: id, summary: '', tag: null, each_time: [], ends_at: null, max_award_usd: 0, difficulty: null, logo: null, chains: ['base'], ...o,
});

test('the landing tile day is closeDay: a16z reads "Closes Nov 1" (Review Focus 2)', () => {
  const a16z = card('a16z-speedrun', { summary: 'up to $1M · closes Nov 1, 11:59 PM PT', ends_at: ENDS, investment: true, any_chain: true, chains: [] });
  const stats = statsFrom({ open_rows: null, pool_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0, tokens_declined: 0, bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0, labelled_entries: 0, entries_won: 0, builders_won_usd: null }, NOW);
  const tile = landingFrom([a16z], stats, NOW).tiles.find((t) => t.id === 'a16z-speedrun')!;
  assert.equal(tile.when, 'Closes Nov 1');
  // programCard carries the file's tz onto the card.
  assert.equal(programCard({ ...ProgramFile.parse({ ...committedProgram('a16z-speedrun'), tz: 'America/Los_Angeles' }), ends_at: ENDS } as never, []).tz, 'America/Los_Angeles');
});

test('the banner is heroChipText(statsFrom(...).open_money_usd) over the same rows', () => {
  const rows = files().map((p) => ({
    max_award_usd: p.max_award_usd ?? null, investment: p.investment ?? false, status: p.status, campaign: p.campaign ?? null,
    source: 'file', starts_at: p.starts_at, ends_at: p.ends_at,
  }));
  const stats = statsFrom({ open_rows: rows, pool_rows: null, programs_open: 0, bonus_programs_open: 0, coins_launched: 0, tokens_declined: 0, bonus_deposits_wei: null, bonus_to_safe_wei: null, bonus_paid_wei: null, bonus_pools_wei: null, installs: 0, labelled_entries: 0, entries_won: 0, builders_won_usd: null }, NOW);
  const cards = files().map((p) => card(p.id, { summary: p.summary, ends_at: p.ends_at ? new Date(p.ends_at) : null, max_award_usd: p.max_award_usd ?? null, investment: p.investment ?? false, status: p.status, chains: p.chains, any_chain: p.any_chain }));
  const l = landingFrom(cards, stats, NOW);
  assert.ok(stats.open_money_usd > 0);
  assert.equal(l.open_chip, heroChipText(stats.open_money_usd));
  // Fix round 1: the money line carries the same dollar figure as the chip.
  const figure = (t: string | null) => /^\$[\d.,]+[KM]?/.exec(t ?? '')?.[0];
  assert.ok(l.open_text && l.open_chip);
  assert.equal(figure(l.open_text), figure(l.open_chip));
  assert.equal(l.open_text, `${figure(l.open_chip)} in grants and prizes open`);
  assert.equal(heroChipText(105_000), '$105K in grants open now');
  assert.equal(heroChipText(0), null);
});

test('ANSWER_FIRST_NOTE: no points sentence but the never-call-it rule', () => {
  assert.ok(ANSWER_FIRST_NOTE.includes('Where they stand is answered from standing. The number is their score; never call it points.'));
  assert.doesNotMatch(ANSWER_FIRST_NOTE, /doesn't use points/);
  const pointSentences = ANSWER_FIRST_NOTE.split(/(?<=[.;])\s+/).filter((s) => /\bpoints\b/.test(s));
  assert.deepEqual(pointSentences, ['never call it points.']);
});

test('final review (Review Focus 2): the Monday email reads a close in the program zone: 11:59 PM PT Nov 1 is "closes Nov 1"', () => {
  const at = new Date('2026-11-02T07:59:59Z');
  const summary = 'up to $50,000 · closes Nov 1, 11:59 PM PT';
  const b = digestBody({
    week: null, handle: null, money: [], wins: [],
    newPrograms: [{ title: 'A16z Speedrun', repo: 'kit', prize_usd: 50000, ends_at: at, summary, tz: null }],
    deadlines: [
      { program: 'A16z Speedrun', what: 'closes', at, summary, tz: null },
      { program: 'Zoned', what: 'closes', at, summary: 'up to $5,000', tz: 'America/Los_Angeles' },
    ],
  })!;
  assert.match(b.text, /New: A16z Speedrun fits kit, \$50,000, closes Nov 1\./);
  assert.match(b.text, /Your A16z Speedrun: closes Nov 1\./);
  assert.match(b.text, /Your Zoned: closes Nov 1\./);
  assert.doesNotMatch(b.text, /Nov 2/);
});
