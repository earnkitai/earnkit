import { createHmac, timingSafeEqual } from 'node:crypto';
import { brandShell } from './brand-page';
import { sql } from './db';
import { siteUrl } from './entry-text';
import { mainProjectOf } from './main-project';
import { pagePath } from './reserved-routes';
import { noteEvent } from './events';
import { approveWeek, lastWeekOf, momentLines } from './weekly-moment';
import { lastFinishedMonday, weekOfMonday } from './weeks';

/**
 * v3 Stage 1 Task 6 (spec 5.4): the Monday email's two links, Looks right and Hide this week, which work without the
 * agent. The token is `<builder id>.<monday>.<action>.<base64url HMAC-SHA256(EARNKIT_AUTH_SECRET,
 * "week:v1:<builder id>:<key>:<monday>:<action>")>`: the project key rides only inside the mac, so the URL never names
 * the repo, and a link stops working when the person's main project changes. GET (/api/week) shows the week and one
 * button and changes nothing (mail scanners open links); only the button's POST approves (via 'email') or hides
 * the week's row (fix round 1: any row, text or not; approving un-hides). Only the last two finished weeks.
 */
export type WeekAction = 'approve' | 'hide';
export type WeekLink = { builderId: number; key: string; monday: string; action: WeekAction };
export type WeekTarget = { builderId: number; monday: string; action: WeekAction; mac: string };

const macOf = (t: Omit<WeekLink, 'key'> & { key: string }, secret: string) =>
  createHmac('sha256', secret).update(`week:v1:${t.builderId}:${t.key.toLowerCase()}:${t.monday}:${t.action}`).digest('base64url');

/** The link's token. Throws without the secret. Pure. */
export function weekToken(t: WeekLink, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): string {
  if (!secret) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return `${t.builderId}.${t.monday}.${t.action}.${macOf(t, secret)}`;
}

const TOKEN = /^([1-9][0-9]{0,9})\.([0-9]{4}-[0-9]{2}-[0-9]{2})\.(approve|hide)\.([A-Za-z0-9_-]{43})$/;
/**
 * The parts a token names, or null (malformed, not a Monday, no secret). The mac is checked against the person's main
 * project key by weekVerify. Pure.
 */
export function weekTarget(token: string, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): WeekTarget | null {
  if (!secret || typeof token !== 'string' || token.length > 200) return null;
  const m = token.match(TOKEN);
  if (!m) return null;
  const builderId = Number(m[1]);
  if (!Number.isSafeInteger(builderId) || builderId > 2_147_483_647) return null;
  const d = new Date(`${m[2]}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== m[2] || d.getUTCDay() !== 1) return null;
  return { builderId, monday: m[2]!, action: m[3] as WeekAction, mac: m[4]! };
}

/** Whether the token's mac is the one for `key` (case-insensitive). Timing-safe. Pure. */
export function weekVerify(t: WeekTarget, key: string, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): boolean {
  if (!secret) return false;
  const want = Buffer.from(macOf({ ...t, key }, secret));
  const got = Buffer.from(t.mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const weekUrl = (t: WeekLink) => `${siteUrl()}/api/week?t=${encodeURIComponent(weekToken(t))}`;

export const WEEK_TEXT = {
  title: 'Your week on EarnKit',
  approve: 'Looks right',
  hide: 'Hide this week',
  approved: 'Confirmed. Your page shows it.',
  hidden: 'Hidden. Your page no longer shows this week.',
  none: 'There is no update that week.',
  bad: 'This link is not valid.',
  expired: 'This link has expired.',
  page: 'See your page',
} as const;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};
const page = (inner: string, status = 200) => new Response(brandShell(inner), { status, headers: PAGE_HEADERS });
const bad = () => page(`<h1>${escapeHtml(WEEK_TEXT.bad)}</h1>`, 400);
const expired = () => page(`<h1>${escapeHtml(WEEK_TEXT.expired)}</h1>`, 400);
const DAY_MS = 86_400_000;
/**
 * Fix round 1: a link acts only on the last finished week or the one before (an older approval would be scored at
 * today's standing). Pure.
 */
export function weekLinkLive(monday: string, now: Date): boolean {
  const last = Date.parse(`${lastFinishedMonday(now)}T00:00:00Z`);
  const t = Date.parse(`${monday}T00:00:00Z`);
  return t <= last && t >= last - 7 * DAY_MS;
}

/** The token's target and the main project key it was signed for, or null (any mismatch). */
async function resolve(request: Request): Promise<{ t: WeekTarget; key: string; token: string } | null> {
  const token = new URL(request.url).searchParams.get('t') ?? '';
  const t = weekTarget(token);
  if (!t) return null;
  const key = await mainProjectOf(t.builderId);
  return key && weekVerify(t, key) ? { t, key, token } : null;
}

const handleOf = async (builderId: number) =>
  (await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${builderId}`)[0]?.handle ?? null;

/** GET: the week's lines (when it is still last week) and one button that POSTs to the same link. Changes nothing. No script. */
export async function weekGet(request: Request): Promise<Response> {
  const r = await resolve(request);
  if (!r) return bad();
  if (!weekLinkLive(r.t.monday, new Date())) return expired();
  const last = await lastWeekOf(r.t.builderId, r.key, new Date()).catch(() => null);
  const lines = last && last.monday === r.t.monday ? momentLines(last) : [];
  const label = r.t.action === 'approve' ? WEEK_TEXT.approve : WEEK_TEXT.hide;
  return page(
    `<h1>${escapeHtml(WEEK_TEXT.title)}</h1>` +
      lines.map((l) => `<p class="ek-line">${escapeHtml(l)}</p>`).join('') +
      `<div class="ek-actions"><form method="post" action="${escapeHtml(`${siteUrl()}/api/week?t=${encodeURIComponent(r.token)}`)}">` +
      `<button class="ek-btn" type="submit">${escapeHtml(label)}</button></form></div>`,
  );
}

/** POST: approves the week (via 'email', points once) or hides it. Idempotent: an approved week keeps its first approval. */
export async function weekPost(request: Request): Promise<Response> {
  const r = await resolve(request);
  if (!r) return bad();
  const now = new Date();
  if (!weekLinkLive(r.t.monday, now)) return expired();
  const { builderId, monday, action } = r.t;
  let done: string;
  if (action === 'approve') {
    const [had] = await sql()<{ approved: boolean }[]>`
      SELECT COALESCE((facts->>'approved')::boolean, false) AS approved FROM project_updates
      WHERE builder_id = ${builderId} AND lower(project_key) = lower(${r.key}) AND week = ${monday}`;
    if (!had?.approved && !(await approveWeek(builderId, r.key, monday, now, 'email'))) return bad();
    // Fix round 1: Looks right after Hide shows the week again (the page says it does).
    await sql()`UPDATE project_updates SET hidden = false
      WHERE builder_id = ${builderId} AND lower(project_key) = lower(${r.key}) AND week = ${monday} AND hidden`;
    done = WEEK_TEXT.approved;
  } else {
    // Fix round 1: the week's row itself (the weekly job's rows carry facts and a summary, no text), whatever it holds.
    const [h] = await sql()<{ key: string }[]>`
      UPDATE project_updates SET hidden = true
      WHERE builder_id = ${builderId} AND lower(project_key) = lower(${r.key}) AND week = ${monday} RETURNING project_key AS key`;
    if (h) {
      const week = weekOfMonday(monday)!;
      await noteEvent('update_hidden', () => ({
        type: 'update_hidden', dedupe_key: `update_hidden:${h.key.toLowerCase()}:${week}`, installation_id: builderId, repo_key: h.key.toLowerCase(), detail: { week },
      }));
    }
    done = h ? WEEK_TEXT.hidden : WEEK_TEXT.none;
  }
  const handle = await handleOf(builderId);
  const link = handle ? `<p class="ek-line"><a class="ek-link" href="${escapeHtml(`${siteUrl()}${pagePath(handle)}`)}">${escapeHtml(WEEK_TEXT.page)}</a></p>` : '';
  return page(`<h1>${escapeHtml(done)}</h1>${link}`);
}
