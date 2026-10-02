import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  earnkitTxtNames,
  nameWords,
  reservedBrands,
  reservedNameProblem,
  sponsorHost,
  sponsorLabel,
  trackRecordOf,
  trackRecordText,
} from './sponsor-identity';

const W = '0x1111111111111111111111111111111111111111';

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
  assert.deepEqual(nameWords('Ｂase Builders'), ['base', 'builders']);
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
  assert.ok(reservedNameProblem('Base', 'www.base.org'));
  assert.ok(reservedNameProblem('Coinbase', 'base.org'));
  // Verified on the brand's own domain: allowed.
  assert.equal(reservedNameProblem('Base', 'base.org'), null);
  assert.equal(reservedNameProblem('Base Builders', 'base.dev'), null);
  assert.equal(reservedNameProblem('USDC Rewards', 'circle.com'), null);
  assert.equal(reservedNameProblem('tokens.fun', 'tokens.fun'), null);
  assert.equal(reservedNameProblem('EarnKit', 'earnkit.com'), null);
  // Two brands: one domain can't cover both.
  assert.ok(reservedNameProblem('Base x Circle', 'base.org'));
  // Not reserved: any sponsor, verified or not.
  assert.equal(reservedNameProblem('Acme Labs', null), null);
});

test('trackRecordOf: only campaigns that reached the chain count', () => {
  const t = trackRecordOf([
    { state: 'live', n: 1 },
    { state: 'awarded', n: 2 },
    { state: 'refunded', n: 1 },
    { state: 'taken_down', n: 1 },
    { state: 'expired', n: 9 },
    { state: 'draft', n: 4 },
  ]);
  assert.deepEqual(t, {
    funded: 5,
    live: 1,
    awarded: 2,
    refunded: 1,
    taken_down: 1,
  });
  assert.equal(
    trackRecordText(t),
    'This sponsor wallet has funded 5 campaigns on EarnKit: 2 awarded, 1 refunded with no winners, 1 taken down by EarnKit, 1 live.',
  );
  assert.equal(
    trackRecordText(trackRecordOf([{ state: 'live', n: 1 }])),
    "This is the sponsor wallet's first funded campaign on EarnKit.",
  );
});
