import { formatUnits, parseUnits } from 'viem';
import { z } from 'zod';
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
  const places = d.amount.split('.')[1]?.length ?? 0;
  if (places > token.decimals)
    throw new SponsorError(
      `amount: ${token.symbol} has ${token.decimals} decimals; "${d.amount}" has ${places}.`,
    );
  const amountUnits = parseUnits(d.amount, token.decimals);
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
  const id = `sponsor-${a.ref.slice(2, 10)}`;
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
  const plan: PlanItem[] = a.winners.map((w) => {
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
    return {
      entry_id: e.id,
      wallet: e.payout_wallet,
      amount: w.amount,
      reason: w.reason,
    };
  });
  const amountsUnits = plan.map((p) => parseUnits(p.amount, a.decimals));
  if (amountsUnits.some((u) => u <= 0n))
    throw new SponsorError('winners: every amount must be more than 0.');
  const total = amountsUnits.reduce((s, u) => s + u, 0n);
  if (total !== a.prizeUnits)
    throw new SponsorError(
      `winners: amounts must add up to ${formatUnits(a.prizeUnits, a.decimals)} exactly (got ${formatUnits(total, a.decimals)}).`,
    );
  return { wallets: plan.map((p) => p.wallet), amountsUnits, plan };
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
