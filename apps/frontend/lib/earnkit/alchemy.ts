import { ScoreDeadline } from './campaigns';
import { WALLET_CHAINS, type WalletChain, type WalletContract } from './wallet-chains';

/**
 * Alchemy's Base API for wallet reads (2026-10-25): base.blockscout.com answers servers with a Cloudflare challenge.
 * ALCHEMY_API_KEY is the free key the other EarnKit services already use. Every read stops at `deadline` (epoch ms).
 * v3.1 Highlights competence (2026-10-25): the same key reads a proven wallet's own contracts on every WALLET_CHAINS
 * chain (alchemyWalletContracts).
 */
export const alchemyOn = (env: Record<string, string | undefined> = process.env) => Boolean(env.ALCHEMY_API_KEY?.trim());

type Transfer = { hash?: string; from?: string; to?: string | null; metadata?: { blockTimestamp?: string } };
type TransferPage = { transfers?: Transfer[]; pageKey?: string };
export type AlchemyCall = <T>(method: string, params: unknown[]) => Promise<T>;

/**
 * v3.1 Highlights competence: Alchemy answers "<NETWORK> is not enabled for this app" for a network the owner has not
 * switched on in its dashboard (an HTTP 403 or an error body). Its own error, so the chain is skipped, not failed.
 */
export class AlchemyNetworkOff extends Error {
  constructor(readonly network: string) {
    super(`Alchemy ${network} is not enabled for this app`);
    this.name = 'AlchemyNetworkOff';
  }
}
const NOT_ENABLED = /is not enabled for this app/i;

/**
 * One JSON-RPC call to Alchemy's endpoint for `network` (Base by default, so the wallet reads that predate the other
 * chains are unchanged); an error answer or a non-2xx throws, a network not switched on throws AlchemyNetworkOff.
 */
export const alchemyCall = (deadline: number, network = 'base-mainnet'): AlchemyCall => async <T>(method: string, params: unknown[]): Promise<T> => {
  const left = deadline - Date.now();
  if (left <= 0) throw new ScoreDeadline();
  const res = await fetch(`https://${network}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY?.trim()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(Math.min(20_000, left)),
  }).catch((err: unknown) => {
    if (deadline - Date.now() <= 0) throw new ScoreDeadline();
    throw err;
  });
  if (!res.ok) {
    if (NOT_ENABLED.test(await res.text().catch(() => ''))) throw new AlchemyNetworkOff(network);
    throw new Error(`Alchemy ${method} returned ${res.status}`);
  }
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error && NOT_ENABLED.test(body.error.message ?? '')) throw new AlchemyNetworkOff(network);
  if (body.error || body.result === undefined) throw new Error(`Alchemy ${method} failed`);
  return body.result;
};

const transfers = (call: AlchemyCall, q: Record<string, unknown>) =>
  call<TransferPage>('alchemy_getAssetTransfers', [{ category: ['external'], excludeZeroValue: false, withMetadata: true, ...q }]);
const secs = (t: Transfer) => Math.floor(Date.parse(t.metadata?.blockTimestamp ?? '') / 1000);

/**
 * `wallet`'s earliest `n` sent and `n` received transactions as an Etherscan-style txlist (oldest first), so
 * walletFirstTxFrom and walletSignalsFrom read it unchanged.
 */
export async function alchemyTxList(wallet: string, n: number, call: AlchemyCall): Promise<{ status: string; result: { timeStamp: number; from: string; to: string }[] }> {
  const maxCount = `0x${n.toString(16)}`;
  const [sent, got] = await Promise.all([
    transfers(call, { fromAddress: wallet, order: 'asc', maxCount }),
    transfers(call, { toAddress: wallet, order: 'asc', maxCount }),
  ]);
  const rows = [...(sent.transfers ?? []), ...(got.transfers ?? [])]
    .map((t) => ({ timeStamp: secs(t), from: (t.from ?? '').toLowerCase(), to: (t.to ?? '').toLowerCase() }))
    .filter((r) => Number.isFinite(r.timeStamp) && r.timeStamp > 0)
    .sort((a, b) => a.timeStamp - b.timeStamp);
  return { status: rows.length ? '1' : '0', result: rows };
}

/**
 * The contracts `wallet` created on Base, newest first: its sent transactions with no `to` (Alchemy gives an empty
 * one), at most `pages` pages of 1000, each one's address from its receipt (at most `max`).
 */
export async function alchemyCreations(wallet: string, call: AlchemyCall, o: { pages: number; max: number }): Promise<{ address: string; created_at: string }[]> {
  const made: Transfer[] = [];
  let pageKey: string | undefined;
  for (let i = 0; i < o.pages; i++) {
    const page = await transfers(call, { fromAddress: wallet, order: 'desc', maxCount: '0x3e8', ...(pageKey && { pageKey }) });
    made.push(...(page.transfers ?? []).filter((t) => !t.to && typeof t.hash === 'string'));
    pageKey = page.pageKey;
    if (!pageKey) break;
  }
  const kept = made.slice(0, o.max);
  const receipts = await Promise.all(kept.map((t) => call<{ contractAddress?: string | null; status?: string } | null>('eth_getTransactionReceipt', [t.hash])));
  const out: { address: string; created_at: string }[] = [];
  kept.forEach((t, i) => {
    const a = receipts[i]?.contractAddress?.toLowerCase();
    if (a && /^0x[0-9a-f]{40}$/.test(a) && receipts[i]?.status === '0x1' && t.metadata?.blockTimestamp) out.push({ address: a, created_at: t.metadata.blockTimestamp });
  });
  return out;
}

/** ERC-20's decimals() and totalSupply() selectors: a contract answering both is a token (never a Highlights contract). */
const DECIMALS = '0x313ce567';
const TOTAL_SUPPLY = '0x18160ddd';
/** How many transfers to a contract are looked at for one from another address (a small page: any one is enough). */
export const USED_SCAN = 10;
const WORD = /^0x[0-9a-f]{64}$/i;

/** Whether `address` answers `data` with one 32-byte word; a revert or an error answer is no (the deadline propagates). */
const answers = (call: AlchemyCall, address: string, data: string) =>
  call<string>('eth_call', [{ to: address, data }, 'latest']).then(
    (r) => typeof r === 'string' && WORD.test(r),
    (err: unknown) => {
      if (err instanceof ScoreDeadline) throw err;
      return false;
    },
  );

/**
 * Whether a contract `wallet` created counts as a Highlights contract: not a token (decimals() and totalSupply() do
 * not both answer) and used (some address other than the deployer sent it a transaction, among its USED_SCAN newest
 * external transfers), so coins and test deploys never count.
 */
export async function contractCounts(address: string, wallet: string, call: AlchemyCall): Promise<boolean> {
  const [decimals, supply] = await Promise.all([answers(call, address, DECIMALS), answers(call, address, TOTAL_SUPPLY)]);
  if (decimals && supply) return false;
  const page = await call<TransferPage>('alchemy_getAssetTransfers', [
    { category: ['external'], excludeZeroValue: false, toAddress: address, order: 'desc', maxCount: `0x${USED_SCAN.toString(16)}` },
  ]);
  const me = wallet.toLowerCase();
  return (page.transfers ?? []).some((t) => typeof t.from === 'string' && t.from.toLowerCase() !== me);
}

/** Networks already logged as not enabled (one line per process each, never per wallet). */
const offLogged = new Set<string>();

/**
 * v3.1 Highlights competence (2026-10-25): every contract `wallet` created itself (a top-level transaction with no
 * `to`, alchemyCreations' caps per chain) on every WALLET_CHAINS chain, each with `counts` (contractCounts). A chain
 * the owner has not enabled in Alchemy, or whose read fails, is left out (one log line) and read again next time; the
 * deadline (ScoreDeadline) propagates. `known` ("chain:address") already counted on an earlier read: a token never
 * stops being one and a used contract stays used, so those are not asked again. Chains are read side by side, one
 * contract at a time within a chain (Alchemy's free throughput).
 */
export async function alchemyWalletContracts(
  wallet: string,
  callFor: (network: string) => AlchemyCall,
  o: { pages: number; max: number; known?: Set<string> },
): Promise<WalletContract[]> {
  const perChain = await Promise.all(WALLET_CHAINS.map(async ({ chain, network }): Promise<WalletContract[]> => {
    const call = callFor(network);
    try {
      const out: WalletContract[] = [];
      for (const c of await alchemyCreations(wallet, call, o)) {
        const counts = o.known?.has(`${chain}:${c.address}`) || (await contractCounts(c.address, wallet, call));
        out.push({ chain: chain as WalletChain, address: c.address, created_at: c.created_at, counts });
      }
      return out;
    } catch (err) {
      if (err instanceof ScoreDeadline) throw err;
      if (err instanceof AlchemyNetworkOff) {
        if (!offLogged.has(network)) console.warn(`[alchemy] ${network} not enabled for this app, skipped`);
        offLogged.add(network);
      } else console.error(`[alchemy] ${chain} contracts`, err instanceof Error ? err.name : 'error');
      return [];
    }
  }));
  return perChain.flat();
}
