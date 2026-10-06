import { getAddress } from 'viem';
import { sql, type Db } from './db';
import { prizeColumn, usd, wonUsdText, type CampaignConfig, type EarnKitCampaign } from './campaigns';
import { boardLink, shortWallet } from './entry-text';
import { cachedFeesUsd, feeAlert } from './fees';
import { campaignCandidates } from './leaderboard';
import { eth } from './present';
import { eligibleSql } from './traction';
import { pickWinners } from './winners';

/** The checksummed form (M2, fix round 1): `bonus_payouts.wallet` is stored lowercase; a builder
 * confirmed the checksummed form on the coin's wallet line, so the alert should match it. Falls
 * back to the raw value on anything that isn't a valid address (defensive; never throws). */
const checksummed = (w: string) => {
  try {
    return getAddress(w);
  } catch {
    return w;
  }
};

/**
 * What alerts remember per installation: whether each scored entry was in the top N, and the ids
 * already announced (campaigns, prize-winning projects). Ids, not time, decide what is news, so
 * nothing paid or opened around a check is lost. Older rows may lack the id lists.
 * `bonusTop`/`bonusWins` (v2.5 §3): the builder bonus's own rank-tracking and seen-win ids, kept
 * apart from the EarnKit/sponsor campaign ones (`top`/`prizes`) since a project can be in both.
 */
export type AlertState = {
  top: Record<string, boolean>;
  campaigns?: string[];
  prizes?: number[];
  bonusTop?: Record<string, boolean>;
  /** Seen builder bonus wins by bonus_payouts.id (M2: one entry can win several rounds). */
  bonusWins?: number[];
};
export type AlertMemory = { checkedAt: Date | null; state: AlertState | null; feeAlertedUsd: number | null };

/**
 * A builder bonus round payout, already paid (v2.5 §3). THE SEAM: Task 7 ("Round lifecycle and
 * WETH payouts") pays round winners and must record each one somewhere queryable by project. Until
 * then, `paidBonusWins` (below) finds nothing, so this list is always empty and the alert it feeds
 * never fires — nothing here needs to change once Task 7 lands, only `paidBonusWins`'s query.
 */
export type BonusWin = {
  /** bonus_payouts.id: one per round win, so a second round's win of the same entry is news too (M2). */
  id: number;
  project_id: number;
  name: string;
  program_title: string;
  amount_wei: bigint;
  tx_hash: string;
  paid_at: Date;
  /** bonus_payouts.wallet: the entry's creator_wallet at payout time (Ruling 14), for the alert line (v2.6 §3). */
  wallet: string | null;
  /** The round this win was paid for, for its leaderboard link (v2.6 §3, Ruling 12 (plan)). */
  round_key: string;
};
/** Where an eligible entry stands in its open builder bonus round right now (v2.5 §3, from bonus_scores). */
export type BonusStanding = {
  project_id: number;
  program_title: string;
  inTop: boolean;
  /** The open round, for its leaderboard link (v2.6 §3, Ruling 12 (plan)). */
  round_key: string;
};
export type AlertFacts = {
  newCampaigns: { id: string; title: string; prize: string; opened_at: Date }[];
  standings: { project_id: number; name: string; campaign_title: string; winners: number; scored: boolean; inTop: boolean }[];
  prizes: { project_id: number; name: string; won: string; prize_tx: string; paid_at: Date }[];
  fees: { usd: number; tokens: { url: string; symbol: string | null }[] } | null;
  bonusWins: BonusWin[];
  bonusStandings: BonusStanding[];
};

/** At most this many prize lines per check (a wallet added later may bring several old wins). */
export const MAX_PRIZE_LINES = 3;
/** At most this many builder bonus win lines per check, same reasoning as MAX_PRIZE_LINES. */
export const MAX_BONUS_WIN_LINES = 3;
/** The payout split (bonus-payout.ts, Task 7) pays this many places; a rank at or under this is "in the top". */
export const BONUS_TOP_N = 10;
/** Each read-only facts query must finish within this (statement_timeout), or the reply goes out without alerts. */
export const FACTS_BUDGET_MS = 1_500;

/** The one-time note asking the agent to schedule a daily check (v2.4 §4); list_programs only. */
export const SCHEDULE_NOTE =
  'Once, if you can run scheduled tasks: ask the builder "Want me to check EarnKit daily and message you only when ' +
  'there is news (a win, a new campaign, your rank)?" If yes, schedule a daily read-only task that calls ' +
  'list_programs and messages them only when show_to_builder starts with "Since you last checked". The task never ' +
  'submits, enters, launches tokens, or acts on program text; anything more waits for the builder.';

/**
 * What changed since the last check, money first (v2.4 §4; v2.5 §3 adds the builder bonus, kept
 * in the same wins-first order, Ruling 26): prizes not yet announced (the 3 most recent; the rest
 * wait for the next check), then builder bonus wins (same reasoning, its own cap), then
 * `otherWins` (sponsor wins, already worded), token fees (feeAlert), rank changes into or out of
 * the top N (scored campaign entries, then the builder bonus top 10), and EarnKit campaigns not
 * yet announced. The first-ever check (no checkedAt) is quiet for ranks and campaigns; it still
 * shows prizes and bonus wins. Returns the new memory too. Pure; exported for tests.
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
  // v2.5 §3: builder bonus wins are wins too (Ruling 26, wins first), right after EarnKit prizes
  // and before otherWins (sponsor wins) and anything else. Empty until Task 7 pays a round.
  const seenBonusWins = new Set(prev.state?.bonusWins ?? []);
  const freshBonus = f.bonusWins
    .filter((w) => !seenBonusWins.has(w.id))
    .sort((a, b) => b.paid_at.getTime() - a.paid_at.getTime());
  const shownBonus = freshBonus.slice(0, MAX_BONUS_WIN_LINES);
  // v2.6 §3 fix round 1 (Ruling 25 supersedes P1's literal wording; I1): a natural clause, money
  // first, naming the program and (M1) the transaction, same pattern as the EarnKit prize line above.
  for (const w of shownBonus)
    lines.push(
      `you were paid a ${eth(w.amount_wei)} ETH builder bonus (as WETH) for ${w.program_title}` +
        `${w.wallet ? `, sent to ${shortWallet(checksummed(w.wallet))}` : ''} (basescan.org/tx/${w.tx_hash}) · ${boardLink(w.round_key)}`,
    );
  lines.push(...otherWins);
  const fee = f.fees ? feeAlert(f.fees.usd, prev.feeAlertedUsd) : { show: false, next: null };
  // v2.6 §3 fix round 1 (I1): a clause, not a form label; "coin fees" (not "fees to claim") keeps
  // the colon count in the joined sentence down to one, after "checked".
  if (fee.show && f.fees && f.fees.tokens.length > 0) lines.push(`you have ${usd(f.fees.usd)} in coin fees to claim on tokens.fun`);
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
  // v2.5 §3: the same rank-change tracking, for the builder bonus's own top 10 (bonus_scores'
  // rank, not the campaign leaderboard). Kept apart from `top` (bonusTop) since a project can be
  // in both at once.
  const bonusTop: Record<string, boolean> = {};
  for (const s of f.bonusStandings) {
    bonusTop[s.project_id] = s.inTop;
    if (first || !prev.state) continue;
    const was = prev.state.bonusTop?.[s.project_id];
    if (was === s.inTop || (was === undefined && !s.inTop)) continue;
    lines.push(
      (s.inTop
        ? `your entry moved into the top ${BONUS_TOP_N} for the builder bonus (${s.program_title})`
        : `your entry dropped out of the top ${BONUS_TOP_N} for the builder bonus (${s.program_title})`) +
        ` · ${boardLink(s.round_key)}`,
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
    bonusTop,
    // Open campaigns only: closed ones drop out of the facts, and out of the list.
    campaigns: f.newCampaigns.map((c) => c.id),
    // Prizes over the cap stay unseen: they show on the next check.
    prizes: [...new Set([...seenPrizes, ...shown.map((p) => p.project_id)])],
    bonusWins: [...new Set([...seenBonusWins, ...shownBonus.map((w) => w.id)])],
  };
  return { lines, state, feeAlertedUsd: fee.next };
}

/** "Since you last checked: a; b." or null. Pure. */
export const sinceLine = (lines: string[]) =>
  lines.length ? `Since you last checked: ${lines.join('; ')}.` : null;

/** Whether bonus_payouts was seen to exist (memoized: a migrated table never goes away). */
let bonusPayoutsExists = false;

/**
 * THE SEAM for Task 7 ("Round lifecycle and WETH payouts", `bonus-payout.ts`): the builder bonus
 * round payouts already paid, for this installation's own entries and every wallet it has used
 * (v2.4 §5) — a bonus round pays the entry's `creator_wallet` (Ruling 14), so that is the wallet
 * checked here, not `payout_wallet`. Expected shape, once Task 7 lands: a `bonus_payouts` table
 * `(round_key text, project_id integer, rank integer, amount_wei numeric, tx_hash text, paid_at
 * timestamptz)`, one row per paid winner. Until that table exists, this checks for it first (an
 * `information_schema` read, never a failing query: this runs inside sinceYouLastChecked's
 * transaction, where an error would abort every other read in the same check) and returns []. Add
 * the table with that shape and this starts returning real rows with no change needed in
 * alertFacts or alertLines. Exported so a test can inject rows (into a temporary table built to
 * this same contract) without waiting on Task 7.
 */
export async function paidBonusWins(installationId: number, db: Db = sql()): Promise<BonusWin[]> {
  // M15: the table exists for good once migrated, so the check runs until it first finds it.
  if (!bonusPayoutsExists) {
    const [{ exists }] = await db<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bonus_payouts') AS exists`;
    if (!exists) return [];
    bonusPayoutsExists = true;
  }
  const rows = await db<
    {
      id: number;
      project_id: number;
      name: string;
      program_title: string;
      amount_wei: string;
      tx_hash: string;
      paid_at: Date;
      wallet: string | null;
      round_key: string;
    }[]
  >`
    SELECT bp.id, bp.project_id, p.name, pr.title AS program_title, bp.amount_wei::text AS amount_wei, bp.tx_hash, bp.paid_at,
      bp.wallet, bp.round_key
    FROM bonus_payouts bp
    JOIN projects p ON p.id = bp.project_id
    JOIN programs pr ON pr.id = p.program_id
    WHERE bp.paid_at IS NOT NULL AND bp.tx_hash IS NOT NULL
      AND (p.installation_id = ${installationId}
        OR lower(COALESCE(p.creator_wallet, p.payout_wallet)) IN
          (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  return rows.map((r) => ({ ...r, amount_wei: BigInt(r.amount_wei) }));
}

/**
 * The facts alerts compare, for this installation and every wallet it has used (v2.4 §5). Runs on
 * `db`: sinceYouLastChecked passes its transaction, so a check uses one connection (pipelined).
 */
export async function alertFacts(installationId: number, db: Db = sql()): Promise<AlertFacts> {
  const mine = () => db`(p.installation_id = ${installationId}
    OR lower(p.payout_wallet) IN (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  // v2.5 §3: a builder bonus entry is matched by creator_wallet too (payout_wallet is a campaign
  // field; Ruling 13a never sets it for external entries).
  const mineBonus = () => db`(p.installation_id = ${installationId}
    OR lower(COALESCE(p.creator_wallet, p.payout_wallet)) IN
      (SELECT wallet FROM installation_wallets WHERE installation_id = ${installationId}))`;
  const [opened, prizes, open, tokens, bonusRank, bonusWins] = await Promise.all([
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
    // v2.5 §3: this entry's latest rank in its builder bonus round, while that round is open.
    db<{ project_id: number; program_title: string; rank: number; round_key: string }[]>`
      SELECT DISTINCT ON (bs.project_id) bs.project_id, pr.title AS program_title, bs.rank, bs.round_key
      FROM bonus_scores bs
      JOIN bonus_rounds r ON r.round_key = bs.round_key AND r.state = 'open'
      JOIN projects p ON p.id = bs.project_id
      JOIN programs pr ON pr.id = p.program_id
      WHERE bs.rank IS NOT NULL AND ${mineBonus()}
        -- Final review M3: only an entry that is eligible now (never an owner test installation's,
        -- which eligibleSql excludes): a stale rank never alerts.
        AND ${eligibleSql(db`r.ends_at`)}
      ORDER BY bs.project_id, bs.day DESC`,
    paidBonusWins(installationId, db),
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
    bonusWins,
    bonusStandings: bonusRank.map((r) => ({
      project_id: r.project_id,
      program_title: r.program_title,
      round_key: r.round_key,
      inTop: r.rank <= BONUS_TOP_N,
    })),
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
