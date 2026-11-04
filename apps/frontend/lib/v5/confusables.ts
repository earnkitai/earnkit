/**
 * Characters that pass for a full stop, so link detection (untrusted-text.ts) reads a hidden
 * domain ("evilꓸcom") as one. From Unicode UTS #39 (confusables-table.ts) plus look-alikes it
 * leaves out.
 */
import { CONFUSABLES } from './confusables-table';

/**
 * UTS #39's dots (Lisu ꓸ, Syriac ܁ ܂, Vai ꘎, ...) plus Latin ꞏ U+A78F, Hebrew ׅ U+05C5, Arabic ۔
 * U+06D4, Tibetan ༌ U+0F0C, ⸳ U+2E33 and runic ᛫ U+16EB. Not the Tibetan tsheg U+0F0B (it separates
 * every Tibetan syllable) and not the Arabic-Indic and Persian zeros (every such number would be mangled).
 */
export const DOT_LOOKALIKES = [
  ...[...CONFUSABLES].filter(([c, t]) => t === '.' && c !== '٠' && c !== '۰').map(([c]) => c),
  'ꞏ',
  'ׅ',
  '۔',
  '༌',
  '⸳',
  '᛫',
].join('');
