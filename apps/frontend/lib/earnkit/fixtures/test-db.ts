import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';

/**
 * v2.14 spec 6: one database per test file, so files never race. In a node:test child process (the runner
 * spawns one per file, NODE_TEST_CONTEXT=child...), with DATABASE_URL set, the guard creates
 * ek_t_<file hash>_<pid> from this worktree's template (schema run twice, programs synced) and points
 * DATABASE_URL at it; it is dropped when the process exits. Anything else (no DATABASE_URL, a script, the
 * runner itself) is untouched. D13: every database is tagged with this worktree's key (test-db-template.mjs),
 * and only this worktree's databases whose process is gone are ever cleaned up, so another worktree's run on
 * the same server is never touched.
 */
export const TEMPLATE_DB = 'ek_test_template';
export const testDbName = (file: string, pid: number) => `ek_t_${createHash('sha256').update(file).digest('hex').slice(0, 10)}_${pid}`;
export function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
export function perFileDatabase(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): string | null {
  const url = env.DATABASE_URL;
  const file = argv[1] ?? '';
  if (!url || env.EK_TEST_DB || !env.NODE_TEST_CONTEXT?.startsWith('child') || !/\.test\.ts$/.test(file)) return null;
  const name = testDbName(file, process.pid);
  const here = import.meta.dirname;
  execFileSync(process.execPath, [join(here, 'test-db-create.mjs'), url, name], { stdio: 'inherit' });
  env.EK_TEST_DB = name;
  env.DATABASE_URL = withDatabase(url, name);
  // Dropped by a detached process, so the file's exit (and the runner) never waits on it; a leftover (a
  // killed run) is dropped by this worktree's next `pnpm test`, its process being gone by then.
  process.once('exit', () => {
    try {
      spawn(process.execPath, [join(here, 'test-db-drop.mjs'), url, name], { stdio: 'ignore', detached: true }).unref();
    } catch {
      // As above: the next run drops it.
    }
  });
  return name;
}
