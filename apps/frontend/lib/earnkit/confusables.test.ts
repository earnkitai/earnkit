import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixedScriptWords, skeleton } from './confusables';
import { CONFUSABLES_VERSION } from './confusables-table';
import { mixedScriptProblem, reservedBrands } from './sponsor-identity';

test('skeleton: look-alikes from other scripts fold to the plain spelling', () => {
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
    ['Bꭤse', 'base'],
    ['Ꮯircle', 'circle'], // Cherokee C
    ['ꮯircle', 'circle'], // Cherokee small letter
    ['ꓚircle', 'circle'], // Lisu
    ['Βase', 'base'], // Greek Beta
    ['аеосрх', 'aeocpx'], // Cyrillic а е о с р х
    ['АЕОСРХ', 'aeocpx'], // and their capitals
    ['CircIe', 'circle'], // capital I for l
    ['Ternpo', 'tempo'], // rn for m
    ['Monacl', 'monad'], // cl for d
  ];
  for (const [s, plain] of cases) assert.equal(skeleton(s), skeleton(plain), s);
  // Plain ASCII only, whatever the input; other characters become word breaks.
  assert.equal(skeleton('B🚀ase 東京'), 'b ase  ');
  assert.match(CONFUSABLES_VERSION, /^\d+\.\d+\.\d+$/);
});

test('reservedBrands (re-review I2 PoCs, skel2.mts): every look-alike brand is reserved', () => {
  const cases: [string, string][] = [
    // fullwidth / math / letterlike
    ['Ｂａｓｅ', 'base'],
    ['𝐁𝐚𝐬𝐞', 'base'],
    ['𝔅𝔞𝔰𝔢', 'base'],
    ['𝕭𝖆𝖘𝖊', 'base'],
    ['𝖡𝖺𝗌𝖾', 'base'],
    ['ℬase', 'base'],
    ['Ｃｉｒｃｌｅ', 'circle'],
    ['𝙐𝙎𝘿𝘾', 'usdc'],
    // whole-word Cyrillic / Greek (single script)
    ['Ваѕе', 'base'],
    ['ВАЅЕ', 'base'],
    ['Агс', 'arc'],
    ['Темро', 'tempo'],
    ['ТЕМРО', 'tempo'],
    ['Мопаԁ', 'monad'],
    ['Μοηαԁ', 'monad'],
    ['гоЬіпһооԁ', 'robinhood'],
    ['Сігсӏе', 'circle'],
    // uppercase of mapped lowercase; Armenian
    ['ՍЅDС', 'usdc'],
    ['ՍSDC', 'usdc'],
    ['Moոad', 'monad'],
    ['Մonad', 'monad'],
    // Latin letters with strokes and hooks (no NFKD decomposition)
    ['Circłe', 'circle'],
    ['Mønad', 'monad'],
    ['Tempø', 'tempo'],
    ['Cøinbase', 'coinbase'],
    ['Robinhøød', 'robinhood'],
    ['Bⱥse', 'base'],
    ['Baȿe', 'base'],
    ['Basɇ', 'base'],
    ['ƀase', 'base'],
    ['Ƀase', 'base'],
    ['Ꞵase', 'base'],
    ['ȼircle', 'circle'],
    ['Ꞓircle', 'circle'],
    ['Monađ', 'monad'],
    ['Arƈ', 'arc'],
    ['Aɍc', 'arc'],
    ['Tеmpo', 'tempo'],
    ['Ŧempo', 'tempo'],
    ['Tęmpo', 'tempo'],
    ['EarnƘit', 'earnkit'],
    ['Earnĸit', 'earnkit'],
    ['Baꞩe', 'base'],
    ['ꓴSDC', 'usdc'],
    ['UꞨDC', 'usdc'],
    ['ŰSDC', 'usdc'],
    ['Monacl', 'monad'],
    ['Earnkıt', 'earnkit'],
    ['Ɑrc', 'arc'],
    ['Ʀobinhood', 'robinhood'],
    ['Tokensꬵun', 'tokensfun'],
    ['Ƭempo', 'tempo'],
    ['ʍonad', 'monad'],
    ['Ɱonad', 'monad'],
    ['Arç', 'arc'],
  ];
  for (const [name, brand] of cases)
    assert.deepEqual(reservedBrands(name), [brand], name);
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
