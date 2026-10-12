import { builderScoreEnabled } from './builder-score-flag';
import { sql, type Db } from './db';
import { githubRemote } from './discovery-clues';
import { noteEvent } from './events';

/**
 * v2.12 spec 3: finding a person's past work. `find` never waits on it: it records the agent's
 * clues and queues the person; the hourly cron's `discover` step (Task 6) does the reads.
 */
export type LocalGit = { emails: string[]; remotes: string[]; live_urls: string[] };

/** How many queued people one cron run's discover step reads (Task 6). */
export const DISCOVER_PER_RUN = 20;

/** At most `scan` entries are looked at; strings only, trimmed, non-empty. */
const strings = (v: unknown, scan: number): string[] =>
  Array.isArray(v) ? v.slice(0, scan).filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [];

/** A live link must be a public https site: no loopback, private, link-local or .local host. */
export function publicHttpsOrigin(u: string): string | null {
  if (u.length > 300 || !URL.canParse(u)) return null;
  const url = new URL(u);
  if (url.protocol !== 'https:') return null;
  const h = url.hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (h.startsWith('[') || h.includes(':')) return null; // any IPv6 literal (::1, fe80::, fc00::)
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  } else if (!h.includes('.') || /^[\d.]+$/.test(h) || /^0x/i.test(h)) return null; // no bare or numeric hosts
  return url.origin;
}

/** find's `local_git`, read leniently (v2.8.1 §B6 style): never throws; at most 20 remotes and 5 emails and live links. */
export function localGitInput(v: unknown): LocalGit {
  try {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const remotes = [...new Set(strings(o.remotes, 200).map(githubRemote).filter((r): r is string => !!r))].slice(0, 20);
    const emails = strings(o.emails, 50).filter((e) => /^[^@\s]{1,64}@[^@\s]{1,255}$/.test(e)).map((e) => e.toLowerCase()).slice(0, 5);
    const live_urls = [...new Set(strings(o.live_urls, 50).map(publicHttpsOrigin).filter((u): u is string => !!u))].slice(0, 5);
    return { emails, remotes, live_urls };
  } catch {
    return { emails: [], remotes: [], live_urls: [] };
  }
}

export async function enqueueDiscovery(builderId: number, reason: 'first_find' | 'wallet' | 'signin' | 'local_repo', db: Db = sql()): Promise<void> {
  // first_find is insert-only: a later find never re-opens a done entry. Only a new clue does.
  if (reason === 'first_find') {
    await db`INSERT INTO discovery_queue (builder_id, reason) VALUES (${builderId}, ${reason}) ON CONFLICT (builder_id) DO NOTHING`;
    return;
  }
  await db`
    INSERT INTO discovery_queue (builder_id, reason) VALUES (${builderId}, ${reason})
    ON CONFLICT (builder_id) DO UPDATE SET reason = EXCLUDED.reason, queued_at = now(), done_at = NULL
    WHERE discovery_queue.done_at IS NOT NULL`;
}

/** Proposes the agent's remotes and live links as sources (never verified here); queues discovery on anything new. */
export async function noteLocalGit(builderId: number, g: LocalGit): Promise<number> {
  const db = sql();
  const rows = [
    ...g.remotes.map((r) => ({ builder_id: builderId, kind: 'repo', ref: r, project_key: r, proposed_by: 'agent' })),
    ...g.live_urls.map((u) => ({ builder_id: builderId, kind: 'site', ref: u, project_key: u, proposed_by: 'agent' })),
  ];
  if (rows.length === 0) return 0;
  const added = await db<{ id: string; kind: string; ref: string }[]>`
    INSERT INTO builder_sources ${db(rows)} ON CONFLICT (builder_id, kind, ref) DO NOTHING RETURNING id, kind, ref`;
  for (const s of added)
    await noteEvent('source_proposed', () => ({
      type: 'source_proposed', dedupe_key: `source_proposed:${s.id}`, installation_id: builderId,
      detail: { source_id: Number(s.id), kind: s.kind, by: 'agent' },
    }));
  if (added.length > 0) await enqueueDiscovery(builderId, 'local_repo', db);
  return added.length;
}

/**
 * spec 3: a new clue (a wallet remembered at deploy, a GitHub sign-in) queues the person's discovery
 * again. Only with EARNKIT_BUILDER_SCORE=on, only for a person who already has a profile (their
 * first find queues them), never for a shared group. Never throws: the caller's step goes on.
 */
export async function enqueueClue(installationId: number, reason: 'wallet' | 'signin'): Promise<boolean> {
  if (!builderScoreEnabled()) return false;
  try {
    const [p] = await sql()<{ root: number }[]>`
      SELECT p.builder_id AS root FROM installations i
      JOIN builder_profiles p ON p.builder_id = COALESCE(i.builder_id, i.id)
      WHERE i.id = ${installationId}
        AND NOT EXISTS (SELECT 1 FROM installations s WHERE COALESCE(s.builder_id, s.id) = p.builder_id AND s.shared_client)`;
    if (!p) return false;
    await enqueueDiscovery(p.root, reason);
    return true;
  } catch (err) {
    console.error('[discovery] clue', err instanceof Error ? err.name : 'error');
    return false;
  }
}
