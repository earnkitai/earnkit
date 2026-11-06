// Records one starter's file paths and its top 10 contributors (maintainers) into lib/v6/boilerplates.json.
// Usage: GITHUB_TOKEN=... pnpm tsx apps/frontend/scripts/record-boilerplate.mts owner/name name [subdir]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gh, type Repo, type TreeEntry } from '../lib/v5/github';

const [repo, name, subdir = ''] = process.argv.slice(2);
if (!repo || !name) throw new Error('usage: record-boilerplate.mts owner/name name [subdir]');
const r = await gh<Repo>(`/repos/${repo}`);
const t = await gh<{ tree: TreeEntry[]; truncated?: boolean }>(`/repos/${repo}/git/trees/${encodeURIComponent(r.default_branch)}?recursive=1`);
if (t.truncated) throw new Error(`${repo}: tree truncated; record a subdir`);
const prefix = subdir ? `${subdir.replace(/\/+$/, '')}/` : '';
const paths = t.tree
  .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
  .map((e) => e.path.slice(prefix.length))
  .filter((p) => !/(^|\/)node_modules\//.test(p))
  .sort();
if (paths.length === 0) throw new Error(`${repo}: no paths under ${prefix || 'the root'}`);
// The maintainers: their commits in a clone are the starter's, not the applicant's.
const people = await gh<{ login?: string; type?: string }[]>(`/repos/${repo}/contributors?per_page=10`);
const maintainers = people.filter((p) => p.login && p.type !== 'Bot' && !p.login.endsWith('[bot]')).map((p) => p.login!.toLowerCase());
const out = join(import.meta.dirname, '..', 'lib', 'v6', 'boilerplates.json');
type Boilerplate = { name: string; repo: string; recorded_at: string; paths: string[]; maintainers: string[] };
const all = (existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []) as Boilerplate[];
const entry: Boilerplate = { name, repo, recorded_at: new Date().toISOString().slice(0, 10), paths, maintainers };
const next = [...all.filter((b) => b.name !== name), entry].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify(next, null, 1) + '\n');
console.log(`${name} (${repo}${prefix ? `/${prefix}` : ''}): ${paths.length} paths, ${maintainers.length} maintainers -> ${out}`);
