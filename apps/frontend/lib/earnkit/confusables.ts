/**
 * A small confusable skeleton (UTS #39-lite) for matching sponsor names against reserved brands,
 * plus a mixed-script check. Not a general-purpose confusables table: it covers the look-alikes of
 * Latin letters that can survive the text sanitizer (Greek, Cyrillic, Armenian, IPA, small
 * capitals, Cherokee, Lisu, enclosed and squared letters); letterlike symbols, math alphanumerics,
 * fullwidth, circled and superscript letters already fold under NFKD.
 */

// [look-alikes, Latin letter]. Uppercase and lowercase look-alikes are both listed: this runs
// before lowercasing.
const GROUPS: [string, string][] = [
  ['ΑАᎪꓮᴀɑꭤαа⍺', 'a'],
  ['ΒВᏴꓐʙƄƅЬьɓβв', 'b'],
  ['СϹᏟꓚᴄϲсⅽ', 'c'],
  ['Ꭰꓓᴅԁꓒɗ', 'd'],
  ['ΕЕᎬꓰᴇеҽε', 'e'],
  ['ꓝϜ', 'f'],
  ['Ꮐꓖɢɡԍ', 'g'],
  ['ΗНҺᎻꓧʜһ', 'h'],
  ['ΙІӀᎥꓲɪіιıǀ', 'i'],
  ['ЈᎫꓙᴊјϳ', 'j'],
  ['ΚКᏦꓗᴋκк', 'k'],
  ['Ꮮꓡʟӏ', 'l'],
  ['ΜМᎷꓟᴍм', 'm'],
  ['Νꓠɴո', 'n'],
  ['ΟОՕꓳᴏοоօσ', 'o'],
  ['ΡРᏢꓑᴘρр', 'p'],
  ['ᏒᎡꓣʀгᴦ', 'r'],
  ['ЅᏚꓢꜱѕʂ', 's'],
  ['ΤТᎢꓔᴛτт', 't'],
  ['ꓴᴜυս', 'u'],
  ['Ꮩꓦᴠνѵ', 'v'],
  ['Ꮃꓪᴡԝѡ', 'w'],
  ['ΧХꓫχх', 'x'],
  ['ΥУҮᎩꓬʏүу', 'y'],
  ['ΖᏃꓜᴢ', 'z'],
];
const MAP = new Map<string, string>();
for (const [chars, latin] of GROUPS) for (const c of chars) MAP.set(c, latin);

/** Negative circled/squared letters and regional indicators: emoji-like, no decomposition. */
const ENCLOSED: [number, number][] = [
  [0x1f150, 0x1f169], // negative circled A-Z
  [0x1f170, 0x1f189], // negative squared A-Z
  [0x1f1e6, 0x1f1ff], // regional indicators A-Z
];

function latinOf(c: string): string {
  const cp = c.codePointAt(0)!;
  for (const [lo, hi] of ENCLOSED)
    if (cp >= lo && cp <= hi) return String.fromCharCode(97 + cp - lo);
  // Cherokee small letters fold to the capitals listed above.
  if (cp >= 0xab70 && cp <= 0xabbf) return MAP.get(c.toUpperCase()) ?? c;
  return MAP.get(c) ?? c;
}

/**
 * The skeleton of `s`: NFKD, combining marks dropped, look-alikes mapped to Latin, lowercased,
 * then "l" -> "i" and "rn" -> "m" (so "CircIe" and "Ternpo" match). Brands go through the same
 * function, so both sides compare equal. Pure; exported for tests.
 */
export const skeleton = (s: string) =>
  [...s.normalize('NFKD').replace(/\p{M}/gu, '')]
    .map(latinOf)
    .join('')
    .toLowerCase()
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
