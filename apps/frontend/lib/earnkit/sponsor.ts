import { randomBytes } from 'node:crypto';
import { parseUnits, type TransactionReceipt } from 'viem';
import { sql } from './db';
import {
  capOf,
  escrowClient,
  escrowConfig,
  findToken,
  fundTxs,
  readCreated,
  type RawTx,
} from './escrow';
import { NotFoundError, upsertProgram } from './programs';
import {
  SponsorError,
  checkDraft,
  sponsorProgramFile,
  splitUnits,
  type Draft,
} from './sponsor-rules';

/** Sponsor campaigns (v2.1): drafts, funding, status, and awards. Reads the chain; never signs. */

export type SponsorRow = {
  ref: string;
  program_id: string | null;
  installation_id: number;
  sponsor_name: string;
  sponsor_url: string | null;
  draft: Draft;
  token: string;
  token_symbol: string;
  token_decimals: number;
  amount: string;
  chain_id: number;
  escrow_address: string | null;
  sponsor_wallet: string | null;
  fund_tx: string | null;
  state: 'draft' | 'live' | 'awarded' | 'refunded' | 'expired' | 'taken_down';
  award_plan:
    | { entry_id: number; wallet: string; amount: string; reason: string }[]
    | null;
  award_tx: string | null;
  created_at: Date;
};

const baseUrl = () =>
  (process.env.EARNKIT_URL ?? 'https://earnkit.com').replace(/\/$/, '');
const DRAFT_TTL_MS = 7 * 86_400_000;

export async function createSponsorDraft(d: Draft, installationId: number) {
  const token = findToken(d.token);
  const cap = token ? await capOf(token.address) : 0n;
  const { amountUnits } = checkDraft(d, token, cap, new Date());
  const ref = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
  const { chainId } = escrowConfig();
  await sql()`INSERT INTO sponsor_campaigns ${sql()({
    ref,
    installation_id: installationId,
    sponsor_name: d.sponsor_name,
    sponsor_url: d.sponsor_url ?? null,
    draft: sql().json(d as never),
    token: token!.address,
    token_symbol: token!.symbol,
    token_decimals: token!.decimals,
    amount: d.amount,
    chain_id: chainId,
  })}`;
  const { prize, fee } = splitUnits(amountUnits);
  const fmt = (u: bigint) =>
    (Number(u) / 10 ** token!.decimals).toLocaleString('en-US');
  return {
    ref,
    fund_url: `${baseUrl()}/fund/${ref}`,
    transactions: fundTxs(
      ref,
      token!,
      amountUnits,
      Math.floor(Date.parse(d.ends_at) / 1000),
    ),
    show_to_builder:
      `Campaign drafted: ${d.title}. To go live, deposit ${d.amount} ${token!.symbol} into escrow: ` +
      `${baseUrl()}/fund/${ref} (or I can send the two transactions if I hold your wallet). ` +
      `${fmt(prize)} ${token!.symbol} goes to the winners you pick; EarnKit's 10% (${fmt(fee)} ${token!.symbol}) ` +
      `is paid only when prizes are paid, and refunded if nobody qualifies. Unfunded drafts expire in 7 days.`,
  };
}

/** The row, with lazy expiry of drafts older than 7 days. */
export async function loadCampaign(ref: string) {
  const [row] = await sql()<
    SponsorRow[]
  >`SELECT * FROM sponsor_campaigns WHERE ref = ${ref}`;
  if (!row) throw new NotFoundError(`No sponsor campaign "${ref}".`);
  if (
    row.state === 'draft' &&
    Date.now() - row.created_at.getTime() > DRAFT_TTL_MS
  ) {
    await sql()`UPDATE sponsor_campaigns SET state = 'expired' WHERE ref = ${ref} AND state = 'draft'`;
    return { ...row, state: 'expired' as const };
  }
  return row;
}

/** Checks a receipt is exactly this draft's funding. Pure; exported for tests. */
export function fundingFromReceipt(
  row: Pick<SponsorRow, 'ref' | 'token' | 'token_decimals' | 'amount'> & {
    draft: { ends_at: string };
  },
  receipt: TransactionReceipt,
) {
  if (receipt.status !== 'success')
    throw new SponsorError('That transaction failed onchain.');
  const created = readCreated(receipt);
  if (!created || created.ref.toLowerCase() !== row.ref.toLowerCase())
    throw new SponsorError(
      "That transaction isn't the funding for this campaign.",
    );
  if (created.token.toLowerCase() !== row.token.toLowerCase())
    throw new SponsorError('Funded with a different token than the draft.');
  if (created.amount !== parseUnits(row.amount, row.token_decimals))
    throw new SponsorError('Funded amount differs from the draft.');
  if (created.endsAt !== Math.floor(Date.parse(row.draft.ends_at) / 1000))
    throw new SponsorError('Funded end date differs from the draft.');
  // viem's decodeEventLog (via readCreated) returns EIP-55 checksummed addresses; normalize to
  // lowercase so callers (DB storage, equality checks, tests) see one consistent casing.
  return {
    escrow: created.campaign.toLowerCase(),
    sponsor: created.sponsor.toLowerCase(),
  };
}

/**
 * Whether `confirmFunding` should publish the campaign, treat it as already live, or refuse,
 * given the row's current `state`. Pure; exported for tests (the DB-backed paths around it are
 * exercised by the Task 10 end-to-end script).
 *
 * - `draft` or `expired` → `publish`. A draft expires lazily after 7 days (`loadCampaign`), but
 *   a deposit that lands after that still counts: `confirmFunding` only reaches `publish` once
 *   `fundingFromReceipt` has verified the receipt is this campaign's exact funding, so an
 *   `expired` row is rescued rather than lost.
 * - `live` → `already_live`. Publishing already happened; return the same result again
 *   (idempotent, no error, no double publish).
 * - `awarded`, `refunded`, `taken_down` → `refuse`. Terminal states; funding cannot reopen them.
 */
export function confirmableState(
  state: SponsorRow['state'],
): 'publish' | 'already_live' | 'refuse' {
  if (state === 'draft' || state === 'expired') return 'publish';
  if (state === 'live') return 'already_live';
  return 'refuse';
}

/**
 * Confirms the deposit and publishes the campaign. Idempotent, and race-safe under concurrent
 * confirms for the same ref: the row is locked (`FOR UPDATE`) for the duration of the publish,
 * so a second confirm that arrives while the first is still running waits, then sees the row
 * already `live` and returns the same result rather than publishing twice.
 */
export async function confirmFunding(ref: string, tx: `0x${string}`) {
  // Fetch the receipt before opening the transaction: it's a network round-trip, and must not
  // run while holding the row lock below.
  const receipt = await escrowClient().getTransactionReceipt({ hash: tx });

  return sql().begin(async (db) => {
    const [row] = await db<SponsorRow[]>`
      SELECT * FROM sponsor_campaigns WHERE ref = ${ref} FOR UPDATE`;
    if (!row) throw new NotFoundError(`No sponsor campaign "${ref}".`);

    const decision = confirmableState(row.state);
    if (decision === 'refuse')
      throw new SponsorError(`This campaign is ${row.state}.`);
    if (decision === 'already_live')
      return {
        program_id: row.program_id as string,
        campaign_url: `${baseUrl()}/campaigns/${row.program_id}`,
      };

    // decision === 'publish': a draft, or a lazily-expired draft this receipt proves was
    // actually funded. Verify the receipt matches this campaign's declared terms exactly.
    const { escrow, sponsor } = fundingFromReceipt(row, receipt);
    const token = {
      symbol: row.token_symbol,
      address: row.token as `0x${string}`,
      decimals: row.token_decimals,
    };
    const file = sponsorProgramFile({
      ref,
      draft: row.draft,
      token,
      amountUnits: parseUnits(row.amount, row.token_decimals),
      chainId: row.chain_id,
      escrow,
      baseUrl: baseUrl(),
      now: new Date(),
    });
    // Published in the same transaction as the state flip, so the two can't diverge.
    await upsertProgram(file, 'sponsor', db);
    // Note: even if draft.ends_at has already passed by now, this still goes live — the receipt
    // just proved the deposit happened, so the sponsor can award right away.
    await db`
      UPDATE sponsor_campaigns SET state = 'live', program_id = ${file.id},
        escrow_address = ${escrow}, sponsor_wallet = ${sponsor}, fund_tx = ${tx}, funded_at = now()
      WHERE ref = ${ref}`;
    return {
      program_id: file.id,
      campaign_url: `${baseUrl()}/campaigns/${file.id}`,
    };
  });
}
