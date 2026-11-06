/**
 * A program's reviewers: builders the owner marks (POST /api/programs/reviewers, the programs bearer)
 * so their agents may call `screen` for that program. A reviewer must have signed in once first.
 */
import { z } from 'zod';
import { sql } from '../v5/db';
import { bearerMatches, json, readCapped } from '../v5/http';
import { getProgram } from '../v5/programs';
import { programsApiOn } from '../v5/programs-api';

export type ReviewerResult = { ok: true; builder_id: number } | { ok: false; reason: string };

const NO_BUILDER = 'no builder with that GitHub login has signed in';
const NO_PROGRAM = 'unknown program';
const MAX_BODY = 4_096;

async function builderByLogin(login: string): Promise<number | null> {
  const [r] = await sql()<{ id: number }[]>`SELECT id FROM builders WHERE lower(login) = lower(${login}) ORDER BY last_seen_at DESC LIMIT 1`;
  return r?.id ?? null;
}

/** Marks the builder with this GitHub login (case ignored) a reviewer of the program; again updates the contact. */
export async function addReviewer(programId: string, githubLogin: string, contact: string | null): Promise<ReviewerResult> {
  if (!(await getProgram(programId))) return { ok: false, reason: NO_PROGRAM };
  const id = await builderByLogin(githubLogin);
  if (id === null) return { ok: false, reason: NO_BUILDER };
  await sql()`INSERT INTO program_reviewers (program_id, builder_id, contact) VALUES (${programId}, ${id}, ${contact})
    ON CONFLICT (program_id, builder_id) DO UPDATE SET contact = EXCLUDED.contact`;
  return { ok: true, builder_id: id };
}

export async function removeReviewer(programId: string, githubLogin: string): Promise<ReviewerResult> {
  const id = await builderByLogin(githubLogin);
  if (id === null) return { ok: false, reason: NO_BUILDER };
  await sql()`DELETE FROM program_reviewers WHERE program_id = ${programId} AND builder_id = ${id}`;
  return { ok: true, builder_id: id };
}

/** The program ids this builder reviews. */
export async function reviewerPrograms(builderId: number): Promise<string[]> {
  const rows = await sql()<{ program_id: string }[]>`SELECT program_id FROM program_reviewers WHERE builder_id = ${builderId} ORDER BY program_id`;
  return rows.map((r) => r.program_id);
}

const Body = z
  .object({
    program_id: z.string().min(1).max(100),
    github_login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/, 'a GitHub login'),
    contact: z.string().max(200).optional(),
    remove: z.literal(true).optional(),
  })
  .strict();

/** POST /api/programs/reviewers: 404 while the programs API is off, 401 for a wrong token, 400 with the reason. */
export async function reviewersPost(request: Request): Promise<Response> {
  if (!programsApiOn()) return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!bearerMatches(request.headers.get('authorization'), process.env.EARNKIT_PROGRAMS_TOKEN)) return json({ ok: false, error: 'unauthorized' }, 401);
  const text = await readCapped(request, MAX_BODY);
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
    const out = b.remove ? await removeReviewer(b.program_id, b.github_login) : await addReviewer(b.program_id, b.github_login, b.contact?.trim() || null);
    if (!out.ok) return json({ ok: false, error: out.reason }, 400);
    console.log(`[reviewers] ${b.remove ? 'remove' : 'add'} ${b.program_id} ${out.builder_id}`);
    return json(out);
  } catch (err) {
    console.error(`[reviewers] failed: ${err instanceof Error ? err.name : 'unknown'}`);
    return json({ ok: false, error: 'EarnKit is busy. Try again in a minute.' }, 503);
  }
}
