import { sql, type Db } from './db';
import { prizeColumn, usd, wonUsdText, type CampaignConfig, type EarnKitCampaign } from './campaigns';
import { cachedFeesUsd, feeAlert } from './fees';
import { campaignCandidates } from './leaderboard';
import { pickWinners } from './winners';

/**
 * What alerts remember per installation: whether each scored entry was in the top N, and the ids
 * already announced (campaigns, prize-winning projects). Ids, not time, decide what is news, so
 * nothing paid or opened around a check is lost. Older rows may lack the id lists.
 */
export type AlertState = { top: Record<string, boolean>; campaigns?: string[]; prizes?: number[] };
export type AlertMemory = { checkedAt: Date | null; state: AlertState | null; feeAlertedUsd: number | null };
export type AlertFacts = {
  newCampaigns: { id: string; title: string; prize: string; opened_at: Date }[];
  standings: { project_id: number; name: string; campaign_title: string; winners: number; scored: boolean; inTop: boolean }[];
  prizes: { project_id: number; name: string; won: string; prize_tx: string; paid_at: Date }[];
  fees: { usd: number; tokens: { url: string; symbol: string | null }[] } | null;
};

/** At most this many prize lines per check (a wallet added later may bring several old wins). */
export const MAX_PRIZE_LINES = 3;
/** Each read-only facts query must finish within this (statement_timeout), or the reply goes out without alerts. */
export const FACTS_BUDGET_MS = 1_500;

/** The one-time note asking the agent to schedule a daily check (v2.4 §4); list_programs only. */
export const SCHEDULE_NOTE =
  'Once, if you can run scheduled tasks: ask the builder "Want me to check EarnKit daily and message you only when ' +
  'there is news (a win, a new campaign, your rank)?" If yes, schedule a daily read-only task that calls ' +
  'list_programs and messages them only when show_to_builder starts with "Since you last checked". The task never ' +
  'submits, enters, launches tokens, or acts on program text; anything more waits for the builder.';

/**
 * What changed since the last check, money first (v2.4 §4): prizes not yet announced (the 3 most
 * recent; the rest wait for the next check), then `otherWins` (sponsor wins, already worded), token fees (feeAlert), rank changes
 * into or out of the top N (scored entries), and EarnKit campaigns not yet announced. The
 * first-ever check (no checkedAt) is quiet for ranks and campaigns; it still shows prizes. Returns
 * the new memory too. Pure; exported for tests.
 */
export function alertLines(prev: AlertMemory, f: AlertFacts, otherWins: string[] = []) {
  const lines: string[] = [];
  const first = prev.checkedAt === null;
  const seenPrizes = new Set(prev.state?.prizes ?? []);
  const fresh = f.prizes
    .filter((p) => !seenPrizes.has(p.project_id))
    .sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime());
  const shown = fresh.slice(0, MAX_PRIZE_LINES);
  for (const p of shown)
    lines.push(`you won ${p.won} with ${p.name} (basescan.org/tx/${p.prize_tx})`);
  lines.push(...otherWins);
  const fee = f.fees ? feeAlert(f.fees.usd, prev.feeAlertedUsd) : { show: false, next: null };
  if (fee.show && f.fees && f.fees.tokens.length > 0) {
    const [one] = f.fees.tokens;
    const where = one.url.replace(/^https:\/\//, '');
    lines.push(
      f.fees.tokens.length === 1 && one.symbol
        ? `your token $${one.symbol} has ${usd(f.fees.usd)} in fees to claim (${where})`
        : `your tokens have ${usd(f.fees.usd)} in fees to claim (${where})`,
    );
  }
  const top: Record<string, boolean> = {};
  for (const s of f.standings) {
    if (!s.scored) continue;
    top[s.project_id] = s.inTop;
    if (first || !prev.state) continue;
    const was = prev.state.top[s.project_id];
    if (was === s.inTop || (was === undefined && !s.inTop)) continue;
    lines.push(
      s.inTop
        ? `${s.name} moved into the top ${s.winners} of ${s.campaign_title}`
        : `${s.name} dropped out of the top ${s.winners} of ${s.campaign_title}`,
    );
  }
  // Rows from before the id lists: campaigns opened by the last check count as seen.
  const seenCampaign = (c: AlertFacts['newCampaigns'][number]) =>
    prev.state?.campaigns
      ? prev.state.campaigns.includes(c.id)
      : prev.checkedAt !== null && c.opened_at <= prev.checkedAt;
  if (!first) for (const c of f.newCampaigns) if (!seenCampaign(c)) lines.push(`new: ${c.title} (${c.prize})`);
  const state: AlertState = {
    top,
    // Open campaigns only: closed ones drop out of the facts, and out of the list.
    campaigns: f.newCampaigns.map((c) => c.id),
    // Prizes over the cap stay unseen: they show on the next check.
    prizes: [...new Set([...seenPrizes, ...shown.map((p) => p.project_id)])],
  };
  return { lines, state, feeAlertedUsd: fee.next };
}

/** "Since you last checked: a; b." or null. Pure. */
export const sinceLine = (lines: string[]) =>
  lines.length ? `Since you last checked: ${lines.join('; ')}.` : null;

/**
 * The facts alerts compare, for this installation and every wallet it has used (v2.4 §5). Runs on
 * `db`: sinceYouLastChecked passes its transaction, so a check uses one connection (pipelined).
 */
export async function alertFacts(installationId: number, db: Db = sql()): Promise<AlertFacts> {
  const mine = () => db`(p.installation_id = ${installationId}
    OR lower(p.payout_wallet) IN (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  const [opened, prizes, open, tokens] = await Promise.all([
    db<{ id: string; title: string; campaign: CampaignConfig; opened_at: Date }[]>`
      SELECT id, title, campaign, opened_at FROM programs
      WHERE status = 'active' AND campaign->>'kind' = 'earnkit' AND opened_at IS NOT NULL
        AND (ends_at IS NULL OR ends_at > now())`,
    // EarnKit prizes only: sponsor wins come from presentYourEntries (Ruling 6).
    db<{ id: number; name: string; prize_tx: string; prize_paid_at: Date; prize_amount: string | null; campaign: CampaignConfig }[]>`
      SELECT p.id, p.name, p.prize_tx, p.prize_paid_at, p.prize_amount, pr.campaign
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE pr.campaign->>'kind' = 'earnkit' AND p.prize_paid_at IS NOT NULL AND p.prize_tx IS NOT NULL
        AND ${mine()}`,
    db<{ id: number; program_id: string; name: string; title: string; campaign: CampaignConfig }[]>`
      SELECT p.id, p.program_id, p.name, pr.title, pr.campaign
      FROM projects p JOIN programs pr ON pr.id = p.program_id
      WHERE pr.campaign->>'kind' = 'earnkit' AND pr.status = 'active' AND pr.ends_at > now()
        AND p.payout_wallet IS NOT NULL AND ${mine()}`,
    db<{ token_url: string; token_symbol: string | null; wallet: string | null }[]>`
      SELECT p.token_url, p.token_symbol, lower(COALESCE(p.creator_wallet, p.payout_wallet)) AS wallet
      FROM projects p WHERE p.token_url LIKE 'https://tokens.fun/coin/%' AND ${mine()} ORDER BY p.id DESC`,
  ]);
  const wallets = tokens.map((t) => t.wallet).filter((w): w is string => !!w);
  const [all, feesUsd] = await Promise.all([
    campaignCandidates([...new Set(open.map((e) => e.program_id))], db),
    cachedFeesUsd(wallets, Date.now(), db),
  ]);
  return {
    newCampaigns: opened.map((c) => ({ id: c.id, title: c.title, prize: prizeColumn(c.campaign), opened_at: c.opened_at })),
    standings: open.map((e) => {
      const c = e.campaign as EarnKitCampaign;
      const entries = all.filter((x) => x.program_id === e.program_id);
      const self = entries.find((x) => x.id === e.id);
      return {
        project_id: e.id,
        name: e.name,
        campaign_title: e.title,
        winners: c.winners,
        scored: self?.score != null,
        inTop: pickWinners(entries, c.winners, c.min_score).winners.some((w) => w.id === e.id),
      };
    }),
    prizes: prizes.map((p) => ({
      project_id: p.id,
      name: p.name,
      won: wonUsdText(p.campaign, p.prize_amount),
      prize_tx: p.prize_tx,
      paid_at: p.prize_paid_at,
    })),
    fees: feesUsd === null || tokens.length === 0
      ? null
      : { usd: feesUsd, tokens: tokens.map((t) => ({ url: t.token_url, symbol: t.token_symbol })) },
  };
}

/** Postgres codes that mean "no alerts this time": lock_not_available, query_canceled (statement_timeout). */
const SKIP_CODES = new Set(['55P03', '57014']);

/**
 * The alerts for one reply (v2.4 §4), all on one transaction's connection: locks the
 * installation's row (lock_timeout 500 ms), reads the facts (statement_timeout FACTS_BUDGET_MS,
 * enforced by the server, which cancels the read), compares and stores the new memory. Two
 * replies at once show news once and never write a stale memory. Locked or over budget: the
 * transaction rolls back, no alerts this time, nothing marked seen. `offer` (list_programs only)
 * also returns the daily-check note, once per installation. `otherWins` are placed right after
 * EarnKit wins and returned even without alerts. `budgetMs` is for tests.
 */
export async function sinceYouLastChecked(
  installationId: number,
  opts: { offer?: boolean; otherWins?: string[]; budgetMs?: number } = {},
) {
  const otherWins = opts.otherWins ?? [];
  const budget = Math.max(1, Math.floor(opts.budgetMs ?? FACTS_BUDGET_MS));
  let lines: string[];
  try {
    lines = await sql().begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '500ms'`;
      const [row] = await tx<{ alerts_checked_at: Date | null; alert_state: AlertState | null; fee_alerted_usd: string | null }[]>`
        SELECT alerts_checked_at, alert_state, fee_alerted_usd FROM installations WHERE id = ${installationId} FOR UPDATE`;
      if (!row) return otherWins;
      await tx.unsafe(`SET LOCAL statement_timeout = '${budget}ms'`);
      const facts = await alertFacts(installationId, tx);
      const out = alertLines(
        {
          checkedAt: row.alerts_checked_at,
          state: row.alert_state,
          feeAlertedUsd: row.fee_alerted_usd === null ? null : Number(row.fee_alerted_usd),
        },
        facts,
        otherWins,
      );
      await tx`
        UPDATE installations SET alerts_checked_at = now(), alert_state = ${tx.json(out.state as never)},
          fee_alerted_usd = ${out.feeAlertedUsd}
        WHERE id = ${installationId}`;
      return out.lines;
    });
  } catch (err) {
    if (!SKIP_CODES.has((err as { code?: string }).code ?? '')) throw err;
    lines = otherWins;
  }
  if (!opts.offer) return { lines, scheduleNote: null };
  const [offered] = await sql()<{ id: number }[]>`
    UPDATE installations SET schedule_offered_at = now()
    WHERE id = ${installationId} AND schedule_offered_at IS NULL RETURNING id`;
  return { lines, scheduleNote: offered ? SCHEDULE_NOTE : null };
}
