import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  isAddress,
} from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';
import { campaignAbi, campaignsAbi } from './escrow-abi';
import { formatExact } from './format-units';

/**
 * Read-only access to the EarnKit escrow contracts (v2.1). The server never signs: it builds
 * transactions for the sponsor's wallet and reads state and events from the chain.
 */

export type EscrowChain = 'base' | 'base-sepolia' | 'local';
export type TokenInfo = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
};
export type RawTx = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: '0';
  chain_id: number;
  description: string;
};

const CHAIN = { base, 'base-sepolia': baseSepolia, local: foundry } as const;

/** Tokens the app offers per chain; the contract's capOf is the real allowlist. */
const TOKENS: Record<Exclude<EscrowChain, 'local'>, TokenInfo[]> = {
  base: [
    {
      symbol: 'USDC',
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      decimals: 6,
    },
  ],
  'base-sepolia': [
    {
      symbol: 'USDC',
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      decimals: 6,
    },
  ],
};

export const ESCROW_CHAINS = ['base', 'base-sepolia', 'local'] as const;

/** A readable configuration problem (never a TypeError from a bad env value). */
export class EscrowConfigError extends Error {}

/**
 * What is wrong with the escrow env, or null when it's usable. Sponsor campaigns are only offered
 * (the `sponsor_campaign` tool is only registered) when this is null. `ESCROW_CHAIN` defaults to
 * `base` when unset.
 */
export function escrowConfigProblem(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const chain = env.ESCROW_CHAIN ?? 'base';
  if (!(ESCROW_CHAINS as readonly string[]).includes(chain))
    return `ESCROW_CHAIN must be one of ${ESCROW_CHAINS.join(', ')} (got ${JSON.stringify(chain)}).`;
  const factory = env.ESCROW_FACTORY_ADDRESS;
  if (!factory) return 'ESCROW_FACTORY_ADDRESS is not set.';
  if (!isAddress(factory, { strict: false }))
    return `ESCROW_FACTORY_ADDRESS is not an address (got ${JSON.stringify(factory)}).`;
  if (chain === 'local') {
    const t = env.ESCROW_LOCAL_TOKEN;
    if (!t || !isAddress(t, { strict: false }))
      return 'ESCROW_LOCAL_TOKEN must be set to the token address when ESCROW_CHAIN=local.';
  }
  return null;
}

/** Whether the escrow is configured, i.e. sponsor campaigns are open on this deployment. */
export const escrowEnabled = (
  env: Record<string, string | undefined> = process.env,
) => escrowConfigProblem(env) === null;

/** Shown to agents and sponsors when the escrow isn't configured yet. */
export const SPONSOR_NOT_OPEN =
  "Sponsor campaigns aren't open yet on EarnKit. Check back soon.";

export function escrowConfig() {
  const problem = escrowConfigProblem();
  if (problem) throw new EscrowConfigError(`Escrow not configured: ${problem}`);
  const chain = (process.env.ESCROW_CHAIN ?? 'base') as EscrowChain;
  const factory = process.env.ESCROW_FACTORY_ADDRESS as `0x${string}`;
  const tokens =
    chain === 'local'
      ? [
          {
            symbol: 'USDC',
            address: process.env.ESCROW_LOCAL_TOKEN as `0x${string}`,
            decimals: 6,
          },
        ]
      : TOKENS[chain];
  return {
    chain,
    chainId: CHAIN[chain].id,
    factory,
    rpcUrl:
      process.env.ESCROW_RPC_URL ??
      (chain === 'base' ? process.env.BASE_RPC_URL : undefined),
    tokens,
  };
}

export const findToken = (symbol: string) =>
  escrowConfig().tokens.find(
    (t) => t.symbol.toLowerCase() === symbol.trim().toLowerCase(),
  ) ?? null;

function makeClient(c: ReturnType<typeof escrowConfig>) {
  return createPublicClient({
    chain: CHAIN[c.chain],
    transport: http(c.rpcUrl),
  });
}
let client: ReturnType<typeof makeClient> | null = null;
export function escrowClient() {
  const c = escrowConfig();
  client ??= makeClient(c);
  return client;
}

export const capOf = (token: `0x${string}`) =>
  escrowClient().readContract({
    address: escrowConfig().factory,
    abi: campaignsAbi,
    functionName: 'capOf',
    args: [token],
  }) as Promise<bigint>;

const EXPLORER: Record<number, string> = {
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
};
export const escrowLink = (chainId: number, address: string) =>
  EXPLORER[chainId] ? `${EXPLORER[chainId]}/address/${address}` : address;

/** approve + createCampaign, for an agent that holds the sponsor's wallet. */
export function fundTxs(
  ref: `0x${string}`,
  token: TokenInfo,
  amountUnits: bigint,
  endsAt: number,
): RawTx[] {
  const { factory, chainId } = escrowConfig();
  return [
    {
      to: token.address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [factory, amountUnits],
      }),
      value: '0',
      chain_id: chainId,
      description: `Approve exactly ${formatExact(amountUnits, token.decimals)} ${token.symbol} for the EarnKit escrow factory`,
    },
    {
      to: factory,
      data: encodeFunctionData({
        abi: campaignsAbi,
        functionName: 'createCampaign',
        args: [ref, token.address, amountUnits, BigInt(endsAt)],
      }),
      value: '0',
      chain_id: chainId,
      description: 'Deposit the pool into a new escrow for this campaign',
    },
  ];
}

export function awardTx(
  escrow: `0x${string}`,
  wallets: string[],
  amountsUnits: bigint[],
): RawTx {
  return {
    to: escrow,
    data: encodeFunctionData({
      abi: campaignAbi,
      functionName: 'award',
      args: [wallets as `0x${string}`[], amountsUnits],
    }),
    value: '0',
    chain_id: escrowConfig().chainId,
    description: 'Pay the winners from escrow (10% fee to EarnKit)',
  };
}

/** The clone's onchain state, by `EarnKitCampaign.State` index. */
export const ESCROW_STATES = ['none', 'funded', 'awarded', 'refunded'] as const;
export type EscrowState = (typeof ESCROW_STATES)[number];

/** What `findFunding` needs from a funded clone. Addresses are lowercased. */
export type CloneFacts = {
  sponsor: string;
  token: string;
  prize: bigint;
  fee: bigint;
  endsAt: number;
  state: EscrowState;
};

/**
 * The chain reads the sponsor flow needs. An interface so the funding/award rules can be tested
 * with a stub; `chainReader()` is the real one.
 */
export type EscrowReader = {
  /** factory.campaignOf(sponsor, ref): the clone that wallet funded for this ref, or null. */
  campaignOf(sponsor: string, ref: string): Promise<string | null>;
  clone(address: string): Promise<CloneFacts>;
};

const ZERO = '0x0000000000000000000000000000000000000000';

export function chainReader(): EscrowReader {
  const read = (address: string, functionName: string) =>
    escrowClient().readContract({
      address: address as `0x${string}`,
      abi: campaignAbi,
      functionName: functionName as 'state',
    }) as Promise<unknown>;
  return {
    async campaignOf(sponsor, ref) {
      const a = (await escrowClient().readContract({
        address: escrowConfig().factory,
        abi: campaignsAbi,
        functionName: 'campaignOf',
        args: [sponsor as `0x${string}`, ref as `0x${string}`],
      })) as string;
      return a.toLowerCase() === ZERO ? null : a.toLowerCase();
    },
    async clone(address) {
      const [sponsor, token, prize, fee, endsAt, state] = await Promise.all(
        ['sponsor', 'token', 'prize', 'fee', 'endsAt', 'state'].map((f) =>
          read(address, f),
        ),
      );
      return {
        sponsor: (sponsor as string).toLowerCase(),
        token: (token as string).toLowerCase(),
        prize: prize as bigint,
        fee: fee as bigint,
        endsAt: Number(endsAt),
        state: ESCROW_STATES[Number(state)],
      };
    },
  };
}

/** The clone's state and its pending operator fallback (executable from `fallbackExecutesAt`). */
export async function readEscrow(escrow: string) {
  const c = escrowClient();
  const read = (
    functionName: 'state' | 'fallbackHash' | 'fallbackAt' | 'FALLBACK_DELAY',
  ) =>
    c.readContract({
      address: escrow as `0x${string}`,
      abi: campaignAbi,
      functionName,
    }) as Promise<unknown>;
  const [state, hash, at, delay] = await Promise.all([
    read('state'),
    read('fallbackHash'),
    read('fallbackAt'),
    read('FALLBACK_DELAY'),
  ]);
  return {
    state: ESCROW_STATES[Number(state)],
    fallbackHash: hash as `0x${string}`,
    fallbackExecutesAt: /^0x0+$/.test(hash as string)
      ? null
      : new Date(Number((at as bigint) + (delay as bigint)) * 1000),
  };
}

/** Base makes a block about every 2 seconds. */
const BLOCK_SECONDS = 2;
/**
 * The first `getLogs` range size: Base's public RPC (mainnet.base.org) answers "eth_getLogs is
 * limited to a 2,000 range" above it. A provider with a smaller limit is learned at runtime.
 */
export const LOG_CHUNK = 2_000n;
/** Never ask for fewer blocks than this; a provider that refuses 100 blocks is broken. */
export const LOG_CHUNK_MIN = 100n;

/**
 * The first block an award could be in: an estimate of the block at `endsAt` (an award can't
 * happen before it), with 300 blocks of slack. Pure; exported for tests.
 */
export function awardSearchFrom(
  latest: bigint,
  latestTs: bigint,
  endsAt: number,
) {
  const back = (latestTs - BigInt(endsAt)) / BigInt(BLOCK_SECONDS) + 300n;
  return latest > back ? latest - back : 0n;
}

/** At most this many `getLogs` calls per check (refused and rate-limited ones included); a longer search resumes on the next check. */
export const LOG_CHUNKS_PER_CHECK = 8;

// What a range or result limit says ("limited to a 2,000 range", "block range is too large",
// "query returned more than 10000 results", "too many blocks", "Maximum allowed number of
// requested blocks is 1000", "ranges over 10000 blocks are not supported"). "Too many requests"
// is a rate limit, not a range limit.
const RANGE_WORDS =
  /\branges?\b|limited to|more than [^\n]{0,40}results|too many(?! requests)|requested blocks/i;
const RATE_WORDS =
  /rate.?limit|too many requests|request (count|rate)|exceeded/i;

/**
 * What a failed `getLogs` means: `range` when the RPC refuses the range as too large (only when
 * its message says so), with the largest size it names (null: none); `rate` for a rate limit
 * (HTTP 429, or -32005/-32614/-32016 or rate wording without range wording); null for anything
 * else. Walks viem's `cause` chain; each text is cut to 2 KB first (a proxy's HTML page can be
 * large). Pure; exported for tests.
 */
export function logError(
  err: unknown,
): { kind: 'range'; limit: bigint | null } | { kind: 'rate' } | null {
  let range = false;
  let rate = false;
  let limit: bigint | null = null;
  for (
    let e = err as Record<string, unknown> | undefined, i = 0;
    e && i < 8;
    e = e.cause as never, i++
  ) {
    const text = [e.message, e.details, e.shortMessage]
      .filter((t) => typeof t === 'string')
      .map((t) => (t as string).slice(0, 2048))
      .join(' ');
    if (RANGE_WORDS.test(text)) range = true;
    if (
      e.status === 429 ||
      e.code === -32005 ||
      e.code === -32614 ||
      e.code === -32016 ||
      RATE_WORDS.test(text)
    )
      rate = true;
    if (limit === null) {
      const pair = text.match(/\[\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*\]/i);
      const n =
        text.match(/limited to (?:a )?([\d,]+)(k?)/i) ??
        text.match(
          /max(?:imum)?(?: block)? range(?: of| is|:)?\s*([\d,]+)(k?)/i,
        ) ??
        text.match(/requested blocks is\s*([\d,]+)(k?)/i) ??
        text.match(/ranges? over\s*([\d,]+)(k?)/i) ??
        text.match(/([\d,]+)(k?)\s*-?\s*block range/i) ??
        text.match(/range (?:limit|of|is)\s*(?:of\s*)?([\d,]+)(k?)/i);
      if (pair) limit = BigInt(pair[2]) - BigInt(pair[1]) + 1n;
      else if (n)
        limit = BigInt(n[1].replace(/,/g, '') || '0') * (n[2] ? 1000n : 1n);
      if (limit !== null && limit <= 0n) limit = null;
    }
  }
  if (range) return { kind: 'range', limit };
  return rate ? { kind: 'rate' } : null;
}

/** Waits before retrying a rate-limited `getLogs` (then the check gives up). */
export const RATE_BACKOFF_MS = [250, 1_000, 3_000];

/**
 * Searches `floor..hi` newest first, where `hi` is `resumeHi` (where the previous check stopped)
 * or `latest`, calling `get(lo, hi)` on ranges of at most `chunk` blocks (2,000 at the start of
 * every check), at most `maxCalls` times. A range the RPC refuses as too large is retried
 * smaller: the size it names, or half, never below `LOG_CHUNK_MIN` (then the error is thrown). A
 * rate limit is retried after 250 ms, 1 s and 3 s; then the check stops with `rateLimited`. Other
 * errors are thrown. Returns the first hit and `next`: where to resume, or null when the search
 * reached `floor`.
 */
export async function scanLogsNewestFirst<T>(a: {
  latest: bigint;
  floor: bigint;
  resumeHi: bigint | null;
  chunk?: bigint;
  maxCalls?: number;
  get: (lo: bigint, hi: bigint) => Promise<T | null>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ found: T | null; next: bigint | null; rateLimited?: true }> {
  const sleep =
    a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let chunk = a.chunk ?? LOG_CHUNK;
  let backoffs = 0;
  let hi = a.resumeHi !== null && a.resumeHi < a.latest ? a.resumeHi : a.latest;
  for (
    let calls = 0;
    hi >= a.floor && calls < (a.maxCalls ?? LOG_CHUNKS_PER_CHECK);
    calls++
  ) {
    const lo = hi - chunk + 1n > a.floor ? hi - chunk + 1n : a.floor;
    let found: T | null;
    try {
      found = await a.get(lo, hi);
    } catch (err) {
      const kind = logError(err);
      if (kind?.kind === 'rate') {
        if (backoffs === RATE_BACKOFF_MS.length)
          return { found: null, next: hi, rateLimited: true };
        await sleep(RATE_BACKOFF_MS[backoffs++]);
        continue;
      }
      const size = hi - lo + 1n;
      if (kind?.kind !== 'range' || size <= LOG_CHUNK_MIN) throw err;
      const smaller =
        kind.limit !== null && kind.limit < size ? kind.limit : size / 2n;
      chunk = smaller > LOG_CHUNK_MIN ? smaller : LOG_CHUNK_MIN;
      continue;
    }
    if (found !== null) return { found, next: null };
    hi = lo - 1n;
  }
  return { found: null, next: hi >= a.floor ? hi : null };
}

/**
 * The clone's `Awarded` event (there is at most one), searched newest first from the latest block
 * (or `resumeHi`) down to the estimated block at `endsAt`, at most `LOG_CHUNKS_PER_CHECK` calls
 * per check. `{ log: null, next }` means not found yet: resume from `next` (null: the whole range
 * was searched).
 */
export async function readAwardedLog(
  escrow: string,
  endsAt: number,
  resumeHi: bigint | null,
) {
  const c = escrowClient();
  const latest = await c.getBlock();
  const scan = await scanLogsNewestFirst({
    latest: latest.number,
    floor: awardSearchFrom(latest.number, latest.timestamp, endsAt),
    resumeHi,
    get: async (lo, hi) => {
      const [log] = await c.getContractEvents({
        address: escrow as `0x${string}`,
        abi: campaignAbi,
        eventName: 'Awarded',
        fromBlock: lo,
        toBlock: hi,
      });
      return log
        ? {
            winners: [...log.args.winners!],
            amounts: [...log.args.amounts!],
            fee: log.args.fee!,
            tx: log.transactionHash,
          }
        : null;
    },
  });
  return { log: scan.found, next: scan.next, rateLimited: !!scan.rateLimited };
}
