import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { SUMMARY_MAX, SUMMARY_MODEL, aiSummary, clauseOf, fitSummary, namesPath, ruleSummary, summaryConsented, summaryShown, tidySummary, weekSummary } from './week-summary';
import { logCards, STARTED_CHIP } from './bench-data';
import { NOTE_LINE, momentLines } from './weekly-moment';

const own = { sites: [], repo: null };
const reply = (text: string, stop: Anthropic.Message['stop_reason'] = 'end_turn') =>
  (async () => ({ content: [{ type: 'text', text }], stop_reason: stop }) as unknown as Anthropic.Message);

test('W1 the rule summary: verbs in the past tense, the rest after "Shipped", at most two', () => {
  assert.equal(ruleSummary(['Fix the timer', 'Add the shopping list']), 'Fixed the timer and added the shopping list.');
  assert.equal(ruleSummary(['Adds dark mode', 'Updated README', 'Drop the old cron', 'Fix a fourth thing']), 'Added dark mode and updated README.');
  assert.equal(ruleSummary(['V2.11: one yes to a shipped entry (+ v2.10.3 DEPLOYCHAINS)', 'Add the picker']), 'Added the picker. Shipped one yes to a shipped entry.');
  assert.equal(ruleSummary(['Fix the timer', 'Add the shopping list', 'Drop the old cron']), 'Fixed the timer and added the shopping list.');
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
  assert.equal(tidySummary('x'.repeat(281)), null, 'junk-long');
});

const WORDY = 'Shipped a weekly cron that scores campaigns, freezes entries, and makes capped automatic payouts, plus owner alerts for low funds, misconfigured payouts, and new campaigns. Hardened entry verification and scoring, added a review page, and tightened the sponsor and launch flow.';

test('W3b the length rule: fits as is; longer is cut at the first clause, never mid-word, never ending in and or a comma', () => {
  assert.equal(SUMMARY_MAX, 90);
  assert.equal(fitSummary('Added Sign in with X at install, with a fallback link.'), 'Added Sign in with X at install, with a fallback link.');
  const out = fitSummary(WORDY)!;
  assert.equal(out, 'Shipped a weekly cron that scores campaigns.');
  for (const t of [WORDY, 'Added capped contract deploys on Arc and Base and also a very long tail of unrelated things nobody asked for at all today',
    'Reworked sign in ' + 'x'.repeat(40) + ' and ' + 'y'.repeat(60), 'Reworked the sponsor onboarding, launch flow and payout review pages and', 'Supercalifragilisticexpialidocious '.repeat(4)]) {
    const f = fitSummary(t)!;
    assert.ok([...f].length <= SUMMARY_MAX, f);
    assert.match(f, /[a-z0-9]\.$/i, f);
    assert.doesNotMatch(f, /(\b(and|or|the|a|of|to|with)|,)\.$/i, f);
    assert.ok(t.startsWith(f.slice(0, -1)), 'a prefix of the original, never mid-word: ' + f);
    assert.ok(t[f.length - 1] === ' ' || t[f.length - 1] === ',' || t[f.length - 1] === '.' || t.length === f.length - 1, 'ends at a word boundary: ' + f);
  }
  assert.equal(fitSummary(''), null);
});

test('W3c the prompt asks for one short sentence, at most 90 characters', async () => {
  let system = '';
  await aiSummary(['Fix the timer'], async (b) => { system = String(b.system); return reply('Fixed the timer.')(); });
  assert.match(system, /one sentence/);
  assert.match(system, /at most 90 characters/i);
  assert.match(system, /non-developer/);
  assert.match(system, /no internal jargon/i);
  assert.match(system, /trailing list of minor fixes/);
});

test('W3d an over-long reply is asked for again once, then cut; a short second answer wins', async () => {
  let calls = 0;
  const seen: string[] = [];
  const twice = (second: string) => async (b: Anthropic.MessageCreateParamsNonStreaming) => { calls++; seen.push(String(b.messages[0].content)); return reply(calls === 1 ? WORDY : second)(); };
  assert.equal(await aiSummary(['x'], twice('Shipped automatic campaign scoring and capped payouts.')), 'Shipped automatic campaign scoring and capped payouts.');
  assert.equal(calls, 2);
  assert.match(seen[1], /too long/);
  assert.doesNotMatch(seen[0], /too long/);
  calls = 0;
  assert.equal(await aiSummary(['x'], twice(WORDY)), 'Shipped a weekly cron that scores campaigns.', 'still long: cut at the first clause, no third call');
  assert.equal(calls, 2);
  calls = 0;
  assert.equal(await aiSummary(['x'], async () => { calls++; return reply('Fixed the timer.')(); }), 'Fixed the timer.');
  assert.equal(calls, 1, 'a short reply: one call');
});

test('W3e weekSummary keeps the privacy checks after the length rule, and never stores more than 90 characters', async () => {
  const p = { titles: ['Fix the timer'], own, privateRepo: { repoKey: 'a/secretapp' } };
  assert.equal(await weekSummary(p, reply('Fixed the timer in lib/timer.ts and made the cooking timer much faster for everyone using the app.')), null);
  const out = await weekSummary({ titles: ['Fix the timer'], own }, reply(WORDY));
  assert.equal(out, 'Shipped a weekly cron that scores campaigns.');
  const long = await weekSummary({ titles: ['Add a long thing that goes on and on and on, with more words than any card could ever show at all'], own }, null);
  assert.ok(long && [...long].length <= SUMMARY_MAX, String(long));
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

test('W6b owner batch: a private repo with titles off shows the stored summary only when consented to, never one naming it or a file', () => {
  const priv = { hiddenRepo: true, titlesOn: false, repoKey: 'a/secretapp' };
  assert.equal(summaryShown('Fixed the timer.', [], priv), null, 'not approved');
  assert.equal(summaryShown('Fixed the timer.', [], { ...priv, consented: false }), null);
  assert.equal(summaryShown('Fixed the timer.', [], { ...priv, consented: true }), 'Fixed the timer.');
  assert.equal(summaryShown(null, ['Fix the timer'], { ...priv, consented: true }), null, 'never the rule summary of its titles');
  assert.equal(summaryShown('Shipped Secret App v2.', [], { ...priv, consented: true }), null, 'names the repo');
  assert.equal(summaryShown('Fixed the timer in src/timer.ts.', [], { ...priv, consented: true }), null, 'a path');
  assert.equal(summaryShown('Updated package.json.', [], { ...priv, consented: true }), null, 'a file name');
  // A public repo is unchanged by approval.
  assert.equal(summaryShown('Fixed the timer.', [], { ...priv, hiddenRepo: false }), 'Fixed the timer.');
});

test('W6c fix round: consent binds to the exact text the week was approved with', () => {
  assert.equal(summaryConsented({ approved: true, approved_summary: 'Fixed the timer.' }, 'Fixed the timer.'), true);
  assert.equal(summaryConsented({ approved: true, approved_summary: 'Fixed the timer.' }, 'Fixed the timer and the oven.'), false, 'changed after the yes');
  assert.equal(summaryConsented({ approved: true }, 'Fixed the timer.'), false, 'approved before approvals carried the text');
  assert.equal(summaryConsented({ approved: true, approved_summary: null }, 'Fixed the timer.'), false, 'approved with no summary, one written later');
  assert.equal(summaryConsented({ approved: false, approved_summary: 'Fixed the timer.' }, 'Fixed the timer.'), false);
  assert.equal(summaryConsented(null, 'Fixed the timer.'), false);
  assert.equal(summaryConsented({ approved: true, approved_summary: '' }, ''), false);
});

test('W6d fix wave (security ruling): namesPath is deny by default; only the listed tech names and word pairs pass', () => {
  for (const t of ['Moved to Next.js and Node.js.', 'Set up CI/CD.', 'Fixed sign-in and/or sign-up.', 'Ported React/Next.js pages.', 'Used Vue.js, Three.js, Nuxt.js and Express.js.',
    'Faster I/O.', 'A UI/UX pass.', 'Ran an A/B test.', 'Shipped v2.1 of the app.', 'Fixed sign-in. Added search.', 'Wait... it works.', 'Made it 2.5x faster.'])
    assert.equal(namesPath(t), false, t);
  for (const t of ['Edited src/app/page.tsx.', 'Moved lib/earnkit around.', 'Cleaned app/ up.', 'Renamed foo_bar/baz.', 'Fixed config.js.', 'Fixed main.c.', 'Edited README.txt.',
    'Fixed the timer in src/timer.ts.', 'Updated package.json.', 'Edited README.md.', 'Fixed lib/timer.js.', 'Fixed index.ts', 'Fixed PAGE.TSX.', 'Moved Next.js/app.',
    // Last fix wave (F): extensionless file names, dotfiles and the added extensions.
    'Fixed the Dockerfile.', 'Cleaned up the makefile.', 'Added a Procfile.', 'Updated .env defaults.', 'Edited .gitignore.', 'Added .xyzrc.', '(.eslintrc) tidy.',
    'Changed schema.prisma.', 'Fixed Nav.vue.', 'Fixed Card.svelte.', 'Edited schema.graphql.', 'Edited query.gql.', 'Edited api.proto.', 'Edited main.tf.',
    'Edited app.ini.', 'Edited app.cfg.', 'Edited nginx.conf.', 'Edited feed.xml.', 'Edited data.csv.'])
    assert.equal(namesPath(t), true, t);
  const priv = { hiddenRepo: true, titlesOn: false, repoKey: 'a/secretapp', consented: true };
  assert.equal(summaryShown('Moved to Next.js and set up CI/CD.', [], priv), 'Moved to Next.js and set up CI/CD.');
  assert.equal(summaryShown('Shipped Secretapp on Node.js.', [], priv), null, 'the repo name check stays');
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
