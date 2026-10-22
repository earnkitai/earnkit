import { sql } from './db';
import { appClient } from './repo-proof';
import { BUILDER_CODES_FIRST, builderCodesFound, builderCodesIn } from './builder-code';

/**
 * v3.1 Task 7: Base says the first step to be eligible for Base Builder Grants is to integrate Builder Codes
 * (ERC-8021). The one project's repo is read through the read-only App (its tree, then at most BUILDER_CODES_FILES
 * code files, the likeliest first) and the answer is kept in repo_builder_codes for a day. A read that fails (the App
 * off, a 404, a timeout) answers null and stores nothing: the reply then says nothing about Builder Codes.
 */
export const BUILDER_CODES_FILES = 30;
export const BUILDER_CODES_TTL_MS = 86_400_000;

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|coverage|vendor)\//i;
const TEST_FILE = /\.(test|spec)\./i;
const LIKELY = /wagmi|viem|config|provider|client|tx|transaction|contract|wallet|onchain/i;
/** GitHub's contents API carries a file's text up to 1 MB; a bigger file is never read. */
const MAX_FILE_BYTES = 1_000_000;

/**
 * The code files worth reading, the likeliest first: .ts .tsx .js .jsx .mjs .cjs (never .d.ts, a test or spec, or a
 * file under a dependency or build directory); paths naming wagmi, viem, a config, provider, client, transaction,
 * contract, wallet or onchain first, then shorter paths; at most BUILDER_CODES_FILES. Pure.
 */
export function codePaths(paths: string[]): string[] {
  return paths
    .filter((p) => CODE_EXT.test(p) && !/\.d\.ts$/i.test(p) && !SKIP_DIR.test(p) && !TEST_FILE.test(p.split('/').pop() ?? p))
    .map((p) => ({ p, likely: LIKELY.test(p) ? 0 : 1 }))
    .sort((a, b) => a.likely - b.likely || a.p.length - b.p.length || a.p.localeCompare(b.p))
    .slice(0, BUILDER_CODES_FILES)
    .map((x) => x.p);
}

type Tree = { tree?: { path?: unknown; type?: unknown; size?: unknown }[] };
type Content = { content?: unknown; encoding?: unknown };

/**
 * Reads the repo through the App: true at the first file carrying Builder Codes, false when none of codePaths does.
 * A path that answers without text (a symlink, a submodule) is skipped. Stores the answer (repo_builder_codes). Null on
 * any failure (the App off, a 404, a timeout, an HTTP error on any read), and nothing is stored. Never throws.
 */
export async function checkBuilderCodes(builderId: number, repoKey: string, now: Date, deps: { fetch?: typeof fetch } = {}): Promise<boolean | null> {
  try {
    const key = repoKey.toLowerCase();
    const get = await appClient(builderId, key, deps.fetch ?? fetch);
    if (!get) return null;
    const tree = await get<Tree>(`/repos/${key}/git/trees/HEAD?recursive=1`);
    if (!tree || !Array.isArray(tree.tree)) return null;
    const blobs = tree.tree
      .filter((e) => e.type === 'blob' && typeof e.path === 'string' && !(typeof e.size === 'number' && e.size > MAX_FILE_BYTES))
      .map((e) => e.path as string);
    let found: string | null = null;
    for (const path of codePaths(blobs)) {
      const file = await get<Content>(`/repos/${key}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
      if (!file) return null;
      // Fix round 1: a path that answers without text (a symlink, a submodule) is skipped; the scan goes on.
      if (file.encoding !== 'base64' || typeof file.content !== 'string') continue;
      if (builderCodesIn(Buffer.from(file.content, 'base64').toString('utf8'))) {
        found = path;
        break;
      }
    }
    // v3.1 Highlights: the file it was found in (the profile links to it), null when none.
    await sql()`
      INSERT INTO repo_builder_codes (repo_key, found, checked_at, path) VALUES (${key}, ${found !== null}, ${now}, ${found})
      ON CONFLICT (repo_key) DO UPDATE SET found = EXCLUDED.found, checked_at = EXCLUDED.checked_at, path = EXCLUDED.path`;
    return found !== null;
  } catch (err) {
    console.error('[builder-codes] check', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * v3.1 Task 9 fix round 1 (security): whether `repoKey` ("owner/repo") is a repo this builder proved through the read-only
 * App (a builder_sources repo row, proof github_app, state verified; own-brand.ts earnkitOwnRepo's rule). The Builder
 * Codes answer is read and checked only for such a repo, so a caller naming another builder's repo neither reads its
 * stored answer nor spends its once-a-day check. `id` is an installation or its group root. A failed read is false.
 */
export async function appProvenRepo(id: number, repoKey: string): Promise<boolean> {
  try {
    const [r] = await sql()`
      SELECT 1 FROM builder_sources s
      WHERE s.builder_id = (SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = ${id})
        AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app'
        AND regexp_replace(regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', ''), '([.]git)?/*$', '') = ${repoKey.toLowerCase()}`;
    return Boolean(r);
  } catch (err) {
    console.error('[builder-codes] proof', err instanceof Error ? err.name : 'error');
    return false;
  }
}

/** The stored answer for this repo and whether it is under a day old, or null (never checked, or unreadable). Never throws. */
export async function builderCodesKnown(repoKey: string, now: Date): Promise<{ found: boolean; fresh: boolean } | null> {
  try {
    const [row] = await sql()<{ found: boolean; checked_at: Date }[]>`
      SELECT found, checked_at FROM repo_builder_codes WHERE repo_key = ${repoKey.toLowerCase()}`;
    return row ? { found: row.found, fresh: now.getTime() - new Date(row.checked_at).getTime() < BUILDER_CODES_TTL_MS } : null;
  } catch {
    return null;
  }
}

/** v3.1 Highlights: the stored answer with the file it was found in (a repo path, null for none or a check before paths were kept) and when. Never throws. */
export async function storedBuilderCode(repoKey: string): Promise<{ found: boolean; path: string | null; checked_at: Date } | null> {
  try {
    const [row] = await sql()<{ found: boolean; path: string | null; checked_at: Date }[]>`
      SELECT found, path, checked_at FROM repo_builder_codes WHERE repo_key = ${repoKey.toLowerCase()}`;
    return row ?? null;
  } catch {
    return null;
  }
}

/** v3.1 Task 7: the Builder Codes checks running in this process, one per repo. */
const codesRunning = new Map<string, Promise<boolean | null>>();
/**
 * v3.1 Task 7 fix round 1: when this process last started a check per repo. A check that fails stores nothing, so
 * without this an unreadable repo would be read again on every reply; at most one attempt a repo per
 * BUILDER_CODES_TTL_MS (R13: once a day), whether it succeeded or not.
 */
const codesTried = new Map<string, number>();
/** Test only: resolves when every running Builder Codes check has finished. */
export const codesSettled = () => Promise.all([...codesRunning.values()]);

/**
 * v3.1 Tasks 7 and 9 (R13): the repo's check, started unless the stored answer is fresh or one ran within the day: the
 * running check (one per repo), or null when none runs. Never throws (checkBuilderCodes never does).
 */
export function refreshBuilderCodes(
  builderId: number,
  repoKey: string,
  known: { fresh: boolean } | null,
  now: Date,
  f: typeof fetch | undefined,
): Promise<boolean | null> | null {
  const k = repoKey.toLowerCase();
  const running = codesRunning.get(k);
  if (running || known?.fresh) return running ?? null;
  const tried = codesTried.get(k);
  if (tried !== undefined && now.getTime() - tried < BUILDER_CODES_TTL_MS) return null;
  codesTried.set(k, now.getTime());
  const check = checkBuilderCodes(builderId, k, now, { fetch: f }).finally(() => codesRunning.delete(k));
  codesRunning.set(k, check);
  return check;
}

/** The Best fit line's Builder Codes sentence: found, the first step (with the guide), or nothing when unknown. Pure. */
export function builderCodesWords(repo: string, found: boolean | null): string | null {
  return found === true ? builderCodesFound(repo) : found === false ? BUILDER_CODES_FIRST : null;
}

/** v3.1 Highlights: at most this many repos are checked by one cron run. */
export const BUILDER_CODES_PER_RUN = 50;

/**
 * v3.1 Highlights: the App-proven repos of Base projects (builder_projects.chains has base) whose stored answer is
 * missing or a day old, never checked first, then the oldest; at most `limit`. `only` limits the builders (tests).
 */
export async function builderCodesDue(now: Date, o: { limit?: number; only?: number[] } = {}): Promise<{ builder_id: number; repo: string }[]> {
  const db = sql();
  const stale = new Date(now.getTime() - BUILDER_CODES_TTL_MS);
  return db<{ builder_id: number; repo: string }[]>`
    SELECT k.builder_id, k.repo FROM (
      SELECT DISTINCT ON (r.repo) r.builder_id, r.repo FROM (
        SELECT s.builder_id, regexp_replace(regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', ''), '([.]git)?/*$', '') AS repo, s.id
        FROM builder_sources s JOIN builder_projects b ON b.builder_id = s.builder_id AND lower(b.project_key) = lower(s.project_key) AND 'base' = ANY(b.chains)
        WHERE s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app' ${o.only ? db`AND s.builder_id IN ${db(o.only)}` : db``}
      ) r ORDER BY r.repo, r.id
    ) k LEFT JOIN repo_builder_codes c ON c.repo_key = k.repo
    WHERE (c.repo_key IS NULL OR c.checked_at <= ${stale}) AND k.repo ~ '^[a-z0-9-]+/[a-z0-9._-]+$'
    ORDER BY c.checked_at NULLS FIRST, k.repo LIMIT ${o.limit ?? BUILDER_CODES_PER_RUN}`;
}

/**
 * v3.1 Highlights: the cron's Builder Codes step (hourly cron; each repo at most once a day, R13). Every due repo goes
 * through refreshBuilderCodes, so the day-old cache and the in-process backoff (codesTried) hold here as in find and
 * prepare; one at a time, none started past `deadline`. `checked`: checks run, `found`: of them, with a code.
 */
export async function runBuilderCodes(
  now: Date,
  o: { fetch?: typeof fetch; only?: number[]; limit?: number; deadline?: number } = {},
): Promise<{ due: number; checked: number; found: number }> {
  const due = await builderCodesDue(now, o);
  let checked = 0;
  let found = 0;
  for (const r of due) {
    if (o.deadline !== undefined && Date.now() >= o.deadline) break;
    const check = refreshBuilderCodes(r.builder_id, r.repo, { fresh: false }, now, o.fetch);
    if (!check) continue;
    checked++;
    if ((await check) === true) found++;
  }
  return { due: due.length, checked, found };
}
