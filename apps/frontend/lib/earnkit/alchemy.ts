import { ScoreDeadline } from './campaigns';

/**
 * Alchemy's Base API for wallet reads (2026-10-25): base.blockscout.com answers servers with a Cloudflare challenge.
 * ALCHEMY_API_KEY is the free key the other EarnKit services already use. Every read stops at `deadline` (epoch ms).
 */
export const alchemyOn = (env: Record<string, string | undefined> = process.env) => Boolean(env.ALCHEMY_API_KEY?.trim());

type Transfer = { hash?: string; from?: string; to?: string | null; metadata?: { blockTimestamp?: string } };
type TransferPage = { transfers?: Transfer[]; pageKey?: string };
export type AlchemyCall = <T>(method: string, params: unknown[]) => Promise<T>;

/** One JSON-RPC call to Alchemy's Base endpoint; an error answer or a non-2xx throws. */
export const alchemyCall = (deadline: number): AlchemyCall => async <T>(method: string, params: unknown[]): Promise<T> => {
  const left = deadline - Date.now();
  if (left <= 0) throw new ScoreDeadline();
  const res = await fetch(`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY?.trim()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(Math.min(20_000, left)),
  }).catch((err: unknown) => {
    if (deadline - Date.now() <= 0) throw new ScoreDeadline();
    throw err;
  });
  if (!res.ok) throw new Error(`Alchemy ${method} returned ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
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
