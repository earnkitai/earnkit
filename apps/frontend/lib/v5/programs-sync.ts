/**
 * The program files (programs/*.json) read and checked, and written as file programs. An active
 * file whose ends_at has passed is written as closed, with one warning naming the file, so a
 * deploy never reopens a program the daily walk closed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { programProblems } from './program-checks';
import type { Program } from './program-file';
import { upsertProgram } from './programs';
import { revalidateCatalog } from './programs-read';

export type ProgramFiles = { invalid: string[]; programs: { f: string; p: Program }[]; warnings: string[] };

/** Every file in `dir`, checked: the invalid ones' error lines, the valid programs (expired ones closed), the warnings. */
export function readProgramFiles(dir: string, now: Date): ProgramFiles {
  const out: ProgramFiles = { invalid: [], programs: [], warnings: [] };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      out.invalid.push(`${f} is not valid:\n  - not JSON`);
      continue;
    }
    const problems = programProblems(raw as Program);
    const id = (raw as { id?: unknown }).id;
    if (problems.length === 0 && f !== `${id}.json`) problems.push(`the file is named <id>.json (${id}.json)`);
    // L21-16 (v6.1.16): a catalog file held in person names where, from its own text, for the guide's `In person: {city}.` pill.
    if (problems.length === 0 && (raw as Program).in_person && !(raw as Program).city) problems.push('city: an in-person program names its city (from its description or rules)');
    if (problems.length > 0) {
      out.invalid.push([`${f} is not valid:`, ...problems.map((p) => `  - ${p}`)].join('\n'));
      continue;
    }
    const p = raw as Program;
    if (p.status === 'active' && p.ends_at && Date.parse(p.ends_at) <= now.getTime()) {
      out.warnings.push(`Warning: ${f} is active but ends_at has passed; synced as closed. Set "status": "closed".`);
      out.programs.push({ f, p: { ...p, status: 'closed' } });
    } else out.programs.push({ f, p });
  }
  return out;
}

/** Writes every valid file as a file program; nothing is written when any file is invalid. */
export async function syncFiles(dir: string, now: Date): Promise<ProgramFiles & { written: string[] }> {
  const files = readProgramFiles(dir, now);
  const written: string[] = [];
  if (files.invalid.length > 0) return { ...files, written };
  for (const { f, p } of files.programs) written.push(`${f}: ${await upsertProgram(p, 'file', now)}`);
  // L22-13 (v6.1.16): the synced files expire every catalog surface at once.
  if (written.length > 0) revalidateCatalog();
  return { ...files, written };
}
