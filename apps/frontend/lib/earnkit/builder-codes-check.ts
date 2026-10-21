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
    let found = false;
    for (const path of codePaths(blobs)) {
      const file = await get<Content>(`/repos/${key}/contents/${path.split('/').map(encodeURIComponent).join('/')}`);
      if (!file) return null;
      // Fix round 1: a path that answers without text (a symlink, a submodule) is skipped; the scan goes on.
      if (file.encoding !== 'base64' || typeof file.content !== 'string') continue;
      if (builderCodesIn(Buffer.from(file.content, 'base64').toString('utf8'))) {
        found = true;
        break;
      }
    }
    await sql()`
      INSERT INTO repo_builder_codes (repo_key, found, checked_at) VALUES (${key}, ${found}, ${now})
      ON CONFLICT (repo_key) DO UPDATE SET found = EXCLUDED.found, checked_at = EXCLUDED.checked_at`;
    return found;
  } catch (err) {
    console.error('[builder-codes] check', err instanceof Error ? err.name : 'error');
    return null;
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

/** The Best fit line's Builder Codes sentence: found, the first step (with the guide), or nothing when unknown. Pure. */
export function builderCodesWords(repo: string, found: boolean | null): string | null {
  return found === true ? builderCodesFound(repo) : found === false ? BUILDER_CODES_FIRST : null;
}
