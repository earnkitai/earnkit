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
