/**
 * Onchain evidence rows for one contract: verified source, deployer, transactions and distinct senders in
 * 90 and 30 days, and how many of up to 50 sampled senders paid gas from a balance the deployer did not hand
 * them (a count within the sample, `funded_sample` senders read; never scaled to all senders).
 * Every row is a read fact; a failed read leaves the row null and the note says why. Never throws.
 */
import { type Explorer, ExplorerError, OldestNotReachedError, type Tx } from './explorers';

export type OnchainRows = {
  chain: string;
  address: string;
  mainnet: boolean | null;
  is_contract: boolean | null;
  verified_source: boolean | null;
  deployer: string | null;
  deployed_at: string | null;
  deployer_matches_repo: boolean | null;
  tx_90d: number | null;
  senders_90d: number | null;
  senders_30d: number | null;
  funded_senders_90d: number | null;
  funded_sample: number | null;
  first_tx_at: string | null;
  note: string | null;
};

/** Senders whose funding is read, newest first: one explorer request each way per sender. */
export const SENDER_SAMPLE = 50;
/** Oldest transactions read each way per sampled sender: enough to see the first funding and first call. */
export const SENDER_FIRST = 2;
/** Transactions read per contract: 20 pages of 50. */
const TX_MAX = 1000;
const DAY = 86_400_000;
/** A deployer handing gas within this window before a sender's first call marks a farmed sender. */
const FUNDED_WINDOW_MS = DAY;

/**
 * Whether a sender's first transaction is an incoming transfer from the deployer or the contract itself,
 * at most 24 hours before the sender's first outgoing one. `first` is the sender's oldest transactions. Pure.
 */
export function isDeployerFunded(first: Tx[], deployer: string | null, address: string): boolean {
  const funders = new Set([address.toLowerCase(), ...(deployer ? [deployer.toLowerCase()] : [])]);
  const txs = [...first].sort((a, b) => a.at.localeCompare(b.at));
  // The sender is the address on every one of its transactions.
  let common: string[] | null = null;
  for (const t of txs) {
    const ends = [t.from, t.to].filter((x): x is string => !!x).map((x) => x.toLowerCase());
    common = common ? common.filter((x) => ends.includes(x)) : ends;
  }
  const sender = (common ?? []).find((x) => !funders.has(x));
  if (!sender) return false;
  const firstTx = txs[0];
  const fundedBy = firstTx.to?.toLowerCase() === sender && funders.has(firstTx.from.toLowerCase());
  if (!fundedBy || firstTx.is_error || BigInt(firstTx.value_wei || '0') === BigInt(0)) return false;
  const out = txs.find((t) => t.from.toLowerCase() === sender);
  if (!out) return false;
  const gap = Date.parse(out.at) - Date.parse(firstTx.at);
  return gap >= 0 && gap <= FUNDED_WINDOW_MS;
}

const failNote = (e: unknown) =>
  e instanceof ExplorerError && e.status ? `not read: explorer ${e.status}` : 'not read: explorer unreachable';

/** Reads one contract's rows through `explorer`. Never throws: what fails is null with a note. */
export async function readContract(
  chain: string,
  address: string,
  o: { explorer: Explorer | null; repoAddresses: string[]; now: Date },
): Promise<OnchainRows> {
  const a = address.toLowerCase();
  const rows: OnchainRows = {
    chain, address: a, mainnet: null, is_contract: null, verified_source: null, deployer: null, deployed_at: null,
    deployer_matches_repo: null, tx_90d: null, senders_90d: null, senders_30d: null, funded_senders_90d: null,
    funded_sample: null, first_tx_at: null, note: null,
  };
  if (!o.explorer) return { ...rows, note: `not read: no explorer for ${chain}` };
  const ex = o.explorer;
  // Every chain with an explorer reader is read on its mainnet.
  rows.mainnet = true;
  const notes: string[] = [];
  try {
    const info = await ex.contractInfo(chain, a);
    rows.is_contract = info.is_contract;
    rows.verified_source = info.verified_source;
    rows.deployer = info.deployer;
    rows.deployed_at = info.deployed_at;
    if (info.deployer) {
      const repo = new Set(o.repoAddresses.map((x) => x.toLowerCase()));
      rows.deployer_matches_repo = repo.has(info.deployer.toLowerCase());
    }

    const since90 = new Date(o.now.getTime() - 90 * DAY);
    const since30 = o.now.getTime() - 30 * DAY;
    const txs = await ex.txsTo(chain, a, since90, TX_MAX);
    rows.tx_90d = txs.length;
    if (txs.length >= TX_MAX) notes.push(`counted the latest ${TX_MAX} transactions only`);
    const ok = txs.filter((t) => !t.is_error);
    const senders = [...new Set(ok.map((t) => t.from))];
    rows.senders_90d = senders.length;
    rows.senders_30d = new Set(ok.filter((t) => Date.parse(t.at) >= since30).map((t) => t.from)).size;

    const first = await ex.firstTxs(chain, a, 1);
    rows.first_tx_at = first.find((t) => t.to === a)?.at ?? first[0]?.at ?? null;

    const sample = senders.slice(0, SENDER_SAMPLE);
    let decided = 0;
    let funded = 0;
    for (const s of sample) {
      try {
        const own = await ex.firstTxs(chain, s, SENDER_FIRST);
        decided++;
        if (!isDeployerFunded(own, info.deployer, a)) funded++;
      } catch (e) {
        // Only an unreached history makes a sender unknown; any other failure stops the read with its status.
        if (!(e instanceof OldestNotReachedError)) throw e;
      }
    }
    // The basis: senders whose first transactions were read.
    rows.funded_sample = decided;
    rows.funded_senders_90d = decided || !sample.length ? funded : null;
    if (decided < sample.length) notes.push(`${sample.length - decided} of ${sample.length} sampled senders not read`);
  } catch (e) {
    notes.unshift(failNote(e));
  }
  rows.note = notes.length ? notes.join('; ') : null;
  return rows;
}
