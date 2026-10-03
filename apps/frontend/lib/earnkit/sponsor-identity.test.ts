import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  earnkitTxtNames,
  nameWords,
  plainLettersProblem,
  reservedBrands,
  reservedNameProblem,
  sponsorHost,
  sponsorLabel,
  trackRecordOf,
  titleBrands,
  trackRecordText,
  type TrackRow,
} from './sponsor-identity';

const W = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';

test('sponsorLabel: unverified unless verified with a host', () => {
  assert.equal(
    sponsorLabel({ verified: false, host: null }),
    'Sponsored · unverified',
  );
  assert.equal(
    sponsorLabel({ verified: false, host: 'acme.dev' }),
    'Sponsored · unverified',
  );
  assert.equal(
    sponsorLabel({ verified: true, host: 'acme.dev' }),
    'Sponsored · verified acme.dev',
  );
});

test('sponsorHost: the lowercase host of an https link, else null', () => {
  assert.equal(sponsorHost('https://Acme.DEV/about'), 'acme.dev');
  assert.equal(sponsorHost('http://acme.dev'), null);
  assert.equal(sponsorHost(null), null);
  assert.equal(sponsorHost('nope'), null);
  // Review m5: older rows with a trailing dot or a port.
  assert.equal(sponsorHost('https://base.org./x'), 'base.org');
  assert.equal(sponsorHost('https://base.org:8443/x'), null);
});

test('earnkitTxtNames: a matching earnkit-sponsor line, case-insensitive', () => {
  assert.equal(earnkitTxtNames(`earnkit-sponsor: ${W}`, W), true);
  assert.equal(
    earnkitTxtNames(
      `# EarnKit\r\nEARNKIT-SPONSOR:${W.toUpperCase().replace('0X', '0x')}  \r\n`,
      W,
    ),
    true,
  );
  assert.equal(
    earnkitTxtNames(
      `﻿earnkit-sponsor: 0x2222222222222222222222222222222222222222\nearnkit-sponsor: ${W}\n`,
      W,
    ),
    true,
  );
  // Another wallet, a different key, a longer address, or text around it: no.
  assert.equal(
    earnkitTxtNames(
      'earnkit-sponsor: 0x2222222222222222222222222222222222222222',
      W,
    ),
    false,
  );
  assert.equal(earnkitTxtNames(`earnkit-verification: ${W}`, W), false);
  assert.equal(earnkitTxtNames(`earnkit-sponsor: ${W}11`, W), false);
  assert.equal(earnkitTxtNames(`say earnkit-sponsor: ${W}`, W), false);
  assert.equal(earnkitTxtNames(`<p>earnkit-sponsor: ${W}</p>`, W), false);
  assert.equal(earnkitTxtNames('', W), false);
});

test('nameWords: NFKC, look-alikes, accents, lowercase, split', () => {
  assert.deepEqual(nameWords('Ｂase Grants'), ['base', 'grants']);
  assert.deepEqual(nameWords('tokens.fun'), ['tokens', 'fun']);
  assert.deepEqual(nameWords('Вase'), ['base']); // Cyrillic Ve
  assert.deepEqual(nameWords('Bаse'), ['base']); // Cyrillic a
  assert.deepEqual(nameWords('Βase'), ['base']); // Greek Beta
  assert.deepEqual(nameWords('Bâsé'), ['base']);
  assert.deepEqual(nameWords('𝐁𝐚𝐬𝐞'), ['base']); // math bold, NFKC
});

test('reservedBrands: whole words, after normalization', () => {
  const cases: [string, string[]][] = [
    ['Base', ['base']],
    ['base', ['base']],
    ['Base Builders', ['base']],
    ['Builders on Base!', ['base']],
    ['Ｂase', ['base']], // fullwidth B
    ['ＢＡＳＥ', ['base']],
    ['Bаse', ['base']], // Cyrillic a
    ['EarnKit Official', ['earnkit']],
    ['Earn Kit', ['earnkit']],
    ['Coinbase Ventures', ['coinbase']],
    ['Coin Base', ['base', 'coinbase']],
    ['Circle', ['circle']],
    ['USDC Rewards', ['usdc']],
    ['Arc', ['arc']],
    ['Tempo Labs', ['tempo']],
    ['Monad Foundation', ['monad']],
    ['Robinhood', ['robinhood']],
    ['Robin Hood', ['robinhood']],
    ['tokens.fun', ['tokensfun']],
    ['Tokens Fun', ['tokensfun']],
    ['tokensfun', ['tokensfun']],
    // Decided: letters split by dots or spaces are joined back, so these match too.
    ['B.A.S.E', ['base']],
    ['B A S E Grants', ['base']],
    ['E-A-R-N-K-I-T', ['earnkit']],
    // Inside a longer word: not a match.
    ['Basecamp', []],
    ['Arcade Labs', []],
    ['Circles DAO', []],
    ['Tempora', []],
    ['Acme Labs', []],
    ['tokens', []],
    ['fun tokens', []],
  ];
  for (const [name, want] of cases)
    assert.deepEqual(reservedBrands(name), want, name);
});

test('reservedNameProblem: refused unless verified on the brand domain', () => {
  assert.match(
    reservedNameProblem('Base', null)!,
    /^sponsor_name: "Base" uses the reserved name Base\. Only a sponsor verified on base\.org or base\.dev can use it/,
  );
  assert.match(
    reservedNameProblem('Base', null)!,
    /https:\/\/base\.org\/\.well-known\/earnkit\.txt/,
  );
  // Verified, but on another domain (or a look-alike one).
  assert.ok(reservedNameProblem('Base', 'base-grants.xyz'));
  assert.ok(reservedNameProblem('Base', 'base.org.evil.xyz'));
  assert.ok(reservedNameProblem('Coinbase', 'base.org'));
  // Verified on the brand's own domain: allowed.
  assert.equal(reservedNameProblem('Base', 'base.org'), null);
  // m8: brands whose apex redirects serve the file on www.
  assert.equal(reservedNameProblem('Base', 'www.base.org'), null);
  assert.equal(reservedNameProblem('Base Builders', 'base.dev'), null);
  assert.equal(reservedNameProblem('USDC Rewards', 'circle.com'), null);
  assert.equal(reservedNameProblem('tokens.fun', 'tokens.fun'), null);
  // EarnKit's own name: refused for everyone, even verified on earnkit.com (re-audit H3).
  assert.match(
    reservedNameProblem('EarnKit', 'earnkit.com')!,
    /EarnKit's own name, which no sponsor campaign can use/,
  );
  // Two brands: one domain can't cover both.
  assert.ok(reservedNameProblem('Base x Circle', 'base.org'));
  // Not reserved: any sponsor, verified or not.
  assert.equal(reservedNameProblem('Acme Labs', null), null);
  // The title too (re-review): "Official Bаse Grant" under a harmless sponsor name.
  assert.match(
    reservedNameProblem('Official Bɑse Grant', null, 'title')!,
    /^title: "Official Bɑse Grant" uses the reserved name Base\..*choose another title: a title may say where to build/,
  );
  assert.equal(
    reservedNameProblem('Official Base Grant', 'base.org', 'title'),
    null,
  );
  assert.equal(reservedNameProblem('Best x402 service', null, 'title'), null);
});

const row = (r: Partial<TrackRow> = {}): TrackRow => ({
  state: 'live',
  amount: '100',
  token_symbol: 'USDC',
  award_source: null,
  fallback_plan: null,
  winners: [],
  ...r,
});

test('trackRecordOf: only funded campaigns of 100 USDC or more count', () => {
  const t = trackRecordOf(
    [
      row(),
      row({ state: 'awarded', award_source: 'sponsor', winners: [B] }),
      row({ state: 'awarded', award_source: 'off_plan', winners: [B] }),
      row({ state: 'refunded' }),
      row({ state: 'taken_down' }),
      row({ state: 'expired' }),
      row({ state: 'draft' }),
    ],
    W,
  );
  // An off-plan award (a direct contract call, no entry needed) is not "awarded by the sponsor"
  // (re-audit M3: it bought a track record for 10%).
  assert.deepEqual(t, {
    funded: 5,
    live: 1,
    awarded: 1,
    fallback: 0,
    self_awarded: 0,
    off_plan: 1,
    refunded: 1,
    taken_down: 1,
  });
  assert.equal(
    trackRecordText(t),
    "This sponsor wallet has funded 5 campaigns of 100 USDC or more on EarnKit: 1 awarded by the sponsor, 0 paid by EarnKit's fallback, 1 refunded with no winners, 1 taken down by EarnKit, 1 paid outside an award plan made on EarnKit, 1 live.",
  );
  assert.equal(
    trackRecordText(trackRecordOf([row()], W)),
    'This sponsor wallet has no earlier funded campaigns of 100 USDC or more on EarnKit.',
  );
});

test('trackRecordOf (review I3 PoC): dust, self-awarded and fallback awards never read as "awarded"', () => {
  // N dust campaigns self-funded and self-awarded: none count.
  const dust = Array.from({ length: 20 }, () =>
    row({
      state: 'awarded',
      amount: '0.01',
      award_source: 'sponsor',
      winners: [B],
    }),
  );
  // Just under the bar, and a non-USDC pool: don't count either.
  dust.push(
    row({
      state: 'awarded',
      amount: '99.999999',
      award_source: 'sponsor',
      winners: [B],
    }),
  );
  dust.push(
    row({
      state: 'awarded',
      amount: '500',
      token_symbol: 'WETH',
      award_source: 'sponsor',
      winners: [B],
    }),
  );
  assert.equal(trackRecordOf(dust, W).funded, 0);
  // At the bar: an award to the sponsor's own wallet (any case) is counted apart.
  const self = trackRecordOf(
    [
      row({
        state: 'awarded',
        award_source: 'sponsor',
        winners: [B, W.toUpperCase().replace('0X', '0x')],
      }),
    ],
    W,
  );
  assert.deepEqual([self.awarded, self.self_awarded], [0, 1]);
  // The operator's fallback, recorded or (older rows) inferred from a pending fallback plan.
  const fb = trackRecordOf(
    [
      row({ state: 'awarded', award_source: 'fallback', winners: [B] }),
      row({ state: 'awarded', fallback_plan: [{}], winners: [B] }),
    ],
    W,
  );
  assert.deepEqual([fb.awarded, fb.fallback, fb.funded], [0, 2, 2]);
  assert.match(
    trackRecordText(fb),
    /0 awarded by the sponsor, 2 paid by EarnKit's fallback, 0 refunded/,
  );
  assert.match(trackRecordText(self), /1 paid to the sponsor's own wallet/);
});

test('titleBrands: a title may mention a chain, but not read as by or official to it', () => {
  for (const ok of [
    'Build on Base',
    'Best x402 service on Base',
    'Arc payments sprint',
    'Agents on Monad',
    'Ship USDC payments on Arc and Base',
    'Basecamp grant', // not the brand word
    // USDC is the payout currency, never a title brand.
    '100 USDC grant',
    'USDC grants for agent builders',
    // Misspelled org words are out of scope.
    'Base Grantz',
  ]) {
    assert.deepEqual(titleBrands(ok), [], ok);
    assert.equal(reservedNameProblem(ok, null, 'title'), null, ok);
  }
  const refused: [string, string][] = [
    ['Base Builder Grants', 'base'],
    ['Official Mønad Grant', 'monad'],
    ['Grants by Coinbase', 'coinbase'],
    ['Arc Foundation bounty', 'arc'],
    ['Base', 'base'],
    ['Bɑse', 'base'], // look-alike, alone
    ['Payments sprint from Circle', 'circle'],
    ['Tempo Labs agents', 'tempo'],
    ['Build on Base (official)', 'base'],
    ['The Monad DAO prize', 'monad'],
    // Round 4: glued org words, "by the", the extra org words.
    ['Basegrants', 'base'],
    ['BaseGrants', 'base'],
    ['Hackathon by the Monad community', 'monad'],
    ['Presented by the Base', 'base'],
    ['Base Accelerator', 'base'],
    ['Coinbase Ventures bounty', 'coinbase'],
    ['Base Hackathon', 'base'],
    ['Tempo Studio jam', 'tempo'],
    ['Monad Collective prize', 'monad'],
    // Accepted false positive: the error says to reword or verify.
    ['Story arc program', 'arc'],
  ];
  for (const [title, brand] of refused) {
    assert.deepEqual(titleBrands(title), [brand], title);
    assert.ok(reservedNameProblem(title, null, 'title'), title);
  }
  // Verified on the brand's own domain: exempt.
  assert.equal(
    reservedNameProblem('Base Builder Grants', 'base.org', 'title'),
    null,
  );
});

// Re-audit H3 (econ/H3-brand-lookalikes.json) and pentest F1 (app/brand.mts): glued names, digit
// swaps, "EarnKit" in titles, and whole words in Canadian Syllabics or Coptic.
test('re-audit H3 / F1: glued, leet and EarnKit look-alikes are refused in names and titles', () => {
  const nameRefused = [
    'CoinbaseVentures',
    'CoinbaseVentures', // Coinbase_Ventures after the sanitizer drops "_"
    'EarnKitTeam',
    'EarnKitHQ',
    'EarnkitTeam',
    'MonadFoundation',
    'TempoLabs',
    'BaseGrants',
    'Arclabs',
    'RobinhoodGrants',
    'M0nad',
    'Rob1nhood',
    'Coin8ase',
    'Ba5e',
    'B@se',
    'Ba$e',
    '3arnKit',
    'Earn K1t',
    'C1rcle',
    'T3mpo',
    'M0nadFoundation',
  ];
  for (const n of nameRefused)
    assert.ok(reservedNameProblem(n, null), `name ${n}`);
  for (const t of [
    'EarnKit Prize Claim',
    'EarnKit support: approve USDC to verify',
    'EarnKit verified bounty',
    'EarnKit Rewards Round',
    'Season 2 of EarnKit',
    'Build with EarnKitHQ',
    'Build on 3arnkit',
    'CoinbaseVentures bounty',
  ])
    assert.ok(reservedNameProblem(t, null, 'title'), `title ${t}`);
  // Unaffected: real words that contain a brand, a chain named as where to build, digits.
  for (const ok of [
    'Basecamp',
    'Arcade',
    'Baseline',
    'Acme Labs',
    'Studio 54',
    'Team 8',
    'Web3 Builders',
  ])
    assert.equal(reservedNameProblem(ok, null), null, ok);
  for (const ok of [
    'Build on Base',
    'Payments on Monad 2026',
    'Agents 4 Base apps',
  ])
    assert.equal(reservedNameProblem(ok, null, 'title'), null, ok);
  // Whole words in Canadian Syllabics or Coptic: refused as special letters.
  for (const n of ['ᗷᗩᔕᗴ', 'ⲂⲀⲤⲈ', 'ⲃⲁⲥⲉ', 'ᗰOᑎᗩᗪ'])
    assert.ok(plainLettersProblem(n, 'sponsor_name'), n);
  assert.equal(plainLettersProblem('Café Zürich', 'sponsor_name'), null);
});
