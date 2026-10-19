import { createHmac, timingSafeEqual } from 'node:crypto';
import { alertFit, newProgramOf, type FitRepo, type NewProgramRow } from './alerts';
import { hiddenIds, hiddenPrograms, type BuilderMemory } from './builder-memory';
import { sql, type Db } from './db';
import { siteUrl } from './entry-text';
import { COIN_PROGRAM } from './policy-constants';
import { freeTierRoom, takeFreeTier } from './free-tier';
import { testInstallationIds } from './installations';

/**
 * v2.9 E19: the weekly email, opt-in only. Asked once per installation, after its first recorded
 * entry (Ruling 13); the answer comes back through tell_earnkit's `weekly_email`. Sent by the hourly
 * cron from Monday 14:00 UTC (weekStart), at most once a week per subscription, never empty, within
 * Resend's free tier (free-tier.ts: 100 a day, 3,000 a month; the rest wait for a later run). Every
 * email carries List-Unsubscribe with a one-click link (RFC 8058, /api/digest/unsubscribe). With
 * RESEND_API_KEY unset the whole feature is off: no question, no send.
 * Content (in this order): new programs one of the builder's remembered repos could really win
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
const digestFrom = () => process.env.DIGEST_FROM?.trim() || DIGEST_FROM_DEFAULT;

export const EMAIL_QUESTION = 'Get new programs and wins by email, once a week? yes / no';
export const emailQuestionFor = (email: string) => `Get new programs and wins by email at ${email}, once a week? yes / no`;
/** What the agent does with the question (Ruling 13). */
export const EMAIL_NOTE = "Pass the builder's answer to tell as weekly_email.";
/** A yes with no address EarnKit may use. */
export const WHICH_EMAIL = 'Which email should I use?';
export const EMAIL_ON = 'Done. One email a week, on Mondays.';
export const EMAIL_OFF = 'No weekly email.';
export const EMAIL_UNAVAILABLE = 'The weekly email is not available yet.';
/** Ruling G21: a hosted agent has no verified caller, so it can't keep a weekly email. */
export const EMAIL_SIGN_IN = "The weekly email isn't available on this agent.";
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

/** This week's Monday 14:00 UTC, or last week's before that moment. Pure. */
export function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 14));
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

export type DigestFacts = {
  newPrograms: { title: string; repo: string; prize_usd: number | null; ends_at: Date | null }[];
  wins: { name: string; program: string; prize_usd: number | null }[];
  deadlines: { program: string; what: 'closes' | 'decision'; at: Date }[];
};

const money = (usd: number | null) => (usd ? `$${usd.toLocaleString('en-US')}` : null);
const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

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

/**
 * The email: new programs, then wins, then the builder's deadlines; null when all three are empty.
 * Every builder-supplied name (a repo, a winning project) goes through cleanName. Pure.
 */
export function digestBody(f: DigestFacts): { subject: string; text: string } | null {
  const lines = [
    ...f.newPrograms.map((p) => `New: ${p.title} fits ${cleanName(p.repo, 'your repo')}${money(p.prize_usd) ? `, ${money(p.prize_usd)}` : ''}${p.ends_at ? `, closes ${day(p.ends_at)}` : ''}.`),
    ...f.wins.map((w) => `Won: ${cleanName(w.name, 'An EarnKit builder')} in ${w.program}${money(w.prize_usd) ? `, ${money(w.prize_usd)}` : ''}.`),
    ...f.deadlines.map((d) => `Your ${d.program}: ${d.what === 'closes' ? 'closes' : 'results due'} ${day(d.at)}.`),
  ];
  if (lines.length === 0) return null;
  const subject = f.newPrograms[0] ? `New: ${f.newPrograms[0].title} fits ${cleanName(f.newPrograms[0].repo, 'your repo')}` : 'Your EarnKit week';
  return { subject, text: `${lines.join('\n')}\n\nAsk your agent "What can I earn?" to start.` };
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

/** Resend's API (POST /emails, 10 s). Never logs the address or the key. */
export const resendMailer =
  (key: string): Mailer =>
  async (m) => {
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
        body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, headers: m.headers }),
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

/**
 * The entry's email answer: the first field of type email, or contact field whose label says email
 * (coach.ts's email slot), holding a plain address. Pure.
 */
export function entryEmail(reqs: { key: string; label: string; kind?: string; type?: string }[], values: Record<string, string>): string | null {
  for (const r of reqs) {
    if (r.type !== 'email' && (r.kind !== 'contact' || !/e-?mail/i.test(r.label))) continue;
    const e = cleanEmail(values[r.key]);
    if (e) return e;
  }
  return null;
}

/**
 * Ruling 13: the question, once per subscription key, only while the email is on: an installation
 * (installations.digest_asked_at), or on a shared client (Ruling G21) a verified login (its row's
 * asked_at); a shared client without a login is never asked. `email`: the address the question may
 * use (P16: on a shared client, only the one this builder typed in this entry; never one remembered).
 * It is kept, not opted in, until a yes. Returns what the reply adds, or null (off, no login, or asked
 * before). Never fails the tool.
 */
export async function askWeeklyEmail(
  installationId: number,
  opts: { shared: boolean; email: string | null; login?: string | null },
): Promise<{ question: string; agent_note: string } | null> {
  if (!digestEnabled()) return null;
  const login = opts.shared ? opts.login?.toLowerCase() : '';
  if (!login && opts.shared) return null;
  try {
    return await sql().begin(async (tx) => {
      if (opts.shared) {
        const [asked] = await tx<{ id: number }[]>`
          INSERT INTO digest_subscriptions (installation_id, login, email, asked_at) VALUES (${installationId}, ${login!}, ${opts.email}, now())
          ON CONFLICT (installation_id, login) DO NOTHING RETURNING installation_id AS id`;
        if (!asked) return null;
      } else {
        const [asked] = await tx<{ id: number }[]>`
          UPDATE installations SET digest_asked_at = now() WHERE id = ${installationId} AND digest_asked_at IS NULL RETURNING id`;
        if (!asked) return null;
        await tx`
          INSERT INTO digest_subscriptions (installation_id, login, email, asked_at) VALUES (${installationId}, '', ${opts.email}, now())
          ON CONFLICT (installation_id, login) DO UPDATE SET email = COALESCE(EXCLUDED.email, digest_subscriptions.email), asked_at = now()
          WHERE digest_subscriptions.opted_in_at IS NULL`;
      }
      return {
        // Non-shared clients: the entry's email is reused only after the yes, so the question names none.
        question: opts.shared && opts.email ? emailQuestionFor(opts.email) : EMAIL_QUESTION,
        agent_note: EMAIL_NOTE,
      };
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
 * One subscription's facts, read on `db`. New programs: opened since the last send (else the opt-in),
 * still open, that a remembered repo could really win (alertFit; never on a shared client, whose
 * remembered repos are none). Wins: announced won or placed outcomes of the last 7 days, never a
 * test installation's. Deadlines: the builder's entered programs closing, or with results expected,
 * in the next 7 days.
 */
export async function digestFacts(s: SubRow, now: Date, db: Db = sql()): Promise<DigestFacts> {
  const since = s.last_sent_at ?? s.opted_in_at ?? now;
  const week = new Date(now.getTime() + 7 * DAY);
  const ids = testInstallationIds();
  const id = s.installation_id;
  // Ruling G21 (G7, G9): on a shared client, only the entries this subscription's login signed in for.
  const own = s.shared
    ? db`AND p.id IN (SELECT project_id FROM github_verifications
        WHERE installation_id = ${id} AND login = ${s.login.toLowerCase()} AND project_id IS NOT NULL)`
    : db``;
  const [curated, fit, entered, told, said, wins, closing, decisions] = await Promise.all([
    s.shared || s.login
      ? Promise.resolve([] as (NewProgramRow & { opened_at: Date })[])
      : db<(NewProgramRow & { opened_at: Date })[]>`
          SELECT id, title, summary, chains, any_chain, opened_at, past_rounds, focus, best_bet, difficulty_override,
            winners_per_round, tag, each_time, submission_requirements, rules, investment, ends_at, starts_at, campaign,
            max_award_usd, existing_work, min_product_score, match_floor, match_precision
          FROM programs
          WHERE status = 'active' AND campaign IS NULL AND opened_at IS NOT NULL AND opened_at > ${since}
            AND (ends_at IS NULL OR ends_at > ${now})
          ORDER BY opened_at DESC`,
    db<{ fit_repos: FitRepo[] | null }[]>`SELECT fit_repos FROM installations WHERE id = ${id}`,
    db<{ program_id: string }[]>`SELECT DISTINCT program_id FROM projects WHERE installation_id = ${id}`,
    db<{ program_id: string; status: 'applied' | 'not_interested'; round_label: string | null; at: Date }[]>`
      SELECT program_id, status, round_label, at FROM builder_program_status WHERE installation_id = ${id} AND login = ''`,
    db<{ repo_key: string; mainnet_chains: string[]; testnet_chains: string[]; live_url: string | null; has_users: boolean | null; not_mine: boolean }[]>`
      SELECT repo_key, mainnet_chains, testnet_chains, live_url, has_users, not_mine
      FROM builder_repo_facts WHERE installation_id = ${id} AND login = ''`,
    db<{ name: string; program: string; prize_usd: string | null }[]>`
      SELECT p.name, pr.title AS program, eo.prize_usd::text AS prize_usd
      FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id JOIN programs pr ON pr.id = eo.program_id
      WHERE eo.basis = 'announcement' AND eo.result IN ('won', 'placed')
        AND eo.captured_at > ${new Date(now.getTime() - 7 * DAY)} AND eo.captured_at <= ${now}
        AND NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false)
      ORDER BY eo.prize_usd DESC NULLS LAST, eo.captured_at DESC
      LIMIT ${MAX_LINES}`,
    db<{ program: string; at: Date }[]>`
      SELECT DISTINCT ON (pr.id) pr.title AS program, pr.ends_at AS at
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.installation_id = ${id} AND p.program_id <> ${COIN_PROGRAM} AND pr.ends_at > ${now} AND pr.ends_at <= ${week} ${own}
      ORDER BY pr.id`,
    db<{ program: string; at: Date }[]>`
      SELECT DISTINCT ON (pr.id) pr.title AS program, (pr.results->>'expected')::date::timestamp AT TIME ZONE 'UTC' AS at
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
      const p = newProgramOf(row);
      const repo = alertFit(p, repos, skip, now);
      if (repo) newPrograms.push({ title: p.title, repo: repo.name, prize_usd: p.max_award_usd, ends_at: p.ends_at });
      if (newPrograms.length >= MAX_LINES) break;
    }
  }
  const deadlines: DigestFacts['deadlines'] = [
    ...closing.map((c) => ({ program: c.program, what: 'closes' as const, at: c.at })),
    ...decisions.map((d) => ({ program: d.program, what: 'decision' as const, at: d.at })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_LINES);
  return {
    newPrograms,
    wins: wins.map((w) => ({ name: w.name, program: w.program, prize_usd: w.prize_usd === null ? null : Number(w.prize_usd) })),
    deadlines,
  };
}

/**
 * The cron's weekly email step. Each subscription is locked (FOR UPDATE SKIP LOCKED, so two runs at
 * once never send one twice) and handled in its own transaction: facts and body; an empty week sets
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
): Promise<{ sent: number; skipped: number; capped: boolean; stopped?: true }> {
  const out: { sent: number; skipped: number; capped: boolean; stopped?: true } = { sent: 0, skipped: 0, capped: false };
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
          i.shared_client AS shared
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
      const body = digestBody(await digestFacts(s, now, tx));
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
          text: `${body.text}\n\nOne email a week. Unsubscribe: ${url}`,
          headers: unsubHeaders(target),
          idempotencyKey: idempotencyKey(target, start),
        });
      } catch (err) {
        const status = err instanceof MailError ? err.status : 0;
        console.error('[digest] send', err instanceof MailError ? err.status : err instanceof Error ? err.name : 'error');
        if (status === 429) return 'capped' as const;
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
const page = (body: string, status = 200) =>
  new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>EarnKit</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">' +
      `${body}</body></html>`,
    { status, headers: PAGE_HEADERS },
  );

export const UNSUB_CONFIRM = 'Stop the weekly EarnKit email?';
export const UNSUB_DONE = 'Done. No more weekly emails.';
export const UNSUB_BAD = 'This link is not valid.';

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('t') ?? '';

/** GET: a confirm page whose button POSTs (link scanners never unsubscribe anyone). No script. */
export function digestUnsubscribeGet(request: Request): Response {
  const t = tokenOf(request);
  if (unsubTarget(t) === null) return page(`<p>${escapeHtml(UNSUB_BAD)}</p>`, 400);
  return page(
    `<p>${escapeHtml(UNSUB_CONFIRM)}</p>` +
      `<form method="post" action="${escapeHtml(`${siteUrl()}/api/digest/unsubscribe?t=${encodeURIComponent(t)}`)}">` +
      '<button type="submit">Unsubscribe</button></form>',
  );
}

/**
 * POST (RFC 8058 one-click, or the confirm page's button): the token alone decides; idempotent.
 * A bad token changes nothing.
 */
export async function digestUnsubscribePost(request: Request): Promise<Response> {
  const target = unsubTarget(tokenOf(request));
  if (target === null) return page(`<p>${escapeHtml(UNSUB_BAD)}</p>`, 400);
  await unsubscribe(target);
  return page(`<p>${escapeHtml(UNSUB_DONE)}</p>`);
}
