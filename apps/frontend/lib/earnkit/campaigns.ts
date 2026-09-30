import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { z } from 'zod';

/**
 * EarnKit's own campaigns (v2.0): a program with a `campaign` block. Builders submit to
 * EarnKit; EarnKit scores each entry from Base onchain data; a human approves winners; the
 * prize token is sent straight to each winner's payout wallet (scripts/campaign-payout.mts).
 * See docs/design-docs-and-implementation-plans/v2-earnkit-campaigns.md.
 */

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'a 0x address');

export const CampaignConfig = z
  .object({
    prize: z
      .object({
        token: address,
        symbol: z.string().min(1),
        decimals: z.number().int().min(0).max(36),
        chain: z.literal('base'),
      })
      .strict(),
    winners: z.number().int().min(1).max(50),
    /** Whole tokens per winner, as a string (e.g. "75000000"). */
    amount_each: z.string().regex(/^\d+$/),
    metric: z.literal('unique_wallets'),
    /** Minimum score to be eligible. */
    min_score: z.number().int().min(0),
  })
  .strict();
export type CampaignConfig = z.infer<typeof CampaignConfig>;

/** Submission keys every campaign needs. */
export const CAMPAIGN_KEYS = {
  contracts: 'contracts',
  payoutWallet: 'payout_wallet',
} as const;

export class EntryError extends Error {}

const BLOCKSCOUT = 'https://base.blockscout.com';

let lastCall = 0;
const MIN_GAP_MS = 250; // the public API rate-limits; stay well under it

/**
 * GET from Base's public Blockscout API: paced, and retried with backoff when throttled.
 * Throttling can arrive as HTTP 429 *or* as a 200 whose body says "Too many requests", so both
 * are retried, and persistent throttling throws instead of passing off as empty data.
 */
async function blockscout<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(`${BLOCKSCOUT}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'earnkit' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (res.status === 429 || /too many requests/i.test(text)) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
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

/** "0xA, 0xB" or ["0xA", "0xB"] → unique lowercase addresses. */
export function parseAddresses(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : String(value ?? '').split(/[\s,]+/);
  return [...new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean))];
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
 * Checks a campaign entry: 1–5 Base contracts deployed during the campaign, and a payout wallet.
 * `deployedAt` is injectable for tests.
 */
export async function validateEntry(
  data: Record<string, unknown>,
  window: { starts_at: Date | null; ends_at: Date | null },
  status: (contract: string) => Promise<Deployment> = async (c) =>
    deploymentStatus(c, await baseBlockAt(window.starts_at ?? new Date(0))),
) {
  const contracts = parseAddresses(data[CAMPAIGN_KEYS.contracts]);
  const payout = String(data[CAMPAIGN_KEYS.payoutWallet] ?? '').trim();

  if (contracts.length === 0 || contracts.length > 5) {
    throw new EntryError(
      'contracts: give 1 to 5 Base contract addresses that people use.',
    );
  }
  const bad = contracts.find((c) => !/^0x[0-9a-f]{40}$/.test(c));
  if (bad) throw new EntryError(`contracts: "${bad}" isn't an address.`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(payout)) {
    throw new EntryError(
      'payout_wallet: the Base address (your agent wallet) that receives the prize.',
    );
  }

  for (const c of contracts) {
    const st = await status(c);
    if (st === 'not_contract')
      throw new EntryError(`contracts: ${c} isn't a contract on Base mainnet.`);
    if (st === 'before_start') {
      throw new EntryError(
        `contracts: ${c} was deployed before the campaign started. Only work built during the campaign counts.`,
      );
    }
  }
  return { contracts, payoutWallet: payout.toLowerCase() };
}

type TxPage = {
  items: { timestamp: string; status: string; from: { hash: string } }[];
  next_page_params: Record<string, unknown> | null;
};

/** Distinct wallets that sent a successful transaction to `contract` within the window. */
export async function walletsUsing(contract: string, from: Date, to: Date) {
  const wallets = new Set<string>();
  let params = 'filter=to';
  for (let page = 0; page < 40; page++) {
    const data = await blockscout<TxPage>(
      `/api/v2/addresses/${contract}/transactions?${params}`,
    );
    for (const tx of data.items) {
      const at = new Date(tx.timestamp);
      if (at < from) return wallets; // newest first: everything after this is older
      if (at <= to && tx.status === 'ok')
        wallets.add(tx.from.hash.toLowerCase());
    }
    if (!data.next_page_params) break;
    params = new URLSearchParams(
      Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)]),
    ).toString();
  }
  return wallets;
}

/** Base RPC. BASE_RPC_URL overrides the public endpoint (e.g. a local fork for tests). */
const baseRpc = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });

/** The Base block at (or just before) `at`. Base makes exactly one block every 2 seconds. */
export async function baseBlockAt(at: Date) {
  const latest = await baseRpc.getBlock();
  const secondsAgo = Number(latest.timestamp) - Math.floor(at.getTime() / 1000);
  return latest.number - BigInt(Math.max(0, Math.ceil(secondsAgo / 2)));
}

/**
 * True if the wallet had sent transactions before `blockBefore` (filters out wallets made for
 * the campaign). Reads the wallet's nonce at that block from Base's RPC; errors propagate.
 */
export async function hadHistoryBefore(wallet: string, blockBefore: bigint) {
  const nonce = await baseRpc.getTransactionCount({
    address: wallet as `0x${string}`,
    blockNumber: blockBefore,
  });
  return nonce > 0;
}

/**
 * Metric `unique_wallets`: distinct wallets with prior history that used any of the entry's
 * contracts during the campaign. Returns the score and the counted wallets as evidence.
 */
export async function scoreEntry(contracts: string[], from: Date, to: Date) {
  const all = new Set<string>();
  for (const c of contracts)
    for (const w of await walletsUsing(c, from, to)) all.add(w);
  const blockBefore = await baseBlockAt(from);
  const counted: string[] = [];
  for (const w of all)
    if (await hadHistoryBefore(w, blockBefore)) counted.push(w);
  return { score: counted.length, wallets: counted, seen: all.size };
}

export type YourEntry = {
  name: string;
  campaign_title: string;
  campaign: CampaignConfig;
  score: number | null;
  rank: number;
  entries: number;
  prize_tx: string | null;
  prize_paid_at: Date | null;
};

/** "Your campaign entries" lines, plus "you won" notices for the since-last-check line. */
export function presentYourEntries(list: YourEntry[], lastCheck: Date | null) {
  const lines = list.map((e) => {
    const prize = `${Number(e.campaign.amount_each).toLocaleString('en-US')} ${e.campaign.prize.symbol}`;
    if (e.prize_tx)
      return `${e.name}: you won ${prize} in ${e.campaign_title} (tx ${e.prize_tx})`;
    const score =
      e.score == null
        ? 'not scored yet'
        : `${e.score} wallets (min ${e.campaign.min_score})`;
    return `${e.name}: #${e.rank} of ${e.entries} in ${e.campaign_title} · ${score}`;
  });
  const wins = list
    .filter(
      (e) => e.prize_paid_at && (!lastCheck || e.prize_paid_at > lastCheck),
    )
    .map(
      (e) =>
        `you won ${Number(e.campaign.amount_each).toLocaleString('en-US')} ${e.campaign.prize.symbol} with ${e.name}`,
    );
  return {
    section: lines.length
      ? `**Your campaign entries**\n\n${lines.join('\n')}`
      : null,
    wins,
  };
}
