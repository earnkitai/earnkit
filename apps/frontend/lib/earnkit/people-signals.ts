import { sql } from './db';
import { blockscout } from './campaigns';
import { alchemyCall, alchemyOn, alchemyTxList } from './alchemy';
import { githubUser, type GitHubAccount } from './github-verify';
import { hit } from './rate-limit';

/**
 * v3.1 owner people view (design doc v3.1-owner-people-view.md): the daily facts behind the owner's private
 * owner_people view (schema.sql), read once a UTC day by the cron, capped, free and keyless (GITHUB_TOKEN only raises
 * GitHub's limit), every failure skipped quietly. Never shown, scored or ranked.
 * - GitHub account ages: profiles' logins not yet in github_users (githubUser, cached a day in url_checks).
 * - Wallet history: a proven wallet's first Base transaction and its funder (Blockscout's txlist, oldest first). Known
 *   limit: a smart wallet funded by an internal call shows no funder.
 */
export const GH_AGES_PER_RUN = 50;
export const WALLET_SIGNALS_PER_RUN = 30;
export const WALLET_SIGNALS_RETRY_MS = 7 * 86_400_000;
/** The txlist rows read per wallet (the funder is the earliest of them sent to it). */
export const WALLET_TXS = 20;

const WALLET = /^0x[0-9a-f]{40}$/;
type TxRow = { timeStamp?: unknown; from?: unknown; to?: unknown };
export type TxList = { status?: string; result?: TxRow[] | string | null };

/**
 * A txlist answer for `wallet`: `firstTxAt` the earliest transaction's time (ISO), `funder` the sender (lowercase) of the
 * earliest one whose `to` is the wallet; each null when there is none. Rows without a valid time are ignored. Pure.
 */
export function walletSignalsFrom(wallet: string, data: TxList | null | undefined): { firstTxAt: string | null; funder: string | null } {
  const w = wallet.toLowerCase();
  const rows = (Array.isArray(data?.result) ? data.result : [])
    .map((r) => ({ secs: Number(r?.timeStamp), from: typeof r?.from === 'string' ? r.from.toLowerCase() : '', to: typeof r?.to === 'string' ? r.to.toLowerCase() : '' }))
    .filter((r) => Number.isFinite(r.secs) && r.secs > 0)
    .sort((a, b) => a.secs - b.secs);
  const firstIn = rows.find((r) => r.to === w && WALLET.test(r.from) && r.from !== w);
  return { firstTxAt: rows[0] ? new Date(rows[0].secs * 1000).toISOString() : null, funder: firstIn?.from ?? null };
}

/** Profiles' GitHub logins with no known account age: each read (githubUser), its creation time kept in github_users. */
export async function githubAgesStep(
  now: Date,
  o: { user?: (login: string) => Promise<GitHubAccount | null>; limit?: number; only?: number[]; deadline?: number } = {},
): Promise<{ due: number; dated: number }> {
  const db = sql();
  const due = await db<{ login: string }[]>`
    SELECT DISTINCT lower(p.github_login) AS login FROM builder_profiles p
    WHERE p.github_login IS NOT NULL AND NOT EXISTS (SELECT 1 FROM github_users g WHERE g.login = lower(p.github_login))
      ${o.only ? db`AND p.builder_id IN ${db(o.only)}` : db``}
    ORDER BY 1 LIMIT ${o.limit ?? GH_AGES_PER_RUN}`;
  const deadline = o.deadline ?? Date.now() + 60_000;
  const read = o.user ?? ((login: string) => githubUser(login, now));
  let dated = 0;
  for (const { login } of due) {
    if (Date.now() >= deadline) break;
    const u = await read(login).catch(() => null);
    if (!u || !Number.isFinite(Date.parse(u.created_at))) continue;
    await db`INSERT INTO github_users (login, created_at) VALUES (${login}, ${new Date(u.created_at)}) ON CONFLICT (login) DO NOTHING`;
    dated++;
  }
  return { due: due.length, dated };
}

/**
 * Proven wallets never checked, or with no transaction yet and checked over WALLET_SIGNALS_RETRY_MS ago (never checked
 * first): first_tx_at and funder from one txlist read. A failed read stores nothing (the next day's run asks again).
 */
export async function walletSignalsStep(
  now: Date,
  o: { read?: (path: string) => Promise<TxList>; limit?: number; only?: number[]; deadline?: number } = {},
): Promise<{ due: number; read: number }> {
  const db = sql();
  const due = await db<{ wallet: string }[]>`
    SELECT wallet FROM person_wallets
    WHERE (signals_checked_at IS NULL OR (first_tx_at IS NULL AND signals_checked_at <= ${new Date(now.getTime() - WALLET_SIGNALS_RETRY_MS)}))
      ${o.only ? db`AND builder_id IN ${db(o.only)}` : db``}
    ORDER BY signals_checked_at NULLS FIRST, proven_at, wallet LIMIT ${o.limit ?? WALLET_SIGNALS_PER_RUN}`;
  const deadline = o.deadline ?? Date.now() + 60_000;
  const read = o.read ?? ((path: string) => blockscout<TxList>(path, deadline));
  let n = 0;
  for (const { wallet } of due) {
    if (Date.now() >= deadline) break;
    if (!WALLET.test(wallet)) continue;
    // Alchemy when its key is set (Blockscout challenges servers), else Blockscout.
    const path = `/api?module=account&action=txlist&address=${wallet}&sort=asc&page=1&offset=${WALLET_TXS}`;
    const data = await (!o.read && alchemyOn() ? alchemyTxList(wallet, WALLET_TXS, alchemyCall(deadline)) : read(path)).catch((err: unknown) => {
      console.error('[people-signals] wallet', err instanceof Error ? err.name : 'error');
      return undefined;
    });
    if (data === undefined) continue;
    const s = walletSignalsFrom(wallet, data);
    await db`UPDATE person_wallets SET first_tx_at = ${s.firstTxAt}::timestamptz, funder = ${s.funder}, signals_checked_at = ${now} WHERE wallet = ${wallet}`;
    n++;
  }
  return { due: due.length, read: n };
}

/** Both steps, once a UTC day (the rate window marks the day, as feed.ts does; no new table); else skipped. */
export async function peopleSignals(now: Date, deadline: number): Promise<{ step: 'skipped' } | { github: Awaited<ReturnType<typeof githubAgesStep>>; wallets: Awaited<ReturnType<typeof walletSignalsStep>> }> {
  if (!(await hit(`peopleSignals:${now.toISOString().slice(0, 10)}`, 1, 86_400, now)).allowed) return { step: 'skipped' };
  const github = await githubAgesStep(now, { deadline });
  return { github, wallets: await walletSignalsStep(now, { deadline }) };
}
