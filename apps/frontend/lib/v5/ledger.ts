/**
 * The builder's ledger, keyed by its owner ('b:<builder>' once linked, else 'i:<installation>'):
 * applications (one row per program, plus an append-only history), closed gap items, and the
 * summary `track` and `find` show. One application and one result per program: a second `applied` is refused and
 * changes nothing. A won or rejected over a different result (L16-1, L16-2 v6.1.16: won and rejected either way, a
 * win with another amount, from the program's screen or the builder's own track) is a correction that replaces it,
 * its history row marked `corrected`, so the ledger holds the latest result; `no_result` over a result is refused. A
 * win marked a further payment (`payment.key`, kept in the history; a repeated key changes nothing) adds to a win's
 * total under the cap (L15-17, T8-F1 v6.1.14) and is refused over a result that is not a win. A win is whole dollars; one over the program's stated maximum, else
 * its pool, else 10,000,000, is refused; investments are never "asked".
 */
import { sql, type Db } from './db';
import { categoryOf, eligibilityOf } from './program-file';
import { codeChecked, itemKey } from './eligibility';
import { getProgram, programsById, type ProgramRow } from './programs';
import { CLAIM_HOURS, UNLINKED_MEANWHILE, newApplicationId, stillLinked } from '../v6/claims';
import { projectKeyOf, type Project } from './project-input';

/** gap_done without a known item (v6.1.8, 3.10): the builder names the change, the agent gets the item keys. */
export const WHICH_CHANGE = 'Which change did you finish? Say the program and the change.';

/** An agent's send over another of the owner's agents' live claim (v6.1.13, B3): nothing is written. */
export const OTHER_AGENT_HOLDS = 'Your other agent is handling that one; nothing recorded.';

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
export type Status = 'started' | 'applied' | 'won' | 'rejected' | 'no_result' | 'skipped' | 'unskip' | 'gap_done';
export type Ledger = {
  applied: number;
  asked_usd: number;
  won: number;
  won_usd: number;
  pending: number;
  rejected: number;
  skipped: number;
  closing_soon: { program_id: string; title: string; closes_at: string }[];
};

const RESULTS = ['won', 'rejected', 'no_result'];
/** The most a win can be when the program states neither a maximum nor a pool. */
const MAX_WIN_USD = 10_000_000;
/** The most a win in this program can be: its maximum, else its pool, else MAX_WIN_USD. Pure. */
export const winCapOf = (program: ProgramRow | null | undefined): number => program?.file.max_award_usd ?? program?.file.pool_usd ?? MAX_WIN_USD;
/** A win over the program's cap is refused with this line, in the ledger and in a program's screen outcomes (v6.1.7 C38). */
export const OVER_CAP = "That's more than this program pays; check the amount.";
/**
 * L16-1, L16-2 (v6.1.16): a further payment over a result that is not a win (`rejected`, `no result`; on a screen also
 * `shortlisted`, or `none` when nothing is kept) writes nothing.
 */
export const FURTHER_PAYMENT_REFUSED = (status: string) =>
  // Fix round 1b: no result yet is said in words, never as the status `none`.
  status === 'none' ? 'Further payment refused: no result yet; post a win first.' : `Further payment refused: the current result is ${status}; post a win first.`;
/** A win that is not whole dollars of at least 1 (the screen's outcomes say the same, v6.1.13 Low 19). */
export const WHOLE_DOLLARS = 'Tell me how much you won, as whole dollars.';
const DAY = 86_400_000;
/** How long after its close a send still counts under standing approval (F8, v6.1.12). */
export const CLOSED_GRACE_MS = 3_600_000;

/** When results are due: the file's date, else the close plus the weeks after, else null. */
function resultsDate(p: ProgramRow): Date | null {
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

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
/** "Nov 4": a day in UTC. Pure. */
export const dayOf = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
/** L13-13 (v6.1.14): a program's win passed on without its amount, as the row's note says. */
export const AMOUNT_NOT_GIVEN = 'amount not given';
/** "won $3,000", "won, amount not given", "rejected", "no result": a row's result in words. Pure. */
export const resultWords = (status: string, amount: string | null) =>
  status === 'won' ? (amount === null ? `won, ${AMOUNT_NOT_GIVEN}` : `won ${usd(Number(amount))}`) : status === 'no_result' ? 'no result' : status;
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
    installationId?: number; amount_usd?: number; note?: string; item?: string; now?: Date;
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
     *  its note AMOUNT_NOT_GIVEN (or `note`: L15-15, an amount in another currency, not converted). A later win with the amount completes it. */
    amountNotGiven?: true;
    /** won only (T8-F1, v6.1.14): a further payment of a win, its caller's idempotency key; adds to the total once per key. */
    payment?: { key: string };
    /** A program's screen outcome (screen-jobs.recordOutcomes): not an agent's call, so the link check is skipped. */
    fromScreen?: true;
  } = {},
): Promise<{ ok: true; repeated?: true; night?: true; closed?: true; total_usd?: number; replaced_usd?: number; corrected?: true } | { ok: false; note: string; items?: string[]; current?: string }> {
  const installationId = o.installationId ?? installationOf(owner);
  if (installationId === undefined) throw new Error('record needs the writing installation');
  const now = o.now ?? new Date();
  const program = await getProgram(programId);
  const unknown = { ok: false, note: "I don't know that program." } as const;
  // A result may land after the program left the catalog, when the owner's ledger holds it (checked below).
  if (!program && !RESULTS.includes(status)) return unknown;
  const noAmount = status === 'won' && o.amountNotGiven === true && o.amount_usd === undefined;
  if (status === 'won' && !noAmount && !(typeof o.amount_usd === 'number' && Number.isInteger(o.amount_usd) && o.amount_usd >= 1))
    return { ok: false, note: WHOLE_DOLLARS };
  if (status === 'won' && !noAmount && o.amount_usd! > winCapOf(program)) return { ok: false, note: OVER_CAP };
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
  const amount = status === 'won' && !noAmount ? o.amount_usd! : null;
  // L15-15 (v6.1.14): a program's win in another currency is kept with no amount and its own note ("amount in EUR, not converted").
  const note = noAmount ? o.note ?? AMOUNT_NOT_GIVEN : o.note ?? null;
  let repeated = false;
  let night = false;
  let closed = false;
  let total: number | null = null;
  let replacedFrom: number | null = null;
  const paymentKey = status === 'won' && o.payment ? paymentKeyOf(o.payment.key) : null;
  // L17-2 (v6.1.16): every history row names who wrote it.
  const source = o.fromScreen ? 'screen' : 'builder';

  return (await sql().begin(async (tx) => {
    // One decision at a time per owner and program (the claim's lock), even when no row exists yet.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + programId}))`;
    // T5-F4 (v6.1.14, fix round 2): no call of an agent unlinked meanwhile lands in the builder's ledger, whatever its
    // status; a program's screen outcome (`fromScreen`) is written as the application's own installation and skips it.
    if (!o.fromScreen && !(await stillLinked(tx, owner, installationId))) return { ok: false, note: UNLINKED_MEANWHILE } as const;
    const [row] = await tx<{ status: string; amount_usd: string | null; note: string | null; at: Date; client_name: string | null; claimed_at: Date | null; claimed_by: number | null }[]>`
      SELECT a.status, a.amount_usd, a.note, a.at, i.client_name, a.claimed_at, a.claimed_by FROM applications a LEFT JOIN installations i ON i.id = a.installation_id
      WHERE a.owner = ${owner} AND a.program_id = ${programId} FOR UPDATE OF a`;
    if (!program && !row) return unknown;
    // L13-13 (v6.1.14): a win kept without its amount takes the amount once; nothing else replaces a result.
    const completes = row?.status === 'won' && row.amount_usd === null && status === 'won' && amount !== null;
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
    if (status === 'skipped' && row?.status === 'started' && row.claimed_by !== null && row.claimed_by !== installationId
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
    // total under the cap).
    const bothWon = row?.status === 'won' && row.amount_usd !== null && status === 'won' && amount !== null;
    const adds = bothWon && paymentKey !== null;
    if (adds) {
      total = Number(row.amount_usd) + amount;
      if (total > winCapOf(program)) return { ok: false, note: OVER_CAP } as const;
    }
    // The same result: the same status and amount (a win kept with no amount also by its note, which names the currency).
    const same = hasResult && row.status === status && (row.amount_usd === null ? null : Number(row.amount_usd)) === amount
      && (status !== 'won' || amount !== null || (row.note ?? null) === note);
    // L16-1, L16-2 (v6.1.16): a won or rejected, unmarked, over a different result is a correction: the latest result
    // replaces it, whether the program's screen or the builder's own track sends it (T8-F1's other amount among them).
    const corrects = hasResult && (status === 'won' || status === 'rejected') && paymentKey === null && !completes && !same;
    // L17-2 (v6.1.16): a correction applies only when its event is at or after the stored result's; an older one changes nothing.
    if (corrects && now.getTime() < row.at.getTime()) return { ok: false, note: EARLIER_RESULT } as const;
    // L17-2 (v6.1.16): the same result said again later moves its time on (no history row), so an older correction
    // arriving after it is still older than what is kept.
    if (same && paymentKey === null && now.getTime() > row.at.getTime())
      await tx`UPDATE applications SET at = ${now} WHERE owner = ${owner} AND program_id = ${programId}`;
    // L17-8 (v6.1.16): the stored win again, with no further-payment mark, from the screen or the builder: a confirmation.
    if (same && status === 'won' && paymentKey === null) return { ok: false, note: CONFIRMED } as const;
    if (corrects && row.status === 'won' && row.amount_usd !== null && amount !== null) replacedFrom = Number(row.amount_usd);
    const resulted = hasResult && !completes && !adds && !corrects;
    if (resulted && status === 'skipped') return { ok: false, note: 'That one already has a result here; nothing to skip.' } as const;
    if (resulted && RESULTS.includes(status) && row.status === status && (status !== 'won' || (row.amount_usd === null ? null : Number(row.amount_usd)) === amount))
      return { ok: false, note: 'Already tracked.' } as const;
    if (resulted && (status === 'applied' || RESULTS.includes(status)))
      return { ok: false, note: `That one already has a result here: ${resultWords(row.status, row.amount_usd)}.` } as const;
    if (status === 'applied' && row?.status === 'applied')
      return { ok: false, note: `Already sent here on ${dayOf(row.at)} by ${row.client_name ?? 'another agent'}; nothing recorded.` } as const;
    // B3 (v6.1.13): a live claim of another installation of this owner holds the program; only its holder sends it.
    if (status === 'applied' && row?.status === 'started' && row.claimed_by !== null && row.claimed_by !== installationId
      && row.claimed_at !== null && row.claimed_at.getTime() > now.getTime() - CLAIM_HOURS * 3_600_000)
      return { ok: false, note: OTHER_AGENT_HOLDS } as const;
    if (RESULTS.includes(status) && (!row || row.status === 'skipped' || row.status === 'started')) return { ok: false, note: "You haven't applied to that one here." } as const;
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
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at, sent_at, submitted_by, fields_used, project_id, auto_applied, title, application_id)
        VALUES (${owner}, ${installationId}, ${programId}, 'applied', NULL, ${note}, ${now}, ${now}, ${o.submitted_by ?? null}, ${o.fields_used ?? null}, ${o.project_id ?? null}, ${auto}, ${program!.file.title}, ${newApplicationId()})
        ON CONFLICT (owner, program_id) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = 'applied', amount_usd = NULL, note = EXCLUDED.note, at = EXCLUDED.at, sent_at = EXCLUDED.sent_at,
              application_id = COALESCE(applications.application_id, EXCLUDED.application_id),
              submitted_by = EXCLUDED.submitted_by, fields_used = EXCLUDED.fields_used, auto_applied = EXCLUDED.auto_applied, title = EXCLUDED.title,
              project_id = COALESCE(EXCLUDED.project_id, applications.project_id)`;
    } else if (status === 'skipped' && row?.status === 'started') {
      // A skip over a claim replaces it: the claim is gone, the skip stays.
      await tx`UPDATE applications SET installation_id = ${installationId}, status = 'skipped', note = ${note}, at = ${now},
        claimed_at = NULL, claimed_by = NULL WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (total !== null) {
      // L17-2: `at` never moves backwards.
      await tx`UPDATE applications SET installation_id = ${installationId}, amount_usd = ${total}, at = GREATEST(at, ${now}) WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (corrects) {
      await tx`UPDATE applications SET installation_id = ${installationId}, status = ${status}, amount_usd = ${amount}, note = ${note}, at = ${now}
        WHERE owner = ${owner} AND program_id = ${programId}`;
    } else if (!(status === 'skipped' && row)) {
      // A skip on a program already in the ledger hides nothing new: the application stays as it is.
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, note, at)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${amount}, ${note}, ${now})
        ON CONFLICT (owner, program_id) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = EXCLUDED.status, amount_usd = EXCLUDED.amount_usd, note = EXCLUDED.note, at = EXCLUDED.at`;
    }
    // L17-1 (v6.1.16): a history row only when the ledger changed (a repeated gap_done changed nothing).
    if (!repeated)
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, note, at, payment_key, corrected, source)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${amount}, ${note}, ${now}, ${paymentKey}, ${corrects}, ${source})`;
    return repeated ? ({ ok: true, repeated: true } as const) : night ? ({ ok: true, night: true } as const) : closed ? ({ ok: true, closed: true } as const)
      : total !== null ? ({ ok: true, total_usd: total } as const)
      : corrects ? ({ ok: true, corrected: true, ...(replacedFrom !== null && { replaced_usd: replacedFrom }) } as const) : ({ ok: true } as const);
  })) as { ok: true; repeated?: true; night?: true; closed?: true; total_usd?: number; replaced_usd?: number; corrected?: true } | { ok: false; note: string; current?: string };
}

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
  const rows = await sql()<{ program_id: string; status: string; amount_usd: string | null }[]>`
    SELECT program_id, status, amount_usd FROM applications WHERE owner = ${owner}`;
  const byId = await withOwn(rows.map((r) => r.program_id), programs);
  const l: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, pending: 0, rejected: 0, skipped: 0, closing_soon: [] };
  const soon: { program_id: string; title: string; at: number }[] = [];
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
      l.won_usd += Number(r.amount_usd ?? 0);
    } else if (r.status === 'rejected') l.rejected++;
    else if (r.status === 'applied') {
      l.pending++;
      if (!p) continue;
      const dates = [p.file.ends_at ? new Date(p.file.ends_at) : null, resultsDate(p)]
        .filter((d): d is Date => d !== null && d.getTime() >= now.getTime() && d.getTime() <= now.getTime() + 7 * DAY)
        .map((d) => d.getTime());
      if (dates.length > 0) soon.push({ program_id: p.id, title: p.file.title, at: Math.min(...dates) });
    }
  }
  l.closing_soon = soon.sort((a, b) => a.at - b.at).map((s) => ({ program_id: s.program_id, title: s.title, closes_at: new Date(s.at).toISOString() }));
  return l;
}

/** L16-7 (v6.1.16): the program's result for this owner (won, rejected or no result), or null when it has none. */
export async function resultOf(owner: string, programId: string): Promise<{ status: 'won' | 'rejected' | 'no_result'; amount_usd: string | null; note: string | null } | null> {
  const [r] = await sql()<{ status: 'won' | 'rejected' | 'no_result'; amount_usd: string | null; note: string | null }[]>`
    SELECT status, amount_usd, note FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = ANY(${RESULTS})`;
  return r ?? null;
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

/** Days a report stays without a find that updates it (W3, final round): the cron's sweep drops older ones. */
export const REPORT_DAYS = 180;
/** Deletes the reports no find has updated for REPORT_DAYS days; the count deleted. */
export async function sweepReports(now: Date): Promise<number> {
  return (await sql()`DELETE FROM project_reports WHERE at < ${new Date(now.getTime() - REPORT_DAYS * DAY)}`).count;
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

/**
 * Applied programs whose results date has passed and that the builder has not been asked about. A program with no
 * results date is asked about ASK_AFTER_DAYS after the send (its sent_at, else its at for a row from before v6.1.9).
 */
export async function askOutcome(owner: string, programs: ProgramRow[], now: Date): Promise<{ program_id: string; title: string }[]> {
  const rows = await sql()<{ program_id: string; sent: Date }[]>`
    SELECT program_id, COALESCE(sent_at, at) AS sent FROM applications
    WHERE owner = ${owner} AND status = 'applied' AND asked_outcome_at IS NULL`;
  const sent = new Map(rows.map((r) => [r.program_id, r.sent]));
  const byId = await withOwn([...sent.keys()], programs);
  return [...sent.keys()]
    .map((id) => byId.get(id))
    .filter((p): p is ProgramRow => p !== undefined)
    .filter((p) => {
      const d = resultsDate(p) ?? new Date(sent.get(p.id)!.getTime() + ASK_AFTER_DAYS * DAY);
      return d.getTime() <= now.getTime();
    })
    .map((p) => ({ program_id: p.id, title: p.file.title }));
}

export async function markAsked(owner: string, programIds: string[], now: Date): Promise<void> {
  if (programIds.length === 0) return;
  await sql()`UPDATE applications SET asked_outcome_at = ${now}
    WHERE owner = ${owner} AND program_id IN ${sql()(programIds)}`;
}

/**
 * The owner's live claims by program: when, by which installation, and for which project (the record project id or the
 * project key the claim stored; null for a row from before v6.1.11, which matches no project).
 */
export async function claimed(owner: string): Promise<Map<string, { since: string; by: number | null; project: string | null }>> {
  const rows = await sql()<{ program_id: string; claimed_at: Date | null; claimed_by: number | null; project_id: string | null }[]>`
    SELECT program_id, claimed_at, claimed_by, project_id FROM applications WHERE owner = ${owner} AND status = 'started'`;
  return new Map(rows.map((r) => [r.program_id, { since: (r.claimed_at ?? new Date(0)).toISOString(), by: r.claimed_by, project: r.project_id }]));
}
