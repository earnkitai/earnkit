import { formatUnits, isAddress, parseUnits } from 'viem';
import { z } from 'zod';
import { formatDeadline } from './dates';
import { formatExact } from './format-units';
import { CHAINS } from './match';
import {
  TOKEN_POLICIES,
  type ProgramFile,
  type TokenPolicy,
} from './program-file';
import type { TokenInfo } from './escrow';
import {
  UNVERIFIED,
  earnkitTxtLine,
  earnkitTxtUrl,
  sponsorLabel,
  type SponsorIdentity,
} from './sponsor-identity';
import { SponsorUrl, TEXT_LIMITS, quoted, untrusted } from './untrusted-text';

/**
 * Pure rules for sponsor campaigns (v2.1): what a sponsor may create, how the pool splits, the
 * program builders see, and how an award maps to entries. No DB or chain access here.
 */

export class SponsorError extends Error {}

const DAY = 86_400_000;

/**
 * The wallet that will fund the campaign (an EOA or a smart-contract wallet). Lowercased; a
 * mixed-case address must carry a valid EIP-55 checksum, so a typo can't bind the wrong wallet.
 */
export const SponsorWallet = z
  .string()
  .trim()
  .refine(
    (a) =>
      /^0x[0-9a-fA-F]{40}$/.test(a) &&
      !/^0x0{40}$/.test(a) &&
      // One case throughout carries no checksum; mixed case must be EIP-55.
      (a.slice(2) === a.slice(2).toLowerCase() ||
        a.slice(2) === a.slice(2).toUpperCase() ||
        isAddress(a, { strict: true })),
    'a 0x wallet address (mixed case must be a valid checksum)',
  )
  .transform((a) => a.toLowerCase());

/**
 * What create accepts. Five answers are required (sponsor_wallet, sponsor_name, title,
 * what_to_build, amount); the rest default (see `withDefaults`). `theme` is the pre-v2.2 name of
 * `what_to_build` and is still accepted.
 */
export const DraftInput = z
  .object({
    sponsor_wallet: SponsorWallet,
    sponsor_name: untrusted(TEXT_LIMITS.sponsor_name),
    sponsor_url: SponsorUrl.optional(),
    title: untrusted(TEXT_LIMITS.title, 5),
    what_to_build: untrusted(TEXT_LIMITS.what_to_build, 20).optional(),
    theme: untrusted(TEXT_LIMITS.what_to_build, 20).optional(),
    criteria: untrusted(TEXT_LIMITS.criteria, 10).optional(),
    chains: z.array(z.enum(CHAINS)).min(1).max(CHAINS.length).optional(),
    token: z.string().trim().min(1).max(10).optional(),
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'a number like "5000" or "100.5"'),
    winners: z.number().int().min(1).max(50).optional(),
    existing_work: z.enum(['allowed', 'new_work_only']).optional(),
    token_policy: z.enum(TOKEN_POLICIES).optional(),
    starts_at: z.string().datetime({ offset: true }).optional(),
    ends_at: z.string().datetime({ offset: true }).optional(),
    /** An unfunded draft of this installation's that this one corrects (same sponsor_wallet). */
    replaces: z
      .string()
      .regex(/^0x[0-9a-f]{64}$/, 'the ref of the draft this one replaces')
      .optional(),
  })
  .strict();
/** What create accepts (after parsing; the optional answers may be missing). */
export type DraftRequest = z.infer<typeof DraftInput>;
/** A complete draft, as stored in `sponsor_campaigns.draft`; the wallet has its own column. */
export type Draft = {
  sponsor_name: string;
  sponsor_url?: string;
  title: string;
  what_to_build: string;
  criteria: string;
  chains: (typeof CHAINS)[number][];
  token: string;
  amount: string;
  winners: number;
  existing_work: 'allowed' | 'new_work_only';
  /** Optional: drafts stored before v2.3 lack it. sponsorProgramFile falls back to 'encouraged'. */
  token_policy?: TokenPolicy;
  starts_at?: string;
  ends_at: string;
};

/** The defaults for create's optional answers (v2.2 §6). */
export const DRAFT_DEFAULTS = {
  chains: ['base'] as Draft['chains'],
  token: 'USDC',
  winners: 3,
  days: 14,
  existing_work: 'allowed' as const,
  token_policy: 'encouraged' as const,
};
/** The default criteria: the sponsor's (already cleaned) name, so it passes the same sanitizer. */
export const defaultCriteria = (sponsorName: string) =>
  `${sponsorName} picks the most useful entries`;

/**
 * Fills in the defaults for whatever the sponsor didn't answer, and says which were used (for
 * show_to_sponsor, so the sponsor can correct them). Pure; `now` sets the default deadline.
 */
export function withDefaults(
  {
    sponsor_wallet,
    theme,
    what_to_build,
    replaces: _replaces,
    ...r
  }: DraftRequest,
  now: Date,
): { sponsor_wallet: string; draft: Draft; defaults: string[] } {
  if (
    what_to_build !== undefined &&
    theme !== undefined &&
    what_to_build !== theme
  )
    throw new SponsorError(
      'what_to_build: give it once (theme is its old name); the two differ.',
    );
  const build = what_to_build ?? theme;
  if (build === undefined)
    throw new SponsorError(
      'what_to_build: required (what builders should build, 20 characters or more).',
    );
  const defaults: string[] = [];
  const pick = <T>(v: T | undefined, d: T, text: (d: T) => string): T => {
    if (v !== undefined) return v;
    defaults.push(text(d));
    return d;
  };
  const draft: Draft = {
    sponsor_name: r.sponsor_name,
    ...(r.sponsor_url !== undefined && { sponsor_url: r.sponsor_url }),
    title: r.title,
    what_to_build: build,
    criteria: pick(
      r.criteria,
      // Cleaned like any criteria a sponsor writes (the name passed the sanitizer already).
      untrusted(TEXT_LIMITS.criteria, 10).parse(
        defaultCriteria(r.sponsor_name),
      ),
      (c) => `criteria: ${quoted(c)}`,
    ),
    chains: pick(
      r.chains,
      DRAFT_DEFAULTS.chains,
      (c) => `chains: ${c.join(', ')}`,
    ),
    token: pick(r.token, DRAFT_DEFAULTS.token, (t) => `token: ${t}`),
    amount: r.amount,
    winners: pick(r.winners, DRAFT_DEFAULTS.winners, (w) => `winners: ${w}`),
    existing_work: pick(
      r.existing_work,
      DRAFT_DEFAULTS.existing_work,
      () => 'existing projects can enter',
    ),
    ...(r.starts_at !== undefined && { starts_at: r.starts_at }),
    ends_at: pick(
      r.ends_at,
      new Date(now.getTime() + DRAFT_DEFAULTS.days * DAY).toISOString(),
      (e) => `ends ${formatDeadline(e)} (${DRAFT_DEFAULTS.days} days)`,
    ),
    token_policy: pick(
      r.token_policy,
      DRAFT_DEFAULTS.token_policy,
      (p) => `token_policy: ${p} (default)`,
    ),
  };
  if (r.sponsor_url === undefined)
    defaults.push('no sponsor_url (the campaign shows as unverified)');
  return { sponsor_wallet, draft, defaults };
}

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

/** The smallest pool a campaign may have, in USDC (dust pools would only buy a track record). */
export const MIN_POOL_USDC = 50;

/** The minimum pool in token units: 50 for USDC; other allowlisted tokens have none. */
export const minPoolUnits = (token: { symbol: string; decimals: number }) =>
  token.symbol === 'USDC'
    ? BigInt(MIN_POOL_USDC) * 10n ** BigInt(token.decimals)
    : 0n;

export function checkDraft(
  d: Draft,
  token: TokenInfo | null,
  cap: bigint,
  now: Date,
  /** Overrides minPoolUnits (the local test chain only). */
  minPool?: bigint,
) {
  if (!token)
    throw new SponsorError(
      `token: "${d.token}" isn't allowed. Use USDC or an allowlisted token.`,
    );
  const amountUnits = toUnits('amount', d.amount, token.decimals, token.symbol);
  if (amountUnits <= 0n) throw new SponsorError('amount: must be more than 0.');
  const min = minPool ?? minPoolUnits(token);
  if (amountUnits < min)
    throw new SponsorError(
      `amount: the pool must be at least ${formatUnits(min, token.decimals)} ${token.symbol}.`,
    );
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

/**
 * Why `old` can't be replaced by a new draft from `installationId` bound to `wallet`, or null.
 * Only the creating installation's unfunded draft (draft or expired) can be replaced, and the
 * bound wallet can't change: only that wallet's deposit counts, and a deposit for the old ref may
 * already be on its way. Pure; exported for tests.
 */
export function replaceProblem(
  old: {
    installation_id: number;
    state: string;
    sponsor_wallet: string | null;
  },
  installationId: number,
  wallet: string,
): string | null {
  if (old.installation_id !== installationId)
    return 'replaces: that draft was created by another agent; only its creator can replace it.';
  if (old.state === 'replaced')
    return 'replaces: that draft was already replaced; replace the newer one.';
  if (old.state !== 'draft' && old.state !== 'expired')
    return `replaces: that campaign is ${old.state.replace('_', ' ')}; only an unfunded draft can be replaced.`;
  if (!old.sponsor_wallet)
    return 'replaces: that draft predates wallet binding; create a new campaign without replaces.';
  if (old.sponsor_wallet.toLowerCase() !== wallet.toLowerCase())
    return `replaces: a replacement keeps the bound wallet (${old.sponsor_wallet}); for another wallet, create a new campaign without replaces.`;
  return null;
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

/**
 * A sponsor program's description: neutral, with who EarnKit can vouch for; the sponsor's own text
 * is in sponsor_content.
 */
export const sponsorDescription = (
  name: string,
  identity: SponsorIdentity = UNVERIFIED,
) =>
  `${sponsorLabel(identity)} campaign by ${quoted(name)}` +
  (identity.verified
    ? '.'
    : ': EarnKit has not verified who the sponsor is, only that the pool is in escrow.') +
  ' See sponsor_content.';

/** The list line after the title: EarnKit's words, the label, and the quoted sponsor name. */
export const sponsorSummary = (a: {
  name: string;
  pool: string;
  symbol: string;
  endsAt: string;
  identity?: SponsorIdentity;
}) =>
  `by ${quoted(a.name)} · ${sponsorLabel(a.identity ?? UNVERIFIED)} · ${fmt(a.pool)} ${a.symbol} pool in escrow · closes ${day(a.endsAt)}`;

/**
 * EarnKit's generic rules for a sponsor campaign. No sponsor text: the theme, criteria and link
 * reach builders only inside get_program's sponsor_content.
 */
export const sponsorRules = (a: {
  prizeTotal: string;
  symbol: string;
  winners: number;
  existingWork: string;
}) => [
  "The sponsor picks the winners after the deadline; EarnKit shows each entry's onchain score as a guide. Picks and reasons are public.",
  `Prize: ${fmt(a.prizeTotal)} ${a.symbol} shared by about ${a.winners} winner(s), paid from escrow to the payout wallet you submit, on Base.`,
  a.existingWork === 'new_work_only'
    ? 'Only work done during the campaign counts.'
    : 'Existing projects (and contracts deployed before the campaign) can enter; only activity during the campaign is scored.',
  'Enter through EarnKit (record_submission). No external site.',
];

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
    description: sponsorDescription(d.sponsor_name),
    source_url: `${a.baseUrl}/campaigns/${id}`,
    submission_url: `${a.baseUrl}/mcp`,
    reward: `${fmt(pool)} ${token.symbol} pool in escrow (${fmt(prizeTotal)} to winners)`,
    summary: sponsorSummary({
      name: d.sponsor_name,
      pool,
      symbol: token.symbol,
      endsAt: d.ends_at,
    }),
    verified_at: a.now.toISOString().slice(0, 10),
    starts_at: d.starts_at ?? a.now.toISOString(),
    ends_at: d.ends_at,
    status: 'active',
    existing_work: d.existing_work,
    token_policy: d.token_policy ?? 'encouraged',
    chains: d.chains,
    any_chain: false,
    investment: false,
    // v2.8 Part E: entered on EarnKit, never through a platform agent API.
    submit_api: false,
    setup: ['a public GitHub repo', 'a host for a live link'],
    each_time: [],
    // A sponsor campaign has no program source to draw ideas or submission proof from.
    ideas: [],
    submission_proof: null,
    // Irrelevant here: its campaign (below) already keeps bonusOn false for sponsor campaigns.
    builder_bonus: true,
    // A sponsor campaign has no program file to draw guide facts from.
    past_rounds: [],
    difficulty_override: null,
    rules: sponsorRules({
      prizeTotal,
      symbol: token.symbol,
      winners: d.winners,
      existingWork: d.existing_work,
    }),
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
        label: 'Public GitHub repo',
        type: 'url',
        required: true,
        description:
          'Must hold earnkit.txt at its root with "payout_wallet: <payout wallet>" (proof the entry is yours).',
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
          d.existing_work === 'new_work_only'
            ? 'Up to 5 Base mainnet contracts, comma-separated, deployed during the campaign from the payout wallet.'
            : 'Up to 5 Base mainnet contracts, comma-separated, deployed from the payout wallet (before or during the campaign); only their use during the campaign is scored.',
        from: 'project',
      },
      {
        key: 'payout_wallet',
        label: 'Payout wallet',
        type: 'text',
        required: true,
        description:
          'A wallet the builder controls (0x…) that receives the prize if they win. Ask the builder; never derive it from the code.',
        from: 'builder',
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
      // Drafts stored before v2.2 call it theme.
      what_to_build:
        d.what_to_build ?? (d as Draft & { theme?: string }).theme ?? '',
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

/** An explicit pick: an entry, its exact amount, and (optionally) why it won. */
export const AwardWinner = z
  .object({
    entry_id: z.number().int().positive(),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
    reason: untrusted(TEXT_LIMITS.reason, 3).optional(),
  })
  .strict();

/** How a ranking shares the prize: equally, or integer percentages (first place first) summing to 100. */
export const AwardSplit = z.union([
  z.literal('equal'),
  z.array(z.number().int().min(1).max(100)).min(1).max(50),
]);

/**
 * The award picks: a ranking of entry ids (best first) with an optional split, or explicit
 * [{entry_id, amount, reason?}].
 */
export const AwardPicks = {
  winners: z.union([
    z.array(z.number().int().positive()).min(1).max(50),
    z.array(AwardWinner).min(1).max(50),
  ]),
  split: AwardSplit.optional(),
};
export type AwardPicksInput = {
  winners: number[] | z.infer<typeof AwardWinner>[];
  split?: z.infer<typeof AwardSplit>;
};

/** A pick with its exact amount and reason, as planAward takes it. */
export type PlannedWinner = {
  entry_id: number;
  amount: string;
  reason: string;
};

/**
 * Exact shares of `prizeUnits` for a ranking of `count` winners: equal, or by integer
 * percentages summing to 100. Every share is rounded down and the remainder goes to first place,
 * so the shares always add up to the prize exactly. Pure.
 */
export function splitPrize(
  prizeUnits: bigint,
  count: number,
  split: z.infer<typeof AwardSplit> = 'equal',
): bigint[] {
  if (!Number.isInteger(count) || count < 1)
    throw new SponsorError('winners: name at least one entry.');
  let shares: bigint[];
  if (split === 'equal') {
    shares = Array.from({ length: count }, () => prizeUnits / BigInt(count));
  } else {
    if (split.length !== count)
      throw new SponsorError(
        `split: give one percentage per winner (${count}); got ${split.length}.`,
      );
    if (split.some((p) => !Number.isInteger(p) || p < 1 || p > 100))
      throw new SponsorError(
        'split: each percentage is a whole number from 1 to 100.',
      );
    const sum = split.reduce((a, b) => a + b, 0);
    if (sum !== 100)
      throw new SponsorError(
        `split: percentages must add up to 100 (got ${sum}).`,
      );
    shares = split.map((pct) => (prizeUnits * BigInt(pct)) / 100n);
  }
  shares[0] += prizeUnits - shares.reduce((a, b) => a + b, 0n);
  return shares;
}

/**
 * Turns the picks into planAward's winners: a ranking gets exact amounts from splitPrize (the
 * remainder to first place); explicit amounts pass through. A missing reason becomes
 * `defaultReason` ("Picked by <sponsor>"). Pure.
 */
export function resolvePicks(
  picks: AwardPicksInput,
  a: { prizeUnits: bigint; decimals: number; defaultReason: string },
): PlannedWinner[] {
  const ranking = picks.winners.every((w) => typeof w === 'number');
  if (!ranking) {
    if (picks.split !== undefined)
      throw new SponsorError(
        'split: only for a ranking (winners as entry ids); explicit amounts are paid as given.',
      );
    return (picks.winners as z.infer<typeof AwardWinner>[]).map((w) => ({
      entry_id: w.entry_id,
      amount: w.amount,
      reason: w.reason ?? a.defaultReason,
    }));
  }
  const ids = picks.winners as number[];
  const shares = splitPrize(a.prizeUnits, ids.length, picks.split);
  return ids.map((entry_id, i) => ({
    entry_id,
    amount: formatUnits(shares[i], a.decimals),
    reason: a.defaultReason,
  }));
}

/** The reason recorded for a winner the sponsor didn't explain. */
export const pickedBy = (sponsorName: string) => {
  // Cleaned like any reason: rows from before v2.2 hold unsanitized sponsor names.
  const r = untrusted(TEXT_LIMITS.reason, 3).safeParse(
    `Picked by ${sponsorName}`,
  );
  return r.success ? r.data : 'Picked by the sponsor';
};

/**
 * Checks the sponsor's (or the operator fallback's) picks and returns what the award transaction
 * must contain. `excluded` (lowercase) are wallets that may never receive a prize: every EarnKit
 * escrow clone (the contract only excludes itself) and the sponsor's own wallet.
 */
export function planAward(a: {
  winners: PlannedWinner[];
  entries: { id: number; payout_wallet: string }[];
  prizeUnits: bigint;
  decimals: number;
  excluded: ReadonlySet<string>;
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
    if (a.excluded.has(e.payout_wallet.toLowerCase()))
      throw new SponsorError(
        `winners: entry ${w.entry_id}'s payout wallet is an EarnKit escrow or the sponsor's wallet, so it can't receive a prize.`,
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

/**
 * How the campaign is labeled for builders and, when unverified, how to change that. Pure;
 * exported for tests.
 */
export function labelText(
  identity: SponsorIdentity,
  wallet: string,
  note?: string | null,
  /** A draft's label is what builders will see once it is funded from the bound wallet. */
  funded = false,
) {
  const label = `Label for builders${funded ? '' : ' once funded'}: ${sponsorLabel(identity)}.`;
  if (identity.verified) return label;
  if (!identity.host)
    return `${label} Without a sponsor_url there is no domain to verify; a campaign can't be the top pick for builders while unverified.`;
  return (
    `${label}${note ? ` ${note}` : ''} To show as verified ${identity.host}, publish the line ` +
    `"${earnkitTxtLine(wallet)}" at ${earnkitTxtUrl(identity.host)}; EarnKit checks it again when ` +
    "the campaign is viewed. Unverified campaigns are listed, but never as builders' top pick."
  );
}

/** create: what was drafted, the split, how it's labeled, and how to fund it. */
export function createReply(a: {
  title: string;
  poolUnits: bigint;
  token: Tok;
  winners: number;
  endsAt: string;
  fundUrl: string;
  sponsorWallet: string;
  identity: SponsorIdentity;
  verificationNote?: string | null;
  /** The defaults filled in for answers the sponsor didn't give (withDefaults). */
  defaults?: string[];
  /** The draft's ref (for replaces). */
  ref: string;
  /** The title of the draft this one replaced, if any. */
  replacesTitle?: string;
}) {
  const { prize, fee } = splitUnits(a.poolUnits);
  const defaults = a.defaults?.length
    ? `Defaults used: ${a.defaults.join('; ')}.\n`
    : '';
  const replaced =
    a.replacesTitle !== undefined
      ? `Replaces ${quoted(a.replacesTitle)}; its old link no longer works.\n`
      : '';
  return {
    show_to_sponsor:
      `Campaign drafted: ${quoted(a.title)}.\n` +
      replaced +
      `Pool: ${amt(a.poolUnits, a.token)}. Winners get ${amt(prize, a.token)}; EarnKit's 10% ` +
      `(${amt(fee, a.token)}) is paid only when prizes are paid, and you get everything back if nobody qualifies.\n` +
      `Winners: ${a.winners} planned. Deadline: ${formatDeadline(a.endsAt)}.\n` +
      defaults +
      'To change anything, ask me to update it: the update replaces this draft (same wallet), and this link stops working.\n' +
      `${labelText(a.identity, a.sponsorWallet, a.verificationNote)}\n` +
      `Fund it here, from ${a.sponsorWallet}: ${a.fundUrl}`,
    next_step:
      `Fund it: the sponsor opens ${a.fundUrl} and deposits from ${a.sponsorWallet}, or, if you hold ` +
      'that wallet, send the two `transactions` from it in order (approve, then createCampaign). ' +
      'Then call sponsor_campaign with action=status and ref: EarnKit finds the deposit onchain. ' +
      'Only a deposit from that wallet counts. An unfunded draft expires after 7 days, or 10 ' +
      'minutes before its deadline. To change anything before it is funded, call create again with ' +
      `all the answers and replaces=${a.ref} (same sponsor_wallet): the old link stops working, and ` +
      "replacements don't count toward the 5 creates a day (up to 10 a day).",
  };
}

export type StatusFacts = {
  state:
    | 'draft'
    | 'live'
    | 'awarded'
    | 'refunded'
    | 'expired'
    | 'taken_down'
    | 'replaced';
  title: string;
  /** replaced: the newer draft's fund link. */
  replacedByUrl?: string | null;
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
  /** live: when EarnKit's pending fallback can be paid out, unless the sponsor awards first. */
  fallbackExecutesAt: Date | null;
  /** draft/expired: why a deposit found onchain wasn't accepted (see sponsor.ts fundingMismatch). */
  fundingProblem: string | null;
};

/** status: one line per state, plus the next step where there is one. */
export function statusReply(s: StatusFacts): {
  show_to_sponsor: string;
  next_step?: string;
} {
  const deadline = formatDeadline(s.endsAt);
  const title = quoted(s.title);
  switch (s.state) {
    case 'draft':
      if (s.fundingProblem)
        return {
          show_to_sponsor: `${title}: ${s.fundingProblem}`,
          next_step:
            'Contact EarnKit to refund that deposit, then create a new campaign with action=create.',
        };
      return {
        show_to_sponsor:
          `${title} is a draft, not funded yet. Deposit the pool at ${s.fundUrl}` +
          (s.expiresAt
            ? ` before ${formatDeadline(s.expiresAt)}, when the draft expires.`
            : '.'),
        next_step:
          `Fund it: the sponsor deposits at ${s.fundUrl}, or you send the two transactions from ` +
          'create if you hold their wallet. Then call status with ref: EarnKit finds the deposit onchain.',
      };
    case 'expired':
      return {
        show_to_sponsor: s.fundingProblem
          ? `${title}: ${s.fundingProblem}`
          : (s.expiredText ?? `${title} expired before it was funded.`),
        next_step: s.fundingProblem
          ? 'Contact EarnKit to refund that deposit, then create a new campaign with action=create.'
          : 'If the deposit was only just sent, call status again in a minute: EarnKit finds it onchain. ' +
            'Otherwise create a new campaign with action=create.',
      };
    case 'replaced':
      return {
        show_to_sponsor:
          `${title} was replaced by a newer draft` +
          (s.replacedByUrl ? `; fund that one at ${s.replacedByUrl}.` : '.') +
          (s.fundingProblem
            ? ` ${s.fundingProblem[0].toUpperCase()}${s.fundingProblem.slice(1)}`
            : ''),
        ...(s.fundingProblem && {
          next_step: 'Contact EarnKit to refund that deposit.',
        }),
      };
    case 'awarded':
      return {
        show_to_sponsor: `${title} is awarded: ${s.paid} winner${s.paid === 1 ? '' : 's'} paid.${s.campaignUrl ? ` ${s.campaignUrl}` : ''}`,
      };
    case 'refunded':
      return {
        show_to_sponsor: `${title} ended with no winners; the whole pool was refunded to the sponsor's wallet.`,
      };
    case 'taken_down':
      return {
        show_to_sponsor: `${title} was removed by EarnKit; the whole pool was refunded to the sponsor's wallet.`,
      };
    case 'live': {
      const escrow = s.escrow
        ? ` Pool in escrow ${s.escrow}${s.escrowUrl && s.escrowUrl !== s.escrow ? ` (${s.escrowUrl})` : ''}.`
        : '';
      const page = s.campaignUrl ? ` ${s.campaignUrl}` : '';
      if (s.now.getTime() < Date.parse(s.endsAt))
        return {
          show_to_sponsor: `${title} is live: ${entriesText(s.entries)}; winners picked after ${deadline}.${escrow}${page}`,
          next_step: `Nothing to do until ${deadline}. Then call award with the winners.`,
        };
      const fallback = s.fallbackExecutesAt
        ? ` EarnKit has proposed fallback winners; they can be paid from ${formatDeadline(s.fallbackExecutesAt)} unless the sponsor awards first.`
        : '';
      return {
        show_to_sponsor: `${title} has ended with ${entriesText(s.entries)}; time to pick winners.${fallback}${escrow}${page}`,
        next_step: s.awardUrl
          ? `The sponsor signs the prepared award at ${s.awardUrl} (or you send its transaction from the wallet that funded the campaign). Then call status with ref: EarnKit reads the award onchain.`
          : s.entries === 0
            ? 'Nobody entered. Contact EarnKit to refund the pool (fee included).'
            : `Call award with winners: the entry ids in ranked order (split "equal" by default, or percentages adding up to 100), or [{entry_id, amount}] adding up to ${s.prize} exactly. If the sponsor hasn't picked winners 7 days after the deadline, EarnKit may propose the top entries; they can be paid 3 days later unless the sponsor awards first.`,
      };
    }
  }
}

/**
 * award: who gets what, the fee, and where to sign. Entry names are the builders' words: quoted on
 * one line; the reasons stay in `plan`.
 */
export function awardReply(a: {
  winners: { entry_id: number; name: string; amount: string }[];
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
            `- entry #${w.entry_id} ${quoted(w.name)}: ${amt(parseUnits(w.amount, a.token.decimals), a.token)}`,
        )
        .join('\n') +
      `\nEarnKit's 10% (${amt(a.feeUnits, a.token)}) is released with this payout.\n` +
      `Sign it here: ${a.awardUrl}`,
    next_step:
      `The sponsor signs at ${a.awardUrl} with the wallet that funded the campaign (or, if you hold ` +
      'that wallet, send `transaction`). Then call status with ref: EarnKit reads the award onchain.',
  };
}

/**
 * The sponsor-facing line for an entry's repo dates (read from GitHub at entry), so a fresh clone
 * of an older project stands out; null for entries from before v2.2. Pure; exported for tests.
 */
export function repoLabel(createdAt: Date | null, pushedAt: Date | null) {
  if (!createdAt) return null;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return `repo created ${day(createdAt)}${pushedAt ? ` · last push ${day(pushedAt)} (at entry)` : ''}`;
}
