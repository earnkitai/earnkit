import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixedScriptWords, skeleton } from './confusables';
import { mixedScriptProblem, reservedBrands } from './sponsor-identity';

test('skeleton: look-alikes from other scripts fold to Latin', () => {
  const cases: [string, string][] = [
    ['Base', 'base'],
    ['Bâsé', 'base'], // marks dropped after NFKD
    ['Ｂase', 'base'], // fullwidth (NFKD)
    ['𝐁𝐚𝐬𝐞', 'base'], // math bold (NFKD)
    ['ⓑⓐⓢⓔ', 'base'], // circled (NFKD)
    ['ℬase', 'base'], // letterlike script B (NFKD)
    ['🅱ase', 'base'], // negative squared B (no decomposition)
    ['🄱ase', 'base'], // squared B (NFKD)
    ['Bɑse', 'base'], // Latin alpha (IPA)
    ['ʙase', 'base'], // small capital B
    ['Ƅase', 'base'], // tone six
    ['Bꭤse', 'base'], // Latin small letter a with... (Latin Extended-E)
    ['Ꮯircle', 'circie'], // Cherokee C (l folds to i on both sides)
    ['ꮯircle', 'circie'], // Cherokee small letter
    ['ꓚircle', 'circie'], // Lisu
    ['Βase', 'base'], // Greek Beta
    ['аеосрх', 'aeocpx'], // Cyrillic а е о с р х
    ['АЕОСРХ', 'aeocpx'], // and their capitals
    ['CircIe', 'circie'], // capital I for l
    ['Ternpo', 'tempo'], // rn for m
  ];
  for (const [s, want] of cases) assert.equal(skeleton(s), want, s);
});

test('reservedBrands (review I2 PoCs): homoglyph names are reserved', () => {
  const cases: [string, string][] = [
    ['Bɑse', 'base'],
    ['ʙase', 'base'],
    ['Ƅase', 'base'],
    ['Bꭤse', 'base'],
    ['Ꮯircle', 'circle'],
    ['ꓚircle', 'circle'],
    ['🅱ase', 'base'],
    // Cyrillic а е о с р х inside Latin words.
    ['Bаse', 'base'],
    ['Basе', 'base'],
    ['Cоinbase', 'coinbase'],
    ['сircle', 'circle'],
    ['Tempо', 'tempo'],
    ['Robinhооd', 'robinhood'],
    ['Еarnkit', 'earnkit'],
    ['ᎪRC', 'arc'], // Cherokee A
    ['Mоnаd Labs', 'monad'],
  ];
  for (const [name, brand] of cases)
    assert.deepEqual(reservedBrands(name), [brand], name);
  // Ordinary names stay free.
  for (const name of ['Basecamp', 'Acme Labs', 'Café Olé', 'Arcade', 'Hello'])
    assert.deepEqual(reservedBrands(name), [], name);
});

test('mixedScriptWords: Latin mixed with a look-alike script inside one word', () => {
  assert.deepEqual(mixedScriptWords('Bаse Grants'), ['Bаse']); // Cyrillic а
  assert.deepEqual(mixedScriptWords('Ꮯircle'), ['Ꮯircle']); // Cherokee
  assert.deepEqual(mixedScriptWords('ꓚircle'), ['ꓚircle']); // Lisu
  assert.deepEqual(mixedScriptWords('Ηello'), ['Ηello']); // Greek Eta
  assert.deepEqual(mixedScriptWords('Τοkens'), ['Τοkens']);
  // One script per word is fine, even across words.
  assert.deepEqual(mixedScriptWords('Acme Labs'), []);
  assert.deepEqual(mixedScriptWords('Привет мир'), []);
  assert.deepEqual(mixedScriptWords('Acme Привет'), []);
  assert.deepEqual(mixedScriptWords('Café Ünïcode'), []);
  assert.equal(mixedScriptProblem('Acme Labs'), null);
  assert.match(
    mixedScriptProblem('Bаse Grants')!,
    /^sponsor_name: "Bаse Grants" mixes Latin letters with look-alike letters/,
  );
});
