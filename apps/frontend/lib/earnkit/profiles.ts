import { randomInt } from 'node:crypto';
import type postgres from 'postgres';
import { builderScoreEnabled } from './builder-score-flag';
import { sql, type Db } from './db';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';
import { profileChanged } from './profile-cache';

/**
 * v2.12 spec 1, 8: one public profile per person (the group root, plan R1). X is the visible name,
 * only once it is the handle the person's proven GitHub profile lists (plan R5). Slugs are never
 * reused: an old slug redirects to its person forever (plan R6). One GitHub login, one profile.
 */
export const PROFILE_URL = (slug: string) => `earnkit.com/b/${slug}`;
export const CONSENT_LINE = (slug: string) => `Your public work gets a public score at ${PROFILE_URL(slug)}. Say hide anytime.`;
export const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/;
export const X_NOT_LISTED_NOTE =
  "EarnKit shows only the X handle the builder's GitHub profile lists. Ask them to add it there (GitHub, Settings, Profile, Social accounts), then pass x_handle again. Don't show this to the builder.";

/** A refused claim: another profile already shows this handle (the owner sees the conflict). */
export const X_TAKEN_NOTE =
  "That X handle is already on another EarnKit profile, so EarnKit can't show it here. Don't show this to the builder.";
/** tell's profile or x_handle on an agent serving many builders: there is no one profile to change. */
export const SHARED_PROFILE_NOTE =
  "This agent serves many builders, so there is no public profile to change here. Don't show this to the builder.";
export const HIDDEN_LINE = 'Your profile is hidden. Say show to list it again.';
export const SHOWN_LINE = (slug: string) => `Your profile is public again: ${PROFILE_URL(slug)}`;
export const NO_PROFILE_LINE = 'You have no profile yet.';
export const X_SET_LINE = (slug: string) => `Your profile is now ${PROFILE_URL(slug)}.`;

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,40}$/;
export const walletSlug = (w: string) => `0x${w.slice(2, 6)}${w.slice(-4)}`.toLowerCase();
export const randomSlug = (rand: (n: number) => number = randomInt) =>
  `b-${Array.from({ length: 8 }, () => ALPHABET[rand(ALPHABET.length)]).join('')}`;
export function baseSlug(p: { x_handle?: string | null; github_login?: string | null; wallet?: string | null }): string | null {
  if (p.x_handle && X_HANDLE.test(p.x_handle)) return p.x_handle.toLowerCase();
  if (p.github_login) return p.github_login.toLowerCase();
  if (p.wallet) return walletSlug(p.wallet);
  return null;
}
export function nextFreeSlug(base: string, taken: (slug: string) => boolean): string {
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}
export const shownName = (p: { x_handle: string | null; fallback_handle: string | null; slug: string }) =>
  p.x_handle ? `@${p.x_handle}` : (p.fallback_handle ?? `Builder ${p.slug}`);

/** The slug is already `base` or one of its numbered forms. */
const onBase = (slug: string, base: string) => slug === base || (slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1)));

export type Profile = {
  builder_id: number; slug: string; x_handle: string | null; fallback_handle: string | null; github_login: string | null;
  hidden: boolean; held: boolean; twitter_prefill: string | null; card_offered_at: Date | null; x_asked_at: Date | null; first_find_at: Date;
};
const COLUMNS = ['builder_id', 'slug', 'x_handle', 'fallback_handle', 'github_login', 'hidden', 'held', 'twitter_prefill', 'card_offered_at', 'x_asked_at', 'first_find_at'];

export async function profileOf(builderId: number, db: Db = sql()): Promise<Profile | null> {
  const [p] = await db<Profile[]>`SELECT ${db(COLUMNS)} FROM builder_profiles WHERE builder_id = ${builderId}`;
  return p ?? null;
}

/** `base`, or the first numbered form no one else holds (another person's live slug or history); null when that is too long. */
async function freeSlug(base: string, self: number, db: Db = sql()): Promise<string | null> {
  const like = `${base.replace(/[\\%_]/g, '\\$&')}-%`;
  const rows = await db<{ slug: string }[]>`
    SELECT slug FROM builder_profiles WHERE builder_id <> ${self} AND (slug = ${base} OR slug LIKE ${like})
    UNION SELECT old_slug FROM profile_slug_history WHERE builder_id <> ${self} AND (old_slug = ${base} OR old_slug LIKE ${like})`;
  const taken = new Set(rows.map((r) => r.slug));
  const slug = nextFreeSlug(base, (s) => taken.has(s));
  return SLUG.test(slug) ? slug : null;
}

/** Moves the person to `slug` inside `tx`, keeping the old one in their history. */
async function moveSlugIn(tx: Db, builderId: number, slug: string) {
  const [p] = await tx<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
  if (!p || p.slug === slug) return;
  await tx`DELETE FROM profile_slug_history WHERE old_slug = ${slug} AND builder_id = ${builderId}`;
  await tx`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${p.slug}, ${builderId}) ON CONFLICT (old_slug) DO NOTHING`;
  await tx`UPDATE builder_profiles SET slug = ${slug}, updated_at = now() WHERE builder_id = ${builderId}`;
}

/** A random slug no one holds, live or in history. */
async function freeRandomSlug(db: Db, rand?: (n: number) => number): Promise<string> {
  for (let tries = 0; tries < 5; tries++) {
    const slug = randomSlug(rand);
    const [used] = await db`SELECT 1 FROM builder_profiles WHERE slug = ${slug} UNION ALL SELECT 1 FROM profile_slug_history WHERE old_slug = ${slug}`;
    if (!used) return slug;
  }
  throw new Error('no free slug');
}

/** The person's first remembered wallet (earliest first seen, across their group), lowercase, or null. */
async function firstWallet(db: Db, builderId: number): Promise<string | null> {
  const [w] = await db<{ wallet: string }[]>`
    SELECT lower(w.wallet) AS wallet FROM installation_wallets w JOIN installations i ON i.id = w.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${builderId} ORDER BY w.first_seen_at, w.wallet LIMIT 1`;
  return w?.wallet ?? null;
}

/**
 * The slug the person's best name gives (X, else login, else wallet). `noName`: with none of them,
 * move off a slug that was a name (an X handle cleared) to a fresh random one.
 */
async function followName(
  db: Db,
  builderId: number,
  p: { x_handle: string | null; github_login: string | null; slug: string },
  wallet?: string | null,
  noName = false,
) {
  const base = baseSlug({ x_handle: p.x_handle, github_login: p.github_login, wallet: p.github_login ? null : wallet ?? null });
  if (!base) {
    if (noName) await moveSlugIn(db, builderId, await freeRandomSlug(db));
    return;
  }
  if (onBase(p.slug, base)) return;
  const slug = await freeSlug(base, builderId, db);
  if (slug) await moveSlugIn(db, builderId, slug);
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
 * The proven login, else the first proven wallet: the shown fallback and the slug when there is no
 * X handle. A login is set once and only if no other profile holds it (one login, one person).
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
    if (!p.x_handle && (login || wallet)) await followName(tx, builderId, { ...p, github_login: login }, wallet);
    // The public name (a new login) or the slug changed: the cached page must follow (after commit).
    const [after] = await tx<{ slug: string }[]>`SELECT slug FROM builder_profiles WHERE builder_id = ${builderId}`;
    return login !== p.github_login || after?.slug !== p.slug;
  });
  if (changed) profileChanged();
}

/** spec 7 "The offer", plan R5: 'yes' takes the prefill; a typed handle must equal it. Refused: nothing changes, no event. */
export async function setXHandle(builderId: number, given: string): Promise<{ ok: true; slug: string } | { ok: false; agent_note: string }> {
  const p = await profileOf(builderId);
  const prefill = p?.github_login ? p.twitter_prefill : null;
  const handle = given.trim().replace(/^@/, '');
  const chosen = /^(yes|y|sure|ok)$/i.test(handle) ? prefill : handle;
  if (!p || !prefill || !chosen || !X_HANDLE.test(prefill) || chosen.toLowerCase() !== prefill.toLowerCase())
    return { ok: false, agent_note: X_NOT_LISTED_NOTE };
  // One X handle, one person: a handle another profile already shows is refused (it would
  // impersonate them). GitHub's twitter_username is self-declared, so the owner is told (xHandleConflicts).
  const h = prefill.toLowerCase();
  const slug = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_handle:${h}`}))`;
    const [held] = await tx<{ builder_id: number }[]>`SELECT builder_id FROM builder_profiles WHERE lower(x_handle) = ${h} AND builder_id <> ${builderId}`;
    if (held) {
      await tx`
        INSERT INTO x_handle_conflicts (handle, holder, claimant) VALUES (${h}, ${held.builder_id}, ${builderId})
        ON CONFLICT (handle, holder, claimant) DO UPDATE SET at = now()`;
      return null;
    }
    await tx`UPDATE builder_profiles SET x_handle = ${prefill}, updated_at = now() WHERE builder_id = ${builderId}`;
    const s = (await freeSlug(prefill.toLowerCase(), builderId, tx))!; // a handle is at most 15 characters
    await moveSlugIn(tx, builderId, s);
    return s;
  });
  if (!slug) return { ok: false, agent_note: X_TAKEN_NOTE };
  await noteEvent('x_added', () => ({ type: 'x_added', dedupe_key: `x_added:${builderId}:${prefill.toLowerCase()}`, installation_id: builderId, detail: { slug } }));
  profileChanged();
  return { ok: true, slug };
}

/** spec 8: "hide" and "show". The row stays; a hidden person still counts in percentiles. */
export async function setHidden(builderId: number, hidden: boolean): Promise<string> {
  const [p] = await sql()<{ slug: string }[]>`UPDATE builder_profiles SET hidden = ${hidden}, updated_at = now() WHERE builder_id = ${builderId} RETURNING slug`;
  if (!p) return NO_PROFILE_LINE;
  profileChanged();
  const type = hidden ? 'profile_hidden' : 'profile_shown';
  await noteEvent(type, () => ({ type, dedupe_key: `${type}:${builderId}:${Date.now()}`, installation_id: builderId }));
  return hidden ? HIDDEN_LINE : SHOWN_LINE(p.slug);
}

/**
 * Release path for a self-declared handle: GitHub no longer lists it (by 'github', from discovery)
 * or the owner cleared it (by 'owner', app/admin/scores). The slug falls back by the normal rules;
 * the X slug stays in history (it still redirects to this person). True when a handle was cleared.
 */
export async function clearXHandle(builderId: number, by: 'github' | 'owner'): Promise<boolean> {
  const cleared = await sql().begin(async (tx) => {
    const [p] = await tx<Profile[]>`SELECT ${tx(COLUMNS)} FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!p?.x_handle) return null;
    await tx`UPDATE builder_profiles SET x_handle = NULL, updated_at = now() WHERE builder_id = ${builderId}`;
    await followName(tx, builderId, { x_handle: null, github_login: p.github_login, slug: p.slug }, p.github_login ? null : await firstWallet(tx, builderId), true);
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
 * The owner's open X handle conflicts: a claim refused because another profile shows the handle,
 * while that profile still does. One line each: 'x_handle conflict: @h (builder ids a, b)'.
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
 * spec 1: the consent line, once per person: marked shown as the reply goes out, so a find that
 * failed after the profile was made still shows it on the next one. Null when already shown.
 */
export async function consentOnce(builderId: number): Promise<string | null> {
  const [p] = await sql()<{ slug: string }[]>`
    UPDATE builder_profiles SET consent_shown_at = now() WHERE builder_id = ${builderId} AND consent_shown_at IS NULL RETURNING slug`;
  return p ? CONSENT_LINE(p.slug) : null;
}

/**
 * A live slug, or an old one with its redirect; null for hidden, unknown or never-installed, and
 * (v2.12 final review I4) for a person who has not been shown the consent line yet: disclosure
 * comes before publication. The profile page, the card and the share route all read through here;
 * the leaderboard applies the same rule (PUBLIC_PROFILE). Percentiles still count everyone.
 */
export async function resolveSlug(slug: string): Promise<{ builderId: number; redirect: string | null } | null> {
  const s = slug.toLowerCase();
  if (!SLUG.test(s)) return null;
  type Row = { builder_id: number; hidden: boolean; consented: boolean };
  const [p] = await sql()<Row[]>`SELECT builder_id, hidden, consent_shown_at IS NOT NULL AS consented FROM builder_profiles WHERE slug = ${s}`;
  if (p) return p.hidden || !p.consented ? null : { builderId: p.builder_id, redirect: null };
  const [h] = await sql()<(Row & { slug: string })[]>`
    SELECT p.builder_id, p.slug, p.hidden, p.consent_shown_at IS NOT NULL AS consented
    FROM profile_slug_history h JOIN builder_profiles p USING (builder_id) WHERE h.old_slug = ${s}`;
  return h && !h.hidden && h.consented ? { builderId: h.builder_id, redirect: h.slug } : null;
}

/**
 * Plan R3, inside linkInstallations' transaction. Sources move to the root (a duplicate is rejected,
 * 'merged'). The profile with an X handle wins (else the root's); it ends keyed on the root, with
 * the other's login, X handle and history moved over (cleared before set, so the one-login index
 * holds), hidden if either was. The losing slug redirects to the root. The merged-away id's rank is
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
  await tx`UPDATE person_wallets SET builder_id = ${root} WHERE builder_id = ${other}`;
  await tx`DELETE FROM builder_projects WHERE builder_id = ${other}`;
  await tx`DELETE FROM builder_live WHERE builder_id = ${other}`;
  await tx`UPDATE builder_live SET read_at = NULL WHERE builder_id = ${root}`;
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
  // v2.12.1: the claimed profile (an X user id) wins; else, as in v2.12, the one with an X handle, else the root's.
  const [win, lose] = o.x_user_id && !r.x_user_id ? [o, r] : !r.x_user_id && !r.x_handle && o.x_handle ? [o, r] : [r, o];
  // The login and prefill travel together, X handle with them; the winner's own values win.
  const login = win.github_login ?? lose.github_login;
  const fromLoser = !win.github_login && !!lose.github_login;
  const merged = {
    // The X handle is the winner's (it wins only when it has one, or neither does).
    x_handle: win.x_handle,
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
  if (!merged.x_handle) await followName(tx, root, { x_handle: null, github_login: login, slug: win.slug });
  if (builderScoreEnabled()) await requeue(tx, root);
  return true;
}

const nonEmpty = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
const earliest = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));

/** The merged person is discovered again (a new clue: the other group's). */
async function requeue(tx: Db, root: number) {
  await tx`
    INSERT INTO discovery_queue (builder_id, reason) VALUES (${root}, 'signin')
    ON CONFLICT (builder_id) DO UPDATE SET reason = 'signin', queued_at = now(), done_at = NULL`;
}
