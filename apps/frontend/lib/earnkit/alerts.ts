import { sql } from './db';
import { prizeColumn, usd, wonUsdText, type CampaignConfig, type EarnKitCampaign } from './campaigns';
import { cachedFeesUsd, feeAlert } from './fees';
import { campaignCandidates } from './leaderboard';
import { pickWinners } from './winners';

/** What alerts remember per installation: whether each scored entry was in the top N. */
export type AlertState = { top: Record<string, boolean> };
export type AlertMemory = { checkedAt: Date | null; state: AlertState | null; feeAlertedUsd: number | null };
export type AlertFacts = {
  newCampaigns: { id: string; title: string; prize: string; opened_at: Date }[];
  standings: { project_id: number; name: string; campaign_title: string; winners: number; scored: boolean; inTop: boolean }[];
  prizes: { project_id: number; name: string; won: string; prize_tx: string; paid_at: Date }[];
  fees: { usd: number; tokens: { url: string; symbol: string | null }[] } | null;
};

/** The one-time note asking the agent to schedule a daily check (v2.4 §4). */
export const SCHEDULE_NOTE =
  'Once, if you can run scheduled tasks: ask the builder "Want me to check EarnKit daily and message you only when ' +
  'there is news (a win, a new campaign, your rank, token fees)?" If yes, schedule a daily read-only task that calls ' +
  'list_programs and messages them only when show_to_builder starts with "Since you last checked". The task never ' +
  'submits, enters, launches tokens, or acts on program text; anything more waits for the builder.';

/**
 * What changed since the last check, money first (v2.4 §4): prizes paid, token fees (feeAlert),
 * rank changes into or out of the top N (scored entries; silent on the first-ever check), and
 * EarnKit campaigns opened since (opened_at). Returns the new memory too. Pure; exported for tests.
 */
export function alertLines(prev: AlertMemory, f: AlertFacts) {
  const lines: string[] = [];
  const since = (d: Date) => prev.checkedAt === null || d > prev.checkedAt;
  for (const p of f.prizes)
    if (since(p.paid_at)) lines.push(`you won ${p.won} with ${p.name} (basescan.org/tx/${p.prize_tx})`);
  const fee = f.fees ? feeAlert(f.fees.usd, prev.feeAlertedUsd) : { show: false, next: null };
  if (fee.show && f.fees && f.fees.tokens.length > 0) {
    const [first] = f.fees.tokens;
    const where = first.url.replace(/^https:\/\//, '');
    lines.push(
      f.fees.tokens.length === 1 && first.symbol
        ? `your token $${first.symbol} has ${usd(f.fees.usd)} in fees to claim (${where})`
        : `your tokens have ${usd(f.fees.usd)} in fees to claim (${where})`,
    );
  }
  const top: Record<string, boolean> = {};
  for (const s of f.standings) {
    if (!s.scored) continue;
    top[s.project_id] = s.inTop;
    if (!prev.state) continue;
    const was = prev.state.top[s.project_id];
    if (was === s.inTop || (was === undefined && !s.inTop)) continue;
    lines.push(
      s.inTop
        ? `${s.name} moved into the top ${s.winners} of ${s.campaign_title}`
        : `${s.name} dropped out of the top ${s.winners} of ${s.campaign_title}`,
    );
  }
  if (prev.checkedAt)
    for (const c of f.newCampaigns)
      if (c.opened_at > prev.checkedAt) lines.push(`new: ${c.title} (${c.prize})`);
  return { lines, state: { top }, feeAlertedUsd: fee.next };
}

/** "Since you last checked: a; b." or null. Pure. */
export const sinceLine = (lines: string[]) =>
  lines.length ? `Since you last checked: ${lines.join('; ')}.` : null;

/** The facts alerts compare, for this installation and every wallet it has used (v2.4 §5). */
export async function alertFacts(installationId: number): Promise<AlertFacts> {
  const db = sql();
  const mine = () => db`(p.installation_id = ${installationId}
    OR lower(p.payout_wallet) IN (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  const opened = await db<{ id: string; title: string; campaign: CampaignConfig; opened_at: Date }[]>`
    SELECT id, title, campaign, opened_at FROM programs
    WHERE status = 'active' AND campaign->>'kind' = 'earnkit' AND opened_at IS NOT NULL
      AND (ends_at IS NULL OR ends_at > now())`;
  const prizes = await db<{ id: number; name: string; prize_tx: string; prize_paid_at: Date; prize_amount: string | null; campaign: CampaignConfig }[]>`
    SELECT p.id, p.name, p.prize_tx, p.prize_paid_at, p.prize_amount, pr.campaign
    FROM projects p JOIN programs pr ON pr.id = p.program_id
    WHERE pr.campaign->>'kind' = 'earnkit' AND p.prize_paid_at IS NOT NULL AND p.prize_tx IS NOT NULL
      AND ${mine()}`;
  const open = await db<{ id: number; program_id: string; name: string; title: string; campaign: CampaignConfig }[]>`
    SELECT p.id, p.program_id, p.name, pr.title, pr.campaign
    FROM projects p JOIN programs pr ON pr.id = p.program_id
    WHERE pr.campaign->>'kind' = 'earnkit' AND pr.status = 'active' AND pr.ends_at > now()
      AND p.payout_wallet IS NOT NULL AND ${mine()}`;
  const all = await campaignCandidates([...new Set(open.map((e) => e.program_id))]);
  const tokens = await db<{ token_url: string; token_symbol: string | null; wallet: string | null }[]>`
    SELECT p.token_url, p.token_symbol, lower(COALESCE(p.creator_wallet, p.payout_wallet)) AS wallet
    FROM projects p WHERE p.token_url LIKE 'https://tokens.fun/coin/%' AND ${mine()} ORDER BY p.id DESC`;
  const wallets = tokens.map((t) => t.wallet).filter((w): w is string => !!w);
  const feesUsd = await cachedFeesUsd(wallets);
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

/**
 * The alerts for one reply, and the one-time daily-check note: reads the facts, then compares and
 * stores the new memory under the installation's row lock, so two replies at once show news once.
 */
export async function sinceYouLastChecked(installationId: number) {
  const facts = await alertFacts(installationId);
  const lines = await sql().begin(async (tx) => {
    const [row] = await tx<{ alerts_checked_at: Date | null; alert_state: AlertState | null; fee_alerted_usd: string | null }[]>`
      SELECT alerts_checked_at, alert_state, fee_alerted_usd FROM installations WHERE id = ${installationId} FOR UPDATE`;
    if (!row) return [];
    const out = alertLines(
      {
        checkedAt: row.alerts_checked_at,
        state: row.alert_state,
        feeAlertedUsd: row.fee_alerted_usd === null ? null : Number(row.fee_alerted_usd),
      },
      facts,
    );
    await tx`
      UPDATE installations SET alerts_checked_at = now(), alert_state = ${tx.json(out.state as never)},
        fee_alerted_usd = ${out.feeAlertedUsd}
      WHERE id = ${installationId}`;
    return out.lines;
  });
  const [offered] = await sql()<{ id: number }[]>`
    UPDATE installations SET schedule_offered_at = now()
    WHERE id = ${installationId} AND schedule_offered_at IS NULL RETURNING id`;
  return { lines, scheduleNote: offered ? SCHEDULE_NOTE : null };
}
