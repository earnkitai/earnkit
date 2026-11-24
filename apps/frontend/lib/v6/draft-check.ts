/**
 * v3.8 E11 (plan item 7, cutover A8): the draft check. Deterministic, no LLM: it reads a draft's fields against the
 * program's form and the builder's record and lists what does not hold.
 *
 * - Length and required fields: each form field's `max_chars` and `guidance.limit_words`; a required text field left
 *   empty; a key the form does not have.
 * - Unsupported numbers and links: every number and every link in the draft must be one the record (or a proof link,
 *   or the program's own page) holds; otherwise it is listed as unsupported.
 * - Filler: a fixed phrase list, and em dashes (the style contract).
 * - Program-specific: the program's name, organizer or one of its criteria terms appears somewhere in the draft.
 * - Traction labels: each supported number is `verified` when EarnKit's own usage line (`last_tier.usage`, read from
 *   public evidence) holds it, else `builder_stated`.
 * - `policy.never_claim`: a phrase the builder never claims, found in the draft.
 *
 * Honest limit: it catches unsupported numbers and links, length and the listed phrases. It cannot tell whether a
 * sentence of prose is true.
 */
import { createHash } from 'node:crypto';
import type { Program } from '../v5/program-file';
import type { BuilderRecord } from './record';

export type DraftProblem = {
  kind: 'missing' | 'too_long' | 'too_many_words' | 'unknown_field' | 'unsupported_number' | 'unsupported_link' | 'filler' | 'program_not_named' | 'never_claim';
  field?: string;
  detail: string;
};
export type TractionLabel = { field: string; value: string; label: 'verified' | 'builder_stated' };
export type DraftCheck = { pass: boolean; problems: DraftProblem[]; traction: TractionLabel[]; hash: string; checked_at: string };

/** Phrases a judge reads as filler (lower case). */
export const FILLER = [
  'revolutionize', 'revolutionary', 'game-changer', 'game changer', 'cutting-edge', 'cutting edge', 'seamless', 'seamlessly',
  'leverage', 'synergy', 'paradigm shift', 'best-in-class', 'world-class', 'next-generation', 'unlock the power',
  "in today's fast-paced", 'in today’s fast-paced', 'delve', 'harness the power', 'groundbreaking', 'state-of-the-art',
] as const;

/** The draft's fields as hashed: keys sorted, each value trimmed. The same draft always hashes the same. Pure. */
export function draftHash(fields: Record<string, string>): string {
  const canon = Object.keys(fields).sort().map((k) => [k, fields[k].trim()]);
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
/** A number as written: optional $, digits with commas, decimals, a k/m/b or % suffix. */
const NUM_RE = /\$?\b\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|b|K|M|B)\b|%)?/g;

/** A link compared without scheme case, a trailing slash, query or fragment. Pure. */
export const normLink = (u: string): string => u.trim().replace(/[.,;:!?]+$/, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase().replace(/^http:/, 'https:');

/** A written number's value: "$5k" 5000, "1,240" 1240, "12%" 12. NaN when it does not read. Pure. */
export function numberValue(s: string): number {
  const m = /^\$?([\d,]*\.?\d+)\s?([kmb%])?$/i.exec(s.trim());
  if (!m) return Number.NaN;
  const base = Number(m[1].replace(/,/g, ''));
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase() as 'k' | 'm' | 'b'] ?? 1;
  return base * mult;
}

/** Every string and number leaf of a value. Pure. */
function leaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'number' && Number.isFinite(v)) out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) leaves(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) leaves(x, out);
  return out;
}

/** The numbers a text holds, by value. Pure. */
const numbersIn = (text: string): number[] =>
  [...text.replace(URL_RE, ' ').matchAll(NUM_RE)].map((m) => numberValue(m[0])).filter((n) => Number.isFinite(n));

/** The program's words a draft can name it by: title and short title, organizer, chains, preferred integrations. */
function programTerms(p: Program): string[] {
  const words = [p.title, p.short_title, p.organizer, ...p.chains, ...p.prefers].filter((x): x is string => !!x);
  return words.map((w) => w.toLowerCase().trim()).filter((w) => w.length >= 3);
}

/**
 * Checks `fields` (form key to draft text) for `program` against `record`, the builder's `proof_links`, and the
 * program's own links. `pass` when nothing is listed. Pure.
 */
export function checkDraft(program: Program, fields: Record<string, string>, record: BuilderRecord, o: { proof_links?: string[]; now: Date }): DraftCheck {
  const problems: DraftProblem[] = [];
  const form = new Map(program.submission_requirements.map((r) => [r.key, r]));
  for (const [key, text] of Object.entries(fields)) {
    const r = form.get(key);
    if (!r) {
      problems.push({ kind: 'unknown_field', field: key, detail: `${key} is not a field on this form` });
      continue;
    }
    if (r.max_chars !== undefined && text.trim().length > r.max_chars)
      problems.push({ kind: 'too_long', field: key, detail: `${text.trim().length} characters, the form takes ${r.max_chars}` });
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    if (r.guidance?.limit_words !== undefined && words > r.guidance.limit_words)
      problems.push({ kind: 'too_many_words', field: key, detail: `${words} words, the form takes ${r.guidance.limit_words}` });
  }
  for (const r of program.submission_requirements)
    if (r.required && r.type !== 'file' && !(fields[r.key] ?? '').trim()) problems.push({ kind: 'missing', field: r.key, detail: `${r.label} is required` });

  const recordLeaves = leaves(record);
  const verifiedText = record.projects.map((p) => p.last_tier?.usage ?? '').join(' ');
  const known = new Set(recordLeaves.flatMap(numbersIn));
  const verified = new Set(numbersIn(verifiedText));
  for (const n of numbersIn([program.title, program.reward, program.summary].join(' '))) known.add(n);
  const links = new Set([
    ...recordLeaves.flatMap((s) => [...s.matchAll(URL_RE)].map((m) => normLink(m[0]))),
    ...(o.proof_links ?? []).map(normLink),
    ...[program.source_url, program.submission_url, program.official_url].filter((x): x is string => !!x).map(normLink),
  ]);
  const traction: TractionLabel[] = [];
  const never = (record.policy.never_claim ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const [key, text] of Object.entries(fields)) {
    for (const m of text.matchAll(URL_RE))
      if (!links.has(normLink(m[0]))) problems.push({ kind: 'unsupported_link', field: key, detail: m[0] });
    for (const m of text.replace(URL_RE, ' ').matchAll(NUM_RE)) {
      const v = numberValue(m[0]);
      if (!Number.isFinite(v)) continue;
      if (!known.has(v)) problems.push({ kind: 'unsupported_number', field: key, detail: m[0].trim() });
      else traction.push({ field: key, value: m[0].trim(), label: verified.has(v) ? 'verified' : 'builder_stated' });
    }
    const lower = text.toLowerCase();
    for (const f of FILLER) if (lower.includes(f)) problems.push({ kind: 'filler', field: key, detail: f });
    if (text.includes('—')) problems.push({ kind: 'filler', field: key, detail: 'em dash' });
    for (const n of never) if (lower.includes(n)) problems.push({ kind: 'never_claim', field: key, detail: n });
  }
  const all = Object.values(fields).join(' ').toLowerCase();
  if (Object.keys(fields).length > 0 && !programTerms(program).some((t) => all.includes(t)))
    problems.push({ kind: 'program_not_named', detail: `name ${program.title}, ${program.organizer} or what it asks for` });
  return { pass: problems.length === 0, problems, traction, hash: draftHash(fields), checked_at: o.now.toISOString() };
}
