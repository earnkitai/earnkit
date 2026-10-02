import { BaseError } from 'viem';
import { ZodError } from 'zod';
import { formatDeadline } from './dates';
import { receiptNotFoundMessage } from './receipt-error';

/** Pure helpers for the operator CLI (scripts/campaign.mts), kept here so they're tested. */

export const USAGE = `Usage: pnpm campaign <command> <slug|ref> [options]

EarnKit's own campaigns (by program slug):
  score  <slug>                                  update every entry's score from Base data
  rank   <slug>                                  leaderboard with evidence, for review
  payout <slug> --winners <id>,<id>,... [--execute]
                                                 send the fixed prize to approved winners (PAYOUT_PRIVATE_KEY)

Sponsor campaigns (by ref; operator only, OPERATOR_PRIVATE_KEY, local shell):
  award  <ref> --winners <id>:<amount>:<reason>,... [--execute]
                                                 fallback award, once 7 days have passed since the deadline
  refund <ref> --reason no-eligible|takedown [--escrow <address>] [--execute]
                                                 refund the sponsor (--escrow: an untracked second deposit)
  sync   <ref> [--tx <hash>]                     compare the database with the chain; --tx repairs from a receipt

Without --execute, payout, award and refund are dry runs.`;

/** One readable line for any error the CLI hits: no stack traces. */
export function cliErrorLine(err: unknown): string {
  const receipt = receiptNotFoundMessage(err);
  if (receipt) return receipt;
  if (err instanceof BaseError) return err.shortMessage;
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

/**
 * Whether the operator's fallback award is open at `now` (chain time, in seconds): the escrow
 * allows it once `endsAt + grace` has passed. Otherwise, the line to refuse with.
 */
export function fallbackProblem(endsAt: bigint, grace: bigint, now: bigint) {
  const opens = endsAt + grace;
  return now >= opens
    ? null
    : `The fallback opens on ${formatDeadline(new Date(Number(opens) * 1000))}.`;
}
