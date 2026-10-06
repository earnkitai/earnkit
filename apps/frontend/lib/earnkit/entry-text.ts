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
 * The one token row (v2.4: a default at submission only, never advertised). `hasBonus` (v2.5 §3:
 * the program is active and has a submission_proof pattern, so its entries can earn the builder
 * bonus) swaps the generic "say no token to skip" for what skipping actually costs here: the
 * builder bonus. Pure.
 */
export const tokenRow = (symbol: string | null, hasBonus = false, coinIn: string | null = null) => {
  // Ruling 25: one coin per repo; this repo's coin is already entered in another program.
  if (hasBonus && coinIn) return repoCoinNote(coinIn);
  if (hasBonus)
    return symbol
      ? `$${symbol} on tokens.fun, you keep 40% of fees · skip: no builder bonus`
      : 'A token on tokens.fun, you keep 40% of fees: pick a name and ticker · skip: no builder bonus';
  return symbol
    ? `$${symbol} on tokens.fun, you keep 40% of fees (say "no token" to skip)`
    : 'A token on tokens.fun, you keep 40% of fees: pick a name and ticker, or say "no token" to skip';
};

/**
 * v2.6 §3: the coin row outside campaigns (one yes confirms the coin and the wallet under it).
 * `hasBonus`: bonusOn; skipping then costs the builder bonus. `coinIn`: Ruling 25. Pure.
 */
export function coinRow(a: { symbol: string | null; hasBonus: boolean; coinIn?: string | null }) {
  if (a.hasBonus && a.coinIn) return repoCoinNote(a.coinIn);
  const coin = a.symbol ? `, $${a.symbol}` : ' (pick a name and ticker)';
  return a.hasBonus
    ? `Your entry gets a coin${coin}: you earn 40% of its trading fees, and it enters the builder bonus · skip: no coin, no builder bonus`
    : `Your entry gets a coin${coin}: you earn 40% of its trading fees · skip: no coin`;
}

/**
 * The wallet line under the coin row (v2.6 §3). Ruling 22: the wallet is named once, in full,
 * here (the footnote no longer repeats it). Without one, the line is the ask. Pure.
 */
export function walletLine(a: { wallet: string | null; remembered: boolean; hasBonus: boolean }) {
  const what = a.hasBonus ? 'fees and any bonus' : 'fees';
  if (!a.wallet) return `Which wallet should get your coin's ${what}?`;
  return `Wallet for ${what}: ${a.wallet}${a.remembered ? ' (yours from last time)' : ''} — or tell me another.`;
}

/**
 * Ruling 22: the consent line under the coin row outside campaigns: the fee detail the row leaves
 * out (WETH, Clanker's cut, gas) and both terms links (v2.3 consent), once. Campaigns keep
 * tokenFootnote.
 */
export const COIN_FOOTNOTE = `Fees in WETH, after Clanker's 20% cut; tokens.fun pays gas. Terms: ${TOKEN_TERMS.agreement} · Risks: ${TOKEN_TERMS.risks}`;

/** The last day of a round whose end is exclusive ("Oct 31" for a month ending Nov 1 00:00 UTC). */
const lastDayOf = (ends: Date) => new Date(ends.getTime() - 1);

/**
 * Ruling 18 (plan), Ruling 22: the AGENT's note for an entry recorded without a wallet (never
 * shown to the builder, who is told to reply with a wallet). `ends` is the open round's exclusive
 * end (null: no open round or no bonus, so no date). Pure.
 */
export const noCoinYet = (ends: Date | null) =>
  `No coin yet: no wallet was given. When the builder replies with a wallet, call launch_token with the wallet as creator_wallet${ends ? ` before ${shortDate(lastDayOf(ends))}` : ''}.`;

export type EnteredText = {
  programTitle: string;
  coin:
    | { status: 'launched'; url: string }
    | { status: 'pending' }
    | { status: 'no_wallet' }
    | { status: 'skipped' }
    | { status: 'other' };
  /**
   * The open round (`lastDay` is its exclusive end). Null when the program has no bonus, the coin
   * was skipped, or Ruling 25 applies.
   */
  bonus: { cell: string; lastDay: Date; board: string } | null;
};

/**
 * record_submission's show_to_builder outside campaigns (v2.6 §3). Builder text: never names a
 * tool (Ruling 22). With no wallet, one line, the round's date once. Pure.
 */
export function enteredText(a: EnteredText) {
  const entered = `Entered in ${a.programTitle}.`;
  const round = a.bonus && `${a.bonus.cell} · ends ${shortDate(lastDayOf(a.bonus.lastDay))} · ${a.bonus.board}`;
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
          ? ' No coin yet.'
          : '';
  return round ? `${entered}${coin}\nBuilder bonus: ${round}` : `${entered}${coin}`;
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
  `Token: you keep 40% of trading fees (after Clanker's 20% protocol cut), paid in WETH${wallet ? ` to ${wallet}` : ''}; tokens.fun pays the gas. Terms: ${TOKEN_TERMS.agreement} · Risks: ${TOKEN_TERMS.risks}`;

/** The footnote when the fee wallet isn't known yet. */
export const TOKEN_FOOTNOTE = tokenFootnote(null);

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
  /** A remembered payout wallet to confirm (I8): asked under the table, in full. */
  askWallet?: string | null;
  /**
   * The token row; `wallet` is the fee wallet, named in the footnote when known. `hasBonus`: v2.5
   * §3. `coinIn`: the program this repo's coin is already entered in (Ruling 25; no new coin, so
   * no footnote).
   */
  token: {
    symbol: string | null;
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
  const coinIn = a.token?.hasBonus ? (a.token.coinIn ?? null) : null;
  // v2.6 §3: outside campaigns, the Coin row and the wallet line under the table (one yes
  // confirms both); campaigns keep v2.4's Token row.
  const coin = !c && a.token;
  if (a.token)
    rows.push(
      coin
        ? ['Coin', coinRow({ symbol: a.token.symbol, hasBonus: a.token.hasBonus === true, coinIn })]
        : ['Token', tokenRow(a.token.symbol, a.token.hasBonus, coinIn)],
    );
  const ask = a.askWallet ? `\n\nPay prizes to ${a.askWallet}? It is the wallet from your last entry.` : '';
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
