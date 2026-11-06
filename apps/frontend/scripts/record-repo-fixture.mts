// Records the GitHub reads for one repo into lib/v5/fixtures/repos/<slug>.json (real network). With --v6,
// also records the code and team reads into lib/v6/fixtures/repos/<slug>.json, dated today (UTC).
// Usage: GITHUB_TOKEN=... pnpm tsx apps/frontend/scripts/record-repo-fixture.mts owner/name slug [--v6]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRepo } from '../lib/v5/github';
import { readCode } from '../lib/v6/code';
import { readTeam } from '../lib/v6/team';

const args = process.argv.slice(2);
const v6 = args.includes('--v6');
const [full, slug] = args.filter((a) => a !== '--v6');
if (!full || !slug) throw new Error('usage: record-repo-fixture.mts owner/name slug [--v6]');
const pick = <T extends object>(o: T, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, (o as Record<string, unknown>)[k]]));
/** Keeps only what the readers use from each response: trees, commit lists and the v6 lists are large. */
function trim(url: string, body: string): string {
  if (url.includes('/git/trees/')) {
    const t = JSON.parse(body) as { tree: { path: string; type: string; size?: number }[] };
    return JSON.stringify({ tree: t.tree.map(({ path, type, size }) => ({ path, type, size })) });
  }
  const u = new URL(url);
  if (!v6 || u.host !== 'api.github.com') return body;
  const p = u.pathname;
  const rows = () => JSON.parse(body) as Record<string, unknown>[];
  if (p === '/search/issues') return JSON.stringify(pick(JSON.parse(body), ['total_count']));
  if (!Array.isArray(JSON.parse(body)) && !p.includes('/compare/') && !/^\/users\/[^/]+$/.test(p)) return body;
  if (/\/commits$/.test(p)) {
    return JSON.stringify(rows().map((c) => {
      const commit = c.commit as { author?: { date?: string }; committer?: { date?: string } } | undefined;
      const author = c.author as { login?: string; type?: string } | null | undefined;
      return { author: author ? { login: author.login, type: author.type } : null, commit: { author: { date: commit?.author?.date }, committer: { date: commit?.committer?.date } } };
    }));
  }
  if (p.includes('/compare/')) return JSON.stringify(pick(JSON.parse(body), ['status', 'ahead_by', 'behind_by', 'total_commits']));
  if (/\/issues$/.test(p)) return JSON.stringify(rows().map((i) => ({ ...pick(i, ['number', 'state', 'comments']), ...(i.pull_request ? { pull_request: {} } : {}) })));
  if (/\/contributors$/.test(p)) return JSON.stringify(rows().map((c) => pick(c, ['login', 'type', 'contributions'])));
  if (/\/releases$/.test(p)) return JSON.stringify(rows().map((r) => pick(r, ['id', 'tag_name'])));
  if (/^\/users\/[^/]+\/repos$/.test(p)) return JSON.stringify(rows().map((r) => pick(r, ['full_name', 'fork', 'stargazers_count', 'homepage'])));
  if (/^\/users\/[^/]+$/.test(p)) return JSON.stringify(pick(JSON.parse(body), ['login', 'type', 'created_at']));
  return body;
}
const entries: Record<string, { status: number; link?: string; body: string }> = {};
const recording: typeof fetch = async (input, init) => {
  const url = String(input);
  const res = await fetch(input, init);
  const text = await res.clone().text();
  let body = text;
  try {
    body = res.ok ? trim(url, text) : text;
  } catch {
    // Not JSON (a raw file): stored as read.
  }
  entries[url] = { status: res.status, ...(res.headers.get('link') && { link: res.headers.get('link')! }), body };
  return res;
};
const now = new Date();
const read = await readRepo(full, { fetch: recording });
if (v6) {
  const o = { gh: recording, token: process.env.GITHUB_TOKEN, now, budget: { remaining: null, stopped: false } };
  const code = await readCode(read, o);
  const team = await readTeam(read.repo.full_name, o);
  console.log(JSON.stringify({ code, team }, null, 1));
}
const out = join(import.meta.dirname, '..', 'lib', v6 ? 'v6' : 'v5', 'fixtures', 'repos', `${slug}.json`);
writeFileSync(out, JSON.stringify({ repo: full, recorded_at: now.toISOString().slice(0, 10), entries }, null, 1) + '\n');
console.log(`${full}: ${Object.keys(entries).length} responses -> ${out}`);
