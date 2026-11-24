/**
 * v3.8 E18 (plan item 13): package downloads, a usage signal for libraries and tools that have no site or contract.
 * The npm name comes from the repo's root package.json (already read); the PyPI name from its root pyproject.toml (one
 * raw read). A package counts only when its registry entry links back to this repo, so a fork or a copied manifest
 * never claims someone else's downloads. Read only with `screen_v2` on (evidence.ts), never cached. Never throws: a
 * failed read is null with a note.
 */
import type { RepoRead } from '../v5/github';

export type PackageNames = { npm: string | null; pyproject: boolean; branch: string };
export type PackageRows = {
  npm: string | null;
  npm_downloads_30d: number | null;
  pypi: string | null;
  pypi_downloads_30d: number | null;
  note: string | null;
};

/** npm's own naming rule, scoped or not; anything else is not looked up. */
const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]{0,213}$/;
/** PEP 508 names. */
const PYPI_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

/** The names to look up, from a repo read: a root package.json's name unless private, and whether a root pyproject exists. Pure. */
export function packageNames(read: Pick<RepoRead, 'files' | 'tree' | 'repo'>): PackageNames {
  let npm: string | null = null;
  const pkg = read.files.find((f) => f.path === 'package.json');
  if (pkg) {
    try {
      const j = JSON.parse(pkg.text) as { name?: unknown; private?: unknown };
      if (typeof j.name === 'string' && j.private !== true && NPM_NAME.test(j.name)) npm = j.name;
    } catch {
      // A manifest that is not JSON names no package.
    }
  }
  return { npm, pyproject: read.tree.some((t) => t.path === 'pyproject.toml' && t.type === 'blob'), branch: read.repo.default_branch };
}

/** The `[project]` name in a pyproject.toml, else null. Pure. */
export function pyprojectName(text: string): string | null {
  const section = /^\[project\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? '';
  const name = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(section)?.[1] ?? null;
  return name && PYPI_NAME.test(name) ? name : null;
}

/** Whether a registry's links name this repo (github.com/owner/name, any case, .git or a path after it). Pure. */
export function linksRepo(urls: unknown[], full: string): boolean {
  const want = `github.com/${full.toLowerCase()}`;
  return urls.some((u) => typeof u === 'string' && new RegExp(`${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.git)?([/#?]|$)`).test(u.toLowerCase()));
}

async function json(f: typeof fetch, url: string): Promise<unknown> {
  const res = await f(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/**
 * Reads the downloads of the repo's own packages. `gh` reads the pyproject (raw GitHub), `f` the registries. A package
 * whose registry does not link this repo is named in the note and not counted.
 */
export async function readPackages(full: string, names: PackageNames, o: { gh: typeof fetch; f: typeof fetch }): Promise<PackageRows> {
  const rows: PackageRows = { npm: null, npm_downloads_30d: null, pypi: null, pypi_downloads_30d: null, note: null };
  const notes: string[] = [];
  if (names.npm) {
    const name = names.npm;
    try {
      const meta = obj(await json(o.f, `https://registry.npmjs.org/${name.replace('/', '%2F')}`));
      const repo = obj(meta.repository);
      if (!meta.name) notes.push(`npm package ${name} not published`);
      else if (!linksRepo([repo.url, meta.homepage, obj(meta.bugs).url], full)) notes.push(`npm package ${name} does not link this repo`);
      else {
        rows.npm = name;
        const d = obj(await json(o.f, `https://api.npmjs.org/downloads/point/last-month/${name}`));
        rows.npm_downloads_30d = typeof d.downloads === 'number' ? d.downloads : null;
        if (rows.npm_downloads_30d === null) notes.push('npm_downloads_30d not read');
      }
    } catch {
      notes.push('npm not read: registry unreachable');
    }
  }
  if (names.pyproject) {
    try {
      const res = await o.gh(`https://raw.githubusercontent.com/${full}/${encodeURIComponent(names.branch)}/pyproject.toml`, { signal: AbortSignal.timeout(10_000) });
      const name = res.ok ? pyprojectName(await res.text()) : null;
      if (name) {
        const info = obj(obj(await json(o.f, `https://pypi.org/pypi/${name}/json`)).info);
        if (!info.name) notes.push(`PyPI package ${name} not published`);
        else if (!linksRepo([info.home_page, info.project_url, ...Object.values(obj(info.project_urls))], full)) notes.push(`PyPI package ${name} does not link this repo`);
        else {
          rows.pypi = name;
          const d = obj(obj(await json(o.f, `https://pypistats.org/api/packages/${name.toLowerCase()}/recent`)).data);
          rows.pypi_downloads_30d = typeof d.last_month === 'number' ? d.last_month : null;
          if (rows.pypi_downloads_30d === null) notes.push('pypi_downloads_30d not read');
        }
      }
    } catch {
      notes.push('pypi not read: registry unreachable');
    }
  }
  rows.note = notes.length ? notes.join('; ') : null;
  return rows;
}
