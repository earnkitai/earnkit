import { createHmac, timingSafeEqual } from 'node:crypto';
import { alertFit, newProgramOf, type FitRepo, type NewProgramRow } from './alerts';
import { hiddenIds, hiddenPrograms, type BuilderMemory } from './builder-memory';
import type { SubmissionRequirement } from './coach';
import { sql, type Db } from './db';
import { siteUrl } from './entry-text';
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
 * own deadlines and decision dates in the coming week. On a hosted agent (shared_client) one
 * installation serves many builders: no repo-based lines, and only the deadlines of entries whose
 * answers carry the subscription's own email.
 */

export const DIGEST_FROM_DEFAULT = 'EarnKit <digest@earnkit.com>';
export const digestEnabled = (env: Record<string, string | undefined> = process.env): boolean => Boolean(env.RESEND_API_KEY?.trim());
const digestFrom = () => process.env.DIGEST_FROM?.trim() || DIGEST_FROM_DEFAULT;

export const EMAIL_QUESTION = 'Get new programs and wins by email, once a week? yes / no';
export const emailQuestionFor = (email: string) => `Get new programs and wins by email at ${email}, once a week? yes / no`;
/** What the agent does with the question (Ruling 13). */
export const EMAIL_NOTE = "Pass the builder's answer to tell_earnkit as weekly_email.";
/** A yes with no address EarnKit may use. */
export const WHICH_EMAIL = 'Which email should I use?';
export const EMAIL_ON = 'Done. One email a week, on Mondays.';
export const EMAIL_OFF = 'No weekly email.';
export const EMAIL_UNAVAILABLE = 'The weekly email is not available yet.';
/** A hosted agent holds one subscription; another builder's live one is never replaced. */
export const EMAIL_TAKEN = 'This agent already sends the weekly email to someone else.';
/** Shared clients: a plain yes counts only this soon after the question (another builder may call later). */
export const SHARED_YES_MS = 60 * 60_000;

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

/** The email: new programs, then wins, then the builder's deadlines; null when all three are empty. Pure. */
export function digestBody(f: DigestFacts): { subject: string; text: string } | null {
  const lines = [
    ...f.newPrograms.map((p) => `New: ${p.title} fits ${p.repo}${money(p.prize_usd) ? `, ${money(p.prize_usd)}` : ''}${p.ends_at ? `, closes ${day(p.ends_at)}` : ''}.`),
    ...f.wins.map((w) => `Won: ${w.name} in ${w.program}${money(w.prize_usd) ? `, ${money(w.prize_usd)}` : ''}.`),
    ...f.deadlines.map((d) => `Your ${d.program}: ${d.what === 'closes' ? 'closes' : 'results due'} ${day(d.at)}.`),
  ];
  if (lines.length === 0) return null;
  const subject = f.newPrograms[0] ? `New: ${f.newPrograms[0].title} fits ${f.newPrograms[0].repo}` : 'Your EarnKit week';
  return { subject, text: `${lines.join('\n')}\n\nAsk your agent "What can I earn?" to start.` };
}

const mac = (installationId: number, secret: string) =>
  createHmac('sha256', secret).update(`digest-unsub:v1:${installationId}`).digest('base64url');

/**
 * The one-click unsubscribe token: `<installation id>.<HMAC-SHA256(EARNKIT_AUTH_SECRET,
 * "digest-unsub:v1:<id>"), base64url>`. Throws without the secret (nothing is sent then). Pure.
 */
export function unsubToken(installationId: number, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): string {
  if (!secret) throw new Error('EARNKIT_AUTH_SECRET is not set');
  return `${installationId}.${mac(installationId, secret)}`;
}

/** The installation a token names, or null (malformed, another id, a changed character, no secret). Timing-safe. */
export function unsubInstallation(token: string, secret: string | undefined = process.env.EARNKIT_AUTH_SECRET): number | null {
  if (!secret || typeof token !== 'string' || token.length > 200) return null;
  const m = token.match(/^([1-9][0-9]{0,9})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) return null;
  const want = Buffer.from(mac(id, secret));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

export const unsubUrl = (installationId: number) =>
  `${siteUrl()}/api/digest/unsubscribe?t=${encodeURIComponent(unsubToken(installationId))}`;

/** RFC 2369 and RFC 8058: every email's unsubscribe headers. */
export const unsubHeaders = (installationId: number): Record<string, string> => ({
  'List-Unsubscribe': `<${unsubUrl(installationId)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

export type Mailer = (m: { to: string; from: string; subject: string; text: string; headers: Record<string, string> }) => Promise<void>;

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
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
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

/** The entry's email answer: the first contact field whose label says email (coach.ts's email slot). Pure. */
export function entryEmail(reqs: Pick<SubmissionRequirement, 'key' | 'label' | 'kind'>[], values: Record<string, string>): string | null {
  for (const r of reqs) {
    if (r.kind !== 'contact' || !/e-?mail/i.test(r.label)) continue;
    const e = cleanEmail(values[r.key]);
    if (e) return e;
  }
  return null;
}

/**
 * Ruling 13: the question, once per installation (digest_asked_at), only while the email is on.
 * `email`: the address the question may use (P16: on a shared client, only the one this builder
 * typed in this entry; never one remembered). It is kept, not opted in, until a yes. Returns what the
 * reply adds, or null (off, or asked before). Never fails the tool.
 */
export async function askWeeklyEmail(
  installationId: number,
  opts: { shared: boolean; email: string | null },
): Promise<{ question: string; agent_note: string } | null> {
  if (!digestEnabled()) return null;
  try {
    return await sql().begin(async (tx) => {
      const [asked] = await tx<{ id: number }[]>`
        UPDATE installations SET digest_asked_at = now() WHERE id = ${installationId} AND digest_asked_at IS NULL RETURNING id`;
      if (!asked) return null;
      if (opts.email)
        await tx`
          INSERT INTO digest_subscriptions (installation_id, email) VALUES (${installationId}, ${opts.email})
          ON CONFLICT (installation_id) DO UPDATE SET email = EXCLUDED.email WHERE digest_subscriptions.opted_in_at IS NULL`;
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
 * Stores the builder's answer. No: the subscription and its address are deleted. Yes with an address:
 * that one. A plain yes: the address kept with the question (the entry's email on a non-shared
 * client; on a shared one only the address the question named, and only within SHARED_YES_MS of it).
 * Returns what to show.
 */
export async function saveWeeklyEmail(installationId: number, w: WeeklyEmail, opts: { shared: boolean }, now = new Date()) {
  if (!digestEnabled()) return { show_to_builder: EMAIL_UNAVAILABLE, saved: false };
  const db = sql();
  if (w.answer === 'no') {
    await db`DELETE FROM digest_subscriptions WHERE installation_id = ${installationId}`;
    return { show_to_builder: EMAIL_OFF, saved: true };
  }
  const given = w.email === undefined ? null : cleanEmail(w.email);
  if (w.email !== undefined && !given) return { show_to_builder: WHICH_EMAIL, saved: false };
  if (given) {
    // A hosted agent holds one subscription: never replace another builder's live one.
    const [row] = await db<{ id: number }[]>`
      INSERT INTO digest_subscriptions (installation_id, email, opted_in_at) VALUES (${installationId}, ${given}, ${now})
      ON CONFLICT (installation_id) DO UPDATE SET
        email = EXCLUDED.email,
        opted_in_at = CASE WHEN digest_subscriptions.opted_in_at IS NULL OR digest_subscriptions.unsubscribed_at IS NOT NULL
          THEN EXCLUDED.opted_in_at ELSE digest_subscriptions.opted_in_at END,
        unsubscribed_at = NULL
      WHERE ${!opts.shared} OR digest_subscriptions.opted_in_at IS NULL OR digest_subscriptions.unsubscribed_at IS NOT NULL
        OR digest_subscriptions.email = EXCLUDED.email
      RETURNING installation_id AS id`;
    return row ? { show_to_builder: EMAIL_ON, saved: true } : { show_to_builder: EMAIL_TAKEN, saved: false };
  }
  const [row] = await db<{ id: number }[]>`
    UPDATE digest_subscriptions d SET opted_in_at = COALESCE(d.opted_in_at, ${now}), unsubscribed_at = NULL
    FROM installations i
    WHERE d.installation_id = ${installationId} AND i.id = d.installation_id
      AND (${!opts.shared} OR (d.opted_in_at IS NULL AND i.digest_asked_at > ${new Date(now.getTime() - SHARED_YES_MS)}))
    RETURNING d.installation_id AS id`;
  return row ? { show_to_builder: EMAIL_ON, saved: true } : { show_to_builder: WHICH_EMAIL, saved: false };
}

/** One-click unsubscribe: idempotent (the first time stands). True when the installation has a subscription. */
export async function unsubscribe(installationId: number, now = new Date()): Promise<boolean> {
  const rows = await sql()`
    UPDATE digest_subscriptions SET unsubscribed_at = COALESCE(unsubscribed_at, ${now})
    WHERE installation_id = ${installationId} RETURNING installation_id`;
  return rows.length > 0;
}

type SubRow = DigestState & { installation_id: number; email: string; shared: boolean };

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
  // Shared clients: only entries whose answers carry this subscription's own address.
  const own = s.shared
    ? db`AND EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(p.application->'answers', '{}'::jsonb)) a WHERE lower(trim(a.value)) = ${s.email})`
    : db``;
  const [curated, fit, entered, told, said, wins, closing, decisions] = await Promise.all([
    s.shared
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
      WHERE p.installation_id = ${id} AND pr.ends_at > ${now} AND pr.ends_at <= ${week} ${own}
      ORDER BY pr.id`,
    db<{ program: string; at: Date }[]>`
      SELECT DISTINCT ON (pr.id) pr.title AS program, (pr.results->>'expected')::date::timestamp AT TIME ZONE 'UTC' AS at
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE p.installation_id = ${id} AND pr.results->>'expected' IS NOT NULL
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
 * the subscription this week; a 429 stops the run; anything else is retried on the next run.
 * `deps.only` limits the run to these installations (tests). With no mailer (RESEND_API_KEY unset and
 * none given) nothing runs.
 */
export async function sendDigests(
  now: Date,
  deps: { mail?: Mailer; budgetMs?: number; only?: number[] } = {},
): Promise<{ sent: number; skipped: number; capped: boolean }> {
  const out = { sent: 0, skipped: 0, capped: false };
  const key = process.env.RESEND_API_KEY?.trim();
  const mail = deps.mail ?? (key ? resendMailer(key) : null);
  if (!mail || !process.env.EARNKIT_AUTH_SECRET) return out;
  const deadline = Date.now() + (deps.budgetMs ?? SEND_BUDGET_MS);
  const start = weekStart(now);
  const tried: number[] = [];
  const from = digestFrom();
  while (Date.now() < deadline) {
    // Nothing is taken unless both counters have room (a refused take would leak a slot).
    if (!(await freeTierRoom('resendDay', 1, now)) || !(await freeTierRoom('resendMonth', 1, now))) {
      out.capped = true;
      break;
    }
    if (tried.length >= RUN_MAX) break;
    const step = await sql().begin(async (tx) => {
      const [s] = await tx<SubRow[]>`
        SELECT d.installation_id, d.email, d.opted_in_at, d.unsubscribed_at, d.last_sent_at, d.last_considered_at,
          i.shared_client AS shared
        FROM digest_subscriptions d JOIN installations i ON i.id = d.installation_id
        WHERE d.opted_in_at IS NOT NULL AND d.opted_in_at < ${start} AND d.unsubscribed_at IS NULL
          AND (d.last_sent_at IS NULL OR d.last_sent_at < ${start})
          AND (d.last_considered_at IS NULL OR d.last_considered_at < ${start})
          AND NOT (d.installation_id = ANY(${tried}::int[]))
          ${deps.only ? tx`AND d.installation_id = ANY(${deps.only}::int[])` : tx``}
        ORDER BY d.last_sent_at NULLS FIRST, d.installation_id
        LIMIT 1
        FOR UPDATE OF d SKIP LOCKED`;
      if (!s) return 'done' as const;
      tried.push(s.installation_id);
      if (!digestDue(s, now)) return 'skip' as const;
      const body = digestBody(await digestFacts(s, now, tx));
      const consider = () => tx`UPDATE digest_subscriptions SET last_considered_at = ${now} WHERE installation_id = ${s.installation_id}`;
      if (!body) {
        await consider();
        return 'skip' as const;
      }
      // Day first: a refused month take then costs only a slot of a day that is over anyway.
      if (!(await takeFreeTier('resendDay', 1, now))) return 'capped' as const;
      if (!(await takeFreeTier('resendMonth', 1, now))) return 'capped' as const;
      const url = unsubUrl(s.installation_id);
      try {
        await mail({
          to: s.email,
          from,
          subject: body.subject,
          text: `${body.text}\n\nOne email a week. Unsubscribe: ${url}`,
          headers: unsubHeaders(s.installation_id),
        });
      } catch (err) {
        const status = err instanceof MailError ? err.status : 0;
        console.error('[digest] send', err instanceof MailError ? err.status : err instanceof Error ? err.name : 'error');
        if (status === 429) return 'capped' as const;
        if (status >= 400 && status < 500) {
          await consider();
          return 'skip' as const;
        }
        return 'retry' as const;
      }
      await tx`UPDATE digest_subscriptions SET last_sent_at = ${now} WHERE installation_id = ${s.installation_id}`;
      return 'sent' as const;
    });
    if (step === 'done') break;
    if (step === 'capped') {
      out.capped = true;
      break;
    }
    if (step === 'sent') out.sent++;
    else out.skipped++;
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
  if (unsubInstallation(t) === null) return page(`<p>${escapeHtml(UNSUB_BAD)}</p>`, 400);
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
  const id = unsubInstallation(tokenOf(request));
  if (id === null) return page(`<p>${escapeHtml(UNSUB_BAD)}</p>`, 400);
  await unsubscribe(id);
  return page(`<p>${escapeHtml(UNSUB_DONE)}</p>`);
}
