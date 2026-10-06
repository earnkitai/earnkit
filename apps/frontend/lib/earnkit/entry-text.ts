import { payoutBy, prizeUsdEach, usd, type CampaignConfig } from './campaigns';
import { boardSlug } from './bonus-rounds';
import { shortDate } from './dates';
import { TOKEN_TERMS } from './tokens';

/** EarnKit's public origin for links in builder text. */
export const siteUrl = () => (process.env.EARNKIT_URL ?? 'https://earnkit.com').replace(/\/$/, '');

/** "0xAbCd…Ef01". Pure. */
export const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** A two-column markdown table whose first row is the header (it renders as a table). Pure; exported for tests. */
export function keyTable(rows: [string, string][]) {
  const [head, ...rest] = rows;
  return [
    `| ${cell(head[0])} | ${cell(head[1])} |`,
    '|---|---|',
    ...rest.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`),
  ].join('\n');
}

/**
 * The one token row in EarnKit campaigns (v2.4: a default at submission only, never advertised).
 * v2.7 §3: the token's chain is explicit (tokens.fun launches on Base). `hasBonus` (v2.5 §3)
 * swaps the generic "say no token to skip" for what skipping costs here: the builder bonus. Pure.
 */
export const tokenRow = (symbol: string, hasBonus = false, coinIn: string | null = null) => {
  // Ruling 25: one token per repo; this repo's token is already entered in another program.
  if (hasBonus && coinIn) return repoCoinNote(coinIn);
  return hasBonus
    ? `a token on Base, $${symbol}: you earn 40% of its trading fees · skip: no builder bonus`
    : `a token on Base, $${symbol}: you earn 40% of its trading fees (say "no token" to skip)`;
};

/**
 * v2.6 §3 + v2.7 Ruling 17 (plan): the Token row outside campaigns (one yes confirms the token and
 * the wallet under it); the chain is explicit. `hasBonus`: bonusOn; skipping then costs the
 * builder bonus. `coinIn`: Ruling 25. Pure.
 */
export function coinRow(a: { symbol: string; hasBonus: boolean; coinIn?: string | null }) {
  if (a.hasBonus && a.coinIn) return repoCoinNote(a.coinIn);
  const token = `Your entry gets a token on Base, $${a.symbol}: you earn 40% of its trading fees`;
  return a.hasBonus
    ? `${token}, and it joins the builder bonus · skip: no token, no builder bonus`
    : `${token} · skip: no token`;
}

/**
 * The wallet line under the coin row (v2.6 §3). Ruling 22: the wallet is named once, in full,
 * here (the footnote no longer repeats it). Without one, the line is the ask. Pure.
 */
export function walletLine(a: { wallet: string | null; remembered: boolean; hasBonus: boolean }) {
  const what = a.hasBonus ? 'fees and any bonus' : 'fees';
  if (!a.wallet) return `Which wallet should get your token's ${what}?`;
  // Final review M8: "used last time", never "yours": on a shared registration it may not be.
  return `Wallet for ${what}: ${a.wallet}${a.remembered ? ' (used last time)' : ''} — or tell me another.`;
}

/**
 * Ruling 22 + v2.7 §3: the consent line under the token row outside campaigns: the fee detail the
 * row leaves out (WETH, gas) and both terms links (v2.3 consent), once. It never names the launch
 * protocol or its cut (Ruling 18 (plan)). Campaigns keep tokenFootnote.
 */
export const COIN_FOOTNOTE = `Fees in WETH; tokens.fun pays gas. Terms: ${TOKEN_TERMS.agreement} · Risks: ${TOKEN_TERMS.risks}`;

const DAY_MS = 86_400_000;

/** "Oct 14" from a program summary's "closes Oct 14, …" part, or null. Pure; exported for tests. */
export function summaryCloses(summary: string): string | null {
  for (const part of summary.split(' · ').slice(1)) {
    const m = /^closes (\w{3} \d{1,2})\b/.exec(part);
    if (m) return m[1];
  }
  return null;
}

/** The prize part of a program's summary ("500 USDC × 20 grants"). Pure. */
export const prizeOf = (c: { summary: string }) => c.summary.split(' · ')[0];

/**
 * "Oct 14" from the summary's "closes Oct 14, …", "rolling", else ends_at's last day (deadlineDay). Ruling 29:
 * roundEndLabel gives a round ending at the deadline this same day. Pure; exported for tests.
 */
export function endsOf(c: { summary: string; ends_at?: Date | null }) {
  const closes = summaryCloses(c.summary);
  if (closes) return closes;
  if (c.summary.split(' · ').slice(1).includes('rolling')) return 'rolling';
  return c.ends_at ? deadlineDay(c.ends_at) : 'rolling';
}

/**
 * Ruling 29: a round's end as the builder sees it everywhere, the same day as the first message
 * (present.ts endsOf). A window ending at the program's deadline takes the summary's "closes Oct 14"
 * (the program's real local deadline), else deadlineDay, as the first message does. Any other round
 * (a rolling program's month, ending 00:00 UTC, exclusive) shows its last day ("Oct 31" for a month
 * ending Nov 1). Pure.
 */
export function roundEndLabel(program: { summary: string; ends_at: Date | null }, ends: Date) {
  const closes = summaryCloses(program.summary);
  if (program.ends_at && closes) {
    if (program.ends_at.getTime() === ends.getTime()) return closes;
    // Re-review Minor 1: a stored window whose program deadline later moved keeps the same local
    // clock time: shift its UTC day the way the summary's local day differs from the deadline's.
    const sameClock = (program.ends_at.getTime() - ends.getTime()) % DAY_MS === 0;
    if (sameClock)
      for (const shift of [0, -1, 1])
        if (shortDate(new Date(program.ends_at.getTime() + shift * DAY_MS)) === closes)
          return shortDate(new Date(ends.getTime() + shift * DAY_MS));
  }
  if (program.ends_at && program.ends_at.getTime() === ends.getTime()) return closes ?? deadlineDay(ends);
  return deadlineDay(ends);
}

/**
 * The last day of an exclusive end, in UTC: an end at 00:00 UTC is the day before ("Oct 31" for
 * Nov 1 00:00), any other end is its own day. Pure.
 */
export const deadlineDay = (ends: Date) =>
  shortDate(ends.getTime() % DAY_MS === 0 ? new Date(ends.getTime() - 1) : ends);

/**
 * Ruling 18 (plan), Ruling 22: the AGENT's note for an entry recorded without a wallet (never
 * shown to the builder, who is told to reply with a wallet). `endsLabel` is the open round's end
 * (roundEndLabel; null: no open round or no bonus, so no date). Pure.
 */
export const noCoinYet = (endsLabel: string | null) =>
  `No coin yet: no wallet was given. When the builder replies with a wallet, call launch_token with the wallet as creator_wallet${endsLabel ? ` by ${endsLabel}` : ''}.`;

/** Final review M1: the one line for an entry whose repo another entry already holds here. */
export const REPO_HELD = 'Another entry of this repo already holds its coin and builder bonus here.';

export type EnteredText = {
  programTitle: string;
  coin:
    | { status: 'launched'; url: string }
    | { status: 'pending' }
    | { status: 'no_wallet' }
    | { status: 'skipped' }
    | { status: 'other' };
  /**
   * The open round (`ends` is its end as the first message shows it, roundEndLabel). Null when the
   * program has no bonus, the coin was skipped, the repo is held (M1), or Ruling 25 applies.
   */
  bonus: {
    cell: string;
    ends: string;
    board: string;
    /**
     * Fix round 1 (I3): set when the entry doesn't count for the builder bonus yet, with what joins
     * it: the builder's word that it's submitted on `site` ('confirm'), the entry page on `site`
     * linking the project ('page'; `missing`: 'live site' for an entry without a repo), or (Ruling 24) the link to the entry page on `site` ('link').
     * Null or absent: it counts.
     */
    join?: { kind: 'confirm' | 'page' | 'link'; site: string; missing?: 'live site' } | null;
  } | null;
  /** Final review M1: an earlier entry of this repo holds its coin and builder bonus in this program. */
  repoHeld?: boolean;
};

/**
 * record_submission's show_to_builder outside campaigns (v2.6 §3). Builder text: never names a
 * tool (Ruling 22). With no wallet, one line, the round's date once. Pure.
 */
export function enteredText(a: EnteredText) {
  const entered = `Entered in ${a.programTitle}.`;
  // M1: no coin and no bonus to offer here; one plain line, never a wallet ask or a bonus line.
  if (a.repoHeld) return `${entered} ${REPO_HELD}`;
  const round = a.bonus && `${a.bonus.cell} · ends ${a.bonus.ends} · ${a.bonus.board}`;
  if (a.coin.status === 'no_wallet')
    return round
      ? `${entered} Reply with a wallet to get your coin and join the builder bonus (${round}).`
      : `${entered} Reply with a wallet to get your coin.`;
  const coin =
    a.coin.status === 'launched'
      ? ` Your coin: ${a.coin.url.replace(/^https?:\/\//, '')} · you earn 40% of its fees.`
      : a.coin.status === 'pending'
        ? ' Your coin is launching.'
        : a.coin.status === 'other'
          ? " Your coin isn't launched yet."
          : '';
  if (!round) return `${entered}${coin}`;
  const join = a.bonus!.join;
  // M4: the bonus needs the coin, so a coin not launched yet joins it once it is.
  if (!join)
    return a.coin.status === 'other'
      ? `${entered} Your coin isn't launched yet; it joins the builder bonus once it is (${round}).`
      : `${entered}${coin}\nBuilder bonus: ${round}`;
  const line =
    join.kind === 'page'
      ? `Add your ${join.missing ?? 'repo'} link to your ${join.site} entry page`
      : join.kind === 'link'
        ? `Send me your ${join.site} entry link`
        : `Tell me once you've submitted on ${join.site}`;
  // Re-review Minor 2: with the coin still to launch, the step and the coin are two plain sentences.
  return a.coin.status === 'other'
    ? `${entered}${coin}\n${line}. With your coin launched, that joins the builder bonus (${round}).`
    : `${entered}${coin}\n${line} to join the builder bonus (${round}).`;
}

/** A round's public leaderboard, as builder text (Ruling 12 (plan)): "earnkit.com/bonus/<slug>". */
export const boardLink = (roundKey: string) => `${siteUrl().replace(/^https?:\/\//, '')}/bonus/${boardSlug(roundKey)}`;

/** The no-bonus line for an entry whose repo's coin is entered in another program (Ruling 25). Pure. */
export const repoCoinNote = (programTitle: string) => `no builder bonus: this repo's coin is entered in ${programTitle}`;

/**
 * The line under the table: the earnings detail and both terms links (the v2.3 consent text),
 * naming the wallet that receives the fees when it is known (Ruling 14). It names the fee split
 * for the builder only (never the other slots the v2.5 split adds). Pure.
 */
export const tokenFootnote = (wallet: string | null | undefined) =>
  `Token: you earn 40% of trading fees, paid in WETH${wallet ? ` to ${wallet}` : ''}; tokens.fun pays gas. Terms: ${TOKEN_TERMS.agreement} · Risks: ${TOKEN_TERMS.risks}`;

/** The footnote when the fee wallet isn't known yet. */
export const TOKEN_FOOTNOTE = tokenFootnote(null);

/**
 * v2.7 §3, Ruling 15 (plan): the lead line while the entry can't be submitted yet, from the
 * required items prepareSubmission reports missing, by their label as written. Pure.
 */
export const notReadyLine = (missing: string[]) => `Before you submit: ${missing.join('; ')}.`;

/**
 * prepare_submission's show_to_builder (v2.4 §2): the one block the builder confirms. The prize
 * row is always first after the entry, naming the payout wallet in full; the token row is one line;
 * a remembered wallet is asked about under the table; terms go under it.
 * `prize` is the program's own prize text (programs that aren't EarnKit campaigns). Pure.
 */
export function confirmTable(a: {
  project: string;
  programTitle: string;
  campaign: CampaignConfig | null;
  prize: string;
  endsAt: Date | null;
  payoutWallet: string | null;
  /**
   * v2.7 Ruling 15 (plan): the required items still missing (prepareSubmission's labels). When any
   * are, the screen leads with them and shows only Entry and Prize (plus the campaign wallet ask):
   * no token row, wallet line or footnote.
   */
  missing?: string[];
  /** A remembered payout wallet to confirm (I8): asked under the table, in full. */
  askWallet?: string | null;
  /**
   * The token row; `wallet` is the fee wallet, named in the footnote when known. `hasBonus`: v2.5
   * §3. `coinIn`: the program this repo's coin is already entered in (Ruling 25; no new coin, so
   * no footnote).
   */
  token: {
    symbol: string;
    wallet?: string | null;
    hasBonus?: boolean;
    coinIn?: string | null;
    /** v2.6 Ruling 10: `wallet` is the installation's remembered one (not given in this call). */
    remembered?: boolean;
  } | null;
}) {
  const rows: [string, string][] = [['Entry', `${a.project} for ${a.programTitle}`]];
  const c = a.campaign;
  if (c?.kind === 'earnkit' && a.endsAt)
    rows.push([
      'Prize',
      `${usd(prizeUsdEach(c))} in ${c.prize.symbol} if top ${c.winners} with ${c.min_score}+ users, paid to ${a.payoutWallet ?? 'your wallet'} by ${shortDate(payoutBy(a.endsAt))}`,
    ]);
  else if (c?.kind === 'sponsor' && a.endsAt)
    rows.push(['Prize', `the sponsor picks winners after ${shortDate(a.endsAt)}`]);
  else rows.push(['Prize', a.prize]);
  const ask = a.askWallet ? `\n\nPay prizes to ${a.askWallet}? It is the wallet from your last entry.` : '';
  if (a.missing?.length) return `${notReadyLine(a.missing)}\n\n${keyTable(rows)}${ask}`;
  const coinIn = a.token?.hasBonus ? (a.token.coinIn ?? null) : null;
  // v2.6 §3: outside campaigns, the token row and the wallet line under the table (one yes
  // confirms both); campaigns keep v2.4's row. The key is Token everywhere (Ruling 17 (plan)).
  const coin = !c && a.token;
  if (a.token)
    rows.push([
      'Token',
      coin
        ? coinRow({ symbol: a.token.symbol, hasBonus: a.token.hasBonus === true, coinIn })
        : tokenRow(a.token.symbol, a.token.hasBonus, coinIn),
    ]);
  const wallet =
    a.token && coin && !coinIn
      ? `\n\n${walletLine({ wallet: a.token.wallet ?? null, remembered: a.token.remembered === true, hasBonus: a.token.hasBonus === true })}`
      : '';
  const foot = a.token && !coinIn ? `\n\n${coin ? COIN_FOOTNOTE : tokenFootnote(a.token.wallet)}` : '';
  return keyTable(rows) + ask + wallet + foot;
}

/** record_submission's show_to_builder for a campaign entry (v2.4 §2): rank, leaderboard, payout date. Pure. */
export function enteredTable(a: {
  project: string;
  programTitle: string;
  standing: string;
  leaderboard: string;
  campaign: CampaignConfig;
  endsAt: Date | null;
  payoutWallet: string;
}) {
  const c = a.campaign;
  const ends = a.endsAt ?? new Date();
  return keyTable([
    ['Entered', `${a.project} in ${a.programTitle}`],
    ['Rank', a.standing],
    ['Leaderboard', a.leaderboard],
    [
      'Payout',
      c.kind === 'earnkit'
        ? `${usd(prizeUsdEach(c))} in ${c.prize.symbol} to ${shortWallet(a.payoutWallet)} by ${shortDate(payoutBy(ends))}, if top ${c.winners} with ${c.min_score}+ users`
        : `the sponsor picks winners after ${shortDate(ends)}; prizes go to ${shortWallet(a.payoutWallet)}`,
    ],
  ]);
}
