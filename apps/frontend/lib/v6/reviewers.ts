/**
 * A program's reviewers: builders the owner marks (POST /api/programs/reviewers, the programs bearer)
 * so their agents may call `screen` for that program. A reviewer must have signed in once first.
 */
import { z } from 'zod';
import { sql } from '../v5/db';
import { json, readBody } from '../v5/http';
import { foldId, getProgram } from '../v5/programs';
import { authFailure } from '../v5/programs-api';

export type ReviewerResult = { ok: true; builder_id: number } | { ok: false; reason: string };

const NO_BUILDER = 'no builder with that GitHub login has signed in';
const NO_BUILDER_ID = 'no builder with that GitHub id has signed in';
const AMBIGUOUS = 'two accounts have used that login; send github_id';
const NO_PROGRAM = 'unknown program';
const NOT_REVIEWER = 'that builder is not a reviewer of that program';
const MAX_BODY = 4_096;

/**
 * The builder: by GitHub id when given (a login can change hands), else by login (case ignored), refused
 * when more than one builder row has used that login.
 */
async function builderOf(githubLogin: string | null, githubId?: number): Promise<{ id: number } | { reason: string }> {
  if (githubId !== undefined) {
    const [r] = await sql()<{ id: number }[]>`SELECT id FROM builders WHERE github_id = ${githubId}`;
    return r ? { id: r.id } : { reason: NO_BUILDER_ID };
  }
  if (!githubLogin) return { reason: NO_BUILDER };
  const rows = await sql()<{ id: number }[]>`SELECT id FROM builders WHERE lower(login) = lower(${githubLogin}) LIMIT 2`;
  if (rows.length > 1) return { reason: AMBIGUOUS };
  return rows[0] ? { id: rows[0].id } : { reason: NO_BUILDER };
}

/** Marks the builder (by GitHub id, else by login) a reviewer of the program; again updates the contact when one is
 *  sent and keeps the saved one when none is (L15-2, v6.1.14). */
export async function addReviewer(programId: string, githubLogin: string | null, contact: string | null, githubId?: number): Promise<ReviewerResult> {
  // L31-4 (v6.1.16 Task 17): getProgram folds the id, so the stored id is the program's own.
  const program = await getProgram(programId);
  if (!program) return { ok: false, reason: NO_PROGRAM };
  programId = program.id;
  const b = await builderOf(githubLogin, githubId);
  if ('reason' in b) return { ok: false, reason: b.reason };
  const id = b.id;
  await sql()`INSERT INTO program_reviewers (program_id, builder_id, contact) VALUES (${programId}, ${id}, ${contact})
    ON CONFLICT (program_id, builder_id) DO UPDATE SET contact = COALESCE(EXCLUDED.contact, program_reviewers.contact)`;
  return { ok: true, builder_id: id };
}

export async function removeReviewer(programId: string, githubLogin: string | null, githubId?: number): Promise<ReviewerResult> {
  const b = await builderOf(githubLogin, githubId);
  if ('reason' in b) return { ok: false, reason: b.reason };
  const id = b.id;
  // L31-4 (v6.1.16 Task 17, controller ruling): the id as addReviewer stores it (the catalog program's own, else
  // folded); nothing deleted is ok:false, so a revocation is never reported that did not happen.
  const canonical = (await getProgram(programId))?.id ?? foldId(programId);
  const gone = await sql()`DELETE FROM program_reviewers WHERE program_id = ${canonical} AND builder_id = ${id} RETURNING program_id`;
  return gone.length > 0 ? { ok: true, builder_id: id } : { ok: false, reason: NOT_REVIEWER };
}

/** The program ids this builder reviews. */
export async function reviewerPrograms(builderId: number): Promise<string[]> {
  const rows = await sql()<{ program_id: string }[]>`SELECT program_id FROM program_reviewers WHERE builder_id = ${builderId} ORDER BY program_id`;
  return rows.map((r) => r.program_id);
}

const Body = z
  .object({
    program_id: z.string().min(1).max(100),
    github_login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/, 'a GitHub login').optional(),
    github_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    contact: z.string().max(200).optional(),
    remove: z.literal(true).optional(),
  })
  .strict()
  .refine((b) => b.github_login !== undefined || b.github_id !== undefined, { message: 'github_login or github_id is required' });

/** POST /api/programs/reviewers: 404 while the programs API is off, 401 for a wrong token, 400 with the reason. */
export async function reviewersPost(request: Request): Promise<Response> {
  const denied = authFailure(request);
  if (denied) return denied;
  const text = await readBody(request, MAX_BODY, () => json({ ok: false, error: 'the body came too slowly' }, 408));
  if (text instanceof Response) return text;
  if (text === null) return json({ ok: false, error: 'body too large' }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'the body is not JSON' }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, 400);
  const b = parsed.data;
  try {
    const login = b.github_login ?? null;
    const out = b.remove
      ? await removeReviewer(b.program_id, login, b.github_id)
      : await addReviewer(b.program_id, login, b.contact?.trim() || null, b.github_id);
    if (!out.ok) return json({ ok: false, error: out.reason }, 400);
    console.log(`[reviewers] ${b.remove ? 'remove' : 'add'} ${b.program_id} ${out.builder_id}`);
    return json(out);
  } catch (err) {
    console.error(`[reviewers] failed: ${err instanceof Error ? err.name : 'unknown'}`);
    return json({ ok: false, error: 'EarnKit is busy. Try again in a minute.' }, 503);
  }
}
