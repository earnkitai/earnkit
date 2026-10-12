import { randomInt } from 'node:crypto';
import type postgres from 'postgres';
import { builderScoreEnabled } from './builder-score-flag';
import { sql, type Db } from './db';
import { shortWallet } from './entry-text';
import { noteEvent } from './events';
import { sharedGroup } from './installations';

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

/** The slug the person's best name gives (X, else login, else wallet), unless an X handle already set it. */
async function followName(db: Db, builderId: number, p: { x_handle: string | null; github_login: string | null; slug: string }, wallet?: string | null) {
  const base = baseSlug({ x_handle: p.x_handle, github_login: p.github_login, wallet: p.github_login ? null : wallet ?? null });
  if (!base || onBase(p.slug, base)) return;
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
export async function setFallback(builderId: number, f: { github_login?: string; wallet?: string }): Promise<void> {
  await sql().begin(async (tx) => {
    const [p] = await tx<Profile[]>`SELECT ${tx(COLUMNS)} FROM builder_profiles WHERE builder_id = ${builderId} FOR UPDATE`;
    if (!p) return;
    let login = p.github_login;
    if (!login && f.github_login) {
      const want = f.github_login.toLowerCase();
      const [taken] = await tx`SELECT 1 FROM builder_profiles WHERE lower(github_login) = ${want} AND builder_id <> ${builderId}`;
      if (!taken) login = want;
    }
    // Only the first proven wallet names the person (a later one changes nothing).
    const wallet = !p.fallback_handle && f.wallet ? f.wallet.toLowerCase() : null;
    const fallback = login ?? p.fallback_handle ?? (wallet ? shortWallet(wallet) : null);
    if (login !== p.github_login || fallback !== p.fallback_handle)
      await tx`UPDATE builder_profiles SET github_login = ${login}, fallback_handle = ${fallback}, updated_at = now() WHERE builder_id = ${builderId}`;
    if (!p.x_handle && (login || wallet)) await followName(tx, builderId, { ...p, github_login: login }, wallet);
  });
}

/** spec 7 "The offer", plan R5: 'yes' takes the prefill; a typed handle must equal it. Refused: nothing changes, no event. */
export async function setXHandle(builderId: number, given: string): Promise<{ ok: true; slug: string } | { ok: false; agent_note: string }> {
  const p = await profileOf(builderId);
  const prefill = p?.github_login ? p.twitter_prefill : null;
  const handle = given.trim().replace(/^@/, '');
  const chosen = /^(yes|y|sure|ok)$/i.test(handle) ? prefill : handle;
  if (!p || !prefill || !chosen || !X_HANDLE.test(prefill) || chosen.toLowerCase() !== prefill.toLowerCase())
    return { ok: false, agent_note: X_NOT_LISTED_NOTE };
  // One X handle, one person: a handle another profile already shows is refused (it would impersonate them).
  const slug = await sql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`x_handle:${prefill.toLowerCase()}`}))`;
    const [held] = await tx`SELECT 1 FROM builder_profiles WHERE lower(x_handle) = ${prefill.toLowerCase()} AND builder_id <> ${builderId}`;
    if (held) return null;
    await tx`UPDATE builder_profiles SET x_handle = ${prefill}, updated_at = now() WHERE builder_id = ${builderId}`;
    const s = (await freeSlug(prefill.toLowerCase(), builderId, tx))!; // a handle is at most 15 characters
    await moveSlugIn(tx, builderId, s);
    return s;
  });
  if (!slug) return { ok: false, agent_note: X_NOT_LISTED_NOTE };
  await noteEvent('x_added', () => ({ type: 'x_added', dedupe_key: `x_added:${builderId}:${prefill.toLowerCase()}`, installation_id: builderId, detail: { slug } }));
  return { ok: true, slug };
}

/** spec 8: "hide" and "show". The row stays; a hidden person still counts in percentiles. */
export async function setHidden(builderId: number, hidden: boolean): Promise<string> {
  const [p] = await sql()<{ slug: string }[]>`UPDATE builder_profiles SET hidden = ${hidden}, updated_at = now() WHERE builder_id = ${builderId} RETURNING slug`;
  if (!p) return 'You have no profile yet.';
  const type = hidden ? 'profile_hidden' : 'profile_shown';
  await noteEvent(type, () => ({ type, dedupe_key: `${type}:${builderId}:${Date.now()}`, installation_id: builderId }));
  return hidden ? 'Your profile is hidden. Say show to list it again.' : `Your profile is public again: ${PROFILE_URL(p.slug)}`;
}

/** A live slug, or an old one with its redirect; null for hidden, unknown or never-installed. */
export async function resolveSlug(slug: string): Promise<{ builderId: number; redirect: string | null } | null> {
  const s = slug.toLowerCase();
  if (!SLUG.test(s)) return null;
  const [p] = await sql()<{ builder_id: number; hidden: boolean }[]>`SELECT builder_id, hidden FROM builder_profiles WHERE slug = ${s}`;
  if (p) return p.hidden ? null : { builderId: p.builder_id, redirect: null };
  const [h] = await sql()<{ builder_id: number; slug: string; hidden: boolean }[]>`
    SELECT p.builder_id, p.slug, p.hidden FROM profile_slug_history h JOIN builder_profiles p USING (builder_id) WHERE h.old_slug = ${s}`;
  return h && !h.hidden ? { builderId: h.builder_id, redirect: h.slug } : null;
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
export async function mergeProfiles(tx: postgres.TransactionSql, root: number, other: number): Promise<void> {
  if (root === other) return;
  await tx`
    UPDATE builder_sources s SET builder_id = ${root} WHERE builder_id = ${other}
      AND NOT EXISTS (SELECT 1 FROM builder_sources r WHERE r.builder_id = ${root} AND r.kind = s.kind AND r.ref = s.ref)`;
  await tx`UPDATE builder_sources SET state = 'rejected', reject_reason = 'merged' WHERE builder_id = ${other} AND state <> 'rejected'`;
  type Row = Profile & { empty_checked_at: Date | null };
  const rows = await tx<Row[]>`
    SELECT ${tx(COLUMNS)}, empty_checked_at FROM builder_profiles WHERE builder_id IN (${root}, ${other}) ORDER BY builder_id FOR UPDATE`;
  const r = rows.find((x) => x.builder_id === root);
  const o = rows.find((x) => x.builder_id === other);
  await tx`UPDATE profile_slug_history SET builder_id = ${root} WHERE builder_id = ${other}`;
  await tx`DELETE FROM builder_ranks WHERE builder_id = ${other}`;
  if (!o) {
    if (r && builderScoreEnabled()) await requeue(tx, root);
    return;
  }
  if (!r) {
    await tx`UPDATE builder_profiles SET builder_id = ${root}, updated_at = now() WHERE builder_id = ${other}`;
    if (builderScoreEnabled()) await requeue(tx, root);
    return;
  }
  const [win, lose] = !r.x_handle && o.x_handle ? [o, r] : [r, o];
  // The login and prefill travel together, X handle with them; the winner's own values win.
  const login = win.github_login ?? lose.github_login;
  const fromLoser = !win.github_login && !!lose.github_login;
  const merged = {
    x_handle: win.x_handle ?? lose.x_handle,
    github_login: login,
    fallback_handle: fromLoser ? lose.github_login : (win.fallback_handle ?? lose.fallback_handle),
    twitter_prefill: fromLoser ? lose.twitter_prefill : (win.twitter_prefill ?? lose.twitter_prefill),
    hidden: r.hidden || o.hidden,
    held: r.held || o.held,
    first_find_at: r.first_find_at < o.first_find_at ? r.first_find_at : o.first_find_at,
    card_offered_at: win.card_offered_at ?? lose.card_offered_at,
    x_asked_at: win.x_asked_at ?? lose.x_asked_at,
    empty_checked_at: win.empty_checked_at ?? lose.empty_checked_at,
  };
  // DO NOTHING: an old slug is never moved off another person (the other's own history moved above).
  await tx`INSERT INTO profile_slug_history (old_slug, builder_id) VALUES (${lose.slug}, ${root}) ON CONFLICT (old_slug) DO NOTHING`;
  await tx`DELETE FROM builder_profiles WHERE builder_id = ${lose.builder_id}`;
  if (win.builder_id !== root) await tx`UPDATE builder_profiles SET builder_id = ${root} WHERE builder_id = ${win.builder_id}`;
  await tx`UPDATE builder_profiles SET ${tx(merged)}, updated_at = now() WHERE builder_id = ${root}`;
  if (!merged.x_handle) await followName(tx, root, { x_handle: null, github_login: login, slug: win.slug });
  if (builderScoreEnabled()) await requeue(tx, root);
}

/** The merged person is discovered again (a new clue: the other group's). */
async function requeue(tx: Db, root: number) {
  await tx`
    INSERT INTO discovery_queue (builder_id, reason) VALUES (${root}, 'signin')
    ON CONFLICT (builder_id) DO UPDATE SET reason = 'signin', queued_at = now(), done_at = NULL`;
}
