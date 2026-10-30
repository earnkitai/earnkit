import { sql } from './db';
import { alertFit, DEADLINE_DAYS, newProgramOf, openCuratedRows, type NewProgramRow } from './alerts';
import { awardAmount } from './bench-reply';
import { openFitsFor } from './best-fit';
import { closeDay } from './deadline';
import { cleanName, digestFrom, mailFooter, MailError, MAX_SEND_FAILURES, resendMailer, unsubHeaders, unsubUrl, weekStart, type Mailer } from './digest';
import { readFitRepos } from './installations';
import { outcomeShareLine } from './nudges';
import { COIN_PROGRAM } from './policy-constants';
import { shortLink } from './post-reply';
import { fundWhen } from './stand-view';
import { freeTierRoom, takeFreeTier } from './free-tier';
import { isRealAnswer } from './submission';

/**
 * v4.7 T5 (EarnKit speaks first): the alert emails. The owner: "EarnKit never messages me." One opted-in subscription
 * (digest.ts, the Monday summary's) also gets, at most once a UTC day, one short email about the builder's highest event
 * not mailed before: accepted (an outcome post, nudges.ts acceptedNudge's source) > closing (a fit or a draft closing
 * within DEADLINE_DAYS, deadline.ts closeDay) > new fit (a program opened in the last NEW_FIT_DAYS that one of the
 * builder's remembered repos could really win, alerts.ts alertFit). Each event goes once ever, keyed in
 * `alert_mail_sent (builder_id, event_key)`, written in the send's transaction (a failed send stores nothing). Daily from
 * the cron at ALERT_HOUR_UTC, after the Monday digest's hour, with what is left of Resend's day and month caps after the
 * digests still due this week (free-tier.ts; the digest takes priority). Off without RESEND_API_KEY or
 * EARNKIT_AUTH_SECRET, as digestEnabled. Plain text, money first: no revenue, keys, wallets, points or coins.
 */

/** The alerts' UTC hour: the cron's hourly run in this hour sends them (after DIGEST_HOUR_UTC, 16). */
export const ALERT_HOUR_UTC = 17;
/** A program opened this many days ago or less is a new fit. */
export const NEW_FIT_DAYS = 7;
/** An accepted or funded outcome post this recent is mailed (an older one was shown in the agent long ago). */
export const ACCEPTED_DAYS = 7;
/** Most builders one run considers (Resend's daily cap). */
const RUN_MAX = 100;
const SEND_BUDGET_MS = 60_000;
const DAY = 86_400_000;

export type AlertEvent =
  | { kind: 'accepted'; key: string; program: string; link: string }
  | { kind: 'closing'; key: string; program: string; day: string; amount: string | null; draft: boolean }
  | { kind: 'new'; key: string; program: string; amount: string | null; when: string; project: string };

/** Highest first: one email a day carries the first of these. */
export const ALERT_ORDER: AlertEvent['kind'][] = ['accepted', 'closing', 'new'];

/** The highest event (ALERT_ORDER, then the order given), or null. Pure. */
export function pickAlert(events: AlertEvent[]): AlertEvent | null {
  return [...events].sort((a, b) => ALERT_ORDER.indexOf(a.kind) - ALERT_ORDER.indexOf(b.kind))[0] ?? null;
}

/** v4.7 T5 (exact copy): one alert's subject and body; an unknown amount leaves its ", {amount}" out. Pure. */
export function alertBody(e: AlertEvent): { subject: string; text: string } {
  const amt = (a: string | null) => (a ? `, ${a}` : '');
  if (e.kind === 'accepted') return { subject: `You got into ${e.program}`, text: `You got into ${e.program}.\n\n${outcomeShareLine(e.link)}` };
  if (e.kind === 'closing') {
    return {
      subject: `${e.program} closes ${e.day}`,
      text: `${e.program} closes ${e.day}${amt(e.amount)}.\n\n${e.draft ? 'Your draft is ready in your agent.' : 'Ask your agent to draft it.'}`,
    };
  }
  return {
    subject: `New: ${e.program}${amt(e.amount)}`,
    text: `${e.program} opened${amt(e.amount)}, ${e.when}.\n\n${e.project} fits it. Ask your agent to draft it.`,
  };
}

/** The unsubscribe footer: the digest's own (digest.ts mailFooter, R17), with its link and headers (one subscription carries both emails). */
export const alertFooter = mailFooter;

type EntryRow = { program_id: string; ends_at: Date; application: { answers?: Record<string, unknown> } | null };
type DraftRow = { program_id: string; title: string; code: string };

/**
 * v4.7 T5: the builder's (the group root's) alert events now, every kind, unsent or not (runAlertMail filters). Closing:
 * an entry not submitted (nudges.ts closingPick's rule, never one told applied) or an open fit (best-fit.ts openFitsFor),
 * its program closing within DEADLINE_DAYS; `draft` when a real answer is stored or the builder has the draft in hand
 * (standing_seen.apply_yes). Accepted: an accepted or funded outcome post with its proof (post-reply.ts outcomePost)
 * from the last ACCEPTED_DAYS, with the builder's X handle for its link. New fit: a curated program opened in the last
 * NEW_FIT_DAYS that one of the remembered repos (installations.fit_repos) could really win (alerts.ts alertFit: never
 * entered, hidden, or under 3 days left). Keys: 'accepted:<program>', 'closing:<program>:<close date>', 'new:<program>'.
 * A failed read is no events of that kind (logged).
 */
export async function alertEvents(builderId: number, now: Date): Promise<AlertEvent[]> {
  const fail = <T>(what: string, none: T) => (err: unknown) => {
    console.error(`[alert mail] ${what}`, err instanceof Error ? err.name : 'error');
    return none;
  };
  const soon = new Date(now.getTime() + DEADLINE_DAYS * DAY);
  const [open, entries, profile, drafts, rows, repos] = await Promise.all([
    openFitsFor(builderId, now),
    sql()<EntryRow[]>`
      SELECT DISTINCT ON (p.program_id) p.program_id, pr.ends_at, p.application
      FROM projects p JOIN programs pr ON pr.id = p.program_id JOIN installations i ON i.id = p.installation_id
      WHERE COALESCE(i.builder_id, i.id) = ${builderId} AND pr.status = 'active' AND pr.campaign IS NULL AND p.program_id <> ${COIN_PROGRAM}
        AND p.confirmed_at IS NOT NULL AND p.submission_confirmed_at IS NULL AND p.submission_proof_ok_at IS NULL
        AND pr.ends_at > ${now} AND pr.ends_at <= ${soon}
        AND NOT EXISTS (SELECT 1 FROM builder_program_status s WHERE s.installation_id = p.installation_id AND s.program_id = p.program_id AND s.status = 'applied')
      ORDER BY p.program_id, p.id DESC`.catch(fail('entries', [] as EntryRow[])),
    sql()<{ handle: string | null; drafted: Record<string, string> | null }[]>`
      SELECT x_handle AS handle, standing_seen->'apply_yes' AS drafted FROM builder_profiles WHERE builder_id = ${builderId}`.catch(fail('profile', [])),
    sql()<DraftRow[]>`
      SELECT DISTINCT ON (g.id) g.id AS program_id, g.title, d.code
      FROM post_drafts d JOIN programs g ON g.id = substr(d.moment_key, length(d.moment) + 2)
      WHERE d.builder_id = ${builderId} AND d.moment IN ('accepted', 'funded') AND d.proof_url IS NOT NULL
        AND d.created_at <= ${now} AND d.created_at > ${new Date(now.getTime() - ACCEPTED_DAYS * DAY)} AND d.expires_at > ${now}
      ORDER BY g.id, d.created_at DESC`.catch(fail('accepted', [] as DraftRow[])),
    openCuratedRows().then((r) => [...r], fail('programs', [] as (NewProgramRow & { opened_at: Date })[])),
    readFitRepos(builderId).catch(fail('repos', [] as Awaited<ReturnType<typeof readFitRepos>>)),
  ]);
  const handle = profile[0]?.handle ?? null;
  const drafted = profile[0]?.drafted ?? {};
  const cards = new Map(open.cards.map((c) => [c.id, c]));
  const out: AlertEvent[] = [];

  if (handle) for (const d of drafts) out.push({ kind: 'accepted', key: `accepted:${d.program_id}`, program: d.title, link: shortLink(handle, d.code) });

  const closing = new Map<string, { ends: Date; draft: boolean }>();
  for (const e of entries) {
    const real = Object.values(e.application?.answers ?? {}).some((a) => typeof a === 'string' && isRealAnswer(a));
    closing.set(e.program_id, { ends: e.ends_at, draft: real || Boolean(drafted[e.program_id]) });
  }
  for (const f of open.fits) {
    if (!f.ends_at || closing.has(f.program_id)) continue;
    const ends = new Date(f.ends_at);
    if (ends > now && ends <= soon) closing.set(f.program_id, { ends, draft: Boolean(drafted[f.program_id]) });
  }
  for (const [id, c] of [...closing].sort((a, b) => a[1].ends.getTime() - b[1].ends.getTime())) {
    const card = cards.get(id);
    const day = card ? closeDay(card) : null;
    if (!card || !day) continue;
    out.push({ kind: 'closing', key: `closing:${id}:${c.ends.toISOString().slice(0, 10)}`, program: card.title, day, amount: awardAmount(card), draft: c.draft });
  }

  const fresh = rows
    .filter((r) => r.opened_at && now.getTime() - r.opened_at.getTime() <= NEW_FIT_DAYS * DAY && r.opened_at <= now)
    .sort((a, b) => b.opened_at.getTime() - a.opened_at.getTime());
  for (const r of fresh) {
    const card = cards.get(r.id);
    if (!card || closing.has(r.id)) continue;
    const repo = alertFit(newProgramOf(r), repos, { entered: open.skip, hidden: new Set() }, now);
    if (!repo) continue;
    out.push({ kind: 'new', key: `new:${r.id}`, program: card.title, amount: awardAmount(card), when: fundWhen(card), project: cleanName(repo.name, 'Your project') });
  }
  return out;
}

/** Resend's Idempotency-Key for one builder's one event (a retried send never mails twice). Pure. */
export const alertIdempotencyKey = (builderId: number, eventKey: string) => `alert-${builderId}-${eventKey}`;

type SubRow = { builder_id: number; installation_id: number; email: string };

/**
 * v4.7 T5: the cron's daily alert step. Runs only in the ALERT_HOUR_UTC hour (`deps.force`: tests). For each builder
 * (the group root) with an opted-in, subscribed, own subscription (never a shared client's or a per-login one) and no
 * alert mailed this UTC day: the events (`deps.events`, default alertEvents) minus those mailed before, the highest
 * (pickAlert), then one email. Room first: the day's and the month's caps must hold this email plus every digest still
 * due this week (the digest takes priority); a refused cap stops the run. The send runs in one transaction that locks
 * the builder (pg_advisory_xact_lock), re-checks today's and this event's rows and writes the sent row, so two runs
 * never send twice and a failed send stores nothing. A 429 stops (`capped`); a 401 or 403 is the account (`stopped`);
 * MAX_SEND_FAILURES failures in a row stop. `deps.only`: builders (tests).
 */
export async function runAlertMail(
  now: Date,
  deps: { mail?: Mailer; events?: (builderId: number, now: Date) => Promise<AlertEvent[]>; only?: number[]; budgetMs?: number; force?: boolean } = {},
): Promise<{ sent: number; skipped: number; capped: boolean; stopped?: true }> {
  const out: { sent: number; skipped: number; capped: boolean; stopped?: true } = { sent: 0, skipped: 0, capped: false };
  const key = process.env.RESEND_API_KEY?.trim();
  const mail = deps.mail ?? (key ? resendMailer(key) : null);
  if (!mail || !process.env.EARNKIT_AUTH_SECRET) return out;
  if (!deps.force && now.getUTCHours() !== ALERT_HOUR_UTC) return out;
  const events = deps.events ?? alertEvents;
  const deadline = Date.now() + (deps.budgetMs ?? SEND_BUDGET_MS);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = digestFrom();
  const subs = await sql()<SubRow[]>`
    SELECT DISTINCT ON (b.builder_id) b.builder_id, b.installation_id, b.email
    FROM (SELECT COALESCE(i.builder_id, i.id) AS builder_id, d.installation_id, d.email, d.opted_in_at
          FROM digest_subscriptions d JOIN installations i ON i.id = d.installation_id
          WHERE d.opted_in_at IS NOT NULL AND d.unsubscribed_at IS NULL AND d.email IS NOT NULL AND d.login = ''
            AND NOT (i.shared_client AND i.x_user_id IS NULL)) b
    WHERE NOT EXISTS (SELECT 1 FROM alert_mail_sent a WHERE a.builder_id = b.builder_id AND a.sent_at >= ${today})
      ${deps.only ? sql()`AND b.builder_id = ANY(${deps.only}::int[])` : sql()``}
    ORDER BY b.builder_id, b.opted_in_at DESC
    LIMIT ${RUN_MAX}`;
  let failures = 0;
  for (const s of subs) {
    if (Date.now() >= deadline) break;
    const reserve = 1 + (await digestsDue(now));
    if (!(await freeTierRoom('resendDay', reserve, now)) || !(await freeTierRoom('resendMonth', reserve, now))) {
      out.capped = true;
      break;
    }
    const all = await events(s.builder_id, now).catch((err: unknown) => {
      console.error('[alert mail] events', err instanceof Error ? err.name : 'error');
      return [] as AlertEvent[];
    });
    if (all.length === 0) {
      out.skipped++;
      continue;
    }
    const sentKeys = new Set(
      (await sql()<{ event_key: string }[]>`SELECT event_key FROM alert_mail_sent WHERE builder_id = ${s.builder_id} AND event_key = ANY(${all.map((e) => e.key)}::text[])`).map((r) => r.event_key),
    );
    const pick = pickAlert(all.filter((e) => !sentKeys.has(e.key)));
    if (!pick) {
      out.skipped++;
      continue;
    }
    const step = await sql().begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('alert-mail'), ${s.builder_id})`;
      const [dup] = await tx`SELECT 1 FROM alert_mail_sent WHERE builder_id = ${s.builder_id} AND (sent_at >= ${today} OR event_key = ${pick.key})`;
      if (dup) return 'skip' as const;
      await tx`INSERT INTO alert_mail_sent (builder_id, event_key, sent_at) VALUES (${s.builder_id}, ${pick.key}, ${now})`;
      // Day first, as the digest: a refused month take then costs only a slot of a day that is over anyway.
      if (!(await takeFreeTier('resendDay', 1, now)) || !(await takeFreeTier('resendMonth', 1, now))) throw new Capped();
      const target = { installationId: s.installation_id, login: '' };
      const body = alertBody(pick);
      await mail({
        to: s.email,
        from,
        subject: body.subject,
        text: `${body.text}\n\n${alertFooter(unsubUrl(target))}`,
        headers: unsubHeaders(target),
        idempotencyKey: alertIdempotencyKey(s.builder_id, pick.key),
      });
      return 'sent' as const;
    }).catch((err: unknown) => {
      if (err instanceof Capped) return 'capped' as const;
      const status = err instanceof MailError ? err.status : 0;
      console.error('[alert mail] send', err instanceof MailError ? err.status : err instanceof Error ? err.name : 'error');
      if (status === 429) return 'capped' as const;
      if (status === 401 || status === 403) return 'config' as const;
      return 'failed' as const;
    });
    if (step === 'capped') {
      out.capped = true;
      break;
    }
    if (step === 'config') {
      out.skipped++;
      out.stopped = true;
      break;
    }
    if (step === 'sent') out.sent++;
    else out.skipped++;
    failures = step === 'failed' ? failures + 1 : step === 'sent' ? 0 : failures;
    if (failures >= MAX_SEND_FAILURES) {
      out.stopped = true;
      break;
    }
  }
  return out;
}

class Capped extends Error {}

/** The Monday digests still due this week (digest.ts sendDigests' rule), the room the alerts leave them. */
async function digestsDue(now: Date): Promise<number> {
  const start = weekStart(now);
  const [r] = await sql()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM digest_subscriptions
    WHERE opted_in_at IS NOT NULL AND opted_in_at < ${start} AND unsubscribed_at IS NULL
      AND (last_sent_at IS NULL OR last_sent_at < ${start}) AND (last_considered_at IS NULL OR last_considered_at < ${start})`;
  return r?.n ?? 0;
}
