import { payoutBy, prizeUsdEach, usd, type CampaignConfig } from './campaigns';
import { shortDate } from './dates';

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
 * The proposed token as the builder sees it (fix round 1, Minor 3): "Tip Jar ($TIPJAR)", or just
 * "$TIPJAR" when the name adds nothing (it is the ticker, or unknown). Pure.
 */
const tokenLabel = (symbol: string, name?: string | null) =>
  name && name.replace(/\s+/g, '').toUpperCase() !== symbol ? `${name} ($${symbol})` : `$${symbol}`;

/** v2.10 item 5: the only skip word (only the token is skippable); confirm.ts re-exports it. */
export const SKIP_TOKEN = 'skip the token';

/**
 * The one token row in EarnKit campaigns (v2.4: a default at submission only, entered in one step,
 * so this row is the campaign's confirm line). v2.10 item 5: the confirm line's words, and no
 * footnote (no WETH, gas or terms in replies). Pure.
 */
export const tokenRow = (symbol: string, name?: string | null) => `Launches ${tokenLabel(symbol, name)}: 40% of its fees to you · or ${SKIP_TOKEN}`;

const DAY_MS = 86_400_000;

/**
 * v2.8.1 §C15: the deadline as the organizer states it, in the program's own time zone ("Oct 14,
 * 11:59 PM ET"), from a program summary's "closes Oct 14, 11:59 PM ET" part, or null. Pure; exported
 * for tests.
 */
export function summaryCloses(summary: string): string | null {
  for (const part of summary.split(' · ').slice(1)) {
    const m = /^closes (\w{3} \d{1,2}\b.*)$/.exec(part.trim());
    if (m) return m[1].trim();
  }
  return null;
}

/** "Oct 14" from summaryCloses' "Oct 14, 11:59 PM ET". Pure. */
const closesDay = (closes: string) => /^\w{3} \d{1,2}/.exec(closes)![0];

/**
 * v2.10 item 2 (Pre-flight P1): the program's own close day ("Oct 14" from "closes Oct 14, 11:59 PM
 * ET"), never a UTC day that can read a day late; else ends_at's UTC day; null for a rolling program.
 * Pure.
 */
export function closeDayOf(c: { summary: string; ends_at?: Date | null }): string | null {
  const closes = summaryCloses(c.summary);
  if (closes) return closesDay(closes);
  if (c.summary.split(' · ').slice(1).includes('rolling')) return null;
  return c.ends_at ? shortDate(c.ends_at) : null;
}

/**
 * The prize part of a program's summary ("500 USDC × 20 grants"). Ruling C23: an investment
 * program (a16z speedrun) reads "up to $1M investment" everywhere, never as a prize. Pure.
 */
export const prizeOf = (c: { summary: string; investment?: boolean }) => {
  const prize = c.summary.split(' · ')[0];
  return c.investment && !/\binvestment\b/i.test(prize) ? `${prize} investment` : prize;
};

/**
 * "Oct 14, 11:59 PM ET" from the summary's "closes Oct 14, 11:59 PM ET" (v2.8.1 §C15: the program's
 * own time zone), "rolling", else ends_at as deadlineLabel shows it. Ruling 29: roundEndLabel gives a
 * round ending at the deadline the same text. Pure; exported for tests.
 */
export function endsOf(c: { summary: string; ends_at?: Date | null }) {
  const closes = summaryCloses(c.summary);
  if (closes) return closes;
  if (c.summary.split(' · ').slice(1).includes('rolling')) return 'rolling';
  return c.ends_at ? deadlineLabel(c.ends_at) : 'rolling';
}

/**
 * Ruling 29: a round's end as the builder sees it everywhere, the same text as the first message
 * (present.ts endsOf). A window ending at the program's deadline takes the summary's "closes Oct 14,
 * 11:59 PM ET" (the program's real local deadline, v2.8.1 §C15), else deadlineLabel, as the first
 * message does. Any other round (a rolling program's month, ending 00:00 UTC, exclusive) shows its
 * last day ("Oct 31" for a month ending Nov 1). Pure.
 */
export function roundEndLabel(program: { summary: string; ends_at: Date | null }, ends: Date) {
  const closes = summaryCloses(program.summary);
  if (program.ends_at && closes) {
    if (program.ends_at.getTime() === ends.getTime()) return closes;
    // Re-review Minor 1: a stored window whose program deadline later moved keeps the same local
    // clock time: shift its UTC day the way the summary's local day differs from the deadline's.
    const day = closesDay(closes);
    const sameClock = (program.ends_at.getTime() - ends.getTime()) % DAY_MS === 0;
    if (sameClock)
      for (const shift of [0, -1, 1])
        if (shortDate(new Date(program.ends_at.getTime() + shift * DAY_MS)) === day)
          return `${shortDate(new Date(ends.getTime() + shift * DAY_MS))}${closes.slice(day.length)}`;
  }
  if (program.ends_at && program.ends_at.getTime() === ends.getTime()) return closes ?? deadlineLabel(ends);
  return deadlineDay(ends);
}

/**
 * The last day of an exclusive end, in UTC: an end at 00:00 UTC is the day before ("Oct 31" for
 * Nov 1 00:00), any other end is its own day. Pure.
 */
export const deadlineDay = (ends: Date) =>
  shortDate(ends.getTime() % DAY_MS === 0 ? new Date(ends.getTime() - 1) : ends);

/**
 * v2.8.1 §C15: a program deadline with no stated time zone: its time in UTC ("Oct 15, 3:59 AM UTC");
 * an end at 00:00 UTC (exclusive) stays its last day (deadlineDay). Pure.
 */
export function deadlineLabel(ends: Date) {
  if (ends.getTime() % DAY_MS === 0) return deadlineDay(ends);
  const h = ends.getUTCHours();
  const clock = `${h % 12 || 12}:${String(ends.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${shortDate(ends)}, ${clock} UTC`;
}

/**
 * Ruling 18 (plan), Ruling 22: the AGENT's note for an entry recorded without a wallet (never
 * shown to the builder, who is told to reply with a wallet).
 */
export const NO_COIN_YET = 'No token yet: no wallet was given. When the builder replies with a wallet, call confirm with project_id, yes: true and the wallet.';


export type EnteredText = {
  programTitle: string;
  coin:
    | { status: 'launched'; url: string }
    | { status: 'pending'; /** v2.8.1 §A1: pending past 10 minutes (the owner is alerted). */ stuck?: boolean }
    | { status: 'no_wallet' }
    | { status: 'skipped' }
    | {
        status: 'other';
        /** C7: what the entry still needs before its token launches (todoList), when that's why. */
        needs?: string;
        /** v2.8.1: a plain line that says why instead (the token is still being checked). */
        note?: string;
      };
  /**
   * Final review I3: the repo's one token is entered in this other program (Ruling 5 (plan)), so
   * this entry has none by design.
   */
  countsIn?: string | null;
};

/**
 * record_submission's show_to_builder outside campaigns (v2.6 §3). Builder text: never names a
 * tool (Ruling 22). With no wallet, one line. Pure.
 */
export function enteredText(a: EnteredText) {
  const entered = `Entered in ${a.programTitle}.`;
  if (a.countsIn) return entered;
  if (a.coin.status === 'no_wallet') return `${entered} Reply with a wallet to get your token.`;
  const coin =
    a.coin.status === 'launched'
      ? // v2.8.1 §F19: no "40%" here; the Yes line said it.
        ` Your token: ${a.coin.url.replace(/^https?:\/\//, '')}.`
      : a.coin.status === 'pending'
        ? a.coin.stuck
          ? " Your token didn't launch yet; EarnKit is checking what happened."
          : ' Your token is launching.'
        : a.coin.status === 'other'
          ? a.coin.note
            ? ` ${a.coin.note}`
            : a.coin.needs
            ? ` Your token isn't launched yet: the entry still needs ${a.coin.needs}.`
            : " Your token isn't launched yet."
          : '';
  return `${entered}${coin}`;
}

/** A round's old public board, as builder text (Ruling 12 (plan)): "earnkit.com/bonus/<slug>" (the key's `:` as `-`). */
export const boardLink = (roundKey: string) => `${siteUrl().replace(/^https?:\/\//, '')}/bonus/${roundKey.replace(':', '-')}`;


/**
 * v2.7 §3, Ruling 15 (plan) + C5: the lead line while the entry can't be submitted yet, from the
 * required items prepareSubmission reports missing, as short to-dos (todoOf): at most 3, then
 * "and N more". Pure.
 */
export function notReadyLine(missing: string[]) {
  return `Before you submit: ${todoList(missing)}.`;
}

/** C5: the to-dos as one list: at most 3, then "and N more". Pure. */
export function todoList(missing: string[]) {
  const shown = missing.slice(0, MAX_NOT_READY);
  const more = missing.length - shown.length;
  return [...shown, ...(more > 0 ? [`and ${more} more`] : [])].join('; ');
}

/**
 * C7: the builder's note when a token isn't launched because the entry still misses required
 * items (to-dos from todoOf). Pure.
 */
export const notReadyTokenNote = (missing: string[]) =>
  `Not launched: the entry still needs ${todoList(missing)}.`;

/** C5: at most this many items in the not-ready line, then "and N more". */
const MAX_NOT_READY = 3;

const QUESTION_START = /^(what|which|who|whom|whose|how|why|when|where|do|does|did|is|are|can|could|will|would|have|has|tell|share|describe|list)\b/i;
const DETERMINER_START = /^(a|an|the|your|my|our|their|its|any|all|some|each|every)\b/i;
const PERSONAL = /\b(wallet|email|name|handle|username|profile)\b/i;
const plural = (w: string) => /[^s]s$/i.test(w) && !/(us|ss|is)$/i.test(w);

/**
 * C5: a required item as a short to-do ("a live link on Arc mainnet"): the program's `todo` when
 * set, else its label normalized: a trailing "(…)" and "?", ".", ":" dropped; the first letter
 * lowercased unless the word is a name ("GitHub", "Telegram"); "your" before a short personal item
 * ("your payout wallet"), "a"/"an" before a short singular one ("a public repo"); questions and
 * long labels stay as they are. `problem`: the value given doesn't pass (fix round 1, Minor 7). Pure.
 */
export function todoOf(req: { label: string; todo?: string }, problem = false): string {
  const check = problem ? ' (check it)' : '';
  if (req.todo) return `${req.todo}${check}`;
  let s = req.label.trim().replace(/\s*\([^()]*\)\s*$/, '').replace(/[\s?.:!]+$/, '');
  const words = s.split(/\s+/);
  const first = words[0] ?? '';
  const name = /^[A-Z]\S*[A-Z]/.test(first) || /^(Telegram|Base|Arc|Circle|Monad|Solana|Loom|Farcaster|Discord|X)\b/.test(first);
  if (!name) s = s.charAt(0).toLowerCase() + s.slice(1);
  if (QUESTION_START.test(s) || DETERMINER_START.test(s) || words.length > 4) return `${s}${check}`;
  if (PERSONAL.test(s)) return `your ${s}${check}`;
  if (plural(first) || plural(words[words.length - 1])) return `${s}${check}`;
  return `${/^[aeiou]/i.test(s) ? 'an' : 'a'} ${s}${check}`;
}

/**
 * prepare_submission's show_to_builder (v2.4 §2): the one block the builder confirms. The prize
 * row is always first after the entry, naming the payout wallet in full; in EarnKit campaigns the
 * token row is one line (elsewhere the confirmation offer follows the table, v2.8 Part C);
 * a remembered wallet is asked about under the table (v2.10 item 5: no terms footnote in replies).
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
   * v2.7 Ruling 15 (plan) + C5: the required items still missing, as short to-dos (todoOf). When any
   * are, the screen leads with them and shows only Entry and Prize (plus the campaign wallet ask):
   * no token row or wallet line.
   */
  missing?: string[];
  /** A remembered payout wallet to confirm (I8): asked under the table, in full. */
  askWallet?: string | null;
  /**
   * The token row; `wallet` is the fee wallet (unused in the text since v2.10).
   */
  token: {
    symbol: string;
    /** The proposed token name, shown next to the ticker (fix round 1, Minor 3). */
    name?: string | null;
    wallet?: string | null;
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
  // v2.8 Part C: outside campaigns the confirmation offer (confirm.ts confirmOffer) replaces the
  // token row and the wallet line; campaigns keep v2.4's Token row (EarnKit campaigns are entered in
  // one step).
  if (!c || !a.token) return keyTable(rows) + ask;
  rows.push(['Token', tokenRow(a.token.symbol, a.token.name)]);
  // v2.10 item 5: no footnote (no WETH, gas or terms in replies; the terms are on the entry page).
  return keyTable(rows) + ask;
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
