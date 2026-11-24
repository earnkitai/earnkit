/**
 * v3.8 E9 (plan item 6, cutover A4, A6, A9): the track state machine, behind `track_v2`.
 *
 * The ledger's stored `status` is unchanged (started, applied, won, rejected, no_result, skipped, with `held_at` for a
 * hold), so every existing read, count and transition keeps working. The new states ride on three columns beside it:
 * - `stage`: found, registered, needs_build (on a held row: parked before a send), interview (on an applied row),
 *   delivered (on a won row). A stage counts only while its row's status still matches (`stateOf`), so a later send or
 *   result written by the ledger supersedes it with no extra write;
 * - `held_reason`: why a held row waits (`HELD_REASONS`);
 * - `proof` (applied only: a confirmation page or submission link, or a confirmation message reference) and `round`.
 * Closed past deadline is derived: a row not yet sent whose program's deadline passed.
 *
 * Dedup stays program x canonical project: the ledger's `applications_owner_program_identity` index (identity is the
 * canonical project) and one row per program and project, an earlier round's result moved to `earlier_win`. `round`
 * labels which round the row is.
 */
import { z } from 'zod';
import { sql } from '../v5/db';
import { programZone } from '../v5/deadline';
import { getRecord } from './builders';
import { privatePrograms } from './private-programs';

/** What a held row waits on (plan item 6). */
export const HELD_REASONS = ['wallet', 'kyc', 'captcha', 'device_prompt', 'missing_demo', 'needs_yes'] as const;
export type HeldReason = (typeof HELD_REASONS)[number];

/** The statuses `track_v2` adds: three parked before a send (written as a hold), two after one. */
export const BEFORE_SEND = ['found', 'registered', 'needs_build'] as const;
export const AFTER_SEND = ['interview', 'delivered'] as const;
export type Stage = (typeof BEFORE_SEND)[number] | (typeof AFTER_SEND)[number];

/** Every state a list row reads as (cutover A6). */
export type TrackState =
  | 'found' | 'started' | 'registered' | 'held' | 'needs_build' | 'applied' | 'interview' | 'won' | 'rejected'
  | 'no_result' | 'delivered' | 'skipped' | 'closed_past_deadline';

/** Proof of a send (A9): the confirmation page or the submission link, and/or the confirmation message's reference. */
export const ProofInput = z
  .object({
    url: z.string().url().max(500).refine((u) => /^https:\/\//i.test(u), 'url: an https link').optional()
      .describe('The confirmation page, or the submitted entry link'),
    confirmation: z.string().trim().min(1).max(200).optional().describe('The confirmation message reference (subject, id or quote)'),
  })
  .strict()
  .refine((p) => p.url !== undefined || p.confirmation !== undefined, 'proof needs url or confirmation');
export type Proof = z.infer<typeof ProofInput>;

/** The arguments `track_v2` adds to track. */
export const V2Fields = {
  held_reason: z.enum(HELD_REASONS).optional().describe('held only: what it waits on'),
  proof: ProofInput.optional().describe('applied: required; the confirmation page or entry link, or the confirmation message reference'),
  round: z.string().trim().min(1).max(40).optional().describe("The program's round, like \"Q4 2026\" or \"#46\""),
  application_id: z.string().min(1).max(80).optional().describe('interview or delivered: the application, from track list, when the program has several'),
};
const V2Input = z.object(V2Fields).strict();
export type V2 = z.infer<typeof V2Input> & { stage?: Stage };

export const PROOF_NEEDED =
  'Nothing was recorded. applied needs proof: proof.url (the confirmation page or the submitted entry link) or proof.confirmation (the confirmation message reference). Submit first, then track it with the proof.';
export const REASON_NEEDED = `Nothing was recorded. held needs held_reason: one of ${HELD_REASONS.join(', ')}.`;

/**
 * Splits track's arguments (`track_v2` on): the v2 fields out, and a parked status (found, registered, needs_build)
 * written as held, so the ledger's own hold path resolves the project. `error` when a v2 rule fails (no proof on
 * applied, no reason on held, a v2 field on the wrong status). Pure.
 */
export function splitV2(args: Record<string, unknown>): { base: Record<string, unknown>; v2: V2; error?: string } {
  const { held_reason, proof, round, application_id, ...base } = args;
  const picked = Object.fromEntries(Object.entries({ held_reason, proof, round, application_id }).filter(([, v]) => v !== undefined));
  const parsed = V2Input.safeParse(picked);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { base, v2: {}, error: `Nothing was recorded. ${i.path.map(String).join('.') || 'input'}: ${i.message}.` };
  }
  const v2: V2 = { ...parsed.data };
  const status = typeof base.status === 'string' ? base.status.trim().toLowerCase() : base.status;
  if ((BEFORE_SEND as readonly unknown[]).includes(status)) {
    v2.stage = status as Stage;
    base.status = 'held';
  } else if ((AFTER_SEND as readonly unknown[]).includes(status)) v2.stage = status as Stage;
  if (status === 'applied' && !v2.proof) return { base, v2, error: PROOF_NEEDED };
  if (status === 'held' && !v2.held_reason) return { base, v2, error: REASON_NEEDED };
  if (v2.proof && status !== 'applied') return { base, v2, error: 'Nothing was recorded. proof goes with applied only.' };
  if (v2.held_reason && status !== 'held') return { base, v2, error: 'Nothing was recorded. held_reason goes with held only.' };
  if (v2.application_id && !(AFTER_SEND as readonly unknown[]).includes(status))
    return { base, v2, error: 'Nothing was recorded. application_id goes with interview or delivered only.' };
  return { base, v2 };
}

/**
 * After the ledger wrote a hold or a send for `owner` on `programId`: the stage, reason, proof and round on that row.
 * A hold's row is the program's newest held one; a send's is `applicationId`, else the program's newest sent row.
 */
export async function afterWrite(owner: string, programId: string, status: string, v2: V2, applicationId?: string): Promise<void> {
  const db = sql();
  if (status === 'held') {
    await db`UPDATE applications SET stage = ${v2.stage ?? null}, held_reason = ${v2.held_reason ?? null}, round = COALESCE(${v2.round ?? null}, round)
      WHERE ctid = (SELECT ctid FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = 'started' AND held_at IS NOT NULL
        ORDER BY held_at DESC LIMIT 1)`;
  } else if (status === 'applied') {
    await db`UPDATE applications SET proof = ${db.json(v2.proof ?? null)}, stage = NULL, round = COALESCE(${v2.round ?? null}, round)
      WHERE ctid = (SELECT ctid FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = 'applied'
        ${applicationId ? db`AND application_id = ${applicationId}` : db``} ORDER BY sent_at DESC NULLS LAST, at DESC LIMIT 1)`;
  } else if (v2.round) {
    await db`UPDATE applications SET round = ${v2.round} WHERE ctid = (SELECT ctid FROM applications WHERE owner = ${owner} AND program_id = ${programId} ORDER BY at DESC LIMIT 1)`;
  }
}

/** The status a stage after a send needs on its row. */
const NEEDS: Record<(typeof AFTER_SEND)[number], string> = { interview: 'applied', delivered: 'won' };

/**
 * interview (on a sent application) or delivered (on a won one): the stage on the one row it names. The row is
 * `application_id`'s, else the program's only such row; none, or several with no id, is refused with what to send.
 */
export async function stageAfterSend(owner: string, programId: string, title: string, stage: (typeof AFTER_SEND)[number], v2: V2): Promise<{ ok: true } | { ok: false; show: string; note: string }> {
  const db = sql();
  const need = NEEDS[stage];
  const rows = await db<{ application_id: string | null; status: string }[]>`
    SELECT application_id, status FROM applications WHERE owner = ${owner} AND program_id = ${programId}
      ${v2.application_id ? db`AND application_id = ${v2.application_id}` : db``}`;
  const fits = rows.filter((r) => r.status === need);
  if (fits.length === 0)
    return { ok: false, show: stage === 'interview' ? `${title} isn't sent yet. Tell me once it's in.` : `${title} has no win recorded yet.`, note: `Nothing was recorded. ${stage} needs an application at ${need}.` };
  if (fits.length > 1)
    return { ok: false, show: '', note: `Nothing was recorded. Several applications to this program are ${need}: pass application_id (${fits.map((r) => r.application_id).join(', ')}).` };
  await db`UPDATE applications SET stage = ${stage}, round = COALESCE(${v2.round ?? null}, round)
    WHERE owner = ${owner} AND program_id = ${programId} AND status = ${need}
      ${fits[0].application_id ? db`AND application_id = ${fits[0].application_id}` : db``}`;
  await db`INSERT INTO application_history (owner, installation_id, program_id, status, at, source)
    SELECT owner, installation_id, program_id, ${stage}, now(), 'builder' FROM applications
    WHERE owner = ${owner} AND program_id = ${programId} AND status = ${need} ${fits[0].application_id ? db`AND application_id = ${fits[0].application_id}` : db``} LIMIT 1`;
  return { ok: true };
}

/** The builder line on a v2 write. Pure. */
export function stageLine(stage: Stage, title: string): string {
  return stage === 'found' ? `Saved ${title} for later.`
    : stage === 'registered' ? `Registered on ${title}; nothing is sent yet.`
    : stage === 'needs_build' ? `${title} needs a new build before it can be sent.`
    : stage === 'interview' ? `${title}: interview noted.`
    : `${title}: delivered after the award, noted.`;
}

type ListRow = {
  application_id: string | null; program_id: string; project_id: string | null; status: string; held_at: Date | null;
  stage: string | null; held_reason: string | null; round: string | null; proof: Proof | null; title: string | null;
  sent_at: Date | null; at: Date; amount_usd: string | null; file: { title?: string; ends_at?: string | null; tz?: string; summary?: string } | null;
};

/** What a ledger row reads as (A6): the stage while its status matches, closed past deadline for an unsent row whose
 *  deadline passed. Pure. */
export function stateOf(r: Pick<ListRow, 'status' | 'held_at' | 'stage'>, endsAt: string | null | undefined, now: Date): TrackState {
  const s = r.status;
  if (s === 'applied') return r.stage === 'interview' ? 'interview' : 'applied';
  if (s === 'won') return r.stage === 'delivered' ? 'delivered' : 'won';
  if (s === 'rejected' || s === 'no_result' || s === 'skipped') return s;
  const parked: TrackState = r.held_at === null ? 'started'
    : r.stage === 'found' || r.stage === 'registered' || r.stage === 'needs_build' ? r.stage : 'held';
  return endsAt && Date.parse(endsAt) <= now.getTime() ? 'closed_past_deadline' : parked;
}

/** `iso` in `tz` for the builder: "Nov 25, 2026, 5:29 AM IST" (India reads IST, not GMT+5:30). Pure. */
export function inZone(iso: string, tz: string): string {
  const d = new Date(iso);
  const india = tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta';
  const text = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...(india ? {} : { timeZoneName: 'short' }) }).format(d);
  return india ? `${text} IST` : text;
}

export const LIST_DEFAULT = 50;
export const LIST_MAX = 200;
export const ListInput = z
  .object({
    action: z.literal('list'),
    limit: z.number().int().min(1).max(LIST_MAX).optional(),
    cursor: z.string().max(400).optional(),
  })
  .strict();

const cursorOf = (r: { program_id: string; project_id: string | null }) => Buffer.from(JSON.stringify([r.program_id, r.project_id ?? ''])).toString('base64url');
function readCursor(c: string): [string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string') ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

export type TrackedItem = {
  application_id: string | null; program_id: string; title: string; project_id: string | null; state: TrackState;
  held_reason?: string; round?: string; proof?: Proof; sent_at: string | null; at: string; amount_usd?: number;
  deadline?: { at: string; zone: string; shown: string };
};

/**
 * track `action: list` (A4): every application row of `owner`, by program then project, `limit` at a time; a full
 * read (following `next_cursor` to null) returns exactly `total` rows, the database count. Deadlines are stored as an
 * instant with the program's zone and shown in the builder's record timezone (UTC when none).
 */
export async function listTracked(owner: string, builderId: number | null, i: { limit?: number; cursor?: string }, now: Date):
  Promise<{ items: TrackedItem[]; total: number; next_cursor: string | null; zone: string } | { error: string }> {
  const after = i.cursor === undefined ? null : readCursor(i.cursor);
  if (i.cursor !== undefined && !after) return { error: 'Nothing was read. cursor: pass next_cursor from the last list as given.' };
  const limit = i.limit ?? LIST_DEFAULT;
  const db = sql();
  const rows = await db<ListRow[]>`
    SELECT a.application_id, a.program_id, a.project_id, a.status, a.held_at, a.stage, a.held_reason, a.round, a.proof, a.title,
           a.sent_at, a.at, a.amount_usd, p.file
    FROM applications a LEFT JOIN programs p ON p.id = a.program_id
    WHERE a.owner = ${owner} ${after ? db`AND (a.program_id, COALESCE(a.project_id, '')) > (${after[0]}, ${after[1]})` : db``}
    ORDER BY a.program_id, COALESCE(a.project_id, '') LIMIT ${limit + 1}`;
  const [{ n }] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM applications WHERE owner = ${owner}`;
  const page = rows.slice(0, limit);
  const own = page.some((r) => !r.file) ? new Map((await privatePrograms(owner)).map((p) => [p.id, p])) : new Map();
  const zone = (builderId !== null ? (await getRecord(builderId)).person?.timezone : undefined) || 'UTC';
  const items = page.map((r): TrackedItem => {
    const file = r.file ?? own.get(r.program_id) ?? null;
    const endsAt = file?.ends_at ?? null;
    const programTz = file ? (file.tz ?? (file.summary ? programZone({ summary: file.summary, tz: file.tz }) : 'UTC')) : 'UTC';
    return {
      application_id: r.application_id,
      program_id: r.program_id,
      title: r.title ?? file?.title ?? r.program_id,
      project_id: r.project_id,
      state: stateOf(r, endsAt, now),
      ...(r.held_at && r.held_reason ? { held_reason: r.held_reason } : {}),
      ...(r.round ? { round: r.round } : {}),
      ...(r.proof ? { proof: r.proof } : {}),
      sent_at: r.sent_at?.toISOString() ?? null,
      at: r.at.toISOString(),
      ...(r.amount_usd !== null ? { amount_usd: Number(r.amount_usd) } : {}),
      ...(endsAt ? { deadline: { at: new Date(endsAt).toISOString(), zone: programTz, shown: inZone(endsAt, zone) } } : {}),
    };
  });
  return { items, total: n, next_cursor: rows.length > limit ? cursorOf(page.at(-1)!) : null, zone };
}
