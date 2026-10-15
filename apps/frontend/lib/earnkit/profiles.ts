import { randomInt } from 'node:crypto';
import type postgres from 'postgres';
import { builderScoreEnabled } from './builder-score-flag';
import { sql, type Db } from './db';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';
import { profileChanged } from './profile-cache';
import { pagePath } from './reserved-routes';

/**
 * One profile per person (the group root, v2.12 plan R1). v2.12.1 spec "Identity": the public page
 * is earnkit.com/<x-handle>, only once the person claimed it with Sign in with X (claim.ts bindX); the
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
  o: { rand?: (n: number) => number } = {},
): Promise<{ profile: Profile; created: boolean } | null> {
  if (await sharedGroup(builderId)) return null;
  const existing = await profileOf(builderId);
  if (existing) return { profile: existing, created: false };
  for (let tries = 0; tries < 5; tries++) {
    // Never another person's old slug: a live slug wins over history, so it would take over their redirect.
    const slug = randomSlug(o.rand);
    const [row] = await sql()<Profile[]>`
      INSERT INTO builder_profiles (builder_id, slug, first_find_at)
      SELECT ${builderId}, ${slug}, ${at} WHERE NOT EXISTS (SELECT 1 FROM profile_slug_history WHERE old_slug = ${slug})
      ON CONFLICT DO NOTHING RETURNING ${sql()(COLUMNS)}`;
    if (row) return { profile: row, created: true };
    const again = await profileOf(builderId);
    if (again) return { profile: again, created: false };
  }
  throw new Error('no free slug');
}

/**
 * The proven login, else the first proven wallet: the shown fallback (admin and history only; the
 * page shows the X name). A login is set once and only if no other profile holds it (one login, one
 * person).
 */
export type GithubBasis = 'signin' | 'app' | 'proof_line' | 'x_match';

/** v2.12.1: `basis` is how the login was proven, kept as github_basis with the login (a merge reads it). */
export async function setFallback(builderId: number, f: { github_login?: string; basis?: GithubBasis; wallet?: string }): Promise<void> {
  const changed = await sql().begin(async (tx) => {
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
  if (changed) profileChanged();
}

/**
 * v2.12.1 T5 fix round 2 (login-contests.ts): the profile stops showing `login` as its GitHub (a
 * contested login it no longer stands for). The login, its basis and prefill go, an X handle that came
 * from that GitHub profile (never a claim) goes with them, and the work confirmed through the login
 * (sign-in, repo owner, proof line, repo link) goes back to not yet confirmed (proposed: shown, never
 * scored). True when something changed.
 */
export async function releaseLogin(builderId: number, login: string): Promise<boolean> {
  const done = await sql().begin(async (tx) => {
    const [p] = await tx<(Profile & { x_user_id: string | null })[]>`
      SELECT ${tx(COLUMNS)}, x_user_id FROM builder_profiles WHERE builder_id = ${builderId} AND lower(github_login) = ${login.toLowerCase()} FOR UPDATE`;
    if (!p) return false;
    const handle = p.x_user_id ? p.x_handle : null;
    await tx`
      UPDATE builder_profiles SET github_login = NULL, github_basis = NULL, twitter_prefill = NULL, x_handle = ${handle},
        fallback_handle = CASE WHEN lower(fallback_handle) = ${login.toLowerCase()} THEN NULL ELSE fallback_handle END, updated_at = now()
      WHERE builder_id = ${builderId}`;
    await tx`
      UPDATE builder_sources SET state = 'proposed', proof = NULL, verified_at = NULL
      WHERE builder_id = ${builderId} AND state = 'verified' AND proof IN ('github_signin', 'repo_owner', 'proof_line', 'repo_link')`;
    await tx`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${builderId}`;
    return true;
  });
  if (done) profileChanged();
  return done;
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
export async function clearXHandle(builderId: number, by: 'github' | 'owner'): Promise<boolean> {
  const cleared = await sql().begin(async (tx) => {
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
  profileChanged();
  await noteEvent('x_cleared', () => ({
    type: 'x_cleared', dedupe_key: `x_cleared:${builderId}:${cleared}:${Date.now()}`, installation_id: builderId, detail: { by },
  }));
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

/**
 * Plan R3, inside linkInstallations' transaction. Sources move to the root (a duplicate is rejected,
 * 'merged'). The root's profile (the older group) wins (v2.12.1 fix round 1; else the other's, re-keyed),
 * filling gaps with the other's login, its v2.12 X handle and history (cleared before set, so the
 * one-login index holds); hidden or held if either was. The losing slug redirects to the root. The merged-away id's rank is
 * dropped (its scores stay as history and no longer count). With EARNKIT_BUILDER_SCORE on and a
 * profile on either side, the person is rediscovered with both groups' clues. Flag off, no profile
 * and no source exist, so nothing is written.
 */
/** True when a profile was re-keyed or merged (its page changes): the caller calls profileChanged() after commit. */
export async function mergeProfiles(tx: postgres.TransactionSql, root: number, other: number): Promise<boolean> {
  if (root === other) return false;
  await tx`
    UPDATE builder_sources s SET builder_id = ${root} WHERE builder_id = ${other}
      AND NOT EXISTS (SELECT 1 FROM builder_sources r WHERE r.builder_id = ${root} AND r.kind = s.kind AND r.ref = s.ref)`;
  await tx`UPDATE builder_sources SET state = 'rejected', reject_reason = 'merged' WHERE builder_id = ${other} AND state <> 'rejected'`;
  type Row = Profile & {
    empty_checked_at: Date | null; consent_shown_at: Date | null;
    x_user_id: string | null; x_name: string | null; x_avatar_url: string | null; claimed_at: Date | null;
    reported_github: string | null; github_basis: string | null; identity: unknown;
    page_ready_shown_at: Date | null; standing_seen: unknown; card_moments: unknown;
  };
  const rows = await tx<Row[]>`
    SELECT ${tx(COLUMNS)}, empty_checked_at, consent_shown_at, x_user_id, x_name, x_avatar_url, claimed_at, reported_github,
      github_basis, identity, page_ready_shown_at, standing_seen, card_moments
    FROM builder_profiles WHERE builder_id IN (${root}, ${other}) ORDER BY builder_id FOR UPDATE`;
  const r = rows.find((x) => x.builder_id === root);
  const o = rows.find((x) => x.builder_id === other);
  // v2.12.1 spec "Identity": two X accounts are two people (linkInstallations leaves such a group out).
  if (r?.x_user_id && o?.x_user_id && r.x_user_id !== o.x_user_id) throw new Error('two X accounts are two people');
  // v2.12.1: the person's claim codes and signed wallets move to the root; the other's live score and
  // projects go (rebuilt from the merged sources), and the root is read again on the next ask.
  await tx`UPDATE claim_codes SET builder_id = ${root} WHERE builder_id = ${other}`;
  await tx`UPDATE x_owner_clears SET builder_id = ${root} WHERE builder_id = ${other}`;
  await tx`UPDATE person_wallets SET builder_id = ${root} WHERE builder_id = ${other}`;
  await tx`DELETE FROM builder_projects WHERE builder_id = ${other}`;
  await tx`DELETE FROM builder_live WHERE builder_id = ${other}`;
  await tx`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${root}`;
  await tx`
    INSERT INTO coin_moments (builder_id, project_key, moment, offered_at, answer, answered_at, project_id, wallet)
    SELECT ${root}, project_key, moment, offered_at, answer, answered_at, project_id, wallet FROM coin_moments WHERE builder_id = ${other}
    ON CONFLICT DO NOTHING`;
  await tx`DELETE FROM coin_moments WHERE builder_id = ${other}`;
  await tx`UPDATE profile_slug_history SET builder_id = ${root} WHERE builder_id = ${other}`;
  await tx`DELETE FROM builder_ranks WHERE builder_id = ${other}`;
  if (!o) {
    if (r && builderScoreEnabled()) await requeue(tx, root);
    return false;
  }
  if (!r) {
    await tx`UPDATE builder_profiles SET builder_id = ${root}, updated_at = now() WHERE builder_id = ${other}`;
    if (builderScoreEnabled()) await requeue(tx, root);
    return true;
  }
  // v2.12.1 fix round 1 (controller ruling): the older group (the root: its earliest installation)
  // always keeps its page; a newer side, claimed or not, never takes it over. Its claim (X user id,
  // name, picture) is not carried over. Fix round 2 addendum: hidden and held are either side's (hide
  // wins; a held score stays under review), now that a merge needs both groups' yes.
  const [win, lose] = [r, o];
  // The login and prefill travel together, a v2.12 X handle (one its GitHub lists, never a claim) with
  // them; the winner's own values win.
  const login = win.github_login ?? lose.github_login;
  const fromLoser = !win.github_login && !!lose.github_login;
  const merged = {
    x_handle: win.x_handle ?? (fromLoser && !win.x_user_id && !lose.x_user_id ? lose.x_handle : null),
    github_login: login,
    fallback_handle: fromLoser ? lose.github_login : (win.fallback_handle ?? lose.fallback_handle),
    // A prefill is the twitter_username of one login: it goes only with that login.
    twitter_prefill: fromLoser ? lose.twitter_prefill : win.github_login ? win.twitter_prefill : null,
    hidden: r.hidden || o.hidden,
    held: r.held || o.held,
    first_find_at: r.first_find_at < o.first_find_at ? r.first_find_at : o.first_find_at,
    card_offered_at: win.card_offered_at ?? lose.card_offered_at,
    x_asked_at: win.x_asked_at ?? lose.x_asked_at,
    empty_checked_at: win.empty_checked_at ?? lose.empty_checked_at,
    consent_shown_at: win.consent_shown_at ?? lose.consent_shown_at,
    // v2.12.1: the claim (X) travels with the winner; the agent's report and the login's basis are the
    // winner's, else the loser's (the basis goes with the login it proves).
    x_user_id: win.x_user_id,
    x_name: win.x_name,
    x_avatar_url: win.x_avatar_url,
    claimed_at: win.claimed_at,
    reported_github: win.reported_github ?? lose.reported_github,
    github_basis: fromLoser ? lose.github_basis : win.github_login ? win.github_basis : null,
    identity: tx.json((nonEmpty(win.identity) ? win.identity : lose.identity) as never),
    page_ready_shown_at: earliest(win.page_ready_shown_at, lose.page_ready_shown_at),
    standing_seen: tx.json(win.standing_seen as never),
    card_moments: tx.json(win.card_moments as never),
  };
  // DO NOTHING: an old slug is never moved off another person (the other's own history moved above).
  // A claimed winner's loser slug was a random internal one, never public: it is not kept.
  if (!win.x_user_id)
    await tx`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${lose.slug}, ${root}) ON CONFLICT (old_slug) DO NOTHING`;
  await tx`DELETE FROM builder_profiles WHERE builder_id = ${lose.builder_id}`;
  if (win.builder_id !== root) await tx`UPDATE builder_profiles SET builder_id = ${root} WHERE builder_id = ${win.builder_id}`;
  await tx`UPDATE builder_profiles SET ${tx(merged)}, updated_at = now() WHERE builder_id = ${root}`;
  if (builderScoreEnabled()) await requeue(tx, root);
  return true;
}

/** A stored identity report with at least one project (an empty one never replaces a real one). */
const nonEmpty = (v: unknown) => {
  const projects = (v as { projects?: unknown } | null)?.projects;
  return Array.isArray(projects) && projects.length > 0;
};
const earliest = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));

/** The merged person is discovered again (a new clue: the other group's). */
async function requeue(tx: Db, root: number) {
  await tx`
    INSERT INTO discovery_queue (builder_id, reason) VALUES (${root}, 'signin')
    ON CONFLICT (builder_id) DO UPDATE SET reason = 'signin', queued_at = now(), done_at = NULL`;
}
