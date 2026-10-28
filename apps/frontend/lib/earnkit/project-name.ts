import { sql } from './db';
import { wholeWords } from './untrusted-text';

/**
 * v3.1 GTM W3 (one name per project): the name the builder gave a project wins everywhere (replies, the page, the
 * card), over the repo's name and never replaced by its URL host. These read it from the reported identity
 * (builder_profiles.identity.projects), matching the project key to any of the project's refs.
 */
type Reported = { name?: unknown; repo?: unknown; live_url?: unknown; package?: unknown; contracts?: unknown };

/** A project ref compared loosely: no scheme, "www.", GitHub host or trailing slash; lower case. Pure. */
export const refKey = (v: string): string =>
  v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^github\.com\//, '').replace(/\/+$/, '');

/** The reported project whose repo, live link, package or a contract is `key`; undefined when none. Pure. */
export function reportedProject<P extends Reported>(projects: P[], key: string): P | undefined {
  const k = refKey(key);
  const byRef = projects.find((p) =>
    [p.repo, p.live_url, p.package, ...(Array.isArray(p.contracts) ? p.contracts : [])].some((v) => typeof v === 'string' && refKey(v) === k));
  if (byRef) return byRef;
  // v4.2 (F15): a repo connected later (a Lovable export) is not in the reported refs; the project the builder named the
  // same as the repo's name (case and punctuation aside) is that project.
  const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const repoName = squash(k.split('/').pop() ?? k);
  return repoName ? projects.find((p) => typeof p.name === 'string' && squash(p.name) === repoName) : undefined;
}

/** The builder-given name of `key`'s project (at most 60 characters, whole words), else null. Pure. */
export function reportedNameIn(projects: unknown, key: string): string | null {
  const p = reportedProject(Array.isArray(projects) ? (projects as Reported[]) : [], key);
  return typeof p?.name === 'string' && p.name.trim() ? wholeWords(p.name, 60) : null;
}

/** reportedNameIn over the builder's stored identity; null on none or a read error. Never throws. */
export async function reportedName(builderId: number, key: string): Promise<string | null> {
  try {
    const [p] = await sql()<{ projects: unknown }[]>`SELECT identity->'projects' AS projects FROM builder_profiles WHERE builder_id = ${builderId}`;
    return reportedNameIn(p?.projects, key);
  } catch {
    return null;
  }
}
