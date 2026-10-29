import { sql } from './db';
import { AlchemyNetworkOff, alchemyCall, alchemyOn, contractFlows, logNetworkOff, type AlchemyCall, type Flow } from './alchemy';
import { ScoreDeadline } from './campaigns';
import { cachedWethUsd } from './fees';
import { hit } from './rate-limit';
import { USED_STALE_DAYS } from './site-data';
import { USED_DAYS, USED_PAGES, USED_PER_RUN, confirmedSql, contractsOf, excludedOf, fundedOf, keptOn, newestChosen, provenWallets } from './used-by';

/**
 * v4.5 Task 2 (2026-10-29): the daily revenue read. What outside wallets paid into a builder's own counted Base
 * contracts in the last USED_DAYS days, kept in app_revenue (one row per builder and UTC day) for the grant drafts.
 * - The contracts and exclusions are used-by.ts's (contractsOf, keptOn, newestChosen, excludedOf), so a token, a
 *   contract the builder has not proven, or builder_tokens' 'existing' claims are never read, and the builder's proven
 *   wallets, each deployer and every wallet a proven wallet funded never count as paying (or as outbound: that is the
 *   builder taking money out).
 * - Inbound ETH (external and internal) and Base USDC per contract, and the same outbound, alchemy.ts contractFlows,
 *   USED_PAGES pages each. Exact raw amounts; ETH at fees.ts cachedWethUsd, USDC at $1.
 * - Pass-through, judged per contract (a router): a contract whose outbound to outside addresses is at least half of
 *   its own inbound adds nothing to usd; usd is the inbound of the others (0 when every contract passes through, the
 *   row stored so drafts skip it). inbound_usd and outbound_usd stay the builder's totals.
 * - Any failure stores nothing (no zero row); an unknown price stores nothing (the next run asks again).
 * Private: no route, page, builder.json or stats code reads app_revenue.
 */
const DAY_MS = 86_400_000;
/** Pass-through: outbound at this share of inbound or more. */
export const PASS_THROUGH = 0.5;

export type Revenue = { usd: number; inbound_usd: number; outbound_usd: number; capped: boolean; contracts: number };
type Price = (now: number) => Promise<number | null>;
const usable = (usd: number | null): usd is number => usd !== null && Number.isFinite(usd) && usd > 0;

/** Dollars, rounded to cents, from exact amounts: wei at `ethUsd`, USDC units at $1 (6 decimals). Pure. */
const dollars = (wei: bigint, usdc: bigint, ethUsd: number) => Math.round((Number(wei / 10n ** 12n) / 1e6) * ethUsd * 100 + Number(usdc / 10_000n)) / 100;
const cents = (usd: number) => Math.round(usd * 100) / 100;
/** One contract is pass-through (a router) when its outbound to outside addresses is at least PASS_THROUGH of its inbound. Pure. */
export const passesThrough = (inbound: number, outbound: number) => inbound > 0 && outbound >= PASS_THROUGH * inbound;
const sumOutside = (flows: Flow[], excluded: Set<string>) => flows.reduce((s, f) => (excluded.has(f.peer) ? s : s + f.raw), 0n);

/**
 * One builder's revenue on Base (`call`): the newest counted contracts (at most USED_CONTRACTS, never a token), four
 * reads each, one contract at a time, pass-through judged per contract. A contract of the builder's on either side is no outside wallet (money moving
 * between their own contracts is neither paid in nor passed through). Null without a counted Base contract, with
 * Base not enabled in Alchemy, or with no ETH price; any other failure throws (the deadline propagates).
 */
export async function contractsRevenue(builderId: number, now: Date, call: AlchemyCall, o: { price?: Price } = {}): Promise<Revenue | null> {
  const all = (await contractsOf(builderId)).filter((c) => c.chain === 'base');
  if (all.length === 0) return null;
  const since = now.getTime() - USED_DAYS * DAY_MS;
  try {
    const kept = await keptOn(all, 'base', call);
    const chosen = newestChosen(all, [kept]);
    if (chosen.length === 0) return null;
    const ethUsd = await (o.price ?? cachedWethUsd)(now.getTime());
    if (!usable(ethUsd)) return null;
    const proven = await provenWallets(builderId);
    const excluded = excludedOf(proven, [await fundedOf(proven, call)], chosen);
    for (const c of chosen) excluded.add(c.address.toLowerCase());
    let capped = false;
    let [usd, inbound_usd, outbound_usd] = [0, 0, 0];
    for (const c of chosen) {
      const read = async (dir: 'in' | 'out', kind: 'eth' | 'usdc') => {
        const r = await contractFlows(c.address, call, since, USED_PAGES, dir, kind);
        if (r.capped) capped = true;
        return sumOutside(r.flows, excluded);
      };
      const inbound = dollars(await read('in', 'eth'), await read('in', 'usdc'), ethUsd);
      const outbound = dollars(await read('out', 'eth'), await read('out', 'usdc'), ethUsd);
      // Pass-through per contract: a router forwarding what it gets adds nothing, whatever the builder's other contracts earn.
      if (!passesThrough(inbound, outbound)) usd += inbound;
      inbound_usd += inbound;
      outbound_usd += outbound;
    }
    return { usd: cents(usd), inbound_usd: cents(inbound_usd), outbound_usd: cents(outbound_usd), capped, contracts: chosen.length };
  } catch (err) {
    if (!(err instanceof AlchemyNetworkOff)) throw err;
    logNetworkOff(err.network);
    return null;
  }
}

/** Stores the builder's UTC day (a second read the same day replaces it). */
async function store(builderId: number, now: Date, r: Revenue) {
  await sql()`
    INSERT INTO app_revenue (builder_id, day, usd, inbound_usd, outbound_usd, capped, contracts, read_at)
    VALUES (${builderId}, ${now.toISOString().slice(0, 10)}, ${r.usd}, ${r.inbound_usd}, ${r.outbound_usd}, ${r.capped}, ${r.contracts}, ${now})
    ON CONFLICT (builder_id, day) DO UPDATE SET usd = EXCLUDED.usd, inbound_usd = EXCLUDED.inbound_usd, outbound_usd = EXCLUDED.outbound_usd,
      capped = EXCLUDED.capped, contracts = EXCLUDED.contracts, read_at = EXCLUDED.read_at`;
}

/**
 * Bench-confirmed builders with a Base contract to read (a counted wallet_contracts row or a verified contract source
 * on Base) and no app_revenue row for today: never read first, then the oldest read; at most `limit` (used-by.ts
 * contractsDue, Base only).
 */
export async function revenueDue(now: Date, o: { limit?: number; only?: number[] } = {}): Promise<number[]> {
  const rows = await sql()<{ builder_id: number }[]>`
    SELECT k.builder_id FROM (${confirmedSql(o.only)}) k
    LEFT JOIN LATERAL (SELECT max(r.day) AS day FROM app_revenue r WHERE r.builder_id = k.builder_id) r ON true
    WHERE (r.day IS NULL OR r.day < ${now.toISOString().slice(0, 10)}::date)
      AND (EXISTS (SELECT 1 FROM wallet_contracts c JOIN person_wallets w ON w.wallet = c.wallet WHERE w.builder_id = k.builder_id AND c.counts AND c.chain = 'base')
        OR EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = k.builder_id AND s.kind = 'contract' AND s.state = 'verified'
          AND split_part(lower(s.ref), ':', 1) = 'base'))
    ORDER BY r.day NULLS FIRST, k.builder_id LIMIT ${o.limit ?? USED_PER_RUN}`;
  return rows.map((r) => r.builder_id);
}

/**
 * The cron's daily step, inside its slice (`deadline`), right after runUsedBy: the due builders (revenueDue), one at a
 * time, each claimed for the UTC day before its reads (so a failing one waits a day and never holds a slot), none
 * started past the deadline; `stored` counts the rows written. The ETH price is read once first; unknown, nobody is
 * claimed and nothing stored. A failure is logged and stores nothing. Off without ALCHEMY_API_KEY unless `callFor` is
 * given (tests).
 */
export async function runRevenue(
  now: Date,
  o: { deadline: number; callFor?: (network: string) => AlchemyCall; only?: number[]; limit?: number; price?: Price },
): Promise<{ due: number; stored: number } | { step: 'off' }> {
  if (!o.callFor && !alchemyOn()) return { step: 'off' };
  const call = (o.callFor ?? ((network: string) => alchemyCall(o.deadline, network)))('base-mainnet');
  const due = await revenueDue(now, o);
  if (due.length === 0) return { due: 0, stored: 0 };
  // The price first, once a run: unknown, no builder is claimed for the day, so the next run asks again.
  const ethUsd = await (o.price ?? cachedWethUsd)(now.getTime());
  if (!usable(ethUsd)) return { due: due.length, stored: 0 };
  const price = async () => ethUsd;
  const day = now.toISOString().slice(0, 10);
  let stored = 0;
  for (const id of due) {
    if (Date.now() >= o.deadline) break;
    if (!(await hit(`revenue:${id}:${day}`, 1, 86_400, now)).allowed) continue;
    try {
      const r = await contractsRevenue(id, now, call, { price });
      if (!r) continue;
      await store(id, now, r);
      stored++;
    } catch (err) {
      if (err instanceof ScoreDeadline) break;
      console.error('[revenue] read', err instanceof Error ? err.name : 'error');
    }
  }
  return { due: due.length, stored };
}

/** The builder's newest app_revenue row no older than USED_STALE_DAYS, when its usd is above 0 (not pass-through); else null. */
export async function latestRevenue(builderId: number, now: Date): Promise<{ usd: number; capped: boolean } | null> {
  const today = now.toISOString().slice(0, 10);
  const [r] = await sql()<{ usd: number; capped: boolean }[]>`
    SELECT usd::float8 AS usd, capped FROM app_revenue
    WHERE builder_id = ${builderId} AND day <= ${today}::date AND day >= ${today}::date - ${USED_STALE_DAYS}::int
    ORDER BY day DESC LIMIT 1`;
  return r && r.usd > 0 ? { usd: r.usd, capped: r.capped } : null;
}
