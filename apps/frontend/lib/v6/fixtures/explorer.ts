/**
 * Replays a recorded contract read (fixtures/contracts/<slug>.json) as a fetch. Unrecorded URLs answer 599
 * (an error, never mistaken for no data); `calls` lists every URL asked, so a test can count reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Recorded = { chain: string; address: string; recorded_at: string; entries: Record<string, { status: number; body: string }> };

export function replayExplorer(slug: string) {
  const rec = JSON.parse(readFileSync(join(import.meta.dirname, 'contracts', `${slug}.json`), 'utf8')) as Recorded;
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const e = rec.entries[url];
    if (!e) return new Response('not recorded', { status: 599 });
    return new Response(e.body, { status: e.status });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, chain: rec.chain, address: rec.address, recorded_at: rec.recorded_at };
}
