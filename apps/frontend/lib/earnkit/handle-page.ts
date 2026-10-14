import { sql } from './db';
import { standingOf } from './person-score';

/**
 * v2.12.1 T6: the page's top line until T11 builds the full page: "<X name> has shipped <n> <noun>
 * with AI." from the person's live standing and their shipped projects (the noun is their kind when
 * all share one, else "project"). Nothing shipped yet: "<X name> is building with AI."
 */
const NOUNS: Record<string, string> = { app: 'app', package: 'package', coin: 'coin' };

/** Pure. */
export function topLine(name: string, shipped: number, kinds: string[]): string {
  if (shipped <= 0) return `${name} is building with AI.`;
  const one = new Set(kinds).size === 1 ? NOUNS[kinds[0]] : undefined;
  const noun = one ?? 'project';
  return `${name} has shipped ${shipped} ${noun}${shipped === 1 ? '' : 's'} with AI.`;
}

export async function handleTopLine(builderId: number): Promise<string> {
  const s = await standingOf(builderId);
  const [p] = await sql()<{ x_name: string | null; x_handle: string | null }[]>`
    SELECT x_name, x_handle FROM builder_profiles WHERE builder_id = ${builderId}`;
  const kinds = await sql()<{ kind: string }[]>`
    SELECT DISTINCT kind FROM builder_projects WHERE builder_id = ${builderId} AND shipped AND confirmed`;
  const name = p?.x_name || (p?.x_handle ? `@${p.x_handle}` : 'This builder');
  return topLine(name, s.shipped, kinds.map((k) => k.kind));
}
