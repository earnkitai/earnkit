import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProse, cleanText, dropControls, quoteName } from './controls';

const RLO = '‮', LRI = '⁦', PDI = '⁩', ZWSP = '​', ZWJ = '‍', ZWNJ = '‌', BOM = '﻿', WJ = '⁠', NUL = '\u0000';

test('L24-24: Ti{ZWSP}mer{ZWJ}{BOM}{WJ}App reads TimerApp', () => {
  assert.equal(cleanText(`Ti${ZWSP}mer${ZWJ}${BOM}${WJ}App`, 80), 'TimerApp');
});

test('cleanText drops bidi overrides, isolates, zero-width marks and NUL, and turns CR, LF and tab into one space', () => {
  assert.equal(cleanText(`a${RLO}b${LRI}c${PDI}d${NUL}e\r\nf\tg`, 80), 'abcde f g');
  assert.equal(cleanText(`  one   two  `, 80), 'one two');
  assert.equal(cleanText(`a${ZWJ}b`, 80), 'ab');
  assert.equal(dropControls(`x${RLO}y`), 'xy');
});

test('cleanText keeps a joiner between two letters of one joining script and inside an emoji sequence', () => {
  const persian = `می${ZWNJ}خواهم`;
  assert.equal(cleanText(persian, 80), persian);
  const arabicZwj = `ل${ZWJ}ا`;
  assert.equal(cleanText(arabicZwj, 80), arabicZwj);
  const devanagari = `क्${ZWJ}ष`;
  assert.equal(cleanText(devanagari, 80), devanagari);
  const family = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;
  assert.equal(cleanText(family, 80), family);
  assert.equal(cleanText(`ل${ZWJ}a`, 80), 'لa', 'two scripts: dropped');
});

test('cleanText cuts to max code points and trims', () => {
  assert.equal(cleanText('abc def', 4), 'abc');
  assert.equal(cleanText('\u{1F600}'.repeat(5), 3), '\u{1F600}'.repeat(3));
});

test('cleanProse keeps line breaks and drops a NUL and an override inside a line', () => {
  assert.equal(cleanProse(`Hi${NUL}there\r\nline ${RLO}two`), 'Hithere\nline two');
});

test('quoteName: cleaned, at most 40, inside straight double quotes, inner quotes turned to single', () => {
  assert.equal(quoteName(`Timer${RLO}App`), '"TimerApp"');
  assert.equal(quoteName('a "b" c'), `"a 'b' c"`);
  assert.equal(quoteName('x'.repeat(60)), `"${'x'.repeat(40)}"`);
});
