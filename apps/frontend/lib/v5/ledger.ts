/**
 * The builder's ledger, keyed by its owner ('b:<builder>' once linked, else 'i:<installation>'):
 * applications (one row per program, plus an append-only history), closed gap items, and the
 * summary `track` and `find` show. One application and one result per program: a second `applied` is refused and
 * changes nothing. A won or rejected over a different result (L16-1, L16-2 v6.1.16: won and rejected either way, a
 * win with another amount, from the program's screen or the builder's own track) is a correction that replaces it,
 * its history row marked `corrected`, so the ledger holds the latest result; `no_result` over a result is refused.
 * L45-2 (v6.1.19): a result never erases a win: the builder's rejected or no result over it is refused (`WIN_KEPT`),
 * a screen's rejection is kept beside it as a history row. A
 * win marked a further payment (`payment.key`, kept in the history; a repeated key changes nothing) adds to a win's
 * total under the cap (L15-17, T8-F1 v6.1.14) and is refused over a result that is not a win. A win's money is kept by
 * currency (`applications.amounts`, cents kept, never converted; L22-1 to L22-3 v6.1.16) with its US dollar part in
 * `amount_usd`; a further payment adds within its currency and keeps both across currencies. A win over the program's
 * stated maximum, else its pool, else 10,000,000, is refused (`overCap`, converted for the check only); investments
 * are never "asked".
 */
import { lowerFirst } from '../v6/reply-words';
import { sql, type Db } from './db';
import { categoryOf, eligibilityOf } from './program-file';
import { LICENSE_FILE, codeChecked, itemKey } from './eligibility';
import { getProgram, isOpenAt, programsById, type ProgramRow } from './programs';
import { dayWords } from './deadline';
import { CLAIM_HOURS, UNLINKED_MEANWHILE, newApplicationId, stillLinked } from '../v6/claims';
import { identityFor, projectKeyOf, type Project } from './project-input';
import { readAgrees, repoKey as repoPathOf } from './repo-facts';
import { amountsText, moneyText, plusAmount, sameAmounts, totalText, type Amounts } from './programs-read';
import { amountsOverCap, overCap, roundIn, underADollar, underADollarLine } from './amount';
import { quoteName } from './controls';

/**
 * The items a program's gap_done takes: its eligibility items, the unknown-users gap ('users') only when it has a users
 * item (v6.1.7, C27); T3-R1 (v6.1.13): the code-in-a-repo step ('repo'), re-checked by the read; fix round 1 (T7-F2,
 * v6.1.14): for any program, as the bar's code step (L12-7) shows on programs that do not require a repo too; L38-27
 * (v6.1.18 Task 11): a license rule's license file gap is its own item. Pure.
 */
export function gapItems(program: ProgramRow): string[] {
  const items = eligibilityOf(program.file);
  return [...new Set([...items.map(itemKey), ...(items.some((x) => x.kind === 'users') ? ['users'] : []), 'repo', ...(items.some((x) => x.check === 'license') ? [LICENSE_FILE.item] : [])])];
}
/** L45-10 (v6.1.19): an item as compared: hidden characters gone, ends trimmed, any case. Pure. */
const itemFold = (s: string): string => s.replace(/[^\P{C}]/gu, '').trim().toLowerCase();
/** L45-10 (v6.1.19): the program's own item an agent's copy names (trimmed, cleaned, any case), else null. Pure. */
export const gapItemOf = (program: ProgramRow, item: string): string | null => gapItems(program).find((k) => itemFold(k) === itemFold(item)) ?? null;
/** gap_done without a known item (v6.1.8, 3.10): the builder names the change, the agent gets the item keys. */
export const WHICH_CHANGE = 'Which change did you finish? Say the program and the change.';

/** A skip or a claim over another of the owner's agents' live claim (v6.1.13, B3): nothing is written. L23-3 (v6.1.16):
 *  never a send, which is always recorded (`other_claim`). */
export const OTHER_AGENT_HOLDS = 'Your other agent is handling that one; nothing recorded.';
/** L23-3 (v6.1.16): the agent note when a send landed over another agent's live claim: recorded, the claim cleared. */
export const OTHER_CLAIM_NOTE = 'Recorded. Another agent had started this one too; tell the builder so it is not sent twice.';
/** L41-11 (v6.1.19): the agent note when the live claim was the same builder's other agent's: that start is closed. */
export const OWN_CLAIM_NOTE = "Recorded; the builder's other agent had started it, and that start is closed.";

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
/**
 * v6.1.16 Task 4 N1 (v6.1.17): the keys a stored payment key matches. A legacy key kept with a prefix on a key sent
 * with one (`t:s:x`) matches as `s:x` and as `x`, so the same key resent never adds twice. Pure.
 */
export const storedPaymentKeys = (stored: string): string[] => [...new Set([paymentKeyOf(stored), paymentKeyOf(paymentKeyOf(stored))])];

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
  /** Sent and waiting for a result (applied). L43-8 (v6.1.19): no result is counted apart, in `no_result`. */
  pending: number;
  /** L43-8 (v6.1.19): sent and closed with no result; the parts still sum to the sent count. */
  no_result?: number;
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
/** Fix round 1 (I2, v6.1.19): the history note on a screen's win kept beside the builder's own win. */
export const BESIDE_NOTE = "a program's win kept beside the builder's own";
/**
 * Final fix round (M1, v6.1.19): the history note on a send the builder recorded on /me with no agent of theirs still
 * linked (`builderOwn`); its application keeps no sending installation, and the schema's one-time fill skips it.
 */
export const BUILDER_OWN_NOTE = 'sent by the builder, no agent linked';
/** L45-2 (v6.1.19): the builder's rejected or no result over a win: nothing is written. */
export const WIN_KEPT = (title: string, amounts: Amounts | null): string =>
  `${title} already has a win recorded here${amounts ? ` (${amountsText(amounts)})` : ''}. Say won again to change it.`;
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

/**
 * L28-1 (v6.1.16 Task 14): another builder sent this repo to the program; nothing is written. Controller ruling: no
 * other account and no result is named, except the other builder's login (through quoteName) when the caller's own tie
 * to the repo is strong evidence (owner, or committer by a real read).
 */
export const ALREADY_SENT_REPO = (date: string, login: string | null): string =>
  login ? `Already sent for this repo on ${date} by ${quoteName(login)}.` : `Already sent for this repo by another builder on ${date}.`;
/** L28-10 (controller ruling): an unlinked agent's send of what the builder it was linked to sent; no date, row or count of theirs. */
export const ALREADY_SENT_UNLINKED = 'Already sent from your account; nothing recorded. Sign in again to see it.';
/** L28-3 (v6.1.16 Task 14): the builder's login is not the repo's owner, in its org, or among its committers. */
export const NOT_YOUR_REPO = 'This repo is not yours; I apply only with repos you commit to.';
/** FR-1 (fix round 1): a signed-out builder's claim or send with a repo: sign-in comes first, never "not yours". */
export const SIGN_IN_FIRST = 'Sign in first so I can check the repo is yours.';
/**
 * FR-1, N5 (fix round 2); L38 big 1 (v6.1.18 Task 10): find's one Say for a signed-out builder with a repo: the apply
 * offer the reply made (`offer`), with the sign-in first in the same sentence, so no apply can be offered before it:
 * "Sign in at {link} so I know the repo is yours, then say yes and I apply to {title}." A setup step of the builder's own
 * stays between them ("..., then publish X, then say yes and I apply."); an offer it cannot read closes on the plain yes.
 * With no link to give, the same words without one. Pure.
 */
export function signInFirst(link: string | null, offer: string | null = null, why = 'so I know the repo is yours'): string {
  // L1l-6 (v6.1.19): a repo not on GitHub cannot be shown to be theirs by a GitHub sign-in; find passes the reason
  // that holds there (`so I can check your users`).
  const head = link ? `Sign in at ${link} ${why}` : `Sign in ${why}`;
  let o = (offer ?? '').trim();
  // An offer that already signs in first (a reply gated twice) keeps only its action.
  // v6.1.20 review M7: only EarnKit's own sign-in ("Sign in ... so I ..."); a program's ("Sign in to the Builder Hub
  // first, then say yes ...") is a step and stays.
  const merged = /^Sign in( at \S+)? so I\b[^,]*, then (.+)$/.exec(o);
  if (merged) o = merged[2];
  const step = /^(.+?) first, then (say yes\b.*\bI (also )?apply\b.*)$/i.exec(o);
  if (step) return `${head}, then ${lowerFirst(step[1])}, then ${step[2]}`;
  // Fix round 1 (M5): "Say yes and I add X, then apply to {title}." keeps its change too.
  if (/^say yes\b.*\bI (also )?apply\b|^say yes\b.*, then apply\b/i.test(o)) return `${head}, then ${lowerFirst(o)}`;
  // v6.1.20 review I1, M6: any other Say the gate holds (go, do, the in-person drafts) is said after the sign-in.
  if (/^say (go|do\b|yes and I draft)\b/i.test(o)) return `${head}, then ${lowerFirst(o.replace(/ first\.$/, '.'))}`;
  return `${head}, then say yes and I apply.`;
}
/** L28-3 (fix round 1, M1): no evidence either way (another host, a private or unread repo): never "not yours".
 *  L36-6 (v6.1.18): the builder is signed in, so EarnKit has their login: name the repo it could not read and the one
 *  way on. */
export const CANT_CONFIRM_REPO = (key: string): string =>
  `I could not read ${key.replace(/^https:\/\//, '')}, so I cannot check it is yours. Send it yourself and tell me when it is in.`;
/** L28-3: the agent note when a builder-submitted send with a repo that is not theirs is kept under the name only. */
export const NAME_ONLY_NOTE = 'The repo is not yours; recorded under the project name only.';
/** L36-9 (v6.1.18): a builder's own send of a repo another builder already sent: recorded, and the builder hears it. */
export const SENT_TWICE = (title: string, day: string, login: string | null): string =>
  `Sent ${title}. ${login ? quoteName(login) : 'Another builder'} already sent this repo on ${day}, so the program may see two.`;
/** L28-1: the agent note when a builder-submitted send of a repo another account sent is kept under the name only. */
export const NAME_ONLY_SENT_NOTE = 'Another account already sent this repo; recorded under the project name only.';
/** L35-1 (v6.1.16.1 Task 2): a tied builder's yes to the join question when another builder already sent the repo:
 *  nothing moves, and the question is not asked again. */
export const KEPT_APART = (date: string, name: string): string => `Already sent for this repo by another builder on ${date}; your send stays under ${quoteName(name)}.`;
/** L35-4 (v6.1.16.1 Task 2): a started on a repo another builder tied to it holds a live claim on; nothing is written. */
export const COFOUNDER_STARTED = (date: string): string => `Your co-founder's agent started this one on ${date}.`;
/** L35-13 (v6.1.16.1 Task 2): a hold on a program another builder already sent for this repo; nothing is written. */
export const NOTHING_TO_HOLD_REPO = 'That one was already sent for this repo; nothing to hold.';
/** L35-11 (v6.1.16.1 Task 2): the agent note when a builder-submitted send of a repo EarnKit cannot read is kept under
 *  the name only (no evidence either way, never "not yours"). */
export const CANT_CONFIRM_NAME_NOTE = 'I could not confirm this repo is yours; recorded under the project name only.';
/** L35-4 (v6.1.16.1 Task 2): the agent note when a send lands over a co-founder's live claim on the repo. */
export const COFOUNDER_CLAIM_NOTE = "Recorded. A co-founder's agent had started this one too; its claim is cleared. Tell the builder so it is not sent twice.";
/** L35-4: the agent note when this agent's own claim was taken before a co-founder's send: the form went out twice. */
export const COFOUNDER_SENT_NOTE = 'Recorded. A co-founder sent this repo to the program after this agent started it, so it went out twice. Tell the builder.';
/** L28-4 (v6.1.16 Task 14): the already-sent line names the project. */
export const ALREADY_SENT_PROJECT = (title: string, project: string): string => `${title} was already sent for ${project}.`;
/** L28-10 (v6.1.16 Task 14): a send of what this builder already sent (from any agent, linked now or before). */
export const ALREADY_SENT = (date: string): string => `Already sent on ${date}.`;

/** The repo key a project key names (a canonical repo link), or null for a `name:` key, '' or a record id. Pure. */
export const repoKeyOf = (key: string | null | undefined): string | null => (key && /^https:\/\//.test(key) ? key : null);

/** A project key as the builder reads it: the name given, else the repo without its scheme, else the name. Pure. */
export function projectWords(key: string, name?: string | null): string {
  if (name && name.trim()) return quoteName(name);
  if (key.startsWith('name:')) return quoteName(key.slice(5));
  return key.replace(/^https:\/\//, '');
}

/**
 * The owner's row for a program and project key (L28-4, v6.1.16 Task 14): the row with that key; else, when the key is
 * '' or the one candidate row has none (a row from before v6.1.10), that row; with `anyProject` (a result, a hold, an
 * unskip) the owner's one row for the program whatever its key. Undefined when none or more than one fit. Pure.
 */
export function pickRow<T extends { project_id: string | null; off_repo?: string | null }>(rows: T[], key: string, anyProject = false, display = false): T | undefined {
  // Fix round 1 (C1): a send kept off this repo under the project's name (L28-3) counts as this project's for display
  // reads only (`display`: sentOf, resultOf); a gate or a write matches the project key exactly.
  const exact = rows.find((r) => (r.project_id ?? '') === key) ?? (display && key ? rows.find((r) => r.off_repo === key) : undefined);
  if (exact) return exact;
  const fit = anyProject ? rows : rows.filter((r) => key === '' || (r.project_id ?? '') === '');
  return fit.length === 1 ? fit[0] : undefined;
}

/** Another owner's sent application of a repo (`sentForRepo`). `by`: 'key' when it was sent under this repo key (or a
 *  verified rename of it), 'id' when only GitHub's repo id (or the parent's) ties the two (L35-20: no login then). */
export type SentRepo = { owner: string; login: string | null; at: Date; status: string; by: 'key' | 'id' };
/** L35-3 (v6.1.16.1 Task 2): a fork's parent, by GitHub's repo id and its canonical repo key. */
export type ParentRepo = { id: number | null; key: string | null };

/**
 * L28-1 (v6.1.16 Task 14): another owner's application of this repo to the program (sent: applied or a result), the
 * earliest, with that owner's GitHub login (null for an unlinked installation's) and its send time; null when none.
 * Read under the repo's lock (`repoLock`), taken in `record` and `claim` before any write. L35-3, L35-20 (v6.1.16.1
 * Task 2): also by the fork's parent (its repo id or key); a match by id alone is `by: 'id'`. A send kept off a repo
 * (`off_repo`) never counts here (controller ruling: an unverified link never blocks another builder; `offHostSent`).
 */
export async function sentForRepo(tx: Db, programId: string, repoKey: string, ownerExcept: string, repoId: number | null = null, parent: ParentRepo | null = null): Promise<SentRepo | null> {
  // Fix round 1 (M2): by GitHub's repo id when known (a rename keeps it), the link as the fallback.
  const parentId = parent?.id ?? null;
  const parentKey = parent?.key ?? null;
  const [r] = await tx<{ owner: string; login: string | null; at: Date; status: string; repo_key: string | null; by_key: boolean }[]>`
    SELECT a.owner, b.login, COALESCE(a.sent_at, a.at) AS at, a.status, a.repo_key,
      a.repo_key = ${repoKey} AS by_key FROM applications a
      LEFT JOIN builders b ON a.owner = 'b:' || b.id
    WHERE a.program_id = ${programId}
      AND (a.repo_key = ${repoKey}
        OR (${repoId}::bigint IS NOT NULL AND a.repo_id = ${repoId}::bigint)
        OR (${parentId}::bigint IS NOT NULL AND a.repo_id = ${parentId}::bigint)
        OR (${parentKey}::text IS NOT NULL AND a.repo_key = ${parentKey}::text))
      AND a.owner <> ${ownerExcept} AND a.status = ANY(${['applied', ...RESULTS]})
    ORDER BY COALESCE(a.sent_at, a.at), a.owner LIMIT 1`;
  if (!r) return null;
  // L35-20: an id match counts as this repo's own only when the other send's repo now reads as this one (a rename).
  let byKey = r.by_key;
  const here = repoPathOf(repoKey);
  const there = r.repo_key ? repoPathOf(r.repo_key) : null;
  if (!byKey && here && there) {
    const [c] = await tx<{ facts: { html_url: string; full_name?: unknown } }[]>`SELECT facts FROM repo_cache WHERE repo = ${there}`;
    byKey = c !== undefined && typeof c.facts?.html_url === 'string' && readAgrees(c.facts, here);
  }
  return { owner: r.owner, login: r.login, at: r.at, status: r.status, by: byKey ? 'key' : 'id' };
}

/**
 * L35-11, controller ruling (v6.1.16.1 Task 2): whether another owner recorded a send kept under its name with this
 * repo link off GitHub (a link EarnKit could not check). Advisory only: it never refuses (`OFF_HOST_SENT_NOTE`).
 */
export async function offHostSent(tx: Db, programId: string, link: string, ownerExcept: string): Promise<boolean> {
  const rows = await tx`SELECT 1 FROM applications WHERE program_id = ${programId} AND off_repo = ${link} AND owner <> ${ownerExcept}
    AND status = ANY(${['applied', ...RESULTS]}) LIMIT 1`;
  return rows.length > 0;
}
/** L35-11, controller ruling: the agent note beside a send another builder recorded with the same unchecked link. */
export const OFF_HOST_SENT_NOTE = 'Another builder recorded a send with this link; it could not be checked.';

/** L35-4 (v6.1.16.1 Task 2): the earliest live claim (under 24 hours, not a hold) another owner holds on this repo for
 *  the program, or null. Read under the repo's lock. */
export async function claimedForRepo(tx: Db, programId: string, repoKey: string, ownerExcept: string, repoId: number | null, now: Date): Promise<{ owner: string; at: Date } | null> {
  const stale = new Date(now.getTime() - CLAIM_HOURS * 3_600_000);
  const [r] = await tx<{ owner: string; at: Date }[]>`
    SELECT owner, claimed_at AS at FROM applications
    WHERE program_id = ${programId} AND (repo_key = ${repoKey} OR (${repoId}::bigint IS NOT NULL AND repo_id = ${repoId}::bigint))
      AND owner <> ${ownerExcept} AND status = 'started' AND held_at IS NULL AND claimed_at > ${stale}
    ORDER BY claimed_at, owner LIMIT 1`;
  return r ?? null;
}

/** L28-1: one decision at a time per repo and program, across owners (taken after the owner's own lock); by the repo id
 *  when known (fix round 1, M2), so the old and new links of a renamed repo share one lock. */
export const repoLock = (tx: Db, repoKey: string, programId: string, repoId: number | null = null) =>
  tx`SELECT pg_advisory_xact_lock(hashtext(${'repo:' + (repoId !== null ? `id:${repoId}` : repoKey) + ':' + programId}))`;

/**
 * L28-10 (v6.1.16 Task 14): for an unlinked installation's own ledger (`i:`), whether the builder it was linked to
 * before sent this program for this project. Controller ruling: used only as this yes or no for the duplicate-send
 * check (the time is never shown to the unlinked agent); null when not.
 */
export async function formerSentAt(tx: Db, owner: string, programId: string, key: string): Promise<Date | null> {
  const inst = installationOf(owner);
  if (inst === undefined) return null;
  const [i] = await tx<{ former_builder_id: number | null }[]>`SELECT former_builder_id FROM installations WHERE id = ${inst}`;
  if (!i?.former_builder_id) return null;
  const rows = await tx<{ project_id: string | null; at: Date }[]>`
    SELECT project_id, COALESCE(sent_at, at) AS at FROM applications
    WHERE owner = ${'b:' + i.former_builder_id} AND program_id = ${programId} AND status = ANY(${['applied', ...RESULTS]}) ORDER BY COALESCE(sent_at, at)`;
  // L35-2 (v6.1.16.1 Task 2): with no project key, any send of the former builder for this program counts.
  return (key === '' ? rows[0] : pickRow(rows, key))?.at ?? null;
}

/** The program's title: the catalog's, else the one stored when it was sent, else the id. */
export async function titleOf(owner: string, programId: string): Promise<string> {
  const p = await getProgram(programId);
  if (p) return p.file.title;
  const [r] = await sql()<{ title: string | null }[]>`SELECT title FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND title IS NOT NULL LIMIT 1`;
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
    /** applied only: who pressed submit and the field keys sent. `project_id` (L28-4, v6.1.16 Task 14): the application's
     *  project key (projectKeyOf), for every status: the row is (owner, program, project key); else `projectKey`. */
    submitted_by?: 'agent' | 'builder'; fields_used?: string[]; project_id?: string;
    /** L28-6 (v6.1.16 Task 14): GitHub's id of the application's repo, kept with its repo key. */
    repoId?: number | null;
    /** L35-2 (v6.1.16.1 Task 2): the application's identity (`identityOf`); left out, `identityFor` the key and repo id. */
    identity?: string | null;
    /** L35-3 (v6.1.16.1 Task 2): the repo's parent when it is a fork: the one-per-repo rule reads it too. */
    parentRepo?: ParentRepo | null;
    /** L28-1 (controller ruling): the caller's tie to the repo is strong, so a refusal may name the other builder. */
    showLogin?: boolean;
    /** Fix round 3 (M4): the caller showed the builder's tie to this repo key, so the owner's own keyless row for the
     *  program is taken over (one application, no orphan claim). */
    tied?: boolean;
    /** applied only, L28-3 and L28-1 (v6.1.16 Task 14): the repo a send kept under the name only was kept off. */
    offRepo?: string | null;
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
    /** applied only (v6.1.19 fix round 1, M1): the builder said on /me they sent it and no agent of theirs that
     *  claimed it is still linked; the agent's link check is skipped (the builder is the one acting). */
    builderOwn?: true;
    /** won only (v6.1.19.1 review I2): the win names no project, so it takes the owner's one row of the program, as before. */
    anyRow?: true;
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
    const keys = gapItems(program);
    // The keys go to the agent only: builder text never carries them (v6.1.6, 25a); also when no item came (C11).
    if (!o.item || !keys.includes(o.item)) return { ok: false, note: WHICH_CHANGE, items: keys };
  }
  if (status === 'gap_done' && !o.item) return { ok: false, note: WHICH_CHANGE };
  if (status === 'started') throw new Error('a claim is written by claims.claim');
  // L22-5 (v6.1.16, fix round 1): the cap reads the given value; it is rounded to its currency's places only to be stored.
  const givenValue = status === 'won' && !noAmount ? given!.value : null;
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
  // L28-4 (v6.1.16 Task 14): the application's project key; the row is (owner, program, key).
  const key = o.project_id ?? o.projectKey ?? '';
  // L35-2 (v6.1.16.1 Task 2): one row per owner, program and identity.
  const identity = o.identity !== undefined ? o.identity || null : identityFor(key, o.repoId);

  return (await sql().begin(async (tx) => {
    // One decision at a time per owner and program (the claim's lock), even when no row exists yet.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + programId}))`;
    // T5-F4 (v6.1.14, fix round 2): no call of an agent unlinked meanwhile lands in the builder's ledger, whatever its
    // status; a program's screen outcome (`fromScreen`) is written as the application's own installation and skips it.
    if (!o.fromScreen && !(o.builderOwn && status === 'applied') && !(await stillLinked(tx, owner, installationId))) return { ok: false, note: UNLINKED_MEANWHILE } as const;
    const rows = await tx<{ project_id: string | null; status: string; amount_usd: string | null; amounts: unknown; note: string | null; at: Date; sent_at: Date | null; client_name: string | null; claimed_at: Date | null; claimed_by: number | null; held_at: Date | null; identity: string | null; title: string | null }[]>`
      SELECT a.project_id, a.status, a.amount_usd, a.amounts, a.note, a.at, a.sent_at, i.client_name, a.claimed_at, a.claimed_by, a.held_at, a.identity, a.title FROM applications a LEFT JOIN installations i ON i.id = a.installation_id
      WHERE a.owner = ${owner} AND a.program_id = ${programId} FOR UPDATE OF a`;
    // L28-4 (v6.1.16 Task 14): this project's row; a result, a hold or an unskip takes the owner's one row for the program.
    // Fix round 2 (C3): a send or hold keyed by a repo takes only that key's own row, never a keyless one (the ownership
    // gate ran for this key, not for the row it would rewrite).
    const exactOnly = repoKeyOf(key) !== null && (status === 'applied' || status === 'held');
    // Fix round 3 (M4): once the tie is shown, the owner's own keyless row is this project's.
    // L35-2 (v6.1.16.1 Task 2): the row with this project's identity first (a rename, a dropped repo), then by its key.
    // Controller ruling: only when that row's key gives the same repo key as this call's.
    const row = (identity ? rows.find((r) => r.identity === identity && repoKeyOf(r.project_id) === repoKeyOf(key)) : undefined) ?? (exactOnly
      ? rows.find((r) => (r.project_id ?? '') === key) ?? (o.tied ? pickRow(rows.filter((r) => (r.project_id ?? '') === ''), '') : undefined)
      // v6.1.19.1 (L47-2): a win with a project is that project's, as a send is: its own key (or a keyless row), never
      // another project's row of the same program; a win that names no project (`anyRow`, review I2) takes the one row.
      : pickRow(rows, key, (RESULTS.includes(status) && (status !== 'won' || o.anyRow === true)) || status === 'held' || status === 'unskip'));
    if (!program && !row) return unknown;
    // An identity another of the owner's rows of this program holds (under another repo key) is never written twice.
    const ident = identity && rows.some((r) => r.identity === identity && r !== row) ? null : identity;
    // The key every write below uses: the row's own when one was picked, else this project's.
    let rk = row ? (row.project_id ?? '') : key;
    const repoKey = repoKeyOf(rk || key);
    // L28-1 (v6.1.16 Task 14): one application per repo key per program across owners, decided under the repo's lock.
    // Controller ruling (v6.1.16.1 Task 2): the repo key from this call's own key always, and the picked row's too when
    // it names another; L35-13: a hold too.
    const checkKeys = [...new Set([repoKeyOf(key), repoKeyOf(rk)].filter((x): x is string => x !== null))];
    let cofounderSent = false;
    let cofounderClaim = false;
    let offHostSeen = false;
    if (checkKeys.length > 0 && (status === 'applied' || status === 'held' || (status === 'won' && o.outsideWin === true && !o.fromScreen)) && (!row || row.status === 'started' || row.status === 'skipped')) {
      for (const k of checkKeys) {
        const id = k === repoKeyOf(key) ? o.repoId ?? null : null;
        const parent = k === repoKeyOf(key) ? o.parentRepo ?? null : null;
        await repoLock(tx, k, programId, id);
        // L35-3: a fork's parent is locked too (a parent's send never locks its forks, so the order cannot cross).
        if (parent?.key) await repoLock(tx, parent.key, programId, parent.id);
        const other = await sentForRepo(tx, programId, k, owner, id, parent);
        // L35-4 (v6.1.16.1 Task 2): this agent's own claim, taken before the co-founder's send: the form went out; recorded.
        // Fix round 1 (I2): only for a send under this very repo key (never a fork's parent, never an id alone).
      if (other && status === 'applied' && o.tied === true && other.by === 'key' && k === repoKeyOf(key) && row?.status === 'started'
        && (row.project_id ?? '') === key && row.at.getTime() < other.at.getTime()) cofounderSent = true;
        else if (other && status === 'held') return { ok: false, note: NOTHING_TO_HOLD_REPO } as const;
        // Controller ruling: never the other builder's result; their login only on the caller's strong tie, and (L35-20)
        // only when the match is by this repo's key.
        else if (other) {
          const day = dayWords(other.at, now);
          const login = o.showLogin && other.by === 'key' ? other.login : null;
          // L36-9 (v6.1.18): the day and the login the refusal names, for a builder's own send kept under the name.
          return { ok: false, note: ALREADY_SENT_REPO(day, login), repo_taken: true, taken: { day, login } } as const;
        }
      }
      // L35-4: a send over a co-founder's live claim is recorded and clears it (below, on the recording path).
      if (status === 'applied' && repoKey) cofounderClaim = (await claimedForRepo(tx, programId, repoKey, owner, o.repoId ?? null, now)) !== null;
    }
    // L35-11, controller ruling: a send kept under the name with a link off GitHub is never refused for another
    // builder's send with that link; the agent hears it.
    const offHost = status === 'applied' && o.offRepo && !o.offRepo.startsWith('https://github.com/') ? o.offRepo : null;
    if (offHost) offHostSeen = await offHostSent(tx, programId, offHost, owner);
    // L28-10 (v6.1.16 Task 14): an unlinked agent never sends again what the builder it was linked to sent.
    if (status === 'applied' && (!row || row.status === 'started' || row.status === 'skipped')) {
      if (await formerSentAt(tx, owner, programId, rk)) return { ok: false, note: ALREADY_SENT_UNLINKED } as const;
    }
    // A send for this project over a row from before projects were kept (no key) takes the row as this project's.
    // Fix round 3 (M4): a repo key takes the row over only on the caller's shown tie, and only when no other owner holds
    // that repo (the row then keeps its key); it carries the repo key. L35-7 (v6.1.16.1 Task 2): decided here, written
    // only on the recording path (`takeOverNow`), after every refusal: a refused call writes nothing.
    const takeOver = row && rk === '' && key !== '' && (status === 'applied' || (status === 'held' && o.tied === true))
      && (!repoKeyOf(key) || (o.tied === true && !(await repoLock(tx, key, programId, o.repoId ?? null).then(() => sentForRepo(tx, programId, key, owner, o.repoId ?? null)))));
    let pk = rk || null;
    const takeOverNow = async () => {
      if (!takeOver) return;
      await tx`UPDATE applications SET project_id = ${key}, repo_key = COALESCE(${repoKeyOf(key)}, repo_key), repo_id = COALESCE(${o.repoId ?? null}::bigint, repo_id), identity = COALESCE(identity, ${ident})
        WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ''`;
      rk = key;
      pk = key;
    };
    // L24-4 (v6.1.16 Task 11): the builder's hold. On a claim (any installation's, live or not) it sets held_at; with no
    // row it writes a claim for this installation, held, so a program the standing-approval line named can be held
    // before any agent started it. A program sent, with a result or skipped has nothing to hold.
    if (status === 'held') {
      if (row?.status === 'skipped') return { ok: false, note: 'You skipped that one; nothing to hold.' } as const;
      if (row && row.status !== 'started') return { ok: false, note: NOTHING_TO_HOLD } as const;
      if (row?.held_at) return { ok: true, repeated: true } as const;
      await takeOverNow();
      if (row) await tx`UPDATE applications SET held_at = ${now} WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
      else
        await tx`INSERT INTO applications (owner, installation_id, program_id, status, note, at, project_id, claimed_at, claimed_by, application_id, held_at, repo_key, repo_id, identity)
          VALUES (${owner}, ${installationId}, ${programId}, 'started', ${note}, ${now}, ${pk}, ${now}, ${installationId}, ${newApplicationId()}, ${now}, ${repoKey}, ${o.repoId ?? null}, ${ident})`;
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, note, at, source, project_id)
        VALUES (${owner}, ${installationId}, ${programId}, 'held', ${note}, ${now}, ${source}, ${pk})`;
      return { ok: true } as const;
    }
    const kept = row?.status === 'won' ? amountsOf(row) : null;
    // L22-2 (v6.1.16): a win with no currency named, over a win held in one other currency, is in that currency.
    const keptCodes = Object.keys(kept ?? {});
    const currency = given?.currency ?? (keptCodes.length === 1 && keptCodes[0] !== 'USD' ? keptCodes[0] : 'USD');
    // v6.1.19.1 (L47-1): stored rounded to its currency's places (8 for a coin, 2 else), never to the cent for a coin.
    const value = givenValue === null ? null : roundIn(givenValue, currency);
    const money: Amounts | null = value === null ? null : { [currency]: value };
    // L22-4, L22-5 (v6.1.16): the given amount against the cap, before any rounding; another currency converted for the check only.
    // L45-4 (v6.1.19): a currency with no rate is never weighed (recorded uncapped), so an over-cap amount is always comparable.
    const overNote = { ok: false, note: OVER_CAP(cap) } as const;
    // L45-3 (v6.1.19), fix round 1 (M1): under one dollar in the currency the win is kept in (the win's own when none
    // was named), so a further 100 over a JPY win is weighed as JPY.
    if (givenValue !== null && underADollar(givenValue, currency)) return { ok: false, note: underADollarLine(currency) } as const;
    if (givenValue !== null && overCap(givenValue, currency, cap)) return overNote;
    // L13-13 (v6.1.14): a win kept without its amount takes the amount once; nothing else replaces a result.
    const completes = row?.status === 'won' && kept === null && status === 'won' && money !== null;
    // T8-F1 (v6.1.14): a payment key already kept for this application changes nothing (a retried call).
    // L17-8 (v6.1.16): one key space per application; a key stored with a legacy prefix matches the same key now.
    if (paymentKey !== null && row?.status === 'won'
      // FR-5 (fix round 1): this project's application only.
      && (await tx<{ payment_key: string }[]>`SELECT payment_key FROM application_history WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk} AND payment_key IS NOT NULL`)
        .some((h) => storedPaymentKeys(h.payment_key).includes(paymentKey)))
      return { ok: false, note: 'Already tracked.' } as const;
    // L17-1 (v6.1.16): a skip is decided here, under the lock, against the row as it is now: a repeat changes nothing,
    // a sent program has nothing to skip, and another agent's live claim stays.
    if (status === 'skipped' && row?.status === 'skipped') return { ok: true, repeated: true } as const;
    if (status === 'skipped' && row?.status === 'applied') return { ok: false, note: ALREADY_SENT_SKIP } as const;
    if (status === 'skipped' && row?.status === 'started' && row.held_at === null && row.claimed_by !== null && row.claimed_by !== installationId
      && row.claimed_at !== null && row.claimed_at.getTime() > now.getTime() - CLAIM_HOURS * 3_600_000)
      return { ok: false, note: OTHER_AGENT_HOLDS } as const;
    const hasResult = row !== undefined && RESULTS.includes(row.status);
    // L45-2 (v6.1.19): a result never erases a win. The builder's rejected or no result over it changes nothing and
    // says so; a program's screen outcome is recorded beside it (a history row), the win kept.
    if (row?.status === 'won' && (status === 'rejected' || status === 'no_result')) {
      if (!o.fromScreen) return { ok: false, note: WIN_KEPT(program?.file.title ?? row.title ?? programId, kept) } as const;
      const [last] = await tx<{ status: string }[]>`SELECT status FROM application_history WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk} ORDER BY id DESC LIMIT 1`;
      if (last?.status === status) return { ok: false, note: 'Already tracked.' } as const;
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, note, at, corrected, source, project_id)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${note}, ${now}, false, ${source}, ${rk || null})`;
      return { ok: true, beside: true } as const;
    }
    // Fix round 1 (I2, v6.1.19): a screen's win never reduces or blanks the builder's own win (the last win written
    // that is not itself beside came from the builder): the same amount or none is no change; another amount is kept
    // beside it as a history row, once.
    if (o.fromScreen && status === 'won' && row?.status === 'won' && kept !== null && paymentKey === null) {
      if (money === null) return { ok: false, note: CONFIRMED } as const;
      const [w] = await tx<{ source: string | null }[]>`SELECT source FROM application_history WHERE owner = ${owner} AND program_id = ${programId}
        AND COALESCE(project_id, '') = ${rk} AND status = 'won' AND payment_key IS NULL AND note IS DISTINCT FROM ${BESIDE_NOTE} ORDER BY id DESC LIMIT 1`;
      if (w && w.source !== 'screen') {
        if (money === null || sameAmounts(kept, money)) return { ok: false, note: CONFIRMED } as const;
        // Once: this screen win, already written (beside, or as a result before the builder's own), is a resend.
        const seen = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM application_history WHERE owner = ${owner} AND program_id = ${programId}
          AND COALESCE(project_id, '') = ${rk} AND status = 'won' AND source = 'screen' AND payment_key IS NULL AND currency = ${currency} AND amount = ${value}`;
        if (seen[0].n > 0) return { ok: false, note: 'Already tracked.' } as const;
        await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, amount, currency, note, at, corrected, source, project_id)
          VALUES (${owner}, ${installationId}, ${programId}, 'won', ${currency === 'USD' ? value : null}, ${value}, ${currency}, ${BESIDE_NOTE}, ${now}, false, ${source}, ${rk || null})`;
        return { ok: true, beside: true } as const;
      }
    }
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
    // L28-10 (v6.1.16 Task 14): a second send of this project, from any agent of the builder, says when it was sent.
    if (status === 'applied' && row?.status === 'applied') return { ok: false, note: ALREADY_SENT(dayWords(row.sent_at ?? row.at, now)) } as const;
    // B3 (v6.1.13) holds only a claim (claims.claim) and a skip (above). L23-3 (v6.1.16): a send over another
    // installation's live claim is never refused or lost: it is recorded, the claim cleared, and `other_claim` said.
    const heldSend = status === 'applied' && row?.status === 'started' && row.held_at !== null;
    const otherClaim = status === 'applied' && row?.status === 'started' && !heldSend && row.claimed_by !== null && row.claimed_by !== installationId
      && row.claimed_at !== null && row.claimed_at.getTime() > now.getTime() - CLAIM_HOURS * 3_600_000;
    // L41-11 (v6.1.19): that claim is the same builder's other agent's (its installation is linked to this owner).
    const ownClaim = otherClaim && owner.startsWith('b:')
      && (await tx<{ builder_id: number | null }[]>`SELECT builder_id FROM installations WHERE id = ${row!.claimed_by}`)[0]?.builder_id === Number(owner.slice(2));
    const outside = status === 'won' && o.outsideWin === true && !o.fromScreen && program !== null && (!row || row.status === 'skipped' || row.status === 'started');
    if (outside) {
      // L29-3 (v6.1.16 Task 15): the send the builder made outside EarnKit, so the win below lands on an application;
      // fix round 1 (N4): its send date is not known, so none is kept (the line names the result alone).
      // L42-6 (v6.1.19): the installation that recorded this send keeps it as the send's (a later result never moves it).
      await tx`INSERT INTO applications (owner, installation_id, sent_by_installation_id, program_id, status, note, at, sent_at, submitted_by, project_id, title, application_id, repo_key, repo_id, off_repo, identity)
        VALUES (${owner}, ${installationId}, ${installationId}, ${programId}, 'applied', NULL, ${now}, NULL, 'builder', ${pk}, ${program!.file.title}, ${newApplicationId()}, ${repoKey}, ${o.repoId ?? null}, ${o.offRepo ?? null}, ${ident})
        ON CONFLICT (owner, program_id, (COALESCE(project_id, ''))) DO UPDATE SET installation_id = EXCLUDED.installation_id, sent_by_installation_id = EXCLUDED.sent_by_installation_id, status = 'applied', at = EXCLUDED.at, sent_at = NULL, identity = COALESCE(applications.identity, EXCLUDED.identity),
          submitted_by = 'builder', title = EXCLUDED.title, held_at = NULL, claimed_at = NULL, claimed_by = NULL,
          application_id = COALESCE(applications.application_id, EXCLUDED.application_id),
          repo_key = COALESCE(EXCLUDED.repo_key, applications.repo_key), repo_id = COALESCE(EXCLUDED.repo_id, applications.repo_id)`;
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, note, at, source, project_id)
        VALUES (${owner}, ${installationId}, ${programId}, 'applied', 'sent by the builder outside EarnKit', ${now}, ${source}, ${pk})`;
    } else if (RESULTS.includes(status) && (!row || row.status === 'skipped' || row.status === 'started')) return { ok: false, note: "You haven't applied to that one here." } as const;
    if (status === 'unskip') {
      // Only a skipped row can be unskipped: the row goes, and the program can come back in the list.
      if (row?.status !== 'skipped') return { ok: false, note: "That one isn't skipped here." } as const;
      await tx`DELETE FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
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
      await takeOverNow();
      // L42-6 (v6.1.19): sent_by_installation_id is the sending installation; no result, skip or correction writes it.
      // Final fix round (M1): none for the builder's own send (`builderOwn`), so no unlinked agent is named as its sender.
      await tx`INSERT INTO applications (owner, installation_id, sent_by_installation_id, program_id, status, amount_usd, amounts, note, at, sent_at, submitted_by, fields_used, project_id, auto_applied, title, application_id, repo_key, repo_id, off_repo, identity)
        VALUES (${owner}, ${installationId}, ${o.builderOwn ? null : installationId}, ${programId}, 'applied', NULL, NULL, ${note}, ${now}, ${now}, ${o.submitted_by ?? null}, ${o.fields_used ?? null}, ${pk}, ${auto}, ${program!.file.title}, ${newApplicationId()}, ${repoKeyOf(rk || key)}, ${o.repoId ?? null}, ${o.offRepo ?? null}, ${ident})
        ON CONFLICT (owner, program_id, (COALESCE(project_id, ''))) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, sent_by_installation_id = EXCLUDED.sent_by_installation_id, status = 'applied', amount_usd = NULL, amounts = NULL, note = EXCLUDED.note, at = EXCLUDED.at, sent_at = EXCLUDED.sent_at,
              application_id = COALESCE(applications.application_id, EXCLUDED.application_id),
              submitted_by = EXCLUDED.submitted_by, fields_used = EXCLUDED.fields_used, auto_applied = EXCLUDED.auto_applied, title = EXCLUDED.title, held_at = NULL,
              repo_key = COALESCE(EXCLUDED.repo_key, applications.repo_key), repo_id = COALESCE(EXCLUDED.repo_id, applications.repo_id),
              off_repo = COALESCE(EXCLUDED.off_repo, applications.off_repo), identity = COALESCE(applications.identity, EXCLUDED.identity)`;
      // L35-4: this agent's own claim over a co-founder's send is spent with the send.
      if (otherClaim || cofounderSent) await tx`UPDATE applications SET claimed_at = NULL, claimed_by = NULL WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
      // L35-4 (v6.1.16.1 Task 2): a co-founder's live claim on this repo is cleared; its agent hears it on its own send.
      if (cofounderClaim)
        await tx`UPDATE applications SET claimed_at = NULL, claimed_by = NULL WHERE program_id = ${programId} AND owner <> ${owner} AND status = 'started' AND held_at IS NULL
          AND (repo_key = ${repoKey} OR (${o.repoId ?? null}::bigint IS NOT NULL AND repo_id = ${o.repoId ?? null}::bigint))`;
    } else if (status === 'skipped' && row?.status === 'started') {
      // A skip over a claim replaces it: the claim is gone, the skip stays.
      await tx`UPDATE applications SET installation_id = ${installationId}, status = 'skipped', note = ${note}, at = ${now},
        claimed_at = NULL, claimed_by = NULL WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
    } else if (total !== null) {
      // L17-2: `at` never moves backwards.
      await tx`UPDATE applications SET installation_id = ${installationId}, amount_usd = ${total.USD ?? null}, amounts = ${tx.json(total)}, at = GREATEST(at, ${now})
        WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
    } else if (corrects) {
      await tx`UPDATE applications SET installation_id = ${installationId}, status = ${status}, amount_usd = ${money?.USD ?? null}, amounts = ${money ? tx.json(money) : null},
        note = ${note}, at = ${now} WHERE owner = ${owner} AND program_id = ${programId} AND COALESCE(project_id, '') = ${rk}`;
    } else if (!(status === 'skipped' && row)) {
      // A skip on a program already in the ledger hides nothing new: the application stays as it is.
      await tx`INSERT INTO applications (owner, installation_id, program_id, status, amount_usd, amounts, note, at, project_id, identity)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${money?.USD ?? null}, ${money ? tx.json(money) : null}, ${note}, ${now}, ${pk}, ${row ? null : ident})
        ON CONFLICT (owner, program_id, (COALESCE(project_id, ''))) DO UPDATE
          SET installation_id = EXCLUDED.installation_id, status = EXCLUDED.status, amount_usd = EXCLUDED.amount_usd, amounts = EXCLUDED.amounts, note = EXCLUDED.note, at = EXCLUDED.at,
            identity = COALESCE(applications.identity, EXCLUDED.identity)`;
    }
    // L17-1 (v6.1.16): a history row only when the ledger changed (a repeated gap_done changed nothing).
    if (!repeated)
      await tx`INSERT INTO application_history (owner, installation_id, program_id, status, amount_usd, amount, currency, note, at, payment_key, corrected, source, project_id)
        VALUES (${owner}, ${installationId}, ${programId}, ${status}, ${currency === 'USD' ? value : null}, ${value}, ${value === null ? null : currency}, ${o.builderOwn && status === 'applied' ? BUILDER_OWN_NOTE : note}, ${now}, ${paymentKey}, ${corrects}, ${source}, ${status === 'gap_done' ? null : rk || null})`;
    const other = otherClaim ? ({ other_claim: true, ...(ownClaim ? { own_claim: true as const } : {}) } as const) : heldSend ? ({ held: true } as const) : {};
    // L35-4 (v6.1.16.1 Task 2): what the agent tells the builder about a co-founder on this repo.
    const cofounder = { ...(cofounderSent ? { cofounder_sent: true as const } : cofounderClaim ? { cofounder_claim: true as const } : {}), ...(offHostSeen ? { off_host_sent: true as const } : {}) };
    return repeated ? ({ ok: true, repeated: true } as const) : night ? ({ ok: true, night: true, ...other, ...cofounder } as const) : closed ? ({ ok: true, closed: true, ...other, ...cofounder } as const)
      : outside ? ({ ok: true, outside: true } as const)
      : otherClaim ? ({ ok: true, ...other, ...cofounder } as const)
      : heldSend ? ({ ok: true, held: true, ...cofounder } as const)
      : cofounderSent || cofounderClaim || offHostSeen ? ({ ok: true, ...cofounder } as const)
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
  | { ok: true; repeated?: true; night?: true; closed?: true; beside?: true; total?: Amounts; replaced?: Amounts; corrected?: true; other_claim?: true; own_claim?: true; held?: true; outside?: true; cofounder_sent?: true; cofounder_claim?: true; off_host_sent?: true }
  | { ok: false; note: string; items?: string[]; current?: string; agent_note?: string; repo_taken?: true; taken?: { day: string; login: string | null } };

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
  const l: Ledger = { applied: 0, asked_usd: 0, won: 0, won_usd: 0, won_other: [], won_no_amount: 0, pending: 0, no_result: 0, rejected: 0, skipped: 0, closing_soon: [], results_soon: [] };
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
    // L43-8 (v6.1.19): no result is its own count (it waits for nothing); the parts still sum to the sent count.
    else if (r.status === 'no_result') l.no_result = (l.no_result ?? 0) + 1;
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
 * given)"); a count of none is left out, waiting is said whenever any wait (L13-18). L43-8 (v6.1.19): no result apart,
 * "5 sent, 1 won ($5,000), 1 rejected, 1 no result, 2 waiting." Pure.
 */
export function ledgerCounts(l: Ledger): string {
  const total = totalText({ usd: l.won_usd, other: l.won_other ?? [], noAmount: l.won_no_amount ?? 0 });
  const won = l.won > 0 && total ? ` (${total})` : '';
  const counts = [`${l.applied} sent`, ...(l.won > 0 ? [`${l.won} won${won}`] : []), ...(l.rejected > 0 ? [`${l.rejected} rejected`] : []), ...((l.no_result ?? 0) > 0 ? [`${l.no_result} no result`] : []), ...(l.pending > 0 ? [`${l.pending} waiting`] : [])];
  return `${counts.join(', ')}.`;
}

/** L29-1 (v6.1.16 Task 15): one application as find's JSON lists it; `amount` through `amountsText` (a win only). */
export type ApplicationItem = {
  program_id: string;
  title: string;
  status: 'waiting' | 'won' | 'rejected' | 'no_result' | 'held';
  sent_at: string | null;
  result_at: string | null;
  amount: string | null;
};

/**
 * L29-1 (v6.1.16 Task 15): the owner's applications by name, newest first: every sent one (waiting or with its result)
 * and the ones the builder held. Skips are not applications, nor is a live claim (an agent filling the form now; a claim
 * left unsent is released and said by Task 9's started-not-sent line).
 */
export async function applicationsOf(owner: string): Promise<ApplicationItem[]> {
  const owners = [owner];
  const rows = await sql()<{ program_id: string; status: string; title: string | null; sent_at: Date | null; at: Date; held_at: Date | null; amount_usd: string | null; amounts: unknown; submitted_by: string | null }[]>`
    SELECT program_id, status, title, sent_at, at, held_at, amount_usd, amounts, submitted_by FROM applications
    WHERE owner = ANY(${owners}) AND status <> 'skipped' AND (status <> 'started' OR held_at IS NOT NULL)
    ORDER BY COALESCE(sent_at, held_at, at) DESC, program_id`;
  const titles = new Map((await programsById(rows.filter((r) => !r.title).map((r) => r.program_id))).map((p) => [p.id, p.file.title]));
  return rows.map((r) => {
    const status: ApplicationItem['status'] = r.status === 'applied' ? 'waiting' : r.status === 'started' ? 'held' : (r.status as ApplicationItem['status']);
    const a = r.status === 'won' ? amountsOf(r) : null;
    // Fix round 1 (N4): a send the builder made outside EarnKit (builder, no send time) has no send date to give; a row
    // from before sent_at existed reads its own time.
    const sent = r.status === 'started' ? null : (r.sent_at ?? (r.submitted_by === 'builder' ? null : r.at));
    return {
      program_id: r.program_id, title: r.title ?? titles.get(r.program_id) ?? r.program_id, status,
      sent_at: sent ? sent.toISOString() : null,
      result_at: RESULTS.includes(r.status) ? r.at.toISOString() : null,
      amount: a ? amountsText(a) : null,
    };
  });
}

/** L29-1: at most this many applications are named on the builder's line; the JSON lists all. */
export const APPLICATIONS_SHOWN = 5;

/**
 * L29-1 (v6.1.16 Task 15): "Your applications: PayPal AI Hackathon (sent Nov 3, waiting), Thiel Fellowship (sent Oct 30,
 * won $10,000)", at most five, then " and {n} more."; one the builder held reads "(on hold, say go to send)"; a win sent outside EarnKit
 * has no send date: "(won EUR 2,000)" (v6.1.16 Task 15 N4, v6.1.17). Null when there are none. Pure.
 */
export function applicationsLine(apps: ApplicationItem[], now: Date): string | null {
  if (apps.length === 0) return null;
  const words = (a: ApplicationItem): string => {
    const day = a.sent_at ? dayWords(new Date(a.sent_at), now) : null;
    // L38-26 (v6.1.18): the row says how to lift the hold, never a Say sentence of its own.
    if (a.status === 'held') return 'on hold, say go to send';
    const result = a.status === 'won' ? (a.amount ? `won ${a.amount}` : `won, ${AMOUNT_NOT_GIVEN}`) : a.status === 'no_result' ? 'no result' : a.status;
    // v6.1.16 Task 15 N4 (v6.1.17): with no send date (a send outside EarnKit), the result alone.
    return day ? `sent ${day}, ${result}` : result;
  };
  const shown = apps.slice(0, APPLICATIONS_SHOWN).map((a) => `${a.title} (${words(a)})`);
  const rest = apps.length - shown.length;
  return `Your applications: ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}.`;
}

/**
 * L23-18 (v6.1.16): when this owner sent the program (an `applied` row waiting on its result), or null. L28-4 (Task
 * 14): with `key`, for that project only (`pickRow`).
 */
export async function sentOf(owner: string, programId: string, key?: string): Promise<Date | null> {
  const rows = await sql()<{ project_id: string | null; off_repo: string | null; sent: Date }[]>`
    SELECT project_id, off_repo, COALESCE(sent_at, at) AS sent FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = 'applied'`;
  return (key === undefined ? rows[0] : pickRow(rows, key, false, true))?.sent ?? null;
}

/**
 * L16-7 (v6.1.16): the program's result for this owner (won, rejected or no result), or null when it has none. L28-4
 * (Task 14): with `key`, that project's (`pickRow`).
 */
export async function resultOf(owner: string, programId: string, key?: string): Promise<{ status: 'won' | 'rejected' | 'no_result'; amount_usd: string | null; amounts: Amounts | null; note: string | null } | null> {
  const rows = await sql()<{ project_id: string | null; off_repo: string | null; status: 'won' | 'rejected' | 'no_result'; amount_usd: string | null; amounts: unknown; note: string | null }[]>`
    SELECT project_id, off_repo, status, amount_usd, amounts, note FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = ANY(${RESULTS})`;
  const r = key === undefined ? rows[0] : pickRow(rows, key, false, true);
  if (!r) return null;
  const { project_id: _p, off_repo: _o, ...rest } = r;
  return { ...rest, amounts: r.status === 'won' ? amountsOf(r) : null };
}

/**
 * Program ids the builder applied to or skipped: they leave the list. A claimed ('started') one stays, marked. L28-4
 * (v6.1.16 Task 14): with `here` (whether a stored project key is this project), a send leaves only its own project's
 * list (a row with no project, from before projects were kept, leaves every list); a skip leaves every list.
 */
export async function excluded(owner: string, here?: (projectId: string | null) => boolean): Promise<Set<string>> {
  const rows = await sql()<{ program_id: string; status: string; project_id: string | null; off_repo: string | null }[]>`
    SELECT program_id, status, project_id, off_repo FROM applications WHERE owner = ${owner} AND status <> 'started'`;
  return new Set(rows.filter((r) => !here || r.status === 'skipped' || !r.project_id || here(r.project_id) || (r.off_repo !== null && here(r.off_repo))).map((r) => r.program_id));
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
 * L28-5 (v6.1.16 Task 14): find calls it silently only when `from` holds nothing (`heldUnder`); else only on the
 * builder's yes to the join question. L28-6: also from a renamed repo's old key to its new one (`rekeyByRepoId`).
 */
export async function rekeyProject(owner: string, from: string, to: string): Promise<void> {
  if (!from || !to || from === to) return;
  await sql().begin((tx) => rekeyIn(tx, owner, from, to));
}

/**
 * The moves of `rekeyProject` inside the caller's transaction; the application rows moved. L35-1, L35-2 (v6.1.16.1
 * Task 2): each moved row takes the new key's identity (`gh:{id}` with its repo id, else the key), never one another of
 * the owner's rows of that program holds. `join` (the builder's yes, `joinRows`): the cross-builder check already passed
 * under the locks, so rows kept off this repo move too and are no longer kept off it (fix round 1: never a row kept off
 * another repo), and the repo id is `repoId`.
 */
async function rekeyIn(tx: Db, owner: string, from: string, to: string, o: { join?: boolean; repoId?: number | null } = {}): Promise<number> {
  // W4 (final round): copied with ON CONFLICT, so a step marked under `to` at this moment never breaks the unique
  // index; the newer time (and its installation) wins. Then the `from` rows go.
  await tx`INSERT INTO gaps_done (owner, installation_id, project_key, program_id, item, at)
    SELECT owner, installation_id, ${to}, program_id, item, at FROM gaps_done WHERE owner = ${owner} AND project_key = ${from}
    ON CONFLICT (owner, project_key, program_id, item) DO UPDATE
      SET installation_id = CASE WHEN EXCLUDED.at > gaps_done.at THEN EXCLUDED.installation_id ELSE gaps_done.installation_id END,
          at = GREATEST(gaps_done.at, EXCLUDED.at)`;
  await tx`DELETE FROM gaps_done WHERE owner = ${owner} AND project_key = ${from}`;
  // FR-5 (fix round 1): the history follows its application.
  await tx`UPDATE application_history h SET project_id = ${to} WHERE h.owner = ${owner} AND h.project_id = ${from}
    AND EXISTS (SELECT 1 FROM applications a WHERE a.owner = h.owner AND a.program_id = h.program_id AND a.project_id = ${from} AND (a.off_repo IS NULL OR (${o.join === true} AND a.off_repo = ${to}) OR (${o.join !== true} AND a.off_repo <> ${to})))
    AND NOT EXISTS (SELECT 1 FROM applications b WHERE b.owner = h.owner AND b.program_id = h.program_id AND COALESCE(b.project_id, '') = ${to})`;
  // L28-4 (v6.1.16 Task 14): one row per owner, program and project: a row moves unless `to` already holds that
  // program (then both stay, each under its own key). It carries the new key's repo (L28-6: a renamed repo).
  // Fix round 1 (N1): a send moved onto a repo key passes the cross-builder check under the repo's lock; one another
  // owner already holds stays under its own key, kept off that repo (`off_repo`).
  const toRepo = repoKeyOf(to);
  if (toRepo && !o.join) {
    const sent = await tx<{ program_id: string; repo_id: string | null }[]>`SELECT program_id, repo_id FROM applications
      WHERE owner = ${owner} AND project_id = ${from} AND status = ANY(${['applied', ...RESULTS]}) ORDER BY program_id`;
    for (const r of sent) {
      const id = r.repo_id === null ? null : Number(r.repo_id);
      await repoLock(tx, toRepo, r.program_id, id);
      if (await sentForRepo(tx, r.program_id, toRepo, owner, id))
        await tx`UPDATE applications SET off_repo = ${toRepo}, repo_key = NULL WHERE owner = ${owner} AND project_id = ${from} AND program_id = ${r.program_id}`;
    }
  }
  const joinId = o.join ? o.repoId ?? null : null;
  const moved = await tx`UPDATE applications a SET project_id = ${to}, repo_key = ${toRepo},
      repo_id = COALESCE(a.repo_id, ${joinId}::bigint),
      identity = CASE WHEN ${toRepo}::text IS NOT NULL AND COALESCE(a.repo_id, ${joinId}::bigint) IS NOT NULL THEN 'gh:' || COALESCE(a.repo_id, ${joinId}::bigint)::text ELSE ${to} END,
      off_repo = CASE WHEN ${o.join === true} THEN NULL ELSE a.off_repo END
    -- Fix round 1 (I1): a join moves a send kept off this very repo, never one kept off another repo.
    WHERE a.owner = ${owner} AND a.project_id = ${from} AND (a.off_repo IS NULL OR (${o.join === true} AND a.off_repo = ${to}) OR (${o.join !== true} AND a.off_repo <> ${to}))
      AND NOT EXISTS (SELECT 1 FROM applications b WHERE b.owner = a.owner AND b.program_id = a.program_id AND COALESCE(b.project_id, '') = ${to})
      AND NOT EXISTS (SELECT 1 FROM applications c WHERE c.owner = a.owner AND c.program_id = a.program_id AND c.ctid <> a.ctid
        AND c.identity = CASE WHEN ${toRepo}::text IS NOT NULL AND COALESCE(a.repo_id, ${joinId}::bigint) IS NOT NULL THEN 'gh:' || COALESCE(a.repo_id, ${joinId}::bigint)::text ELSE ${to} END)`;
  await tx`INSERT INTO project_reports (owner, project_key, report, at)
    SELECT owner, ${to}, report, at FROM project_reports WHERE owner = ${owner} AND project_key = ${from}
    ON CONFLICT (owner, project_key) DO UPDATE
      SET report = CASE WHEN EXCLUDED.at > project_reports.at THEN EXCLUDED.report ELSE project_reports.report END,
          at = GREATEST(project_reports.at, EXCLUDED.at)`;
  await tx`DELETE FROM project_reports WHERE owner = ${owner} AND project_key = ${from}`;
  return moved.count;
}

/**
 * Fix round 2 (I3): find's silent re-key of a name that holds nothing (B4, L28-5), for a builder the caller has shown is
 * tied to `to`. One transaction under the owner's lock for each program with a row under the name; inside it the name is
 * read again: with no application and no step it re-keys (`rekeyIn`, which then moves only the report); with any, only
 * the report moves (never a row, so a send or claim racing this find stays under its name). Whether rows moved.
 */
export async function quietRekey(owner: string, from: string, to: string): Promise<boolean> {
  if (!from || !to || from === to) return false;
  return sql().begin(async (tx) => {
    const programs = (await tx<{ program_id: string }[]>`SELECT DISTINCT program_id FROM applications WHERE owner = ${owner} AND project_id = ${from} ORDER BY program_id`).map((r) => r.program_id);
    for (const p of programs) await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + p}))`;
    const [h] = await tx<{ n: number }[]>`SELECT (
      (SELECT count(*) FROM applications WHERE owner = ${owner} AND project_id = ${from}) +
      (SELECT count(*) FROM gaps_done WHERE owner = ${owner} AND project_key = ${from}))::int AS n`;
    if (h.n === 0) return (await rekeyIn(tx, owner, from, to)) > 0;
    await tx`INSERT INTO project_reports (owner, project_key, report, at)
      SELECT owner, ${to}, report, at FROM project_reports WHERE owner = ${owner} AND project_key = ${from}
      ON CONFLICT (owner, project_key) DO UPDATE
        SET report = CASE WHEN EXCLUDED.at > project_reports.at THEN EXCLUDED.report ELSE project_reports.report END,
            at = GREATEST(project_reports.at, EXCLUDED.at)`;
    return false;
  }) as Promise<boolean>;
}

/**
 * L35-1 (v6.1.16.1 Task 2): a tied builder's yes to the join question, in one transaction under the owner's lock for
 * each program the name holds and the repo's (and a fork's parent's, `parent`): when another owner already sent the repo to any of those programs,
 * nothing moves (`taken`, that send's time; its sends are marked kept off the repo); else every row under the name moves onto the repo key (kept off it or
 * not), with the repo's identity, and its steps and report follow (`moved`, the application rows moved).
 */
export async function joinRows(owner: string, from: string, to: string, repoId: number | null, parent: ParentRepo | null = null): Promise<{ moved: number } | { taken: Date }> {
  if (!from || !repoKeyOf(to) || from === to) return { moved: 0 };
  return sql().begin(async (tx) => {
    const programs = (await tx<{ program_id: string }[]>`SELECT DISTINCT program_id FROM applications WHERE owner = ${owner} AND project_id = ${from} ORDER BY program_id`).map((r) => r.program_id);
    for (const p of programs) await tx`SELECT pg_advisory_xact_lock(hashtext(${owner + ':' + p}))`;
    let taken: Date | null = null;
    for (const p of programs) {
      await repoLock(tx, to, p, repoId);
      // Controller ruling: a fork's parent too, as record and claim read it.
      if (parent?.key) await repoLock(tx, parent.key, p, parent.id);
      const other = await sentForRepo(tx, p, to, owner, repoId, parent);
      if (other && (taken === null || other.at < taken)) taken = other.at;
    }
    // Nothing moves; the name's sends are marked kept off the repo (N1, Task 14 fix round 1), as a re-key would.
    if (taken) {
      await tx`UPDATE applications SET off_repo = ${to} WHERE owner = ${owner} AND project_id = ${from} AND off_repo IS NULL AND status = ANY(${['applied', ...RESULTS]})`;
      return { taken };
    }
    return { moved: await rekeyIn(tx, owner, from, to, { join: true, repoId }) };
  }) as Promise<{ moved: number } | { taken: Date }>;
}

/**
 * L35-1 (v6.1.16.1 Task 2; fix round 1, I1): the builder's answer to the join question for this name and this repo
 * key, kept with EarnKit's copy of the project (the name's report, `joins` by repo key), or null while it is not
 * decided. An answer given for another repo is no answer for this one.
 */
export async function joinDecision(owner: string, nameKey: string, repoKey: string): Promise<'joined' | 'kept_apart' | null> {
  if (!nameKey || !repoKey) return null;
  const [r] = await sql()<{ j: string | null }[]>`SELECT report->'joins'->>${repoKey} AS j FROM project_reports WHERE owner = ${owner} AND project_key = ${nameKey}`;
  return r?.j === 'joined' || r?.j === 'kept_apart' ? r.j : null;
}

/** L35-1: keeps the answer to the join question for this name and repo on the name key's report (a report with only
 *  the name when none). */
export async function saveJoinDecision(owner: string, nameKey: string, repoKey: string, name: string, decision: 'joined' | 'kept_apart', now: Date): Promise<void> {
  if (!nameKey || !repoKey) return;
  await sql()`INSERT INTO project_reports (owner, project_key, report, at) VALUES (${owner}, ${nameKey}, ${sql().json({ name, description: '', joins: { [repoKey]: decision } } as never)}, ${now})
    ON CONFLICT (owner, project_key) DO UPDATE SET report = project_reports.report
      || jsonb_build_object('joins', COALESCE(project_reports.report->'joins', '{}'::jsonb) || ${sql().json({ [repoKey]: decision } as never)})`;
}

/**
 * L28-5 (v6.1.16 Task 14): whether the owner holds anything under this project key that a silent re-key would move: an
 * application (any status) or a done step (a confirmed rule among them).
 */
export async function heldUnder(owner: string, key: string): Promise<boolean> {
  if (!key) return false;
  const [r] = await sql()<{ n: number }[]>`SELECT (
    (SELECT count(*) FROM applications WHERE owner = ${owner} AND project_id = ${key}) +
    (SELECT count(*) FROM gaps_done WHERE owner = ${owner} AND project_key = ${key}))::int AS n`;
  return r.n > 0;
}

/**
 * L28-6 (v6.1.16 Task 14): a repo renamed or transferred keeps its key. Every project key of the owner whose
 * applications carry this GitHub repo id under another repo key is re-keyed to `to` (`rekeyProject`): the results, done
 * steps and confirmed rules follow. The keys moved.
 */
export async function rekeyByRepoId(owner: string, repoId: number, to: string, alsoKeys: string[] = []): Promise<string[]> {
  // Fix round 1 (M3): the old keys come from the owner's applications with the id, and from every repo key the owner
  // holds steps, a report or a record project on (`alsoKeys`) whose cached read carries the same id, so confirmed rules
  // follow a rename with or without an application.
  const apps = await sql()<{ k: string }[]>`
    SELECT DISTINCT project_id AS k FROM applications WHERE owner = ${owner} AND repo_id = ${repoId} AND project_id LIKE 'https://%'`;
  const held = await sql()<{ k: string }[]>`
    SELECT project_key AS k FROM gaps_done WHERE owner = ${owner} AND project_key LIKE 'https://%'
    UNION SELECT project_key FROM project_reports WHERE owner = ${owner} AND project_key LIKE 'https://%'`;
  const keys = new Set(apps.map((r) => r.k));
  for (const k of new Set([...held.map((r) => r.k), ...alsoKeys])) {
    if (keys.has(k) || k === to) continue;
    const [c] = await sql()<{ id: string | null }[]>`SELECT COALESCE(facts->>'repo_id', facts->>'id') AS id FROM repo_cache WHERE repo = ${k.replace(/^https:\/\/github\.com\//, '')}`;
    // Fix round 2 (C2): every candidate, a record project's too, only when its own cached read carries the same id.
    if (c?.id && Number(c.id) === repoId) keys.add(k);
  }
  keys.delete(to);
  for (const k of keys) await rekeyProject(owner, k, to);
  return [...keys];
}

/** Keeps the project as the agent reported it at this find (parsed, v6.1.13 Task 1 review I1), per owner and project key. */
export async function saveReport(owner: string, projectKey: string, report: Project, now: Date, o: { clearDemo?: boolean } = {}): Promise<void> {
  if (!projectKey) return;
  // L35-1 (v6.1.16.1 Task 2): the answer to the join question stays with the report. L41-4, M3 (v6.1.19): so does a
  // demo link once given, when the new report has none; fix round 1 (M7): unless the builder cleared it (`clearDemo`).
  await sql()`INSERT INTO project_reports (owner, project_key, report, at) VALUES (${owner}, ${projectKey}, ${sql().json(report as never)}, ${now})
    ON CONFLICT (owner, project_key) DO UPDATE SET report = EXCLUDED.report || (CASE WHEN project_reports.report ? 'joins' THEN jsonb_build_object('joins', project_reports.report->'joins') ELSE '{}'::jsonb END)
      || (CASE WHEN NOT ${o.clearDemo === true} AND COALESCE(EXCLUDED.report->>'demo_url', '') = '' AND COALESCE(project_reports.report->>'demo_url', '') <> '' THEN jsonb_build_object('demo_url', project_reports.report->'demo_url') ELSE '{}'::jsonb END), at = EXCLUDED.at`;
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
  const [r] = await sql()<{ report: Project & { joins?: unknown } }[]>`SELECT report FROM project_reports WHERE owner = ${owner} AND project_key = ${projectKey}`;
  if (!r) return null;
  // L35-1: the join answers are EarnKit's own, never part of the project.
  const { joins: _joins, ...report } = r.report;
  return report as Project;
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

/** L36-1 (v6.1.18 Task 4): hours after a builder-submits program is started before EarnKit asks whether it was sent. */
export const SENT_ASK_AFTER_HOURS = 1;
/** L18-4 (v6.1.18 Task 4): days before the same installation asks again whether a form went out. */
export const SENT_ASK_EVERY_DAYS = 7;
/** L41-10 (v6.1.18.1): days after a program closes that a start on it is still asked about (a last-hour send). */
export const SENT_ASK_AFTER_CLOSE_DAYS = 7;
/** v6.1.18.1 (review M3): days after the start that a program closed with no ends_at is still asked about. */
export const SENT_ASK_CLOSED_NO_DATE_DAYS = 14;

/** A program the builder sends themselves, started and not yet sent (L18-4): its title, when it was started and the
 *  project key its started row carries (null for a row with none). */
/** L41-7 (v6.1.19): `project` is the started row's project as the builder reads it: its name in the record, else its
 *  key's own name (a name key's name, a repo's last segment); null with no project. */
export type SentAsk = { program_id: string; title: string; started_at: string; project_id: string | null; project: string | null };

/**
 * L18-4, L36-1 (v6.1.18 Task 4): every started row (not one the builder held) at least SENT_ASK_AFTER_HOURS old whose
 * program the builder submits (`submit` 'builder'), open or closed within SENT_ASK_AFTER_CLOSE_DAYS (L41-10). A row is one per owner, program and project, so a started row is
 * one with no send or result on that project. Fix round 1: with `here`, only the rows of this project (a row with no
 * project is every project's); without, every row (a find with no project). One ask per program, the earliest start;
 * by start time.
 */
export async function askSent(owner: string, programs: ProgramRow[], now: Date, here?: (projectId: string) => boolean): Promise<SentAsk[]> {
  const rows = await sql()<{ program_id: string; project_id: string | null; started: Date }[]>`
    SELECT program_id, project_id, COALESCE(claimed_at, at) AS started FROM applications
    WHERE owner = ${owner} AND status = 'started' AND held_at IS NULL
      AND COALESCE(claimed_at, at) <= ${new Date(now.getTime() - SENT_ASK_AFTER_HOURS * 3_600_000)}
    ORDER BY COALESCE(claimed_at, at), program_id`;
  const first = new Map<string, { at: Date; project: string | null }>();
  for (const r of rows) {
    if (here && r.project_id && !here(r.project_id)) continue;
    if (!first.has(r.program_id)) first.set(r.program_id, { at: r.started, project: r.project_id });
  }
  const byId = await withOwn([...first.keys()], programs);
  const names = first.size > 0 ? await recordProjectNames(owner) : new Map<string, string>();
  return [...first]
    .map(([id, x]) => ({ p: byId.get(id), ...x }))
    .filter((x): x is { p: ProgramRow; at: Date; project: string | null } => x.p?.file.submit === 'builder')
    // L41-10 (v6.1.18.1): a program closed since the start is still asked about, for SENT_ASK_AFTER_CLOSE_DAYS after its
    // ends_at. Review M3: a program closed by status with no ends_at has no close time on record, so its ask is bound by
    // the started row's age instead, SENT_ASK_CLOSED_NO_DATE_DAYS (14); an open program is asked as before.
    .filter(({ p, at }) => p.file.ends_at
      ? Date.parse(p.file.ends_at) > now.getTime() - SENT_ASK_AFTER_CLOSE_DAYS * 86_400_000
      : p.file.status !== 'closed' || at.getTime() > now.getTime() - SENT_ASK_CLOSED_NO_DATE_DAYS * 86_400_000)
    .map(({ p, at, project }) => ({ program_id: p.id, title: p.file.title, started_at: at.toISOString(), project_id: project, project: projectLabel(project, names) }));
}

/** L41-7 (v6.1.19): the record's project names by project key, for a builder owner; none else. */
async function recordProjectNames(owner: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!owner.startsWith('b:')) return out;
  const { getRecord } = await import('../v6/builders');
  for (const p of (await getRecord(Number(owner.slice(2)))).projects) {
    if (!p.name?.trim()) continue;
    const key = projectKeyOf({ name: p.name, repo_url: p.repo_url });
    if (key && !out.has(key)) out.set(key, p.name.trim());
  }
  return out;
}
/** L41-7 (v6.1.19): a project key as a short label: the record's name, else a name key's name or a repo's last
 *  segment; null with no key. Pure. */
export function projectLabel(key: string | null, names: Map<string, string> = new Map()): string | null {
  if (!key) return null;
  const named = names.get(key);
  if (named) return named;
  if (key.startsWith('name:')) return key.slice(5) || null;
  return key.replace(/^https:\/\//, '').split('/').filter(Boolean).at(-1) ?? null;
}

/**
 * L18-4 (v6.1.18 Task 4): of `due`, the ones this installation has not asked in the last SENT_ASK_EVERY_DAYS days (its
 * own `sent_asks` row for the program, by UTC day). Read only: fix round 1 marks only the ones the reply shows
 * (`markSentAsked`).
 */
export async function sentAsksOpen<T extends { program_id: string }>(installationId: number, due: T[], now: Date): Promise<T[]> {
  if (due.length === 0) return [];
  const rows = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM sent_asks WHERE installation_id = ${installationId} AND program_id IN ${sql()(due.map((d) => d.program_id))}
      AND asked_on > ${utcDate(now)}::date - ${SENT_ASK_EVERY_DAYS}::int`;
  const recent = new Set(rows.map((r) => r.program_id));
  return due.filter((d) => !recent.has(d.program_id));
}

/** L18-4 (v6.1.18 Task 4, fix round 1): marks the sent questions the builder text showed as asked today. */
export async function markSentAsked(installationId: number, owner: string, programIds: string[], now: Date): Promise<void> {
  if (programIds.length === 0) return;
  const day = utcDate(now);
  await sql()`
    INSERT INTO sent_asks ${sql()([...new Set(programIds)].map((id) => ({ installation_id: installationId, owner, program_id: id, asked_on: day })))}
    ON CONFLICT (installation_id, program_id) DO UPDATE SET owner = EXCLUDED.owner, asked_on = EXCLUDED.asked_on`;
}

/**
 * L18-4 (v6.1.18 Task 4): `sentAsksOpen` and `markSentAsked` in one: the ones this installation has not asked in the
 * last SENT_ASK_EVERY_DAYS days, marked as asked today. A second installation of the same builder asks on its own.
 */
export async function sentAsksDue<T extends { program_id: string }>(installationId: number, owner: string, due: T[], now: Date): Promise<T[]> {
  const open = await sentAsksOpen(installationId, due, now);
  await markSentAsked(installationId, owner, open.map((d) => d.program_id), now);
  return open;
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
export async function claimed(owner: string, here?: (projectId: string | null) => boolean): Promise<Map<string, { since: string; by: number | null; project: string | null; held?: true }>> {
  const all = await sql()<{ program_id: string; claimed_at: Date | null; claimed_by: number | null; project_id: string | null; held_at: Date | null }[]>`
    SELECT program_id, claimed_at, claimed_by, project_id, held_at FROM applications WHERE owner = ${owner} AND status = 'started'`;
  // L28-4 (v6.1.16 Task 14): two projects' claims on one program: this project's (`here`) is the one kept.
  const rows = here ? [...all.filter((r) => !here(r.project_id)), ...all.filter((r) => here(r.project_id))] : all;
  // L24-4 (v6.1.16 Task 11): `held`: the builder held it (track held); no agent sends it until a started lifts it.
  return new Map(rows.map((r) => [r.program_id, { since: (r.claimed_at ?? new Date(0)).toISOString(), by: r.claimed_by, project: r.project_id, ...(r.held_at ? { held: true as const } : {}) }]));
}
