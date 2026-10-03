/**
 * Sponsor-facing text and the draft deadline margin. No imports, so the fund page's client
 * component can use it too (sponsor.ts re-exports it for the server side).
 */

/** createCampaign reverts once endsAt has passed; a deposit needs some time to land first. */
export const DEADLINE_MARGIN_MS = 10 * 60_000;

/** For a sponsor who may have deposited although the draft expired: the deposit still counts. */
export const ALREADY_DEPOSITED =
  'If you already deposited from your bound wallet, your funds are safe in escrow: EarnKit finds the deposit onchain and publishes the campaign (reload in a minute).';

export const DEADLINE_PASSED =
  "This draft's deadline has passed or is less than 10 minutes away. Ask your agent to create a new campaign. " +
  ALREADY_DEPOSITED;

export const DRAFT_EXPIRED =
  'This draft expired (unfunded for 7 days). Ask your agent to create a new campaign. ' +
  ALREADY_DEPOSITED;

/**
 * Fixed copy against the fund_url confidence scam: anyone's agent can create a draft bound to
 * someone else's wallet and send them the link.
 */
export const FUND_WARNING =
  'Only fund a campaign you asked your own agent to create. EarnKit never asks you to fund ' +
  "someone else's campaign, and nobody from EarnKit will send you this link.";

/**
 * What an unfunded draft's /fund page says instead of "by <sponsor> · <label>" (review I1): a draft
 * can bind anyone's wallet, e.g. a brand's published one, so no name or verification shows until the
 * bound wallet itself funds it.
 */
export const UNFUNDED_IDENTITY =
  "Draft: the sponsor's identity is confirmed only after it is funded from the bound wallet.";

export const AWARD_PROVENANCE =
  'These winners were proposed by the agent that created this campaign. Check every winner ' +
  'before signing; this payment is final.';

/**
 * Per winner of an award plan, a red warning or null: the winner is the sponsor's own wallet, or
 * the same wallet is paid more than once. Pure; exported for tests.
 */
export function awardWarnings(
  plan: { wallet: string }[],
  sponsorWallet: string | null,
): (string | null)[] {
  const count = new Map<string, number>();
  for (const p of plan)
    count.set(
      p.wallet.toLowerCase(),
      (count.get(p.wallet.toLowerCase()) ?? 0) + 1,
    );
  return plan.map((p) => {
    const w = p.wallet.toLowerCase();
    if (sponsorWallet && w === sponsorWallet.toLowerCase())
      return 'This winner is your own wallet.';
    if ((count.get(w) ?? 0) > 1)
      return 'This wallet is paid more than once in this award.';
    return null;
  });
}
