import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A committed `programs/<name>.json`, parsed, without its `logo`. Tests clone these files under
 * test ids, and a logo path is tied to its program's id (`programs/<id>.svg`, Ruling 23), so a
 * clone keeps every other fact but no logo (v2.7 Task 8 backfilled the real logos).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function committedProgram(name: string): any {
  const p = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../programs', `${name}.json`), 'utf8'));
  delete p.logo;
  return p;
}
