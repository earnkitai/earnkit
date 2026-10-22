import { randomBytes } from 'node:crypto';
import { sql } from './db';
import { noteEvent } from './events';

/**
 * v3.1 one-tap posts (design 3, Task 1): the drafted posts for X. A draft is one row behind a short code; the reply's
 * one link is earnkit.com/<handle>/post/<code>, which counts the tap and opens X's composer with the row's text (the
 * route never reads a target from the request). Limits (design 1): 1 offered draft a person per 7 days, 1 the builder
 * asked for per 24 hours, 3 in all per 7 days. A tap is a number only: no IP, no user agent. A draft lives 14 days.
 */
export const POST_MOMENTS = ['weekly', 'went_live', 'won', 'accepted', 'funded', 'news', 'coin_intro'] as const;
export type PostMoment = (typeof POST_MOMENTS)[number];

export const DRAFT_TTL_DAYS = 14;
export const TAP_CAP = 100;
export const VISIT_CAP = 10_000;
export const OFFERED_PER_WEEK = 1;
export const ASKED_PER_DAY = 1;
export const DRAFTS_PER_WEEK = 3;
/** The stored text's ceiling (the column's CHECK); the writer keeps posts to POST_MAX (post-writer.ts). */
export const DRAFT_TEXT_MAX = 240;
/** 10 characters of RFC 4648 base32, lowercase: 50 random bits. */
export const CODE_PATTERN = /^[a-z2-7]{10}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const DAY = 86_400_000;

export function newCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += BASE32[b & 31];
  return out;
}

export type NewDraft = {
  builderId: number;
  projectKey: string | null;
  moment: PostMoment;
  /** The one moment, for the cooldowns: weekly:<project>:<week>, went_live:<project>, won:<program>, coin_intro:<coin>, ... */
  momentKey: string;
  shape: string;
  text: string;
  /** The moment's facts, frozen for the card (Task 5). */
  card?: Record<string, unknown>;
  week?: string | null;
  /** The builder asked for this draft (a redraft, their news); else EarnKit offered it. */
  asked: boolean;
  /** The public page that verified an accepted, funded or won moment (owner ruling 3). */
  proofUrl?: string | null;
};
export type DraftRow = {
  code: string; builder_id: number; project_key: string | null; moment: PostMoment; moment_key: string; shape: string; text: string;
  card: Record<string, unknown>; week: string | null; asked: boolean; proof_url: string | null; created_at: Date; expires_at: Date;
  taps: number; first_tap_at: Date | null; visits: number; x_visits: number;
};
export type DraftLimit = 'text' | 'offered_limit' | 'asked_limit' | 'week_limit';

const COLUMNS = `code, builder_id, project_key, moment, moment_key, shape, text, card, week::text AS week, asked, proof_url,
  created_at, expires_at, taps, first_tap_at, visits, x_visits`;

/**
 * Writes the draft when the person's limits allow it (checked and written under one per-person lock, so drafts at
 * once never pass together), then records post_drafted. The text is the writer's (post-writer.ts); only its size is
 * checked here.
 */
export async function createDraft(d: NewDraft, now: Date = new Date()): Promise<{ ok: true; draft: DraftRow } | { ok: false; reason: DraftLimit }> {
  const text = d.text.trim();
  if (!text || text.length > DRAFT_TEXT_MAX) return { ok: false, reason: 'text' };
  const week = new Date(now.getTime() - 7 * DAY);
  const day = new Date(now.getTime() - DAY);
  const out = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`post_drafts:${d.builderId}`}))`;
    const [n] = await tx<{ offered: number; asked: number; all: number }[]>`
      SELECT count(*) FILTER (WHERE NOT asked AND created_at > ${week})::int AS offered,
        count(*) FILTER (WHERE asked AND created_at > ${day})::int AS asked,
        count(*) FILTER (WHERE created_at > ${week})::int AS all
      FROM post_drafts WHERE builder_id = ${d.builderId}`;
    if (!d.asked && n!.offered >= OFFERED_PER_WEEK) return 'offered_limit' as const;
    if (d.asked && n!.asked >= ASKED_PER_DAY) return 'asked_limit' as const;
    if (n!.all >= DRAFTS_PER_WEEK) return 'week_limit' as const;
    const [row] = await tx<DraftRow[]>`
      INSERT INTO post_drafts (code, builder_id, project_key, moment, moment_key, shape, text, card, week, asked, proof_url, created_at, expires_at)
      VALUES (${newCode()}, ${d.builderId}, ${d.projectKey}, ${d.moment}, ${d.momentKey}, ${d.shape}, ${text}, ${tx.json((d.card ?? {}) as never)},
        ${d.week ?? null}, ${d.asked}, ${d.proofUrl ?? null}, ${now}, ${new Date(now.getTime() + DRAFT_TTL_DAYS * DAY)})
      RETURNING ${tx.unsafe(COLUMNS)}`;
    return row!;
  });
  if (typeof out === 'string') return { ok: false, reason: out };
  await noteEvent('post_drafted', () => ({
    type: 'post_drafted', dedupe_key: `post_drafted:${out.code}`, installation_id: d.builderId, at: now,
    detail: { moment: out.moment, shape: out.shape, asked: out.asked },
  }));
  return { ok: true, draft: out };
}

/** The draft behind `code`, expired or not; null for an unknown or malformed code. */
export async function draftByCode(code: string): Promise<DraftRow | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const [r] = await sql()<DraftRow[]>`SELECT ${sql().unsafe(COLUMNS)} FROM post_drafts WHERE code = ${code}`;
  return r ?? null;
}

/**
 * One tap on the person's own, unexpired draft: the count goes up to TAP_CAP and stays there (the tap still answers),
 * the first tap is stamped, and the first records post_tapped. Null: not this person's, unknown or expired.
 */
export async function tapDraft(code: string, builderId: number, now: Date = new Date()): Promise<{ taps: number } | null> {
  if (!CODE_PATTERN.test(code)) return null;
  const [r] = await sql()<{ taps: number }[]>`
    UPDATE post_drafts SET taps = LEAST(taps + 1, ${TAP_CAP}), first_tap_at = COALESCE(first_tap_at, ${now})
    WHERE code = ${code} AND builder_id = ${builderId} AND expires_at > ${now}
    RETURNING taps`;
  if (!r) return null;
  if (r.taps === 1)
    await noteEvent('post_tapped', () => ({ type: 'post_tapped', dedupe_key: `post_tapped:${code}`, installation_id: builderId, at: now }));
  return { taps: r.taps };
}

/** A page open carrying ?m=<code> (Task 5): visits, and x_visits when it came from X; both capped at VISIT_CAP. */
export async function noteVisit(code: string, builderId: number, fromX: boolean): Promise<boolean> {
  if (!CODE_PATTERN.test(code)) return false;
  const r = await sql()`
    UPDATE post_drafts SET visits = visits + 1, x_visits = x_visits + ${fromX ? 1 : 0}
    WHERE code = ${code} AND builder_id = ${builderId} AND visits < ${VISIT_CAP} AND (${!fromX}::boolean OR x_visits < ${VISIT_CAP})
    RETURNING 1`;
  return r.length > 0;
}

export type RecentDraft = Pick<DraftRow, 'code' | 'moment' | 'moment_key' | 'shape' | 'text' | 'asked' | 'created_at' | 'first_tap_at' | 'proof_url'>;
/** The person's drafts, newest first (the writer's rotation and the moments' cooldowns read these). */
export async function recentDrafts(builderId: number, limit = 20): Promise<RecentDraft[]> {
  return sql()<RecentDraft[]>`
    SELECT code, moment, moment_key, shape, text, asked, created_at, first_tap_at, proof_url FROM post_drafts
    WHERE builder_id = ${builderId} ORDER BY created_at DESC, code LIMIT ${limit}`;
}
