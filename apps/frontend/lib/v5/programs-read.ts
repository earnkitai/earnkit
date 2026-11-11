/**
 * GET /api/programs, public: the listed programs (open or upcoming, file or API) with what the
 * site shows of each, filtered by ?category= and ?status=, in the list's order. The JSON shape is
 * the one the owner's Grok Bot and other readers already parse.
 */
import { revalidatePath, revalidateTag } from 'next/cache';
import { CHAIN_REGISTRY } from './chains';
import { closeDay, closesWords, programZone } from './deadline';
import { json } from './http';
import { PROGRAM_CATEGORIES, categoryOf, type Category, type Program } from './program-file';
import { listListedPrograms } from './programs';

/** The cache tag on the public list; an API write expires it. */
export const PROGRAMS_TAG = 'programs';

let catalogWatcher: (() => void) | null = null;
/** Tests only: a function called on every `revalidateCatalog` (null to stop). */
export const watchCatalogRevalidation = (f: (() => void) | null): void => {
  catalogWatcher = f;
};

/**
 * L22-13 (v6.1.16): every catalog surface (stats, the landing, /programs, every guide, the sitemap) expires at once, on
 * every program write: the API's, the file sync's upserts and deletes, and the cron's status flip. They share one tag
 * (`cachedRead`, keyed by build). Outside a Next request (a script, a test) it does nothing.
 */
export function revalidateCatalog(): void {
  catalogWatcher?.();
  try {
    revalidateTag(PROGRAMS_TAG, { expire: 0 });
    revalidatePath('/');
    revalidatePath('/programs');
    revalidatePath('/programs/[id]', 'page');
    revalidatePath('/sitemap.xml');
    revalidatePath('/api/stats');
  } catch {
    // No Next request context.
  }
}
export const PROGRAMS_LIST_MAX = 200;
export const PROGRAM_STATUSES = ['active', 'upcoming'] as const;

export type ListedProgram = {
  id: string;
  title: string;
  organizer: string;
  category: Category;
  chains: string[];
  any_chain: boolean;
  /** The card's money (`moneyOf`): the summary's money phrase in full figures, else the pool or the award. */
  money: string;
  status: 'active' | 'upcoming';
  /** ISO, or null for a rolling program. */
  closes_at: string | null;
  /** The closes wording without "closes " (L23-9, v6.1.16: "in under an hour", "today", "tomorrow", "in 5 days",
   *  "Nov 20") or "rolling" on an open program; null for an upcoming one. */
  closes_in: string | null;
  /** The program's zone, for closes_in; sort and words only, not in the answer. */
  zone: string;
  source_url: string;
  submission_url: string;
  source: 'file' | 'api';
  submit: string;
  sign_in: string;
  platform_name: string | null;
  needs: string[];
  min_tier: string | null;
  prefers: string[];
  /** Sort only; not in the answer. */
  max_award_usd: number;
};

/** A number with en-US grouping, cents only when it has them to the cent ("5,000", "2,500.50"; 10000.004 reads "10,000"). Pure. */
const grouped = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2, maximumFractionDigits: 2 });

/**
 * The one money format (lane 22, v6.1.15; currencies and cents, L22-14 v6.1.16): US dollars as `$5,000` or `$2,500.50`
 * (cents only when given), another currency code first and never converted (`EUR 2,000`, `USDC 115,000`); never K or
 * M (the landing hero's `heroUsdText` alone rounds). Pure.
 */
export function moneyText(amount: number, currency = 'USD'): string {
  const code = currency.trim().toUpperCase() || 'USD';
  return code === 'USD' ? `$${grouped(amount)}` : `${code} ${grouped(amount)}`;
}

/** "$10,000": `moneyText` in US dollars (lane 22, v6.1.15). Pure. */
export const usdFull = (usd: number): string => moneyText(usd);

/** A win's money by currency code (`{ USD: 3500.5, EUR: 2000 }`), never converted (L22-3, v6.1.16). */
export type Amounts = Readonly<Record<string, number>>;

/** Two amounts added to the cent, so 0.1 + 0.2 stays 0.30. Pure. */
export const addMoney = (a: number, b: number): number => Math.round((a + b) * 100) / 100;

/** The amounts plus one more in its currency (a further payment adds within its currency). Pure. */
export const plusAmount = (a: Amounts | null, value: number, currency: string): Amounts => ({ ...a, [currency]: addMoney(a?.[currency] ?? 0, value) });

/** Whether two amounts hold the same money in every currency. Pure. */
export function sameAmounts(a: Amounts | null, b: Amounts | null): boolean {
  const ka = Object.keys(a ?? {}).filter((k) => a![k] !== 0);
  const kb = Object.keys(b ?? {}).filter((k) => b![k] !== 0);
  return ka.length === kb.length && ka.every((k) => b?.[k] === a![k]);
}

/**
 * A total in the one format (L22-1, v6.1.16): US dollars first, then each other currency in code order, joined with
 * `and`; wins with no amount named after a comma: `$3,500.50 and EUR 2,000`, `$5,000, one amount not given`,
 * `amount not given` alone. Empty when there is nothing to say. Pure.
 */
export function totalText(t: { usd: number; other: readonly { currency: string; amount: number }[]; noAmount: number }): string {
  const parts = [
    ...(t.usd > 0 ? [moneyText(t.usd)] : []),
    ...[...t.other].filter((o) => o.amount > 0).sort((a, b) => a.currency.localeCompare(b.currency)).map((o) => moneyText(o.amount, o.currency)),
  ];
  const missing = t.noAmount <= 0 ? '' : parts.length === 0 ? (t.noAmount === 1 ? 'amount not given' : `${t.noAmount} amounts not given`)
    : `${t.noAmount === 1 ? 'one amount' : `${t.noAmount} amounts`} not given`;
  return [parts.join(' and '), missing].filter(Boolean).join(', ');
}

/** A win's amounts in the one format (`$1,000 and EUR 500`); empty for none. Pure. */
export const amountsText = (a: Amounts | null): string =>
  totalText({ usd: a?.USD ?? 0, other: Object.entries(a ?? {}).filter(([c]) => c !== 'USD').map(([currency, amount]) => ({ currency, amount })), noAmount: 0 });

/**
 * A money phrase at its place (#12, L1g-4, v6.1.15): `tile` starts it with a capital ("Funds work from EUR 50,000");
 * `mid` lower-cases a plain capitalised first word for mid-sentence ("funds work from EUR 50,000"). Both leave alone a
 * word whose second letter is a capital ("iOS", "DeFi", "EUR", "NYC"), and `mid` keeps a chain's name ("Ethereum
 * grants"). Pure.
 */
export function moneyAt(text: string, at: 'tile' | 'mid'): string {
  return at === 'tile' ? upperFirst(text) : lowerFirst(text);
}

/** The text with its first letter upper-cased, unless the first word's second letter is a capital ("iOS"). Pure. */
export const upperFirst = (text: string): string => (/^[a-z][A-Z]/.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1));

/** A plain capitalised first word ("Up", "Pre-seed", "Milestone"), never an acronym or a mixed-case name ("EUR", "NYC",
 *  "DeFi", "PayPal"). */
const PLAIN_CAPITAL = /^[A-Z][a-z]*(?:[-'][a-z]+)*(?=$|[\s,:;.])/;

/** A month opening a phrase keeps its capital (L27-18, v6.1.16): "Nov 12" never reads "nov 12" mid-sentence. */
const MONTH_WORDS: ReadonlySet<string> = new Set(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'January', 'February', 'March', 'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

/** Every word of a registered chain's name ("Ethereum", "Robinhood", "Chain"): a phrase opening with one keeps it. */
export const CHAIN_WORDS: ReadonlySet<string> = new Set(Object.values(CHAIN_REGISTRY).flatMap((c) => c.name.split(/\s+/)));

/**
 * The text for mid-sentence (one rule wherever a phrase is lower-cased, v6.1.15): a plain capitalised first word is
 * lower-cased, unless it is "I", a month (L27-18, v6.1.16), a chain's name or one of `names` (an ecosystem's words);
 * a currency code ("EUR") is never plain. Else as written. Pure.
 */
export function lowerFirst(text: string, names: Iterable<string> = []): string {
  const first = text.split(/[\s,:;.]/)[0];
  if (!PLAIN_CAPITAL.test(text) || first === 'I' || MONTH_WORDS.has(first) || CHAIN_WORDS.has(first) || new Set(names).has(first)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** A money threshold the builder must reach (" at $10M USDG TVL"), never money paid (v6.1.14). */
const THRESHOLD = /\s+at\s+[$€£]\s?[\d.,]+\s?[KMB]?\b.*$/i;

/** A bare figure ("$500,000", "up to $10,000"): an investment program's names the kind after it. */
const BARE_FIGURE = /^(up to )?[$€£]?[\d.,]+[KM]?$/i;

/**
 * The money of a program, one reader for the tile, the list API, the guide header and (lowercase) the find reply
 * (fix round 2, v6.1.15): the summary's money phrase whenever it has a figure ("$250,000 over two years", "Up to
 * $100,000 by tier, more by DAO vote"), in full figures (the catalog check refuses K or M); else the pool ("$N in
 * grants" or "$N in prizes"), then the per-winner award ("$10,000 to $900,000" keeps a range's low); else the
 * summary's words ("Milestone grants, amount not stated"). The phrase never carries a threshold the builder must
 * reach (v6.1.14), and starts with a capital (#12). Pure.
 */
export function moneyOf(p: Pick<Program, 'title' | 'summary' | 'investment' | 'max_award_usd' | 'pool_usd' | 'min_award_usd'>): string {
  const phrase = p.summary.split(' · ')[0].replace(THRESHOLD, '');
  if (!/\d/.test(phrase)) {
    if (p.pool_usd) return `${usdFull(p.pool_usd)} in ${/\bgrants?\b/i.test(p.title) ? 'grants' : 'prizes'}`;
    if (p.max_award_usd) return p.min_award_usd ? `${usdFull(p.min_award_usd)} to ${usdFull(p.max_award_usd)}` : usdFull(p.max_award_usd);
  }
  return moneyAt(p.investment && BARE_FIGURE.test(phrase) ? `${phrase} investment` : phrase, 'tile');
}

const closesIn = (status: ListedProgram['status'], closesAt: string | null, now: Date, zone: string) =>
  status === 'active' ? (closesAt ? closesWords(closesAt, now, zone).replace(/^closes /, '') : 'rolling') : null;

/** Every listed program, unsorted and unfiltered. */
export async function readListedPrograms(now = new Date()): Promise<ListedProgram[]> {
  return (await listListedPrograms(now)).map(({ file: p, source }) => {
    const status = p.status === 'upcoming' ? 'upcoming' : 'active';
    // Rolling (no ends_at, or the summary says rolling) is null, as the card says "Rolling".
    const closes_at = closeDay(p, now) ? new Date(p.ends_at!).toISOString() : null;
    const zone = programZone(p);
    return {
      id: p.id,
      title: p.title,
      organizer: p.organizer.trim() || p.title,
      category: categoryOf(p),
      chains: p.chains,
      any_chain: p.any_chain,
      money: moneyOf(p),
      status,
      closes_at,
      closes_in: closesIn(status, closes_at, now, zone),
      zone,
      source_url: p.source_url,
      submission_url: p.submission_url,
      source,
      submit: p.submit,
      sign_in: p.sign_in,
      platform_name: p.platform_name ?? null,
      needs: p.needs,
      min_tier: p.min_tier ?? null,
      prefers: p.prefers,
      max_award_usd: p.max_award_usd ?? 0,
    };
  });
}

const CATEGORY_RANK = new Map<string, number>(PROGRAM_CATEGORIES.map((c, i) => [c, i]));

/** The list's order: category, then soonest close (rolling last), then the larger per-winner max, then id. Pure. */
export function byListOrder(a: ListedProgram, b: ListedProgram): number {
  return (
    CATEGORY_RANK.get(a.category)! - CATEGORY_RANK.get(b.category)! ||
    (a.closes_at === null ? Infinity : Date.parse(a.closes_at)) - (b.closes_at === null ? Infinity : Date.parse(b.closes_at)) ||
    b.max_award_usd - a.max_award_usd ||
    a.id.localeCompare(b.id)
  );
}

/** GET /api/programs. `read` may be cached: what closed since is dropped and closes_in is recomputed per request. */
export async function programsListGet(
  request: Request,
  read: () => Promise<ListedProgram[]> = () => readListedPrograms(),
  now = new Date(),
): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const category = q.get('category');
  // "open" is what the site and /api/stats call active (v6.1.7 S2).
  const status = q.get('status') === 'open' ? 'active' : q.get('status');
  const problems: string[] = [];
  if (category !== null && !(PROGRAM_CATEGORIES as readonly string[]).includes(category))
    problems.push(`category: one of ${PROGRAM_CATEGORIES.join(', ')}`);
  if (status !== null && !(PROGRAM_STATUSES as readonly string[]).includes(status)) problems.push(`status: one of ${PROGRAM_STATUSES.join(', ')}`);
  if (problems.length > 0) return json({ ok: false, problems }, 400);
  let all: ListedProgram[];
  try {
    all = await read();
  } catch (err) {
    console.error('[programs-read] list failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return json({ ok: false, error: 'programs unavailable, try again shortly' }, 503, { 'Retry-After': '30' });
  }
  const programs = all
    .filter((p) => p.closes_at === null || Date.parse(p.closes_at) > now.getTime())
    .filter((p) => (category === null || p.category === category) && (status === null || p.status === status))
    .sort(byListOrder)
    .slice(0, PROGRAMS_LIST_MAX)
    .map(({ max_award_usd: _sortOnly, zone, ...p }) => ({ ...p, closes_in: closesIn(p.status, p.closes_at, now, zone) }));
  return json({ ok: true, programs }, 200, { 'Cache-Control': 'public, max-age=60' });
}
