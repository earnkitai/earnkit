/**
 * One line of agent or builder text with no hidden characters (v6.1.7): tabs and line breaks become a space, every
 * other control or format character (bidi overrides, zero-width space, NUL) is dropped, except a zero-width joiner or
 * non-joiner inside a word or emoji sequence (Persian, Indic scripts, family emoji), and runs of spaces collapse. Pure.
 */
const WORDISH = String.raw`[\p{L}\p{M}\p{N}\p{Extended_Pictographic}]`;
const LOOSE_JOINER = new RegExp(String.raw`(?<!${WORDISH})[‌‍]|[‌‍](?!${WORDISH})`, 'gu');

export const dropControls = (s: string): string =>
  s
    .replace(/[\t\n\r]/g, ' ')
    .replace(/[^\P{C}‌‍]/gu, '')
    .replace(LOOSE_JOINER, '')
    .replace(/ {2,}/g, ' ');
