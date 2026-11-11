/**
 * The builder's own project, read the way a reviewer would see it: at most once a day, the tier in
 * builder words, and the one usage line EarnKit writes from counted mainnet contracts (a fixed
 * template, never a sentence about traction when nothing is verified).
 */
import { chainName } from '../v5/chains';
import type { Evidence, Subject } from './evidence';
import { builderLine } from './tier-words';
import type { Placement, Tier } from './tiers';

export const READ_EVERY_HOURS = 24;
const HOUR = 3_600_000;

/** Reads only when the last read is null or over 24 hours old; otherwise nothing is read. */
export async function ownEvidence(
  subject: Subject,
  o: { read: (s: Subject) => Promise<Evidence>; now: Date; lastReadAt: string | null },
): Promise<{ evidence: Evidence | null; read: boolean }> {
  const last = o.lastReadAt ? Date.parse(o.lastReadAt) : NaN;
  if (Number.isFinite(last) && o.now.getTime() - last < READ_EVERY_HOURS * HOUR) return { evidence: null, read: false };
  return { evidence: await o.read(subject), read: true };
}

const n = (v: number) => v.toLocaleString('en-US');

/** "1,240 distinct senders the deployer did not fund in 90 days on Base, 12,300 transactions, live since 2026-08-02"; null when nothing counted is funded. Pure. */
export function usageLine(e: Evidence, _now: Date): string | null {
  const funded = e.onchain.filter((c) => c.counted === true && c.mainnet === true && c.is_contract === true && (c.funded_senders_90d ?? 0) >= 1);
  if (funded.length === 0) return null;
  // One contract's numbers: rows carry counts, not addresses, so summing would count a wallet twice.
  const top = funded.reduce((a, b) => (b.funded_senders_90d! > a.funded_senders_90d! ? b : a));
  const since = top.deployed_at ?? top.first_tx_at;
  return [
    `${n(top.funded_senders_90d!)} distinct senders the deployer did not fund in 90 days on ${chainName(top.chain)}`,
    ...(top.tx_90d != null ? [`${n(top.tx_90d)} transactions`] : []),
    ...(since ? [`live since ${since.slice(0, 10)}`] : []),
  ].join(', ');
}

/** The tier and the builder's line for it; null when nothing was placed. Pure. */
export function evidenceSummary(p: Placement, _e: Evidence | null): { tier: Tier | null; line: string } | null {
  return p.tier ? { tier: p.tier, line: builderLine(p) } : null;
}
