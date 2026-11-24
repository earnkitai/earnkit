/**
 * v3.8 E11 (cutover A8): the draft check as a track action, and the gate on an agent's send (`draft_check` flag).
 * `track action: check` runs `checkDraft` and stores the draft and the result on the builder's unsent row for the
 * program; an agent's `applied` then needs `final` (the fields as sent) whose hash is the passing check's, and stores
 * that hash on the sent row. The builder's own send (`submitted_by: builder`) is their text and is not gated.
 */
import { z } from 'zod';
import { sql } from '../v5/db';
import { cleanText } from '../v5/controls';
import { checkDraft, draftHash, type DraftCheck } from './draft-check';
import type { Program } from '../v5/program-file';
import type { BuilderRecord } from './record';

/** The most fields a draft carries, and the longest one. */
export const DRAFT_FIELDS_MAX = 60;
export const DRAFT_FIELD_CHARS = 10_000;
export const DraftFields = z.record(z.string().regex(/^[a-z0-9_]+$/, 'form keys in snake_case').max(80), z.string().max(DRAFT_FIELD_CHARS))
  .refine((f) => Object.keys(f).length <= DRAFT_FIELDS_MAX, `at most ${DRAFT_FIELDS_MAX} fields`);

export const CheckInput = z
  .object({
    action: z.literal('check'),
    program_id: z.string().min(1).max(100),
    fields: DraftFields,
    proof_links: z.array(z.string().url().max(500)).max(20).optional(),
    project_id: z.string().max(40).optional(),
  })
  .strict();

/** Runs the check and stores the draft and result on `owner`'s newest unsent row for the program, when there is one. */
export async function checkAndStore(owner: string, program: Program, fields: Record<string, string>, record: BuilderRecord, o: { proof_links?: string[]; now: Date }): Promise<{ check: DraftCheck; stored: boolean }> {
  const clean = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, cleanText(v, DRAFT_FIELD_CHARS)]));
  const check = checkDraft(program, clean, record, o);
  const db = sql();
  const r = await db`UPDATE applications SET draft_text = ${db.json(clean)}, draft_check = ${db.json(JSON.parse(JSON.stringify(check)))}
    WHERE ctid = (SELECT ctid FROM applications WHERE owner = ${owner} AND program_id = ${program.id} AND status = 'started' ORDER BY at DESC LIMIT 1)`;
  return { check, stored: r.count > 0 };
}

export const NO_CHECK = 'Nothing was recorded. Run track action check on the final draft first; an agent sends only a draft that passed it.';
export const CHECK_FAILED = 'Nothing was recorded. The last draft check did not pass; fix what it listed and run it again.';
export const NOT_CHECKED_TEXT = 'Nothing was recorded. final is not the draft that passed the check; run the check on the text you send.';
export const FINAL_NEEDED = 'Nothing was recorded. With the draft check on, applied by the agent needs final: the fields as sent, the same text the check passed.';

/** The gate on an agent's send: the note refusing it, or null when the passing check's hash is `final`'s. */
export async function draftGate(owner: string, programId: string, final: Record<string, string> | undefined): Promise<string | null> {
  if (!final) return FINAL_NEEDED;
  const [row] = await sql()<{ draft_check: DraftCheck | null }[]>`
    SELECT draft_check FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = 'started' ORDER BY at DESC LIMIT 1`;
  const c = row?.draft_check;
  if (!c) return NO_CHECK;
  if (!c.pass) return CHECK_FAILED;
  const clean = Object.fromEntries(Object.entries(final).map(([k, v]) => [k, cleanText(v, DRAFT_FIELD_CHARS)]));
  return draftHash(clean) === c.hash ? null : NOT_CHECKED_TEXT;
}

/** After the send was recorded: the hash of the final text on the sent row. */
export async function storeFinal(owner: string, programId: string, final: Record<string, string>, applicationId?: string): Promise<void> {
  const clean = Object.fromEntries(Object.entries(final).map(([k, v]) => [k, cleanText(v, DRAFT_FIELD_CHARS)]));
  const db = sql();
  await db`UPDATE applications SET final_hash = ${draftHash(clean)}
    WHERE ctid = (SELECT ctid FROM applications WHERE owner = ${owner} AND program_id = ${programId} AND status = 'applied'
      ${applicationId ? db`AND application_id = ${applicationId}` : db``} ORDER BY sent_at DESC NULLS LAST, at DESC LIMIT 1)`;
}
