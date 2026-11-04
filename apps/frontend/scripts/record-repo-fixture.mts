// Records the GitHub reads for one repo into lib/v5/fixtures/repos/<slug>.json (real network).
// Usage: GITHUB_TOKEN=... pnpm tsx apps/frontend/scripts/record-repo-fixture.mts owner/name slug
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRepo } from '../lib/v5/github';

const [full, slug] = process.argv.slice(2);
if (!full || !slug) throw new Error('usage: record-repo-fixture.mts owner/name slug');
const entries: Record<string, { status: number; link?: string; body: string }> = {};
const recording: typeof fetch = async (input, init) => {
  const url = String(input);
  const res = await fetch(input, init);
  let body = await res.clone().text();
  // Keep only what the reader uses from a tree (path, type, size): the full response is large.
  if (url.includes('/git/trees/')) {
    const t = JSON.parse(body) as { tree: { path: string; type: string; size?: number }[] };
    body = JSON.stringify({ tree: t.tree.map(({ path, type, size }) => ({ path, type, size })) });
  }
  entries[url] = { status: res.status, ...(res.headers.get('link') && { link: res.headers.get('link')! }), body };
  return res;
};
await readRepo(full, { fetch: recording });
const out = join(import.meta.dirname, '..', 'lib', 'v5', 'fixtures', 'repos', `${slug}.json`);
writeFileSync(out, JSON.stringify({ repo: full, recorded_at: new Date().toISOString().slice(0, 10), entries }, null, 1) + '\n');
console.log(`${full}: ${Object.keys(entries).length} responses -> ${out}`);
