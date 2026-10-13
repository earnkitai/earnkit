// Restores an archived feature: moves every path in archive/<feature>/MANIFEST.txt back from
// archive/<feature>/files/<path> to <path> with `git mv`, refusing if any target exists.
// Usage: pnpm exec tsx apps/frontend/scripts/archive-restore.mts <feature>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '../../..');

export function manifestPaths(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
}

/** The feature's own flag: the first `EARNKIT_<NAME>=on` under its README's "## The flag", else null. */
export function flagOf(feature: string, repo = root): string | null {
  const readme = join(repo, 'archive', feature, 'README.md');
  if (!/^[a-z0-9-]+$/.test(feature) || !existsSync(readme)) return null;
  const section = readFileSync(readme, 'utf8').split('## The flag')[1] ?? '';
  return /\b(EARNKIT_[A-Z_]+)=on\b/.exec(section)?.[1] ?? null;
}

export function restore(feature: string, repo = root): string[] {
  if (!/^[a-z0-9-]+$/.test(feature)) throw new Error(`Unknown feature "${feature}".`);
  const dir = join(repo, 'archive', feature);
  if (!existsSync(join(dir, 'MANIFEST.txt'))) throw new Error(`No archive/${feature}/MANIFEST.txt.`);
  const paths = manifestPaths(readFileSync(join(dir, 'MANIFEST.txt'), 'utf8'));
  for (const p of paths) {
    if (existsSync(join(repo, p))) throw new Error(`Refusing: ${p} already exists.`);
    if (!existsSync(join(dir, 'files', p))) throw new Error(`Missing in the archive: ${p}.`);
  }
  for (const p of paths) {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    execFileSync('git', ['mv', join(dir, 'files', p), join(repo, p)], { cwd: repo, stdio: 'inherit' });
  }
  return paths;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const feature = process.argv[2];
  if (!feature) {
    console.error('Usage: archive-restore.mts <feature>');
    process.exit(1);
  }
  try {
    const moved = restore(feature);
    console.log(`Restored ${moved.length} files.`);
    console.log(`Follow the rest of archive/${feature}/README.md "## Restore", then set ${flagOf(feature) ?? 'its flag'}=on.`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
