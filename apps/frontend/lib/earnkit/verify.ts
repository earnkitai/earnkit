import { createPublicClient, http, isAddress } from 'viem';
import { alchemyCall, alchemyTxCount } from './alchemy';
import type { Chain } from './chains';
import { sql } from './db';
import { mainnetExplorerHosts } from './match';
import { placeholderLink } from './placeholder';
import { ErrorPageError, safeProbe } from './safe-fetch';
import { canonicalBuilderUrl, plainText } from './untrusted-text';

/**
 * v2.9 A5: link and contract checks. A builder's live link is probed (safeProbe: a 2xx that isn't
 * an error page, v2.10 item 14; the error's phrase is cached as the row's note), and a
 * contract on the program chain's mainnet must have code (eth_getCode). Results are cached in
 * `url_checks`: a pass for 24 h, a failure for 1 h. Every check is bounded by a CheckBudget, and
 * none ever throws: an error is a failure, except an RPC error on getCode, which is "couldn't check"
 * (null, never cached; Ruling G15). The pure link rules live in placeholder.ts (P48).
 */
export {
  LIVE_FAILED_LINE,
  PLACEHOLDER_LINE,
  contractMissingLine,
  contractUncheckedLine,
  liveErrorLine,
  placeholderHost,
  placeholderLink,
} from './placeholder';

/** Deployed code: not empty, not `0x`, and not an EIP-7702 delegation (`0xef0100` + an address). Pure. */
export const hasCode = (code: string): boolean => {
  const c = (code ?? '').toLowerCase();
  return c.length > 2 && c !== '0x' && !c.startsWith('0xef0100');
};

/** A cached check still answers: a pass for 24 h, a failure for 1 h. Pure. */
export const cacheFresh = (row: { ok: boolean; checked_at: Date }, now: Date): boolean =>
  now.getTime() - row.checked_at.getTime() < (row.ok ? 24 : 1) * 3_600_000;

const RPC_ENV: Record<Chain, string> = {
  base: 'BASE_RPC_URL',
  arc: 'ARC_RPC_URL',
  monad: 'MONAD_RPC_URL',
  tempo: 'TEMPO_RPC_URL',
  avalanche: 'AVALANCHE_RPC_URL',
  robinhood: 'ROBINHOOD_RPC_URL',
};

/**
 * Public mainnet RPCs from each chain's official docs (checked 2026-10-08). All are rate-limited;
 * the owner can set the chain's variable instead.
 */
const RPC_DEFAULTS: Partial<Record<Chain, string>> = {
  // https://docs.base.org/base-chain/quickstart/connecting-to-base
  base: 'https://mainnet.base.org',
  // https://docs.arc.io/arc/references/connect-to-arc
  arc: 'https://rpc.mainnet.arc.io',
  // https://docs.monad.xyz/developer-essentials/network-information
  monad: 'https://rpc.monad.xyz',
  // https://tempo.xyz/developers/docs/quickstart/connection-details
  tempo: 'https://rpc.tempo.xyz',
  // https://build.avax.network/docs/primary-network
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  // https://docs.robinhood.com/chain/connecting/
  robinhood: 'https://rpc.mainnet.chain.robinhood.com',
};

/**
 * Plan Ruling 18: the chain's mainnet RPC: its variable, else the public default, else null (then
 * contract checks read "couldn't check", never a pass). Pure given `env`.
 */
export function rpcFor(chain: Chain, env: Record<string, string | undefined> = process.env): string | null {
  const name = RPC_ENV[chain];
  const set = name ? env[name]?.trim() : undefined;
  return set || RPC_DEFAULTS[chain] || null;
}

/**
 * How many live link probes, getCode calls and (v2.10 item 6) Blockscout counter reads one tool
 * call may make (Pre-flight P25). `txCounts` defaults to 0 (Pre-flight P27).
 */
export class CheckBudget {
  private probes: number;
  private getCodes: number;
  private txCounts: number;
  constructor(limits: { probes: number; getCodes: number; txCounts?: number }) {
    this.probes = limits.probes;
    this.getCodes = limits.getCodes;
    this.txCounts = limits.txCounts ?? 0;
  }
  takeProbe(): boolean {
    if (this.probes <= 0) return false;
    this.probes--;
    return true;
  }
  takeGetCode(): boolean {
    if (this.getCodes <= 0) return false;
    this.getCodes--;
    return true;
  }
  takeTxCount(): boolean {
    if (this.txCounts <= 0) return false;
    this.txCounts--;
    return true;
  }
}

/** list_programs: at most 5 probes, 6 getCode calls and 2 Blockscout counter reads per call (R4). */
export const LIST_BUDGET = { probes: 5, getCodes: 6, txCounts: 2 };
/** One entry step (prepare_submission, confirm_entry, record_submission); get_program's eligibility check reads 1 counter (R4). */
export const ENTRY_BUDGET = { probes: 1, getCodes: 2, txCounts: 1 };
/** At most 2 contracts are checked per repo. */
export const GETCODE_PER_REPO = 2;

/** Where checks are cached (default: the url_checks table; Pre-flight P26 lets tests use a map). */
export type CheckCache = {
  get: (key: string) => Promise<{ ok: boolean; checked_at: Date; note?: string | null; n?: number | null } | null>;
  /** `extra.note`: why a check failed (an error page's phrase); `extra.n`: a count (T3's tx count). */
  set: (key: string, ok: boolean, now: Date, extra?: { note?: string | null; n?: number | null }) => Promise<void>;
};

export type CheckDeps = {
  probe?: (url: string) => Promise<void>;
  getCode?: (rpc: string, address: string) => Promise<string>;
  /** v2.10 item 6: how many transactions went to `address` on Base (capped at TX_COUNT_CAP); throws on any failure. */
  txCounter?: (address: string) => Promise<number>;
  now?: Date;
  budget?: CheckBudget;
  cache?: CheckCache;
};

/**
 * Process-wide defaults under each call's own deps. Empty in production (safeProbe, viem getCode,
 * url_checks); the test suites set them once (fixtures/no-network-checks.ts) so no test reaches
 * the network.
 */
export const checkDefaults: Omit<CheckDeps, 'budget' | 'now'> = {};

const dbCache: CheckCache = {
  get: async (key) => {
    const [row] = await sql()<{ ok: boolean; checked_at: Date; note: string | null; n: number | null }[]>`
      SELECT ok, checked_at, note, n FROM url_checks WHERE key = ${key}`;
    return row ?? null;
  },
  set: async (key, ok, now, extra) => {
    const note = extra?.note ?? null;
    const n = extra?.n ?? null;
    await sql()`
      INSERT INTO url_checks (key, ok, checked_at, note, n) VALUES (${key}, ${ok}, ${now}, ${note}, ${n})
      ON CONFLICT (key) DO UPDATE SET ok = EXCLUDED.ok, checked_at = EXCLUDED.checked_at, note = EXCLUDED.note, n = EXCLUDED.n`;
  },
};

const errorClass = (err: unknown) => (err instanceof Error ? err.name : 'error');

const viemGetCode = async (rpc: string, address: string): Promise<string> => {
  const client = createPublicClient({ transport: http(rpc, { timeout: 5_000, retryCount: 0 }) });
  return (await client.getCode({ address: address as `0x${string}` })) ?? '';
};

/**
 * The cached answer for `key` (with its note), else one budgeted check (`take`), cached. No budget
 * left: `spent`, nothing written. Never throws: a failed check, cache read or write is logged by
 * class only. A check that throws is false and cached, unless `errorIsUnchecked`: then it is
 * `spent` and nothing is written (Ruling G15: an RPC error, timeout or 429 is "couldn't check",
 * never "no code"). A check may answer a note (why it failed), cached with it.
 */
async function cachedCheck<T>(a: {
  kind: 'live' | 'getcode';
  key: string;
  deps: CheckDeps;
  take: (b: CheckBudget) => boolean;
  spent: T;
  run: () => Promise<{ ok: boolean; note?: string | null }>;
  errorIsUnchecked?: boolean;
}): Promise<{ ok: boolean | T; note: string | null }> {
  const cache = a.deps.cache ?? checkDefaults.cache ?? dbCache;
  const now = a.deps.now ?? new Date();
  const row = await cache.get(a.key).catch((err: unknown) => {
    console.error(`[verify] ${a.kind} cache read ${errorClass(err)}`);
    return null;
  });
  if (row && cacheFresh(row, now)) return { ok: row.ok, note: row.note ?? null };
  if (a.deps.budget && !a.take(a.deps.budget)) return { ok: a.spent, note: null };
  let result: { ok: boolean; note?: string | null };
  try {
    result = await a.run();
  } catch (err) {
    console.error(`[verify] ${a.kind} ${errorClass(err)}`);
    if (a.errorIsUnchecked) return { ok: a.spent, note: null };
    result = { ok: false };
  }
  const note = result.note ?? null;
  await cache
    .set(a.key, result.ok, now, note === null ? undefined : { note })
    .catch((err: unknown) => console.error(`[verify] ${a.kind} cache write ${errorClass(err)}`));
  return { ok: result.ok, note };
}

/** A fresh cached answer for `key`, else null (never a check, never a budget slot). */
async function peek(kind: 'live' | 'getcode', key: string, deps: CheckDeps): Promise<boolean | null> {
  const cache = deps.cache ?? checkDefaults.cache ?? dbCache;
  const row = await cache.get(key).catch((err: unknown) => {
    console.error(`[verify] ${kind} cache read ${errorClass(err)}`);
    return null;
  });
  return row && cacheFresh(row, deps.now ?? new Date()) ? row.ok : null;
}

/**
 * Ruling G5: what a live check would answer without a probe: a placeholder is false, a fresh
 * cached result is itself, else null (needs a probe slot).
 */
export async function peekLive(url: string, deps: CheckDeps = {}): Promise<boolean | null> {
  const canonical = canonicalBuilderUrl(url).url;
  if (!canonical || placeholderLink(canonical)) return false;
  return peek('live', `url:${canonical}`, deps);
}

/** Ruling G5: a contract check's fresh cached answer, else null (needs a getCode slot). */
export async function peekContract(chain: Chain, address: string, deps: CheckDeps = {}): Promise<boolean | null> {
  if (!isAddress(address, { strict: false })) return false;
  return peek('getcode', `getcode:${chain}:${address.toLowerCase()}`, deps);
}

/**
 * v2.9 A5: the live link loads from here (safeProbe: a 2xx that isn't an error page, on a public
 * address). A placeholder link is false without a probe. Cache key `url:<canonical url>`.
 */
export async function liveVerified(url: string, deps: CheckDeps = {}): Promise<boolean> {
  return (await liveChecked(url, deps)) === true;
}

/** v2.9 Ruling G4: liveVerified, but null when no probe was left (not checked, never a failure). */
export async function liveChecked(url: string, deps: CheckDeps = {}): Promise<boolean | null> {
  return (await liveCheckDetail(url, deps)).ok;
}

/**
 * v2.10 item 14: liveChecked, plus the error phrase when the link loads an error page (`error`,
 * cached as the row's note for the failure's hour); null for any other answer.
 */
export async function liveCheckDetail(url: string, deps: CheckDeps = {}): Promise<{ ok: boolean | null; error: string | null }> {
  const canonical = canonicalBuilderUrl(url).url;
  if (!canonical || placeholderLink(canonical)) return { ok: false, error: null };
  const probe = deps.probe ?? checkDefaults.probe ?? ((u: string) => safeProbe(u));
  const r = await cachedCheck({
    kind: 'live',
    key: `url:${canonical}`,
    deps,
    take: (b) => b.takeProbe(),
    spent: null,
    run: async () => {
      try {
        await probe(canonical);
      } catch (err) {
        // The phrase is the page's own text: allowlisted to one plain line (double quotes become ').
        if (err instanceof ErrorPageError) return { ok: false, note: plainText(err.phrase, true).trim() || null };
        throw err;
      }
      return { ok: true };
    },
  });
  return { ok: r.ok, error: r.ok === false ? r.note : null };
}

/**
 * v2.9 A5: `address` has code on `chain`'s mainnet. null: no RPC for the chain, no budget left, or
 * the RPC call failed (an error, timeout or 429; Ruling G15): "couldn't check", never a pass and
 * never cached. Only a real answer is cached. Cache key `getcode:<chain>:<lowercase address>`.
 */
export async function contractDeployed(chain: Chain, address: string, deps: CheckDeps = {}): Promise<boolean | null> {
  const rpc = rpcFor(chain);
  if (!rpc) return null;
  if (!isAddress(address, { strict: false })) return false;
  const addr = address.toLowerCase();
  const getCode = deps.getCode ?? checkDefaults.getCode ?? viemGetCode;
  return cachedCheck({
    kind: 'getcode',
    key: `getcode:${chain}:${addr}`,
    deps,
    take: (b) => b.takeGetCode(),
    spent: null,
    run: async () => ({ ok: hasCode(await getCode(rpc, addr)) }),
    errorIsUnchecked: true,
  }).then((r) => r.ok);
}

/**
 * v2.10 item 13: a contract EarnKit just deployed for a builder (its code checked): the A5 cache
 * holds a fresh pass under contractDeployed's key, so the entry counts it as deployed with no RPC.
 */
export async function markDeployed(chain: Chain, address: string, now = new Date()): Promise<void> {
  await dbCache.set(`getcode:${chain}:${address.toLowerCase()}`, true, now);
}

/**
 * v2.10 item 6: counts are read on Base only, through Alchemy (never Blockscout, owner ruling: it challenges
 * servers). Every use of a count stops at 50 (match.ts REAL_USE_TX and the odds band), so a read stops at
 * TX_COUNT_CAP: one Alchemy page, never a full history.
 */
const TX_COUNT_CHAINS: ReadonlySet<Chain> = new Set<Chain>(['base']);
export const TX_COUNT_CAP = 100;
const alchemyCounter = (address: string) => alchemyTxCount(address, alchemyCall(Date.now() + 5_000), TX_COUNT_CAP);

/** v2.10 Ruling H5 (I3): a fresh cached transaction count for `address` on `chain`, else null (never a read, never a slot). */
export async function peekTxCount(chain: Chain, address: string, deps: CheckDeps = {}): Promise<number | null> {
  if (!TX_COUNT_CHAINS.has(chain) || !isAddress(address, { strict: false })) return null;
  const cache = deps.cache ?? checkDefaults.cache ?? dbCache;
  const row = await cache.get(`txcount:${chain}:${address.toLowerCase()}`).catch((err: unknown) => {
    console.error(`[verify] txcount cache read ${errorClass(err)}`);
    return null;
  });
  return row?.ok && typeof row.n === 'number' && cacheFresh(row, deps.now ?? new Date()) ? row.n : null;
}

/**
 * v2.10 item 6 (R4): how many transactions went to an address on `chain` (Alchemy, at most TX_COUNT_CAP).
 * Base only. A read is cached 24 h in url_checks (key
 * `txcount:<chain>:<lowercase addr>`, the count in `n`); a failed read is not cached. Null on
 * another chain, on any error, or with no budget left. Never throws.
 */
export async function txCount(chain: Chain, address: string, deps: CheckDeps = {}): Promise<number | null> {
  if (!TX_COUNT_CHAINS.has(chain) || !isAddress(address, { strict: false })) return null;
  const addr = address.toLowerCase();
  const key = `txcount:${chain}:${addr}`;
  const cache = deps.cache ?? checkDefaults.cache ?? dbCache;
  const now = deps.now ?? new Date();
  const cached = await peekTxCount(chain, addr, deps);
  if (cached !== null) return cached;
  if (deps.budget && !deps.budget.takeTxCount()) return null;
  const read = deps.txCounter ?? checkDefaults.txCounter ?? alchemyCounter;
  let n: number;
  try {
    n = await read(addr);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('no count');
  } catch (err) {
    console.error(`[verify] txcount ${errorClass(err)}`);
    return null;
  }
  await cache.set(key, true, now, { n }).catch((err: unknown) => console.error(`[verify] txcount cache write ${errorClass(err)}`));
  return n;
}

const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;

/** The address an explorer link on `chain`'s mainnet explorer points to (`/address/0x...`), or null. */
function explorerAddress(liveUrl: string, chain: Chain): string | null {
  if (!URL.canParse(liveUrl)) return null;
  const u = new URL(liveUrl);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!mainnetExplorerHosts(chain).includes(host)) return null;
  return u.pathname.match(/^\/address\/(0x[0-9a-fA-F]{40})\/?$/)?.[1] ?? null;
}

/**
 * v2.9 A5: the contracts to check for an entry, at most GETCODE_PER_REPO, lowercase: the
 * `contracts` or `contract_address` answers, an explorer `/address/0x...` live link on that
 * chain's mainnet explorer, then stored contracts (the project info, the entry, local_repos). Pure.
 */
export function addressesFrom(a: {
  answers: Record<string, string>;
  liveUrl?: string | null;
  chain: Chain;
  stored?: string[] | null;
}): string[] {
  const fromAnswers = [a.answers.contracts, a.answers.contract_address]
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.match(ADDRESS) ?? []);
  const fromLink = a.liveUrl ? explorerAddress(a.liveUrl, a.chain) : null;
  const all = [...fromAnswers, ...(fromLink ? [fromLink] : []), ...(a.stored ?? []).filter((s) => isAddress(s, { strict: false }))];
  return [...new Set(all.map((x) => x.toLowerCase()))].slice(0, GETCODE_PER_REPO);
}

export type Verified = {
  live: boolean;
  /** v2.10 item 14: the error phrase when the live link loads an error page (set only then). */
  liveError?: string | null;
  contract: boolean | null;
  needsContract: Chain | null;
};

/**
 * v2.9 A5: one entry step's checks (one ENTRY_BUDGET unless `deps.budget` is given): the live
 * link, then, when the program needs a contract, up to 2 addresses on its chain. `contract`: true
 * when one has code, false when none named or none has code, null when none could be checked.
 */
export async function entryVerified(
  a: { liveUrl: string | null; needsContract: Chain | null; addresses: string[] },
  deps: CheckDeps = {},
): Promise<Verified> {
  const d = { ...deps, budget: deps.budget ?? new CheckBudget(ENTRY_BUDGET) };
  const detail = a.liveUrl ? await liveCheckDetail(a.liveUrl, d) : { ok: false, error: null };
  const live = detail.ok === true;
  const liveError = detail.error ? { liveError: detail.error } : {};
  if (!a.needsContract) return { live, ...liveError, contract: null, needsContract: null };
  // True when any address has code; else null when any check couldn't run (not "no contract");
  // else false.
  let contract: boolean | null = false;
  let unchecked = false;
  for (const address of a.addresses.slice(0, GETCODE_PER_REPO)) {
    const r = await contractDeployed(a.needsContract, address, d);
    if (r === true) {
      contract = true;
      break;
    }
    if (r === null) unchecked = true;
  }
  if (contract !== true && unchecked) contract = null;
  return { live, ...liveError, contract, needsContract: a.needsContract };
}
