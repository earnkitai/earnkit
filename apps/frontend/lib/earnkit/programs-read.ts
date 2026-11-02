import { sql } from './db';
import { closeDay, hoursLeft } from './deadline';
import { json } from './http';
import { landingTiles, listedCards } from './landing';
import { PROGRAM_CATEGORIES, categoryOf, type Category } from './program-file';
import { listPrograms } from './programs';
import { APPROVE_TTL_DAYS, approveExpiry } from './program-pending';
import { programsAuthFailure } from './programs-api';
import { tileMoney } from './site-copy';
import type { Chain } from './match';

/**
 * v4.9 Task 3: the two reads beside the write API.
 * - GET /api/programs (public): the programs the landing lists (landing.ts listedCards: curated, file or API, open or
 *   upcoming, never a campaign), at most PROGRAMS_LIST_MAX, with only what the landing and the guide pages already show.
 * - GET /api/programs/writes (the write API's token, programs-api.ts programsAuthFailure): the last WRITES_MAX audit
 *   rows, never a body.
 */

export const PROGRAMS_LIST_MAX = 200;
export const WRITES_MAX = 100;
export const PROGRAM_STATUSES = ['active', 'upcoming'] as const;

export type ListedProgram = {
  id: string;
  title: string;
  organizer: string;
  category: Category;
  chains: Chain[];
  any_chain: boolean;
  /** The card's money text (site-copy tileMoney): "$5K", "$840K in prizes". */
  money: string;
  status: 'active' | 'upcoming';
  /** ISO, or null for a rolling program. */
  closes_at: string | null;
  /** deadline.ts hoursLeft: "in 20 hours" under 48 hours on an open program, else null. */
  closes_in: string | null;
  source_url: string;
  submission_url: string;
  source: 'file' | 'api';
  /** Sort only; not in the answer. */
  max_award_usd: number;
};

type Row = {
  id: string;
  category: string | null;
  source: string;
  source_url: string;
  submission_url: string;
  investment: boolean | null;
  pool_usd: string | number | null;
  max_award_usd: string | number | null;
  in_person: boolean | null;
};

/** Every listed program, unsorted and unfiltered (one listPrograms read and one read of the page links). */
export async function readListedPrograms(now = new Date()): Promise<ListedProgram[]> {
  const cards = listedCards(await listPrograms());
  const tiles = landingTiles(cards, now);
  const ids = cards.map((c) => c.id);
  const db = sql();
  const rows = await db<Row[]>`
    SELECT id, category, source, source_url, submission_url, investment, pool_usd, max_award_usd, in_person
    FROM programs WHERE id IN ${db(ids.concat(''))}`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ListedProgram[] = [];
  cards.forEach((c, i) => {
    const r = byId.get(c.id);
    // Belt and braces: only the curated sources (listedCards already drops campaigns).
    if (!r || (r.source !== 'file' && r.source !== 'api')) return;
    const category =
      (PROGRAM_CATEGORIES as readonly string[]).includes(r.category ?? '')
        ? (r.category as Category)
        : categoryOf({
            investment: r.investment === true,
            pool_usd: r.pool_usd == null ? undefined : Number(r.pool_usd),
            max_award_usd: r.max_award_usd == null ? undefined : Number(r.max_award_usd),
            in_person: r.in_person === true,
          });
    const status = tiles[i].status;
    // Rolling (no ends_at, or the summary says rolling: deadline.ts closeDay) is null, as the card says "Rolling".
    const closes_at = closeDay(c) ? new Date(c.ends_at!).toISOString() : null;
    out.push({
      id: c.id,
      title: c.title,
      organizer: tiles[i].organizer,
      category,
      chains: c.chains ?? [],
      any_chain: c.any_chain === true,
      money: tileMoney(tiles[i]),
      status,
      closes_at,
      closes_in: status === 'active' && closes_at ? hoursLeft(closes_at, now) : null,
      source_url: r.source_url,
      submission_url: r.submission_url,
      source: r.source,
      max_award_usd: c.max_award_usd ?? 0,
    });
  });
  return out;
}

const CATEGORY_RANK = new Map<string, number>(PROGRAM_CATEGORIES.map((c, i) => [c, i]));

/** The list's order: category (grant, hackathon, investment, bounty), then soonest close (rolling last), then the larger per-winner max, then id. Pure. */
export function byListOrder(a: ListedProgram, b: ListedProgram): number {
  return (
    CATEGORY_RANK.get(a.category)! - CATEGORY_RANK.get(b.category)! ||
    (a.closes_at === null ? Infinity : Date.parse(a.closes_at)) - (b.closes_at === null ? Infinity : Date.parse(b.closes_at)) ||
    b.max_award_usd - a.max_award_usd ||
    a.id.localeCompare(b.id)
  );
}

/** GET /api/programs. `read` is the (cached) readListedPrograms; filters, order and closes_in are applied per request. */
export async function programsListGet(
  request: Request,
  read: () => Promise<ListedProgram[]> = () => readListedPrograms(),
  now = new Date(),
): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const category = q.get('category');
  const status = q.get('status');
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
    // A cached read may be a minute old: drop what closed since.
    .filter((p) => p.closes_at === null || Date.parse(p.closes_at) > now.getTime())
    .filter((p) => (category === null || p.category === category) && (status === null || p.status === status))
    .sort(byListOrder)
    .slice(0, PROGRAMS_LIST_MAX)
    .map(({ max_award_usd: _sortOnly, ...p }) => ({ ...p, closes_in: p.status === 'active' && p.closes_at ? hoursLeft(p.closes_at, now) : null }));
  return json({ ok: true, programs }, 200, { 'Cache-Control': 'public, max-age=60' });
}

/**
 * GET /api/programs/writes: the last WRITES_MAX program_writes rows, newest first, never `body`; and (v4.10.1 Task 4)
 * `pending`: the writes waiting for the owner's approval whose link still works (at most WRITES_MAX, newest first),
 * each with the program's title and links from its body and when the link expires.
 */
export async function programWritesGet(request: Request, now = new Date()): Promise<Response> {
  const denied = programsAuthFailure(request);
  if (denied) return denied;
  try {
    const writes = await sql()<{ at: Date; program_id: string | null; action: string; result: string; reason: string | null }[]>`
      SELECT at, program_id, action, result, reason FROM program_writes ORDER BY id DESC LIMIT ${WRITES_MAX}`;
    const held = await sql()<{ at: Date; program_id: string | null; reason: string | null; title: unknown; submission_url: unknown; source_url: unknown }[]>`
      SELECT at, program_id, reason, body->'title' AS title, body->'submission_url' AS submission_url, body->'source_url' AS source_url
      FROM program_writes WHERE result = 'pending' AND at > ${new Date(now.getTime() - APPROVE_TTL_DAYS * 86_400_000)}
      ORDER BY id DESC LIMIT ${WRITES_MAX}`;
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    const pending = held.map((w) => ({
      at: w.at,
      program_id: w.program_id,
      reason: w.reason,
      title: text(w.title),
      submission_url: text(w.submission_url),
      source_url: text(w.source_url),
      expires_at: new Date(approveExpiry(new Date(w.at)) * 1000),
    }));
    return json({ ok: true, writes, pending });
  } catch (err) {
    console.error('[programs-read] writes failed', (err as { name?: string } | null)?.name ?? 'unknown');
    return json({ ok: false, error: 'EarnKit is busy. Try again in a minute.' }, 503, { 'Retry-After': '30' });
  }
}
