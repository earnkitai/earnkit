import { sql } from './db';
import type { ReaderDeps } from './source-readers';

/**
 * v2.12.1 spec "Scale": "Measured: reads per day per source against each free limit, in the metric
 * script." `perDay` null: the provider publishes no limit (watch for 429s). The basis says where
 * the number comes from.
 */
export type Provider = 'github_graphql' | 'github_rest' | 'blockscout' | 'arc_rpc' | 'npm' | 'pypi' | 'site';
export const FREE_LIMITS: Record<Provider, { perDay: number | null; basis: string }> = {
  github_graphql: { perDay: 120_000, basis: '5,000 points an hour per token (GitHub docs), shared with REST budgeting' },
  github_rest: { perDay: 120_000, basis: '5,000 requests an hour per token (GitHub docs)' },
  blockscout: { perDay: 100_000, basis: 'keyless public Base Blockscout, assumed about 1 a second sustained' },
  arc_rpc: { perDay: null, basis: 'public Arc RPC publishes no daily limit' },
  npm: { perDay: null, basis: 'npm publishes no limit for the downloads API' },
  pypi: { perDay: null, basis: 'pypistats asks for light use, no number' },
  site: { perDay: null, basis: "one HEAD per site per day, the builder's own server" },
};

/** npm or PyPI, by the URL a `json` read asks. Pure. */
export const providerOfUrl = (u: string): Provider => (/pypistats|pypi\.org/.test(u) ? 'pypi' : 'npm');

/**
 * Counts every outside read of `d` per provider. Deps that report their own HTTP requests
 * (`d.requests`, the real ones: a redirect, a second Blockscout or RPC read each count) are counted
 * from those reports until `stop()`; other deps (test fakes) are wrapped and counted once a call.
 */
export function countingDeps(d: ReaderDeps): { deps: ReaderDeps; counts: Map<Provider, number>; stop: () => void } {
  const counts = new Map<Provider, number>();
  let on = true;
  const tick = (p: Provider) => {
    if (on) counts.set(p, (counts.get(p) ?? 0) + 1);
  };
  const stop = () => {
    on = false;
  };
  if (d.requests) {
    const sink = d.requests;
    const before = sink.tick;
    const ours = (p: Provider) => {
      tick(p);
      before?.(p);
    };
    sink.tick = ours;
    return {
      deps: d,
      counts,
      stop: () => {
        stop();
        if (sink.tick === ours) sink.tick = before;
      },
    };
  }
  const wrap = <A extends unknown[], R>(p: Provider | ((...a: A) => Provider), f: (...a: A) => Promise<R>) =>
    (...a: A) => { tick(typeof p === 'function' ? p(...a) : p); return f(...a); };
  return {
    counts,
    stop,
    deps: {
      ...d,
      gh: wrap('github_rest', d.gh) as ReaderDeps['gh'],
      // The v2.11 proof-line read (GitHub REST outside `gh`), when the deps have it.
      ...(d.ghFetch && { ghFetch: wrap('github_rest', d.ghFetch) as typeof fetch }),
      ghGraphql: wrap('github_graphql', d.ghGraphql) as ReaderDeps['ghGraphql'],
      probe: wrap('site', d.probe),
      fetchText: wrap('site', d.fetchText),
      json: wrap((u: string) => providerOfUrl(u), d.json) as ReaderDeps['json'],
      baseTxs: wrap('blockscout', d.baseTxs),
      tokenTransfers: wrap('blockscout', d.tokenTransfers),
      contractOrigin: wrap('blockscout', d.contractOrigin),
      walletCreations: wrap('blockscout', d.walletCreations),
      arcLogs: wrap('arc_rpc', d.arcLogs),
      arcHead: wrap('arc_rpc', d.arcHead),
      arcSender: wrap('arc_rpc', d.arcSender),
    },
  };
}

/** Adds this run's or this refresh's counts to the day's rows (one upsert per provider). Never throws. */
export async function flushReadUsage(day: string, counts: Map<Provider, number>): Promise<void> {
  try {
    for (const [provider, n] of counts)
      if (n > 0) await sql()`
        INSERT INTO read_usage (day, provider, reads) VALUES (${day}, ${provider}, ${n})
        ON CONFLICT (day, provider) DO UPDATE SET reads = read_usage.reads + EXCLUDED.reads`;
  } catch (err) {
    console.error('[read-usage]', err instanceof Error ? err.name : 'error');
  }
}
