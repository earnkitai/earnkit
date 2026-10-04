import { ZodError } from 'zod';
import { formatDeadline } from './dates';

/** Pure helpers for the operator CLI (scripts/campaign.mts), kept here so they're tested. */

export const USAGE = `Usage: pnpm campaign <command> <slug|ref> [options]

EarnKit's own campaigns (by program slug). The cron (POST /api/cron) scores, freezes and pays them:
  golive <slug> [--days 14] [--write]            price MINI on DefiLlama now, set the 14-day window, status
                                                 active and the generated texts in programs/<slug>.json
  golive <slug> --texts-only [--write]           only regenerate the reward, summary and rules
  rank   <slug>                                  ranked entries with evidence (users, smart, shared, code share)
  payout <slug>                                  dry run: who the cron pays, in order, after screening
  veto-link <slug>                               print the owner's review link (needs ADMIN_VETO_SECRET)

Sponsor campaigns (by ref; local shell only):
  fallback propose <ref> --winners <id>,<id>,... [--split equal|<pct>,<pct>,...] [--execute]
  fallback propose <ref> --winners <id>:<amount>[:<reason>],... [--execute]
                                                 propose winners (ranked best first, the prize split equally
                                                 or by percentages adding up to 100; or exact amounts)
                                                 once 7 days have passed since the deadline
                                                 (OPERATOR_PRIVATE_KEY); payable 72 hours later unless vetoed
  fallback execute <ref> [--execute]             pay the proposed winners once the 72 hours have passed
  fallback veto    <ref> [--execute]             cancel the proposal for good (GUARDIAN_PRIVATE_KEY)
  refund <ref> --reason no-eligible|takedown [--escrow <address>] [--execute]
                                                 refund the sponsor (OPERATOR_PRIVATE_KEY; --escrow: a stray
                                                 escrow for this ref that EarnKit doesn't track)
  sync   [<ref>]                                 read the chain and update the database: one campaign, or
                                                 every draft and live one (and those expired or replaced
                                                 within 30 days of their deadline); shows pending
                                                 fallbacks and stray deposits to refund

Without --execute, fallback and refund are dry runs.`;

/** The fallback's default reason for a winner. */
export const FALLBACK_REASON = 'Top entry (EarnKit fallback)';

/**
 * Parses `fallback propose`'s --winners (and --split): entry ids in ranked order ("12,7,3") with an
 * optional split ("equal" or "50,30,20"), or exact picks ("12:60:reason,7:30"). The result goes
 * through resolvePicks and planAward like a sponsor's award. Throws a readable Error.
 */
export function parseFallbackPicks(
  winners: string | undefined,
  split: string | undefined,
): {
  winners: number[] | { entry_id: number; amount: string; reason?: string }[];
  split?: 'equal' | number[];
} {
  const items = (winners ?? '').split(',').filter(Boolean);
  if (!items.length)
    throw new Error(
      'Name the winners: --winners <id>,<id>,... (ranked) or <id>:<amount>[:<reason>],...',
    );
  const id = (v: string) => {
    if (!/^\d+$/.test(v) || Number(v) <= 0)
      throw new Error(`--winners: "${v}" isn't an entry id.`);
    return Number(v);
  };
  if (items.every((w) => !w.includes(':'))) {
    const parsedSplit =
      split === undefined || split === 'equal'
        ? split
        : split.split(',').map((p) => {
            if (!/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 100)
              throw new Error(
                `--split: "${p}" isn't a whole percentage from 1 to 100; use equal or e.g. 50,30,20.`,
              );
            return Number(p);
          });
    return {
      winners: items.map(id),
      ...(parsedSplit !== undefined && { split: parsedSplit }),
    };
  }
  if (split !== undefined)
    throw new Error('--split is only for a ranking (--winners <id>,<id>,...).');
  return {
    winners: items.map((w) => {
      const [entry, amount, ...reason] = w.split(':');
      if (!amount || !/^\d+(\.\d+)?$/.test(amount))
        throw new Error(`--winners: "${w}" needs <id>:<amount>[:<reason>].`);
      return {
        entry_id: id(entry),
        amount,
        // An empty reason ("12:60:") gets the default, as before.
        ...(reason.join(':') && { reason: reason.join(':') }),
      };
    }),
  };
}

/**
 * viem's errors by shape, not `instanceof`: under tsx the scripts load viem as ESM while lib/ loads
 * it as CommonJS, so a viem error thrown in a script isn't an instance of lib/'s `BaseError`.
 */
const isViemError = (e: unknown): e is { shortMessage: string } =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as { shortMessage?: unknown }).shortMessage === 'string';

/** The contract's custom error name somewhere in a revert's cause chain, or null. */
function revertName(err: unknown): string | null {
  let cur: unknown = err;
  while (typeof cur === 'object' && cur !== null) {
    const name = (cur as { data?: { errorName?: unknown } }).data?.errorName;
    if (typeof name === 'string') return name;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

/** One readable line for any error the CLI hits: no stack traces. */
export function cliErrorLine(err: unknown): string {
  if (isViemError(err)) {
    // A contract revert names the contract's error ("…reverted: NotAllowed.").
    const name = revertName(err);
    return name
      ? `${err.shortMessage.replace(/\.$/, '')}: ${name}.`
      : err.shortMessage;
  }
  if (err instanceof ZodError)
    return `Invalid input: ${err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s*\n\s*/g, ' ').trim();
}

/** Why a signing key from the env (`name`) can't be used, or null. */
export function privateKeyProblem(name: string, key: string | undefined) {
  if (!key) return `Set ${name} in your local shell.`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    return `${name} must be 0x followed by 64 hex characters.`;
  return null;
}

export const operatorKeyProblem = (key: string | undefined) =>
  privateKeyProblem('OPERATOR_PRIVATE_KEY', key);

export const guardianKeyProblem = (key: string | undefined) =>
  privateKeyProblem('GUARDIAN_PRIVATE_KEY', key);

/**
 * Whether the operator may propose fallback winners at `now` (chain time, in seconds): the escrow
 * allows it once `endsAt + grace` has passed. Otherwise, the line to refuse with.
 */
export function fallbackProblem(endsAt: bigint, grace: bigint, now: bigint) {
  const opens = endsAt + grace;
  return now >= opens
    ? null
    : `The fallback opens on ${formatDeadline(new Date(Number(opens) * 1000))}.`;
}

/**
 * Whether a proposed fallback can be executed at `now` (chain time, in seconds): once its delay
 * has passed at `executesAt`. Otherwise, the line to refuse with.
 */
export function executeProblem(executesAt: bigint, now: bigint) {
  return now >= executesAt
    ? null
    : `The fallback can be executed from ${formatDeadline(new Date(Number(executesAt) * 1000))}.`;
}
