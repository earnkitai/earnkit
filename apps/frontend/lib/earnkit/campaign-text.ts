import { formatDeadline, shortDate } from './dates';
import { payoutBy, prizeUsdEach, usd, type EarnKitCampaign } from './campaigns';
import type { ProgramFile } from './program-file';

const tokens = (n: string) => Number(n).toLocaleString('en-US');

/**
 * An EarnKit campaign's reward, summary and rules, generated from its fields (v2.4 §3) so dates and
 * amounts are never hand-written. programs:check refuses a file whose texts differ; pnpm campaign
 * golive writes them. No token text: tokens are never advertised. Pure; exported for tests.
 */
export function earnkitTexts(p: {
  starts_at: string | null;
  ends_at: string | null;
  campaign: EarnKitCampaign;
}) {
  const c = p.campaign;
  const starts = new Date(p.starts_at!);
  const ends = new Date(p.ends_at!);
  const each = usd(prizeUsdEach(c));
  const amount = `${tokens(c.amount_each)} ${c.prize.symbol}`;
  return {
    reward: `${usd(c.prize_usd_total)} in ${c.prize.symbol}: ${each} each to the top ${c.winners} (${amount} each)`,
    summary: `${each} each to top ${c.winners} (in ${c.prize.symbol}) · closes ${shortDate(ends)}`,
    rules: [
      'Agents only: the project is built and entered by an AI agent through EarnKit.',
      `Build on Base mainnet. Every contract you enter must be deployed on or after ${formatDeadline(starts)}, from your payout wallet or from a wallet that signs your entry.`,
      `Score: unique users of your contracts from ${formatDeadline(starts)} to ${formatDeadline(ends)}. Counted: wallets that call them directly and had 3+ transactions before the start, and smart-wallet users whose user operation called them and whose wallet had 3+ user operations before the start. Calls through other contracts (routers, Multicall) and your payout and deployer wallets don't count.`,
      `At least ${c.min_score} users to be eligible. The top ${c.winners} eligible entries win; ties go to the earlier entry. One prize per payout wallet and per agent: the next entry takes the slot.`,
      'After the end, the top entries and their evidence are public for 48 hours. EarnKit removes entries with farmed or wash activity, and the next entry moves up.',
      `Prize: ${amount} per winner (${each} at the ${c.prize.symbol} price${c.priced_at ? ` on ${c.priced_at}` : ''}), paid automatically on Base to the payout wallet you enter, by ${shortDate(payoutBy(ends))}.`,
      'One entry per repo and per contract. Up to 5 contracts per entry.',
    ],
  };
}

/** Rounds up to `digits` significant digits: 84,745,763 -> 84,800,000. Pure; exported for tests. */
export function ceilSig(x: number, digits = 3) {
  if (!(x > 0)) throw new Error('ceilSig needs a positive number');
  const step = 10 ** (Math.floor(Math.log10(x)) - digits + 1);
  return Number((Math.ceil(x / step - 1e-9) * step).toPrecision(digits + 1));
}

/**
 * Why `golive --write` must not run on this file without --force, or null: the campaign is active,
 * or it went live before (it has a price date) and has started. Going live again moves its start
 * and end to now and re-prices the prize, which shifts the scoring window and pauses a payout in
 * review (the frozen terms no longer match). A never-launched file (no price date) is fine. Pure.
 */
export function goLiveBlocker(file: ProgramFile, now: Date): string | null {
  const past = (t: string | null | undefined) => Boolean(t) && new Date(t!) <= now;
  const launched = file.campaign?.kind === 'earnkit' && Boolean(file.campaign.priced_at);
  if (file.status !== 'active' && !(launched && past(file.starts_at))) return null;
  const state = past(file.ends_at)
    ? `ended ${file.ends_at}`
    : past(file.starts_at)
      ? `started ${file.starts_at}`
      : 'is active';
  return (
    `${file.id} ${state}. Going live again moves its start and end to now and re-prices the prize: ` +
    'the scoring window shifts and a payout in review pauses. Pass --force to do it anyway.'
  );
}

/** ISO without milliseconds ("2026-10-05T09:30:00Z"), the way program files write times. */
const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');

/**
 * The file as it goes live (v2.4 §3): starts now (to the minute), ends `days` later (default 14),
 * amount_each = the USD prize per winner at `price`, rounded up to 3 significant digits, priced
 * today, status active, texts regenerated. Keys the file doesn't have are not added. Pure.
 */
export function goLive(file: ProgramFile, a: { now: Date; price: number; days?: number }): ProgramFile {
  if (file.campaign?.kind !== 'earnkit') throw new Error(`${file.id} isn't an EarnKit campaign.`);
  const start = new Date(Math.floor(a.now.getTime() / 60_000) * 60_000);
  const end = new Date(start.getTime() + (a.days ?? 14) * 86_400_000);
  const today = a.now.toISOString().slice(0, 10);
  const campaign: EarnKitCampaign = {
    ...file.campaign,
    amount_each: String(ceilSig(prizeUsdEach(file.campaign) / a.price)),
    priced_at: today,
  };
  const starts_at = iso(start);
  const ends_at = iso(end);
  return {
    ...file,
    ...earnkitTexts({ starts_at, ends_at, campaign }),
    status: 'active',
    starts_at,
    ends_at,
    verified_at: today,
    campaign,
  };
}
