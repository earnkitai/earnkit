/**
 * Replays a recorded repo read (fixtures/repos/<slug>.json) as a fetch. Unrecorded URLs answer 404;
 * `calls` lists every URL asked, so a test can count reads.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Recorded = { repo: string; recorded_at: string; entries: Record<string, { status: number; link?: string; body: string }> };

export function replayFetch(slug: string, patch: (url: string, body: string) => string = (_, b) => b) {
  const rec = JSON.parse(readFileSync(join(import.meta.dirname, 'repos', `${slug}.json`), 'utf8')) as Recorded;
  // GitHub treats owner and repo names without case; so does the replay.
  const byUrl = new Map(Object.entries(rec.entries).map(([u, e]) => [u.toLowerCase(), e]));
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const e = byUrl.get(url.toLowerCase());
    if (!e) return new Response('not recorded', { status: 404 });
    return new Response(patch(url, e.body), { status: e.status, headers: e.link ? { link: e.link } : {} });
  }) as typeof fetch;
  return { fetch: fetchFn, calls, repo: rec.repo, recorded_at: rec.recorded_at };
}
