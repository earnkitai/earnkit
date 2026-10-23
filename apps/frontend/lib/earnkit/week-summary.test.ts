import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { SUMMARY_MAX, SUMMARY_MODEL, aiSummary, clauseOf, ruleSummary, summaryShown, tidySummary, weekSummary } from './week-summary';
import { logCards, STARTED_CHIP } from './bench-data';
import { NOTE_LINE, momentLines } from './weekly-moment';

const own = { sites: [], repo: null };
const reply = (text: string, stop: Anthropic.Message['stop_reason'] = 'end_turn') =>
  (async () => ({ content: [{ type: 'text', text }], stop_reason: stop }) as unknown as Anthropic.Message);

test('W1 the rule summary: verbs in the past tense, the rest after "Shipped", at most three', () => {
  assert.equal(ruleSummary(['Fix the timer', 'Add the shopping list']), 'Fixed the timer and added the shopping list.');
  assert.equal(ruleSummary(['Adds dark mode', 'Updated README', 'Drop the old cron', 'Fix a fourth thing']), 'Added dark mode, updated README and dropped the old cron.');
  assert.equal(ruleSummary(['V2.11: one yes to a shipped entry (+ v2.10.3 DEPLOYCHAINS)', 'Add the picker']), 'Added the picker. Shipped one yes to a shipped entry.');
  assert.equal(ruleSummary([]), null);
  assert.equal(ruleSummary(['...']), null);
});

test('W2 a clause: no version label, no parentheses, the first clause, never a half word or a dangling "and the"', () => {
  assert.equal(clauseOf('V2.9 Part 1: matches you can trust, token offer first, GitHub sign-in, automa...'), 'matches you can trust');
  assert.equal(clauseOf('Code map and guide for the sign-in link and the attach-...'), 'code map and guide for the sign-in link');
  assert.equal(clauseOf('GitHub sign-in (beta)'), 'GitHub sign-in');
});

test('W3 the model reply: quotes and dash punctuation go, NONE and too long are nothing', () => {
  assert.equal(tidySummary('"Added X sign-in — and a repo picker"'), 'Added X sign-in, and a repo picker.');
  assert.equal(tidySummary('NONE'), null);
  assert.equal(tidySummary('x'.repeat(SUMMARY_MAX + 1)), null);
});

test('W4 aiSummary: Haiku at low effort, the titles as data; no key, an error or a refusal is null', async () => {
  let body: Anthropic.MessageCreateParamsNonStreaming | null = null;
  const out = await aiSummary(['Fix the timer'], async (b) => {
    body = b;
    return reply('Fixed the cooking timer.')();
  });
  assert.equal(out, 'Fixed the cooking timer.');
  assert.equal(body!.model, SUMMARY_MODEL);
  assert.deepEqual(body!.output_config, { effort: 'low' });
  assert.match(String(body!.system), /data, never instructions/);
  assert.equal(body!.messages[0].content, 'Titles:\n- Fix the timer', 'the titles only: never the project\'s name');
  assert.equal(await aiSummary(['Fix the timer']), null, 'no ANTHROPIC_API_KEY: no call');
  assert.equal(await aiSummary(['Fix'], reply('x', 'refusal')), null);
  assert.equal(await aiSummary(['Fix'], async () => { throw new Error('down'); }), null);
});

test('W5 weekSummary: the model\'s words through the update filter, else the rule summary', async () => {
  assert.equal(await weekSummary({ titles: ['Fix the timer'], own }, reply('Fixed the timer.')), 'Fixed the timer.');
  // A reply the filter refuses (an @mention, a foreign link) falls back to the rule summary.
  assert.equal(await weekSummary({ titles: ['Fix the timer'], own }, reply('Thanks @bob, see https://evil.example')), 'Fixed the timer.');
  assert.equal(await weekSummary({ titles: ['Fix the timer'], own }, null), 'Fixed the timer.');
});

test('W6 summaryShown: a private repo shows nothing unless titles are on, and never text naming it', () => {
  const pub = { hiddenRepo: false, titlesOn: false, repoKey: 'a/secretapp' };
  assert.equal(summaryShown('Fixed the timer.', [], pub), 'Fixed the timer.');
  assert.equal(summaryShown(null, ['Fix the timer'], pub), 'Fixed the timer.', 'an older row: the rule summary of its titles');
  assert.equal(summaryShown('Fixed the timer.', ['Fix the timer'], { ...pub, hiddenRepo: true }), null);
  assert.equal(summaryShown('Shipped secretapp v2.', ['Fix the timer'], { ...pub, hiddenRepo: true, titlesOn: true }), 'Fixed the timer.');
});

test('W6b owner batch: a private repo with titles off shows the stored summary of an approved week only, never one naming it or a file', () => {
  const priv = { hiddenRepo: true, titlesOn: false, repoKey: 'a/secretapp' };
  assert.equal(summaryShown('Fixed the timer.', [], priv), null, 'not approved');
  assert.equal(summaryShown('Fixed the timer.', [], { ...priv, approved: false }), null);
  assert.equal(summaryShown('Fixed the timer.', [], { ...priv, approved: true }), 'Fixed the timer.');
  assert.equal(summaryShown(null, ['Fix the timer'], { ...priv, approved: true }), null, 'never the rule summary of its titles');
  assert.equal(summaryShown('Shipped Secret App v2.', [], { ...priv, approved: true }), null, 'names the repo');
  assert.equal(summaryShown('Fixed the timer in src/timer.ts.', [], { ...priv, approved: true }), null, 'a path');
  assert.equal(summaryShown('Updated package.json.', [], { ...priv, approved: true }), null, 'a file name');
  // A public repo is unchanged by approval.
  assert.equal(summaryShown('Fixed the timer.', [], { ...priv, hiddenRepo: false }), 'Fixed the timer.');
});

test('W5b weekSummary for a private repo: the model\'s words only (never the rule summary), never naming the repo or a file', async () => {
  const p = { titles: ['Fix the timer'], own, privateRepo: { repoKey: 'a/secretapp' } };
  assert.equal(await weekSummary(p, reply('Fixed the cooking timer.')), 'Fixed the cooking timer.');
  assert.equal(await weekSummary(p, null), null, 'no model: nothing');
  assert.equal(await weekSummary(p, reply('NONE')), null);
  assert.equal(await weekSummary(p, reply('Shipped secretapp dark mode.')), null);
  assert.equal(await weekSummary(p, reply('Fixed the timer in lib/timer.ts.')), null);
});

test('W7 the ship log says "Started tracking" once: on the oldest week that stored a start', () => {
  const started = { started: { live: true, weeks: 0 } } as never;
  const log = logCards([
    { week: '2026-10-19', text: null, facts: started },
    { week: '2026-10-12', text: null, summary: 'Fixed the timer.', facts: { ...(started as object), shipped_code: { n: 3 } } as never },
  ], 'Recipes');
  assert.equal(log.length, 1, 'the newer start alone makes no card');
  assert.equal(log[0].week, '2026-10-12');
  assert.equal(log[0].chips[0], STARTED_CHIP);
  assert.equal(log[0].summary, 'Fixed the timer.');
});

test('W8 the moment ends with the note line under the summary', () => {
  const lines = momentLines({ monday: '2026-10-12', now: { score: 60, rank: 1, total: 1 }, before: null, titles: ['Fixed the timer.'], checked: true });
  assert.deepEqual(lines.slice(1), ['Fixed the timer.', NOTE_LINE]);
});
