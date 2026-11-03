import { brandShell } from './brand-page';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { bestFitFor, standingFor } from './best-fit';
import { newBackers } from './backers';
import { alertFit, newProgramOf, type FitRepo, type NewProgramRow } from './alerts';
import { researchMark } from './site-copy';
import { hiddenIds, hiddenPrograms, type BuilderMemory } from './builder-memory';
import { sql, type Db } from './db';
import { freshSql } from './api-stale';
import { siteUrl } from './entry-text';
import { COIN_PROGRAM } from './policy-constants';
import { freeTierRoom, takeFreeTier } from './free-tier';
import { testInstallationIds } from './installations';
import { mainConfirmed } from './main-project';
import { weeklyPostLink } from './post-reply';
import { lastWeekOf, markOffered, mondayLines, momentSummary, shareText, weekNumber, type WeekStanding } from './weekly-moment';
import { weekCommunityUsd } from './community';
import { streaksFor } from './streak';
import { firstName } from './bench-reply';
import { weekUrl } from './week-links';
import { CONTACT_EMAIL } from './policy';
import { standingLeads, standingParagraph } from './standing';
import { cardSubmitBy, closeDay, hoursLeft, submitBy, zoneAbbr } from './deadline';

/**
 * v2.9 E19: the weekly email, opt-in only. Asked once per installation (Ruling 13; v3 Stage 1: in the first
 * yes after activation, the connect or share yes in bench-find.ts); the answer comes back through tell_earnkit's `weekly_email`. Sent by the hourly
 * cron from Monday DIGEST_HOUR_UTC (weekStart, after the weekly job writes last week), at most once a week per subscription, never empty, within
 * Resend's free tier (free-tier.ts: 100 a day, 3,000 a month; the rest wait for a later run). Every
 * email carries List-Unsubscribe with a one-click link (RFC 8058, /api/digest/unsubscribe). With
 * RESEND_API_KEY unset the whole feature is off: no question, no send.
 * v3 Stage 1 (spec 5.4): it leads with the Monday moment: last week's lines, then Looks right and Hide this week
 * links (week-links.ts) that work without the agent; a subscription whose week is not written yet waits (pending).
 * v3.1 Task 12 (spec 3.3): above the week, the money action (the Best fit's draft, bench-find.ts) and the week's new
 * backers (backers.ts newBackers, only while backing is on), each only when true; never points.
 * Then (in this order): new programs one of the builder's remembered repos could really win
 * (alerts.ts alertFit, the alert rule), wins by EarnKit builders (announced only), and the builder's
 * own deadlines and decision dates in the coming week. Ruling G21: on a hosted agent (shared_client)
 * one installation serves many builders, so a subscription would need a verified caller; v2.14 final
 * fix: the pasted GitHub sign-in code that named one is gone, so a hosted agent asks nothing and saves
 * nothing (older per-login subscriptions keep sending). Elsewhere one subscription per installation (login '').
 */

export const DIGEST_FROM_DEFAULT = 'EarnKit <digest@earnkit.com>';
/** On only with RESEND_API_KEY and EARNKIT_AUTH_SECRET (every email's unsubscribe link is signed with it). */
export const digestEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.RESEND_API_KEY?.trim() && env.EARNKIT_AUTH_SECRET);
export const digestFrom = () => process.env.DIGEST_FROM?.trim() || DIGEST_FROM_DEFAULT;

/** v4.7 T5 (exact copy): one subscription now carries the deadline alerts (alert-mail.ts) and the Monday summary. */
export const EMAIL_QUESTION = 'Want deadline alerts and a Monday summary by email? Reply with the address.';
/** What the agent does with the question (Ruling 13). */
export const EMAIL_NOTE = "Pass the builder's answer to tell as weekly_email.";
/** A yes with no address EarnKit may use. */
export const WHICH_EMAIL = 'Which email should your Monday summary go to?';
/** v4.7 T5 (R17): one subscription carries the alerts and the summary. */
export const EMAIL_ON = "Done. You'll get deadline alerts and a Monday summary.";
/** v4.7 T5 fix round 1: the no, the off and the hosted-agent lines name EarnKit emails (the alerts and the summary), not a weekly one. */
export const EMAIL_OFF = 'No EarnKit emails.';
export const EMAIL_UNAVAILABLE = 'EarnKit emails are not available yet.';
/** Ruling G21: a hosted agent has no verified caller, so it can't keep an email subscription. */
export const EMAIL_SIGN_IN = "EarnKit emails aren't available on this agent.";
/** Send failures in a row that stop a run (a Resend outage never burns the day's slots). */
export const MAX_SEND_FAILURES = 3;

/** Whose subscription: the installation, and on a shared client the verified login ('' elsewhere). */
export type SubKey = { installationId: number; login: string };
const keyOf = (k: number | SubKey): SubKey => (typeof k === 'number' ? { installationId: k, login: '' } : { ...k, login: k.login.toLowerCase() });

const DAY = 86_400_000;
/** Most lines per section, so one email stays short. */
const MAX_LINES = 5;
/** Default time for one run's sends (the cron passes what its budget has left). */
const SEND_BUDGET_MS = 60_000;
/** Most subscriptions one run considers (Resend's daily cap). */
const RUN_MAX = 100;
const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10_000;

/** v3 Stage 1: the email's Monday hour (UTC), after the weekly job's (week-facts.ts WEEKLY_HOUR_UTC, 15). */
export const DIGEST_HOUR_UTC = 16;
/** A week not written by then is sent without its moment (the weekly job only writes confirmed projects). */
const PENDING_MAX_MS = 86_400_000;

/** v3.2: a week that failed to read waits (pending) until PENDING_MAX_MS after weekStart, then the email goes without it. Pure. */
export const failedWeek = (now: Date): { pending?: true } => (now.getTime() < weekStart(now).getTime() + PENDING_MAX_MS ? { pending: true } : {});

/** This week's Monday DIGEST_HOUR_UTC, or last week's before that moment. Pure. */
export function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), DIGEST_HOUR_UTC));
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  let start = new Date(d.getTime() - back * DAY);
  if (start > now) start = new Date(start.getTime() - 7 * DAY);
  return start;
}

export type DigestState = { opted_in_at: Date | null; unsubscribed_at: Date | null; last_sent_at: Date | null; last_considered_at: Date | null };

/**
 * Whether a subscription gets an email now: opted in before this week's start (Pre-flight P17: so
 * sends start on Mondays), not unsubscribed, nothing sent and nothing considered (an empty week)
 * since that start. Pure.
 */
export function digestDue(s: DigestState, now: Date): boolean {
  if (!s.opted_in_at || s.unsubscribed_at) return false;
  const start = weekStart(now);
  if (s.opted_in_at >= start) return false;
  if (s.last_sent_at && s.last_sent_at >= start) return false;
  return !(s.last_considered_at && s.last_considered_at >= start);
}

/** Last week's moment: its lines (weekly-moment.ts mondayLines, v4.0 Task 7), standing (the subject) and the two signed links. */
export type DigestWeek = { lines: string[]; standing: WeekStanding; approveUrl: string; hideUrl: string; approved: boolean; confirmed?: boolean; postUrl?: string };
export type DigestFacts = {
  /**
   * v4.8.1 final fix (R-3): when the facts were read (digestFacts' now). With it, a close under 48 hours away is
   * absolute with the hours left as of sending ("Nov 1, 11:59 PM PT (in 20 hours)", deadline.ts cardSubmitBy).
   */
  now?: Date;
  /** v4.7 T5: the builder's standing paragraph (standing.ts standingParagraph), the email's top section; only with a score or a streak part (standingLeads). */
  standing?: string;
  week: DigestWeek | null;
  /** The person's X handle, when claimed. */
  handle: string | null;
  /** The week is not written yet: neither sent nor considered (the next hourly run tries again). */
  pending?: true;
  /** v3.1 Task 12: the money lines above the week (the Best fit's draft, new backers); none on a shared client or a per-login subscription. */
  money: string[];
  /** v4.7 final review (Review Focus 2): `summary` and `tz` read the close day in the program's own zone (deadline.ts closeDay). */
  /** v4.9 final fix (ruling 5): `research` on a line about an API program, which then carries RESEARCH_LABEL. */
  newPrograms: { title: string; repo: string; prize_usd: number | null; ends_at: Date | null; summary?: string; tz?: string | null; research?: boolean }[];
  wins: { name: string; program: string; prize_usd: number | null; research?: boolean }[];
  /** A close carries its program's `summary` and `tz` (closeDay); a decision date is a calendar date, read in UTC. */
  deadlines: { program: string; what: 'closes' | 'decision'; at: Date; summary?: string; tz?: string | null; research?: boolean }[];
};

const money = (usd: number | null) => (usd ? `$${usd.toLocaleString('en-US')}` : null);
const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/**
 * v4.7 final review: a close day as the site and the replies show it (deadline.ts closeDay, the program's own zone).
 * v4.8.1 final fix (R-3): with `now`, a close under 48 hours away is absolute, with the hours left as of sending
 * (cardSubmitBy: "Nov 1, 11:59 PM PT (in 20 hours)"), never "today" or a UTC weekday.
 */
const closes = (c: { at: Date; summary?: string; tz?: string | null }, now?: Date) => {
  const card = { summary: c.summary ?? '', tz: c.tz, ends_at: c.at };
  const soon = now && hoursLeft(c.at.toISOString(), now) ? cardSubmitBy(card, now) : null;
  return soon ?? closeDay(card) ?? day(c.at);
};

/** The most characters of a builder-supplied name an email shows. */
export const NAME_MAX = 40;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s()<>[\]]+/gi;
const EMAIL_RE = /\S+@\S+\.\S+/g;
const HANDLE_RE = /(^|[^\w])@[\w.-]+/g;
const DOMAIN_RE = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|xyz|app|dev|co|ai|fun|gg|me|so|link|site|money|finance|info|biz|ly|to|sh)\b(?:\/[^\s()<>[\]]*)?/gi;

/**
 * A builder-supplied project name as the email shows it to other people: URLs, bare domains, emails
 * and @handles removed, spaces collapsed, at most NAME_MAX characters (cut at a word when it can be),
 * else `fallback` when nothing is left. Pure.
 */
export function cleanName(name: string, fallback: string): string {
  const plain = name
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(DOMAIN_RE, ' ')
    .replace(HANDLE_RE, '$1 ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\(\s*\)|\[\s*\]|<\s*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:,.|/]+|[\s\-:,.|/]+$/g, '');
  if (!plain) return fallback;
  if (plain.length <= NAME_MAX) return plain;
  const cut = plain.slice(0, NAME_MAX);
  const space = cut.lastIndexOf(' ');
  return (space >= NAME_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s\-:,.|/]+$/, '');
}

const ASK_LINE = 'Ask your agent "What can I earn?" to start.';

/**
 * The email: v4.7 T5: the builder's standing paragraph on top (never on its own: it never makes an email), then the money lines (v3.1 Task 12), then last week's moment (its lines, then Looks right and Hide this
 * week while it is unconfirmed), then new programs, wins and the builder's deadlines; null when there are no money
 * lines, no week and all three are empty (money lines alone still send, as "Your EarnKit week"). Every
 * builder-supplied name (a repo, a winning project) goes through cleanName. Pure.
 */
export function digestBody(f: DigestFacts): { subject: string; text: string } | null {
  // v4.7 T5 (R16): one score per email. With the standing on top (the page's live score), the week block drops its
  // recorded "Shipping score" line and the subject its score.
  const week = f.week
    ? [
        ...f.week.lines.filter((l) => !(f.standing && l.startsWith('Shipping score: '))),
        ...(f.week.postUrl ? [`Your post is ready to share: ${f.week.postUrl}`] : []),
        ...((f.week.confirmed ?? f.week.approved) ? [] : ['', `Looks right: ${f.week.approveUrl}`, `Hide this week: ${f.week.hideUrl}`]),
      ].join('\n')
    : null;
  const lines = [
    ...f.newPrograms.map((p) => `New: ${p.title} fits ${cleanName(p.repo, 'your repo')}${money(p.prize_usd) ? `, ${money(p.prize_usd)}` : ''}${p.ends_at ? `, closes ${closes({ ...p, at: p.ends_at }, f.now)}` : ''}.${researchMark(p.research)}`),
    ...f.wins.map((w) => `Won: ${cleanName(w.name, 'An EarnKit builder')} in ${w.program}${money(w.prize_usd) ? `, ${money(w.prize_usd)}` : ''}.${researchMark(w.research)}`),
    ...f.deadlines.map((d) => `Your ${d.program}: ${d.what === 'closes' ? `closes ${closes(d, f.now)}` : `results due ${day(d.at)}`}.${researchMark(d.research)}`),
  ];
  if (lines.length === 0 && !week && f.money.length === 0) return null;
  const subject = f.week
    ? f.standing ? 'Your week on EarnKit' : `Your week on ${shareText(f.week.standing).slice('My week on '.length)}`
    : f.newPrograms[0]
      ? `New: ${f.newPrograms[0].title} fits ${cleanName(f.newPrograms[0].repo, 'your repo')}`
      : 'Your EarnKit week';
  // The ask line closes the email once: after the sections, or last when money lines have no sections after them, so
  // "one yes away" always says where the yes goes (never read as the week's Looks right link).
  const sections = lines.length > 0 ? lines.join('\n') : null;
  const closer = !sections && f.money.length > 0 ? ASK_LINE : null;
  return { subject, text: [f.standing, f.money.join('\n'), week, sections && `${sections}\n\n${ASK_LINE}`, closer].filter(Boolean).join('\n\n') };
}

const mac = (k: SubKey, secret: string) =>
  createHmac('sha256', secret)
    .update(`digest-unsub:v1:${k.installationId}${k.login ? `:${k.login}` : ''}`)
    .digest('base64url');

/**
 * The one-click unsubscribe token: `<installation id>.<HMAC-SHA256(EARNKIT_AUTH_SECRET,
 * "digest-unsub:v1:<id>"), base64url>`; a shared client's login subscription (G21) is
 * `<id>.<login>.<HMAC of "digest-unsub:v1:<id>:<login>">`. Throws without the secret. Pure.
 */
export function unsubToken(target: number | SubKey, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): string {
  if (!secret) throw new Error('EARNKIT_AUTH_SECRET is not set');
  const k = keyOf(target);
  return `${k.installationId}.${k.login ? `${k.login}.` : ''}${mac(k, secret)}`;
}

/** The subscription a token names, or null (malformed, another id or login, a changed character, no secret). Timing-safe. */
export function unsubTarget(token: string, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): SubKey | null {
  if (!secret || typeof token !== 'string' || token.length > 200) return null;
  const m = token.match(/^([1-9][0-9]{0,9})\.(?:([a-z0-9-]{1,39})\.)?([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) return null;
  const k = { installationId: id, login: m[2] ?? '' };
  const want = Buffer.from(mac(k, secret));
  const got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got) ? k : null;
}

export const unsubUrl = (target: number | SubKey) =>
  `${siteUrl()}/api/digest/unsubscribe?t=${encodeURIComponent(unsubToken(target))}`;

/** v4.7 T5 (R17): every email's footer (the Monday summary's and the alerts'; one subscription carries both). Pure. */
export const mailFooter = (url: string) => `Deadline alerts and a Monday summary. Unsubscribe: ${url}`;

/** RFC 2369 and RFC 8058: every email's unsubscribe headers. */
export const unsubHeaders = (target: number | SubKey): Record<string, string> => ({
  'List-Unsubscribe': `<${unsubUrl(target)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

/**
 * Review I2: Resend's Idempotency-Key for one subscription's email of one week, so a retry of a send
 * whose outcome was unknown (a timeout, a 5xx after acceptance, a failed commit) never mails twice.
 */
export const idempotencyKey = (target: SubKey, start: Date) =>
  `digest-${target.installationId}${target.login ? `-${target.login}` : ''}-${start.toISOString()}`;

export type Mailer = (m: {
  to: string;
  from: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  idempotencyKey: string;
}) => Promise<void>;

/** A failed send: `status` is the HTTP status (0: no answer, a timeout or a network error). */
export class MailError extends Error {
  constructor(readonly status: number) {
    super(`Mail failed: ${status}`);
    this.name = 'MailError';
  }
}

/** Resend's API (POST /emails, 10 s). v4.7 T5: replies go to CONTACT_EMAIL (digest@ is no inbox). Never logs the address or the key. */
export const resendMailer =
  (key: string): Mailer =>
  async (m) => {
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
        body: JSON.stringify({ from: m.from, to: [m.to], reply_to: CONTACT_EMAIL, subject: m.subject, text: m.text, headers: m.headers }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch {
      throw new MailError(0);
    }
    if (!res.ok) throw new MailError(res.status);
  };

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
/** A plain address (no name, no list), at most 254 characters, lowercased; else null. Pure. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** v3 final review: an installation asked this long ago (and still not opted in anywhere) is asked again. */
export const EMAIL_REASK_DAYS = 30;

/**
 * Ruling 13: the question, once per installation (installations.digest_asked_at; v3 final review: again after
 * EMAIL_REASK_DAYS, and never while the person has an opted-in subscription), only while the email is on.
 * v3 Stage 1: asked in the first yes after activation (bench-find.ts benchMoveUp). Ruling G21 (v2.14 final fix):
 * never on a shared client (`shared`), which has no verified caller. `email`: an address to keep with the
 * question (unopted until a yes; the question never names it). Returns what the reply adds, or null (off,
 * shared, opted in, or asked within EMAIL_REASK_DAYS). Never fails the tool.
 */
export async function askWeeklyEmail(
  installationId: number,
  opts: { shared: boolean; email: string | null },
): Promise<{ question: string; agent_note: string } | null> {
  if (!digestEnabled() || opts.shared) return null;
  try {
    return await sql().begin(async (tx) => {
      // v3 final review: asked while the person (the group root) has no opted-in subscription, and this installation
      // was never asked or was asked over EMAIL_REASK_DAYS ago (an old entry-time ask no longer blocks it).
      const [asked] = await tx<{ id: number }[]>`
        UPDATE installations i SET digest_asked_at = now()
        WHERE i.id = ${installationId} AND (i.digest_asked_at IS NULL OR i.digest_asked_at < now() - make_interval(days => ${EMAIL_REASK_DAYS}))
          AND NOT EXISTS (SELECT 1 FROM digest_subscriptions d JOIN installations j ON j.id = d.installation_id
            WHERE COALESCE(j.builder_id, j.id) = COALESCE(i.builder_id, i.id) AND d.opted_in_at IS NOT NULL AND d.unsubscribed_at IS NULL)
        RETURNING i.id`;
      if (!asked) return null;
      await tx`
        INSERT INTO digest_subscriptions (installation_id, login, email, asked_at) VALUES (${installationId}, '', ${opts.email}, now())
        ON CONFLICT (installation_id, login) DO UPDATE SET email = COALESCE(EXCLUDED.email, digest_subscriptions.email), asked_at = now()
        WHERE digest_subscriptions.opted_in_at IS NULL`;
      return { question: EMAIL_QUESTION, agent_note: EMAIL_NOTE };
    });
  } catch (err) {
    console.error('[digest] ask', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/** tell_earnkit's weekly_email: the builder's answer. */
export type WeeklyEmail = { answer: 'yes' | 'no'; email?: string };

/**
 * Stores the builder's answer, on the caller's own subscription only (Ruling G21: on a shared client
 * the verified login's; with no login nothing changes, EMAIL_SIGN_IN). No: the address and the opt-in
 * are cleared (the row stays, so the question is not asked again). Yes with an address: that one. A
 * plain yes: the address kept with the question (this entry's email), else WHICH_EMAIL. Returns what
 * to show.
 */
export async function saveWeeklyEmail(
  installationId: number,
  w: WeeklyEmail,
  opts: { shared: boolean; login?: string | null },
  now = new Date(),
) {
  if (!digestEnabled()) return { show_to_builder: EMAIL_UNAVAILABLE, saved: false };
  const login = opts.shared ? (opts.login?.toLowerCase() ?? '') : '';
  if (opts.shared && !login) return { show_to_builder: EMAIL_SIGN_IN, saved: false };
  const db = sql();
  if (w.answer === 'no') {
    await db`
      INSERT INTO digest_subscriptions (installation_id, login, asked_at) VALUES (${installationId}, ${login}, ${now})
      ON CONFLICT (installation_id, login) DO UPDATE SET email = NULL, opted_in_at = NULL, unsubscribed_at = NULL`;
    return { show_to_builder: EMAIL_OFF, saved: true };
  }
  const given = w.email === undefined ? null : cleanEmail(w.email);
  if (w.email !== undefined && !given) return { show_to_builder: WHICH_EMAIL, saved: false };
  if (given) {
    await db`
      INSERT INTO digest_subscriptions (installation_id, login, email, asked_at, opted_in_at)
      VALUES (${installationId}, ${login}, ${given}, ${now}, ${now})
      ON CONFLICT (installation_id, login) DO UPDATE SET
        email = EXCLUDED.email,
        opted_in_at = CASE WHEN digest_subscriptions.opted_in_at IS NULL OR digest_subscriptions.unsubscribed_at IS NOT NULL
          THEN EXCLUDED.opted_in_at ELSE digest_subscriptions.opted_in_at END,
        unsubscribed_at = NULL`;
    return { show_to_builder: EMAIL_ON, saved: true };
  }
  const [row] = await db<{ id: number }[]>`
    UPDATE digest_subscriptions SET opted_in_at = COALESCE(opted_in_at, ${now}), unsubscribed_at = NULL
    WHERE installation_id = ${installationId} AND login = ${login} AND email IS NOT NULL
    RETURNING installation_id AS id`;
  return row ? { show_to_builder: EMAIL_ON, saved: true } : { show_to_builder: WHICH_EMAIL, saved: false };
}

/** One-click unsubscribe of exactly one subscription: idempotent (the first time stands). True when it exists. */
export async function unsubscribe(target: number | SubKey, now = new Date()): Promise<boolean> {
  const k = keyOf(target);
  const rows = await sql()`
    UPDATE digest_subscriptions SET unsubscribed_at = COALESCE(unsubscribed_at, ${now})
    WHERE installation_id = ${k.installationId} AND login = ${k.login} RETURNING installation_id`;
  return rows.length > 0;
}

type SubRow = DigestState & { installation_id: number; login: string; email: string; shared: boolean };

/**
 * v3 Stage 1 (spec 5.4): the subscription's person (the X-bound profile, else the installation's builder, else the
 * installation, as installations.ts connectInstallation reads it) and last week of their main project. A checked
 * week (the weekly job wrote it) is the moment; a ranked week not written yet is pending until PENDING_MAX_MS after
 * weekStart (a project the weekly job never writes, an unconfirmed one, is not pending). None on a shared client or
 * a per-login subscription (no verified person). A failed read is no week, never a failed email.
 */
async function digestWeek(s: SubRow, now: Date, db: Db): Promise<Pick<DigestFacts, 'week' | 'handle' | 'pending'> & { person: number | null }> {
  if (s.shared || s.login) return { week: null, handle: null, person: null };
  const [p] = await db<{ id: number; key: string | null; handle: string | null; name: string | null }[]>`
    SELECT x.id, b.main_project_key AS key, b.x_handle AS handle, b.x_name AS name
    FROM (SELECT COALESCE((SELECT p.builder_id FROM builder_profiles p WHERE p.x_user_id = i.x_user_id), i.builder_id, i.id) AS id
          FROM installations i WHERE i.id = ${s.installation_id}) x
    LEFT JOIN builder_profiles b ON b.builder_id = x.id`;
  const handle = p?.handle ?? null;
  const person = p?.id ?? null;
  if (!p?.key) return { week: null, handle, person };
  const key = p.key;
  try {
    const last = await lastWeekOf(p.id, key, now);
    if (!last) return { week: null, handle, person };
    if (!last.checked) {
      const [hid] = await db<{ hidden: boolean }[]>`
        SELECT hidden FROM project_updates WHERE builder_id = ${p.id} AND lower(project_key) = lower(${key}) AND week = ${last.monday}`;
      const waiting = !hid?.hidden && now.getTime() < weekStart(now).getTime() + PENDING_MAX_MS && (await mainConfirmed(p.id));
      return waiting ? { week: null, handle, person, pending: true } : { week: null, handle, person };
    }
    const link = (action: 'approve' | 'hide') => weekUrl({ builderId: p.id, key, monday: last.monday, action });
    // Owner batch fix wave (6): an email that can't show the week's stored summary records the offer (asked once).
    if (!last.approved && !last.summary && last.stored) await markOffered(p.id, key, last.monday, last.stored);
    // v3.2: the week's one-tap post (the reply's draft), only for an approved week (a builder's own text goes out only
    // once they said it looks right).
    const postUrl = handle && last.approved ? await weeklyPostLink(p.id, handle, now) : null;
    // v4.0 Task 7 (approved copy 5): the Monday reply's facts as plain lines (the streak and the community as find reads them).
    const [lit, community] = await Promise.all([
      streaksFor([p.id], now).then((m) => m.get(p.id) ?? null),
      weekCommunityUsd(p.id, new Date(`${last.monday}T00:00:00Z`), now),
    ]);
    const lines = mondayLines({
      first: firstName(p.name, handle), summary: momentSummary(last.summary ?? null), score: last.now.score,
      change: last.before ? last.now.score - last.before.score : null, streak: lit ? weekNumber([...lit.weeks], last.monday) : 0,
      usd: community.usd, lastWeekUsd: community.lastWeekUsd,
      // v4.10.3 final fix (F3): "You shipped last week." and "Nice work." only when last week has ship facts.
      shipped: last.facts,
    });
    return { week: { lines, standing: last.now, approveUrl: link('approve'), hideUrl: link('hide'), approved: last.approved, confirmed: last.confirmed, ...(postUrl && { postUrl }) }, handle, person };
  } catch (err) {
    // v3.2 (2026-10-27): a failed read waits like a week not written yet (retried next run, sent without the week
    // after PENDING_MAX_MS), never an empty email that marks the week considered: the owner's first Monday email
    // was lost that way.
    console.error('[digest] week', err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : 'error');
    return { week: null, handle, person, ...failedWeek(now) };
  }
}

/** The whole days until `end`, at least 1 (D5). Pure. */
const daysTo = (end: Date, now: Date) => Math.max(1, Math.floor((end.getTime() - now.getTime()) / DAY));

/**
 * v3.1 Task 12: the email's money lines (the Best fit's draft, new backers). v4.8.1 final fix (R-3): a close under 48
 * hours away is absolute in the program's zone (`zone`, else UTC) with the hours left as of sending ("closes Nov 1,
 * 11:59 PM PT (in 20 hours)"), never "in 1 day" at 3 hours left. Pure.
 */
export function moneyTexts(best: { title: string; ends_at: Date | null; zone?: string; research?: boolean } | null, newBackerCount: number, now: Date): string[] {
  const lines: string[] = [];
  if (best) {
    const n = best.ends_at ? daysTo(best.ends_at, now) : 0;
    const iso = best.ends_at?.toISOString() ?? null;
    const zone = best.zone ?? 'UTC';
    const by = iso && hoursLeft(iso, now) ? submitBy(iso, zone, now, best.zone ? zoneAbbr(zone) : null) : null;
    lines.push(best.ends_at
      ? `${best.title} closes ${by ?? `in ${n} ${n === 1 ? 'day' : 'days'}`}. Your draft is one yes away.${researchMark(best.research)}`
      : `${best.title} is open (rolling), and your draft is one yes away.${researchMark(best.research)}`);
  }
  if (newBackerCount > 0) lines.push(`${newBackerCount} new ${newBackerCount === 1 ? 'backer' : 'backers'} this week.`);
  return lines;
}

/**
 * v3.1 Task 12 (spec 3.3, D5): the email's money lines for `person`: the Best fit's draft (best-fit.ts bestFitFor, as
 * find and score name it; never one the builder applied to or declined), then the week's new backers (backers.ts
 * newBackers, 0 while EARNKIT_RAISING is off). No points. `best`: the Best fit's program, never also a new program line
 * (fix round 1). Never throws (each read is none on an error).
 */
async function moneyLines(person: number, now: Date): Promise<{ lines: string[]; best: string | null }> {
  const [best, k] = await Promise.all([bestFitFor(person, now), newBackers(person, new Date(now.getTime() - 7 * DAY))]);
  const lines = moneyTexts(best, k, now);
  return { lines, best: best?.program_id ?? null };
}

/**
 * One subscription's facts, read on `db`. Money (v3.1 Task 12): the person's money lines (moneyLines), none on a shared
 * client or a per-login subscription. New programs: opened since the last send (else the opt-in),
 * still open, that a remembered repo could really win (alertFit; never on a shared client, whose
 * remembered repos are none). Wins: announced won or placed outcomes of the last 7 days, never a
 * test installation's. Deadlines: the builder's entered programs closing, or with results expected,
 * in the next 7 days.
 */
export async function digestFacts(s: SubRow, now: Date, db: Db = sql()): Promise<DigestFacts> {
  const { person, ...moment } = await digestWeek(s, now, db);
  if (moment.pending) return { ...moment, money: [], newPrograms: [], wins: [], deadlines: [] };
  // v4.7 T5: the person's full standing on top (the email goes only to them; none on a shared client or a per-login subscription).
  const stand = person === null ? null : await standingFor(person, now);
  const standing = stand && standingLeads(stand) ? standingParagraph(stand) : '';
  const since = s.last_sent_at ?? s.opted_in_at ?? now;
  const week = new Date(now.getTime() + 7 * DAY);
  const ids = testInstallationIds();
  const id = s.installation_id;
  // Ruling G21 (G7, G9): on a shared client, only the entries this subscription's login signed in for.
  const own = s.shared
    ? db`AND p.id IN (SELECT project_id FROM github_verifications
        WHERE installation_id = ${id} AND login = ${s.login.toLowerCase()} AND project_id IS NOT NULL)`
    : db``;
  const [money, curated, fit, entered, told, said, wins, closing, decisions] = await Promise.all([
    person === null ? Promise.resolve({ lines: [] as string[], best: null }) : moneyLines(person, now),
    s.shared || s.login
      ? Promise.resolve([] as (NewProgramRow & { opened_at: Date; tz: string | null; source: string })[])
      : db<(NewProgramRow & { opened_at: Date; tz: string | null; source: string })[]>`
          SELECT id, title, summary, tz, source, chains, any_chain, opened_at, past_rounds, focus, best_bet, difficulty_override,
            winners_per_round, tag, each_time, submission_requirements, rules, investment, ends_at, starts_at, campaign,
            max_award_usd, existing_work, min_product_score, match_floor, match_precision
          FROM programs
          WHERE status = 'active' AND campaign IS NULL AND opened_at IS NOT NULL AND opened_at > ${since}
            AND (ends_at IS NULL OR ends_at > ${now}) AND ${freshSql(db, null, now)}
          ORDER BY opened_at DESC`,
    db<{ fit_repos: FitRepo[] | null }[]>`SELECT fit_repos FROM installations WHERE id = ${id}`,
    db<{ program_id: string }[]>`SELECT DISTINCT program_id FROM projects WHERE installation_id = ${id}`,
    db<{ program_id: string; status: 'applied' | 'not_interested'; round_label: string | null; at: Date }[]>`
      SELECT program_id, status, round_label, at FROM builder_program_status WHERE installation_id = ${id} AND login = ''`,
    db<{ repo_key: string; mainnet_chains: string[]; testnet_chains: string[]; live_url: string | null; has_users: boolean | null; not_mine: boolean }[]>`
      SELECT repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine
      FROM builder_repo_facts WHERE installation_id = ${id} AND login = ''`,
    db<{ name: string; program: string; prize_usd: string | null; source: string }[]>`
      SELECT p.name, pr.title AS program, eo.prize_usd::text AS prize_usd, pr.source
      FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id JOIN programs pr ON pr.id = eo.program_id
      WHERE eo.basis = 'announcement' AND eo.result IN ('won', 'placed')
        AND eo.captured_at > ${new Date(now.getTime() - 7 * DAY)} AND eo.captured_at <= ${now}
        AND NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false)
      ORDER BY eo.prize_usd DESC NULLS LAST, eo.captured_at DESC
      LIMIT ${MAX_LINES}`,
    db<{ program: string; at: Date; summary: string; tz: string | null; source: string }[]>`
      SELECT DISTINCT ON (pr.id) pr.title AS program, pr.ends_at AS at, pr.summary, pr.tz, pr.source
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.installation_id = ${id} AND p.program_id <> ${COIN_PROGRAM} AND pr.ends_at > ${now} AND pr.ends_at <= ${week} ${own}
      ORDER BY pr.id`,
    db<{ program: string; at: Date; source: string }[]>`
      SELECT DISTINCT ON (pr.id) pr.title AS program, (pr.results->>'expected')::date::timestamp AT TIME ZONE 'UTC' AS at, pr.source
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.installation_id = ${id} AND p.program_id <> ${COIN_PROGRAM} AND pr.results->>'expected' IS NOT NULL
        AND (pr.results->>'expected')::date >= (${now}::timestamptz AT TIME ZONE 'UTC')::date
        AND (pr.results->>'expected')::date <= (${week}::timestamptz AT TIME ZONE 'UTC')::date ${own}
      ORDER BY pr.id`,
  ]);
  const newPrograms: DigestFacts['newPrograms'] = [];
  if (curated.length > 0) {
    const memory: BuilderMemory = {
      programs: new Map(told.map((t) => [t.program_id, { status: t.status, round_label: t.round_label, at: t.at }])),
      repos: new Map(),
    };
    const saidNow = new Map(
      said.map((r) => [r.repo_key, { mainnet: r.mainnet_chains, testnet: r.testnet_chains, live_url: r.live_url, has_users: r.has_users, not_mine: r.not_mine }]),
    );
    const repos = (fit[0]?.fit_repos ?? []).map((r) => ({ ...r, said: (saidNow.get(r.key) as FitRepo['said']) ?? r.said ?? null }));
    const skip = { entered: new Set(entered.map((e) => e.program_id)), hidden: hiddenIds(hiddenPrograms(memory, curated)) };
    for (const row of curated) {
      // Fix round 1: the Best fit is the money line already, never a second line.
      if (row.id === money.best) continue;
      const p = newProgramOf(row);
      const repo = alertFit(p, repos, skip, now);
      if (repo) newPrograms.push({ title: p.title, repo: repo.name, prize_usd: p.max_award_usd, ends_at: p.ends_at, summary: row.summary, tz: row.tz, ...(row.source === 'api' && { research: true }) });
      if (newPrograms.length >= MAX_LINES) break;
    }
  }
  const deadlines: DigestFacts['deadlines'] = [
    ...closing.map((c) => ({ program: c.program, what: 'closes' as const, at: c.at, summary: c.summary, tz: c.tz, ...(c.source === 'api' && { research: true }) })),
    ...decisions.map((d) => ({ program: d.program, what: 'decision' as const, at: d.at, ...(d.source === 'api' && { research: true }) })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_LINES);
  return {
    ...moment,
    now,
    ...(standing && { standing }),
    money: money.lines,
    newPrograms,
    wins: wins.map((w) => ({ name: w.name, program: w.program, prize_usd: w.prize_usd === null ? null : Number(w.prize_usd), ...(w.source === 'api' && { research: true }) })),
    deadlines,
  };
}

/**
 * The cron's weekly email step. Each subscription is locked (FOR UPDATE SKIP LOCKED, so two runs at
 * once never send one twice) and handled in its own transaction: facts and body (v3 Stage 1: a week not
 * written yet is `pending`, neither sent nor considered, and counted in `pending`); an empty week sets
 * last_considered_at; else one slot of the day's and the month's cap (taken before the send and kept
 * whatever happens), the send, and last_sent_at in that same transaction. A refused cap stops the run
 * (`capped`); the rest wait for a later run. A send that fails for good (a 4xx other than 429) skips
 * the subscription this week; a 429 stops the run; anything else is retried on the next run, safely:
 * each send carries an Idempotency-Key for that subscription and week (review I2). MAX_SEND_FAILURES
 * failed sends (or rows that failed to read) in a row stop the run (`stopped`), so an outage never
 * burns the day's slots. Rows are keyed by (installation, login) (Ruling G21). `deps.only` limits the
 * run to these installations (tests). With no mailer (RESEND_API_KEY unset and none given) nothing runs.
 */
export async function sendDigests(
  now: Date,
  deps: { mail?: Mailer; budgetMs?: number; only?: number[] } = {},
): Promise<{ sent: number; skipped: number; capped: boolean; stopped?: true; pending?: number }> {
  const out: { sent: number; skipped: number; capped: boolean; stopped?: true; pending?: number } = { sent: 0, skipped: 0, capped: false };
  const key = process.env.RESEND_API_KEY?.trim();
  const mail = deps.mail ?? (key ? resendMailer(key) : null);
  if (!mail || !process.env.EARNKIT_AUTH_SECRET) return out;
  const deadline = Date.now() + (deps.budgetMs ?? SEND_BUDGET_MS);
  const start = weekStart(now);
  const tried: string[] = [];
  const from = digestFrom();
  let failures = 0;
  while (Date.now() < deadline) {
    // Nothing is taken unless both counters have room (a refused take would leak a slot).
    if (!(await freeTierRoom('resendDay', 1, now)) || !(await freeTierRoom('resendMonth', 1, now))) {
      out.capped = true;
      break;
    }
    if (tried.length >= RUN_MAX) break;
    const step = await sql().begin(async (tx) => {
      const [s] = await tx<SubRow[]>`
        SELECT d.installation_id, d.login, d.email, d.opted_in_at, d.unsubscribed_at, d.last_sent_at, d.last_considered_at,
          (i.shared_client AND i.x_user_id IS NULL) AS shared
        FROM digest_subscriptions d JOIN installations i ON i.id = d.installation_id
        WHERE d.opted_in_at IS NOT NULL AND d.opted_in_at < ${start} AND d.unsubscribed_at IS NULL
          AND (d.last_sent_at IS NULL OR d.last_sent_at < ${start})
          AND (d.last_considered_at IS NULL OR d.last_considered_at < ${start})
          AND NOT ((d.installation_id::text || ':' || d.login) = ANY(${tried}::text[]))
          ${deps.only ? tx`AND d.installation_id = ANY(${deps.only}::int[])` : tx``}
        ORDER BY d.last_sent_at NULLS FIRST, d.installation_id, d.login
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED`;
      if (!s) return 'done' as const;
      tried.push(`${s.installation_id}:${s.login}`);
      if (!digestDue(s, now)) return 'skip' as const;
      const target = { installationId: s.installation_id, login: s.login };
      const facts = await digestFacts(s, now, tx);
      // v3 Stage 1: last week is not written yet; neither sent nor considered, so a later run sends it.
      if (facts.pending) return 'pending' as const;
      const body = digestBody(facts);
      const consider = () => tx`
        UPDATE digest_subscriptions SET last_considered_at = ${now} WHERE installation_id = ${s.installation_id} AND login = ${s.login}`;
      if (!body) {
        await consider();
        return 'skip' as const;
      }
      // Day first: a refused month take then costs only a slot of a day that is over anyway.
      if (!(await takeFreeTier('resendDay', 1, now))) return 'capped' as const;
      if (!(await takeFreeTier('resendMonth', 1, now))) return 'capped' as const;
      const url = unsubUrl(target);
      try {
        await mail({
          to: s.email,
          from,
          subject: body.subject,
          text: `${body.text}\n\n${mailFooter(url)}`,
          headers: unsubHeaders(target),
          idempotencyKey: idempotencyKey(target, start),
        });
      } catch (err) {
        const status = err instanceof MailError ? err.status : 0;
        console.error('[digest] send', err instanceof MailError ? err.status : err instanceof Error ? err.name : 'error');
        if (status === 429) return 'capped' as const;
        // v3.2 (2026-10-27): 401 or 403 is the account (a bad key, or the sender domain not verified in Resend), never
        // this address: nothing is considered and the run stops, so every week goes out once it is fixed. The owner's
        // emails were all lost this way (no domain in Resend; each 403 marked the week considered).
        if (status === 401 || status === 403) return 'config' as const;
        if (status >= 400 && status < 500) {
          await consider();
          return 'rejected' as const;
        }
        return 'failed' as const;
      }
      await tx`UPDATE digest_subscriptions SET last_sent_at = ${now} WHERE installation_id = ${s.installation_id} AND login = ${s.login}`;
      return 'sent' as const;
    }).catch((err: unknown) => {
      // A row that fails to read (a database blip) never stops the others behind it.
      console.error('[digest] row', err instanceof Error ? err.name : 'error');
      return 'failed' as const;
    });
    if (step === 'done') break;
    if (step === 'capped') {
      out.capped = true;
      break;
    }
    if (step === 'config') {
      out.skipped++;
      out.stopped = true;
      break;
    }
    if (step === 'pending') {
      out.pending = (out.pending ?? 0) + 1;
      continue;
    }
    if (step === 'sent') out.sent++;
    else out.skipped++;
    failures = step === 'failed' || step === 'rejected' ? failures + 1 : step === 'sent' ? 0 : failures;
    if (failures >= MAX_SEND_FAILURES) {
      out.stopped = true;
      break;
    }
  }
  return out;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
};
/** v3 Stage 3 Task 6: the site's shell (brand-page.ts brandShell), as every other route-handler page. */
const page = (body: string, status = 200) => new Response(brandShell(body), { status, headers: PAGE_HEADERS });
/** A one-line page: the line as the statement. */
const linePage = (line: string, status = 200) => page(`<p class="ek-line ek-first">${escapeHtml(line)}</p>`, status);

/** v4.7 T5 (R17): one unsubscribe stops both the deadline alerts and the Monday summary. */
export const UNSUB_CONFIRM = 'Stop deadline alerts and the Monday summary?';
export const UNSUB_DONE = "Done. You won't get EarnKit emails any more.";
export const UNSUB_BAD = 'This link is not valid.';

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('t') ?? '';

/** GET: a confirm page whose button POSTs (link scanners never unsubscribe anyone). No script. */
export function digestUnsubscribeGet(request: Request): Response {
  const t = tokenOf(request);
  if (unsubTarget(t) === null) return linePage(UNSUB_BAD, 400);
  return page(
    `<h1>${escapeHtml(UNSUB_CONFIRM)}</h1>` +
      `<div class="ek-actions"><form method="post" action="${escapeHtml(`${siteUrl()}/api/digest/unsubscribe?t=${encodeURIComponent(t)}`)}">` +
      '<button class="ek-btn" type="submit">Unsubscribe</button></form></div>',
  );
}

/**
 * POST (RFC 8058 one-click, or the confirm page's button): the token alone decides; idempotent.
 * A bad token changes nothing.
 */
export async function digestUnsubscribePost(request: Request): Promise<Response> {
  const target = unsubTarget(tokenOf(request));
  if (target === null) return linePage(UNSUB_BAD, 400);
  await unsubscribe(target);
  return linePage(UNSUB_DONE);
}
