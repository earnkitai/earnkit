// Records one starter's file paths into lib/v6/boilerplates.json (real network; tree paths only).
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
const out = join(import.meta.dirname, '..', 'lib', 'v6', 'boilerplates.json');
type Boilerplate = { name: string; repo: string; recorded_at: string; paths: string[] };
const all = (existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : []) as Boilerplate[];
const entry: Boilerplate = { name, repo, recorded_at: new Date().toISOString().slice(0, 10), paths };
const next = [...all.filter((b) => b.name !== name), entry].sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(out, JSON.stringify(next, null, 1) + '\n');
console.log(`${name} (${repo}${prefix ? `/${prefix}` : ''}): ${paths.length} paths -> ${out}`);
