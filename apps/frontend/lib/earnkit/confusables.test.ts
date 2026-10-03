import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  brandSkeletons,
  mixedScriptWords,
  skeleton,
  specialLetterWords,
} from './confusables';
import { CONFUSABLES_VERSION } from './confusables-table';
import {
  mixedScriptProblem,
  plainLettersProblem,
  reservedBrands,
  titleBrands,
} from './sponsor-identity';

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

// Re-review round 4 (t4/r23.mts): hooked, barred and stroked Latin letters, and other scripts.
const R23 = [
  'Roƀinħood',
  'Mɵnad',
  'Monaɖ',
  'Teʈpo',
  'Temƥo',
  'Temᵽo',
  'Cɨrcle',
  'UꞨDC',
  'Ciɾcle',
  'Ciɫcle',
  'Ciƚcle',
  'ᵬase',
  'Moꞑad',
  'Moɲad',
  'Earnⱪit',
  'Baᶊe',
  'Coiɳbase',
  'Toƙens.fun',
  'Tokens.ꞙun',
  'Aɽc',
  'Aꞧc',
  'Arɕ',
  'Mөnad',
  'Robinհood',
  'Bαѕе',
  'ᏴᎪՏᎬ',
  'Ⲃⲁⲋⲉ',
  'ꓐꓮꓢꓰ',
  '𐊂ase',
  'Tempꝋ',
  'Robinhꝍod',
  'Baꜱe',
  'Monaȡ',
  'ꮃonad',
  'Mоnаd',
];

test('round 4 (r23 probes): every special-letter or look-alike brand is refused in names and titles', () => {
  for (const n of R23)
    for (const field of ['sponsor_name', 'title'] as const) {
      const text = field === 'title' ? `Official ${n} Grant` : n;
      const refused =
        plainLettersProblem(text, field) ??
        mixedScriptProblem(text, field) ??
        (reservedBrands(text).length > 0 ? 'reserved' : null);
      assert.ok(refused, `${field}: ${text}`);
    }
  // Plain letters with a special form inside a word: the exact refusal.
  assert.equal(
    plainLettersProblem('Mɵnad', 'sponsor_name'),
    'sponsor_name: "Mɵnad". Use plain letters in names and titles (no special letter forms).',
  );
  // Whole words in another script: allowed by this rule, caught by the skeleton when a brand.
  for (const n of ['ᏴᎪՏᎬ', 'Ⲃⲁⲋⲉ', 'ꓐꓮꓢꓰ', 'Ваѕе', 'Μοηαԁ']) {
    assert.equal(plainLettersProblem(n, 'sponsor_name'), null, n);
    assert.ok(reservedBrands(n).length > 0, n);
  }
});

test('round 4: accented names decompose to plain letters and pass; whole-word other scripts pass', () => {
  for (const ok of [
    'Café Labs',
    'Zürich Builders',
    'Ångström',
    'Crème Brûlée Co',
    'Привет мир',
    'Acme 東京',
    'x402 Agents',
  ]) {
    assert.deepEqual(specialLetterWords(ok), [], ok);
    assert.equal(plainLettersProblem(ok, 'title'), null, ok);
  }
});

test('round 5: common European letters pass the plain-letters rule but still map in the skeleton', () => {
  for (const ok of [
    'Straße',
    'København',
    'Łódź Labs',
    'Æsir DAO',
    'Øresund Builders',
    'Þórr Ðóttir Ħal Ŋaa ẞIG',
  ]) {
    assert.equal(plainLettersProblem(ok, 'sponsor_name'), null, ok);
    assert.equal(plainLettersProblem(ok, 'title'), null, ok);
    assert.deepEqual(reservedBrands(ok), [], ok);
  }
  const cases: [string, string][] = [
    ['Straße', 'strasse'],
    ['Æsir', 'aesir'],
    ['Œuvre', 'oeuvre'],
    ['Þing', 'thing'],
    ['Ħub', 'hub'],
    ['Ŋana', 'nana'],
  ];
  for (const [s, plain] of cases) assert.equal(skeleton(s), skeleton(plain), s);
  // Allowed letters, but the brand check still refuses them.
  const brands: [string, string][] = [
    ['Mønad', 'monad'],
    ['Circłe', 'circle'],
    ['Robinhøød', 'robinhood'],
    ['Cøinbase', 'coinbase'],
    ['Monađ', 'monad'],
    ['Robinħood', 'robinhood'],
    ['Earnkıt', 'earnkit'],
  ];
  for (const [n, brand] of brands)
    assert.deepEqual(reservedBrands(n), [brand], n);
  // Any other non-ASCII letter mixed into an ASCII word stays refused (ƀ next to the allowed ħ).
  assert.ok(plainLettersProblem('Roƀinħood', 'sponsor_name'));
  assert.ok(plainLettersProblem('Mɵnad', 'sponsor_name'));
});

test('round 6: special Latin letters are refused with no ASCII letter; ß/þ/ð also read as b/p/o', () => {
  // Whole words of special Latin letters: refused by the plain-letters rule.
  for (const n of ['ɱɵɲɑɖ', 'ƈɨɾƈʟɇ'])
    for (const field of ['sponsor_name', 'title'] as const)
      assert.ok(plainLettersProblem(n, field), `${field}: ${n}`);
  // European letters that look like another: allowed letters, but a brand in the look-alike reading.
  const brands: [string, string][] = [
    ['ẞase', 'base'],
    ['Coinßase', 'coinbase'],
    ['Temþo', 'tempo'],
    ['Mðnad', 'monad'],
  ];
  for (const [n, brand] of brands) {
    assert.equal(plainLettersProblem(n, 'sponsor_name'), null, n);
    assert.deepEqual(reservedBrands(n), [brand], n);
    assert.deepEqual(titleBrands(`Official ${n} Grant`), [brand], n);
  }
  assert.deepEqual(brandSkeletons('Coinßase'), ['coinssase', 'coinbase']);
  assert.deepEqual(brandSkeletons('Café'), ['cafe']);
  // Real European words still pass both rules.
  for (const ok of ['Straße', 'København', 'Łódź Labs', 'Café Labs']) {
    assert.deepEqual(specialLetterWords(ok), [], ok);
    assert.equal(plainLettersProblem(ok, 'title'), null, ok);
    assert.deepEqual(reservedBrands(ok), [], ok);
  }
});
