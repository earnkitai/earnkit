import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A committed `programs/<name>.json`, parsed, without its `logo`. Tests clone these files under
 * test ids, and a logo path is tied to its program's id (`programs/<id>.svg`, Ruling 23), so a
 * clone keeps every other fact but no logo (v2.7 Task 8 backfilled the real logos), and no
 * `needs_contract` (v2.9 A5: a clone tests something else; the contract check has its own tests).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function committedProgram(name: string): any {
  const p = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../programs', `${name}.json`), 'utf8'));
  delete p.logo;
  delete p.needs_contract;
  return p;
}

/**
 * C7: a valid answer for every required item of a program file's `submission_requirements`,
 * so an entry is ready and its token can launch. `overrides` win.
 */
export function completeAnswers(
  requirements: { key: string; type: string; required: boolean; options?: string[] }[],
  overrides: Record<string, string> = {},
): Record<string, string> {
  const value = (r: (typeof requirements)[number]) =>
    r.type === 'url'
      ? `https://tipjar.xyz/${r.key}`
      : r.type === 'email'
        ? 'builder@tipjar.xyz'
        : r.type === 'choice' && r.options?.length
          ? r.options[0]
          : `${r.key} answer`;
  return { ...Object.fromEntries(requirements.filter((r) => r.required).map((r) => [r.key, value(r)])), ...overrides };
}
