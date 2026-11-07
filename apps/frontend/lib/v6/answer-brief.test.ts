import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_KINDS } from '../v5/program-file';
import { STYLE_CONTRACT, answerBrief } from './answer-brief';
import { EMPTY_RECORD, mergeRecord } from './record';

const NOW = new Date('2026-11-06T12:00:00Z');
const FACTS = { repo_url: 'https://github.com/ada/app', live_url: 'https://ada.app', chains: ['base'], first_commit_at: '2026-08-02T00:00:00Z' };
const record = mergeRecord(EMPTY_RECORD, {
  person: { name: 'Ada', bio: 'Built two wallets.' },
  team: [{ name: 'Bo', role: 'design' }],
  company: { stage: 'pre_launch', launch_date: '2026-12-01', raised_usd: 0 },
  traction: { line_pre_launch: 'Pre-launch, 140 on the waitlist.', waitlist: 140 },
  projects: [{ id: 'p1', name: 'Ada', one_liner: 'Payments for builders.' }],
  answers: { problem: { text: 'Fees are high.' } },
}, 'builder', NOW).record;

test('the style is the contract verbatim', () => {
  assert.equal(
    STYLE_CONTRACT,
    'Use the approved answer. Shorten to the limit by cutting sentences, never by paraphrasing. Never add a fact, a number or a claim that is not in the answer or the record. No em dashes, no emoji, no filler, no over-explaining. If the program asks something the bank does not cover, ask the builder once and store their answer in the record before using it.',
  );
});

test('every kind has a question ending in "?", the contract as style, a length band, and no em dash anywhere', () => {
  for (const kind of ANSWER_KINDS) {
    const b = answerBrief(kind, record, FACTS);
    assert.equal(b.kind, kind);
    assert.match(b.question, /\?$/, kind);
    assert.equal(b.style, STYLE_CONTRACT);
    assert.ok(b.use.length > 0, kind);
    for (const line of [b.question, b.length, b.style, ...b.use]) assert.doesNotMatch(line, /—/, `${kind}: ${line}`);
  }
});

test('questions and length bands as given', () => {
  assert.equal(answerBrief('problem', record, FACTS).question, 'What problem do you solve, for whom, and how do they handle it today?');
  assert.equal(answerBrief('one_liner', record, FACTS).question, 'What is it, in one sentence?');
  assert.equal(answerBrief('one_liner', record, FACTS).length, 'one sentence, under 140 characters');
  assert.equal(answerBrief('traction', record, FACTS).length, 'two to four sentences with numbers and dates');
  assert.equal(answerBrief('risks', record, FACTS).length, 'one paragraph, 60 to 120 words');
});

test('use lists facts as label and value, from the record and the repo', () => {
  const t = answerBrief('traction', record, FACTS).use;
  assert.ok(t.includes('Repo: https://github.com/ada/app'), t.join('|'));
  assert.ok(t.includes('First commit: 2026-08-02'), t.join('|'));
  assert.ok(t.includes('Waitlist: 140'), t.join('|'));
  assert.ok(t.includes('Traction line: Pre-launch, 140 on the waitlist.'), t.join('|'));
  const team = answerBrief('team', record, FACTS).use;
  assert.ok(team.includes('Team: Bo (design)'), team.join('|'));
  assert.ok(answerBrief('problem', record, FACTS).use.includes('Current draft: Fees are high.'));
  for (const line of t) assert.match(line, /^[A-Z][A-Za-z ,-]+: /);
});
