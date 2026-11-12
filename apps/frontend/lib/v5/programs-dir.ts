/**
 * Where the catalog files (programs/*.json) are. Its own module (v6.1.18 Task 7) so the landing's file fallback reads
 * it without pulling the write API into the landing, the guide pages and the proxy.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where programs/*.json are at run time (`next start` runs in apps/frontend), or null. The check is a run-time read:
 *  the ignore comment keeps the build's file tracing from taking in the whole project. */
export function findProgramsDir(cwd = process.cwd()): string | null {
  for (const dir of [join(cwd, '..', '..', 'programs'), join(cwd, 'programs')]) if (existsSync(/*turbopackIgnore: true*/ dir)) return dir;
  return null;
}
