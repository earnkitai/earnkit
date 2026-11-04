/**
 * Text from the open web that reaches agents and people: one sanitizer. An allowlist of plain
 * characters after NFKC, then a refusal of links (bare, defanged and look-alike domains, URI
 * schemes, IP literals) and HTML entities, within a fixed length.
 */
import { DOT_LOOKALIKES } from './confusables';

export class UntrustedTextError extends Error {}

export type TextRule = {
  max: number;
  singleLine?: boolean;
};

const LETTER = /\p{L}/u;
const KEEP = /[\p{L}\p{N} .,:;!?'()&+\-/#@%$*=\u2013\u2014]/u;
const PICTO = /\p{Extended_Pictographic}/u;
const MARK = /\p{M}/u;
const ZWJ = '\u200D';
// Letters and marks that render as nothing: Hangul fillers, Khmer inherent vowels, combining
// grapheme joiner, variation selectors (incl. Mongolian).
const BLANK =
  /[\u115F\u1160\u3164\uFFA0\u17B4\u17B5\u034F\u180B-\u180F\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
// Every quotation mark (ASCII, curly, low-9, guillemets, CJK, fullwidth, backtick, primes and
// look-alike modifier letters such as U+02BA, Hebrew geresh/gershayim, ditto) becomes '.
const QUOTES =
  /["`\p{Pi}\p{Pf}\u02BA\u02DD\u02EE\u05F3\u05F4\u2032-\u2037\u3003\u201A\u201B\u201E\u201F\u275D-\u2760\u300C-\u300F\u301D-\u301F\uFF02\uFF07]/gu;
// Middle dots and look-alikes (incl. U+1427, a letter) read like EarnKit's " · " separator: a space.
const SEPARATORS = /[\u00B7\u0387\u1427\u2E31\u22C5\u2027\u2219\u30FB\uFF65]/gu;
const UNASSIGNED = /\p{Cn}/u;
// Confusable and defanged dots, mapped to "." so a hidden domain is still seen as one. Bounded
// repeats only (every regex in this file runs in linear time; see the timing test).
const DOTS = /[\u3002\uFF61\uFE52]|[[(] {0,3}(?:\.|dot) {0,3}[\])]/giu;
// Letters, marks and punctuation that look like a dot (confusables.ts), read as "." too.
const DOT_LIKE = new RegExp(`[${DOT_LOOKALIKES}]`, 'gu');

/** Raw input past this is rejected before any normalization or regex runs. */
export const RAW_CAP = 4096;

/**
 * The allowlist: after NFKC, keeps letters, numbers, spaces (and newlines when multi-line), a
 * fixed punctuation set, en/em dashes, emoji (a ZWJ only between two of them), and up to two
 * combining marks right after a letter. Everything else is dropped.
 */
function allow(value: string, singleLine: boolean) {
  const cs = [
    ...value
      // Before NFKC too: some look-alikes (e.g. U+02DD) decompose into a space and a mark.
      .replace(QUOTES, "'")
      .normalize('NFKC')
      .replace(QUOTES, "'")
      .replace(SEPARATORS, ' ')
      .replace(/\r\n|[\r\u2028\u2029\u0085]/g, '\n')
      .replace(singleLine ? /[\p{Zs}\t\v\f\n]/gu : /[\p{Zs}\t\v\f]/gu, ' ')
      .replace(DOTS, '.')
      .replace(DOT_LIKE, '.'),
  ];
  let out = '';
  let prev = '';
  let marks = 0;
  cs.forEach((c, i) => {
    let keep = false;
    if (BLANK.test(c) || UNASSIGNED.test(c)) keep = false;
    else if (MARK.test(c)) keep = LETTER.test(prev) && marks < 2;
    else if (c === ZWJ) keep = PICTO.test(prev) && PICTO.test(cs[i + 1] ?? '');
    else keep = KEEP.test(c) || PICTO.test(c) || (c === '\n' && !singleLine);
    if (!keep) return;
    out += c;
    if (MARK.test(c)) marks++;
    else {
      prev = c;
      marks = 0;
    }
  });
  return out
    .replace(/ {2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Library names that look like domains but are normal in a brief. */
const TECH_WORDS = new Set([
  'node.js',
  'next.js',
  'vue.js',
  'nuxt.js',
  'three.js',
  'd3.js',
  'express.js',
  'socket.io',
  'ethers.js',
  'web3.js',
  'viem.sh',
]);
const RUN_CHAR = /[\p{L}\p{N}-]/u;
const TLD_PART = /^\p{L}{2,24}(?![\p{L}\p{N}])/u;

/** Any `word.letters{2,24}` in one word, other than a known library name. Linear: one pass per part. */
export function hasDomain(word: string) {
  const parts = word.split('.');
  for (let i = 1; i < parts.length; i++) {
    const tld = TLD_PART.exec(parts[i]);
    if (!tld) continue;
    const left = parts[i - 1];
    let j = left.length;
    while (j > 0 && RUN_CHAR.test(left[j - 1])) j--;
    if (j === left.length) continue;
    if (!TECH_WORDS.has(`${left.slice(j)}.${tld[0]}`.toLowerCase()))
      return true;
  }
  return false;
}

/** Link patterns checked per word: fixed-width or bounded repeats only. */
const WORD_LINKS = [
  /(?:^|[^a-z0-9])www\./i,
  /h[tx][tx]ps?:/i,
  /\b(?:javascript|vbscript|mailto|file|magnet|ipfs):/i,
  // In prose "SMS: …" ends the word at the colon; a link continues.
  /\b(?:tel|sms|intent):./i,
  /%2[ef]|%3a/i,
  /\bdata:(?:[a-z]{1,20}\/|,)/i,
  /(?<!\d)\d{1,3}(?:\.\d{1,3}){3}(?!\d)/,
];
const IPV6 = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
const ENTITY = /&#?[a-z0-9]{1,32};|&#x?[0-9a-f]/i;
// "evil . xyz/path": a dot with spaces around it, then a lowercase name and a slash.
const SPACED_DOMAIN =
  /\p{L} {1,3}\. {0,3}[a-z]{2,24}\/|\p{L}\. {1,3}[a-z]{2,24}\//u;
const stripMarks = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');

/** On the text and on its NFD form without accents ("evil.cóm" is evil.com). */
const hasLink = (s: string) => linkIn(s) || linkIn(stripMarks(s));

function linkIn(s: string) {
  if (s.includes('://') || SPACED_DOMAIN.test(s)) return true;
  const words = s.split(/[ \n]/);
  return words.some(
    (w) =>
      WORD_LINKS.some((re) => re.test(w)) ||
      [...w.matchAll(IPV6)].some(
        ([m]) => m.includes('::') || m.split(':').length > 5,
      ) ||
      hasDomain(w),
  );
}

// Single-line fields (names, titles, reasons; shown quoted or as one line): "@acme" handles and
// 7+ digit runs ("+1 415 555 0100"), year ranges ("2026-2027") aside. Multi-line fields get no
// such word rules: they refused real program text.
const AT = /@/;
const DIGIT_RUN = /\d(?:[ .()\-\u2013\u2014/]?\d){6}/;
const YEAR_RANGE = /\b\d{4} ?[-\u2013\u2014/] ?\d{4}\b/g;

/** What gets cleaned text rejected, with the word used in the error. */
const REJECT: [(s: string) => boolean, string][] = [
  [hasLink, 'links'],
  [(s) => ENTITY.test(s), 'HTML entities'],
];
const REJECT_IN_NAMES: [(s: string) => boolean, string][] = [
  [(s) => AT.test(s), '@ signs'],
  [
    (s) => DIGIT_RUN.test(s.replace(YEAR_RANGE, '')),
    'runs of 7 or more digits',
  ],
];

/**
 * Cleans third-party text, or throws an error naming the field: oversized raw input is refused
 * first (before any normalization or regex), then the allowlist (`allow`), then rejected if it
 * holds a link (incl. defanged forms, bare domains, IP literals, URI schemes) or an HTML entity,
 * or is longer than `max` after cleaning.
 */
export function cleanText(
  value: string,
  { max, singleLine = false, field = 'text' }: TextRule & { field?: string },
) {
  if (value.length > max * 4 || value.length > RAW_CAP)
    throw new UntrustedTextError(
      `${field}: at most ${max} characters (got ${value.length}).`,
    );
  const s = allow(value, singleLine);
  for (const [bad, what] of singleLine
    ? [...REJECT, ...REJECT_IN_NAMES]
    : REJECT)
    if (bad(s))
      throw new UntrustedTextError(
        `${field}: ${what} aren't allowed; this text is shown to other people's agents. Use plain words.`,
      );
  const length = [...s].length;
  if (length > max)
    throw new UntrustedTextError(
      `${field}: at most ${max} characters (got ${length}).`,
    );
  return s;
}
