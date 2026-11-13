/**
 * The one amount reader for track and the screen (L22-6, v6.1.16), and the cap check (L22-4, L22-5). A win's money is
 * kept as given, cents and currency included, and never converted; the cap rates below are used only to compare a
 * foreign amount with a program's US dollar cap and are never shown.
 */

/** A currency code as written: two to six letters (fix round 1, M4: a longer or shorter code is named as unknown). */
const CODE = /^[A-Za-z]{2,6}$/;
/**
 * L45-4 (v6.1.19): the currencies EarnKit reads: the ISO 4217 majors and the crypto codes the catalog names (BRL kept
 * since v6.1.16 for its cap rate). Any other code is refused (`UNKNOWN_CURRENCY`), never weighed by its bare number.
 */
export const KNOWN_CURRENCIES: readonly string[] = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'SGD', 'BRL', 'ETH', 'BTC', 'SOL', 'USDC', 'USDT'];
/** L45-4 (v6.1.19): the builder line for a currency code EarnKit does not know. */
export const UNKNOWN_CURRENCY = (code: string): string => `${UNKNOWN_CODES([code])} ${SAY_CURRENCY}`;
/** Fix round 1 (I3, v6.1.19): every unknown code in one sentence, with no Say (the reply ends with SAY_CURRENCY). */
export const UNKNOWN_CODES = (codes: string[]): string => {
  const q = codes.map((c) => `"${c}"`);
  return q.length === 1 ? `I do not know the currency ${q[0]}.` : `I do not know the currencies ${q.slice(0, -1).join(', ')} and ${q.at(-1)}.`;
};
/** Fix round 1 (I3): the one Say after unknown currencies, last in the reply. */
export const SAY_CURRENCY = 'Say the amount with its currency.';
/** L45-3 (v6.1.19): the builder line for a win under one dollar (after conversion). L47-13 (v6.1.22): cents are
 *  accepted, so the line never asks for whole dollars. */
export const UNDER_A_DOLLAR = 'Tell me the amount, 1 dollar or more.';
/** v6.1.19.1 (L47-1): the line for a win in another currency worth under a dollar at its floor rate; the whole-dollar
 *  line (`UNDER_A_DOLLAR`) is for US dollars only. */
export const UNDER_A_DOLLAR_OTHER = 'That amount is too small to record. Tell me the amount and its currency.';
/** v6.1.19.1 (L47-1): the under-a-dollar line for a win in this currency. Pure. */
export const underADollarLine = (currency: string): string => (currency.trim().toUpperCase() === 'USD' ? UNDER_A_DOLLAR : UNDER_A_DOLLAR_OTHER);
/** v6.1.19.1 (L47-1): the coins whose wins keep up to 8 places (`0.001 ETH` stays 0.001); every other currency keeps 2. */
const COIN_PLACES: readonly string[] = ['ETH', 'BTC', 'SOL'];
/** v6.1.19.1 (L47-1): the decimal places a win in this currency keeps: 8 for ETH, BTC and SOL, else 2. Pure. */
export const placesOf = (currency: string): number => (COIN_PLACES.includes(currency.trim().toUpperCase()) ? 8 : 2);
/** v6.1.19.1 (L47-1): the amount rounded to its currency's places, as it is stored and shown. Pure. */
export const roundIn = (value: number, currency: string): number => {
  const f = 10 ** placesOf(currency);
  return Math.round(value * f) / f;
};
/** L45-15 (v6.1.19): the builder line when the agent's amount arguments were malformed (the fix is in the note). */
export const TELL_AMOUNT = 'Tell me the amount.';
const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/**
 * The one refusal for an amount that cannot be read, on track and on the screen (L31-5, ruling 43, v6.1.16 Task 17;
 * Task 15's ruled text, L29-25). The schema words beside it are track's `amount_usd` description. The only copy.
 */
export const AMOUNT_UNREAD = 'Tell me the amount as a number, like 5000 for $5,000.';
/** L16-14 (v6.1.16): a dot used as a thousands separator ("5.000"), the one form with its own line. */
export const AMOUNT_DOT = 'Amount not read: use a dot only for cents, no thousands separator.';

export type ReadAmount = { value: number; currency: string };
/** L45-4 (v6.1.19): a well-formed amount in a currency code EarnKit does not know. */
export type UnknownCurrency = { unknownCurrency: string };
/** Whether a read is an unknown currency (L45-4). Pure. */
export const isUnknownCurrency = (a: unknown): a is UnknownCurrency => !!a && typeof a === 'object' && 'unknownCurrency' in a;

/**
 * A win's amount as given: a number, or text with cents, thousands commas, a `k`/`K` for thousands, a symbol (`$`, `€`,
 * `£`) or a currency code before or after (`5k`, `$5,000`, `5000 USD`, `USD 5000`, `5,000.00`, `€5000`, `£5000`);
 * `amount_usd` is US dollars. The amount and its upper-case currency (USD when none is named), null when no amount
 * was given, 'ambiguous' for a dot used as a thousands separator (`5.000`, L16-14; never after a lone `0`, where a comma is a decimal comma), 'bad' when it cannot be read
 * otherwise or is not above 0. Cents are kept. Pure.
 */
export function readAmount(o: { amount_usd?: number; amount?: number | string; currency?: string }): ReadAmount | null | 'bad' | 'ambiguous' | UnknownCurrency {
  if (o.amount_usd != null && o.amount != null) return 'bad';
  const given = o.currency?.trim().toUpperCase() || null;
  if (given && !CODE.test(given)) return 'bad';
  // L45-4 (v6.1.19): a code EarnKit does not know is named, never weighed by its number.
  const known = (a: ReadAmount): ReadAmount | UnknownCurrency => (KNOWN_CURRENCIES.includes(a.currency) ? a : { unknownCurrency: a.currency });
  if (o.amount_usd != null) return given && given !== 'USD' ? 'bad' : o.amount_usd > 0 && Number.isFinite(o.amount_usd) ? { value: o.amount_usd, currency: 'USD' } : 'bad';
  if (o.amount == null) return given ? 'bad' : null;
  let value: number;
  let code = given;
  if (typeof o.amount === 'number') value = o.amount;
  else {
    let t = o.amount.trim().toUpperCase();
    const sym = Object.keys(SYMBOLS).find((x) => t.startsWith(x));
    if (sym) {
      if (code && code !== SYMBOLS[sym]) return 'bad';
      code = SYMBOLS[sym];
      t = t.slice(sym.length).trim();
    }
    // v6.1.17 final round (Task 2 review N1): a leading `0,` is never a thousands group but a decimal comma: `0,500`
    // reads 0.5, `0,001` reads 0.001.
    t = t.replace(/^((?:[A-Z]{2,6}\s*)?)0,(\d+)(?=\s*K?\s*(?:[A-Z]{2,6})?$)/, '$10.$2');
    // M3 (v6.1.14): "2.500" may be 2,500 written with a European separator: ambiguous, so refused. An amount starting
    // with `0.` is never a thousands group, so `0.001` reads as 0.001 (v6.1.16 Task 8 N3, v6.1.17).
    if (/^(?:[A-Z]{2,6}\s*)?(?!0\.)\d{1,3}(?:\.\d{3})+(?:\s*K)?(?:\s*[A-Z]{2,6})?$/.test(t) && !/^\d{1,3}\.\d{3}\s*K$/.test(t)) return 'ambiguous';
    const m = /^(?:([A-Z]{2,6})\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(K))?(?:\s*([A-Z]{2,6}))?$/.exec(t);
    if (!m || (m[1] && m[5])) return 'bad';
    // Fix round 1 (M4): a K written against a code that is no currency is the code's first letter (`8999 KRW` is KRW,
    // never 8,999,000 RW); `5k EUR` and `5KUSD` stay thousands.
    if (m[4] && m[5] && !KNOWN_CURRENCIES.includes(m[5]) && t.endsWith(`K${m[5]}`)) {
      m[5] = `K${m[5]}`;
      m[4] = '';
    }
    const word = m[1] ?? m[5];
    if (word) {
      if (code && code !== word) return 'bad';
      code = word;
    }
    value = Number(`${m[2].replace(/,/g, '')}${m[3] ?? ''}`) * (m[4] ? 1000 : 1);
  }
  if (!(Number.isFinite(value) && value > 0)) return 'bad';
  return known({ value, currency: code ?? 'USD' });
}

/**
 * US dollars per unit, used only for the cap check and never shown (L22-4, v6.1.16). Each is set above the high of
 * the 2025 to mid-2026 range of the published reference rates (Federal Reserve H.10 and ECB, as known in June 2026),
 * so a foreign amount never slips under a cap.
 */
export const CAP_RATES: Readonly<Record<'EUR' | 'GBP' | 'CHF' | 'CAD' | 'AUD' | 'JPY' | 'INR' | 'SGD' | 'BRL' | 'USDC' | 'USDT' | 'ETH' | 'BTC' | 'SOL', number>> = {
  EUR: 1.25, GBP: 1.45, CHF: 1.35, CAD: 0.8, AUD: 0.75, JPY: 0.008, INR: 0.013, SGD: 0.85, BRL: 0.22,
  // Fix round 1 (security, v6.1.19): the dollar stablecoins at their peg.
  USDC: 1, USDT: 1,
  // Fix round 1 (security, v6.1.19): cap-only upper bounds, set well above each coin's highest price known as of June
  // 2026 (ETH under $5,000, BTC under $130,000, SOL under $300), so a coin win is never weighed below its worth against
  // a program's dollar cap. Used only for the cap (the under-a-dollar check uses FLOOR_RATES); never shown, never a conversion, and the
  // win is recorded in its own currency.
  ETH: 10_000, BTC: 250_000, SOL: 1_000,
};
/**
 * Final fix round (M3, v6.1.19): floor-only low bounds for the coins, set far below any price each coin held from 2025
 * to mid-2026, so a coin win passes the one dollar floor only when it is worth a dollar even at a low price. Used only for the under-a-dollar check; the cap uses CAP_RATES.
 */
export const FLOOR_RATES: Readonly<Record<'ETH' | 'BTC' | 'SOL', number>> = { ETH: 1_000, BTC: 20_000, SOL: 20 };


/**
 * The amount in US dollars at the static rate (L45-4, v6.1.19): US dollars as given, a CAP_RATES code at its rate, else
 * null (no rate is invented, so such an amount is never weighed as a bare number). Pure.
 */
export const usdAt = (value: number, currency: string): number | null =>
  currency === 'USD' ? value : Object.hasOwn(CAP_RATES, currency) ? value * CAP_RATES[currency as keyof typeof CAP_RATES] : null;
/**
 * The amount as the cap check weighs it: `usdAt`. Fix round 1 (security, v6.1.19): never 0; every known currency has a
 * cap rate, and a currency with none weighs as infinite, so a win in it is always over the cap (refused). Pure.
 */
const capWeight = (value: number, currency: string): number => usdAt(value, currency) ?? Infinity;
/**
 * L45-3 (v6.1.19): a win under one US dollar once converted; an amount with no rate is not judged. A coin is weighed
 * at its FLOOR_RATES low bound (final fix round, M3), every other currency at its CAP_RATES rate. Pure.
 */
export const underADollar = (value: number, currency: string): boolean =>
  (Object.hasOwn(FLOOR_RATES, currency) ? value * FLOOR_RATES[currency as keyof typeof FLOOR_RATES] : usdAt(value, currency) ?? Infinity) < 1;

/** Whether the amount is over a US dollar cap, compared before any rounding (L22-5: `$10,000.99` is over $10,000). Pure. */
export const overCap = (value: number, currency: string, capUsd: number): boolean => capWeight(value, currency) > capUsd;

/** Whether a win's amounts together are over the cap: each converted for the check, then summed (L22-4). Pure. */
export const amountsOverCap = (amounts: Readonly<Record<string, number>>, capUsd: number): boolean =>
  Object.entries(amounts).reduce((s, [c, v]) => s + capWeight(v, c), 0) > capUsd;


