import { githubRepo } from './campaigns';
import { sql } from './db';
import { EARNKIT_ORGS } from './earnkit-orgs';

/**
 * Scoring and clarity (Task 4 fix round 1): whether `repoUrl` is EarnKit's own repo for this builder, verified:
 * its owner is an EarnKit GitHub org (earnkit-orgs.ts) AND it is a repo source of this builder proven by the
 * read-only GitHub App (proof github_app, state verified). Only then may a token use EarnKit's own brand
 * (token-proposal.ts OwnBrand). `id` is an installation or its group root. A link alone, a non-EarnKit owner or a
 * failed read is false. http://, www. and .git forms of the link read the same (campaigns.ts githubRepo).
 */
export async function earnkitOwnRepo(id: number, repoUrl: string | null | undefined): Promise<boolean> {
  const gh = repoUrl ? githubRepo(repoUrl) : null;
  if (!gh || !(EARNKIT_ORGS as readonly string[]).includes(gh.owner.toLowerCase())) return false;
  const key = `${gh.owner}/${gh.repo}`.toLowerCase();
  try {
    const [r] = await sql()`
      SELECT 1 FROM builder_sources s
      WHERE s.builder_id = (SELECT COALESCE(i.builder_id, i.id) FROM installations i WHERE i.id = ${id})
        AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app'
        AND regexp_replace(regexp_replace(lower(trim(s.ref)), '^(https?://)?(www[.])?github[.]com/', ''), '([.]git)?/*$', '') = ${key}`;
    return Boolean(r);
  } catch (err) {
    console.error('[token] own brand', err instanceof Error ? err.name : 'error');
    return false;
  }
}
