/**
 * The program files (programs/*.json) read and checked, and written as file programs. A file is written as its dates
 * call for it, by the daily run's own rule (`movedByDate`, v6.1.16 Task 16 fix round 1): an active or upcoming file past
 * ends_at as closed, an upcoming one past starts_at as active (opens_note dropped), each with one warning naming the
 * file, so a deploy never undoes a move the daily walk made (no change row, no digest line).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { movedByDate } from './health';
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
    const move = movedByDate(p, now);
    if (move && 'blocked' in move) {
      out.warnings.push(`Warning: ${f} is upcoming and starts_at has passed, but it has no submission requirements; synced as upcoming. Add them.`);
      out.programs.push({ f, p });
    } else if (move) {
      const at = move.to === 'closed' ? 'ends_at' : 'starts_at';
      const fix = move.to === 'closed' && p.status === 'active' ? `Set "status": "closed".` : `Set "status": "${move.to}" and remove opens_note.`;
      out.warnings.push(`Warning: ${f} is ${p.status} but ${at} has passed; synced as ${move.to}. ${fix}`);
      out.programs.push({ f, p: move.file });
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
