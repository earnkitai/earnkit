/**
 * The one amount reader for track and the screen (L22-6, v6.1.16), and the cap check (L22-4, L22-5). A win's money is
 * kept as given, cents and currency included, and never converted; the cap rates below are used only to compare a
 * foreign amount with a program's US dollar cap and are never shown.
 */

/** ISO 4217-style code: three letters. */
const CODE = /^[A-Za-z]{3}$/;
const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/**
 * The one refusal for an amount that cannot be read, on track and on the screen (L31-5, ruling 43, v6.1.16 Task 17).
 * Task 15 (L29-25) owns this text and its schema words; keep this the only copy when it lands.
 */
export const AMOUNT_UNREAD = 'Tell me the amount as a number, like 5000 for $5,000.';
/** L16-14 (v6.1.16): a dot used as a thousands separator ("5.000"), the one form with its own line. */
export const AMOUNT_DOT = 'Amount not read: use a dot only for cents, no thousands separator.';

export type ReadAmount = { value: number; currency: string };

/**
 * A win's amount as given: a number, or text with cents, thousands commas, a `k`/`K` for thousands, a symbol (`$`, `€`,
 * `£`) or a currency code before or after (`5k`, `$5,000`, `5000 USD`, `USD 5000`, `5,000.00`, `€5000`, `£5000`);
 * `amount_usd` is US dollars. The amount and its upper-case currency (USD when none is named), null when no amount
 * was given, 'ambiguous' for a dot used as a thousands separator (`5.000`, L16-14), 'bad' when it cannot be read
 * otherwise or is not above 0. Cents are kept. Pure.
 */
export function readAmount(o: { amount_usd?: number; amount?: number | string; currency?: string }): ReadAmount | null | 'bad' | 'ambiguous' {
  if (o.amount_usd != null && o.amount != null) return 'bad';
  const given = o.currency?.trim().toUpperCase() || null;
  if (given && !CODE.test(given)) return 'bad';
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
    // M3 (v6.1.14): "2.500" may be 2,500 written with a European separator: ambiguous, so refused.
    if (/^(?:[A-Z]{3}\s*)?\d{1,3}(?:\.\d{3})+(?:\s*K)?(?:\s*[A-Z]{3})?$/.test(t) && !/^\d{1,3}\.\d{3}\s*K$/.test(t)) return 'ambiguous';
    const m = /^(?:([A-Z]{3})\s*)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s*(K))?(?:\s*([A-Z]{3}))?$/.exec(t);
    if (!m || (m[1] && m[5])) return 'bad';
    const word = m[1] ?? m[5];
    if (word) {
      if (code && code !== word) return 'bad';
      code = word;
    }
    value = Number(`${m[2].replace(/,/g, '')}${m[3] ?? ''}`) * (m[4] ? 1000 : 1);
    value = Math.round(value * 100) / 100;
  }
  if (!(Number.isFinite(value) && value > 0)) return 'bad';
  return { value, currency: code ?? 'USD' };
}

/**
 * US dollars per unit, used only for the cap check and never shown (L22-4, v6.1.16). Each is set above the high of
 * the 2025 to mid-2026 range of the published reference rates (Federal Reserve H.10 and ECB, as known in June 2026),
 * so a foreign amount never slips under a cap.
 */
export const CAP_RATES: Readonly<Record<'EUR' | 'GBP' | 'CHF' | 'CAD' | 'AUD' | 'JPY' | 'INR' | 'SGD' | 'BRL', number>> = {
  EUR: 1.25, GBP: 1.45, CHF: 1.35, CAD: 0.8, AUD: 0.75, JPY: 0.008, INR: 0.013, SGD: 0.85, BRL: 0.22,
};

/** Whether the code is one the cap check can compare (US dollars or a CAP_RATES code). Pure. */
export const comparable = (currency: string): boolean => currency === 'USD' || Object.hasOwn(CAP_RATES, currency);

/** The amount as the cap check weighs it: US dollars as given, a listed code at its rate, an unknown code its number. Pure. */
const capWeight = (value: number, currency: string): number =>
  currency === 'USD' ? value : Object.hasOwn(CAP_RATES, currency) ? value * CAP_RATES[currency as keyof typeof CAP_RATES] : value;

/** Whether the amount is over a US dollar cap, compared before any rounding (L22-5: `$10,000.99` is over $10,000). Pure. */
export const overCap = (value: number, currency: string, capUsd: number): boolean => capWeight(value, currency) > capUsd;

/** Whether a win's amounts together are over the cap: each converted for the check, then summed (L22-4). Pure. */
export const amountsOverCap = (amounts: Readonly<Record<string, number>>, capUsd: number): boolean =>
  Object.entries(amounts).reduce((s, [c, v]) => s + capWeight(v, c), 0) > capUsd;

/** The agent note when an unknown code was weighed by its number alone (L22-4). */
export const UNKNOWN_CURRENCY_NOTE = 'Not a currency I can compare; its number is over the cap.';
