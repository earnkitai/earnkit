/**
 * Safe text (v6.1.16 Task 11, L24-7, L24-21, L24-24): the one cleaner every input reader uses for builder-, agent- and
 * applicant-written text. Pure.
 *
 * `cleanText(s, max)`: tabs and line breaks (CR, LF, NEL, U+2028, U+2029) become a space; every control or format
 * character (NUL, bidi overrides U+202A to U+202E, isolates U+2066 to U+2069, zero-width space, BOM, word joiner), every
 * unassigned and private-use code point, and the invisible Hangul fillers are dropped, except a zero-width
 * joiner or non-joiner between two letters of one joining script (Arabic, Syriac, N'Ko, Mongolian, the Indic scripts)
 * or inside an emoji sequence; a joiner between two Latin letters is dropped. Runs of spaces collapse, the ends are
 * trimmed, and the text is cut to `max` code points.
 */
const JOINING_SCRIPTS = [
  'Arabic', 'Syriac', 'Nko', 'Mongolian', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati', 'Oriya', 'Tamil', 'Telugu',
  'Kannada', 'Malayalam', 'Sinhala',
].map((s) => new RegExp(String.raw`^[\p{scx=${s}}]$`, 'u'));
const EMOJI_BEFORE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0F}]$/u;
const EMOJI_AFTER = /^\p{Extended_Pictographic}$/u;
const JOINER = /^[\u200c\u200d]$/;
const isLetterish = (c: string) => /^[\p{L}\p{M}]$/u.test(c);

/** A joiner stays only between two letters of one joining script, or between two parts of an emoji sequence. */
function joinerKept(before: string | undefined, after: string | undefined): boolean {
  if (!before || !after) return false;
  if (EMOJI_BEFORE.test(before) && EMOJI_AFTER.test(after)) return true;
  if (!isLetterish(before) || !isLetterish(after)) return false;
  return JOINING_SCRIPTS.some((re) => re.test(before) && re.test(after));
}

/** Fix round 1 (M2): every line break, NEL and the line and paragraph separators included, reads as a space. */
const LINE_BREAKS = /[\t\n\r\u0085\u2028\u2029]/g;
/** Fix round 1 (M2): invisible Hangul fillers that render as nothing (U+115F, U+1160, U+3164, U+FFA0). */
const HANGUL_FILLERS = /[\u115f\u1160\u3164\uffa0]/g;

export function cleanText(s: string, max: number): string {
  const kept = Array.from(s.replace(LINE_BREAKS, ' ').replace(HANGUL_FILLERS, '').replace(/[^\P{C}\u200c\u200d]/gu, ''));
  const out: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const c = kept[i];
    if (JOINER.test(c) && !joinerKept(out[out.length - 1], kept[i + 1])) continue;
    out.push(c);
  }
  let t = out.join('').replace(/ {2,}/g, ' ').trim();
  if (Number.isFinite(max) && Array.from(t).length > max) {
    t = Array.from(t).slice(0, Math.max(0, max)).join('').trim().replace(/[\u200c\u200d]+$/u, '');
  }
  return t;
}

/**
 * Prose as saved (L24-21): each line through `cleanText` with no cap, line breaks kept (CR LF read as one), so a NUL or
 * a bidi override inside a bio is dropped and the field saves. Pure.
 */
export const cleanProse = (s: string): string =>
  s.replace(/\r\n?|[\u0085\u2028\u2029]/g, '\n').split('\n').map((l) => cleanText(l, Infinity)).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * A builder- or agent-written name as shown to a person or another agent (L24-1): `cleanText` to `max` (40; an agent's
 * name passes 60, L43-14 v6.1.19, the cut `displayName` made) inside straight double quotes, any `"` inside turned to
 * `'`. Pure.
 */
export const quoteName = (s: string, max = 40): string => `"${cleanText(s, max).replace(/"/g, "'")}"`;

/** @deprecated v6.1.16: `cleanText(s, Infinity)`; kept one release (dropped in v6.1.17). */
export const dropControls = (s: string): string => cleanText(s, Infinity);
