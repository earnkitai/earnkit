import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { formatUnits, parseUnits, type TransactionReceipt } from 'viem';
import { z } from 'zod';
import { scoreEntry } from './campaigns';
import { formatDeadline } from './dates';
import { formatExact } from './format-units';
import { sql } from './db';
import {
  SPONSOR_NOT_OPEN,
  awardTx,
  capOf,
  escrowClient,
  escrowConfig,
  escrowEnabled,
  findToken,
  fundTxs,
  readAwarded,
  readCreated,
  type RawTx,
} from './escrow';
import { NotFoundError, upsertProgram } from './programs';
import {
  AwardWinner,
  SponsorError,
  checkDraft,
  mapOffPlanAward,
  matchAwardToPlan,
  planAward,
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
  if (!escrowEnabled()) throw new SponsorError(SPONSOR_NOT_OPEN);
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
  // Exact (formatUnits-based), so the split told to the sponsor matches the fund page and the
  // signed amount to the last unit.
  const fmt = (u: bigint) => formatExact(u, token!.decimals);
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
 * exercised by the end-to-end script).
 *
 * - `draft` or `expired` → `publish`. A draft expires lazily after 7 days (`loadCampaign`), but
 *   a deposit that lands after that still counts: `confirmFunding` only reaches `publish` once
 *   `fundingFromReceipt` has verified the receipt is this campaign's exact funding, so an
 *   `expired` row is rescued rather than lost.
 * - `live` or `awarded` → `already_live`. Publishing already happened; `confirmFunding` returns
 *   the same result again, but only after `fundingDecision` has checked the receipt created the
 *   escrow this row tracks.
 * - `refunded`, `taken_down` → `refuse`. Terminal states; funding cannot reopen them.
 */
export function confirmableState(
  state: SponsorRow['state'],
): 'publish' | 'already_live' | 'refuse' {
  if (state === 'draft' || state === 'expired') return 'publish';
  if (state === 'live' || state === 'awarded') return 'already_live';
  return 'refuse';
}

/** The funding receipt's `CampaignCreated` as `fundingDecision` needs it. */
type Created = { ref: string; campaign: string };

/**
 * What to do with a funding receipt for `row`. Pure; exported for tests.
 *
 * Refs are unique per sponsor wallet onchain, so two different wallets can both fund the same
 * draft. The first confirmed deposit becomes the campaign; any other `CampaignCreated` for this
 * ref is a second, untracked escrow, and is reported by its address (the operator refunds it with
 * `pnpm campaign refund <ref> --escrow <address>`), never silently reported as success.
 */
export function fundingDecision(
  row: Pick<SponsorRow, 'ref' | 'state' | 'escrow_address'>,
  created: Created | null,
):
  | { action: 'publish' }
  | { action: 'already_live' }
  | { action: 'second_escrow'; escrow: string }
  | { action: 'refuse'; message: string } {
  if (!created || created.ref.toLowerCase() !== row.ref.toLowerCase())
    return {
      action: 'refuse',
      message: "That transaction isn't the funding for this campaign.",
    };
  const escrow = created.campaign.toLowerCase();
  if (row.escrow_address && row.escrow_address.toLowerCase() !== escrow)
    return { action: 'second_escrow', escrow };
  const state = confirmableState(row.state);
  if (state === 'refuse')
    return { action: 'refuse', message: `This campaign is ${row.state}.` };
  return { action: state };
}

export const secondEscrowMessage = (escrow: string, tracked: string) =>
  `This deposit created a second escrow (${escrow}) for a campaign that is already funded by ` +
  `escrow ${tracked}. It is not part of the campaign: EarnKit will refund it to the wallet that ` +
  `sent it. Contact EarnKit with this escrow address if you have questions.`;

/**
 * Which confirmation a receipt is for, judged by its contents (not only by the row's state):
 * a `CampaignCreated` for this ref from the factory is a funding receipt, an `Awarded` from this
 * campaign's escrow is an award receipt. Otherwise, the readable error to show. Pure; exported for
 * tests.
 */
export function routeReceipt(
  row: Pick<SponsorRow, 'ref' | 'state' | 'escrow_address'>,
  receipt: TransactionReceipt,
): { route: 'funding' | 'award' } | { error: string } {
  if (receipt.status !== 'success')
    return { error: 'That transaction failed onchain.' };
  const created = readCreated(receipt);
  if (created && created.ref.toLowerCase() === row.ref.toLowerCase())
    return { route: 'funding' };
  if (row.escrow_address && readAwarded(receipt, row.escrow_address))
    return { route: 'award' };
  if (row.state === 'draft' || row.state === 'expired')
    return { error: "That transaction isn't the funding for this campaign." };
  if (row.state === 'live')
    return {
      error: "That transaction isn't this campaign's funding or award.",
    };
  return { error: `This campaign is ${row.state}.` };
}

/**
 * Confirms any transaction a sponsor (or their agent, or the operator) reports for `ref`: the
 * funding deposit (including the rescue of a lazily-expired draft, and re-confirming a campaign
 * that's already live), or the award. Used by the `status` tool, the pages' confirm API, and
 * `pnpm campaign sync --tx`.
 */
export async function confirmTx(ref: string, tx: `0x${string}`) {
  const row = await loadCampaign(ref);
  const receipt = await escrowClient().getTransactionReceipt({ hash: tx });
  const r = routeReceipt(row, receipt);
  if ('error' in r) throw new SponsorError(r.error);
  if (r.route === 'funding')
    return {
      confirmed: 'funding' as const,
      ...(await confirmFunding(ref, tx, receipt)),
    };
  return {
    confirmed: 'award' as const,
    ...(await confirmAward(ref, tx, receipt)),
  };
}

/**
 * Confirms the deposit and publishes the campaign. Idempotent, and race-safe under concurrent
 * confirms for the same ref: the row is locked (`FOR UPDATE`) for the duration of the publish,
 * so a second confirm that arrives while the first is still running waits, then sees the row
 * already `live` and returns the same result rather than publishing twice.
 */
export async function confirmFunding(
  ref: string,
  tx: `0x${string}`,
  fetched?: TransactionReceipt,
) {
  // Fetch the receipt before opening the transaction: it's a network round-trip, and must not
  // run while holding the row lock below.
  const receipt =
    fetched ?? (await escrowClient().getTransactionReceipt({ hash: tx }));

  return sql().begin(async (db) => {
    const [row] = await db<SponsorRow[]>`
      SELECT * FROM sponsor_campaigns WHERE ref = ${ref} FOR UPDATE`;
    if (!row) throw new NotFoundError(`No sponsor campaign "${ref}".`);

    if (receipt.status !== 'success')
      throw new SponsorError('That transaction failed onchain.');
    const decision = fundingDecision(row, readCreated(receipt));
    if (decision.action === 'refuse') throw new SponsorError(decision.message);
    if (decision.action === 'second_escrow') {
      console.error(
        `[sponsor] second escrow for ${ref}: ${decision.escrow} (tx ${tx}); tracked escrow ${row.escrow_address}. ` +
          `Refund it: pnpm campaign refund ${ref} --escrow ${decision.escrow} --reason no-eligible --execute`,
      );
      throw new SponsorError(
        secondEscrowMessage(decision.escrow, row.escrow_address as string),
      );
    }
    if (decision.action === 'already_live')
      // The receipt is the creation of the escrow this row already tracks (checked above).
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
    // The program id comes from the ref; never let a (vanishingly unlikely) id collision
    // overwrite another program, which would mix two campaigns' entries and awards.
    const [taken] = await db<{ id: string }[]>`
      SELECT id FROM programs WHERE id = ${file.id}`;
    if (taken) {
      console.error(
        `[sponsor] program id ${file.id} for ${ref} is already taken; not publishing (escrow ${escrow}, tx ${tx}).`,
      );
      throw new SponsorError(
        "This campaign's id clashes with an existing program, so it wasn't published. " +
          'Your deposit is safe in escrow; contact EarnKit to sort it out.',
      );
    }
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

const SCORE_MAX_AGE_MS = 6 * 3_600_000;

type EntryRow = {
  id: number;
  name: string;
  live_url: string | null;
  repo_url: string | null;
  payout_wallet: string;
  contracts: string[];
  score: number | null;
  scored_at: Date | null;
};

/** Entries with a payout wallet for `programId`. `db` reuses a caller's transaction, if any. */
async function entriesOf(
  programId: string,
  db: postgres.Sql | postgres.TransactionSql = sql(),
) {
  return db<EntryRow[]>`
    SELECT id, name, live_url, repo_url, payout_wallet, contracts, score, scored_at FROM projects
    WHERE program_id = ${programId} AND payout_wallet IS NOT NULL ORDER BY submitted_at`;
}

/** Re-scores entries with Base contracts when the last score is over 6 hours old (chain 8453 only). */
async function refreshScores(row: SponsorRow, entries: EntryRow[]) {
  if (row.chain_id !== 8453) return;
  const from = new Date(row.draft.starts_at ?? row.created_at);
  const until = new Date(Math.min(Date.now(), Date.parse(row.draft.ends_at)));
  for (const e of entries) {
    if (e.contracts.length === 0) continue;
    if (e.scored_at && Date.now() - e.scored_at.getTime() < SCORE_MAX_AGE_MS)
      continue;
    const r = await scoreEntry(e.contracts, from, until);
    await sql()`UPDATE projects SET score = ${r.score}, scored_at = now() WHERE id = ${e.id}`;
    e.score = r.score;
  }
}

/** Whether `installationId` can award `row` right now. Pure; exported for tests. */
export function assertCanAward(
  row: Pick<SponsorRow, 'state' | 'installation_id'> & {
    draft: { ends_at: string };
  },
  installationId: number,
  now: Date,
) {
  if (row.installation_id !== installationId)
    throw new SponsorError(
      'Only the agent that created this campaign can award it.',
    );
  if (row.state !== 'live')
    throw new SponsorError(`This campaign is ${row.state}.`);
  if (now.getTime() < Date.parse(row.draft.ends_at))
    throw new SponsorError(
      `Awards open after the campaign ends (${formatDeadline(row.draft.ends_at)}).`,
    );
}

export async function sponsorStatus(ref: string, installationId: number) {
  const row = await loadCampaign(ref);
  const units = parseUnits(row.amount, row.token_decimals);
  const prize = formatUnits(splitUnits(units).prize, row.token_decimals);
  const base = {
    state: row.state,
    title: row.draft.title,
    pool: `${row.amount} ${row.token_symbol}`,
    prize: `${prize} ${row.token_symbol}`,
    ends_at: row.draft.ends_at,
  };
  if (row.state === 'draft')
    return { ...base, fund_url: `${baseUrl()}/fund/${ref}`, entries: [] };
  if (!row.program_id) return { ...base, entries: [] };
  const entries = await entriesOf(row.program_id);
  let scoresNote: string | undefined;
  if (row.installation_id === installationId) {
    try {
      await refreshScores(row, entries);
    } catch (err) {
      // A scoring RPC failure must not fail the whole status call: fall back to the last stored
      // scores (already on `entries`, since `refreshScores` mutates in place only on success).
      console.error('[sponsor] rescoring failed:', err);
      scoresNote =
        'Scores could not be refreshed just now; showing the last known scores.';
    }
  }
  return {
    ...base,
    campaign_url: `${baseUrl()}/campaigns/${row.program_id}`,
    ...(row.award_plan &&
      row.state === 'live' && { award_url: `${baseUrl()}/award/${ref}` }),
    ...(scoresNote && { scores_note: scoresNote }),
    entries: entries.map((e) => ({
      entry_id: e.id,
      name: e.name,
      live_url: e.live_url,
      repo_url: e.repo_url,
      score: e.score,
    })),
  };
}

export async function prepareAward(
  ref: string,
  installationId: number,
  winners: z.infer<typeof AwardWinner>[],
) {
  const row = await loadCampaign(ref);
  assertCanAward(row, installationId, new Date());
  const entries = await entriesOf(row.program_id!);
  const { prize } = splitUnits(parseUnits(row.amount, row.token_decimals));
  const { wallets, amountsUnits, plan } = planAward({
    winners,
    entries,
    prizeUnits: prize,
    decimals: row.token_decimals,
  });
  // Conditional on state and ownership so a plan written while a confirm is in flight (or after
  // the campaign stopped being this installation's live campaign) can't overwrite the plan that
  // was actually awarded — see assertCanAward's unlocked read above.
  const res =
    await sql()`UPDATE sponsor_campaigns SET award_plan = ${sql().json(plan as never)}
    WHERE ref = ${ref} AND state = 'live' AND installation_id = ${installationId}`;
  if (res.count === 0)
    throw new SponsorError('This campaign changed; check status again.');
  return {
    award_url: `${baseUrl()}/award/${ref}`,
    transaction: awardTx(
      row.escrow_address as `0x${string}`,
      wallets,
      amountsUnits,
    ),
    plan,
  };
}

/**
 * Records an onchain award against the stored plan. Idempotent, and race-safe under concurrent
 * confirms for the same ref, following `confirmFunding`'s pattern: the receipt is fetched before
 * opening the transaction (a network round-trip must not run while holding the row lock), then
 * the row is locked (`FOR UPDATE`) for the duration of the award, so a second confirm that arrives
 * while the first is still running waits, then sees the row already `awarded` and returns the same
 * result rather than recording twice.
 */
export async function confirmAward(
  ref: string,
  tx: `0x${string}`,
  fetched?: TransactionReceipt,
) {
  const receipt =
    fetched ?? (await escrowClient().getTransactionReceipt({ hash: tx }));

  return sql().begin(async (db) => {
    const [row] = await db<SponsorRow[]>`
      SELECT * FROM sponsor_campaigns WHERE ref = ${ref} FOR UPDATE`;
    if (!row) throw new NotFoundError(`No sponsor campaign "${ref}".`);
    if (row.state === 'awarded') return { paid: row.award_plan?.length ?? 0 };
    if (row.state !== 'live' || !row.escrow_address)
      throw new SponsorError('This campaign is not live.');

    if (receipt.status !== 'success')
      throw new SponsorError('That transaction failed onchain.');
    const ev = readAwarded(receipt, row.escrow_address);
    if (!ev)
      throw new SponsorError("That transaction isn't this campaign's award.");

    let matched: { entry_id: number; amount: string; reason: string }[];
    let offPlan:
      | { wallet: string; amount: string; entry_id: number | null }[]
      | null = null;
    try {
      matched = matchAwardToPlan(
        row.award_plan ?? [],
        ev.winners,
        ev.amounts,
        row.token_decimals,
      );
    } catch {
      // Paid outside EarnKit's plan (e.g. straight to the contract): record what happened onchain
      // and flag any winner that isn't an entry's payout wallet. The leaderboard shows these publicly.
      const entries = await entriesOf(row.program_id!, db);
      ({ offPlan, matched } = mapOffPlanAward(
        entries,
        ev.winners,
        ev.amounts,
        row.token_decimals,
      ));
    }

    for (const m of matched) {
      await db`UPDATE projects SET prize_tx = ${tx}, prize_paid_at = now(), prize_amount = ${m.amount},
        prize_reason = ${m.reason} WHERE id = ${m.entry_id}`;
    }
    await db`UPDATE sponsor_campaigns SET state = 'awarded', award_tx = ${tx}, awarded_at = now(),
      award_onchain = ${offPlan ? db.json(offPlan as never) : null} WHERE ref = ${ref}`;
    await db`UPDATE programs SET status = 'closed' WHERE id = ${row.program_id}`;

    return {
      paid: matched.length,
      ...(offPlan && {
        flagged: offPlan.filter((o) => o.entry_id === null).length,
      }),
    };
  });
}
