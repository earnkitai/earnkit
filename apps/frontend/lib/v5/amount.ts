/**
 * The one amount reader for track and the screen (L22-6, v6.1.16), and the cap check (L22-4, L22-5). A win's money is
 * kept as given, cents and currency included, and never converted; the cap rates below are used only to compare a
 * foreign amount with a program's US dollar cap and are never shown.
 */

/** A currency code as written: three letters (ISO 4217), or four for USDC and USDT. */
const CODE = /^[A-Za-z]{3,4}$/;
/**
 * L45-4 (v6.1.19): the currencies EarnKit reads: the ISO 4217 majors and the crypto codes the catalog names (BRL kept
 * since v6.1.16 for its cap rate). Any other code is refused (`UNKNOWN_CURRENCY`), never weighed by its bare number.
 */
export const KNOWN_CURRENCIES: readonly string[] = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'SGD', 'BRL', 'ETH', 'BTC', 'SOL', 'USDC', 'USDT'];
/** L45-4 (v6.1.19): the builder line for a currency code EarnKit does not know. */
export const UNKNOWN_CURRENCY = (code: string): string => `I do not know the currency "${code}". Say the amount with its currency.`;
/** L45-3 (v6.1.19): the builder line for a win under one dollar (after conversion). */
export const UNDER_A_DOLLAR = 'Tell me the amount in whole dollars, 1 or more.';
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
    t = t.replace(/^((?:[A-Z]{3,4}\s*)?)0,(\d+)(?=\s*K?\s*(?:[A-Z]{3,4})?$)/, '$10.$2');
    // M3 (v6.1.14): "2.500" may be 2,500 written with a European separator: ambiguous, so refused. An amount starting
    // with `0.` is never a thousands group, so `0.001` reads as 0.001 (v6.1.16 Task 8 N3, v6.1.17).
    if (/^(?:[A-Z]{3,4}\s*)?(?!0\.)\d{1,3}(?:\.\d{3})+(?:\s*K)?(?:\s*[A-Z]{3,4})?$/.test(t) && !/^\d{1,3}\.\d{3}\s*K$/.test(t)) return 'ambiguous';
    const m = /^(?:([A-Z]{3,4})\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(K))?(?:\s*([A-Z]{3,4}))?$/.exec(t);
    if (!m || (m[1] && m[5])) return 'bad';
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
export const CAP_RATES: Readonly<Record<'EUR' | 'GBP' | 'CHF' | 'CAD' | 'AUD' | 'JPY' | 'INR' | 'SGD' | 'BRL', number>> = {
  EUR: 1.25, GBP: 1.45, CHF: 1.35, CAD: 0.8, AUD: 0.75, JPY: 0.008, INR: 0.013, SGD: 0.85, BRL: 0.22,
};


/**
 * The amount in US dollars at the static rate (L45-4, v6.1.19): US dollars as given, a CAP_RATES code at its rate, else
 * null (no rate is invented, so such an amount is never weighed as a bare number). Pure.
 */
export const usdAt = (value: number, currency: string): number | null =>
  currency === 'USD' ? value : Object.hasOwn(CAP_RATES, currency) ? value * CAP_RATES[currency as keyof typeof CAP_RATES] : null;
/** The amount as the cap check weighs it: `usdAt`, and 0 for a code with no rate (recorded uncapped, L45-4). Pure. */
const capWeight = (value: number, currency: string): number => usdAt(value, currency) ?? 0;
/** L45-3 (v6.1.19): a win under one US dollar once converted; an amount with no rate is not judged. Pure. */
export const underADollar = (value: number, currency: string): boolean => (usdAt(value, currency) ?? Infinity) < 1;

/** Whether the amount is over a US dollar cap, compared before any rounding (L22-5: `$10,000.99` is over $10,000). Pure. */
export const overCap = (value: number, currency: string, capUsd: number): boolean => capWeight(value, currency) > capUsd;

/** Whether a win's amounts together are over the cap: each converted for the check, then summed (L22-4). Pure. */
export const amountsOverCap = (amounts: Readonly<Record<string, number>>, capUsd: number): boolean =>
  Object.entries(amounts).reduce((s, [c, v]) => s + capWeight(v, c), 0) > capUsd;

/** L45-4 (v6.1.19): the agent note on an amount kept in a currency with no static rate: recorded, not checked against the cap. */
export const UNCAPPED_NOTE = (code: string): string => `Recorded as given in ${code}; EarnKit has no rate for ${code}, so it was not checked against the program's cap.`;
