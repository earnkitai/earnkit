import { randomInt } from 'node:crypto';
import { afterCommit, inTx, sql, type Db } from './db';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';
import { profileChanged } from './profile-cache';
import { pagePath } from './reserved-routes';

/**
 * One profile per person (the group root, v2.12 plan R1). v2.12.1 spec "Identity": the public page
 * is earnkit.com/<x-handle>, only once the person claimed it with Sign in with X (x-install.ts bindX); the
 * slug is an internal key (random until the claim, then the handle). A v2.12 slug, live or old (in
 * profile_slug_history), moves to the page of a claimed person (resolveSlug). One GitHub login, one
 * profile.
 */
export const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** tell's profile, card, move_up or coin on an agent serving many builders: there is no one page to change. */
export const SHARED_PROFILE_NOTE =
  "This agent serves many builders, so there is no public profile to change here. Don't show this to the builder.";
/** v2.12.1 T12: "hide my page" and "show my page" (the claim page names the first). */
export const HIDDEN_LINE = 'Your page is hidden. Say show my page to list it again.';
export const SHOWN_LINE = (handle: string | null) => (handle ? `Your page is public again: earnkit.com${pagePath(handle)}` : 'Your page is no longer hidden.');
export const NO_PROFILE_LINE = 'You have no page yet.';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,40}$/;
export const randomSlug = (rand: (n: number) => number = randomInt) =>
  `b-${Array.from({ length: 8 }, () => ALPHABET[rand(ALPHABET.length)]).join('')}`;

export type Profile = {
  builder_id: number; slug: string; x_handle: string | null; fallback_handle: string | null; github_login: string | null;
  hidden: boolean; held: boolean; twitter_prefill: string | null; card_offered_at: Date | null; x_asked_at: Date | null; first_find_at: Date;
};
const COLUMNS = ['builder_id', 'slug', 'x_handle', 'fallback_handle', 'github_login', 'hidden', 'held', 'twitter_prefill', 'card_offered_at', 'x_asked_at', 'first_find_at'];

export async function profileOf(builderId: number, db: Db = sql()): Promise<Profile | null> {
  const [p] = await db<Profile[]>`SELECT ${db(COLUMNS)} FROM builder_profiles WHERE builder_id = ${builderId}`;
  return p ?? null;
}

/** The person's first remembered wallet (earliest first seen, across their group), lowercase, or null. */
async function firstWallet(db: Db, builderId: number): Promise<string | null> {
  const [w] = await db<{ wallet: string }[]>`
    SELECT lower(w.wallet) AS wallet FROM installation_wallets w JOIN installations i ON i.id = w.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} ORDER BY w.first_seen_at, w.wallet LIMIT 1`;
  return w?.wallet ?? null;
}

/** The person's profile, made on their first find with a random slug. Never on a shared group (plan R2). */
export async function ensureProfile(
  builderId: number,
  at: Date,
  o: { rand?: (n: number) => number; db?: Db } = {},
): Promise<{ profile: Profile; created: boolean } | null> {
  // v2.14: `db`, a caller's transaction (attachToX makes the page in the same one that binds it).
  const db = o.db ?? sql();
  if (await sharedGroup(builderId, db)) return null;
  const existing = await profileOf(builderId, db);
  if (existing) return { profile: existing, created: false };
  for (let tries = 0; tries < 5; tries++) {
    // Never another person's old slug: a live slug wins over history, so it would take over their redirect.
    const slug = randomSlug(o.rand);
    const [row] = await db<Profile[]>`
      INSERT INTO builder_profiles (builder_id, slug, first_find_at)
      SELECT ${builderId}, ${slug}, ${at} WHERE NOT EXISTS (SELECT 1 FROM profile_slug_history WHERE old_slug = ${slug})
      ON CONFLICT DO NOTHING RETURNING ${db(COLUMNS)}`;
    if (row) return { profile: row, created: true };
    const again = await profileOf(builderId, db);
    if (again) return { profile: again, created: false };
  }
  throw new Error('no free slug');
}

/**
 * The proven login, else the first proven wallet: the shown fallback (admin and history only; the
 * page shows the X name). A login is set once and only if no other profile holds it (one login, one
 * person).
 */
export type GithubBasis = 'signin' | 'app' | 'proof_line' | 'x_match' | 'proof_branch';

/** v2.12.1: `basis` is how the login was proven, kept as github_basis with the login (a merge reads it). */
export async function setFallback(builderId: number, f: { github_login?: string; basis?: GithubBasis; wallet?: string }, db?: Db): Promise<void> {
  const changed = await inTx(db, async (tx) => {
    const [p] = await tx<Profile[]>`SELECT ${tx(COLUMNS)} FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!p) return false;
    let login = p.github_login;
    if (!login && f.github_login) {
      const want = f.github_login.toLowerCase();
      const [taken] = await tx`SELECT 1 FROM builder_profiles WHERE lower(github_login) = ${want} AND builder_id <> ${builderId}`;
      if (!taken) login = want;
    }
    // Without a login, the person's first remembered wallet names them (else the one given); once
    // a wallet named them, a later one changes nothing.
    const wallet = login || p.fallback_handle ? null : ((await firstWallet(tx, builderId)) ?? f.wallet?.toLowerCase() ?? null);
    const fallback = login ?? p.fallback_handle ?? (wallet ? shortWallet(wallet) : null);
    if (login !== p.github_login || fallback !== p.fallback_handle)
      await tx`UPDATE builder_profiles SET github_login = ${login}, fallback_handle = ${fallback}, updated_at = now() WHERE builder_id = ${builderId}`;
    if (login && login !== p.github_login && f.basis)
      await tx`UPDATE builder_profiles SET github_basis = ${f.basis} WHERE builder_id = ${builderId}`;
    // v2.12.1 T12: the slug no longer follows the login or a wallet (it is an internal key; the page
    // is the X handle). A new login changes what the page shows: the cached page must follow.
    return login !== p.github_login;
  });
  if (changed) await afterCommit(db, profileChanged);
}

/** spec 8: "hide" and "show". The row stays; a hidden page is not shown or listed and is in no one's rank (person-score.ts listedRanked). */
export async function setHidden(builderId: number, hidden: boolean): Promise<string> {
  const [p] = await sql()<{ x_handle: string | null; claimed: boolean }[]>`
    UPDATE builder_profiles SET hidden = ${hidden}, updated_at = now() WHERE builder_id = ${builderId}
    RETURNING x_handle, x_user_id IS NOT NULL AS claimed`;
  if (!p) return NO_PROFILE_LINE;
  profileChanged();
  const type = hidden ? 'profile_hidden' : 'profile_shown';
  await noteEvent(type, () => ({ type, dedupe_key: `${type}:${builderId}:${Date.now()}`, installation_id: builderId }));
  return hidden ? HIDDEN_LINE : SHOWN_LINE(p.claimed ? p.x_handle : null);
}

/**
 * Release path for a handle: a v2.12 self-declared one GitHub no longer lists (by 'github', from
 * discovery; never a claimed one) or one the owner cleared (by 'owner', app/admin/scores). With no
 * handle the page is gone (resolveHandle and resolveSlug need one). True when a handle was cleared.
 */
export async function clearXHandle(builderId: number, by: 'github' | 'owner', db?: Db): Promise<boolean> {
  const cleared = await inTx(db, async (tx) => {
    const [p] = await tx<(Profile & { x_user_id: string | null })[]>`
      SELECT ${tx(COLUMNS)}, x_user_id FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!p?.x_handle) return null;
    // v2.12.1 T6: a handle confirmed by Sign in with X is never GitHub's to clear (only the owner's).
    if (p.x_user_id && by === 'github') return null;
    await tx`UPDATE builder_profiles SET x_handle = NULL, updated_at = now() WHERE builder_id = ${builderId}`;
    // Final fix wave: the owner's clear sticks. That X account claims no page again until the owner
    // releases it (releaseXClear).
    if (by === 'owner' && p.x_user_id)
      await tx`
        INSERT INTO x_owner_clears (x_user_id, builder_id) VALUES (${p.x_user_id}, ${builderId})
        ON CONFLICT (x_user_id) DO UPDATE SET builder_id = EXCLUDED.builder_id, cleared_at = now()`;
    return p.x_handle.toLowerCase();
  });
  if (!cleared) return false;
  // v2.13.4: after the caller's transaction commits (discovery), never inside it.
  await afterCommit(db, profileChanged);
  await afterCommit(db, () => noteEvent('x_cleared', () => ({
    type: 'x_cleared', dedupe_key: `x_cleared:${builderId}:${cleared}:${Date.now()}`, installation_id: builderId, detail: { by },
  })));
  return true;
}

/**
 * Final fix wave: the owner releases an X account they cleared (/admin/scores), on the page it was
 * cleared from (or the page that X account is on now); its next claim binds again. True when one was released.
 */
export async function releaseXClear(builderId: number): Promise<boolean> {
  const rows = await sql()`
    DELETE FROM x_owner_clears WHERE builder_id = ${builderId}
      OR x_user_id = (SELECT x_user_id FROM builder_profiles WHERE builder_id = ${builderId})
    RETURNING 1`;
  if (rows.length === 0) return false;
  await noteEvent('x_cleared', () => ({
    type: 'x_cleared', dedupe_key: `x_cleared:${builderId}:released:${Date.now()}`, installation_id: builderId, detail: { by: 'owner', released: true },
  }));
  return true;
}

/** The X accounts the owner cleared and has not released, newest first: one line each for /admin/scores. */
export async function ownerClears(): Promise<{ builder_id: number; line: string }[]> {
  const rows = await sql()<{ builder_id: number; cleared_at: Date }[]>`
    SELECT builder_id, cleared_at FROM x_owner_clears ORDER BY cleared_at DESC LIMIT 100`;
  return rows.map((r) => ({ builder_id: r.builder_id, line: `Cleared on ${r.cleared_at.toISOString().slice(0, 10)} (builder id ${r.builder_id})` }));
}

/**
 * The owner's open X handle conflicts: a v2.12 claim refused because another profile shows the
 * handle, while that profile still does. One line each: 'x_handle conflict: @h (builder ids a, b)'.
 * v2.12.1: kept for the rows v2.12 wrote; nothing writes new ones (X comes only from the claim).
 */
export async function xHandleConflicts(only?: number[]): Promise<{ handle: string; holder: number; claimant: number; line: string }[]> {
  const rows = await sql()<{ handle: string; holder: number; claimant: number }[]>`
    SELECT c.handle, c.holder, c.claimant FROM x_handle_conflicts c
    JOIN builder_profiles p ON p.builder_id = c.holder AND lower(p.x_handle) = c.handle
    ${only ? sql()`WHERE c.holder IN ${sql()(only.length ? only : [-1])} OR c.claimant IN ${sql()(only.length ? only : [-1])}` : sql()``}
    ORDER BY c.at, c.handle, c.claimant`;
  return rows.map((r) => ({ ...r, line: `x_handle conflict: @${r.handle} (builder ids ${r.holder}, ${r.claimant})` }));
}

/**
 * v2.12.1 owner ruling "Before the claim, everything shows in replies only; there is no public page":
 * a v2.12 slug (live or old) names a person only once they claimed their page with X, and is not
 * hidden; `redirect` is the current slug for an old one, `handle` the page's X handle (/b/<slug>,
 * its card and share link move to it). Null otherwise.
 */
export async function resolveSlug(slug: string): Promise<{ builderId: number; redirect: string | null; handle: string } | null> {
  const s = slug.toLowerCase();
  if (!SLUG.test(s)) return null;
  type Row = { builder_id: number; slug: string; x_handle: string | null; hidden: boolean; live: boolean };
  const [p] = await sql()<Row[]>`
    SELECT builder_id, slug, x_handle, hidden, true AS live FROM builder_profiles WHERE slug = ${s} AND x_user_id IS NOT NULL
    UNION ALL
    SELECT p.builder_id, p.slug, p.x_handle, p.hidden, false FROM profile_slug_history h JOIN builder_profiles p USING (builder_id)
    WHERE h.old_slug = ${s} AND p.x_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM builder_profiles q WHERE q.slug = ${s})
    LIMIT 1`;
  if (!p || p.hidden || !p.x_handle) return null;
  return { builderId: p.builder_id, redirect: p.live ? null : p.slug, handle: p.x_handle };
}

/** v2.12.1 spec "Identity": an old X handle redirects to the new one for this many days after a rename. */
export const HANDLE_REDIRECT_DAYS = 90;

/**
 * The page at /<handle> (or /b/<handle> when reserved): the claimed, shown person whose X handle it
 * is, in its own case; another case, or an X handle renamed in the last HANDLE_REDIRECT_DAYS (a
 * history row bindX marked handle_rename; never a v2.12 login or wallet slug), is a redirect to
 * the page's path. Hidden, unclaimed or unknown: null.
 */
export async function resolveHandle(raw: string, now = new Date()): Promise<{ builderId: number; handle: string } | { redirect: string } | null> {
  if (!X_HANDLE.test(raw)) return null;
  const h = raw.toLowerCase();
  const [live] = await sql()<{ builder_id: number; x_handle: string; hidden: boolean }[]>`
    SELECT builder_id, x_handle, hidden FROM builder_profiles WHERE lower(x_handle) = ${h} AND x_user_id IS NOT NULL`;
  if (live) return live.hidden ? null : live.x_handle === raw ? { builderId: live.builder_id, handle: live.x_handle } : { redirect: pagePath(live.x_handle) };
  const [old] = await sql()<{ x_handle: string | null; hidden: boolean }[]>`
    SELECT p.x_handle, p.hidden FROM profile_slug_history s JOIN builder_profiles p USING (builder_id)
    WHERE s.old_slug = ${h} AND s.handle_rename AND s.moved_at > ${new Date(now.getTime() - HANDLE_REDIRECT_DAYS * 86_400_000)} AND p.x_user_id IS NOT NULL`;
  return old?.x_handle && !old.hidden ? { redirect: pagePath(old.x_handle) } : null;
}
