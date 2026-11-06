/**
 * Keyless Blockscout reads for a chain's contracts: what a contract is, the transactions sent to it, and an
 * address's first transactions. Throttled to 5 requests a second per host; a 429 is retried once after a
 * second, a second 429 (or a 403, a missing user agent) is an ExplorerError with its status.
 */
import { CHAIN_REGISTRY, isKnownChain } from '../v5/chains';

export class ExplorerError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ExplorerError';
  }
}

export type Tx = { hash: string; from: string; to: string | null; at: string; value_wei: string; is_error: boolean };
export type ContractInfo = {
  is_contract: boolean;
  verified_source: boolean;
  name: string | null;
  deployer: string | null;
  deployed_at: string | null;
  created_tx: string | null;
};
export type Explorer = {
  contractInfo(chain: string, address: string): Promise<ContractInfo>;
  txsTo(chain: string, address: string, since: Date, max: number): Promise<Tx[]>;
  firstTxs(chain: string, address: string, n: number): Promise<Tx[]>;
};

// Blockscout answers 403 to a bare client.
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; EarnKit-verifier/1)', Accept: 'application/json' };
const GAP_MS = 200; // 5 requests a second per host
const RETRY_MS = 1000;
const TIMEOUT_MS = 20_000;
const nextSlot = new Map<string, number>();

type Opts = { gapMs?: number; sleep?: (ms: number) => Promise<void> };
type RawTx = { hash: string; from: { hash: string }; to: { hash: string } | null; timestamp: string; value: string; status: string | null };
type Page = { items: RawTx[]; next_page_params: Record<string, string | number> | null };

const lower = (a: string) => a.toLowerCase();
const toTx = (t: RawTx): Tx => ({
  hash: t.hash,
  from: lower(t.from.hash),
  to: t.to ? lower(t.to.hash) : null,
  at: new Date(t.timestamp).toISOString(),
  value_wei: t.value,
  is_error: t.status === 'error',
});
const query = (p: Record<string, string | number | null | undefined>) =>
  Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');

/** A Blockscout v2 reader at `base` (for example https://base.blockscout.com/api/v2). */
export function blockscout(base: string, f: typeof fetch = fetch, o: Opts = {}): Explorer {
  const gap = o.gapMs ?? GAP_MS;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const host = new URL(base).host;

  async function throttle() {
    if (gap <= 0) return;
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + gap);
    if (at > now) await sleep(at - now);
  }

  /** The JSON at `path`, or null on a 404. */
  async function get<T>(path: string): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
      await throttle();
      let res: Response;
      try {
        res = await f(`${base}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new ExplorerError('explorer unreachable');
      }
      if (res.status === 429 && attempt === 0) {
        await sleep(RETRY_MS);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new ExplorerError(`explorer ${res.status}`, res.status);
      try {
        return (await res.json()) as T;
      } catch {
        throw new ExplorerError('explorer answer unreadable');
      }
    }
  }

  async function contractInfo(_chain: string, address: string): Promise<ContractInfo> {
    const a = lower(address);
    const none: ContractInfo = { is_contract: false, verified_source: false, name: null, deployer: null, deployed_at: null, created_tx: null };
    const addr = await get<{ is_contract?: boolean; creator_address_hash?: string | null; creation_transaction_hash?: string | null }>(
      `/addresses/${a}`,
    );
    if (!addr?.is_contract) return none;
    // A 404 here means no verified source, not a failed read.
    const sc = await get<{ is_verified?: boolean; name?: string | null }>(`/smart-contracts/${a}`);
    const created = addr.creation_transaction_hash ?? null;
    const ctx = created ? await get<{ timestamp?: string }>(`/transactions/${created}`) : null;
    return {
      is_contract: true,
      verified_source: sc?.is_verified === true,
      name: sc?.is_verified ? (sc.name ?? null) : null,
      deployer: addr.creator_address_hash ? lower(addr.creator_address_hash) : null,
      deployed_at: ctx?.timestamp ? new Date(ctx.timestamp).toISOString() : null,
      created_tx: created ? lower(created) : null,
    };
  }

  async function txsTo(_chain: string, address: string, since: Date, max: number): Promise<Tx[]> {
    const out: Tx[] = [];
    let next: Page['next_page_params'] = null;
    for (;;) {
      const page: Page | null = await get<Page>(`/addresses/${lower(address)}/transactions?${query({ filter: 'to', ...(next ?? {}) })}`);
      for (const t of page?.items ?? []) {
        const tx = toTx(t);
        if (Date.parse(tx.at) < since.getTime()) return out;
        out.push(tx);
        if (out.length >= max) return out;
      }
      next = page?.next_page_params ?? null;
      if (!next) return out;
    }
  }

  /** The oldest `n` transactions one way (`from` or `to`), at most 2 pages; throws when the oldest is not reached. */
  async function oldest(address: string, filter: 'from' | 'to', n: number): Promise<Tx[]> {
    const seen: Tx[] = [];
    let next: Page['next_page_params'] = null;
    for (let pages = 0; pages < 2; pages++) {
      const page: Page | null = await get<Page>(
        `/addresses/${lower(address)}/transactions?${query({ filter, sort: 'block_number', order: 'asc', ...(next ?? {}) })}`,
      );
      const txs = (page?.items ?? []).map(toTx);
      seen.push(...txs);
      next = page?.next_page_params ?? null;
      // Ascending as asked: the first page holds the oldest.
      const ascending = txs.length < 2 || txs[0].at <= txs[txs.length - 1].at;
      if (ascending || !next) return seen.sort((x, y) => x.at.localeCompare(y.at)).slice(0, n);
    }
    throw new ExplorerError('explorer oldest transactions not reached');
  }

  async function firstTxs(_chain: string, address: string, n: number): Promise<Tx[]> {
    const out = await oldest(address, 'from', n);
    out.push(...(await oldest(address, 'to', n)));
    return out.sort((x, y) => x.at.localeCompare(y.at));
  }

  return { contractInfo, txsTo, firstTxs };
}

/** The reader for a registered chain, or null when the registry has no explorer API for it. */
export function explorerFor(chain: string, f?: typeof fetch): Explorer | null {
  const api = isKnownChain(chain) ? CHAIN_REGISTRY[chain].explorer_api : null;
  return api ? blockscout(api, f) : null;
}
