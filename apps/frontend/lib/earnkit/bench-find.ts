import { sql } from './db';
import { noteEvent } from './events';
import { enqueueDiscovery } from './discovery';
import { ensureProfile } from './profiles';
import { listPrograms } from './programs';
import { openEntries } from './projects';
import { hiddenIds, hiddenPrograms, readMemory } from './builder-memory';
import { recordShown } from './match-loop';
import { markFreshOffer, readBuild, type StoredBuild } from './installations';
import { benchConfirmedSql, confirmingFast } from './main-project';
import { branchToRemove, checkProofBranch, proofBranchFor, type BranchState } from './proof-branch';
import { REPLY_WAIT_MS, settleWithin } from './reply-wait';
import { rankLines, type RankLines } from './bench-rank';
import { WEEKLY_UPDATE_NOTE, setUpdates } from './updates';
import { mondayOf } from './weeks';
import { COIN_NOTE, offerCoin } from './coin-moments';
import { markRaiseAsked, raiseAsk, raisingCoin, setRaising } from './raising';
import { BENCH_BUILD_ID, benchOffer, benchStarter, freshPick, type FreshPick } from './fresh-build';
import { NEEDS_LIVE_PRODUCT } from './guide';
import { siteUrl } from './entry-text';
import { pagePath } from './reserved-routes';
import { STARTERS, type Starter } from './starters';
import { EARN_NOTE, newsOpener } from './where-you-stand';
import { COUNT_LINES } from './make-countable';
import {
  biggestPick, declinedNow, earnPrize, earnWhen, hostFor, moneyFallback, rollingPick, scoreEarn, showable, standBase, startRefresh, takeNews,
  type Seen as StandSeen, type StandBase,
} from './stand-view';
import { byPrize, enteredIds, freshLead, layout, qualifies, submitStep, submitStepLine, type Card, type FirstMessage, type FreshOn, type RepoFit, type YourRepos } from './present';
import type { ReaderDeps } from './source-readers';
import type { TickerCheck } from './token-proposal';
import { projectKeyOf, type IdentityProject } from './identity-input';
import type { ToolContext } from './tools';
import { CHAIN_NAMES, type Chain } from './chains';
import { githubAppEnabled } from './github-app';
import { createVerifyLink } from './github-verify';
import {
  GRANTS_LATER_ASK, POST_UPDATE_ASK, UPDATES_ASK, UPDATES_ASK_JOINING, benchReply, benchStepKey, chooseAsk, claimAsk, enterAsk, installAppAsk, startBuildAsk,
  showsClaimLink, type BenchAsk, type BenchAskKind, type BenchProject, type BenchView, type FundLine,
} from './bench-reply';
import { liveSite, type LiveSite } from './live-check';
import { DETACH_LINES, NEW_AGENT_LINES, detachJoin, joinNotice, newlyJoined } from './page-joins';
import { displayName } from './bench-reply';
export { displayName };

/**
 * v2.13 T8 (spec "2a", "2b", "5. Ways to get funded", "The last line"): the reads and writes behind
 * find's and score's three parts under the Bench flag (bench-reply.ts is pure). Both build one view
 * (benchView): the one project as the Bench sees it, its rank, the ways to get funded and the one
 * question; the question asked is stored (standing_seen.bench_ask) so a yes is answered as asked,
 * never by the agent's kind. Never throws on its own reads: each falls back as standFind's do.
 */

export const BENCH_MOVE_UP_NOTE = 'A yes or no to the last line: call tell with move_up: { kind, project_key, answer } (kind and project_key as given here). Do the steps it returns yourself; never ask the builder to edit files.';
export const UPDATES_NOTE = BENCH_MOVE_UP_NOTE;
export const POST_UPDATE_NOTE = "Write this week's update now: one plain paragraph from git log for the week and what you deployed, at most 280 characters, links only to the live site or the repo. Call tell with update: { text }. Don't show this note.";
export const ENTER_NOTE = "Prepare it: call prepare with program_id as given. Don't show this note.";
/**
 * v2.13.3 (3): the no-project ask offers both, so its note routes both: existing work goes to find with
 * identity, a yes (or "build something") to move_up.
 */
export const START_NOTE =
  "If the builder sends their GitHub login or a link to something they've made, call find with identity: { github_login, project: { name, repo or live_url } }. " +
  "A yes or 'build something': call tell with move_up: { kind, project_key, answer: 'yes' } (as given here); a no: answer 'no'. Don't show this note.";
/** v2.13.3 (5): the install ask (the link in the reply, or after the X claim, in the next reply). */
export const INSTALL_APP_NOTE =
  "The builder installs EarnKit (read-only) on the repo from the link in show_to_builder; if there is no link yet, it comes in the next find once their page is claimed. " +
  "A yes or no: call tell with move_up: { kind, project_key, answer } (as given here). Once they installed it, call find again, which checks the repo. Don't show this note.";
/** v2.13.4 (spec 2): the claim ask (the claim link in show_to_builder, then one yes or no). */
export const CLAIM_NOTE =
  "The builder claims their page with X from the link in show_to_builder. A yes or no: call tell with move_up: { kind, project_key, answer } (as given here). " +
  "Once they say they've signed in, call find again. Don't show this note.";
/** v2.13.4: the yes to the claim ask. */
export const CLAIM_YES_NOTE = "Once the builder has signed in with X from the link, call find again. Don't show this note.";
/** The yes to the build ask: the v2.11 build path, started for the program the ask named. */
export const buildYesNote = (programId: string) =>
  `Call prepare with build: { start: true, program_id: '${programId}' } and program_id: '${programId}' at the top. EarnKit then asks the builder one question before any work starts. Don't show this note.`;

/** What the person was last told (stand-view's Seen) plus the Bench's own: the ask, the weekly-task note, T9's raise. */
export type Seen = StandSeen & {
  bench_ask?: { kind: BenchAskKind; key: string | null; program_id?: string };
  raise_asked?: Record<string, string>;
  weekly_note_at?: string;
  /** O5 N5: asks kept away for GRANTS_QUIET_MS after a yes that found nothing (step key -> when). */
  quiet?: Record<string, string>;
};
/** O5 N5: a grants yes that found nothing keeps the grants ask away this long (the next step is asked instead). */
export const GRANTS_QUIET_MS = 7 * 86_400_000;
/** O5 N5: the step keys quiet at `now` (benchStepKey, as `declined`). Pure. */
export const quietNow = (seen: Seen, now: number): string[] =>
  Object.entries(seen.quiet && typeof seen.quiet === 'object' ? seen.quiet : {})
    .filter(([, at]) => typeof at === 'string' && now - Date.parse(at) < GRANTS_QUIET_MS)
    .map(([k]) => k);
type Reply = Record<string, unknown>;

/** The one project's builder_projects row, as the Bench sees it (confirmed: benchConfirmedSql). */
type MainRow = { key: string; name: string; kind: string; shipped: boolean; people: number; has_coin: boolean; weeks: number; streak: number; confirmed: boolean; site: boolean; chains: string[] };

/** v2.13.1 O2 (B4): a build started this long ago, with no live link sent, is still in progress. */
export const BUILD_OPEN_MS = 24 * 60 * 60_000;
/**
 * v2.13.1 O2 (B4): the person's build in progress: started under BUILD_OPEN_MS ago and its live link not
 * sent yet (done_at). `name`: once the twist passed, the build's; before, "your tip jar". Pure.
 */
export function buildInProgress(b: StoredBuild | null, now: Date, starters: Record<string, Starter> = STARTERS): { name: string } | null {
  if (!b || b.done_at) return null;
  const at = Date.parse(b.started_at);
  if (!Number.isFinite(at) || now.getTime() - at >= BUILD_OPEN_MS) return null;
  if (b.name) return { name: b.name };
  // Fix round 1 (minor): before the twist, "Building your tip jar" (the starter's offer, no chain).
  const s = Object.hasOwn(starters, b.starter_id) ? starters[b.starter_id] : undefined;
  return { name: `your ${s ? benchOffer(s).replace(/^an? /, '') : 'app'}` };
}

/**
 * v2.13.1 O2 (B1): what a builder with no project is offered: a program's fresh build when one
 * qualifies (card set), else the starter build with no program (card null, BENCH_BUILD_ID). Null when
 * EarnKit can't deploy or host any tested starter.
 */
export type BenchPick = { card: Card | null; starter: Starter; canBuild: boolean };
// Owner ruling A (v2.13.3): never the generic starter with no program (the tip jar): only a program's own
// fresh build, whose owner-set starter (program file fresh_build) is the one that can compete in it.
const withNoProgram = (program: (FreshPick & { canBuild: boolean }) | null, _fresh: FreshOn | undefined, _now: Date): BenchPick | null => program;
/** v2.13.1 O2 (B1): an idea for a builder with no project never needs a live product or a repo. Pure. */
export const noProjectIdea = (c: Card) => c.needs_repo === false && c.tag !== NEEDS_LIVE_PRODUCT;
/**
 * v2.13.1 O5 N6 (P5): an idea for a builder with no project, beside a build offer: only a program the
 * offered starter can enter (its chain, or any chain), and only with the program's own pitch (never a
 * made-up "a small app"). Pure.
 */
export const ideaFitsOffer = (c: Card, starter: Starter | null) =>
  noProjectIdea(c) && Boolean(c.pitch?.for) && (!starter || c.any_chain === true || (c.chains ?? []).some((ch) => ch === starter.chain));
/** v2.13.1 O2: a program shown for a project fits it: its chain (or any chain), and a live product only when it is live. Pure. */
export const fitsProject = (c: Card, p: { chains: string[]; live: boolean }) =>
  (c.any_chain === true || (c.chains ?? []).some((ch) => p.chains.includes(ch))) && (c.tag !== NEEDS_LIVE_PRODUCT || p.live);

/** "a Base app", "an Avalanche app", "an app on Base, Tempo or Robinhood Chain". Pure. */
const chainApp = (chains: readonly string[]) => {
  const names = chains.map((c) => (Object.hasOwn(CHAIN_NAMES, c) ? CHAIN_NAMES[c as Chain] : c));
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
  updatesOn: boolean; scheduled: boolean; postedThisWeek: boolean; ranks: RankLines;
  /** v2.13.1 O2 (B4): the build in progress, if any. */
  building: { name: string } | null;
  /** standBase answered (a profile exists): news is read only then. */
  profiled: boolean;
  /** v2.13.4 (spec 4): the live link the agent reported for the one project (identity), if any. */
  liveUrl: string | null;
};
const EMPTY_BASE: StandBase = { standing: { ranked: false, rank: 0, total: 0 }, claimed: false, handle: null, claimLink: null, projects: [] };
const NO_RANK: RankLines = { bench: null, phrase: null, chains: [] };
const logged = (where: string) => (err: unknown) => {
  console.error(`[bench] ${where}`, err instanceof Error ? err.name : 'error');
  return null;
};

async function benchRead(id: number, now: Date, fresh: ToolContext['freshDeps']): Promise<BenchRead> {
  const stand = await standBase(id, { fresh }).catch(logged('stand'));
  const [p] = await sql()<{ main: string | null; on: Date | null; sched: Date | null; seen: unknown; identity: unknown }[]>`
    SELECT main_project_key AS main, updates_on_at AS on, updates_scheduled_at AS sched, standing_seen AS seen, identity FROM builder_profiles WHERE builder_id = ${id}`.catch(
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
  const [week] = main
    ? await sql()`SELECT 1 FROM project_updates WHERE builder_id = ${id} AND lower(project_key) = lower(${main}) AND week = ${mondayOf(now)} AND text IS NOT NULL`.catch(() => [])
    : [];
  const ranks = await rankLines(id).catch(() => NO_RANK);
  const building = buildInProgress(await readBuild(id).catch(() => null), now, fresh?.starters);
  // standBase's seen, else the profile's own (the Bench's keys are read from the same column).
  const seen = (stand?.seen ?? (p?.seen && typeof p.seen === 'object' ? p.seen : {})) as Seen;
  return {
    base: stand?.base ?? EMPTY_BASE, seen, main, row: row ?? null, ranks, profiled: stand !== null,
    updatesOn: Boolean(p?.on), scheduled: Boolean(p?.sched), postedThisWeek: Boolean(week), building,
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

/**
 * v2.13.4 (R1): whether this agent (its own installation) joined the page from the claim page since its
 * last reply (standing_seen.linked, written by claim.ts claimJoinPost). Read once: it is cleared here.
 */
async function takeLinked(id: number, own: number, seen: Seen): Promise<boolean> {
  const linked = (seen as { linked?: Record<string, unknown> }).linked;
  if (!linked || typeof linked !== 'object' || !Object.hasOwn(linked, String(own))) return false;
  await sql()`UPDATE builder_profiles SET standing_seen = jsonb_set(standing_seen, '{linked}', (standing_seen->'linked') - ${String(own)}::text)
    WHERE builder_id = ${id}`.catch(logged('linked'));
  return true;
}

/**
 * The coin as the last line (spec 3b's moments under the Bench, and v2.13 spec "4. Optional: raise"),
 * only for a confirmed one project: 1. it has a launched coin it isn't raising with: "Want to show
 * you're raising with $X?", once (standing_seen.raise_asked, marked here: the ask is used whenever
 * it is returned); 2. no coin, shipped, five weeks in a row: the streak_five moment; 3. with people:
 * its first 5 people (the last look saw fewer), else has_people. offerCoin records the moment (at
 * most once per project, so the streak moment comes once).
 */
export async function coinAskBench(
  id: number,
  p: BenchProject & { people: number; has_coin: boolean; streak: number; shipped: boolean },
  seen: Seen,
  deps: { check?: TickerCheck } = {},
): Promise<BenchAsk | null> {
  // Fix round 1: a Confirming project is never asked to raise (nor offered a coin).
  if (!p.confirmed) return null;
  const coin = await raisingCoin(id);
  const raise = await raiseAsk(id, p.key, seen, coin);
  if (raise) {
    await markRaiseAsked(id, p.key, new Date());
    return raise;
  }
  if (p.has_coin || coin) return null;
  if (p.shipped && p.streak >= 5) {
    const offer = await offerCoin(id, p.key, 'streak_five', deps);
    if (offer) return { kind: 'coin', project_key: p.key, line: offer.line };
  }
  if (!p.shipped || p.people <= 0) {
    // Owner ruling A (v2.13.3): with nothing that fits, a confirmed project is offered a community round
    // (the coin) once, with no moment to wait for.
    const offer = await offerCoin(id, p.key, 'countable', deps);
    return offer ? { kind: 'coin', project_key: p.key, line: offer.line } : null;
  }
  const was = seen.people?.[p.key];
  const moment = was !== undefined && was < 5 && p.people >= 5 ? 'first_five' : 'has_people';
  const offer = await offerCoin(id, p.key, moment, deps);
  return offer ? { kind: 'coin', project_key: p.key, line: offer.line } : null;
}

type Fit = { program_id: string; repo?: string; title: string; prize: string; when: string };
type ViewIn = {
  id: number; now: Date; read: BenchRead;
  /** The one project's name before its first rescore wrote a row (identity's, else the repo's). */
  name: string | null;
  /** Programs the one project qualifies for (at most 3 are shown). */
  fits: Fit[];
  cards: Card[]; skip: Set<string>;
  /** No project: the build pick (v2.13.1 O2: a program's, else the starter with no program). */
  pick: BenchPick | null;
  /** The reply already asks something (a join, an outcome question, a submission): no ask. */
  held: boolean;
  agentCanBuild: boolean; due: string[];
  coinDeps?: { check?: TickerCheck };
  /** O5 N2, N4: the fetch for the one cheap read of the repo before a proof code is issued. */
  ghFetch?: typeof fetch;
  /** v2.13.4 (spec 4, R3): the one project's live link, checked (wording and program fit only). */
  live?: LiveSite | null;
  /** v2.13.4 (R1): this agent joined the page from the claim page since its last reply. */
  linked?: boolean;
  /** v2.13.4 R6: the caller's own installation (the join notice; who asked for a proof code). */
  own?: number;
};

/**
 * The one view find and score share (F19): the project, the rank (once claimed and confirmed), the
 * ways to get funded, the one question (chooseAsk), stored for its yes, and the fields every Bench
 * reply carries: move_up, claim, rank_lines, streak.
 */
async function benchView(o: ViewIn): Promise<{ view: BenchView; ask: BenchAsk | null; fields: Reply; branch: BranchState }> {
  const { id, now, read } = o;
  const row = read.row;
  // v2.13.1 O2 (B4): while a build is in progress the reply says so, and asks and offers nothing.
  const building = read.building;
  const pick = building ? null : o.pick;
  // v2.13.4: a live link that loads counts as live for wording and fit (R3), and names the project as its site does.
  const siteLive = o.live?.ok === true;
  const title = o.live?.ok ? o.live.title : null;
  const project: BenchProject | null = row
    ? { key: row.key, name: displayName(row.name, row.key, title), confirmed: row.confirmed, live: (row.shipped && row.kind === 'app') || row.site || siteLive, weeks: row.weeks }
    : read.main
      ? { key: read.main, name: displayName(o.name ?? read.main.split('/').pop() ?? read.main, read.main, title), confirmed: false, live: siteLive, weeks: 0 }
      : null;
  // v2.13.1 O1: a repo-key project that isn't confirmed gets the proof branch (proof-branch.ts says when).
  // O2: read before the ask, so a project being checked is asked the next Bench step (the updates yes).
  const branch = project && !project.confirmed && !building
    ? await proofBranchFor(id, project.key, now, { canBuild: o.agentCanBuild, ghFetch: o.ghFetch }).catch(logged('proof branch'))
    : null;
  // O2 fix round 1 (ruling 3): a repo another person holds is never offered a program for it.
  const taken = branch?.kind === 'taken';
  let fund: FundLine[] = [];
  /** v2.13.3 (2): the programs named so far (never named twice). */
  const named = new Set<string>();
  if (building) fund = [];
  else if (taken) fund = [];
  else if (project) {
    fund = o.fits.slice(0, 3).map((f) => ({ kind: 'fits', title: f.title, prize: f.prize, when: f.when }));
    // v2.13.1 O2: the open-all-year program only when it fits the project (its chain or any chain; a live product only when live).
    const fit = { chains: row?.chains ?? [], live: project.live };
    const rolling = fund.length === 0 && o.due.length === 0 ? rollingPick(o.cards.filter((c) => fitsProject(c, fit)), now, o.skip, { unknownPrize: true }) : undefined;
    if (rolling) fund = [{ kind: 'rolling', title: rolling.title, prize: (rolling.max_award_usd ?? 0) > 0 ? earnPrize(rolling) : null }];
    for (const f of o.fits.slice(0, 3)) named.add(f.program_id);
    if (rolling) named.add(rolling.id);
  } else {
    const first = pick?.card ?? null;
    // v2.13.1 O2 (B1): never an idea that needs a live product or a repo for a builder with no project.
    // O5 N6: beside a build offer, only a program its starter can enter, with its own pitch.
    const other = biggestPick(o.cards.filter((c) => ideaFitsOffer(c, pick?.starter ?? null)), now, o.skip, first?.id ?? null);
    const forOf = (c: Card) => c.pitch?.for ?? (c === first && pick ? benchOffer(pick.starter) : null);
    const ideas = [first, other].filter((c): c is Card => Boolean(c && forOf(c)));
    for (const c of ideas) named.add(c.id);
    fund = ideas.map((c) => ({ kind: 'idea', who: c.pitch?.who ?? c.title, prize: earnPrize(c), for: forOf(c)! }));
  }
  // v2.13.3 (2): "Ways to get funded" always shows (it's the hook): with no project or one not yet
  // confirmed, up to NEEDS_MAX open programs in all, each with what it needs; for a confirmed one with
  // nothing to name, the same. Never a fit claimed; never while a build is in progress.
  // A repo another person holds names no program at all (O2 fix round 1, ruling 3).
  if (!building && !taken) {
    const room = !project || !project.confirmed ? NEEDS_MAX - fund.length : fund.length === 0 && o.due.length === 0 ? NEEDS_MAX : 0;
    const has = { live: project?.live ?? false, repo: Boolean(project && /^[^/:]+\/[^/]+$/.test(project.key)) };
    fund = [...fund, ...needsPicks(o.cards, now, new Set([...o.skip, ...named]), room, row?.chains ?? [], has)];
  }
  let ask: BenchAsk | null = null;
  const appOn = githubAppEnabled();
  if (!o.held && !building) {
    // Only a client that builds is asked to build (a chat-only one sees the ideas).
    // v2.13.3 (3), ruling A: the no-project ask leads with existing work; the build only for a specific program.
    const build: BenchAsk | null = !project && pick?.canBuild && pick.card
      ? { kind: 'build', project_key: null, program_id: pick.card.id, line: startBuildAsk(pick.starter.offer, pick.card.title) }
      : null;
    const enter: BenchAsk | null = project && o.fits[0] && !taken ? { kind: 'enter', project_key: project.key, program_id: o.fits[0].program_id, line: enterAsk(o.fits[0].title) } : null;
    const web = project ? read.base.projects.some((x) => x.key.toLowerCase() === project.key.toLowerCase() && x.web) : false;
    // O5 N5: a grants yes that found nothing keeps grants quiet a week, as a no keeps an ask away.
    const declined = [...declinedNow(read.seen, now.getTime()), ...quietNow(read.seen, now.getTime())];
    const asks = {
      project, canHost: Boolean(project && hostFor(o.agentCanBuild)(project.key) && web), updatesOn: read.updatesOn,
      postedThisWeek: read.postedThisWeek, scheduled: read.scheduled, build, declined, claimed: read.base.claimed,
      // O2 fix round 1 (ruling 3): failed and taken, a different project. O5 N15: a chat-only agent
      // (needs_agent) can't schedule weekly posts, so it is never asked the updates yes. O5 N2: a
      // repo under someone else's account, a different project.
      joining: Boolean(project && !project.confirmed && (!branch || branch.kind === 'checking')),
      other: taken || ['failed', 'foreign', 'copy', 'unseen'].includes(branch?.kind ?? ''),
    };
    // v2.13.4 (spec 2): unclaimed, X comes first and is the reply's one question (asked until claimed or
    // declined). The project it names is one the claim puts on the Bench (none that can't join).
    const claim: BenchAsk | null = !read.base.claimed && read.base.claimLink && !declined.includes(benchStepKey('claim', null))
      ? {
          kind: 'claim', project_key: null,
          line: claimAsk(read.base.claimLink, project && (!asks.other || (appOn && branch?.kind === 'unseen')) ? project.name : null),
        }
      : null;
    // v2.13.3 (5), v2.13.4 (spec 3): a repo EarnKit can't see, with the read-only App on: the install link in
    // one line, right after the claim (the reply's one link).
    const install = !claim && appOn && project && branch?.kind === 'unseen' && !declined.includes(benchStepKey('install_app', project.key))
      ? await createVerifyLink({ installationId: id, projectId: null, repoKey: project.key, purpose: 'app' }, now)
          .then((link): BenchAsk => ({ kind: 'install_app', project_key: project.key, line: installAppAsk(project.name, link) }))
          .catch(logged('app link'))
      : null;
    // Owner ruling A: the best fit's entry, else a community round (the coin), come before the Bench's own
    // steps. The coin is offered (and its moment recorded) only when nothing earlier applies.
    const before = claim ?? install ?? chooseAsk({ ...asks, coin: null, enter, fallback: false });
    const coinFirst = !before || ['go_live', 'updates', 'post_update'].includes(before.kind);
    const coin = coinFirst && project && row
      ? await coinAskBench(id, { ...project, people: row.people, has_coin: row.has_coin, streak: row.streak, shipped: row.shipped }, read.seen, o.coinDeps).catch(logged('coin'))
      : null;
    ask = coin ?? before ?? chooseAsk({ ...asks, coin: null, enter });
    // v2.13.4 R6 (2): a new agent joined this page by R1: the page's other agents are told once, as the
    // reply's question, before anything else.
    const notice = o.own !== undefined && read.base.claimed ? await joinNotice(id, o.own).catch(logged('join notice')) : null;
    if (notice) ask = { kind: 'remove_agent', project_key: `join:${notice.id}`, line: notice.line };
  }
  const stored = ask ? { kind: ask.kind, key: ask.project_key, ...(ask.program_id && { program_id: ask.program_id }) } : null;
  await sql()`
    UPDATE builder_profiles SET standing_seen = CASE WHEN ${stored === null} THEN COALESCE(standing_seen, '{}'::jsonb) - 'bench_ask'
      ELSE COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json(stored as never)}::jsonb) END
    WHERE builder_id = ${id}`.catch(logged('ask'));
  // Final fix I3: "a minute or two" only within the hour of fast checks after the line was issued (keys a branch can't prove).
  const slow = Boolean(project && !project.confirmed && !branch) && !(await confirmingFast(id, now).catch(() => false));
  const view: BenchView = {
    project, rank: read.ranks.phrase, claimed: read.base.claimed, handle: read.base.handle, claimLink: read.base.claimLink,
    branch: branch?.kind === 'checking' && branch.again ? 'recheck' : branch?.kind === 'unseen' && appOn ? 'private' : branch?.kind ?? null,
    slow, fund, ask, due: building ? [] : o.due,
    building: building ? building.name : null,
    page: read.base.claimed && read.base.handle ? `${siteUrl()}${pagePath(read.base.handle)}` : null,
    linked: Boolean(o.linked && read.base.claimed),
  };
  // A raise ask is answered through move_up (benchMoveUp: setRaising), as every Bench ask but the coin offer.
  const note = ask?.kind === 'coin' ? COIN_NOTE
    : ask?.kind === 'install_app' ? INSTALL_APP_NOTE
    : ask?.kind === 'claim' ? CLAIM_NOTE
    // v2.13.3 (3): the no-project ask: existing work goes to find with identity.
    : !project && (ask?.kind === 'build' || ask?.kind === 'start') ? START_NOTE
    : BENCH_MOVE_UP_NOTE;
  const fields: Reply = {
    ...(ask && { move_up: { kind: ask.kind, project_key: ask.project_key, agent_note: note } }),
    ...(showsClaimLink(view) && read.base.claimLink && { claim: { link: read.base.claimLink } }),
    rank_lines: [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x)),
    streak: row?.streak ?? 0,
  };
  return { view, ask, fields, branch };
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
  /** O5 fix round 1: the proof check, started with the refresh so it shares the reply's wait. */
  proofCheck?: Promise<boolean>;
  first: FirstMessage;
  cards: FirstMessage['cards'];
  repos: YourRepos | null;
  myEntries: NonNullable<FirstMessage['entries']>;
  pickup: { question: string } | null;
  ask: { project_id: number; program_id: string; name: string; program_title: string } | null;
  alerts: { lines: string[] };
  agentCanBuild: boolean;
  hide: Set<string>;
  project: IdentityProject | null;
  /** v2.13.4 R6 (4): a plain line first (a newly joined agent's project change was refused). */
  notice?: string | null;
};

/**
 * find under the Bench flag: the three v2.13 parts, the one project's proof in the same turn (plan
 * B3), news since the last look, and the weekly-task note once more while posting is on and not
 * scheduled (B18). tools.ts adds what standFind's reply also carries (pick_up, ask_outcome, matches,
 * programs, working_on, wallet_note) and the build_offer's note. Never a daily-check note.
 */
export async function benchFind(ctx: ToolContext, a: BenchFindArgs): Promise<Reply> {
  const id = ctx.installationId;
  const now = a.first.now;
  // v2.13.1 O1: the open proof branch is checked first, so this reply already shows the confirmation.
  // O5 N1: never longer than REPLY_WAIT_MS (a slower check lands for the next reply).
  const ghFetch = ctx.proofBranchFetch ?? ctx.readerDeps?.ghFetch;
  // O5 fix round 1: only the time left of the reply's wait, never a fresh one.
  await settleWithin(a.proofCheck ?? checkProofBranch(id, now, { ghFetch }), (a.start ?? Date.now()) + REPLY_WAIT_MS - Date.now());
  const read = await benchRead(id, now, ctx.freshDeps);
  const live = await liveOf(id, read, now, (a.start ?? Date.now()) + REPLY_WAIT_MS - Date.now());
  const linked = await takeLinked(id, ctx.ownInstallationId ?? id, read.seen);
  const m = { cards: a.cards, repos: a.repos, entries: a.myEntries, now };
  const entered = enteredIds(m);
  const main = read.main?.toLowerCase() ?? null;
  // Ways to get funded: the programs the one project qualifies for (as standFind's earn rows).
  const rows = main
    ? layout(m, entered).rows.filter((r) => qualifies(r) && !r.card.sponsored && !entered.has(r.card.id) && (r.key ?? r.repo).toLowerCase() === main).slice(0, 3)
    : [];
  const fits: Fit[] = rows.map((r) => ({ program_id: r.card.id, repo: r.repo, title: r.card.title, prize: earnPrize(r.card), when: earnWhen(r.card) }));
  const held = Boolean(a.pickup || a.ask);
  const submit = held ? undefined : submitStep(m);
  const due = [...(a.first.deadline ? [a.first.deadline] : []), ...(submit ? [submitStepLine(submit)] : [])];
  const skip = new Set([...entered, ...a.hide]);
  const pick = read.main || read.building
    ? null
    : withNoProgram(
        freshLead({ ...a.first, holdQuestion: held || Boolean(submit) }) ??
          moneyFallback({
            cards: a.cards, entered, hidden: a.hide, now, projects: [], fresh: a.first.fresh,
            repoTrouble: Boolean(a.repos && ('error' in a.repos || a.repos.unseen?.length)),
          }).pick ??
          null,
        a.first.fresh,
        now,
      );
  const name = a.project && projectKeyOf(a.project).toLowerCase() === main ? a.project.name : null;
  const { view, ask, fields, branch } = await benchView({
    id, now, read, name, fits, cards: a.cards, skip, pick, held: held || Boolean(submit), agentCanBuild: a.agentCanBuild, due,
    coinDeps: { check: ctx.tokenDeps?.check }, ghFetch, live, linked, own: ctx.ownInstallationId ?? id,
  });
  // O2 fix round 1 (ruling 2): a code closed by a project change is told alongside the new one (remove_branch).
  const told = await branchToRemove(id, now).catch(logged('proof branch told'));
  const proof = branch?.kind === 'checking' ? branch.proof : told;
  const removeOld = branch?.kind === 'checking' ? told : null;
  const asks = held || Boolean(submit) || Boolean(ask);
  const lead = Boolean((fits[0] && !submit && branch?.kind !== 'taken') || submit);
  const news = read.profiled ? await takeNews(id, read.seen, read.base, now, !asks).catch(logged('news')) : null;
  const opener = newsOpener(a.alerts.lines, news ? [news] : []);
  if (pick?.canBuild) await markFreshOffer(id, now).catch(logged('fresh offer'));
  await recordShown(
    id,
    rows.flatMap((r) =>
      r.key && r.row
        ? [{ program_id: r.card.id, repo_key: r.key, status: r.v.status, product_score: r.product_score, row_level: r.row.level, traction: r.product_score === null ? null : r.traction }]
        : [],
    ),
  ).catch(logged('match shown'));
  // B18: the weekly task's note once more while posting is on and the agent hasn't scheduled it.
  const weekly = read.updatesOn && !read.scheduled && !read.seen.weekly_note_at;
  if (weekly)
    await sql()`
      UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('weekly_note_at', ${now.toISOString()}::text)
      WHERE builder_id = ${id}`.catch(logged('weekly note'));
  return {
    show_to_builder: [a.notice, opener, benchReply(view), a.pickup?.question].filter(Boolean).join('\n\n'),
    // O5 (P8): the earn note names lead.program_id, so only with a lead.
    note: ['Show show_to_builder to the builder exactly as written.', lead ? EARN_NOTE : null].filter(Boolean).join(' '),
    ...fields,
    ...(fits[0] && !submit && branch?.kind !== 'taken' && { lead: { program_id: fits[0].program_id, repo: fits[0].repo } }),
    ...(submit && { lead: { program_id: submit.card.id, step: 'submit', ...(submit.entry.id !== undefined && { project_id: submit.entry.id }) } }),
    ...(pick && { build_offer: { program_id: pick.card?.id ?? BENCH_BUILD_ID, starter_id: pick.starter.id, can_build: pick.canBuild } }),
    ...(proof && { proof }),
    ...(removeOld && { remove_branch: removeOld }),
    ...(weekly && { schedule_weekly_update: WEEKLY_UPDATE_NOTE }),
  };
}

/**
 * score under the Bench flag: the profile (and a discovery run) on the first call, the refresh within
 * its budget, then find's view without a matcher: the one project's fits from what find last saw
 * (stand-view.ts scoreEarn), else the open-all-year program; no project, the build. One
 * score_viewed event a minute (v2.12). Null without a profile (score-tool.ts answers that).
 */
export async function benchScore(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId' | 'freshDeps' | 'tokenDeps' | 'proofBranchFetch'>, now: Date, o: { hold?: boolean; reader?: ReaderDeps; fresh?: FreshOn } = {}): Promise<Reply | null> {
  const id = ctx.installationId;
  const made = await ensureProfile(id, now);
  if (!made) return null;
  if (made.created) await enqueueDiscovery(id, 'first_find');
  // O5 N1: the refresh and the proof check run on, but the reply waits for them at most REPLY_WAIT_MS.
  const start = Date.now();
  const refresh = startRefresh(id, { now, start, reader: o.reader });
  const ghFetch = ctx.proofBranchFetch ?? o.reader?.ghFetch;
  await Promise.all([refresh.within(REPLY_WAIT_MS), settleWithin(checkProofBranch(id, now, { ghFetch }), start + REPLY_WAIT_MS - Date.now())]);
  const read = await benchRead(id, now, ctx.freshDeps);
  const live = await liveOf(id, read, now, start + REPLY_WAIT_MS - Date.now());
  const linked = await takeLinked(id, ctx.ownInstallationId ?? id, read.seen);
  const [programs, entries, memory] = await Promise.all([listPrograms().catch(() => []), openEntries(id).catch(() => []), readMemory(id).catch(() => null)]);
  const cards = (programs as (Card & { agent_completable?: boolean; earnkit_campaign?: boolean; starts_at: Date | null; opened_at: Date | null })[])
    .filter((p) => p.agent_completable !== false && !p.earnkit_campaign);
  const hidden = memory ? hiddenIds(hiddenPrograms(memory, cards.map((c) => ({ id: c.id, starts_at: c.starts_at, ends_at: c.ends_at ?? null, opened_at: c.opened_at })))) : new Set<string>();
  const entered = new Set(entries.map((e) => e.program_id));
  const shown = cards.filter((c) => !hidden.has(c.id));
  const main = read.main?.toLowerCase() ?? null;
  const money = main ? await scoreEarn(id, { cards: shown, entered, hidden, now, projects: read.base.projects }) : { earn: [] };
  const fits: Fit[] = money.earn.filter((e) => e.project.toLowerCase() === main).map((e) => ({ program_id: e.program_id, title: e.title, prize: e.prize, when: e.when }));
  const fresh = o.fresh;
  const picked = !main && !read.building && fresh ? freshPick(shown, now, { hidden, entered, deployOn: fresh.deployOn, hostOn: fresh.hostOn, starters: fresh.starters }) : undefined;
  const pick = !main && !read.building ? withNoProgram(picked && fresh ? { ...picked, canBuild: fresh.canBuild } : null, fresh, now) : null;
  const { view, fields, branch } = await benchView({
    id, now, read, name: null, fits, cards: shown, skip: new Set([...entered, ...hidden]), pick, held: Boolean(o.hold),
    agentCanBuild: fresh?.canBuild ?? false, due: [], coinDeps: { check: ctx.tokenDeps?.check }, ghFetch, live, linked, own: ctx.ownInstallationId ?? id,
  });
  // O2 fix round 1 (ruling 2): a code closed by a project change is told alongside the new one (remove_branch).
  const told = await branchToRemove(id, now).catch(logged('proof branch told'));
  const proof = branch?.kind === 'checking' ? branch.proof : told;
  const removeOld = branch?.kind === 'checking' ? told : null;
  await noteEvent('score_viewed', () => ({
    type: 'score_viewed',
    dedupe_key: `score_viewed:${id}:${Math.floor(now.getTime() / 60_000)}`,
    installation_id: id,
    detail: { rank: read.base.standing.ranked ? read.base.standing.rank : null, total: read.base.standing.total },
  }));
  return {
    show_to_builder: benchReply(view),
    ...fields,
    ...(fits[0] && branch?.kind !== 'taken' && { lead: { program_id: fits[0].program_id }, note: EARN_NOTE }),
    ...(pick && { build_offer: { program_id: pick.card?.id ?? BENCH_BUILD_ID, starter_id: pick.starter.id, can_build: pick.canBuild } }),
    ...(proof && { proof }),
    ...(removeOld && { remove_branch: removeOld }),
  };
}

/** The ask stored with the last Bench reply, when the agent's answer names it (kind, if given, and project_key). */
export async function benchAsked(id: number, m: { kind?: string; project_key?: string | null }): Promise<{ kind: BenchAskKind; key: string | null; program_id?: string } | null> {
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
 * The builder's yes or no to the Bench's last line (tools.ts moveUpAnswer routes it here; go_live
 * and coin yeses stay there). Only the ask stored with the last reply is answered; anything else is
 * "Okay." with nothing changed. A no keeps that ask away 30 days (DECLINE_MS).
 */
export async function benchMoveUp(ctx: Pick<ToolContext, 'installationId' | 'ownInstallationId'>, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no'; live_url?: string }): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  const okay = { show_to_builder: COUNT_LINES.noted };
  const asked = await benchAsked(id, m);
  if (!asked) return okay;
  if (m.answer === 'no' && asked.kind === 'remove_agent') {
    // R6: a no to the join notice keeps the agent (the notice was shown once; nothing is stored).
    await sql()`UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask' WHERE builder_id = ${id}`.catch(logged('ask'));
    return { show_to_builder: DETACH_LINES.kept };
  }
  if (m.answer === 'no') {
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${benchStepKey(asked.kind, asked.key)}::text, ${now.toISOString()}::text)) - 'bench_ask'
      WHERE builder_id = ${id}`.catch(logged('decline'));
    return okay;
  }
  // Fix round 1: answered once. The ask is cleared before the yes runs, so a retried yes is "Okay.".
  // (go_live and coin yeses stay in tools.ts: go_live's yes is sent again with live_url by design.)
  if (['updates', 'post_update', 'build', 'enter', 'raise', 'grants', 'suggest', 'other_project', 'grants_later', 'install_app', 'start', 'claim', 'remove_agent'].includes(asked.kind)) {
    const [taken] = await sql()`
      UPDATE builder_profiles SET standing_seen = standing_seen - 'bench_ask'
      WHERE builder_id = ${id} AND standing_seen->'bench_ask' = ${sql().json(asked as never)}::jsonb RETURNING 1`.catch((err: unknown) => {
      logged('take ask')(err);
      return [];
    });
    if (!taken) return okay;
  }
  switch (asked.kind) {
    case 'updates':
      return setUpdates(id, { on: true }, now);
    case 'post_update':
      return { show_to_builder: '', agent_note: POST_UPDATE_NOTE };
    case 'build':
      return asked.program_id ? { show_to_builder: '', agent_note: buildYesNote(asked.program_id) } : okay;
    case 'enter':
      return asked.program_id ? { show_to_builder: '', lead: { program_id: asked.program_id }, agent_note: ENTER_NOTE } : okay;
    case 'raise':
      // v2.13.4 R6 (4): a newly joined agent can't open a community round.
      if (await newlyJoined(ctx.ownInstallationId ?? id, now)) return { show_to_builder: NEW_AGENT_LINES.coin };
      return setRaising(id, true);
    case 'grants':
      return asked.key ? grantsYes(id, asked.key, now) : okay;
    case 'suggest':
      // O5 N5: with a project, one small thing to ship in it; without, ideas to start from.
      return asked.key ? { show_to_builder: '', agent_note: SHIP_NOTE } : suggestYes(now);
    case 'other_project':
      return { show_to_builder: '', agent_note: OTHER_PROJECT_NOTE };
    case 'start':
      // Ruling A: their work, not a build: ask for it, then find with identity.
      return { show_to_builder: '', agent_note: START_YES_NOTE };
    case 'install_app':
      // v2.13.3 (5): the link does the work; the next find checks the repo through the App.
      return { show_to_builder: '', agent_note: INSTALL_APP_YES_NOTE };
    case 'claim':
      // v2.13.4 (spec 2): the link does the work; the next find shows the page.
      return { show_to_builder: '', agent_note: CLAIM_YES_NOTE };
    case 'remove_agent': {
      // v2.13.4 R6 (3): detached at once, by an installation that was on the page before the join.
      const join = Number(/^join:(\d+)$/.exec(asked.key ?? '')?.[1]);
      if (!Number.isSafeInteger(join)) return okay;
      const r = await detachJoin(join, ctx.ownInstallationId ?? id, now);
      return r === 'detached' ? { show_to_builder: DETACH_LINES.done } : okay;
    }
    case 'grants_later':
      // O5 fix round 2: grants stay quiet a week from now; then the grants ask comes back.
      if (asked.key) await keepGrantsQuiet(id, asked.key, now);
      return { show_to_builder: GRANTS_LATER_DONE };
    default:
      return okay;
  }
}

/** Owner ruling A (v2.13.3): the yes to "Send me your GitHub or a link...". */
export const START_YES_NOTE =
  "Ask the builder in one short question for their GitHub login or a link to something they've made, then call find with identity: { github_login, project: { name, repo or live_url } }. Don't show this note.";
/** v2.13.3 (5): the yes to the install ask. */
export const INSTALL_APP_YES_NOTE =
  "Once the builder has installed EarnKit on the repo from the link (after claiming their page, if the link hasn't come yet), call find again. Don't show this note.";
/** v2.13.1 O2 fix round 1 (ruling 3): the yes routes of the last-line fallbacks. */
export const OTHER_PROJECT_NOTE =
  "Ask the builder in one short question which project is theirs (a repo under their own GitHub account), then call find with identity.project: that project. Don't show this note.";
export const GRANTS_NOTE = "Show show_to_builder as written. A yes to one of them: call find with program_id for its guide. Don't show this note.";
export const SUGGEST_NOTE =
  "Show show_to_builder as written. If they pick one, build it with them in a new folder of their own, then call find with identity.project: it. Don't show this note.";
/** O5 N5: the yes to "Want me to suggest one small thing to ship in <project> this week?". */
export const SHIP_NOTE =
  "Look at the project in this folder (git log, open issues, the README) and suggest one small thing to ship this week, in one short line, then ask if they want you to build it now. Don't show this note.";
/** O5 N5: no grant fits now; the grants ask stays away a week (GRANTS_QUIET_MS). */
export const noGrantLine = (name: string) => `No open grant fits ${name} right now. I'll look again next week.`;
/** When no open program has curated ideas. */
export const SMALL_IDEAS = ['A tip jar for your readers or listeners', 'A guestbook for your site', 'A simple poll your friends can vote in'];

type ProgramCard = Card & { agent_completable?: boolean; earnkit_campaign?: boolean };
const openCards = async (now: Date) =>
  ((await listPrograms().catch(() => [])) as ProgramCard[]).filter((c) => showable(c, now, new Set()));

/** The yes to "Want me to find grants that fit <project>?": up to 3 open programs that fit it (fitsProject), else a plain line. */
async function grantsYes(id: number, key: string, now: Date): Promise<Reply> {
  const [row] = await sql()<{ name: string; chains: string[]; live: boolean }[]>`
    SELECT b.name, b.chains, ((b.shipped AND b.kind = 'app') OR EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = b.builder_id AND s.kind = 'site'
      AND s.state = 'verified' AND lower(s.project_key) = lower(b.project_key))) AS live
    FROM builder_projects b WHERE b.builder_id = ${id} AND lower(b.project_key) = lower(${key})`.catch(() => []);
  const name = row?.name ?? key.split('/').pop() ?? key;
  const fit = { chains: row?.chains ?? [], live: row?.live ?? false };
  const cards = (await openCards(now)).filter((c) => fitsProject(c, fit)).slice(0, 3);
  if (cards.length > 0) return grantsFound(cards);
  // O5 N5: never the same question again right away: grants stay quiet for GRANTS_QUIET_MS.
  await keepGrantsQuiet(id, key, now);
  // O5 fix round 1 (ruling): a reply the builder sees ends on one question: the next step, asked and
  // stored as every Bench ask is (its yes goes to tell move_up).
  const read = await benchRead(id, now, undefined);
  const declined = declinedNow(read.seen, now.getTime());
  const next = chooseAsk({
    project: { key, name, confirmed: true, live: fit.live, weeks: read.row?.weeks ?? 0 }, canHost: false, updatesOn: read.updatesOn,
    postedThisWeek: read.postedThisWeek, scheduled: read.scheduled, coin: null, build: null, enter: null, claimed: read.base.claimed,
    declined: [...declined, ...quietNow(read.seen, now.getTime()), benchStepKey('grants', key)],
  });
  // O5 fix round 2: nothing left in the order: posting, the week's post, else checking again next week
  // (a no to any of them is still honoured).
  const off = (k: BenchAskKind) => declined.includes(benchStepKey(k, key));
  const ask: BenchAsk | null =
    next ??
    (!read.updatesOn && !off('updates') ? { kind: 'updates', project_key: key, line: read.base.claimed ? UPDATES_ASK : UPDATES_ASK_JOINING }
      : read.updatesOn && !read.postedThisWeek && !off('post_update') ? { kind: 'post_update', project_key: key, line: POST_UPDATE_ASK }
      : off('grants_later') ? null
      : { kind: 'grants_later', project_key: key, line: GRANTS_LATER_ASK });
  if (!ask) return { show_to_builder: noGrantLine(name) };
  await sql()`
    UPDATE builder_profiles SET standing_seen = COALESCE(standing_seen, '{}'::jsonb) || jsonb_build_object('bench_ask', ${sql().json({ kind: ask.kind, key: ask.project_key } as never)}::jsonb)
    WHERE builder_id = ${id}`.catch(logged('ask'));
  return { show_to_builder: `${noGrantLine(name)}\n${ask.line}`, move_up: { kind: ask.kind, project_key: ask.project_key, agent_note: BENCH_MOVE_UP_NOTE } };
}

/** O5 N5: grants stay quiet for GRANTS_QUIET_MS from `now` (standing_seen.quiet). Never throws. */
async function keepGrantsQuiet(id: number, key: string, now: Date): Promise<void> {
  await sql()`
    UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{quiet}',
      COALESCE(standing_seen->'quiet', '{}'::jsonb) || jsonb_build_object(${benchStepKey('grants', key)}::text, ${now.toISOString()}::text))
    WHERE builder_id = ${id}`.catch(logged('grants quiet'));
}
/** O5 fix round 2: the yes to "Want me to check again for grants next week?". */
export const GRANTS_LATER_DONE = "Okay. I'll check again for grants next week.";

/** The programs that fit, one line each (the grants yes). Pure. */
function grantsFound(cards: Card[]): Reply {
  const lines = cards.map((c) => {
    const when = earnWhen(c);
    return `${c.title} pays ${earnPrize(c)}; ${when === 'open all year' ? "it's open all year" : `it ${when}`}.`;
  });
  return { show_to_builder: lines.join('\n'), agent_note: GRANTS_NOTE };
}

/** The yes to "Want me to suggest something small you could build this week?": up to 3 curated ideas, else SMALL_IDEAS. */
async function suggestYes(now: Date): Promise<Reply> {
  const curated = [...new Set((await openCards(now)).filter(noProjectIdea).flatMap((c) => c.ideas ?? []))].slice(0, 3);
  const ideas = curated.length ? curated : SMALL_IDEAS;
  return { show_to_builder: ['A few small things you could build this week:', ...ideas.map((i) => `- ${i}`)].join('\n'), agent_note: SUGGEST_NOTE };
}
