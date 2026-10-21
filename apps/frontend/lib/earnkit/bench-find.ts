import { sql } from './db';
import { noteEvent } from './events';
import { enqueueDiscovery } from './discovery';
import { ensureProfile } from './profiles';
import { listPrograms } from './programs';
import { openEntries } from './projects';
import { hiddenIds, hiddenPrograms, readMemory } from './builder-memory';
import { recordShown } from './match-loop';
import { REPO_KEY, benchConfirmedSql, rankRepo } from './main-project';
import { installLink, pickLink, repoProof } from './repo-proof';
import { REPLY_WAIT_MS, settleWithin } from './reply-wait';
import { rankLines, type RankLines } from './bench-rank';
import { COIN_LAUNCHING, COIN_LIVE, COIN_NOTE, approvedCodeWeek, backingExcluded, backingOffer, coinOpen, offerCoin, openCoinLine } from './coin-moments';
import { UPDATE_LINES } from './updates';
import { pillCoin, raisingCoin, showRaisingLine } from './raising';
import { backersOfCoin } from './backers';
import { earnedUsd } from './earned';
import { raisingEnabled } from './builder-score-flag';
import { NEEDS_LIVE_PRODUCT } from './guide';
import { signInLink } from './x-link';
import { xSignInEnabled } from './builder-score-flag';
import { outcomeLine } from './outcomes';
import { EARN_NOTE, NOTED_LINE, newsOpener } from './stand-text';
import {
  biggestPick, earnPrize, FITS_MAX, fundWhen, scoreFits, showable, standBase, startRefresh, takeNews,
  type Seen as StandSeen, type StandBase,
} from './stand-view';
import { byDeadline, byPrize, byRelevance, canApply, enteredIds, layout, submitStep, submitStepLine, type Card, type FirstMessage, type RepoFit, type YourRepos } from './present';
import type { ReaderDeps } from './source-readers';
import type { TickerCheck } from './token-proposal';
import { creditsMainnet, type Detection } from './match';
import { projectKeyOf, type IdentityProject } from './identity-input';
import type { ToolContext } from './tools';
import { CHAIN_NAMES, type Chain } from './chains';
import {
  APPLY_WINDOW_DAYS, benchReply, benchStepKey, rankedState, replyState, stateAsk,
  type ApplyPick, type BenchAskKind, type BenchProject, type BenchView, type BestFit, type FundLine, type Variant,
} from './bench-reply';
import { liveSite, type LiveSite } from './live-check';
import { scoreWhy, storedShipping } from './score-v2';
import { readOriginality } from './originality';
import { displayName } from './bench-reply';
import { targetIn, weekStartLine, weeklyTarget, type TargetIn } from './weekly-target';
import { APPROVED_LINE, SHARE_NOTE, answerShare, lastWeekOf, momentDue, momentLines, momentReady, openShare, shareLink, takeMoment } from './weekly-moment';
import { isoWeekOf } from './weeks';
import { CONNECT_DONE, CONNECT_HEAD, CONNECT_NOTE, CONNECT_RETRY, answerConnect, backfillComplete, closeConnect, connectDue, connectWeeks, openConnect } from './connect-moment';
import { askWeeklyEmail, digestEnabled } from './digest';
import { pagePath } from './reserved-routes';
import { siteUrl } from './entry-text';
import { BASE_GRANTS_ID } from './builder-code';
import { appProvenRepo, builderCodesKnown, builderCodesWords, codesSettled, refreshBuilderCodes } from './builder-codes-check';
export { displayName };

/**
 * v2.13 T8 (spec "2a", "2b", "5. Ways to get funded", "The last line"): the reads and writes behind
 * find's and score's three parts (bench-reply.ts is pure). Both build one view
 * (benchView): the one project as the Bench sees it, its rank, the ways to get funded and the one
 * question; the question asked is stored (standing_seen.bench_ask) so a yes is answered as asked,
 * never by the agent's kind. Never throws on its own reads: each falls back as standFind's do.
 */

/** v3 Stage 1: the connect yes's line when no page handle could be read (a statement, no link). */
const APPROVED_CONNECT = 'Done. Your weeks are posted.';
export const BENCH_MOVE_UP_NOTE = 'A yes or no to the last line: call tell with move_up: { kind, project_key, answer } (kind and project_key as given here). Do the steps it returns yourself; never ask the builder to edit files.';
/**
 * R8: the ranked state's step, "Ship this week to climb.": a yes is one small, real thing to ship this week
 * from the repo. Never a coin, token or community round (only when the builder asks about a token: tell token).
 */
export const SHIP_STEP_NOTE =
  "A yes to the last line, or a question about what to ship: look at the repo in this folder (git log, open issues, the README) and suggest one small, real thing to ship this week, in one short line, then ask if they want you to build it now. " +
  "Never offer a coin or token here; only if the builder asks about one, call tell with token: 'ask'. Don't show this note.";
/** v2.14 no_project: the question asks for their work, so its answer goes to find with identity. */
export const START_NOTE =
  "If the builder sends their GitHub login or a link to something they've made, call find with identity: { github_login, project: { name, repo or live_url } }. " +
  "A no: call tell with move_up: { kind, project_key, answer: 'no' } (as given here). Don't show this note.";
/** Launch ready L2, no_project: the repo picker's install link is in show_to_builder. */
export const PICK_REPO_NOTE =
  'The builder installs EarnKit (read-only) from the link in show_to_builder and picks their repos on GitHub; never ask them for a GitHub URL. ' +
  "A yes or no: call tell with move_up: { kind, project_key, answer } (as given here). Once they installed it, call find again: the most recently pushed repo they picked is ranked. Don't show this note.";
/** v2.13.3 (5), v2.14 not_counted: the install link is in show_to_builder. */
export const INSTALL_APP_NOTE =
  'The builder installs EarnKit (read-only) on the repo from the link in show_to_builder. ' +
  "A yes or no: call tell with move_up: { kind, project_key, answer } (as given here). Once they installed it, call find again, which counts the repo. Don't show this note.";
/** v2.14 A17: find's held outcome question is the reply's last line; the answer goes to tell. */
export const BENCH_OUTCOME_NOTE =
  "show_to_builder ends with the results question for this entry. Their answer: call tell with program_status: this program_id and project_id, their result (won, placed or lost), and prize_usd if they won money. If they don't know yet, call nothing. Don't show this note.";
/** v3 Stage 2 (spec 5.3 Route 2): the backing offer's note; a yes goes to the coin flow (coinYes, then confirm { project_id }). */
export const BACKING_NOTE =
  "A yes or no to the last line: call tell with move_up: { kind: 'backing', project_key, answer } (project_key as given here). " +
  "If they give a wallet for the fees with the yes, call tell with coin: { project_key, answer: 'yes', wallet } instead. Never launch anything before that yes. Don't show this note.";
/** v3 Stage 2 (spec 5.3): the apply step's ask; a yes drafts the entry (APPLY_YES_NOTE). */
export const APPLY_NOTE = "A yes or no to the last line: call tell with move_up: { kind: 'apply', project_key, answer } (project_key as given here). Don't show this note.";
/** v3 Stage 2: the yes to the apply step: prepare drafts the entry, the ship log's facts on top. */
export const APPLY_YES_NOTE = (id: string) => `Call prepare with program_id "${id}" for this project and show the draft. Don't show this note.`;
/** v3 Stage 2: find's held apply-outcome question (14 days after the deadline) is the reply's last line. */
export const APPLY_OUTCOME_NOTE =
  "show_to_builder ends with the outcome question for this application. Their answer: call tell with program_status: this program_id and their status (applied, accepted, funded or rejected). If they don't know yet, call nothing. Don't show this note.";
/** A no keeps an ask away this long (standing_seen.declined). */
export const DECLINE_MS = 30 * 86_400_000;
/** v2.14 T4 (leaked authorize URL): the first reply after an X bind names the account, so a wrong one is noticed. */
export const signedInLine = (handle: string) => `Signed in as @${handle}.`;

/** What the person was last told (stand-view's Seen) plus the Bench's own: the ask. */
export type Seen = StandSeen & {
  /** The stored ask's kind: a BenchAskKind, or a retired one an older reply stored (OLD_ASKS). */
  bench_ask?: { kind: BenchAskKind | string; key: string | null; program_id?: string; repo?: string };
  /** v3 Stage 2: the programs the apply step was shown for ({ [program_id]: iso }): asked once a program. */
  apply_asked?: Record<string, string>;
};
type Reply = Record<string, unknown>;

/** The one project's builder_projects row, as the Bench sees it (confirmed: benchConfirmedSql). */
type MainRow = { key: string; name: string; kind: string; shipped: boolean; weeks: number; streak: number; confirmed: boolean; site: boolean; chains: string[] };

/** v2.13.1 O2 (B1): an idea for a builder with no project never needs a live product or a repo. Pure. */
export const noProjectIdea = (c: Card) => c.needs_repo === false && c.tag !== NEEDS_LIVE_PRODUCT;
/**
 * v2.13.1 O5 N6 (P5): an idea for a builder with no project: only with the program's own pitch (never
 * a made-up "a small app"). v2.14 A18: find offers no build, so no starter narrows it. Pure.
 */
export const ideaFitsOffer = (c: Card) => noProjectIdea(c) && Boolean(c.pitch?.for);
/** "Base", "Robinhood Chain". Pure. */
const chainName = (c: string) => (Object.hasOwn(CHAIN_NAMES, c) ? CHAIN_NAMES[c as Chain] : c);
/**
 * R12: why a program the matcher fits suits the repo, in one short sentence from the matcher's own facts:
 * its chain (a contract deployed there, a deploy config naming its mainnet, else code for it), any chain,
 * and a live app for a program that needs one. Plain words (no "contract" or "repo", the copy rule):
 * "You deployed on Base and your app is live." Pure.
 */
export function fitWhy(c: Pick<Card, 'chains' | 'any_chain' | 'tag'>, repo: { chains: Detection; live: boolean }): string {
  const chains = c.any_chain === true ? [] : (c.chains ?? []);
  const chain = chains.find((ch) => creditsMainnet(repo.chains[ch])) ?? chains.find((ch) => repo.chains[ch]);
  const at = chain ? repo.chains[chain] : undefined;
  const parts = [
    chain
      ? at?.basis === 'deployed' ? `you deployed on ${chainName(chain)}` : creditsMainnet(at) ? `you deploy to ${chainName(chain)}` : `you build for ${chainName(chain)}`
      : c.any_chain === true ? 'it takes any chain' : null,
    c.tag === NEEDS_LIVE_PRODUCT && repo.live ? 'your app is live' : null,
  ].filter((x): x is string => x !== null);
  if (parts.length === 0) return 'It fits your project.';
  const line = parts.join(' and ');
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}
/** A matched repo's facts as fitWhy reads them (live: a homepage, or a link that loaded). Pure. */
export const whyFacts = (f: { chains?: Detection; homepage?: string | null; live_verified?: boolean }) => ({
  chains: f.chains ?? {},
  live: Boolean(f.live_verified || f.homepage),
});

/** "a Base app", "an Avalanche app", "an app on Base, Tempo or Robinhood Chain". Pure. */
const chainApp = (chains: readonly string[]) => {
  const names = chains.map(chainName);
  if (names.length === 1) return `${/^[aeiou]/i.test(names[0]) ? 'an' : 'a'} ${names[0]} app`;
  return `an app on ${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
};
/**
 * v2.13.3 (2): an open program and what it needs, in plain words: its chain when it needs one ("for an
 * Avalanche app"), a live product ("once it's live"), code on GitHub, else any app. Never says it fits. Pure.
 */
export function fundNeeds(c: Card, has: { live?: boolean; repo?: boolean } = {}): Extract<FundLine, { kind: 'needs' }> {
  const chain = c.any_chain !== true && (c.chains ?? []).length > 0 ? `for ${chainApp(c.chains!)}` : null;
  const needsLive = c.tag === NEEDS_LIVE_PRODUCT;
  // v2.13.4 (spec 4): what the project already has is never asked for ("once it's live" for a live app).
  const live = needsLive && !has.live;
  const repo = !needsLive && c.needs_repo === true && !has.repo;
  const needs = chain
    ? `${chain}${live ? ", once it's live" : repo ? ', once its code is on GitHub' : ''}`
    : live ? 'once your app is live' : repo ? 'once your code is on GitHub' : needsLive ? 'for any live app' : 'for any app';
  // v2.13.3 review (M5): a program with no known award is named without a dollar figure.
  return { kind: 'needs', title: c.title, prize: (c.max_award_usd ?? 0) > 0 ? earnPrize(c) : null, needs };
}
/** v2.13.3 (2): at most this many programs are named for a builder with no confirmed project. */
export const NEEDS_MAX = 2;
/**
 * v2.13.3 (2): open programs to name with what they need (fundNeeds), `n` at most, none already named:
 * those on the project's chains (or any chain) first, then the biggest prize. Pure.
 */
export function needsPicks(
  cards: Card[], now: Date, skip: Set<string>, n: number, chains: string[] = [], has: { live?: boolean; repo?: boolean } = {},
): Extract<FundLine, { kind: 'needs' }>[] {
  if (n <= 0) return [];
  const on = (c: Card) => (c.any_chain === true || (c.chains ?? []).some((ch) => chains.includes(ch)) ? 0 : 1);
  return cards
    .filter((c) => showable(c, now, skip))
    .sort((a, b) => on(a) - on(b) || byPrize(a, b))
    .slice(0, n)
    .map((c) => fundNeeds(c, has));
}

type BenchRead = {
  base: StandBase; seen: Seen; main: string | null; row: MainRow | null;
  ranks: RankLines;
  /** builder_live's Shipping (null: no Shipping row yet) and its stored parts (for the why). */
  score: number | null; parts: unknown;
  /** The one project's Originality (originality.ts), null until computed. */
  originality: number | null;
  /** standBase answered (a profile exists): news is read only then. */
  profiled: boolean;
  /** v2.13.4 (spec 4): the live link the agent reported for the one project (identity), if any. */
  liveUrl: string | null;
};
const EMPTY_BASE: StandBase = { standing: { ranked: false, rank: 0, total: 0 }, claimed: false, handle: null, signInLink: null };
const NO_RANK: RankLines = { bench: null, line: null, chains: [], listed: false };
const logged = (where: string) => (err: unknown) => {
  console.error(`[bench] ${where}`, err instanceof Error ? err.name : 'error');
  return null;
};

async function benchRead(id: number, own: number): Promise<BenchRead> {
  // v2.14: `own` (the caller's own installation) is the one an X sign-in link is for.
  const stand = await standBase(id, { own }).catch(logged('stand'));
  const [p] = await sql()<{ main: string | null; seen: unknown; identity: unknown }[]>`
    SELECT main_project_key AS main, standing_seen AS seen, identity FROM builder_profiles WHERE builder_id = ${id}`.catch(
    () => [],
  );
  const main = p?.main ?? null;
  const [row] = main
    ? await sql()<MainRow[]>`
        SELECT b.project_key AS key, b.name, b.kind, b.shipped, b.people, b.has_coin, b.weeks_shipping AS weeks, b.streak,
          ${benchConfirmedSql(sql())} AS confirmed, b.chains,
          EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = b.builder_id AND s.kind = 'site' AND s.state = 'verified'
            AND lower(s.project_key) = lower(b.project_key)) AS site
        FROM builder_projects b WHERE b.builder_id = ${id} AND lower(b.project_key) = lower(${main})`.catch(() => [])
    : [];
  const ranks = await rankLines(id).catch(() => NO_RANK);
  const [live] = await sql()<{ parts: unknown }[]>`SELECT parts FROM builder_live WHERE builder_id = ${id}`.catch(() => []);
  const originality = await readOriginality(id, main).catch(() => null);
  // standBase's seen, else the profile's own (the Bench's keys are read from the same column).
  const seen = (stand?.seen ?? (p?.seen && typeof p.seen === 'object' ? p.seen : {})) as Seen;
  return {
    base: stand?.base ?? EMPTY_BASE, seen, main, row: row ?? null, ranks, profiled: stand !== null,
    score: storedShipping(live?.parts)?.points ?? null, parts: live?.parts ?? null, originality,
    liveUrl: main ? reportedLive(p?.identity, main) : null,
  };
}

/** The live link the stored identity names for project `key` (its repo, live link or package), or null. Pure. */
export function reportedLive(identity: unknown, key: string): string | null {
  const projects = identity && typeof identity === 'object' && Array.isArray((identity as { projects?: unknown }).projects)
    ? ((identity as { projects: unknown[] }).projects as Record<string, unknown>[])
    : [];
  const k = key.toLowerCase();
  const p = projects.find((x) => x && typeof x === 'object' && [x.repo, x.live_url, x.package].some((v) => typeof v === 'string' && v.toLowerCase() === k));
  return p && typeof p.live_url === 'string' && /^https:\/\//i.test(p.live_url) ? p.live_url : null;
}

/** v2.13.4 (spec 4): the live check never holds a reply long; it gets what is left of the wait, at least this. */
const LIVE_WAIT_MIN_MS = 300;
/** The one project's live link, checked within `ms` (else null; the check lands for the next reply). Never throws. */
async function liveOf(id: number, read: BenchRead, now: Date, ms: number): Promise<LiveSite | null> {
  if (!read.liveUrl || !read.main) return null;
  return (await settleWithin(liveSite(id, read.liveUrl, now, read.main).catch(logged('live check')), Math.max(LIVE_WAIT_MIN_MS, ms))) ?? null;
}

/** R8: tell token: 'ask' with no confirmed one project. */
export const TOKEN_NOT_YET = 'A token comes after your project is counted on the leaderboard.';
/** R8: tell token: 'ask' when no coin can be offered for the project now (launches off, declined, a private repo). */
export const tokenUnavailable = (name: string) => `A token isn't available for ${name} right now.`;
export const tokenHasCoin = (name: string) => `${name} already has a coin.`;
/** v3 Stage 2 review: tell token: 'ask' under EARNKIT_RAISING before the first approved week with code (the terms: offered after it). */
export const BACKING_NOT_YET = 'Backing opens after your first confirmed week.';
/** The agent's note with the line to show backing for an old coin: the yes is tell coin { raising: true }. */
export const RAISE_NOTE = "A yes to the last line: call tell with coin: { raising: true }. Don't show this note.";

/**
 * R8: the coin and backing offer, only when the builder asks about a token (tell token: 'ask'),
 * never in find's or score's default reply (v3 Stage 2: save backing's own moment, backingOffer). For the confirmed
 * one project: a launched coin not shown as backing yet: that line (EARNKIT_RAISING on); a coin out or launching: says so; an offer made and
 * not answered: the same line again; else a new offer (coin-moments.ts offerCoin, the coin named and the
 * wallet shown). The yes goes to tell coin as with any coin offer, then confirm { project_id }. Never throws
 * on its own reads (a failed read is "not available").
 */
export async function tokenAsk(id: number, deps: { check?: TickerCheck } = {}): Promise<Reply> {
  const [p] = await sql()<{ main: string | null }[]>`SELECT main_project_key AS main FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const [row] = p?.main
    ? await sql()<{ key: string; name: string; has_coin: boolean; confirmed: boolean }[]>`
        SELECT b.project_key AS key, b.name, b.has_coin, ${benchConfirmedSql(sql())} AS confirmed
        FROM builder_projects b WHERE b.builder_id = ${id} AND lower(b.project_key) = lower(${p.main})`.catch(() => [])
    : [];
  if (!row?.confirmed) return { show_to_builder: TOKEN_NOT_YET };
  const name = displayName(row.name, row.key, null);
  const coin = await raisingCoin(id).catch(logged('token coin'));
  if (coin) {
    if (raisingEnabled() && coin.status === 'launched' && !coin.raising) return { show_to_builder: showRaisingLine(coin.symbol), agent_note: RAISE_NOTE };
    return { show_to_builder: coin.status === 'launched' ? COIN_LIVE : COIN_LAUNCHING };
  }
  if (row.has_coin) return { show_to_builder: tokenHasCoin(name) };
  if (backingExcluded(row.key)) return { show_to_builder: tokenUnavailable(name) };
  const again = (await coinOpen(id, row.key).catch(() => false)) ? await openCoinLine(id, row.key, deps).catch(logged('token again')) : null;
  // v3 Stage 2 review: under EARNKIT_RAISING the offer is backing's own, once a project, only after the first approved week with code.
  if (!again && raisingEnabled() && !(await approvedCodeWeek(id, row.key).catch(() => false))) return { show_to_builder: BACKING_NOT_YET };
  const offer = again ?? (raisingEnabled()
    ? await backingOffer(id, row.key, deps).catch(logged('token backing'))
    : await offerCoin(id, row.key, 'countable', deps).catch(logged('token offer')));
  if (!offer) return { show_to_builder: tokenUnavailable(name) };
  return { show_to_builder: offer.line, coin: { project_key: row.key }, agent_note: COIN_NOTE };
}

/**
 * v2.14 T9 fix round 1: whether this caller is signed out (state 1): X sign-in can be made (X on and the auth
 * secret set: A5 is only X actually off), the person has no page yet (no X handle), and the caller's own
 * installation isn't bound to X. Find skips the results question while this holds, so it isn't used up before
 * the bind. A database error reads as signed out (final fix 12: the retry question, never a page it may not have).
 */
export async function signedOutNow(id: number, own: number): Promise<boolean> {
  if (!xSignInEnabled() || !process.env.EARNKIT_AUTH_SECRET) return false;
  try {
    const [r] = await sql()<{ claimed: boolean; bound: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM builder_profiles WHERE builder_id = ${id} AND x_user_id IS NOT NULL AND x_handle IS NOT NULL) AS claimed,
        EXISTS (SELECT 1 FROM installations WHERE id = ${own} AND x_user_id IS NOT NULL) AS bound`;
    return Boolean(r) && !r.claimed && !r.bound;
  } catch (err) {
    // Final fix 12: with X on, a failed read is signed out (the retry question), never read as signed in.
    logged('signed out')(err);
    return true;
  }
}

/** v3 Stage 2: the streak (weeks shipped in a row) from which a ranked reply names one upcoming program. */
export const UPCOMING_STREAK = 4;

/** R12: a program the one project fits: its award, its deadline ("closes Oct 30" or "rolling") and why (fitWhy). */
export type Fit = {
  program_id: string; repo?: string; title: string; prize: string; when: string; why: string;
  /** v3 Stage 2: the deadline (ISO), null when rolling. */
  ends_at: string | null;
  /** v3 Stage 2 final review: an investment (an accelerator). v3.1 F1: a fit line too; never the lead or a shown match. */
  investment?: boolean;
  /** v3.1 F1: the program's facts the fit lines sort (present.ts byRelevance) and later steps filter on. */
  card: Pick<Card, 'id' | 'status' | 'chains' | 'any_chain' | 'ends_at' | 'max_award_usd' | 'investment'>;
};
/** v3.1 F1: a card's facts a Fit keeps. Pure. */
const fitCard = (c: Card): Fit['card'] => ({
  id: c.id, status: c.status, chains: c.chains, any_chain: c.any_chain, ends_at: c.ends_at, max_award_usd: c.max_award_usd, investment: c.investment,
});
/**
 * v3.1 F1: the fit lines find and score name: every apply candidate, investments included, in the program list's
 * order (present.ts byRelevance: Base, then any chain; grants before investments; then the deadline), at most
 * FITS_MAX. Pure.
 */
export const fitLines = <F extends Pick<Fit, 'card'>>(applies: F[]): F[] => [...applies].sort((a, b) => byRelevance(a.card, b.card)).slice(0, FITS_MAX);
const isoOf = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
type ViewIn = {
  id: number; now: Date; read: BenchRead;
  /** D14: the caller's own installation, the one an X sign-in link is minted for (never the group root). */
  own: number;
  /** Fix round 1: signedOutNow (state 1: the sign-in question always wins). */
  signedOut: boolean;
  /** The one project's name before its first rescore wrote a row (identity's, else the repo's). */
  name: string | null;
  /** Programs the one project qualifies for (at most 3 are shown). */
  fits: Fit[];
  /**
   * v3 Stage 2 final review: the programs the apply step may offer: the fits plus the open investments (an
   * accelerator) the one project could apply to, deadline order. Never shown as fit lines. Defaults to the fits.
   */
  applies?: Fit[];
  cards: Card[]; skip: Set<string>;
  /** v3 Stage 2: the listed upcoming programs (never open), for the one upcoming line. */
  upcoming?: Card[];
  /** A17: the question this reply asks instead of the state's (an outcome question, a submission step). */
  held: string | null;
  due: string[];
  /** v2.13.4 (spec 4, R3): the one project's live link, checked (wording and program fit only). */
  live?: LiveSite | null;
  /** The tokens.fun ticker check the backing offer's proposal uses (ToolContext.tokenDeps.check). */
  check?: TickerCheck;
  /** When the reply's wait ends (start + REPLY_WAIT_MS); the backing offer waits until then, at least BACKING_WAIT_MIN_MS. */
  deadline?: number;
  /** v3.1 Task 7: test injection only (ToolContext.codesFetch): the background Builder Codes check's fetch. */
  codesFetch?: typeof fetch;
};

/** Test only: resolves when every running Builder Codes check has finished. */
export { codesSettled };
/**
 * v3.1 Task 7: the Builder Codes sentence from the stored answer (null when unknown, or the repo isn't App-proven). A missing or day-old answer
 * starts a check in the background (never awaited) for the next reply, unless one ran within the day.
 */
async function codesFor(id: number, key: string, now: Date, f: typeof fetch | undefined): Promise<string | null> {
  // Task 9 fix round 1: only a repo this builder proved through the App (a ranked project may be counted by another proof).
  if (!(await appProvenRepo(id, key))) return null;
  const known = await builderCodesKnown(key, now);
  refreshBuilderCodes(id, key, known, now, f);
  return builderCodesWords(key.toLowerCase(), known?.found ?? null);
}

/** v3 Stage 2 review: the backing offer (its tokens.fun ticker check) never holds a reply long; it gets at least this. */
export const BACKING_WAIT_MIN_MS = 1_000;
/**
 * The backing offer within the reply's wait. Past it, the reply goes on without the offer and the offer is told it is
 * late (set in the timer itself, before the race settles), so its moment is never claimed unshown. Never throws.
 */
async function boundedBacking(id: number, key: string, check: TickerCheck | undefined, deadline: number | undefined) {
  let late = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = Math.max(BACKING_WAIT_MIN_MS, (deadline ?? 0) - Date.now());
  const gaveUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      late = true;
      resolve(null);
    }, wait);
  });
  const offer = backingOffer(id, key, { check, late: () => late }).catch(logged('backing offer'));
  try {
    return await Promise.race([offer, gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one view find and score share (F19), in one of the four states (R16a): the project, the rank, the ways
 * to get funded (always), the one link and the one next step, stored for its yes, and the fields every
 * Bench reply carries: move_up, rank_lines, streak.
 */
async function benchView(o: ViewIn): Promise<{ view: BenchView; fields: Reply; moment: string | null }> {
  const { id, now, read } = o;
  const row = read.row;
  // v2.13.4: a live link that loads counts as live for wording and fit (R3), and names the project as its site does.
  const siteLive = o.live?.ok === true;
  const title = o.live?.ok ? o.live.title : null;
  const project: BenchProject | null = row
    ? { key: row.key, name: displayName(row.name, row.key, title), confirmed: row.confirmed, live: (row.shipped && row.kind === 'app') || row.site || siteLive, weeks: row.weeks }
    : read.main
      ? { key: read.main, name: displayName(o.name ?? read.main.split('/').pop() ?? read.main, read.main, title), confirmed: false, live: siteLive, weeks: 0 }
      : null;
  // v2.14 spec 2: a repo-key project that isn't confirmed: is it proven (the read-only App), held by another
  // person, or a copy?
  const isRepo = Boolean(project && REPO_KEY.test(project.key.toLowerCase()));
  const proof = project && !project.confirmed && isRepo ? await repoProof(id, project.key).catch(logged('repo proof')) : null;
  const taken = Boolean(proof && !proof.ok && proof.why === 'taken');
  // D14: the link is the caller's own installation's (standBase minted it for `own`). Fix round 1: a failed
  // mint is still signed out (a retry question), never read as signed in; A5 is only X actually off.
  const signIn = o.signedOut ? (read.base.signInLink ?? (await signInLink(o.own, now).catch(logged('sign-in link')))) : null;
  const streak = row?.streak ?? 0;
  const state = replyState({ signedIn: !o.signedOut, project, counted: Boolean(project?.confirmed) });
  // Fix round 1 (ruling 4): signed out, the sign-in question always wins over a held one.
  const held = state === 'signed_out' ? null : o.held;
  let variant: Variant = state !== 'not_counted' ? null : taken ? 'taken' : proof && !proof.ok && proof.why === 'copy' ? 'copy' : !isRepo ? 'no_repo' : null;
  const install = state === 'not_counted' && !variant ? await installLink(id, project!.key, now).catch(logged('install link')) : null;
  if (state === 'not_counted' && !variant && !install) variant = 'app_off';
  // Launch ready L2: with no project, the repo picker's install link (GitHub's page picks the repos; S7: a page is needed).
  const pick = state === 'no_project' ? await pickLink(id, now).catch(logged('pick link')) : null;
  // R10: a rank only in the ranked state; never beside "not on the leaderboard" or "isn't counted yet".
  const ranked = rankedState(state);
  const handle = read.base.claimed ? read.base.handle : null;
  // Launch ready L5: the ranked state's one next step is the weekly target (ranks only, never another builder's name).
  const aim = ranked ? await targetIn(id, read.parts, now) : null;
  const target = aim ? weeklyTarget(aim) : null;
  // v3 Stage 1 (spec 5.1): the connect weeks, once a person, before (and in place of) this reply's weekly moment.
  const connect = ranked && project && handle && !held ? await connectMoment(id, project.key, now) : null;
  // v3.1 (spec 3.2): the apply candidates: a fit closing within APPLY_WINDOW_DAYS (deadline order), else the rolling fits
  // (byRelevance), none the builder told EarnKit about. The first is the Best fit, the reply's lead.
  const open = ranked && project && !taken && !held
    ? applyCandidates((await openCandidates(id, o.applies ?? o.fits.slice(0, 3))) ?? [], read.seen, o.skip, now)
    : [];
  // v3.1 Task 7: Base Builder Grants' Best fit says whether the repo carries Builder Codes (the stored answer).
  const codes = open[0]?.program_id === BASE_GRANTS_ID && project ? await codesFor(id, project.key, now, o.codesFetch) : null;
  const best: BestFit | null = open[0]
    ? { program_id: open[0].program_id, title: open[0].title, prize: open[0].prize, when: open[0].when, why: open[0].why, codes }
    : null;
  // v3 Stage 2 (spec 5.3), v3.1 R1: the drafted application, once a program, before (and in place of) backing and the weekly moment.
  const apply = !connect && open.length > 0 ? await claimApply(id, read.seen, open, now) : null;
  // v3 Stage 2 (spec 5.3 Route 2): the backing offer, once a project, after the first approved week with code (EARNKIT_RAISING on);
  // an apply ask shown holds it (unclaimed) for a later reply.
  const backing = ranked && project && handle && !held && !connect && !apply ? await boundedBacking(id, project.key, o.check, o.deadline) : null;
  // Launch ready L6: the weekly moment, once a week per installation, never over a held question.
  const moment = ranked && project && handle && !held && !connect && !backing && !apply ? await weeklyMoment(o.own, id, project.key, handle, aim, now) : null;
  const link = state === 'signed_out' ? signIn : state === 'no_project' ? pick : state === 'ranked' ? (moment?.share ?? null) : install;

  let fund: FundLine[] = [];
  /** v2.13.3 (2): the programs named so far (never named twice). */
  const named = new Set<string>();
  // O2 fix round 1 (ruling 3): a repo another person holds is never offered a program for it (D6: the open
  // programs are still named, as for a builder with no project). R12: only programs the matcher fits, at most 3,
  // each with its deadline and why; never a generic open-all-year pick.
  if (project && !taken) {
    fund = o.fits.slice(0, 3).map((f) => ({ kind: 'fits', title: f.title, prize: f.prize, when: f.when, why: f.why }));
    for (const f of o.fits.slice(0, 3)) named.add(f.program_id);
  } else if (!project) {
    // v2.13.1 O2 (B1): never an idea that needs a live product or a repo for a builder with no project.
    // O5 N6: only a program with its own pitch.
    const idea = biggestPick(o.cards.filter((c) => ideaFitsOffer(c)), now, o.skip, null);
    if (idea) named.add(idea.id);
    fund = idea ? [{ kind: 'idea', who: idea.pitch?.who ?? idea.title, prize: earnPrize(idea), for: idea.pitch!.for! }] : [];
  }
  // v2.13.3 (2), v2.14 spec 4: "Ways to get funded" always shows (it's the hook): with no project, one not yet
  // counted or one another person holds, up to NEEDS_MAX open programs in all, each with what it needs. Never a
  // fit claimed. R12: a ranked project gets only its fits (none: noFitLine).
  const room = !project || !project.confirmed ? NEEDS_MAX - fund.length : 0;
  const has = taken ? {} : { live: project?.live ?? false, repo: Boolean(project && /^[^/:]+\/[^/]+$/.test(project.key)) };
  fund = [...fund, ...needsPicks(o.cards, now, new Set([...o.skip, ...named]), room, taken ? [] : (row?.chains ?? []), has)];

  // v3 Stage 2: a ranked builder on a 4-week streak (or more) hears of one program opening soon, the first by
  // the program list's order (byRelevance), shown only when no fit is (benchReply).
  if (ranked && streak >= UPCOMING_STREAK) {
    const soon = [...(o.upcoming ?? [])].filter((c) => c.status === 'upcoming' && c.opens_note && !o.skip.has(c.id)).sort(byRelevance)[0];
    if (soon) fund = [...fund, { kind: 'upcoming', title: soon.title, prize: earnPrize(soon), note: soon.opens_note! }];
  }

  // v3 Stage 2 (spec 5.2): Earned (fees claimed plus announced prizes), for the ranked stand line.
  const earned = ranked ? await earnedUsd(id, now).catch(logged('earned')) : null;
  // v3 Stage 2: backing open on the one project (pillOf: EARNKIT_RAISING on, launched, opened): a statement, never a step,
  // with its backers (backers.ts) and the creator fees claimed (earned.ts fees_usd).
  const pill = ranked && handle ? await pillCoin(id).catch(logged('backing pill')) : null;
  if (ranked && handle && pill) {
    const backers = (await backersOfCoin(pill.coin).catch(logged('backers'))) ?? 0;
    fund = [...fund, { kind: 'backing', backers, earned_usd: Math.round(earned?.fees_usd ?? 0), page: `${siteUrl()}${pagePath(handle)}` }];
  }

  // R8, L5, L6: each state's one next step; ranked: the share ask (the weekly moment), else the weekly target
  // (never an entry, a coin or going live).
  const finalAsk = stateAsk({ state, variant, project, link, handle, target, share: moment?.share ?? null, connect: Boolean(connect), backing: backing?.line ?? null, apply });
  // Only the ask shown is answerable: a held question clears the stored one. (The share offer stays open all week in
  // standing_seen.share_open, weeklyMoment.)
  const stored = held ? null : { kind: finalAsk.kind, key: finalAsk.project_key, ...(apply && finalAsk.kind === 'apply' && { program_id: apply.program_id, ...(apply.repo && { repo: apply.repo }) }) };
  await sql()`
    UPDATE builder_profiles SET standing_seen = CASE WHEN ${stored === null} THEN COALESCE(standing_seen, '{}'::jsonb) - 'bench_ask'
      ELSE COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb) END
    WHERE builder_id = ${id}`.catch(logged('ask'));
  const view: BenchView = {
    state, variant, project, rank: ranked ? read.ranks.bench : null, score: read.score, why: scoreWhy(read.parts, now), originality: read.originality,
    earned: earned?.paid_usd ?? 0, target, share: moment?.share ?? null, handle, link, fund, due: o.due, ask: finalAsk, held, best,
  };
  const note = finalAsk.kind === 'ship' ? SHIP_STEP_NOTE : finalAsk.kind === 'share' ? SHARE_NOTE : finalAsk.kind === 'connect' ? CONNECT_NOTE : finalAsk.kind === 'backing' ? BACKING_NOTE : finalAsk.kind === 'apply' ? APPLY_NOTE
    : finalAsk.kind === 'start' ? START_NOTE : finalAsk.kind === 'pick_repo' ? PICK_REPO_NOTE
    : finalAsk.kind === 'install_app' ? INSTALL_APP_NOTE : BENCH_MOVE_UP_NOTE;
  const fields: Reply = {
    ...(!held && { move_up: { kind: finalAsk.kind, project_key: finalAsk.project_key, agent_note: note } }),
    rank_lines: ranked ? [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x)) : [],
    streak,
  };
  return { view, fields, moment: connect ?? moment?.lines ?? null };
}

/**
 * v3 Stage 2 (spec 5.3), v3.1 (spec 3.2): the programs the apply step may offer, in the order offered: those not entered
 * or hidden (`skip`) nor declined in the last DECLINE_MS (standing_seen.declined, keyed by program); the dated ones
 * closing within APPLY_WINDOW_DAYS whose line says "closes <day>", deadline order (present.ts byDeadline); with none,
 * the rolling ones (no deadline), the program list's order (present.ts byRelevance). Pure.
 */
export function applyCandidates(fits: Fit[], seen: Seen, skip: Set<string>, now: Date): Fit[] {
  const t = now.getTime();
  const ok = fits.filter((f) => {
    const no = seen.declined?.[benchStepKey('apply', f.program_id)];
    return !skip.has(f.program_id) && !(no && t - Date.parse(no) < DECLINE_MS);
  });
  const soon = ok.filter((f) => {
    const end = f.ends_at ? Date.parse(f.ends_at) : NaN;
    return end > t && end - t <= APPLY_WINDOW_DAYS * 86_400_000 && f.when.startsWith('closes ');
  });
  if (soon.length > 0) return soon.sort((a, b) => byDeadline(a.card, b.card));
  return ok.filter((f) => f.ends_at === null).sort((a, b) => byRelevance(a.card, b.card));
}

/** v3 Stage 2: the fits the builder never told EarnKit about (builder_program_status, any status). Null on a read error. Never throws. */
async function openCandidates(id: number, fits: Fit[]): Promise<Fit[] | null> {
  if (fits.length === 0) return [];
  const told = await sql()<{ program_id: string }[]>`
    SELECT program_id FROM builder_program_status WHERE installation_id = ${id} AND program_id = ANY(${fits.map((f) => f.program_id)}::text[])`.catch(logged('apply told'));
  if (!told) return null;
  const known = new Set(told.map((r) => r.program_id));
  return fits.filter((f) => !known.has(f.program_id));
}

/**
 * v3 Stage 2: the apply ask: the first of `open` never asked before (standing_seen.apply_asked, set here in one guarded
 * UPDATE: asked once a program). `when`: the deadline's day ("Nov 18"), null when rolling. Null otherwise. Never throws.
 */
async function claimApply(id: number, seen: Seen, open: Fit[], now: Date): Promise<(ApplyPick & { repo?: string }) | null> {
  const pick = open.find((f) => !seen.apply_asked?.[f.program_id]);
  if (!pick) return null;
  const [taken] = await sql()`
    UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{apply_asked}',
      COALESCE(standing_seen->'apply_asked', '{}'::jsonb) || jsonb_build_object(${pick.program_id}::text, ${now.toISOString()}::text))
    WHERE builder_id = ${id} AND NOT COALESCE(standing_seen->'apply_asked' ? ${pick.program_id}, false) RETURNING 1`.catch((err: unknown) => {
    logged('apply asked')(err);
    return [];
  });
  if (!taken) return null;
  return { program_id: pick.program_id, title: pick.title, when: pick.ends_at ? pick.when.replace(/^closes /, '') : null, ...(pick.repo && { repo: pick.repo }) };
}

/**
 * v3 Stage 1 (spec 5.1): the backfilled weeks to confirm ("Your last 3 weeks:" and a line each), when this person
 * hasn't been offered them (connectDue). Shown: the offer opens (openConnect). None to confirm once the backfill is
 * complete (backfillComplete): connect_done, never asked; before that, asked again on a later reply. A failed read is no lines, asked again on a later reply. Never throws.
 */
async function connectMoment(id: number, key: string, now: Date): Promise<string | null> {
  if (!(await connectDue(id))) return null;
  const weeks = await connectWeeks(id, key, now).catch(logged('connect weeks'));
  if (!weeks) return null;
  if (weeks.length === 0) {
    // v3 final review: closed only once the backfill is complete; until then the offer waits for its rows.
    if (await backfillComplete(id, key, now).catch(logged('connect backfill'))) await closeConnect(id, now);
    return null;
  }
  await openConnect(id, { key, weeks: weeks.map((w) => w.monday) });
  return [CONNECT_HEAD(weeks.length), ...weeks.map((w) => w.line)].join('\n');
}

/**
 * Launch ready L6: last week's lines, the new week's line and the share link, when this installation hasn't seen this
 * week's moment, the builder had a ranked day last week, and last week's ship log is ready (momentReady: the weekly
 * job wrote it, or its Monday hour passed). Else null, and the week stays unclaimed. Claimed only when shown
 * (takeMoment); the share offer then stays open for the week (openShare). Never throws.
 */
async function weeklyMoment(own: number, id: number, key: string, handle: string, aim: TargetIn | null, now: Date): Promise<{ lines: string; share: string } | null> {
  if (!(await momentDue(own, now))) return null;
  const last = await lastWeekOf(id, key, now).catch(logged('last week'));
  if (!last || !momentReady(last.checked, now)) return null;
  // v3 Stage 1 fix round 1: a week already confirmed (the connect yes) is never asked about again; the week is claimed.
  if (last.approved) {
    await takeMoment(own, now);
    return null;
  }
  if (!(await takeMoment(own, now))) return null;
  await openShare(id, { key, week: last.monday, shown_week: isoWeekOf(now) });
  return { lines: momentLines(last, aim ? weekStartLine(aim) : null).join('\n'), share: shareLink(handle, last.now) };
}

/**
 * v2.14 T4 (leaked authorize URL): "Signed in as @<handle>." once, on the first Bench reply after the caller's
 * installation was bound to X (attachToX sets installations.x_signed_in_unseen), so a builder notices a wrong
 * account. Null otherwise. Never throws.
 */
export async function takeSignedIn(own: number, handle: string | null): Promise<string | null> {
  // Final fix 11: cleared only when the line can be shown (a handle), so a reply whose read failed (EMPTY_BASE, no
  // handle) never eats it; the next reply with the page shows it once.
  if (!handle) return null;
  const [r] = await sql()`UPDATE installations SET x_signed_in_unseen = false WHERE id = ${own} AND x_signed_in_unseen RETURNING 1`.catch((err: unknown) => {
    logged('signed in')(err);
    return [];
  });
  return r ? signedInLine(handle) : null;
}

/** O5 fix round 1: a match of the one project is kept this long for a reply that can't wait for it. */
export const BENCH_MATCH_KEEP_MS = 60 * 60_000;
type KeptMatch = { checked: number; scored?: number; fits: RepoFit[] };
/**
 * O5 fix round 1 (N1): the one project's last match (standing_seen.bench_match), written whenever a match
 * finishes, in time or after the reply, so the next reply shows its ways to get funded even when matching
 * a big repo again is cut by the reply's wait. Never throws.
 */
export async function keepBenchMatch(id: number, key: string, m: KeptMatch, now: Date): Promise<void> {
  const kept = { key: key.toLowerCase(), at: now.toISOString(), checked: m.checked, scored: m.scored ?? 0, fits: m.fits };
  await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_match', ${sql().json(kept as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('keep match'));
}
/** The kept match of `key`, under BENCH_MATCH_KEEP_MS old, or null. Never throws. */
export async function keptBenchMatch(id: number, key: string, now: Date): Promise<KeptMatch | null> {
  const [r] = await sql()<{ m: { key?: string; at?: string; checked?: number; scored?: number; fits?: unknown } | null }[]>`
    SELECT standing_seen->'bench_match' AS m FROM builder_profiles WHERE builder_id = ${id}`.catch(() => []);
  const m = r?.m;
  if (!m || m.key !== key.toLowerCase() || typeof m.at !== 'string' || now.getTime() - Date.parse(m.at) >= BENCH_MATCH_KEEP_MS || !Array.isArray(m.fits)) return null;
  return { checked: m.checked ?? 0, scored: m.scored ?? 0, fits: m.fits as KeptMatch['fits'] };
}

/** What find hands benchFind: standFind's arguments, plus the project the agent named. */
export type BenchFindArgs = {
  /** O5 fix round 1: when the call started (Date.now()); every wait ends by start + REPLY_WAIT_MS. */
  start?: number;
  first: FirstMessage;
  cards: FirstMessage['cards'];
  repos: YourRepos | null;
  myEntries: NonNullable<FirstMessage['entries']>;
  /** A results question (an entry's) or, v3 Stage 2, an application's outcome question (kind 'apply', no entry). */
  ask: { kind?: 'results' | 'apply'; project_id: number | null; program_id: string; name: string; program_title: string } | null;
  alerts: { lines: string[] };
  hide: Set<string>;
  project: IdentityProject | null;
  /** Fix round 1: tools.ts's signedOutNow (it skipped the results question while signed out). */
  signedOut?: boolean;
  /** v3 Stage 2: the listed upcoming programs (listPrograms, status 'upcoming'). */
  upcoming?: Card[];
};

/**
 * find: the three parts in one of the four states (R16a), the one project's proof in the same turn
 * (plan B3) and news since the last look (a statement line above, no link and no question). A results
 * question or a submission step due is the reply's one question (A17). tools.ts adds ask_outcome, matches,
 * programs, working_on and wallet_note. Never a daily-check note.
 */
export async function benchFind(ctx: ToolContext, a: BenchFindArgs): Promise<Reply> {
  const id = ctx.installationId;
  const now = a.first.now;
  const own = ctx.ownInstallationId ?? id;
  const read = await benchRead(id, own);
  const live = await liveOf(id, read, now, (a.start ?? Date.now()) + REPLY_WAIT_MS - Date.now());
  const m = { cards: a.cards, repos: a.repos, entries: a.myEntries, now };
  const entered = enteredIds(m);
  const main = read.main?.toLowerCase() ?? null;
  // Ways to get funded: the programs the one project could apply to (an investment included), deadline order
  // (present.ts byDeadline) for the apply step. v3.1 F1: the fit lines are these same rows in the program list's
  // order (fitLines, as score's); lead and recordShown use the fit lines' grants (never an investment).
  const can = main
    ? layout(m, entered).rows
        // v3 Stage 2: an in-person program is never a fit (a fit is applying from the ship log); it stays on /programs.
        .filter((r) => canApply(r) && !r.card.sponsored && !r.card.in_person && !entered.has(r.card.id) && (r.key ?? r.repo).toLowerCase() === main)
        .sort((a, b) => byDeadline(a.card, b.card))
    : [];
  const facts = new Map((a.repos && 'fits' in a.repos ? a.repos.fits : []).map((f) => [f.repo, f]));
  const fitOf = (r: (typeof can)[number]): Fit => {
    const f = facts.get(r.repo);
    const why = fitWhy(r.card, whyFacts({ chains: f?.facts?.chains, homepage: f?.facts?.homepage, live_verified: f?.live_verified ?? f?.facts?.live_verified }));
    return {
      program_id: r.card.id, repo: r.repo, title: r.card.title, prize: earnPrize(r.card), when: fundWhen(r.card), why, ends_at: isoOf(r.card.ends_at),
      investment: r.card.investment === true, card: fitCard(r.card),
    };
  };
  const shownRows = fitLines(can);
  const fits: Fit[] = shownRows.map(fitOf);
  const rows = shownRows.filter((r) => !r.card.investment);
  const leadFit = fits.find((f) => !f.investment);
  const applies: Fit[] = can.map(fitOf);
  const signedOut = a.signedOut ?? (await signedOutNow(id, own).catch(() => true));
  // Fix round 1: signed out, the sign-in question wins; the submission step waits for the bind too.
  const submit = a.ask || signedOut ? undefined : submitStep(m);
  // A17: a results question, else a submission step, is the one question (never a money line).
  const held = signedOut ? null : a.ask ? outcomeLine(a.ask) : submit ? submitStepLine(submit) : null;
  const due = a.first.deadline ? [a.first.deadline] : [];
  const skip = new Set([...entered, ...a.hide]);
  const name = a.project && projectKeyOf(a.project).toLowerCase() === main ? a.project.name : null;
  const { view, fields, moment } = await benchView({
    id, now, read, own, signedOut, name, fits, applies, cards: a.cards, upcoming: a.upcoming ?? [], skip, held, due, live, check: ctx.tokenDeps?.check,
    deadline: (a.start ?? Date.now()) + REPLY_WAIT_MS, codesFetch: ctx.codesFetch,
  });
  const taken = view.variant === 'taken';
  const lead = Boolean((leadFit && !submit && !taken) || submit);
  // Every reply asks one question now, so news never carries a card offer of its own. R10: the news (a move up
  // the rank) is shown only when the reply itself shows that rank; otherwise it is still recorded, never shown.
  const recorded = read.profiled ? await takeNews(id, read.seen, read.base, now, false).catch(logged('news')) : null;
  const news = view.rank ? recorded : null;
  const opener = newsOpener(a.alerts.lines, news ? [news] : []);
  const signedIn = await takeSignedIn(own, view.handle);
  await recordShown(
    id,
    rows.flatMap((r) =>
      r.key && r.row
        ? [{ program_id: r.card.id, repo_key: r.key, status: r.v.status, product_score: r.product_score, row_level: r.row.level, traction: r.product_score === null ? null : r.traction }]
        : [],
    ),
  ).catch(logged('match shown'));
  return {
    // L6: the weekly moment leads (after the account line, which guards a wrong sign-in).
    show_to_builder: [signedIn, moment, opener, benchReply(view)].filter(Boolean).join('\n\n'),
    // O5 (P8): the earn note names lead.program_id, so only with a lead.
    note: ['Show show_to_builder to the builder exactly as written.', lead ? EARN_NOTE : null].filter(Boolean).join(' '),
    ...fields,
    ...(leadFit && !submit && !taken && { lead: { program_id: leadFit.program_id, repo: leadFit.repo } }),
    ...(submit && { lead: { program_id: submit.card.id, step: 'submit', ...(submit.entry.id !== undefined && { project_id: submit.entry.id }) } }),
  };
}

/**
 * score on the Bench: the profile (and a discovery run) on the first call, the refresh within
 * its budget, then find's view without a matcher: the one project's fits from what find last saw
 * (stand-view.ts scoreFits, at most 3, R12). One score_viewed event a minute (v2.12). Null without a
 * profile (score-tool.ts answers that).
 */
export async function benchScore(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps' | 'codesFetch'>, now: Date, o: { reader?: ReaderDeps } = {}): Promise<Reply | null> {
  const id = ctx.installationId;
  const made = await ensureProfile(id, now);
  if (!made) return null;
  if (made.created) await enqueueDiscovery(id, 'first_find');
  // O5 N1: the refresh runs on, but the reply waits for it at most REPLY_WAIT_MS.
  const start = Date.now();
  const refresh = startRefresh(id, { now, start, reader: o.reader });
  await refresh.within(REPLY_WAIT_MS);
  // D14: the caller's own installation, as find's.
  const own = ctx.ownInstallationId ?? id;
  const read = await benchRead(id, own);
  const live = await liveOf(id, read, now, start + REPLY_WAIT_MS - Date.now());
  const [programs, entries, memory] = await Promise.all([listPrograms().catch(() => []), openEntries(id).catch(() => []), readMemory(id).catch(() => null)]);
  const all = (programs as (Card & { agent_completable?: boolean; earnkit_campaign?: boolean; starts_at: Date | null; opened_at: Date | null })[])
    .filter((p) => p.agent_completable !== false && !p.earnkit_campaign);
  // v3 Stage 2: an upcoming program is never a fit or an offer; it only feeds the one upcoming line.
  const upcoming = all.filter((p) => p.status === 'upcoming');
  const cards = all.filter((p) => p.status !== 'upcoming');
  const hidden = memory ? hiddenIds(hiddenPrograms(memory, cards.map((c) => ({ id: c.id, starts_at: c.starts_at, ends_at: c.ends_at ?? null, opened_at: c.opened_at })))) : new Set<string>();
  const entered = new Set(entries.map((e) => e.program_id));
  const shown = cards.filter((c) => !hidden.has(c.id));
  const main = read.main?.toLowerCase() ?? null;
  // v3 Stage 2 final review: the apply step's candidates include an open investment. v3.1 F1: so do the fit lines (fitLines).
  const applies: Fit[] = main
    ? (await scoreFits(id, main, { cards: shown, skip: new Set([...entered, ...hidden]), now })).map((f) => ({
        program_id: f.card.id, title: f.card.title, prize: earnPrize(f.card), when: fundWhen(f.card), why: fitWhy(f.card, whyFacts(f.repo)), ends_at: isoOf(f.card.ends_at),
        investment: f.card.investment === true, card: fitCard(f.card),
      }))
    : [];
  const fits: Fit[] = fitLines(applies);
  const leadFit = fits.find((f) => !f.investment);
  const { view, fields, moment } = await benchView({
    id, now, read, own, signedOut: await signedOutNow(id, own).catch(() => true), name: null, fits, applies, cards: shown, upcoming, skip: new Set([...entered, ...hidden]), held: null,
    due: [], live, check: ctx.tokenDeps?.check, deadline: start + REPLY_WAIT_MS, codesFetch: ctx.codesFetch,
  });
  await noteEvent('score_viewed', () => ({
    type: 'score_viewed',
    dedupe_key: `score_viewed:${id}:${Math.floor(now.getTime() / 60_000)}`,
    installation_id: id,
    detail: { rank: read.base.standing.ranked ? read.base.standing.rank : null, total: read.base.standing.total },
  }));
  const signedIn = await takeSignedIn(own, view.handle);
  return {
    show_to_builder: [signedIn, moment, benchReply(view)].filter(Boolean).join('\n\n'),
    ...fields,
    ...(leadFit && view.variant !== 'taken' && { lead: { program_id: leadFit.program_id }, note: EARN_NOTE }),
  };
}

/** T8 fix round 1: ask kinds a pre-v2.14 reply may have stored (the updates yes and the week's post). */
const RETIRED_ASKS = ['updates', 'post_update'] as const;
/**
 * T9 fix round 1: other retired kinds: a yes clears them and is "Okay.". The build ask and grants (pre-v2.14);
 * R8: the entry, coin, community-round and go-live asks a reply stored before the ranked step became
 * "Ship this week to climb." (a token is offered only when the builder asks: tokenAsk).
 */
const OLD_ASKS = ['build', 'grants', 'grants_later', 'enter', 'coin', 'raise', 'go_live'] as const;
/** v2.14 spec 4: the asks answered once (cleared before the yes runs). */
const TAKEN_ONCE: readonly string[] = ['sign_in', 'start', 'pick_repo', 'install_app', 'other_project', 'repo_behind', 'ship', 'suggest', 'apply', 'backing', ...RETIRED_ASKS, ...OLD_ASKS];

/** The ask stored with the last Bench reply, when the agent's answer names it (kind, if given, and project_key). */
export async function benchAsked(id: number, m: { kind?: string; project_key?: string | null }): Promise<{ kind: string; key: string | null; program_id?: string; repo?: string } | null> {
  const [p] = await sql()<{ ask: Seen['bench_ask'] | null }[]>`SELECT standing_seen->'bench_ask' AS ask FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
    logged('asked')(err);
    return [];
  });
  const asked = p?.ask;
  if (!asked || typeof asked !== 'object' || typeof asked.kind !== 'string') return null;
  if (m.kind !== undefined && m.kind !== asked.kind) return null;
  if ((m.project_key ?? null)?.toLowerCase() !== (asked.key ?? null)?.toLowerCase()) return null;
  return asked;
}

/**
 * The builder's yes or no to the Bench's last line (tools.ts moveUpAnswer routes it here; an open coin
 * offer's answer stays there). Only the ask stored with the last reply is answered; anything else is
 * "Okay." with nothing changed. A no is noted (standing_seen.declined) and clears the ask; the next reply asks its state's step again.
 */
export async function benchMoveUp(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'tokenDeps'>, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no'; live_url?: string }): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  const okay = { show_to_builder: NOTED_LINE };
  // v3 Stage 1 (spec 5.1): the connect offer is answerable once (standing_seen.connect_open is its guard).
  if (m.kind === 'connect') {
    const r = await answerConnect(id, m.project_key, m.answer, now).catch(logged('answer connect'));
    if (r && r.pending > 0) {
      // An approval threw and the offer reopened: keep the ask so the next yes retries it.
      const [o] = await sql()<{ key: string | null }[]>`SELECT standing_seen->'connect_open'->>'key' AS key FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
        logged('connect key')(err);
        return [];
      });
      const key = o?.key ?? m.project_key ?? null;
      const ask = { kind: 'connect', key };
      await sql()`UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(ask as never)}::jsonb) WHERE builder_id = ${id}`.catch(logged('keep connect ask'));
      return { show_to_builder: CONNECT_RETRY, move_up: { kind: 'connect', project_key: key, agent_note: CONNECT_NOTE } };
    }
    if (r) await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'connect'`.catch(logged('clear connect ask'));
    if (!r || r.approved === 0) return okay;
    const [p] = await sql()<{ handle: string | null }[]>`SELECT x_handle AS handle FROM builder_profiles WHERE builder_id = ${id}`.catch((err: unknown) => {
      logged('connect handle')(err);
      return [];
    });
    const done = p?.handle ? CONNECT_DONE(`${siteUrl()}${pagePath(p.handle)}`) : APPROVED_CONNECT;
    // The Done line is a statement, so the email question (when it is asked) is the reply's one question.
    const email = digestEnabled() ? await askWeeklyEmail(id, { shared: false, email: null }).catch(logged('connect email')) : null;
    return { show_to_builder: [done, email?.question].filter(Boolean).join('\n'), ...(email && { agent_note: email.agent_note }) };
  }
  // Launch ready L6 (fix round 1): the share offer is answerable all week it was shown, once (standing_seen.share_open).
  if (m.kind === 'share') {
    const r = await answerShare(id, m.project_key, m.answer, now).catch(logged('answer share'));
    if (r === true) {
      await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id} AND standing_seen->'bench_ask'->>'kind' = 'share'`.catch(logged('clear share ask'));
      // v3 Stage 1 (spec 5.4): the first yes after activation asks for the address, once (digest_asked_at), as the reply's one question.
      const email = digestEnabled() ? await askWeeklyEmail(id, { shared: false, email: null }).catch(logged('share email')) : null;
      return { show_to_builder: [APPROVED_LINE, email?.question].filter(Boolean).join('\n'), ...(email && { agent_note: email.agent_note }) };
    }
    return okay;
  }
  const asked = await benchAsked(id, m);
  if (!asked) return okay;
  // v3 Stage 2 (spec 5.3 Route 2): the backing offer is the coin offer's (coinAnswer): a yes is the coin flow's note
  // (confirm { project_id }), a no is remembered on coin_moments and counts toward DECLINES_MAX. Answered once.
  if (asked.kind === 'backing') {
    const [taken] = await sql()`
      UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
      WHERE builder_id = ${id} AND standing_seen->'bench_ask' = ${sql().json(asked as never)}::jsonb RETURNING 1`.catch((err: unknown) => {
      logged('take backing ask')(err);
      return [];
    });
    if (!taken || !asked.key) return okay;
    return (await import('./tools')).coinAnswer(ctx, { project_key: asked.key, answer: m.answer });
  }
  if (m.answer === 'no') {
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${benchStepKey(asked.kind, asked.kind === 'apply' ? (asked.program_id ?? null) : asked.key)}::text, ${now.toISOString()}::text)) - 'bench_ask'
      WHERE builder_id = ${id}`.catch(logged('decline'));
    return okay;
  }
  // Fix round 1: answered once. The ask is cleared before the yes runs, so a retried yes is "Okay.".
  if (TAKEN_ONCE.includes(asked.kind)) {
    const [taken] = await sql()`
      UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
      WHERE builder_id = ${id} AND standing_seen->'bench_ask' = ${sql().json(asked as never)}::jsonb RETURNING 1`.catch((err: unknown) => {
      logged('take ask')(err);
      return [];
    });
    if (!taken) return okay;
  }
  // v2.14 spec 3: the ship log writes itself; a yes to a retired posting ask says so.
  if ((RETIRED_ASKS as readonly string[]).includes(asked.kind)) return { show_to_builder: UPDATE_LINES.auto };
  switch (asked.kind) {
    case 'sign_in':
      return { show_to_builder: '', agent_note: SIGN_IN_YES_NOTE };
    case 'start':
      return { show_to_builder: '', agent_note: START_YES_NOTE };
    case 'pick_repo':
      return { show_to_builder: '', agent_note: PICK_REPO_YES_NOTE };
    case 'install_app':
      return { show_to_builder: '', agent_note: INSTALL_APP_YES_NOTE };
    case 'other_project':
      return { show_to_builder: '', agent_note: OTHER_PROJECT_NOTE };
    case 'repo_behind':
      return { show_to_builder: '', agent_note: REPO_BEHIND_NOTE };
    case 'ship':
    case 'suggest':
      return asked.key ? { show_to_builder: '', agent_note: SHIP_NOTE } : okay;
    case 'apply':
      // v3 Stage 2: prepare drafts the entry; the lead names the program (and the repo find matched).
      return asked.program_id
        ? { show_to_builder: '', agent_note: APPLY_YES_NOTE(asked.program_id), lead: { program_id: asked.program_id, ...(asked.repo && { repo: asked.repo }) } }
        : okay;
    default:
      // A retired ask (OLD_ASKS): nothing to do; the next reply asks the state's step.
      return okay;
  }
}

/** Launch ready L2: tell main_project's lines (the builder named the repo to rank instead). */
export const RANK_LINES = {
  set: (key: string) => `EarnKit now ranks github.com/${key}.`,
  same: (key: string) => `EarnKit already ranks github.com/${key}.`,
  notProven: (key: string) => `github.com/${key} isn't connected yet.`,
  install: (key: string, link: string) => `github.com/${key} isn't connected yet. Install the read-only EarnKit app on it (one click): ${link}\nWant me to rank it once that's done?`,
} as const;
export const RANK_SET_NOTE = "Call find to show where they stand now. Don't show this note.";
export const RANK_INSTALL_NOTE =
  "Once the builder has installed EarnKit on it from the link, call tell with main_project again. Don't show this note.";

/**
 * Launch ready L2: tell main_project. The one project moves to `repo` when this person proved it with the App
 * (main-project.ts rankRepo), and they are rescored at once; otherwise that repo's own install link (S7: only
 * with a page) is offered, and nothing changes.
 */
export async function rankAnswer(ctx: Pick<ToolContext, 'installationId'>, key: string): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  const r = await rankRepo(id, key);
  if (r === 'same') return { show_to_builder: RANK_LINES.same(key) };
  if (r === 'set') {
    await (await import('./person-score')).rescorePerson(id, now).catch(logged('rank rescore'));
    (await import('./profile-cache')).profileChanged();
    return { show_to_builder: RANK_LINES.set(key), agent_note: RANK_SET_NOTE };
  }
  // Fix round 1 (M5): that repo's own install link (its setup proves exactly it), never the picker's.
  const link = REPO_KEY.test(key) ? await installLink(id, key, now).catch(logged('install link')) : null;
  return link ? { show_to_builder: RANK_LINES.install(key, link), agent_note: RANK_INSTALL_NOTE } : { show_to_builder: RANK_LINES.notProven(key) };
}

/** v2.14 signed_out: the yes to "Want me to put your work on the Bench once you're in?". */
export const SIGN_IN_YES_NOTE =
  "If show_to_builder had no sign-in link, call find again for it. When the builder has signed in with X from the link, they get a code: call find with sign_in_code set to it. Don't show this note.";
/** v2.14 not_counted, no repo named: the yes to "Where does <project> live on GitHub?" names it. */
export const REPO_BEHIND_NOTE =
  "Ask the builder in one short question for the GitHub repo behind their project, then call find with identity.project: { name, repo, live_url }. Don't show this note.";
/** Owner ruling A (v2.13.3): the yes to "What's your GitHub, or a link to something you've made?". */
export const START_YES_NOTE =
  "Ask the builder in one short question for their GitHub login or a link to something they've made, then call find with identity: { github_login, project: { name, repo or live_url } }. Don't show this note.";
/** Launch ready L2: the yes to "Want me to rank it once that's done?" (the repo picker). */
export const PICK_REPO_YES_NOTE =
  "Once the builder has installed EarnKit from the link and picked their repos on GitHub, call find again. Don't show this note.";
/** v2.13.3 (5): the yes to the install ask. */
export const INSTALL_APP_YES_NOTE =
  "Once the builder has installed EarnKit on the repo from the link, call find again. Don't show this note.";
/** v2.13.1 O2 fix round 1 (ruling 3): taken or a copy: the yes to "Want to use a different project?". */
export const OTHER_PROJECT_NOTE =
  "Ask the builder in one short question which project is theirs (a repo under their own GitHub account), then call find with identity.project: that project. Don't show this note.";
/** O5 N5, R8: the yes to "Ship this week to climb." (or app_off's "Want me to suggest one small thing to ship ..."). */
export const SHIP_NOTE =
  "Look at the project in this folder (git log, open issues, the README) and suggest one small thing to ship this week, in one short line, then ask if they want you to build it now. Don't show this note.";
