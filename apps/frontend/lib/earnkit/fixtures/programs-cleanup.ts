import { sql } from '../db';

/**
 * Delete program rows a test made (their tracks and starters cascade). A row something still points
 * at (an entry, a bonus round) is closed instead, so no test leaves an active program behind.
 */
export async function dropPrograms(ids: string[]): Promise<void> {
  for (const id of ids)
    await sql()`DELETE FROM programs WHERE id = ${id}`.catch(() => sql()`UPDATE programs SET status = 'closed' WHERE id = ${id}`);
}

/**
 * Task 17: at a file's end, drop (or close) every program this test process made, so none piles up
 * in the shared DB across runs: ids carrying this process's pid as "-<pid>-" or a trailing "-<pid>",
 * plus any `prefixes` (each followed by the pid). Other files run as other processes, so their rows
 * are never touched.
 */
export async function dropRunPrograms(prefixes: string[] = []): Promise<void> {
  const pid = String(process.pid);
  const rows = await sql()<{ id: string }[]>`
    SELECT id FROM programs
    WHERE id LIKE ${`%-${pid}-%`} OR id LIKE ${`%-${pid}`} OR id LIKE ANY(${prefixes.map((p) => `${p}${pid}%`)}::text[])`;
  await dropPrograms(rows.map((r) => r.id));
}
