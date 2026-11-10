/**
 * GET /api/programs, public: the listed programs (open or upcoming, file or API) with what the
 * site shows of each, filtered by ?category= and ?status=, in the list's order. The JSON shape is
 * the one the owner's Grok Bot and other readers already parse.
 */
import { closeDay, timeLeftWords } from './deadline';
import { json } from './http';
import { PROGRAM_CATEGORIES, categoryOf, type Category, type Program } from './program-file';
import { listListedPrograms } from './programs';

/** The cache tag on the public list; an API write expires it. */
export const PROGRAMS_TAG = 'programs';
export const PROGRAMS_LIST_MAX = 200;
export const PROGRAM_STATUSES = ['active', 'upcoming'] as const;

export type ListedProgram = {
  id: string;
  title: string;
  organizer: string;
  category: Category;
  chains: string[];
  any_chain: boolean;
  /** The card's money: "$5K" per winner, else "$840K in prizes", else the summary's amount. */
  money: string;
  status: 'active' | 'upcoming';
  /** ISO, or null for a rolling program. */
  closes_at: string | null;
  /** "in 20 hours", "in 16 days" or "rolling" on an open program; null for an upcoming one. */
  closes_in: string | null;
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

/** "$750", "$5K", "$105K", "$1M", "$1.3M". Pure. */
export function compactUsd(usd: number): string {
  const one = (n: number) => String(Math.round(n * 10) / 10);
  if (usd < 1000) return `$${Math.round(usd)}`;
  if (usd < 999_950) return `$${one(usd / 1000)}K`;
  return `$${one(usd / 1_000_000)}M`;
}

/** A money threshold the builder must reach (" at $10M USDG TVL"), never money paid (v6.1.14). */
const THRESHOLD = /\s+at\s+[$€£]\s?[\d.,]+\s?[KMB]?\b.*$/i;

/**
 * The money a program card shows: the pool first, then the per-winner award, then the summary (v6.1.6). A range (a
 * low end in the file, or a summary that says "up to") reads "Up to $900K" (v6.1.14): its top is not the award. The
 * summary's money never carries a threshold the builder must reach. Pure.
 */
export function moneyOf(p: Pick<Program, 'title' | 'summary' | 'investment' | 'max_award_usd' | 'pool_usd' | 'min_award_usd'>): string {
  const prize = p.summary.split(' · ')[0];
  if (p.pool_usd) return `${compactUsd(p.pool_usd)} in ${/\bgrants?\b/i.test(p.title) ? 'grants' : 'prizes'}`;
  if (p.max_award_usd) return p.min_award_usd || /^up to\b/i.test(prize) ? `Up to ${compactUsd(p.max_award_usd)}` : compactUsd(p.max_award_usd);
  const award = prize.replace(THRESHOLD, '');
  return p.investment && !/\binvestment\b/i.test(award) ? `${award} investment` : award;
}

const closesIn = (status: ListedProgram['status'], closesAt: string | null, now: Date) =>
  status === 'active' ? (closesAt ? timeLeftWords(closesAt, now) : 'rolling') : null;

/** Every listed program, unsorted and unfiltered. */
export async function readListedPrograms(now = new Date()): Promise<ListedProgram[]> {
  return (await listListedPrograms(now)).map(({ file: p, source }) => {
    const status = p.status === 'upcoming' ? 'upcoming' : 'active';
    // Rolling (no ends_at, or the summary says rolling) is null, as the card says "Rolling".
    const closes_at = closeDay(p) ? new Date(p.ends_at!).toISOString() : null;
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
      closes_in: closesIn(status, closes_at, now),
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
    .map(({ max_award_usd: _sortOnly, ...p }) => ({ ...p, closes_in: closesIn(p.status, p.closes_at, now) }));
  return json({ ok: true, programs }, 200, { 'Cache-Control': 'public, max-age=60' });
}
