import { formatUnits, parseUnits } from 'viem';
import { z } from 'zod';
import { formatDeadline } from './dates';
import { formatExact } from './format-units';
import { CHAINS } from './match';
import type { ProgramFile } from './program-file';
import type { TokenInfo } from './escrow';

/**
 * Pure rules for sponsor campaigns (v2.1): what a sponsor may create, how the pool splits, the
 * program builders see, and how an award maps to entries. No DB or chain access here.
 */

export class SponsorError extends Error {}

const httpsUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'an http(s) link');

export const DraftInput = z
  .object({
    sponsor_name: z.string().trim().min(1).max(60),
    sponsor_url: httpsUrl.optional(),
    title: z.string().trim().min(5).max(80),
    theme: z.string().trim().min(20).max(1000),
    criteria: z.string().trim().min(10).max(1000),
    chains: z.array(z.enum(CHAINS)).min(1).max(CHAINS.length),
    token: z.string().trim().min(1).max(10),
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'a number like "5000" or "100.5"'),
    winners: z.number().int().min(1).max(50),
    existing_work: z
      .enum(['allowed', 'new_work_only'])
      .default('new_work_only'),
    starts_at: z.string().datetime({ offset: true }).optional(),
    ends_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type Draft = z.infer<typeof DraftInput>;

const DAY = 86_400_000;

/**
 * Parses a decimal amount string into token units, rejecting anything with more fraction digits
 * than the token allows instead of letting viem's `parseUnits` silently round it away. `field`
 * names the bad input in the thrown `SponsorError`; `symbol` is included in the message when
 * known.
 */
export function toUnits(
  field: string,
  value: string,
  decimals: number,
  symbol?: string,
): bigint {
  const places = value.split('.')[1]?.length ?? 0;
  if (places > decimals)
    throw new SponsorError(
      symbol
        ? `${field}: ${symbol} has ${decimals} decimals; "${value}" has ${places}.`
        : `${field}: amounts have at most ${decimals} decimals; "${value}" has ${places}.`,
    );
  return parseUnits(value, decimals);
}

export function checkDraft(
  d: Draft,
  token: TokenInfo | null,
  cap: bigint,
  now: Date,
) {
  if (!token)
    throw new SponsorError(
      `token: "${d.token}" isn't allowed. Use USDC or an allowlisted token.`,
    );
  const amountUnits = toUnits('amount', d.amount, token.decimals, token.symbol);
  if (amountUnits <= 0n) throw new SponsorError('amount: must be more than 0.');
  if (amountUnits > cap)
    throw new SponsorError(
      `amount: over the current cap of ${formatUnits(cap, token.decimals)} ${token.symbol} per campaign.`,
    );
  const ends = Date.parse(d.ends_at);
  if (ends < now.getTime() + 3 * DAY || ends > now.getTime() + 90 * DAY)
    throw new SponsorError(
      'ends_at: the campaign must end 3 to 90 days from now.',
    );
  if (d.starts_at && Date.parse(d.starts_at) >= ends)
    throw new SponsorError('starts_at: must be before ends_at.');
  return { amountUnits };
}

/** 10% fee (rounded down), the rest is the prize. Mirrors EarnKitCampaign.initialize. */
export const splitUnits = (amountUnits: bigint) => {
  const fee = amountUnits / 10n;
  return { prize: amountUnits - fee, fee };
};

const fmt = (n: string) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: 18 });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** The program builders see once the campaign is funded. */
export function sponsorProgramFile(a: {
  ref: string;
  draft: Draft;
  token: TokenInfo;
  amountUnits: bigint;
  chainId: number;
  escrow: string;
  baseUrl: string;
  now: Date;
}): ProgramFile {
  const { draft: d, token } = a;
  // 64 bits of the random ref: collisions are negligible, and confirmFunding still refuses to
  // publish over an existing program id rather than overwrite it.
  const id = `sponsor-${a.ref.slice(2, 18)}`;
  const pool = formatUnits(a.amountUnits, token.decimals);
  const prizeTotal = formatUnits(
    splitUnits(a.amountUnits).prize,
    token.decimals,
  );
  return {
    id,
    organizer: d.sponsor_name,
    title: d.title,
    description: d.theme,
    source_url: `${a.baseUrl}/campaigns/${id}`,
    submission_url: `${a.baseUrl}/mcp`,
    reward: `${fmt(pool)} ${token.symbol} pool in escrow (${fmt(prizeTotal)} to winners)`,
    summary: `by ${d.sponsor_name} · ${fmt(pool)} ${token.symbol} pool in escrow · closes ${day(d.ends_at)}`,
    verified_at: a.now.toISOString().slice(0, 10),
    starts_at: d.starts_at ?? a.now.toISOString(),
    ends_at: d.ends_at,
    status: 'active',
    existing_work: d.existing_work,
    chains: d.chains,
    setup: ['a public GitHub repo', 'a host for a live link'],
    each_time: [],
    rules: [
      `What to build: ${d.theme}`,
      `How winners are chosen: ${d.criteria}`,
      `${d.sponsor_name} picks the winners after the deadline; EarnKit shows each entry's onchain score as a guide. Picks and reasons are public.`,
      `Prize: ${fmt(prizeTotal)} ${token.symbol} shared by about ${d.winners} winner(s), paid from escrow to the payout wallet you submit, on Base.`,
      d.existing_work === 'new_work_only'
        ? 'Only work done during the campaign counts.'
        : 'Existing projects can enter.',
      'Enter through EarnKit (record_submission). No external site.',
    ],
    submission_requirements: [
      {
        key: 'project_name',
        label: 'Project name',
        type: 'text',
        required: true,
        project_field: 'name',
        from: 'project',
      },
      {
        key: 'description',
        label: 'What it does and who uses it',
        type: 'text',
        required: true,
        project_field: 'description',
        from: 'project',
      },
      {
        key: 'repo_url',
        label: 'Public repo',
        type: 'url',
        required: true,
        project_field: 'repo_url',
        from: 'project',
      },
      {
        key: 'live_url',
        label: 'Live link',
        type: 'url',
        required: true,
        project_field: 'live_url',
        from: 'project',
      },
      {
        key: 'contracts',
        label: 'Base contract addresses to score (optional)',
        type: 'text',
        required: false,
        description:
          'Up to 5 Base mainnet contracts, comma-separated, deployed during the campaign.',
        from: 'project',
      },
      {
        key: 'payout_wallet',
        label: 'Payout wallet',
        type: 'text',
        required: true,
        description:
          "Your agent's wallet on Base (0x…) that receives the prize if you win.",
        from: 'project',
      },
    ],
    campaign: {
      kind: 'sponsor',
      prize: {
        token: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        chain_id: a.chainId,
      },
      pool,
      prize_total: prizeTotal,
      winners: d.winners,
      metric: 'unique_wallets',
      sponsor: {
        name: d.sponsor_name,
        ...(d.sponsor_url && { url: d.sponsor_url }),
      },
      criteria: d.criteria,
      escrow: a.escrow,
      ref: a.ref,
    },
    tracks: [],
    starters: [],
  };
}

export type PlanItem = {
  entry_id: number;
  wallet: string;
  amount: string;
  reason: string;
};

export const AwardWinner = z
  .object({
    entry_id: z.number().int().positive(),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    reason: z.string().trim().min(3).max(280),
  })
  .strict();

/** Checks the sponsor's picks and returns what the award transaction must contain. */
export function planAward(a: {
  winners: z.infer<typeof AwardWinner>[];
  entries: { id: number; payout_wallet: string }[];
  prizeUnits: bigint;
  decimals: number;
}) {
  const seen = new Set<number>();
  const items = a.winners.map((w) => {
    if (seen.has(w.entry_id))
      throw new SponsorError(
        `winners: entry ${w.entry_id} is listed more than once.`,
      );
    seen.add(w.entry_id);
    const e = a.entries.find((x) => x.id === w.entry_id);
    if (!e)
      throw new SponsorError(
        `winners: ${w.entry_id} isn't an entry in this campaign.`,
      );
    const units = toUnits('winners', w.amount, a.decimals);
    return { entry_id: e.id, wallet: e.payout_wallet, units, reason: w.reason };
  });
  if (items.some((p) => p.units <= 0n))
    throw new SponsorError('winners: every amount must be more than 0.');
  const amountsUnits = items.map((p) => p.units);
  const total = amountsUnits.reduce((s, u) => s + u, 0n);
  if (total !== a.prizeUnits)
    throw new SponsorError(
      `winners: amounts must add up to ${formatUnits(a.prizeUnits, a.decimals)} exactly (got ${formatUnits(total, a.decimals)}).`,
    );
  // Normalized to the exact onchain value, so the stored/public record matches what gets paid.
  const plan: PlanItem[] = items.map((p) => ({
    entry_id: p.entry_id,
    wallet: p.wallet,
    amount: formatUnits(p.units, a.decimals),
    reason: p.reason,
  }));
  return { wallets: plan.map((p) => p.wallet), amountsUnits, plan };
}

/**
 * Maps an onchain award that doesn't match the stored plan (e.g. the sponsor called the contract
 * directly) back to entries, by payout wallet. A repeated onchain wallet is given to a distinct
 * entry that shares it, in entry order, so it isn't double-counted against one entry. A winner
 * that isn't any entry's payout wallet is flagged with `entry_id: null` and left out of `matched`.
 * Pure; exported for tests.
 */
export function mapOffPlanAward(
  entries: { id: number; payout_wallet: string }[],
  winners: string[],
  amounts: bigint[],
  decimals: number,
): {
  offPlan: { wallet: string; amount: string; entry_id: number | null }[];
  matched: { entry_id: number; amount: string; reason: string }[];
} {
  const used = new Set<number>();
  const offPlan = winners.map((w, i) => {
    const e = entries.find(
      (x) =>
        !used.has(x.id) && x.payout_wallet.toLowerCase() === w.toLowerCase(),
    );
    if (e) used.add(e.id);
    return {
      wallet: w.toLowerCase(),
      amount: formatUnits(amounts[i], decimals),
      entry_id: e?.id ?? null,
    };
  });
  const matched = offPlan
    .filter((o): o is typeof o & { entry_id: number } => o.entry_id !== null)
    .map((o) => ({
      entry_id: o.entry_id,
      amount: o.amount,
      reason: 'Paid by the sponsor (no reason given)',
    }));
  return { offPlan, matched };
}

/** Maps the onchain Awarded event back to entries, in plan order. Throws if they differ. */
export function matchAwardToPlan(
  plan: PlanItem[],
  winners: string[],
  amounts: bigint[],
  decimals: number,
) {
  const same =
    plan.length === winners.length &&
    plan.every(
      (p, i) =>
        p.wallet.toLowerCase() === winners[i].toLowerCase() &&
        parseUnits(p.amount, decimals) === amounts[i],
    );
  if (!same)
    throw new SponsorError(
      'The onchain award differs from the plan EarnKit prepared.',
    );
  return plan.map((p) => ({
    entry_id: p.entry_id,
    amount: p.amount,
    reason: p.reason,
  }));
}

/*
 * What the sponsor's agent shows the sponsor (`show_to_sponsor`) and does next (`next_step`).
 * Built here, pure, so every reply reads the same and is tested. Amounts are exact (formatExact).
 */

type Tok = { symbol: string; decimals: number };
const amt = (units: bigint, t: Tok) =>
  `${formatExact(units, t.decimals)} ${t.symbol}`;
const entriesText = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** create: what was drafted, the split, and how to fund it. */
export function createReply(a: {
  title: string;
  poolUnits: bigint;
  token: Tok;
  winners: number;
  endsAt: string;
  fundUrl: string;
}) {
  const { prize, fee } = splitUnits(a.poolUnits);
  return {
    show_to_sponsor:
      `Campaign drafted: ${a.title}.\n` +
      `Pool: ${amt(a.poolUnits, a.token)}. Winners get ${amt(prize, a.token)}; EarnKit's 10% ` +
      `(${amt(fee, a.token)}) is paid only when prizes are paid, and you get everything back if nobody qualifies.\n` +
      `Winners: ${a.winners} planned. Deadline: ${formatDeadline(a.endsAt)}.\n` +
      `Fund it here: ${a.fundUrl}`,
    next_step:
      `Fund it: the sponsor opens ${a.fundUrl} and deposits from their wallet, or, if you hold that ` +
      'wallet, send the two `transactions` in order (approve, then createCampaign). Then call ' +
      'sponsor_campaign with action=status, ref, and tx (the createCampaign hash). An unfunded ' +
      'draft expires after 7 days, or 10 minutes before its deadline.',
  };
}

export type StatusFacts = {
  state: 'draft' | 'live' | 'awarded' | 'refunded' | 'expired' | 'taken_down';
  title: string;
  /** What winners share, formatted ("90 USDC"). */
  prize: string;
  endsAt: string;
  now: Date;
  fundUrl: string;
  /** draft: when it stops being fundable. */
  expiresAt: Date | null;
  /** expired: why (see sponsor.ts expiredText). */
  expiredText: string | null;
  entries: number;
  paid: number;
  escrow: string | null;
  escrowUrl: string | null;
  campaignUrl: string | null;
  /** live with a prepared award plan. */
  awardUrl: string | null;
};

/** status: one line per state, plus the next step where there is one. */
export function statusReply(s: StatusFacts): {
  show_to_sponsor: string;
  next_step?: string;
} {
  const deadline = formatDeadline(s.endsAt);
  switch (s.state) {
    case 'draft':
      return {
        show_to_sponsor:
          `${s.title} is a draft, not funded yet. Deposit the pool at ${s.fundUrl}` +
          (s.expiresAt
            ? ` before ${formatDeadline(s.expiresAt)}, when the draft expires.`
            : '.'),
        next_step:
          `Fund it: the sponsor deposits at ${s.fundUrl}, or you send the two transactions from ` +
          'create if you hold their wallet. Then call status with ref and tx (the createCampaign hash).',
      };
    case 'expired':
      return {
        show_to_sponsor:
          s.expiredText ?? `${s.title} expired before it was funded.`,
        next_step: 'Create a new campaign with action=create.',
      };
    case 'awarded':
      return {
        show_to_sponsor: `${s.title} is awarded: ${s.paid} winner${s.paid === 1 ? '' : 's'} paid.${s.campaignUrl ? ` ${s.campaignUrl}` : ''}`,
      };
    case 'refunded':
      return {
        show_to_sponsor: `${s.title} ended with no winners; the whole pool was refunded to the sponsor's wallet.`,
      };
    case 'taken_down':
      return {
        show_to_sponsor: `${s.title} was removed by EarnKit; the whole pool was refunded to the sponsor's wallet.`,
      };
    case 'live': {
      const escrow = s.escrow
        ? ` Pool in escrow ${s.escrow}${s.escrowUrl && s.escrowUrl !== s.escrow ? ` (${s.escrowUrl})` : ''}.`
        : '';
      const page = s.campaignUrl ? ` ${s.campaignUrl}` : '';
      if (s.now.getTime() < Date.parse(s.endsAt))
        return {
          show_to_sponsor: `${s.title} is live: ${entriesText(s.entries)}; winners picked after ${deadline}.${escrow}${page}`,
          next_step: `Nothing to do until ${deadline}. Then call award with the winners.`,
        };
      return {
        show_to_sponsor: `${s.title} has ended with ${entriesText(s.entries)}; time to pick winners.${escrow}${page}`,
        next_step: s.awardUrl
          ? `The sponsor signs the prepared award at ${s.awardUrl} (or you send its transaction from the wallet that funded the campaign). Then call status with ref and tx.`
          : s.entries === 0
            ? 'Nobody entered. Contact EarnKit to refund the pool (fee included).'
            : `Call award with winners [{entry_id, amount, reason}] adding up to ${s.prize} exactly. If the sponsor doesn't award within 7 days of the deadline, EarnKit pays the top entries.`,
      };
    }
  }
}

/** award: who gets what and why, the fee, and where to sign. */
export function awardReply(a: {
  winners: { entry_id: number; name: string; amount: string; reason: string }[];
  token: Tok;
  feeUnits: bigint;
  awardUrl: string;
}) {
  return {
    show_to_sponsor:
      'Award ready:\n' +
      a.winners
        .map(
          (w) =>
            `- ${w.name} (entry #${w.entry_id}): ${amt(parseUnits(w.amount, a.token.decimals), a.token)} — ${w.reason}`,
        )
        .join('\n') +
      `\nEarnKit's 10% (${amt(a.feeUnits, a.token)}) is released with this payout.\n` +
      `Sign it here: ${a.awardUrl}`,
    next_step:
      `The sponsor signs at ${a.awardUrl} with the wallet that funded the campaign (or, if you hold ` +
      'that wallet, send `transaction`). Then call status with ref and tx (the award hash).',
  };
}
