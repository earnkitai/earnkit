/**
 * The builder's ledger, keyed by its owner ('b:<builder>' once linked, else 'i:<installation>'):
 * applications (one row per program, plus an append-only history), closed gap items, and the
 * summary `track` and `find` show. One application and one result per program: a second `applied` is refused and
 * changes nothing. A won or rejected over a different result (L16-1, L16-2 v6.1.16: won and rejected either way, a
 * win with another amount, from the program's screen or the builder's own track) is a correction that replaces it,
 * its history row marked `corrected`, so the ledger holds the latest result; `no_result` over a result is refused. A
 * win marked a further payment (`payment.key`, kept in the history; a repeated key changes nothing) adds to a win's
 * total under the cap (L15-17, T8-F1 v6.1.14) and is refused over a result that is not a win. A win's money is kept by
 * currency (`applications.amounts`, cents kept, never converted; L22-1 to L22-3 v6.1.16) with its US dollar part in
 * `amount_usd`; a further payment adds within its currency and keeps both across currencies. A win over the program's
 * stated maximum, else its pool, else 10,000,000, is refused (`overCap`, converted for the check only); investments
 * are never "asked".
 */
import { sql, type Db } from './db';
import { categoryOf, eligibilityOf } from './program-file';
import { codeChecked, itemKey } from './eligibility';
import { getProgram, isOpenAt, programsById, type ProgramRow } from './programs';
import { dayWords } from './deadline';
import { CLAIM_HOURS, UNLINKED_MEANWHILE, newApplicationId, stillLinked } from '../v6/claims';
import { projectKeyOf, type Project } from './project-input';
import { amountsText, moneyText, plusAmount, sameAmounts, totalText, type Amounts } from './programs-read';
import { UNKNOWN_CURRENCY_NOTE, amountsOverCap, comparable, overCap } from './amount';
import { displayName } from './installations';
import { quoteName } from './controls';

/** gap_done without a known item (v6.1.8, 3.10): the builder names the change, the agent gets the item keys. */
export const WHICH_CHANGE = 'Which change did you finish? Say the program and the change.';

/** A skip or a claim over another of the owner's agents' live claim (v6.1.13, B3): nothing is written. L23-3 (v6.1.16):
 *  never a send, which is always recorded (`other_claim`). */
export const OTHER_AGENT_HOLDS = 'Your other agent is handling that one; nothing recorded.';
/** L23-3 (v6.1.16): the agent note when a send landed over another agent's live claim: recorded, the claim cleared. */
export const OTHER_CLAIM_NOTE = 'Recorded. Another agent had started this one too; tell the builder so it is not sent twice.';

/** L17-2 (v6.1.16): a correction whose event time is before the stored result's: nothing changes. */
export const EARLIER_RESULT = 'An earlier result; nothing changed.';
/** L17-8 (v6.1.16): a won with no further-payment mark and the stored win's amount, from either side: a confirmation. */
export const CONFIRMED = 'Already recorded; nothing new.';
/** L17-1 (v6.1.16): a skip over a program already sent and waiting on its result. */
export const ALREADY_SENT_SKIP = 'That one was already sent; nothing to skip.';
/**
 * L17-8 (v6.1.16): one payment-key space per application. The key as given, with a legacy `s:` (screen) or `t:`
 * (track) prefix stripped, so a key stored before v6.1.16 and the same key now match (alias until v6.1.17). Pure.
 */
export const paymentKeyOf = (key: string): string => key.replace(/^[st]:/, '');

/** 'started' is a claim (lib/v6/claims.ts): not an application yet, so the summary leaves it out. */
export type Status = 'started' | 'applied' | 'won' | 'rejected' | 'no_result' | 'skipped' | 'unskip' | 'gap_done' | 'held';
/** L24-4 (v6.1.16 Task 11): `held` over an application already sent or with a result. */
export const NOTHING_TO_HOLD = 'That one was already sent; nothing to hold.';
/** L24-4: the agent note when a send lands on a program the builder held: recorded (L23-3, never refused). */
export const HELD_SENT_NOTE = 'The builder held this one; tell them it went out.';
export type Ledger = {
  applied: number;
  asked_usd: number;
  won: number;
  /** The US dollar part of the wins (L22-1, v6.1.16). */
  won_usd: number;
  /** The wins' money in other currencies, summed per code, never converted (L22-1). */
  won_other: { currency: string; amount: number }[];
  /** Wins kept with no amount (L22-1). */
  won_no_amount: number;
  /** Sent and waiting: applied, and no result (L22-8). */
  pending: number;
  rejected: number;
  skipped: number;
  /** L23-6 (v6.1.16): open programs (`isOpenAt`) this owner has not applied to or skipped, closing within 7 days. */
  closing_soon: { program_id: string; title: string; closes_at: string }[];
  /** L23-6 (v6.1.16): applied programs whose results date falls in the next 7 days, said on their own line. */
  results_soon?: { program_id: string; title: string; results_at: string }[];
};

const RESULTS = ['won', 'rejected', 'no_result'];
/** The most a win can be when the program states neither a maximum nor a pool. */
const MAX_WIN_USD = 10_000_000;
/** The most a win in this program can be: its maximum, else its pool, else MAX_WIN_USD. Pure. */
export const winCapOf = (program: ProgramRow | null | undefined): number => program?.file.max_award_usd ?? program?.file.pool_usd ?? MAX_WIN_USD;
/** L22-9 (v6.1.16): the builder's line for a win over the program's cap; nothing is written. */
export const OVER_CAP = (capUsd: number): string => `Over the program's ${moneyText(capUsd)} cap; nothing recorded.`;
/** L22-9 (v6.1.16): the owner's (a reviewer's) line for a win over the program's cap, one per applicant. */
export const OVER_CAP_FOR = (capUsd: number, ref: string, at: string): string => `Over the program's ${moneyText(capUsd)} cap: ${ref} at ${at}. Nothing recorded for it.`;
/**
 * L16-1, L16-2 (v6.1.16): a further payment over a result that is not a win (`rejected`, `no result`; on a screen also
 * `shortlisted`, or `none` when nothing is kept) writes nothing.
 */
export const FURTHER_PAYMENT_REFUSED = (status: string) =>
  // Fix round 1b: no result yet is said in words, never as the status `none`.
  status === 'none' ? 'Further payment refused: no result yet; post a win first.' : `Further payment refused: the current result is ${status}; post a win first.`;
/** A win with no amount above 0 (L22-6, v6.1.16: cents are kept, so a win is no longer whole dollars only). */
export const WHOLE_DOLLARS = 'Tell me how much you won.';
const DAY = 86_400_000;
/** How long after its close a send still counts under standing approval (F8, v6.1.12). */
export const CLOSED_GRACE_MS = 3_600_000;

/** When results are due: the file's date, else the close plus the weeks after, else null. */
export function resultsDateOf(p: ProgramRow): Date | null {
  const r = p.file.results_due;
  if (r?.date) return new Date(r.date);
  if (r?.weeks_after_close !== undefined && p.file.ends_at) return new Date(Date.parse(p.file.ends_at) + r.weeks_after_close * 7 * DAY);
  return null;
}

/** The passed programs plus the rows for the ids the ledger holds (the passed ones win). */
async function withOwn(ids: string[], programs: ProgramRow[]): Promise<Map<string, ProgramRow>> {
  const map = new Map(programs.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !map.has(id));
  for (const p of await programsById(missing)) map.set(p.id, p);
  return map;
}

/** The installation an 'i:' owner names. Pure. */
const installationOf = (owner: string): number | undefined => (/^i:(\d+)$/.exec(owner) ? Number(owner.slice(2)) : undefined);

/**
 * A row's win money (L22-3, v6.1.16): `amounts` when set, else the US dollars of a row written before it, else null.
 * Pure.
 */
export function amountsOf(r: { amounts?: unknown; amount_usd?: string | number | null }): Amounts | null {
  if (r.amounts && typeof r.amounts === 'object') {
    const out = Object.fromEntries(Object.entries(r.amounts as Record<string, unknown>).map(([c, v]) => [c, Number(v)]).filter(([, v]) => Number.isFinite(v) && (v as number) > 0));
    return Object.keys(out).length > 0 ? out : null;
  }
  return r.amount_usd === null || r.amount_usd === undefined ? null : { USD: Number(r.amount_usd) };
}
/** L13-13 (v6.1.14): a program's win passed on without its amount, as the row's note says. */
export const AMOUNT_NOT_GIVEN = 'amount not given';
/**
 * "won $2,500.50", "won EUR 2,000", "won $1,000 and EUR 500", "won, amount not given", "rejected", "no result": a row's
 * result in words, its money through the one format (L22-7, v6.1.16). Pure.
 */
export const resultWords = (status: string, amounts: Amounts | null) =>
  status === 'won' ? (amounts === null ? `won, ${AMOUNT_NOT_GIVEN}` : `won ${amountsText(amounts)}`) : status === 'no_result' ? 'no result' : status;
export { newApplicationId };

/** The program's title: the catalog's, else the one stored when it was sent, else the id. */
export async function titleOf(owner: string, programId: string): Promise<string> {
  const p = await getProgram(programId);
  if (p) return p.file.title;
  const [r] = await sql()<{ title: string | null }[]>`SELECT title FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
  return r?.title ?? programId;
}

/**
 * Writes set the owner and the writing installation (`o.installationId`, which an 'i:' owner implies). A `gap_done`
 * with no item, or one that is not one of the program's own item keys (`users` only when it has a users item, v6.1.7
 * C27), is refused and clears nothing; the refusal carries the keys for the agent in `items`, never in builder text.
 * A `gap_done` whose item was already noted answers `repeated` (v6.1.7, C26).
 */
export async function record(
  owner: string,
  programId: string,
  status: Status,
  o: {
    installationId?: number; note?: string; item?: string; now?: Date;
    /** won only: US dollars (an alias of `amount` with currency USD). */
    amount_usd?: number;
    /** won only (L22-2, v6.1.16): the amount, cents kept; `currency` (upper-case code) left out when the builder named
     *  none, so a win over a result held in one other currency takes that currency. */
    amount?: { value: number; currency?: string };
    /** gap_done only: the project the step belongs to (projectKeyOf; '' for none, v6.1.10 L1c-1). */
    projectKey?: string;
    /** applied only: who pressed submit, the field keys sent and the record's project. */
    submitted_by?: 'agent' | 'builder'; fields_used?: string[]; project_id?: string;
    /** applied only: the builder's standing approval covered this send when it was tracked (track checks the policy). */
    autoApplied?: boolean;
    /** applied with autoApplied: the policy's max_per_night. Counted here under the owner's lock: a send past it is
     *  recorded as not under standing approval and answers `night` (v6.1.8 B18). */
    maxPerNight?: number;
    /** won only, from a program's screen (L13-13, v6.1.14): the program gave no amount; the win is kept with none,
     *  its note AMOUNT_NOT_GIVEN (or `note`). A later win with the amount completes it. */
    amountNotGiven?: true;
    /** won only (T8-F1, v6.1.14): a further payment of a win, its caller's idempotency key; adds to the total once per key. */
    payment?: { key: string };
    /** A program's screen outcome (screen-jobs.recordOutcomes): not an agent's call, so the link check is skipped. */
    fromScreen?: true;
    /** won only (L29-3, v6.1.16 Task 15): with no application here (none, a claim or a skip), the builder's own send is
     *  written first (submitted_by builder), then the win; answers `outside`. */
    outsideWin?: true;
  } = {},
): Promise<RecordResult> {
  const installationId = o.installationId ?? installationOf(owner);
  if (installationId === undefined) throw new Error('record needs the writing installation');
  const now = o.now ?? new Date();
  const program = await getProgram(programId);
  const unknown = { ok: false, note: "I don't know that program." } as const;
  // A result may land after the program left the catalog, when the owner's ledger holds it (checked below).
  if (!program && !RESULTS.includes(status)) return unknown;
  const given = o.amount ?? (o.amount_usd !== undefined ? { value: o.amount_usd, currency: 'USD' } : undefined);
  const noAmount = status === 'won' && o.amountNotGiven === true && given === undefined;
  if (status === 'won' && !noAmount && !(given && typeof given.value === 'number' && Number.isFinite(given.value) && given.value > 0))
    return { ok: false, note: WHOLE_DOLLARS };
  if (status === 'gap_done' && program) {
    // Only one of the program's own items; the unknown-users gap ('users') only when it has a users item (v6.1.7, C27).
    const items = eligibilityOf(program.file);
    // T3-R1 (v6.1.13): the code-in-a-repo step ('repo') is taken, re-checked by the read; fix round 1 (T7-F2, v6.1.14):
    // for any program, as the bar's code step (L12-7) shows on programs that do not require a repo too.
    const keys = [...new Set([...items.map(itemKey), ...(items.some((x) => x.kind === 'users') ? ['users'] : []), 'repo'])];
    // The keys go to the agent only: builder text never carries them (v6.1.6, 25a); also when no item came (C11).
    if (!o.item || !keys.includes(o.item)) return { ok: false, note: WHICH_CHANGE, items: keys };
  }
  if (status === 'gap_done' && !o.item) return { ok: false, note: WHICH_CHANGE };
  if (status === 'started') throw new Error('a claim is written by claims.claim');
  // L22-5 (v6.1.16, fix round 1): the cap reads the given value; it is rounded to the cent only to be stored.
  const givenValue = status === 'won' && !noAmount ? given!.value : null;
  const value = givenValue === null ? null : Math.round(givenValue * 100) / 100;
  const cap = winCapOf(program);
  const note = noAmount ? o.note ?? AMOUNT_NOT_GIVEN : o.note ?? null;
  let repeated = false;
  let night = false;
  let closed = false;
  let total: Amounts | null = null;
  let replacedFrom: Amounts | null = null;
  const paymentKey = status === 'won' && o.payment ? paymentKeyOf(o.payment.key) : null;
  // L17-2 (v6.1.16): every history row names who wrote it.
  const source = o.fromScreen ? 'screen' : 'builder';

  return (await sql().begin(async (tx) => {
    // One decision at a time per owner and program (the claim's lock), even when no row exists yet.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + programId}))`;
    // T5-F4 (v6.1.14, fix round 2): no call of an agent unlinked meanwhile lands in the builder's ledger, whatever its
    // status; a program's screen outcome (`fromScreen`) is written as the application's own installation and skips it.
    if (!o.fromScreen && !(await stillLinked(tx, owner, installationId))) return { ok: false, note: UNLINKED_MEANWHILE } as const;
    const [row] = await tx<{ status: string; amount_usd: string | null; amounts: unknown; note: string | null; at: Date; client_name: string | null; claimed_at: Date | null; claimed_by: number | null; held_at: Date | null }[]>`
      SELECT a.status, a.amount_usd, a.amounts, a.note, a.at, i.client_name, a.claimed_at, a.claimed_by, a.held_at FROM applications a LEFT JOIN installations i ON i.id = a.installation_id
      WHERE a.owner = ${owner} AND a.program_id = ${programId} FOR UPDATE OF a`;
    if (!program && !row) return unknown;
    // L24-4 (v6.1.16 Task 11): the builder's hold. On a claim (any installation's, live or not) it sets held_at; with no
    // row it writes a claim for this installation, held, so a program the standing-approval line named can be held
    // before any agent started it. A program sent, with a result or skipped has nothing to hold.
    if (status === 'held') {
      if (row?.status === 'skipped') return { ok: false, note: 'You skipped that one; nothing to hold.' } as const;
      if (row && row.status !== 'started') return { ok: false, note: NOTHING_TO_HOLD } as const;
      if (row?.held_at) return { ok: true, repeated: true } as const;
      if (row) await tx`UPDATE applications SET held_at = ${now} WHERE owner = ${owner} AND program_id = ${programId}`;
      else
        await tx`INSERT INTO applications (owner, installation_id, program_id, status, note, at, project_id, claimed_at, claimed_by, application_id, held_at)
          VALUES (${owner}, ${installationId}, ${programId}, 'started', ${note}, ${now}, ${o.projectKey || null}, ${now}, ${installationId}, ${newApplicationId()}, ${now})`;
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, note, at, source)
        VALUES (${owner}, ${installationId}, ${programId}, 'held', ${note}, ${now}, ${source})`;
      return { ok: true } as const;
    }
    const kept = row?.status === 'won' ? amountsOf(row) : null;
    // L22-2 (v6.1.16): a win with no currency named, over a win held in one other currency, is in that currency.
    const keptCodes = Object.keys(kept ?? {});
    const currency = given?.currency ?? (keptCodes.length === 1 && keptCodes[0] !== 'USD' ? keptCodes[0] : 'USD');
    const money: Amounts | null = value === null ? null : { [currency]: value };
    // L22-4, L22-5 (v6.1.16): the given amount against the cap, before any rounding; another currency converted for the check only.
    const overNote = { ok: false, note: OVER_CAP(cap), ...(!comparable(currency) && { agent_note: UNKNOWN_CURRENCY_NOTE }) } as const;
    if (givenValue !== null && overCap(givenValue, currency, cap)) return overNote;
    // L13-13 (v6.1.14): a win kept without its amount takes the amount once; nothing else replaces a result.
    const completes = row?.status === 'won' && kept === null && status === 'won' && money !== null;
    // T8-F1 (v6.1.14): a payment key already kept for this application changes nothing (a retried call).
    // L17-8 (v6.1.16): one key space per application; a key stored with a legacy prefix matches the same key now.
    if (paymentKey !== null && row?.status === 'won'
      && (await tx<{ payment_key: string }[]>`SELECT payment_key FROM application_history WHERE owner = ${owner} AND program_id = ${programId} AND payment_key IS NOT NULL`)
        .some((h) => paymentKeyOf(h.payment_key) === paymentKey))
      return { ok: false, note: 'Already tracked.' } as const;
    // L17-1 (v6.1.16): a skip is decided here, under the lock, against the row as it is now: a repeat changes nothing,
    // a sent program has nothing to skip, and another agent's live claim stays.
    if (status === 'skipped' && row?.status === 'skipped') return { ok: true, repeated: true } as const;
    if (status === 'skipped' && row?.status === 'applied') return { ok: false, note: ALREADY_SENT_SKIP } as const;
    if (status === 'skipped' && row?.status === 'started' && row.held_at === null && row.claimed_by !== null && row.claimed_by !== installationId
      && row.claimed_at !== null && row.claimed_at.getTime() > now.getTime() - CLAIM_HOURS * 3_600_000)
      return { ok: false, note: OTHER_AGENT_HOLDS } as const;
    const hasResult = row !== undefined && RESULTS.includes(row.status);
    // L16-1, L16-2 (v6.1.16): a further payment needs a win to add to; over another result, or over a send with no
    // result yet (fix round 1, M1: `none`, as the screen says), nothing is written.
    if (paymentKey !== null && row !== undefined && (row.status === 'applied' || (hasResult && row.status !== 'won'))) {
      const current = row.status === 'applied' ? 'none' : resultWords(row.status, null);
      return { ok: false, note: FURTHER_PAYMENT_REFUSED(current), current } as const;
    }
    // L15-17, T8-F1 (v6.1.14): a win with an amount over a win with an amount, marked a further payment, adds (the
    // total under the cap). L22-3 (v6.1.16): within its currency; across currencies the win keeps both, never replaced.
    const bothWon = row?.status === 'won' && kept !== null && status === 'won' && value !== null;
    const adds = bothWon && paymentKey !== null;
    if (adds) {
      total = plusAmount(kept, value, currency);
      if (amountsOverCap({ ...kept, [currency]: (kept?.[currency] ?? 0) + givenValue! }, cap)) return overNote;
    }
    // The same result: the same status and money (a win kept with no amount also by its note).
    const same = hasResult && row.status === status && sameAmounts(row.status === 'won' ? kept : null, money)
      && (status !== 'won' || money !== null || (row.note ?? null) === note);
    // L16-1, L16-2 (v6.1.16): a won or rejected, unmarked, over a different result is a correction: the latest result
    // replaces it, whether the program's screen or the builder's own track sends it (T8-F1's other amount among them).
    const corrects = hasResult && (status === 'won' || status === 'rejected') && paymentKey === null && !completes && !same;
    // L17-2 (v6.1.16): a correction applies only when its event is at or after the stored result's; an older one changes nothing.
    if (corrects && now.getTime() < row.at.getTime()) return { ok: false, note: EARLIER_RESULT } as const;
    // Fix round 1 (I1): a repeat never moves the stored time; the stored time stays the original result's.
    // L17-8 (v6.1.16): the stored win again, with no further-payment mark, from the screen or the builder: a confirmation.
    if (same && status === 'won' && paymentKey === null) return { ok: false, note: CONFIRMED } as const;
    if (corrects && row.status === 'won' && kept !== null && money !== null) replacedFrom = kept;
    const resulted = hasResult && !completes && !adds && !corrects;
    if (resulted && status === 'skipped') return { ok: false, note: 'That one already has a result here; nothing to skip.' } as const;
    if (resulted && RESULTS.includes(status) && row.status === status && (status !== 'won' || sameAmounts(kept, money)))
      return { ok: false, note: 'Already tracked.' } as const;
    if (resulted && (status === 'applied' || RESULTS.includes(status)))
      return { ok: false, note: `That one already has a result here: ${resultWords(row.status, kept)}.` } as const;
    if (status === 'applied' && row?.status === 'applied')
      // L24-1 (v6.1.16 Task 11): an agent's own name reaches the builder through quoteName.
      return { ok: false, note: `Already sent here on ${dayWords(row.at, now)} by ${row.client_name ? quoteName(displayName(row.client_name) ?? row.client_name) : 'another agent'}; nothing recorded.` } as const;
    // B3 (v6.1.13) holds only a claim (claims.claim) and a skip (above). L23-3 (v6.1.16): a send over another
    // installation's live claim is never refused or lost: it is recorded, the claim cleared, and `other_claim` said.
    const heldSend = status === 'applied' && row?.status === 'started' && row.held_at !== null;
    const otherClaim = status === 'applied' && row?.status === 'started' && !heldSend && row.claimed_by !== null && row.claimed_by !== installationId
      && row.claimed_at !== null && row.claimed_at.getTime() > now.getTime() - CLAIM_HOURS * 3_600_000;
    const outside = status === 'won' && o.outsideWin === true && !o.fromScreen && program !== null && (!row || row.status === 'skipped' || row.status === 'started');
    if (outside) {
      // L29-3 (v6.1.16 Task 15): the send the builder made outside EarnKit, so the win below lands on an application.
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, note, at, sent_at, submitted_by, project_id, title, application_id)
        VALUES (${owner}, ${installationId}, ${programId}, 'applied', NULL, ${now}, ${now}, 'builder', ${o.projectKey || null}, ${program!.file.title}, ${newApplicationId()})
        ON CONFLICT (owner, program_id) DO UPDATE SET installation_id = EXCLUDED.installation_id, status = 'applied', at = EXCLUDED.at, sent_at = EXCLUDED.sent_at,
          submitted_by = 'builder', title = EXCLUDED.title, held_at = NULL, claimed_at = NULL, claimed_by = NULL,
          application_id = COALESCE(applications.application_id, EXCLUDED.application_id), project_id = COALESCE(EXCLUDED.project_id, applications.project_id)`;
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, note, at, source)
        VALUES (${owner}, ${installationId}, ${programId}, 'applied', 'sent by the builder outside EarnKit', ${now}, ${source})`;
    } else if (RESULTS.includes(status) && (!row || row.status === 'skipped' || row.status === 'started')) return { ok: false, note: "You haven't applied to that one here." } as const;
    if (status === 'unskip') {
      // Only a skipped row can be unskipped: the row goes, and the program can come back in the list.
      if (row?.status !== 'skipped') return { ok: false, note: "That one isn't skipped here." } as const;
      await tx`DELETE FROM applications WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (status === 'gap_done') {
      // xmax = 0 only on a fresh insert: an existing row means the item was already noted.
      const [g] = await tx<{ inserted: boolean }[]>`INSERT INTO gaps_done (owner, installation_id, project_key, program_id, item, at)
        VALUES (${owner}, ${installationId}, ${o.projectKey ?? ''}, ${programId}, ${o.item!}, ${now})
        ON CONFLICT (owner, project_key, program_id, item) DO UPDATE SET at = EXCLUDED.at RETURNING (xmax = 0) AS inserted`;
      repeated = !g.inserted;
    } else if (status === 'applied') {
      let auto = o.autoApplied === true;
      // F8 (v6.1.12): a program closed over an hour before the send is never sent under standing approval; within the
      // hour the send went in as it closed.
      if (auto && program!.file.ends_at && now.getTime() - Date.parse(program!.file.ends_at) > CLOSED_GRACE_MS) {
        auto = false;
        closed = true;
      }
      if (auto && o.maxPerNight !== undefined) {
        // Tonight's sends under standing approval: the last 24 hours, counted one at a time per owner.
        await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':auto'}))`;
        if ((await autoSentSince(owner, new Date(now.getTime() - DAY), tx, programId)) >= o.maxPerNight) {
          auto = false;
          night = true;
        }
      }
      // Over a claim the row keeps claimed_at and claimed_by: what was claimed, then sent.
      // The title is kept, so a result still reads once the program leaves the catalog.
      // sent_at is the send time: a result later moves `at`, never this (v6.1.9 N2).
      // L13-1 (v6.1.14): the application's own id, kept when the row already has one.
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, amounts, note, at, sent_at, submitted_by, fields_used, project_id, auto_applied, title, application_id)
        VALUES (${owner}, ${installationId}, ${programId}, 'applied', NULL, NULL, ${note}, ${now}, ${now}, ${o.submitted_by ?? null}, ${o.fields_used ?? null}, ${o.project_id ?? null}, ${auto}, ${program!.file.title}, ${newApplicationId()})
        ON CONFLICT (owner, program_id) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = 'applied', amount_usd = NULL, amounts = NULL, note = EXCLUDED.note, at = EXCLUDED.at, sent_at = EXCLUDED.sent_at,
              application_id = COALESCE(applications.application_id, EXCLUDED.application_id),
              submitted_by = EXCLUDED.submitted_by, fields_used = EXCLUDED.fields_used, auto_applied = EXCLUDED.auto_applied, title = EXCLUDED.title, held_at = NULL,
              project_id = COALESCE(EXCLUDED.project_id, applications.project_id)`;
      if (otherClaim) await tx`UPDATE applications SET claimed_at = NULL, claimed_by = NULL WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (status === 'skipped' && row?.status === 'started') {
      // A skip over a claim replaces it: the claim is gone, the skip stays.
      await tx`UPDATE applications SET installation_id = ${installationId}, status = 'skipped', note = ${note}, at = ${now},
        claimed_at = NULL, claimed_by = NULL WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (total !== null) {
      // L17-2: `at` never moves backwards.
      await tx`UPDATE applications SET installation_id = ${installationId}, amount_usd = ${total.USD ?? null}, amounts = ${tx.json(total)}, at = GREATEST(at, ${now})
        WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (corrects) {
      await tx`UPDATE applications SET installation_id = ${installationId}, status = ${status}, amount_usd = ${money?.USD ?? null}, amounts = ${money ? tx.json(money) : null},
        note = ${note}, at = ${now} WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (!(status === 'skipped' && row)) {
      // A skip on a program already in the ledger hides nothing new: the application stays as it is.
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, amounts, note, at)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${money?.USD ?? null}, ${money ? tx.json(money) : null}, ${note}, ${now})
        ON CONFLICT (owner, program_id) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = EXCLUDED.status, amount_usd = EXCLUDED.amount_usd, amounts = EXCLUDED.amounts, note = EXCLUDED.note, at = EXCLUDED.at`;
    }
    // L17-1 (v6.1.16): a history row only when the ledger changed (a repeated gap_done changed nothing).
    if (!repeated)
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, amount, currency, note, at, payment_key, corrected, source)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${currency === 'USD' ? value : null}, ${value}, ${value === null ? null : currency}, ${note}, ${now}, ${paymentKey}, ${corrects}, ${source})`;
    const other = otherClaim ? ({ other_claim: true } as const) : heldSend ? ({ held: true } as const) : {};
    return repeated ? ({ ok: true, repeated: true } as const) : night ? ({ ok: true, night: true, ...other } as const) : closed ? ({ ok: true, closed: true, ...other } as const)
      : outside ? ({ ok: true, outside: true } as const)
      : otherClaim ? ({ ok: true, other_claim: true } as const)
      : heldSend ? ({ ok: true, held: true } as const)
      : total !== null ? ({ ok: true, total } as const)
      : corrects ? ({ ok: true, corrected: true, ...(replacedFrom !== null && { replaced: replacedFrom }) } as const)
      : ({ ok: true } as const);
  })) as RecordResult;
}

/**
 * What `record` answers. `total` (a further payment added) and `replaced` (the win a
 * correction replaced) are by currency (L22-3, v6.1.16); `agent_note` names why a refusal's currency could not be compared.
 */
export type RecordResult =
  | { ok: true; repeated?: true; night?: true; closed?: true; total?: Amounts; replaced?: Amounts; corrected?: true; other_claim?: true; held?: true; outside?: true }
  | { ok: false; note: string; items?: string[]; current?: string; agent_note?: string };

/**
 * Sends under standing approval since `since` (by the send time; a row from before v6.1.9 without one reads its
 * `at`), other than `except`. The nightly limit counts these (v6.1.9 N2); find subtracts them from tonight (N1).
 */
export async function autoSentSince(owner: string, since: Date, db: Db = sql(), except = ''): Promise<number> {
  const [r] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM applications
    WHERE owner = ${owner} AND auto_applied AND program_id <> ${except} AND COALESCE(sent_at, at) > ${since}`;
  return r.n;
}

export async function summary(owner: string, programs: ProgramRow[], now: Date): Promise<Ledger> {
  const rows = await sql()<{ program_id: string; status: string; amount_usd: string | null; amounts: unknown }[]>`
    SELECT program_id, status, amount_usd, amounts FROM applications WHERE owner = ${owner}`;
  const byId = await withOwn(rows.map((r) => r.program_id), programs);
  const l: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, won_other: [], won_no_amount: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [], results_soon: [] };
  let won: Amounts = {};
  const week = (d: Date | null) => d !== null && d.getTime() >= now.getTime() && d.getTime() <= now.getTime() + 7 * DAY;
  const results: { program_id: string; title: string; at: number }[] = [];
  for (const r of rows) {
    if (r.status === 'started') continue;
    if (r.status === 'skipped') {
      l.skipped++;
      continue;
    }
    l.applied++;
    const p = byId.get(r.program_id);
    if (p && !p.file.investment && categoryOf(p.file) !== 'investment') l.asked_usd += p.file.max_award_usd ?? 0;
    if (r.status === 'won') {
      l.won++;
      // L22-1 (v6.1.16): every currency kept apart, never converted; a win with none is counted by itself.
      const a = amountsOf(r);
      if (a === null) l.won_no_amount++;
      else for (const [c, v] of Object.entries(a)) won = plusAmount(won, v, c);
    } else if (r.status === 'rejected') l.rejected++;
    // L22-8 (v6.1.16): no result counts as waiting, so the parts always sum to the sent count.
    else if (r.status === 'no_result') l.pending++;
    else if (r.status === 'applied') {
      l.pending++;
      // L23-6 (v6.1.16): a sent program's results date in the next 7 days, never its close.
      const due = p ? resultsDateOf(p) : null;
      if (p && week(due)) results.push({ program_id: p.id, title: p.file.title, at: due!.getTime() });
    }
  }
  // L23-6 (v6.1.16): closing soon is by ends_at only, over the open programs this owner has no application for.
  const has = new Set(rows.filter((r) => r.status !== 'started').map((r) => r.program_id));
  const soon = programs
    .filter((p) => !has.has(p.id) && isOpenAt(p.file, now) && p.file.ends_at && week(new Date(p.file.ends_at)))
    .map((p) => ({ program_id: p.id, title: p.file.title, at: Date.parse(p.file.ends_at!) }));
  l.won_usd = won.USD ?? 0;
  l.won_other = Object.entries(won).filter(([c]) => c !== 'USD').sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount }));
  l.closing_soon = soon.sort((a, b) => a.at - b.at).map((s) => ({ program_id: s.program_id, title: s.title, closes_at: new Date(s.at).toISOString() }));
  l.results_soon = results.sort((a, b) => a.at - b.at).map((s) => ({ program_id: s.program_id, title: s.title, results_at: new Date(s.at).toISOString() }));
  return l;
}

/**
 * The counts after "Your applications: " (L21-1, v6.1.16): "6 sent, 3 won ($12,000), 1 rejected, 2 waiting." The find
 * reply and /me's totals line share it, so the two always agree (Review Focus 9). What was won, never what was asked
 * (v6.1.8, 3.6), as `totalText` writes it (L22-1: "3 won ($3,500.50 and EUR 2,000)", "2 won ($5,000, one amount not
 * given)"); a count of none is left out, waiting is said whenever any wait (L13-18). Pure.
 */
export function ledgerCounts(l: Ledger): string {
  const total = totalText({ usd: l.won_usd, other: l.won_other ?? [], noAmount: l.won_no_amount ?? 0 });
  const won = l.won > 0 && total ? ` (${total})` : '';
  const counts = [`${l.applied} sent`, ...(l.won > 0 ? [`${l.won} won${won}`] : []), ...(l.rejected > 0 ? [`${l.rejected} rejected`] : []), ...(l.pending > 0 ? [`${l.pending} waiting`] : [])];
  return `${counts.join(', ')}.`;
}

/** L23-18 (v6.1.16): when this owner sent the program (an `applied` row waiting on its result), or null. */
export async function sentOf(owner: string, programId: string): Promise<Date | null> {
  const [r] = await sql()<{ sent: Date }[]>`
    SELECT COALESCE(sent_at, at) AS sent FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = 'applied'`;
  return r?.sent ?? null;
}

/** L16-7 (v6.1.16): the program's result for this owner (won, rejected or no result), or null when it has none. */
export async function resultOf(owner: string, programId: string): Promise<{ status: 'won' | 'rejected' | 'no_result'; amount_usd: string | null; amounts: Amounts | null; note: string | null } | null> {
  const [r] = await sql()<{ status: 'won' | 'rejected' | 'no_result'; amount_usd: string | null; amounts: unknown; note: string | null }[]>`
    SELECT status, amount_usd, amounts, note FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = ANY(${RESULTS})`;
  return r ? { ...r, amounts: r.status === 'won' ? amountsOf(r) : null } : null;
}

/** Program ids the builder applied to or skipped: they leave the list. A claimed ('started') one stays, marked. */
export async function excluded(owner: string): Promise<Set<string>> {
  const rows = await sql()<{ program_id: string }[]>`SELECT program_id FROM applications WHERE owner = ${owner} AND status <> 'started'`;
  return new Set(rows.map((r) => r.program_id));
}

/** L1e-4 (v6.1.13): items that are facts about the project, not one program's step: done on any program of the
 *  project, they are done for every program on it. */
export const PROJECT_ITEMS: readonly string[] = ['users'];

/** The owner's done steps on this project, by program, and the project items done on any of them (L1e-4). */
export type Done = {
  /** The program's own done steps plus the project items: what its gaps are judged on. */
  of: (programId: string) => Set<string>;
  /** Only the steps marked on this program: a yes said to it (rule_yes) and what it was acted on for. */
  own: Map<string, Set<string>>;
};

/** Pure. */
const doneOf = (rows: { program_id: string; item: string }[]): Done => {
  const own = new Map<string, Set<string>>();
  for (const r of rows) own.set(r.program_id, (own.get(r.program_id) ?? new Set<string>()).add(r.item));
  const project = rows.filter((r) => PROJECT_ITEMS.includes(r.item)).map((r) => r.item);
  return { own, of: (id) => new Set([...(own.get(id) ?? []), ...project]) };
};

/** The steps the owner marked done for the program on this project (projectKeyOf, v6.1.10 L1c-1), with the project
 *  items done on any program of it (L1e-4, v6.1.13): the one read track, the one-program find and the send check use. */
export async function doneItems(owner: string, programId: string, projectKey: string): Promise<Set<string>> {
  return (await doneOn(owner, projectKey)).of(programId);
}

/**
 * B4 (v6.1.13): a project first found by name alone and later with its repo keeps its steps and claims. The owner's
 * done steps and application rows stored under `from` (the `name:` key) move to `to` (the repo key) in one
 * transaction; a step already under `to` keeps the newer of the two times. A no-op when the keys are one or `from` is ''.
 */
export async function rekeyProject(owner: string, from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return;
  await sql().begin(async (tx) => {
    // W4 (final round): copied with ON CONFLICT, so a step marked under `to` at this moment never breaks the unique
    // index; the newer time (and its installation) wins. Then the `from` rows go.
    await tx`INSERT INTO gaps_done (owner, installation_id, project_key, program_id, item, at)
      SELECT owner, installation_id, ${to}, program_id, item, at FROM gaps_done WHERE owner = ${owner} AND project_key = ${from}
      ON CONFLICT (owner, project_key, program_id, item) DO UPDATE
        SET installation_id = CASE WHEN EXCLUDED.at > gaps_done.at THEN EXCLUDED.installation_id ELSE gaps_done.installation_id END,
            at = GREATEST(gaps_done.at, EXCLUDED.at)`;
    await tx`DELETE FROM gaps_done WHERE owner = ${owner} AND project_key = ${from}`;
    // One application row per owner and program, so a claim's project moves without a conflict.
    await tx`UPDATE applications SET project_id = ${to} WHERE owner = ${owner} AND project_id = ${from}`;
    await tx`INSERT INTO project_reports (owner, project_key, report, at)
      SELECT owner, ${to}, report, at FROM project_reports WHERE owner = ${owner} AND project_key = ${from}
      ON CONFLICT (owner, project_key) DO UPDATE
        SET report = CASE WHEN EXCLUDED.at > project_reports.at THEN EXCLUDED.report ELSE project_reports.report END,
            at = GREATEST(project_reports.at, EXCLUDED.at)`;
    await tx`DELETE FROM project_reports WHERE owner = ${owner} AND project_key = ${from}`;
  });
}

/** Keeps the project as the agent reported it at this find (parsed, v6.1.13 Task 1 review I1), per owner and project key. */
export async function saveReport(owner: string, projectKey: string, report: Project, now: Date): Promise<void> {
  if (!projectKey) return;
  await sql()`INSERT INTO project_reports (owner, project_key, report, at) VALUES (${owner}, ${projectKey}, ${sql().json(report as never)}, ${now})
    ON CONFLICT (owner, project_key) DO UPDATE SET report = EXCLUDED.report, at = EXCLUDED.at`;
}

/** Days cached evidence stays (W3, final round; L23-12 v6.1.16: the evidence only, never the report). */
export const REPORT_DAYS = 180;
/**
 * L23-12 (v6.1.16): the 180-day sweep removes cached evidence only: `repo_cache` and `evidence_cache` rows read over
 * REPORT_DAYS ago, never a `project_reports` row (the project key, its repo) or a `gaps_done` row (a confirmed rule), so
 * a find past 180 days re-reads its evidence and says nothing extra. It runs before `sweepEvidence` (the same 180 days),
 * which then finds nothing past it. The rows deleted.
 */
export async function sweepReports(now: Date): Promise<number> {
  const before = new Date(now.getTime() - REPORT_DAYS * DAY);
  const repo = (await sql()`DELETE FROM repo_cache WHERE fetched_at < ${before}`).count;
  const evidence = (await sql()`DELETE FROM evidence_cache WHERE read_at < ${before}`).count;
  return repo + evidence;
}

/**
 * W1 and W2 (final round): the one key a project's steps, claims and report are read under. A `name:` key whose report
 * (the owner's last find by that name, or with it) names a repo resolves to that repo's key, so a find or send by name
 * alone sees what a find with the repo marked; any other key is itself.
 */
export async function resolvedKey(owner: string, key: string): Promise<string> {
  if (!key.startsWith('name:')) return key;
  const repo = (await reportOf(owner, key))?.repo_url;
  return (repo && projectKeyOf({ repo_url: repo })) || key;
}

/** The project as reported at the owner's last find on this project key, or null. */
export async function reportOf(owner: string, projectKey: string): Promise<Project | null> {
  if (!projectKey) return null;
  const [r] = await sql()<{ report: Project }[]>`SELECT report FROM project_reports WHERE owner = ${owner} AND project_key = ${projectKey}`;
  return r?.report ?? null;
}

/** When the owner last marked a code-checked step done on this project (v6.1.9 S4), or null: a repo read cached before it is stale. */
export async function codeDoneAt(owner: string, projectKey: string): Promise<Date | null> {
  const rows = await sql()<{ item: string; at: Date }[]>`SELECT item, at FROM gaps_done WHERE owner = ${owner} AND project_key = ${projectKey}`;
  const times = rows.filter((r) => codeChecked(r.item)).map((r) => r.at.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}

/** Every closed gap item of the owner on this project, by program, and the project items (L1e-4): one query for a
 *  whole find. */
export async function doneOn(owner: string, projectKey: string): Promise<Done> {
  const rows = await sql()<{ program_id: string; item: string }[]>`
    SELECT program_id, item FROM gaps_done WHERE owner = ${owner} AND project_key = ${projectKey}`;
  return doneOf(rows);
}

/** Days after the send EarnKit asks how it went, for a program with no results date (v6.1.9). */
export const ASK_AFTER_DAYS = 30;

/** An applied program past its results date with no result yet (L23-4, v6.1.16): when the results were due. */
export type OutcomeDue = { program_id: string; title: string; due_at: string };

/**
 * L23-4 (v6.1.16): every applied program whose results date has passed (`results_due`, else ASK_AFTER_DAYS after the
 * send: its sent_at, else its at for a row from before v6.1.9) and that has no result yet, on every find until one is
 * recorded. Which installation shows it today is `outcomeAsksDue`; `asked_outcome_at` stays for the record only.
 */
export async function askOutcome(owner: string, programs: ProgramRow[], now: Date): Promise<OutcomeDue[]> {
  const rows = await sql()<{ program_id: string; sent: Date }[]>`
    SELECT program_id, COALESCE(sent_at, at) AS sent FROM applications
    WHERE owner = ${owner} AND status = 'applied' ORDER BY COALESCE(sent_at, at), program_id`;
  const sent = new Map(rows.map((r) => [r.program_id, r.sent]));
  const byId = await withOwn([...sent.keys()], programs);
  return [...sent.keys()]
    .map((id) => byId.get(id))
    .filter((p): p is ProgramRow => p !== undefined)
    .map((p) => ({ p, d: resultsDateOf(p) ?? new Date(sent.get(p.id)!.getTime() + ASK_AFTER_DAYS * DAY) }))
    .filter(({ d }) => d.getTime() <= now.getTime())
    .map(({ p, d }) => ({ program_id: p.id, title: p.file.title, due_at: d.toISOString() }));
}

/** The UTC day of `now`, as the outcome-ask marker stores it. Pure. */
const utcDate = (now: Date) => now.toISOString().slice(0, 10);

/**
 * L23-4 (v6.1.16): of `due`, the ones this installation has not shown today (its own `outcome_asks` row for the
 * program is from an earlier day, or there is none), marked as shown today in the same call: each installation asks
 * at most once a day per program, and a second installation of the same builder asks on its own.
 */
export async function outcomeAsksDue<T extends { program_id: string }>(installationId: number, owner: string, due: T[], now: Date): Promise<T[]> {
  if (due.length === 0) return [];
  const day = utcDate(now);
  const rows = await sql()<{ program_id: string }[]>`
    INSERT INTO outcome_asks ${sql()(due.map((d) => ({ installation_id: installationId, owner, program_id: d.program_id, asked_on: day })))}
    ON CONFLICT (installation_id, program_id) DO UPDATE SET owner = EXCLUDED.owner, asked_on = EXCLUDED.asked_on
      WHERE outcome_asks.asked_on < EXCLUDED.asked_on
    RETURNING program_id`;
  const shown = new Set(rows.map((r) => r.program_id));
  return due.filter((d) => shown.has(d.program_id));
}

/** Stamps `asked_outcome_at` for the record (L23-4: it no longer gates the question). */
export async function markAsked(owner: string, programIds: string[], now: Date): Promise<void> {
  if (programIds.length === 0) return;
  await sql()`UPDATE applications SET asked_outcome_at = ${now}
    WHERE owner = ${owner} AND program_id IN ${sql()(programIds)}`;
}

/**
 * The owner's live claims by program: when, by which installation, and for which project (the record project id or the
 * project key the claim stored; null for a row from before v6.1.11, which matches no project).
 */
export async function claimed(owner: string): Promise<Map<string, { since: string; by: number | null; project: string | null; held?: true }>> {
  const rows = await sql()<{ program_id: string; claimed_at: Date | null; claimed_by: number | null; project_id: string | null; held_at: Date | null }[]>`
    SELECT program_id, claimed_at, claimed_by, project_id, held_at FROM applications WHERE owner = ${owner} AND status = 'started'`;
  // L24-4 (v6.1.16 Task 11): `held`: the builder held it (track held); no agent sends it until a started lifts it.
  return new Map(rows.map((r) => [r.program_id, { since: (r.claimed_at ?? new Date(0)).toISOString(), by: r.claimed_by, project: r.project_id, ...(r.held_at ? { held: true as const } : {}) }]));
}
