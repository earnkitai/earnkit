/**
 * v2.7 §4 fix round 1 (Important #2): every human-facing string `app/campaigns/[slug]/page.tsx`
 * renders, as pure functions/constants, so `copy-review.test.ts` can scan them without a database
 * or a React render. The page imports these directly; this file is the single source for its copy.
 */

/** The eyebrow above the title. `sponsorLabelText` is sponsor-identity.ts's `sponsorLabel(identity)`. */
export const campaignEyebrow = (isSponsor: boolean, sponsorLabelText: string) =>
  isSponsor ? `${sponsorLabelText} · agents only` : 'EarnKit campaign · agents only';

/** The prize line's end: "closed" once the deadline has passed, else "closes <date>". */
export const closesText = (ended: boolean, deadlineText: string) => (ended ? 'closed' : `closes ${deadlineText}`);

/**
 * The sponsor disclosure paragraph, split around the "view onchain" link: `prefix` leads into the
 * link, `suffix` follows it.
 */
export function sponsorDisclosureParts(
  sponsorName: string,
  identity: { verified: boolean; host: string | null },
  criteria: string,
): { prefix: string; suffix: string } {
  const verified = identity.verified ? ` (verified ${identity.host})` : ', not verified by EarnKit';
  return {
    prefix: `By “${sponsorName}”${verified}. Pool held in escrow: `,
    suffix: `. The sponsor picks winners: ${criteria}`,
  };
}

/** The non-sponsor (EarnKit) campaign's "how it works" paragraph. */
export const earnkitCampaignBlurb = (prizeEachUsd: string, winners: number, payoutDeadlineText: string, minScore: number) =>
  `${prizeEachUsd} each to the top ${winners}, paid automatically on Base by ` +
  `${payoutDeadlineText} after a 48-hour public review. Ranked by unique ` +
  `users of each project's contracts; at least ${minScore} to be eligible. Enter through ` +
  `your agent: ask it “What can I earn?” with EarnKit connected (earnkit.com/mcp).`;

export const PRIZE_WALLET_PREFIX = 'Prize wallet ';
export const PRIZE_WALLET_UNSET = 'Prize wallet: not set up yet.';

/** The text after the prize-wallet link: " holds <balance> <symbol>.". */
export const fundsHoldsSuffix = (balance: string, symbol: string) =>
  ` holds ${Number(balance).toLocaleString('en-US')} ${symbol}.`;

export const LEADERBOARD_HEADING = 'Leaderboard';
export const ENTRIES_HEADING = 'Entries';
export const NO_ENTRIES_TEXT = 'No entries yet.';
export const OFF_PLAN_HEADING = "Paid to wallets that aren't entries:";
/** An off-plan award's line: "<wallet>: <amount> <symbol>". */
export const offPlanLine = (wallet: string, amount: string, symbol: string) => `${wallet}: ${amount} ${symbol}`;

export const REVIEW_HEADING_REVIEW = 'In review';
export const REVIEW_HEADING_PAID = 'Winners';
export const REVIEW_HEADING_PAYING = 'Paying winners';

/** The review-window note, shown while a round's top entries are public before payout. */
export const reviewUntilText = (deadlineText: string) =>
  `Public until ${deadlineText}; then the prizes are paid automatically. ` +
  'Farmed or wash activity removes an entry, and the next one moves up.';

export const NO_MINIMUM_TEXT = 'No entry reached the minimum.';
export const REVIEW_FOOTNOTE = 'Users: wallets counted for the entry. Shared: those also counted for another entry.';
export const CAPPED_READ_SUFFIX = ' Capped read: a data read hit its limit, so the count may be low; it still pays.';

/** A vetoed entry's line in the review section: "Removed: <name> (<reason>)". */
export const removedLine = (name: string, reason: string | null) => `Removed: ${name} (${reason})`;
