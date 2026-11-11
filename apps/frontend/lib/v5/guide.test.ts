import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { moneyOf as replyMoney } from './find';
import { lowerFirst, moneyAt } from './programs-read';
import { guideLines, guideText, sentence } from './guide';
import { landingTiles } from './landing';
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
  assert.equal(g.money, 'Up to $5,000');
  assert.equal(g.closes, 'Rolling');
  assert.ok(g.eligibility.includes('A live product.'));
  assert.ok(g.eligibility.includes('On Base.'));
  assert.ok(g.fields.length > 0);
  assert.deepEqual(g.fields[0], { label: 'Full name', todo: 'Your full name.' });
  assert.equal(g.rules.length, 7);
  assert.ok(g.sources.some((s) => s.label === 'Program page.' && s.url === 'https://docs.base.org/get-started/builders'));
});

test('closes: a date, rolling, not open yet, closed', () => {
  assert.equal(guideText(rowOf(programFixture({ id: 'a-a', ends_at: '2026-12-01T20:00:00Z', summary: 'Up to $5,000 · 11:59 PM PT' }))).closes, 'Closes Dec 1');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-b' }))).closes, 'Rolling');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-c', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [] }))).closes, 'Not open yet');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-d', status: 'closed' }))).closes, 'Closed');
});

test('a closed program says nothing about who submits (v6.1.7 C7)', () => {
  assert.equal(guideText(rowOf(programFixture({ id: 'a-d', status: 'closed' }))).submit, null);
  assert.equal(guideText(rowOf(programFixture({ id: 'a-e', status: 'closed', submit: 'builder' }))).submit, null);
  assert.equal(guideText(rowOf(programFixture({ id: 'a-f', ends_at: '2020-01-01T00:00:00Z' }))).submit, null);
  assert.equal(guideText(rowOf(programFixture({ id: 'a-g' }))).submit, 'Your agent sends it.');
  // Low 21 (v6.1.13): nor one not open yet.
  assert.equal(guideText(rowOf(programFixture({ id: 'a-h', status: 'upcoming', opens_note: 'Opens in January' }))).submit, null);
});

test('past rounds, focus, best bet and sources come from the record', () => {
  const g = guideText(rowOf(programFixture({
    id: 'a-e',
    past_rounds: [{ label: 'Round 1', source_url: 'https://example.com/r1', winners: 20, submissions: 400, themes: [{ theme: 'payments', count: 5 }] }],
    focus: { areas: ['payments', 'agents'], source_url: 'https://example.com/focus', ecosystem: 'Base' },
    best_bet: 'a payments agent',
  })));
  assert.equal(g.past_rounds.length, 1);
  // #9 (v6.1.15): each part a sentence.
  assert.equal(g.past_rounds[0], 'Round 1: 20 of about 400 entries won. Payments (5).');
  assert.equal(g.focus, 'Base wants payments and agents.');
  assert.equal(g.best_bet, 'A payments agent.');
  assert.deepEqual(g.sources.map((s) => s.label), ['Program page.', 'Past winners.', 'Priorities.']);
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
  assert.equal(g.focus, 'Any Grants wants agents.');
});

test('catalog words: submit, sign-in, needs, bar and the integration item', () => {
  const g = guideText(rowOf(programFixture({
    id: 'a-h', sign_in: 'platform', platform_name: 'Avalanche Builder Hub', needs: ['founder_video'], min_tier: 'live',
    eligibility: [{ kind: 'integration', value: 'smart_wallet' }],
  })));
  assert.equal(g.submit, 'Your agent sends it.');
  assert.equal(g.sign_in, 'Form needs an Avalanche Builder Hub account.');
  assert.deepEqual(g.needs, ['a founder video']);
  assert.equal(g.bar, 'Needs a live product.');
  // No "Bar": EarnKit's own word (lane 5, 3.31).
  assert.equal(guideText(rowOf(programFixture({ id: 'a-k', min_tier: 'used' }))).bar, 'Needs a used product.');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-l', min_tier: 'building' }))).bar, 'Needs a repo with recent commits.');
  assert.deepEqual(g.eligibility, ['Uses Smart Wallet.']);
  const plain = guideText(rowOf(programFixture({ id: 'a-i', submit: 'builder' })));
  assert.equal(plain.submit, 'You send it.');
  assert.equal(plain.sign_in, null);
  assert.deepEqual(plain.needs, []);
  assert.equal(plain.bar, null);
  assert.equal(guideText(rowOf(programFixture({ id: 'a-j', sign_in: 'github', min_tier: 'used' }))).sign_in, 'Form needs a GitHub account.');
  // #14, template row 16 (v6.1.15): the program's form login, as a sentence; never EarnKit's own sign-in.
  assert.equal(guideText(rowOf(programFixture({ id: 'a-m', sign_in: 'google' }))).sign_in, 'Form needs a Google account.');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-n', sign_in: 'email' }))).sign_in, 'Form needs an email login.');
  assert.equal(guideText(rowOf(programFixture({ id: 'a-p', sign_in: 'platform', platform_name: 'Devpost' }))).sign_in, 'Form needs a Devpost account.');
  // The catalog check refuses a platform with no name; the guide still reads a sentence if one slips through.
  assert.equal(guideText(rowOf({ ...programFixture({ id: 'a-o' }), sign_in: 'platform' })).sign_in, "Form needs an account on the program's site.");
});

test('#9 (v6.1.15): sentence() capitalises and ends with a full stop', () => {
  assert.equal(sentence('a live product'), 'A live product.');
  assert.equal(sentence('Real users.'), 'Real users.');
  assert.equal(sentence('optional'), 'Optional.');
  assert.equal(sentence('is it live?'), 'Is it live?');
});

test('#9 (v6.1.15): every eligibility kind as a sentence; a date in plain words; a feature reads its note', () => {
  const g = guideText(rowOf(programFixture({
    id: 'a-q', chains: ['base', 'tempo'], chain_required: true,
    eligibility: [
      { kind: 'live_product' }, { kind: 'chain', value: 'base' }, { kind: 'chain', value: 'tempo' }, { kind: 'contract_on', value: 'base' },
      { kind: 'builder_codes' }, { kind: 'users' }, { kind: 'new_work_after', value: '2026-10-30T07:00:00Z' }, { kind: 'demo_video' },
      { kind: 'in_person' }, { kind: 'integration', value: 'smart_wallet' },
    ],
  })));
  assert.deepEqual(g.eligibility, [
    'A live product.', 'On Base or Tempo.', 'A contract on Base.', 'Base Builder Codes in the app.', 'Real users.',
    'New work started after 30 Oct 2026.', 'A demo video.', 'In person.', 'Uses Smart Wallet.',
  ]);
  const f = guideText(rowOf(programFixture({
    id: 'a-s',
    eligibility: [
      { kind: 'feature', value: '/.kiro directory at the repo root', note: 'a Kiro folder in the repo, not ignored by git' },
      { kind: 'feature', value: 'a mobile app' },
    ],
  })));
  assert.deepEqual(f.eligibility, ['A Kiro folder in the repo, not ignored by git.', 'A mobile app.']);
  assert.equal(guideText(rowOf(programFixture({ id: 'a-r', submission_requirements: [{ key: 'notes', label: 'Notes', kind: 'other', type: 'text', required: false, from: 'builder' }] }))).fields[0].todo, 'Optional.');
});

test('#9 (v6.1.15): focus joins with "and", lower-casing a plain first word only; a chain or ecosystem name keeps its capital', () => {
  const pp = guideText(real('paypal-ai-hackathon'));
  assert.match(pp.focus!, / wants AI agents that pay or get paid, new payment experiences built with AI and business tools on PayPal APIs\.$/);
  assert.match(guideText(real('lido-lego-grants')).focus!, /^Lido wants Ethereum liquid staking/);
  assert.match(guideText(real('uniswap-foundation-security-fund')).focus!, /^Uniswap wants Uniswap v4 hooks/);
  assert.match(guideText(real('base-builder-grants')).focus!, /and DeFi 2\.0/);
});

test('L1g-4 (v6.1.15): Kiroween\'s folder rule reads as words on the guide; the form asks for the Kiro folder', () => {
  const g = guideText(real('kiroween-2026'));
  assert.ok(g.eligibility.includes('A Kiro folder in the repo, not ignored by git.'));
  assert.equal(g.fields.find((f) => f.label === 'URL to your public GitHub')!.todo, 'A public GitHub repo with a Kiro folder.');
});

const catalog = (): ProgramRow[] =>
  readdirSync(join(import.meta.dirname, '../../../../programs')).filter((f) => f.endsWith('.json')).map((f) => real(f.replace(/\.json$/, '')));

test('Review Focus 4 (v6.1.15): for every program the guide money is the tile money, full figures, a capital; the reply reads it lowercase', () => {
  const NOW = new Date('2026-11-11T12:00:00Z');
  const rows = catalog();
  assert.ok(rows.length >= 52, `${rows.length}`);
  for (const row of rows) {
    const g = guideText(row, NOW);
    assert.equal(g.money, landingTiles([row], NOW)[0].money, row.id);
    assert.match(g.money, /^[A-Z$€£\d]/, row.id);
    // Lane 22 (fix round 1, I1, I2): never K or M on a tile, a guide or a reply, for every program; the reply reads
    // the tile's words, lowercase mid-sentence.
    const tile = landingTiles([row], NOW)[0].money;
    const reply = replyMoney(row.file);
    for (const m of [g.money, tile, reply]) assert.doesNotMatch(m, /\d[KM]\b/, `${row.id}: ${m}`);
    assert.equal(reply, moneyAt(tile, 'mid'), row.id);
    assert.equal(moneyAt(reply, 'tile'), tile, row.id);
    // Lowercase mid-sentence: nothing left for lowerFirst to lower (a chain's name or an acronym may lead).
    assert.equal(lowerFirst(reply), reply, row.id);
  }
  assert.equal(guideText(real('sovereign-tech-fund'), NOW).money, 'Funds work from EUR 50,000');
  assert.equal(replyMoney(real('sovereign-tech-fund').file), 'funds work from EUR 50,000');
  assert.equal(guideText(real('otf-internet-freedom-fund'), NOW).money, '$10,000 to $900,000');
  assert.equal(guideText(real('base-builder-grants'), NOW).money, 'Up to $5,000');
  assert.equal(guideText(real('arbitrum-mentorship-cohort-2'), NOW).money, 'Up to $100,000');
  assert.equal(guideText(real('spc-founder-fellowship-spring-2027'), NOW).money, "$1,000,000 investment on the last round's terms");
  assert.equal(guideText(real('ethglobal-mumbai'), NOW).money, 'Up to $15,000 per partner prize');
  assert.equal(guideText(real('arbitrum-stablecoin-growth-program'), NOW).money, 'Incentives, plus 200,000 ARB for the first 10 teams');
  assert.equal(replyMoney(real('y-combinator').file), '$500,000 investment');
  // Fix round 2: the summary's money phrase on every surface.
  assert.equal(replyMoney(real('lido-lego-grants').file), 'up to $100,000 by tier, more by DAO vote');
  assert.equal(guideText(real('lido-lego-grants'), NOW).money, 'Up to $100,000 by tier, more by DAO vote');
  assert.equal(guideText(real('thiel-fellowship'), NOW).money, '$250,000 over two years');
  assert.equal(replyMoney(real('alliance-all19').file), '$400,000 at admission');
  assert.equal(guideText(real('monad-blitz-oregon'), NOW).money, '$4,600 in prizes');
});

test('#9 (v6.1.15): every guide string is a sentence with no path and no ISO date', () => {
  const NOW = new Date('2026-11-11T12:00:00Z');
  for (const row of catalog()) {
    const g = guideText(row, NOW);
    const parts: [string, string][] = [
      ...g.eligibility.map((t): [string, string] => ['eligibility', t]),
      ...g.fields.map((f): [string, string] => [`field ${f.label}`, f.todo]),
      ...(g.focus ? [['focus', g.focus] as [string, string]] : []),
      ...g.past_rounds.map((t): [string, string] => ['past_rounds', t]),
      ...(g.best_bet ? [['best_bet', g.best_bet] as [string, string]] : []),
      ...g.sources.map((s): [string, string] => ['source', s.label]),
    ];
    for (const [k, t] of parts) {
      assert.match(t, /[.?!]$/, `${row.id} ${k}: "${t}"`);
      assert.match(t, /^[A-Z0-9$€£"']/, `${row.id} ${k}: "${t}"`);
      assert.doesNotMatch(t, /(^|\s)\/\./, `${row.id} ${k}: "${t}"`);
      assert.doesNotMatch(t, /\d{4}-\d{2}-\d{2}/, `${row.id} ${k}: "${t}"`);
    }
  }
});

test('Review Focus 10 (v6.1.16, L21-2): every closed program reads "Closed on {date}." and no open-window sentence', async () => {
  const { OPEN_WINDOW } = await import('./program-checks');
  const { closedOn } = await import('./guide');
  const NOW = new Date('2026-11-11T12:00:00Z');
  let closed = 0;
  for (const row of catalog()) {
    const p = row.file;
    const g = guideText(row, NOW);
    const isClosed = p.status === 'closed' || (p.ends_at !== null && Date.parse(p.ends_at) <= NOW.getTime());
    if (!isClosed) {
      assert.equal(g.closed_on, null, row.id);
      continue;
    }
    closed++;
    assert.match(g.closed_on ?? '', /^Closed on \d{1,2} [A-Z][a-z]{2} \d{4}\.$/, row.id);
    assert.equal(g.closes, 'Closed', row.id);
    for (const t of [g.description, ...g.rules]) assert.doesNotMatch(t, OPEN_WINDOW, `${row.id}: ${t}`);
  }
  assert.ok(closed >= 3, `${closed}`);
  assert.equal(guideText(real('a16z-speedrun'), NOW).closed_on, 'Closed on 1 Nov 2026.');
  const a16z = guideText(real('a16z-speedrun'), NOW);
  for (const t of [a16z.description, ...a16z.rules]) assert.doesNotMatch(t, /are open/i);
  assert.equal(guideText(real('goose-grant-program'), NOW).closed_on, 'Closed on 11 Nov 2026.');
  assert.equal(guideText(real('monad-blitz-oregon'), NOW).closed_on, 'Closed on 10 Nov 2026.');
  // A date-closed program whose file still reads active and open: the guide drops the open-window sentences.
  const dated = rowOf(programFixture({
    id: 'a-open-window', ends_at: '2026-11-01T23:59:00-07:00', tz: 'America/Los_Angeles',
    description: 'A startup program. Applications are open until Nov 1. Founders meet weekly.',
    rules: ['Apply now on the portal.', 'Applications are open through November 1. Results come in December.', 'One entry per team.'],
  }));
  const g = guideText(dated, NOW);
  assert.equal(g.closed_on, 'Closed on 1 Nov 2026.');
  assert.equal(g.description, 'A startup program. Founders meet weekly.');
  assert.deepEqual(g.rules, ['Results come in December.', 'One entry per team.']);
  assert.equal(closedOn(dated.file, new Date('2026-10-01T00:00:00Z')), null);
  const open = guideText(dated, new Date('2026-10-01T00:00:00Z'));
  assert.equal(open.description, dated.file.description);
  assert.deepEqual(open.rules, dated.file.rules);
  assert.equal(closedOn(programFixture({ id: 'a-up', status: 'upcoming', opens_note: 'Opens in January', submission_requirements: [] }), NOW), null);
});

test('lane 20 audit (v6.1.16): circle money in full figures; Sovereign Tech funds work from EUR 50,000', () => {
  const NOW = new Date('2026-11-11T12:00:00Z');
  const circle = real('circle-developer-grants');
  assert.match(guideText(circle, NOW).money, /^\$10,000 to \$100,000\b/);
  assert.equal(replyMoney(circle.file), '$10,000 to $100,000 USDC grants');
  assert.equal(circle.file.min_award_usd, 10000);
  assert.equal(circle.file.min_tier, 'building');
  assert.equal(circle.file.tag, undefined);
  assert.ok(!circle.file.rules.some((r) => /audit funding/i.test(r)));
  const sovereign = real('sovereign-tech-fund');
  assert.equal(landingTiles([sovereign], NOW)[0].money, 'Funds work from EUR 50,000');
  assert.equal(replyMoney(sovereign.file), 'funds work from EUR 50,000');
});
