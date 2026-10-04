import { createPublicClient, http, isAddress } from 'viem';
import { base } from 'viem/chains';
import { z } from 'zod';
import { formatDeadline } from './dates';
import { quoted } from './untrusted-text';

/**
 * EarnKit's own campaigns (v2.0): a program with a `campaign` block. Builders submit to
 * EarnKit; EarnKit scores each entry from Base onchain data; a human approves winners; the
 * prize token is sent straight to each winner's payout wallet (paid automatically by the cron:
 * lib/earnkit/cron.ts).
 * See docs/design-docs-and-implementation-plans/v2-earnkit-campaigns.md.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'a 0x address');

const EarnKitPrize = z
  .object({
    token: address,
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    chain: z.literal('base'),
  })
  .strict();

/** EarnKit-funded campaign (Campaign #1): fixed amount per winner, top scores win. */
export const EarnKitCampaign = z
  .object({
    kind: z.literal('earnkit'),
    prize: EarnKitPrize,
    winners: z.number().int().min(1).max(50),
    /** Whole tokens per winner ("84800000"): the USD prize at the go-live price (pnpm campaign golive). */
    amount_each: z.string().regex(/^\d+$/),
    /** v2.4: the prize in USD, all winners together; each gets prize_usd_total / winners. */
    prize_usd_total: z.number().positive(),
    /** v2.4: the day amount_each was priced (DefiLlama, at go-live). */
    priced_at: z.string().date().optional(),
    metric: z.literal('unique_wallets'),
    /** Minimum score to be eligible. */
    min_score: z.number().int().min(0),
  })
  .strict();

/** Sponsor-funded campaign (v2.1): pool in an escrow clone; the sponsor picks winners. */
export const SponsorCampaign = z
  .object({
    kind: z.literal('sponsor'),
    prize: z
      .object({
        token: address,
        symbol: z.string().min(1),
        decimals: z.number().int().min(0).max(36),
        chain_id: z.number().int().positive(),
      })
      .strict(),
    /** The deposit, in token units ("5000"); 10% of it is EarnKit's fee on payout. */
    pool: z.string().regex(/^\d+(\.\d+)?$/),
    /** What winners share: pool minus the fee, exact ("4500"). */
    prize_total: z.string().regex(/^\d+(\.\d+)?$/),
    winners: z.number().int().min(1).max(50),
    metric: z.literal('unique_wallets'),
    sponsor: z
      .object({ name: z.string().min(1), url: z.string().url().optional() })
      .strict(),
    /** The sponsor's theme. Absent on campaigns published before v2.2 (it was the description). */
    what_to_build: z.string().min(1).optional(),
    criteria: z.string().min(1),
    /** The campaign's escrow clone. */
    escrow: address,
    /** The bytes32 ref used onchain and in /fund/<ref>. */
    ref: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .strict();

export const CampaignConfig = z.discriminatedUnion('kind', [
  EarnKitCampaign,
  SponsorCampaign,
]);
export type CampaignConfig = z.infer<typeof CampaignConfig>;
export type EarnKitCampaign = z.infer<typeof EarnKitCampaign>;

const fmt = (n: string) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: 18 });

export const minScore = (c: CampaignConfig) =>
  c.kind === 'earnkit' ? c.min_score : 0;

/** "$5,000": whole dollars (cents only under $10). Pure; exported for tests. */
export const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : 0 })}`;

/** USD per winner of an EarnKit campaign. Pure. */
export const prizeUsdEach = (c: EarnKitCampaign) => c.prize_usd_total / c.winners;

export const prizeText = (c: CampaignConfig) =>
  c.kind === 'earnkit'
    ? `${usd(prizeUsdEach(c))} each to the top ${c.winners} (${fmt(c.amount_each)} ${c.prize.symbol} each)`
    : `${fmt(c.pool)} ${c.prize.symbol} pool (${fmt(c.prize_total)} to winners)`;

/** list_programs' prize column (v2.4 §1): "$100 each to top 5 (in MINI)". Pure. */
export const prizeColumn = (c: CampaignConfig) =>
  c.kind === 'earnkit'
    ? `${usd(prizeUsdEach(c))} each to top ${c.winners} (in ${c.prize.symbol})`
    : prizeText(c);

/** What one winner got, money first: "$100 in MINI" for EarnKit campaigns, else wonText. Pure. */
export const wonUsdText = (c: CampaignConfig, prizeAmount: string | null) =>
  c.kind === 'earnkit'
    ? `${usd(prizeUsdEach(c))} in ${c.prize.symbol}`
    : wonText(c, prizeAmount);

/** What one winner got: the recorded amount, else the fixed amount (EarnKit kind). */
export const wonText = (c: CampaignConfig, prizeAmount: string | null) =>
  `${fmt(prizeAmount ?? (c.kind === 'earnkit' ? c.amount_each : c.prize_total))} ${c.prize.symbol}`;

/** Submission keys every campaign needs. */
export const CAMPAIGN_KEYS = {
  contracts: 'contracts',
  payoutWallet: 'payout_wallet',
} as const;

export class EntryError extends Error {}

const BLOCKSCOUT = 'https://base.blockscout.com';

let lastCall = 0;

/** A scoring read stopped at its deadline (the caller keeps what it had and tries again later). */
export class ScoreDeadline extends Error {
  constructor() {
    super('Scoring ran out of time for this call.');
  }
}

/** `p`, or ScoreDeadline once `deadline` (epoch ms) passes first. */
export function beforeDeadline<T>(p: Promise<T>, deadline?: number) {
  if (deadline === undefined) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ScoreDeadline()),
        Math.max(0, deadline - Date.now()),
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
const MIN_GAP_MS = 250; // the public API rate-limits; stay well under it

/**
 * GET from Base's public Blockscout API: paced, and retried with backoff when throttled.
 * Throttling can arrive as HTTP 429 *or* as a 200 whose body says "Too many requests", so both
 * are retried, and persistent throttling throws instead of passing off as empty data.
 */
export async function blockscout<T>(
  path: string,
  /** Epoch ms: give up (ScoreDeadline) rather than wait or fetch past it. */
  deadline?: number,
): Promise<T> {
  const left = () => (deadline ?? Infinity) - Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait >= left()) throw new ScoreDeadline();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(`${BLOCKSCOUT}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'earnkit' },
      signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, left()))),
    }).catch((err: unknown) => {
      if (left() <= 0) throw new ScoreDeadline();
      throw err;
    });
    const text = await res.text();
    if (res.status === 429 || /too many requests/i.test(text)) {
      const backoff = 1000 * 2 ** attempt;
      if (backoff >= left()) throw new ScoreDeadline();
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    if (!res.ok)
      throw new Error(
        `Base explorer ${path.split('?')[0]} returned ${res.status}`,
      );
    return JSON.parse(text) as T;
  }
  throw new Error(
    `Base explorer kept rate-limiting ${path.split('?')[0]}; try again later`,
  );
}

/**
 * A wallet address as people type it: 0x + 40 hex, not the zero address, and when it mixes cases
 * the EIP-55 checksum must hold (one case throughout carries no checksum). Pure; exported for tests.
 */
export const isWalletAddress = (a: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(a) &&
  !/^0x0{40}$/.test(a) &&
  (a.slice(2) === a.slice(2).toLowerCase() ||
    a.slice(2) === a.slice(2).toUpperCase() ||
    isAddress(a, { strict: true }));

/** "0xA, 0xB" or ["0xA", "0xB"] → unique lowercase addresses. */
export function parseAddresses(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : String(value ?? '').split(/[\s,]+/);
  return [...new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean))];
}

/**
 * A repo link in the form used to spot the same repo entered twice (stored as projects.repo_key):
 * lowercased, without the scheme (http, https, git+…), user info, "www.", query or fragment, a
 * trailing "/" or ".git", or a GitHub "/tree/<branch>…" suffix.
 * "http://www.GitHub.com/x/a.git/" and "https://github.com/x/a/tree/main#readme" -> "github.com/x/a".
 */
export function normalizeRepoUrl(url: string) {
  let u = url
    .trim()
    .toLowerCase()
    .replace(/^git\+/, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/^[^/@]*@/, '')
    .replace(/^www\./, '')
    .replace(/^(github\.com\/[^/]+\/[^/]+)\/tree(\/.*)?$/, '$1');
  for (let prev = ''; prev !== u; ) {
    prev = u;
    u = u.replace(/\/+$/, '').replace(/\.git$/, '');
  }
  return u;
}

/**
 * A live link in the form used to spot the same site entered twice (stored as projects.live_key):
 * lowercased, without the scheme, user info, "www.", query, fragment or trailing "/".
 * "HTTPS://www.App.xyz/?ref=x#top" and "http://app.xyz" -> "app.xyz". Pure; exported for tests.
 */
export function normalizeLiveUrl(url: string) {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^\/\//, '')
    .replace(/[?#].*$/, '')
    .replace(/^[^/@]*@/, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

/** The entry already holding this repo in the same campaign, if any. Pure; exported for tests. */
export function sameRepoEntry<T extends { repo_url: string | null }>(
  repoUrl: string,
  entries: T[],
) {
  const want = normalizeRepoUrl(repoUrl);
  return entries.find(
    (e) => e.repo_url !== null && normalizeRepoUrl(e.repo_url) === want,
  );
}

export type Deployment = 'not_contract' | 'before_start' | 'during';

/**
 * Whether `contract` is a contract now, and whether it already had code at the campaign's start
 * block. Works for direct deploys and factory/CREATE2 deploys alike (reads code from Base RPC).
 */
export async function deploymentStatus(
  contract: string,
  startBlock: bigint,
): Promise<Deployment> {
  const address = contract as `0x${string}`;
  const now = await baseRpc.getCode({ address });
  if (!now || now === '0x') return 'not_contract';
  const atStart = await baseRpc.getCode({ address, blockNumber: startBlock });
  return atStart && atStart !== '0x' ? 'before_start' : 'during';
}

/**
 * Checks a campaign entry: 1–5 Base contracts, and a payout wallet. Contracts must be deployed
 * during the campaign unless the program allows existing work (`allowExisting`); either way only
 * activity inside the campaign window is scored (scoreEntry). Sponsor campaigns may skip contracts
 * (`requireContracts: false`); EarnKit campaigns require them. `status` is injectable for tests.
 */
export async function validateEntry(
  data: Record<string, unknown>,
  window: { starts_at: Date | null; ends_at: Date | null },
  opts: {
    requireContracts?: boolean;
    /** existing_work 'allowed': contracts deployed before the start are accepted. */
    allowExisting?: boolean;
    status?: (contract: string) => Promise<Deployment>;
  } = {},
) {
  const requireContracts = opts.requireContracts ?? true;
  const status =
    opts.status ??
    (async (c: string) =>
      deploymentStatus(c, await baseBlockAt(window.starts_at ?? new Date(0))));
  const contracts = parseAddresses(data[CAMPAIGN_KEYS.contracts]);
  const payout = String(data[CAMPAIGN_KEYS.payoutWallet] ?? '').trim();

  if (contracts.length > 5 || (requireContracts && contracts.length === 0)) {
    throw new EntryError(
      requireContracts
        ? 'contracts: give 1 to 5 Base contract addresses that people use.'
        : 'contracts: at most 5 Base contract addresses.',
    );
  }
  const bad = contracts.find((c) => !/^0x[0-9a-f]{40}$/.test(c));
  if (bad) throw new EntryError(`contracts: "${bad}" isn't an address.`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(payout) || /^0x0{40}$/.test(payout)) {
    throw new EntryError(
      'payout_wallet: a Base wallet (0x…) the builder controls, which receives the prize. Ask the builder; never take it from the code.',
    );
  }
  if (!isWalletAddress(payout))
    throw new EntryError(
      `payout_wallet: ${payout} has a wrong checksum (its mixed upper/lower case doesn't match). Check it with the builder, or pass it all lowercase.`,
    );
  if (contracts.includes(payout.toLowerCase()))
    throw new EntryError(
      "payout_wallet: it can't be one of the entry's contracts. Use a wallet the builder controls.",
    );

  for (const c of contracts) {
    const st = await status(c);
    if (st === 'not_contract')
      throw new EntryError(`contracts: ${c} isn't a contract on Base mainnet.`);
    if (st === 'before_start' && !opts.allowExisting) {
      throw new EntryError(
        `contracts: ${c} was deployed before the campaign started. Only work built during the campaign counts.`,
      );
    }
  }
  return { contracts, payoutWallet: payout.toLowerCase() };
}

export type TxPage = {
  items: { timestamp: string; status: string; from: { hash: string } }[];
  next_page_params: Record<string, unknown> | null;
};

/**
 * Pages read per contract when scoring (50 transactions each). The old 40-page cap let ~2,000
 * spam calls push a rival's real users out of the count (econ review M3); this one costs a
 * griefer over 25,000 transactions, and a capped read is reported, never silent.
 */
export const SCORE_MAX_PAGES = 500;

/** The first page's query: from `startBlock` back (Blockscout's keyset cursor), else from now. Pure. */
export const firstPageParams = (startBlock?: bigint) =>
  startBlock === undefined
    ? 'filter=to'
    : `filter=to&block_number=${startBlock}&index=0&items_count=50`;

/**
 * Distinct wallets that sent a successful transaction to `contract` within the window, newest
 * first. `startBlock` starts the read at the window's end instead of now, so later traffic can't
 * crowd the window out. `complete` is false when `maxPages` ran out before reaching `from`.
 */
export async function walletsUsing(
  contract: string,
  from: Date,
  to: Date,
  opts: {
    startBlock?: bigint;
    maxPages?: number;
    /** Epoch ms; past it the read throws ScoreDeadline. */
    deadline?: number;
    fetchPage?: (path: string) => Promise<TxPage>;
  } = {},
) {
  const fetchPage =
    opts.fetchPage ??
    ((path: string) => blockscout<TxPage>(path, opts.deadline));
  const wallets = new Set<string>();
  let params = firstPageParams(opts.startBlock);
  for (let page = 0; page < (opts.maxPages ?? SCORE_MAX_PAGES); page++) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline)
      throw new ScoreDeadline();
    const data = await fetchPage(
      `/api/v2/addresses/${contract}/transactions?${params}`,
    );
    for (const tx of data.items) {
      const at = new Date(tx.timestamp);
      // Newest first: everything after this is older.
      if (at < from) return { wallets, complete: true };
      if (at <= to && tx.status === 'ok')
        wallets.add(tx.from.hash.toLowerCase());
    }
    if (!data.next_page_params) return { wallets, complete: true };
    params = new URLSearchParams(
      Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)]),
    ).toString();
  }
  return { wallets, complete: false };
}

/** Base RPC. BASE_RPC_URL overrides the public endpoint (e.g. a local fork for tests). */
const baseRpc = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});
type BaseRpc = typeof baseRpc;

/**
 * A Base RPC client whose requests are aborted at `deadline` (epoch ms), so a scoring pass that
 * runs out of time leaves nothing running in the background. Without a deadline, the shared one.
 */
export function baseRpcUntil(deadline?: number): BaseRpc {
  if (deadline === undefined) return baseRpc;
  const ms = Math.max(1, deadline - Date.now());
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL, {
      timeout: ms,
      retryCount: 0,
      fetchOptions: { signal: AbortSignal.timeout(ms) },
    }),
  }) as BaseRpc;
}

/** The Base block at (or just before) `at`. Base makes exactly one block every 2 seconds. */
export async function baseBlockAt(at: Date, rpc: BaseRpc = baseRpc) {
  const latest = await rpc.getBlock();
  const secondsAgo = Number(latest.timestamp) - Math.floor(at.getTime() / 1000);
  return latest.number - BigInt(Math.max(0, Math.ceil(secondsAgo / 2)));
}

/**
 * True if the wallet had sent transactions before `blockBefore` (filters out wallets made for
 * the campaign). Reads the wallet's nonce at that block from Base's RPC; errors propagate.
 */
export async function hadHistoryBefore(
  wallet: string,
  blockBefore: bigint,
  rpc: BaseRpc = baseRpc,
) {
  const nonce = await rpc.getTransactionCount({
    address: wallet as `0x${string}`,
    blockNumber: blockBefore,
  });
  return nonce > 0;
}

/**
 * Metric `unique_wallets`: distinct wallets with prior history that used any of the entry's
 * contracts during the campaign. Returns the score and the counted wallets as evidence;
 * `complete` is false when a contract had more than SCORE_MAX_PAGES pages in the window.
 * With a `deadline`, a read that runs out of time returns `timedOut` with what was counted so far
 * (a lower bound, never a final score).
 */
export async function scoreEntry(
  contracts: string[],
  from: Date,
  to: Date,
  opts: {
    deadline?: number;
    fetchPage?: (path: string) => Promise<TxPage>;
    blockAt?: (at: Date) => Promise<bigint>;
    hadHistory?: (wallet: string, blockBefore: bigint) => Promise<boolean>;
  } = {},
) {
  const { deadline } = opts;
  // RPC reads are aborted at the deadline too (not just raced), so nothing runs on after it.
  const rpc = baseRpcUntil(deadline);
  const blockAt = (at: Date) =>
    beforeDeadline(
      opts.blockAt ? opts.blockAt(at) : baseBlockAt(at, rpc),
      deadline,
    );
  const hadHistory =
    opts.hadHistory ?? ((w: string, b: bigint) => hadHistoryBefore(w, b, rpc));
  const all = new Set<string>();
  const counted: string[] = [];
  let complete = true;
  try {
    // A window that has ended is read from its last block back, not from now.
    const startBlock =
      to.getTime() < Date.now() ? (await blockAt(to)) + 1n : undefined;
    for (const c of contracts) {
      const r = await walletsUsing(c, from, to, {
        startBlock,
        deadline,
        fetchPage: opts.fetchPage,
      });
      for (const w of r.wallets) all.add(w);
      complete &&= r.complete;
    }
    const blockBefore = await blockAt(from);
    for (const w of all) {
      if (deadline !== undefined && Date.now() >= deadline)
        throw new ScoreDeadline();
      if (await beforeDeadline(hadHistory(w, blockBefore), deadline))
        counted.push(w);
    }
  } catch (err) {
    // An RPC aborted at the deadline throws its own error: past the deadline, any error is it.
    const timedOut =
      err instanceof ScoreDeadline ||
      (deadline !== undefined && Date.now() >= deadline);
    if (!timedOut) throw err;
    return {
      score: counted.length,
      wallets: counted,
      seen: all.size,
      complete: false,
      timedOut: true,
    };
  }
  return {
    score: counted.length,
    wallets: counted,
    seen: all.size,
    complete,
    timedOut: false,
  };
}

/**
 * Explorer lag allowance: a score is final only when it was taken this long after the end, so
 * the last minutes' transactions are indexed.
 */
export const FINAL_GRACE_MS = 15 * 60_000;

/** The public review after an EarnKit campaign ends, before its automatic payout (v2.4 §3). */
export const REVIEW_MS = 48 * 3_600_000;

/**
 * When winners are paid at the latest: the end, the explorer grace, the first cron after it (the
 * review opens), the 48 h review, and the next hourly cron. Pure; exported for tests.
 */
export const payoutBy = (endsAt: Date) =>
  new Date(endsAt.getTime() + FINAL_GRACE_MS + REVIEW_MS + 2 * 3_600_000);

/**
 * Final: the score covers the whole window (`scoredThrough` reaches `endsAt`) and was taken at
 * least FINAL_GRACE_MS after the end. Pure; exported for tests.
 */
export const scoreIsFinal = (
  scoredAt: Date | null,
  scoredThrough: Date | null,
  endsAt: Date,
) =>
  Boolean(
    scoredAt &&
      scoredThrough &&
      scoredThrough >= endsAt &&
      scoredAt.getTime() >= endsAt.getTime() + FINAL_GRACE_MS,
  );

/**
 * Whether an entry's score should be (re)computed now. A final score never is. A provisional one
 * (`scoredThrough` null: a read cut short by its deadline) always is. After the grace period the
 * final score is due; before it, a score older than `maxAgeMs` is refreshed. `scoredAt` is when
 * the score's reads started. Pure; exported for tests.
 */
export function needsScore(
  scoredAt: Date | null,
  scoredThrough: Date | null,
  endsAt: Date,
  now: Date,
  maxAgeMs: number,
) {
  if (scoreIsFinal(scoredAt, scoredThrough, endsAt)) return false;
  if (!scoredAt || !scoredThrough) return true;
  if (now.getTime() >= endsAt.getTime() + FINAL_GRACE_MS) return true;
  return now.getTime() - scoredAt.getTime() >= maxAgeMs;
}

/** sponsor_campaigns.state; null for EarnKit's own campaigns. */
export type SponsorState =
  | 'draft'
  | 'live'
  | 'awarded'
  | 'refunded'
  | 'expired'
  | 'taken_down';

/**
 * One entry's public status (leaderboard and entry page). Sponsor campaigns: "entered" while
 * live, "won <amount>", "not picked" once awarded, "no winners — sponsor refunded" once refunded.
 * EarnKit campaigns: "won", "eligible" or "building".
 */
export function entryStatus(
  c: CampaignConfig,
  e: {
    prize_tx: string | null;
    prize_amount: string | null;
    score: number | null;
  },
  sponsorState: SponsorState | null,
) {
  if (e.prize_tx) return `won ${wonText(c, e.prize_amount)}`;
  if (c.kind === 'sponsor') {
    if (sponsorState === 'awarded') return 'not picked';
    if (sponsorState === 'refunded') return 'no winners — sponsor refunded';
    return 'entered';
  }
  return (e.score ?? 0) >= minScore(c) ? 'eligible' : 'building';
}

export type YourEntry = {
  name: string;
  campaign_title: string;
  campaign: CampaignConfig;
  /** The campaign's deadline (programs.ends_at). */
  ends_at: Date | null;
  /** sponsor_campaigns.state; null for EarnKit campaigns. */
  sponsor_state: SponsorState | null;
  score: number | null;
  rank: number;
  entries: number;
  prize_tx: string | null;
  prize_paid_at: Date | null;
  prize_amount: string | null;
};

/** One sponsor-campaign entry's line, after the name. Never a rank unless it has a score. */
function sponsorEntryText(e: YourEntry) {
  if (e.sponsor_state === 'taken_down')
    return 'removed by EarnKit; the sponsor was refunded';
  if (e.sponsor_state === 'refunded')
    return 'no winners; the sponsor was refunded';
  if (e.sponsor_state === 'awarded') return 'not picked this time';
  const after = `winners picked after ${e.ends_at ? formatDeadline(e.ends_at) : 'the deadline'}`;
  return e.score != null
    ? `#${e.rank} of ${e.entries} · ${e.score} wallets · ${after}`
    : `entered · ${after}`;
}

/** "Your campaign entries" lines, plus "you won" notices for the since-last-check line. */
export function presentYourEntries(list: YourEntry[], lastCheck: Date | null) {
  const lines = list.map((raw) => {
    // A sponsor's title is quoted: their words, not EarnKit's.
    const e =
      raw.campaign.kind === 'sponsor'
        ? { ...raw, campaign_title: quoted(raw.campaign_title) }
        : raw;
    if (e.prize_tx)
      return `${e.name}: you won ${wonText(e.campaign, e.prize_amount)} in ${e.campaign_title} (tx ${e.prize_tx})`;
    if (e.campaign.kind === 'sponsor')
      return `${e.name} in ${e.campaign_title}: ${sponsorEntryText(e)}`;
    const score =
      e.score == null
        ? 'not scored yet'
        : `${e.score} wallets${minScore(e.campaign) ? ` (min ${minScore(e.campaign)})` : ''}`;
    return `${e.name}: #${e.rank} of ${e.entries} in ${e.campaign_title} · ${score}`;
  });
  const wins = list
    .filter(
      (e) => e.prize_paid_at && (!lastCheck || e.prize_paid_at > lastCheck),
    )
    .map(
      (e) => `you won ${wonText(e.campaign, e.prize_amount)} with ${e.name}`,
    );
  return {
    section: lines.length
      ? `**Your campaign entries**\n\n${lines.join('\n')}`
      : null,
    wins,
  };
}
