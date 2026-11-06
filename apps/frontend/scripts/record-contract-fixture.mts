// Records the explorer reads for one contract into lib/v6/fixtures/contracts/<slug>.json (real network, keyless).
// Usage: pnpm tsx apps/frontend/scripts/record-contract-fixture.mts base 0x<address> slug
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { explorerFor } from '../lib/v6/explorers';
import { readContract, SENDER_FIRST } from '../lib/v6/onchain';

const [chain, address, slug] = process.argv.slice(2);
if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(address ?? '') || !slug) throw new Error('usage: record-contract-fixture.mts chain 0xaddress slug');
const entries: Record<string, { status: number; body: string }> = {};
type Raw = Record<string, unknown> & { from?: { hash: string }; to?: { hash: string } | null };
// Keep only what the reader uses: a full Blockscout answer is large. URL, status and body only, never headers.
const slimTx = (t: Raw) => ({
  hash: t.hash, from: { hash: t.from!.hash }, to: t.to ? { hash: t.to.hash } : null,
  timestamp: t.timestamp, value: t.value, status: t.status,
});
function slim(url: string, body: string): string {
  const d = JSON.parse(body) as Record<string, unknown>;
  const path = new URL(url).pathname;
  if (/\/addresses\/[^/]+\/transactions$/.test(path)) {
    // An oldest-first page is read only for its first SENDER_FIRST transactions.
    const keep = new URL(url).searchParams.get('order') === 'asc' ? SENDER_FIRST : Infinity;
    const items = (d.items as Raw[]).slice(0, keep).map(slimTx);
    return JSON.stringify({ items, next_page_params: d.next_page_params ?? null });
  }
  if (/\/addresses\/[^/]+$/.test(path))
    return JSON.stringify({ is_contract: d.is_contract, creator_address_hash: d.creator_address_hash, creation_transaction_hash: d.creation_transaction_hash });
  if (path.includes('/smart-contracts/')) return JSON.stringify({ is_verified: d.is_verified, name: d.name });
  if (path.includes('/transactions/')) return JSON.stringify({ hash: d.hash, timestamp: d.timestamp });
  return body;
}
const recording: typeof fetch = async (input, init) => {
  const url = String(input);
  const res = await fetch(input, init);
  const text = await res.text();
  entries[url] = { status: res.status, body: res.ok ? slim(url, text) : text.slice(0, 200) };
  return new Response(text, { status: res.status });
};
const explorer = explorerFor(chain, recording);
if (!explorer) throw new Error(`no explorer for ${chain}`);
const now = new Date();
const rows = await readContract(chain, address, { explorer, repoAddresses: [], now });
const out = join(import.meta.dirname, '..', 'lib', 'v6', 'fixtures', 'contracts', `${slug}.json`);
const doc = { chain, address: address.toLowerCase(), recorded_at: now.toISOString(), entries };
writeFileSync(out, JSON.stringify(doc) + '\n');
console.log(`${chain} ${address}: ${Object.keys(entries).length} responses -> ${out}`);
console.log(JSON.stringify(rows, null, 1));
