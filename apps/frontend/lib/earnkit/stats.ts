import { sql, type Db } from './db';
import { freshSql } from './api-stale';
import { testBuilderSql, testInstallationIds } from './installations';
import { FEE_SPLIT_BPS } from './policy';
import { openCurated, openGrantsText, openMoneyUsd } from './pool';
import { PRICE_WAIT_MS, cachedWethUsd, creatorWalletSql, wethToUsd } from './fees';

/**
 * Public stats (v2.5 §4) for jenil.ai: /api/stats, cached 10 min. Database aggregates only: no
 * wallet, repo, installation or entry is ever named. v2.6 Ruling 6/16 (plan): owner test
 * installations (EARNKIT_TEST_INSTALLATIONS) are excluded from `installs`, `coins_launched` and
 * the bonus deposits behind `fees_to_safe_eth`.
 */
export const STATS_KEYS = [
  'open_money_usd',
  'open_money_text',
  'programs_open',
  'bonus_programs_open',
  'coins_launched',
  'tokens_declined',
  'fees_to_safe_eth',
  'bonus_paid_eth',
  'bonus_pools_eth',
  'installs',
  'installs_used',
  'builders',
  'activated',
  'weekly_active',
  'shared',
  'posts_drafted',
  'posts_tapped',
  'backers_after_post',
  'labelled_entries',
  'entries_won',
  'builders_won_usd',
  'applications',
  'accepted',
  'backing_open',
  'backers',
  'earned_usd',
] as const;

/**
 * v2.8 Part G, Ruling 30 (plan): the public win-rate claim ("X% of EarnKit entries win") is withheld
 * until at least this many entries have a published result, and a baseline exists. Documentation
 * only: no code path makes the claim. `labelled_entries` and `entries_won` are the raw counts.
 */
export const WIN_RATE_MIN_LABELLED = 30;

/** Every stat but `open_money_text` is a number. */
export type StatsNumberKey = Exclude<(typeof STATS_KEYS)[number], 'open_money_text'>;
/**
 * v2.9 F21: `open_money_usd` is the one money figure (openMoneyUsd: the top prize of every open
 * curated program, summed; v3 Stage 2: never an investment) and `open_money_text` the text every page
 * shows for it ("$115K in grants and prizes open", null when nothing is open). v4.7.1 T2: the old `open_pools_usd`/`open_pools_plus` (the v2.7.1 source-stated pool total
 * and its "+") and `points_total` are no longer in the stats.
 */
export type PublicStats = Record<StatsNumberKey, number> & { open_money_text: string | null };

/** v2.9 F21: the one money figure; implemented in pool.ts (present.ts can't import this file). */
export { moneyText, openGrantsText, openMoneyUsd, openMoneyWords, type OpenMoneyRow } from './pool';

/**
 * How jenil.ai should label each stat (T9 note): `fees_to_safe_eth` counts only coins launched
 * with the v2.5 split, from the start of the bonus index, so it is never "all Safe revenue".
 * v2.13.2 (2): it also counts v2.13's 3-slot coins (statsFrom); the key, its
 * type and this label are unchanged (still EarnKit coins only, never all Safe revenue).
 */
export const STATS_LABELS: Record<(typeof STATS_KEYS)[number], string> = {
  open_money_usd: 'open money: top prize per open program (USD)',
  open_money_text: 'open money, as shown',
  programs_open: 'programs open',
  bonus_programs_open: 'programs with a builder bonus',
  coins_launched: 'tokens launched',
  // v4.2 F18: builder tokens (builder_tokens) count in coins_launched; a no is shown, not hidden.
  tokens_declined: 'builders who said no to their token',
  // v2.13.2 fix 1: the stat covers both fee splits (statsFrom).
  fees_to_safe_eth: 'fees to the EarnKit Safe (ETH)',
  bonus_paid_eth: 'builder bonus paid (ETH)',
  bonus_pools_eth: 'builder bonus pools open (ETH)',
  installs: 'installs',
  installs_used: 'installs that asked what they can earn (find at least once)',
  builders: 'builders (one person\'s reinstalls and agents counted once)',
  activated: 'activated builders (claimed page, repo proven by the EarnKit app, a week approved at the weekly moment)',
  weekly_active: 'activated builders who approved a week in the last 7 days',
  shared: 'weeks confirmed at the weekly share offer',
  // v3.1 one-tap posts (design 5): drafted, tapped, then backers (correlation only, never a cause). Final review 4: page
  // opens from X are not public (anyone can inflate them); they stay on post_drafts for the owner.
  posts_drafted: 'posts for X EarnKit drafted (one-tap posts)',
  posts_tapped: 'of those, opened in X\'s composer from the reply\'s link at least once',
  backers_after_post: 'retired with the per-project offers (always 0)',
  labelled_entries: 'entries with a published result',
  entries_won: 'entries that won',
  builders_won_usd: 'won by EarnKit builders (announced, USD)',
  applications: 'applications the builder told EarnKit about',
  accepted: 'of which accepted or funded (self-reported)',
  backing_open: 'retired with the per-project offers (always 0)',
  backers: 'retired with the per-project offers (always 0)',
  earned_usd: 'earned by EarnKit builders: creator fees claimed plus announced prizes (USD)',
};

/** v2.9 E20: the won line lives in pool.ts (no imports, so present.ts can use it without a cycle). */
export { wonLine } from './pool';

/** Wei to ETH as a number, 6 decimals, rounded down. Pure. */
export const weiToEth = (wei: bigint) => Number(wei / 10n ** 12n) / 1e6;

/** v2.9 F21: an active program as readStats reads it (json, so dates are strings). */
type OpenRow = {
  max_award_usd: string | number | null;
  /** v3 Stage 2: an investment is never counted (openMoneyUsd). */
  investment?: boolean | null;
  status: string;
  campaign: unknown;
  source: string;
  starts_at: string | null;
  ends_at: string | null;
};

type Row = {
  open_rows: OpenRow[] | null;
  programs_open: number;
  bonus_programs_open: number;
  coins_launched: number;
  tokens_declined: number;
  bonus_deposits_wei: string | null;
  /** v2.13.2 (2): of bonus_deposits_wei, the deposits whose transaction has no indexed Safe deposit of the same coin (safe_fees). */
  bonus_unmatched_wei?: string | null;
  /** v2.13.2 (2): the Safe's own indexed FeeLocker deposits from EarnKit coins, both splits (safe_fees). */
  safe_fees_wei?: string | null;
  bonus_to_safe_wei: string | null;
  bonus_paid_wei: string | null;
  bonus_pools_wei: string | null;
  installs: number;
  /** Pre-launch 2026-10-19: installations that called find at least once (programs_checked_at set). */
  installs_used?: number;
  /** Pre-launch 2026-10-19: distinct builder groups (COALESCE(builder_id, id)): a linked reinstall counts once. */
  builders?: number;
  /** Launch-ready L9: claimed people with an App-proven repo and at least one approved week (the weekly moment, L6). */
  activated?: number;
  /** Launch-ready L9: activated people who approved a week in the last 7 days. */
  weekly_active?: number;
  /** Launch-ready L9: weeks approved from the weekly moment's share offer. */
  shared?: number;
  /** v3.1 one-tap posts: post_drafts rows, tapped ones, and backers within 7 days of a first tap. */
  posts_drafted?: number;
  posts_tapped?: number;
  backers_after_post?: number;
  labelled_entries: number;
  entries_won: number;
  builders_won_usd: string | null;
  /** v3 Stage 2: distinct (person, program) applications the builder told EarnKit about (builder_program_status). */
  applications?: number;
  /** v3 Stage 2: of those, accepted or funded (self-reported). */
  accepted?: number;
  /** v3 Stage 2: WETH claimed to the creator wallets of non-test coins (creator_fees). */
  creator_fees_wei?: string | null;
  /** v3 Stage 2: the WETH price earned_usd values creator_fees_wei at (fees.ts cachedWethUsd); null: unknown. */
  weth_usd?: number | null;
};

/**
 * The public shape from the aggregate row. `fees_to_safe_eth` is the Safe's fees from coins with
 * the v2.5 split only (coins launched before it have no builder bonus slot and count 0), accrued
 * rather than claimed (unclaimed FeeLocker balances included), from the start of the bonus
 * ledger's index: every real FeeLocker deposit for the bonus wallet (its 20% slot) comes with the
 * Safe's own 30% slot from the same fees, so that part is 1.5x the indexed bonus deposits of
 * EarnKit coins (M5: never a deposit from a coin EarnKit didn't launch); plus
 * the builder bonus money routed to the Safe (after a program ends, programs without public
 * submissions, empty rounds, a paid round's unclaimed places). It is not all-time Safe revenue.
 * v2.13.2 (2): the Safe's actual share of both splits. The Safe's own indexed
 * deposits from EarnKit coins (`safe_fees`: v2.5 coins' 30%, v2.13 coins' 50%, from the Safe index's
 * start), plus 1.5x only the bonus deposits whose transaction has no indexed Safe deposit of that coin
 * (so a v2.5 coin's Safe share counts once, indexed or estimated, never both), plus the bonus money
 * routed to the Safe as before. Pure.
 */
export function statsFrom(r: Row, now = new Date()): PublicStats {
  const big = (v: string | null | undefined) => BigInt(v ?? '0');
  const estimate = (wei: bigint) => (wei * BigInt(FEE_SPLIT_BPS.earnkit)) / BigInt(FEE_SPLIT_BPS.bonus);
  const safeWei = big(r.safe_fees_wei) + estimate(big(r.bonus_unmatched_wei)) + big(r.bonus_to_safe_wei);
  const date = (v: string | null) => (v ? new Date(v) : null);
  const openRows = (r.open_rows ?? []).map((p) => ({ ...p, max_award_usd: p.max_award_usd == null ? null : Number(p.max_award_usd), starts_at: date(p.starts_at), ends_at: date(p.ends_at) }));
  const openUsd = Math.round(openMoneyUsd(openRows, now));
  return {
    open_money_usd: openUsd,
    // v3 Stage 2: the landing's line ("$115K in grants and prizes open"), null when no curated program is open.
    open_money_text: openRows.some((p) => openCurated(p, now)) ? openGrantsText(openUsd) : null,
    programs_open: Number(r.programs_open),
    // v2.14: there is no builder bonus; the key stays for jenil.ai.
    bonus_programs_open: 0,
    coins_launched: Number(r.coins_launched),
    tokens_declined: Number(r.tokens_declined),
    fees_to_safe_eth: weiToEth(safeWei),
    bonus_paid_eth: weiToEth(big(r.bonus_paid_wei)),
    bonus_pools_eth: weiToEth(big(r.bonus_pools_wei)),
    installs: Number(r.installs),
    installs_used: Number(r.installs_used ?? 0),
    builders: Number(r.builders ?? 0),
    activated: Number(r.activated ?? 0),
    weekly_active: Number(r.weekly_active ?? 0),
    shared: Number(r.shared ?? 0),
    posts_drafted: Number(r.posts_drafted ?? 0),
    posts_tapped: Number(r.posts_tapped ?? 0),
    // v4.0 Task 11: retired with the per-project offers (the keys stay, for jenil.ai).
    backers_after_post: 0,
    labelled_entries: Number(r.labelled_entries),
    entries_won: Number(r.entries_won),
    builders_won_usd: Math.round(Number(r.builders_won_usd ?? 0)),
    applications: Number(r.applications ?? 0),
    accepted: Number(r.accepted ?? 0),
    backing_open: 0,
    backers: 0,
    // v3 Stage 2 (spec 5.2): Earned over people, fees claimed (at the WETH price; none while it is unknown) plus announced prizes.
    earned_usd: Math.round((r.weth_usd ? wethToUsd(big(r.creator_fees_wei), r.weth_usd) : 0) + Number(r.builders_won_usd ?? 0)),
  };
}

/**
 * One read of every aggregate. Open money (v2.9 F21): openMoneyUsd over the active programs (the
 * top prize of each open curated program, never whole pools). Open: active, started, not ended.
 * `bonus_programs_open` (Ruling 16 (plan)): of those, the ones with the builder bonus on
 * (bonusOn's SQL twin: `builder_bonus AND campaign IS NULL`, status already 'active' here).
 * Coins: launches tokens.fun confirmed. Bonus paid: mined builder bonus payouts. Bonus pools (v2.7
 * Ruling 20 (plan)): every open round's bookings (`destination = 'round'`); a frozen round's don't count. v2.6 Ruling 6/16
 * (plan): an owner test installation (EARNKIT_TEST_INSTALLATIONS) counts in none of `installs`,
 * `coins_launched`, `bonus_pools_eth` (final review M7), the bonus deposits behind `fees_to_safe_eth`,
 * `labelled_entries` or `entries_won` (v2.8 Ruling 30 (plan)): its coin and fees are real,
 * but it never shows in public stats. `db` defaults to the pool; a test that needs two reads to
 * agree despite other test files writing in parallel passes one transaction (fix round 1,
 * finding 2), the way `alertFacts` takes one.
 */
export async function readStats(now = new Date(), db: Db = sql()): Promise<PublicStats> {
  const ids = testInstallationIds();
  // Launch baseline 2026-10-22: X handles of the team's own accounts (lowercase, no @), e.g.
  // EARNKIT_INTERNAL_HANDLES=jenilt,earnkitai. Every installation in a group whose profile has one of
  // these handles is internal and counts in no public number.
  const internal = (process.env.EARNKIT_INTERNAL_HANDLES ?? '')
    .split(',').map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  const [r] = await db<Row[]>`
    WITH open AS (
      SELECT max_award_usd, builder_bonus, campaign FROM programs
      WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= ${now}) AND (ends_at IS NULL OR ${now} < ends_at)
        AND ${freshSql(db, null, now)}
    )
    SELECT
      -- v2.9 F21: every active program; openMoneyUsd (statsFrom) keeps the open curated ones.
      (SELECT json_agg(json_build_object('max_award_usd', max_award_usd, 'investment', investment, 'status', status, 'campaign', campaign,
        'source', source, 'starts_at', starts_at, 'ends_at', ends_at)) FROM programs WHERE status = 'active' AND ${freshSql(db, null, now)}) AS open_rows,
      (SELECT count(*) FROM open)::int AS programs_open,
      (SELECT count(*) FROM open WHERE builder_bonus AND campaign IS NULL)::int AS bonus_programs_open,
      -- v4.2 F18: launched project tokens plus launched builder tokens (never a test installation's builder).
      ((SELECT count(*) FROM projects
        WHERE token_status = 'launched' AND NOT COALESCE(installation_id = ANY(${ids}::int[]), false))
       + (SELECT count(*) FROM builder_tokens bt
        WHERE bt.status = 'launched' AND NOT ${testBuilderSql(db, 'bt.builder_id', ids)}))::int AS coins_launched,
      (SELECT count(*) FROM builder_tokens bt
        WHERE bt.status = 'declined' AND NOT ${testBuilderSql(db, 'bt.builder_id', ids)})::int AS tokens_declined,
      -- Real FeeLocker deposits only (an onchain tx hash): never a synthetic row such as a paid
      -- round's 'round-rest:<round>' remainder, which is already inside the round's deposits.
      -- M5: and only from EarnKit coins (launched with the v2.5 split, so their Safe slot is 1.5x
      -- the bonus slot); a deposit from another or unknown coin has no known Safe share.
      (SELECT sum(amount_wei) FROM bonus_ledger
        WHERE tx_hash ~ '^0x[0-9a-f]{64}$'
          AND coin IN (SELECT coin_address FROM projects
            WHERE coin_address IS NOT NULL AND NOT COALESCE(installation_id = ANY(${ids}::int[]), false)))::text AS bonus_deposits_wei,
      -- v2.13.2 (2): the same deposits less those whose transaction's Safe deposit of the same coin is
      -- indexed (safe_fees counts that one), so a v2.5 coin's Safe share is counted once.
      (SELECT sum(l.amount_wei) FROM bonus_ledger l
        WHERE l.tx_hash ~ '^0x[0-9a-f]{64}$'
          AND l.coin IN (SELECT coin_address FROM projects
            WHERE coin_address IS NOT NULL AND NOT COALESCE(installation_id = ANY(${ids}::int[]), false))
          AND NOT EXISTS (SELECT 1 FROM safe_fees f WHERE f.tx_hash = l.tx_hash AND f.coin = l.coin))::text AS bonus_unmatched_wei,
      -- v2.13.2 (2): the Safe's own deposits from EarnKit coins, both splits, never a test installation's coin.
      -- v4.0 final review 3: and from launched builder tokens (the Safe's 60%), never a test installation's.
      (SELECT sum(f.amount_wei) FROM safe_fees f
        WHERE f.coin IN (SELECT coin_address FROM projects
          WHERE coin_address IS NOT NULL AND NOT COALESCE(installation_id = ANY(${ids}::int[]), false))
          OR f.coin IN (SELECT lower(coin_address) FROM builder_tokens
            WHERE status = 'launched' AND coin_address IS NOT NULL AND NOT (builder_id = ANY(${ids}::int[]))
              AND NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = builder_tokens.builder_id AND i.id = ANY(${ids}::int[]))))::text AS safe_fees_wei,
      -- Final review M2: never a test installation's coin (synthetic round-rest rows have no coin).
      (SELECT sum(amount_wei) FROM bonus_ledger WHERE destination = 'safe'
        AND NOT (coin IS NOT NULL AND coin IN (SELECT coin_address FROM projects
          WHERE coin_address IS NOT NULL AND installation_id = ANY(${ids}::int[]))))::text AS bonus_to_safe_wei,
      (SELECT sum(amount_wei) FROM bonus_payouts WHERE status = 'paid')::text AS bonus_paid_wei,
      -- Final review M7: never a test installation's coin, as bonus_to_safe_wei.
      (SELECT sum(l.amount_wei) FROM bonus_ledger l
        WHERE l.destination = 'round'
          AND l.round_key IN (SELECT round_key FROM bonus_rounds WHERE state = 'open')
          AND NOT (l.coin IS NOT NULL AND l.coin IN (SELECT coin_address FROM projects
            WHERE coin_address IS NOT NULL AND installation_id = ANY(${ids}::int[]))))::text AS bonus_pools_wei,
      -- Unique people only: one per builder group, never a test or internal group.
      (SELECT count(DISTINCT COALESCE(builder_id, id)) FROM installations
        WHERE NOT (id = ANY(${ids}::int[])) AND NOT (COALESCE(builder_id, id) = ANY(${ids}::int[]))
          AND NOT (COALESCE(builder_id, id) IN (SELECT builder_id FROM builder_profiles WHERE lower(x_handle) = ANY(${internal}::text[]))))::int AS installs,
      -- Pre-launch 2026-10-19: \`installs\` counts every OAuth token exchange for a new client
      -- registration, before any tool call (a re-add, a new machine or a scripted OAuth run is a new
      -- row). These two make the launch numbers trustworthy without changing \`installs\`:
      -- installs_used, the installations that called find at least once (a real first run); builders,
      -- distinct builder groups (v2.8.1 §E18 links a reinstall or an agent switch by builder_id).
      (SELECT count(DISTINCT COALESCE(builder_id, id)) FROM installations
        WHERE programs_checked_at IS NOT NULL AND NOT (id = ANY(${ids}::int[])) AND NOT (COALESCE(builder_id, id) = ANY(${ids}::int[]))
          AND NOT (COALESCE(builder_id, id) IN (SELECT builder_id FROM builder_profiles WHERE lower(x_handle) = ANY(${internal}::text[]))))::int AS installs_used,
      (SELECT count(DISTINCT COALESCE(builder_id, id)) FROM installations
        WHERE NOT (id = ANY(${ids}::int[])) AND NOT (COALESCE(builder_id, id) = ANY(${ids}::int[]))
          AND NOT (COALESCE(builder_id, id) IN (SELECT builder_id FROM builder_profiles WHERE lower(x_handle) = ANY(${internal}::text[]))))::int AS builders,
      -- Launch-ready L9 (the funnel), from the weekly moment's approvals (L6: a yes to "Does last week look right?"
      -- sets project_updates.facts.approved and approved_at). Activated: a claimed page, a repo verified by the
      -- read-only EarnKit app, and an approved week. Weekly active: the same people (so never above activated) with
      -- a week approved in the last 7 days. Shared: approved weeks that came from the share offer (approved_via).
      -- People (weeks for shared), never a test installation's group.
      (SELECT count(*) FROM builder_profiles p
        WHERE p.x_user_id IS NOT NULL AND ${notTest(db, ids)}
          AND NOT (lower(COALESCE(p.x_handle, '')) = ANY(${internal}::text[]))
          AND EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = p.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app')
          AND EXISTS (SELECT 1 FROM project_updates u WHERE u.builder_id = p.builder_id AND ${approvedWeek(db)}))::int AS activated,
      (SELECT count(*) FROM builder_profiles p
        WHERE p.x_user_id IS NOT NULL AND ${notTest(db, ids)}
          AND NOT (lower(COALESCE(p.x_handle, '')) = ANY(${internal}::text[]))
          AND EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = p.builder_id AND s.kind = 'repo' AND s.state = 'verified' AND s.proof = 'github_app')
          AND EXISTS (SELECT 1 FROM project_updates u WHERE u.builder_id = p.builder_id AND ${approvedWeek(db)}
            AND (u.facts->>'approved_at')::timestamptz > ${now}::timestamptz - interval '7 days'))::int AS weekly_active,
      (SELECT count(*) FROM project_updates u JOIN builder_profiles p ON p.builder_id = u.builder_id
        WHERE ${approvedWeek(db)} AND u.facts->>'approved_via' = 'share' AND ${notTest(db, ids)})::int AS shared,
      -- v3.1 one-tap posts (design 5): the funnel on post_drafts, people only (never a test installation's group).
      (SELECT count(*) FROM post_drafts d JOIN builder_profiles p ON p.builder_id = d.builder_id WHERE ${notTest(db, ids)})::int AS posts_drafted,
      (SELECT count(*) FROM post_drafts d JOIN builder_profiles p ON p.builder_id = d.builder_id WHERE d.taps > 0 AND ${notTest(db, ids)})::int AS posts_tapped,
      -- v2.8 Part G, Ruling 30 (plan): announcement-sourced outcomes only (a self-report never
      -- counts), never a test installation's entry. Labelled: distinct entries with an announced
      -- result other than 'unknown' (Ruling C22: a partial list labels the rest 'unknown'). Won:
      -- distinct entries announced as won or placed.
      (SELECT count(DISTINCT eo.project_id) FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id
        WHERE eo.basis = 'announcement' AND eo.result <> 'unknown'
          AND NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false))::int AS labelled_entries,
      (SELECT count(DISTINCT eo.project_id) FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id
        WHERE eo.basis = 'announcement' AND eo.result IN ('won', 'placed')
          AND NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false))::int AS entries_won,
      -- v2.9 E20: the prizes of announced won or placed outcomes with a known prize (one per entry
      -- and round); never a self-report, never a test installation's entry.
      (${wonUsdSql(db, ids)})::text AS builders_won_usd,
      -- v3 Stage 2 (spec 5.3): applications the builder told EarnKit about, one per person and program (a person: the
      -- installation's group), never a test installation's; accepted: of those, accepted or funded (self-reported).
      (${applicationsSql(db, ids, ['applied', 'accepted', 'funded', 'rejected'])})::int AS applications,
      (${applicationsSql(db, ids, ['accepted', 'funded'])})::int AS accepted,
      -- v3 Stage 2: creator fees claimed to each non-test coin's creator wallet (creator_fees), never a test installation's group.
      (SELECT sum(f.amount_wei) FROM creator_fees f JOIN projects p ON lower(p.coin_address) = f.coin
        WHERE f.wallet = ${creatorWalletSql(db)} AND NOT ${testProject(db, ids)})::text AS creator_fees_wei`;
  // The WETH price only when there are claimed fees to value (fees.ts: cached, at most a short wait).
  const weth_usd = BigInt(r.creator_fees_wei ?? '0') > 0n ? await cachedWethUsd(now.getTime(), PRICE_WAIT_MS, db) : null;
  return statsFrom({ ...r, weth_usd }, now);
}

/** v3 Stage 2: distinct (person, program) rows of builder_program_status with one of `statuses`, no test installation's. */
const applicationsSql = (db: Db, ids: number[], statuses: string[]) => db`
  SELECT count(DISTINCT (COALESCE(i.builder_id, i.id), s.program_id)) FROM builder_program_status s JOIN installations i ON i.id = s.installation_id
  WHERE s.status = ANY(${statuses}::text[]) AND NOT (i.id = ANY(${ids}::int[])) AND NOT (COALESCE(i.builder_id, i.id) = ANY(${ids}::int[]))`;
/** Launch-ready L9: `p` (a builder_profiles row) is no owner test installation's group. */
const notTest = (db: Db, ids: number[]) => db`NOT (p.builder_id = ANY(${ids}::int[]))
  AND NOT EXISTS (SELECT 1 FROM installations i WHERE COALESCE(i.builder_id, i.id) = p.builder_id AND i.id = ANY(${ids}::int[]))`;
/**
 * v3 Stage 2 final review: `p` (a projects row) belongs to an owner test installation's group: its installation is
 * a test one, or its group (COALESCE(builder_id, id)) is, or any installation in its group is (as notTest).
 */
const testProject = (db: Db, ids: number[]) => db`EXISTS (SELECT 1 FROM installations i WHERE i.id = p.installation_id
  AND (i.id = ANY(${ids}::int[]) OR COALESCE(i.builder_id, i.id) = ANY(${ids}::int[])
    OR EXISTS (SELECT 1 FROM installations j WHERE COALESCE(j.builder_id, j.id) = COALESCE(i.builder_id, i.id) AND j.id = ANY(${ids}::int[]))))`;
/** Launch-ready L9: `u` (a project_updates row) is a week the builder approved at the weekly moment (L6). */
const approvedWeek = (db: Db) => db`u.facts->'approved' = 'true'::jsonb AND jsonb_typeof(u.facts->'approved_at') = 'string'`;

/** v2.9 E20: the sum behind builders_won_usd (one SQL fragment for readStats and readWonUsd). */
const wonUsdSql = (db: Db, ids: number[]) => db`
  SELECT sum(eo.prize_usd) FROM entry_outcomes eo JOIN projects p ON p.id = eo.project_id
  WHERE eo.basis = 'announcement' AND eo.result IN ('won', 'placed') AND eo.prize_usd > 0
    AND NOT COALESCE(p.installation_id = ANY(${ids}::int[]), false)`;

/** v2.9 E20: how long the first reply's won figure is reused (one small read per 10 minutes). */
const WON_TTL_MS = 600_000;
let wonCache: { usd: number; at: number } | null = null;

/**
 * v2.9 E20: `builders_won_usd` alone, for the first reply, cached 10 minutes in this process. A
 * failed read is 0 (no line), never an error, and is not cached.
 */
export async function readWonUsd(now = Date.now()): Promise<number> {
  if (wonCache && now - wonCache.at < WON_TTL_MS) return wonCache.usd;
  try {
    const ids = testInstallationIds();
    const db = sql();
    const [r] = await db<{ usd: string | null }[]>`SELECT (${wonUsdSql(db, ids)})::text AS usd`;
    wonCache = { usd: Math.round(Number(r?.usd ?? 0)), at: now };
    return wonCache.usd;
  } catch (err) {
    console.error('[stats] won', err instanceof Error ? err.name : 'error');
    return 0;
  }
}

/**
 * v2.9 E20: where list_programs reads the won figure. Test suites that share one database
 * (fixtures/no-network-checks.ts) set `read` to a constant, so another file's announced win never
 * changes their first reply.
 */
export const wonSource: { read: () => Promise<number> } = { read: () => readWonUsd() };
