import { CONFUSABLES } from './confusables-table';

/**
 * A confusable skeleton for matching sponsor names against reserved brands, plus a mixed-script
 * check. The table is generated from Unicode UTS #39 confusables.txt (confusables-table.ts,
 * scripts/gen-confusables.mts); a small supplement adds what UTS #39 leaves out on purpose
 * (stroke letters such as ł ø đ, small capitals, emoji-like enclosed letters).
 */

// [look-alikes, Latin letter], lowercase (looked up after lowercasing): stroke and hook letters
// UTS #39 treats as distinct, small capitals, and lowercase letters the table lists only in
// uppercase with another prototype (Cyrillic п, Greek η), and Coptic small letters.
const SUPPLEMENT: [string, string][] = [
  ['ⱥᴀⲁ', 'a'],
  ['ƀʙƅɓ', 'b'],
  ['ȼƈꞓ', 'c'],
  ['đᴅɗ', 'd'],
  ['ɇᴇⲉ', 'e'],
  ['ɢԍ', 'g'],
  ['ʜ', 'h'],
  ['ᴊ', 'j'],
  ['ƙĸᴋ', 'k'],
  ['łʟ', 'l'],
  ['ɱᴍʍմ', 'm'],
  ['ɴпη', 'n'],
  ['ø', 'o'],
  ['ᴘ', 'p'],
  ['ɍʀ', 'r'],
  ['ȿꞩʂⲋ', 's'],
  ['ŧƭᴛ', 't'],
];
const EXTRA = new Map<string, string>();
for (const [chars, latin] of SUPPLEMENT)
  for (const c of chars) EXTRA.set(c, latin);

/**
 * Common European letters that don't decompose under NFKD, and their plain spelling (lowercase;
 * looked up first). specialLetterWords allows them next to ASCII letters, which is safe only
 * because the skeleton maps every one of them, so "Mønad" and "Circłe" still read as brands.
 */
const EUROPEAN = new Map([
  ['ß', 'ss'],
  ['ø', 'o'],
  ['æ', 'ae'],
  ['œ', 'oe'],
  ['ł', 'l'],
  ['đ', 'd'],
  ['þ', 'th'],
  ['ð', 'd'],
  ['ı', 'i'],
  ['ħ', 'h'],
  ['ŋ', 'n'],
]);
// ẞ Ø Æ Œ Ł Đ Þ Ð Ħ Ŋ lowercase into the map above.
const EUROPEAN_LETTERS = /[ßẞøØæÆœŒłŁđĐþÞðÐıħĦŋŊ]/gu;

/** Negative circled/squared letters and regional indicators: emoji-like, no decomposition. */
const ENCLOSED: [number, number][] = [
  [0x1f150, 0x1f169], // negative circled A-Z
  [0x1f170, 0x1f189], // negative squared A-Z
  [0x1f1e6, 0x1f1ff], // regional indicators A-Z
];

/** One lowercased character -> ASCII, or itself. */
function latinOf(c: string): string {
  if (c < '\x80') return c;
  const european = EUROPEAN.get(c);
  if (european) return european;
  const cp = c.codePointAt(0)!;
  for (const [lo, hi] of ENCLOSED)
    if (cp >= lo && cp <= hi) return String.fromCharCode(97 + cp - lo);
  // The table lists some letters only in one case (Cyrillic "В" but not "в"), so the uppercase
  // form is tried too.
  return (
    CONFUSABLES.get(c) ?? EXTRA.get(c) ?? CONFUSABLES.get(c.toUpperCase()) ?? c
  );
}

/**
 * The skeleton of `s`: NFKD, combining marks dropped, lowercased, look-alikes mapped to ASCII
 * (UTS #39 table + supplement), lowercased again, any other non-ASCII character turned into a word
 * break (words are joined again when matching, so "B🚀ase" still reads "base"), then "d" -> "cl",
 * "l" -> "i" and "rn" -> "m" (so "Monacl", "CircIe" and "Ternpo" match; the skeleton isn't meant
 * to be read). Brands go through the same function, so both
 * sides compare equal. Pure; exported for tests.
 */
export const skeleton = (s: string) =>
  [...s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()]
    .map(latinOf)
    .join('')
    .toLowerCase()
    .replace(/[^\x00-\x7f]+/g, ' ')
    .replace(/d/g, 'cl')
    .replace(/l/g, 'i')
    .replace(/rn/g, 'm');

// Scripts whose letters pass for Latin ones.
const LOOKALIKE_SCRIPTS =
  /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}\p{Script=Lisu}\p{Script=Coptic}]/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * Words (runs of letters and digits) that mix Latin with a look-alike script, e.g. "Bаse" with a
 * Cyrillic a. A name wholly in one script is fine. Pure; exported for tests.
 */
export function mixedScriptWords(name: string) {
  return name
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => LATIN.test(w) && LOOKALIKE_SCRIPTS.test(w));
}

/**
 * Words (runs of letters and digits, after NFKD and dropping marks) that mix ASCII letters with
 * any other letter: "Roƀinhood" (ƀ), "Mɵnad", "Bаse". "Café" (e + mark), all-Cyrillic words and the
 * common European letters in EUROPEAN ("Straße", "København", "Łódź") are not. Pure; exported for
 * tests.
 */
export function specialLetterWords(s: string) {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (w) =>
        /[A-Za-z]/.test(w) &&
        /[^\x00-\x7f]/.test(w.replace(EUROPEAN_LETTERS, '')),
    );
}
