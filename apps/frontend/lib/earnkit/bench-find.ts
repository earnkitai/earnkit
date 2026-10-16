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
import { rankLines, type RankLines } from './bench-rank';
import { WEEKLY_UPDATE_NOTE, setUpdates } from './updates';
import { mondayOf } from './weeks';
import { COIN_NOTE, offerCoin } from './coin-moments';
import { markRaiseAsked, raiseAsk, raisingCoin, setRaising } from './raising';
import { BENCH_BUILD_ID, benchOffer, benchStarter, freshPick, type FreshPick } from './fresh-build';
import { NEEDS_LIVE_PRODUCT } from './guide';
import { siteUrl } from './entry-text';
import { pagePath } from './reserved-routes';
import type { Starter } from './starters';
import { EARN_NOTE, newsOpener } from './where-you-stand';
import { COUNT_LINES } from './make-countable';
import {
  biggestPick, declinedNow, earnPrize, earnWhen, hostFor, moneyFallback, rollingPick, scoreEarn, standBase, startRefresh, takeNews,
  type Seen as StandSeen, type StandBase,
} from './stand-view';
import { enteredIds, freshLead, layout, qualifies, submitStep, submitStepLine, type Card, type FirstMessage, type FreshOn, type YourRepos } from './present';
import type { ReaderDeps } from './source-readers';
import type { TickerCheck } from './token-proposal';
import { projectKeyOf, type IdentityProject } from './identity-input';
import type { ToolContext } from './tools';
import {
  benchBuildAsk, benchReply, benchStepKey, buildAsk, chooseAsk, enterAsk, showsClaimLink,
  type BenchAsk, type BenchAskKind, type BenchProject, type BenchView, type FundLine,
} from './bench-reply';

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
/** The yes to the build ask: the v2.11 build path, started for the program the ask named. */
export const buildYesNote = (programId: string) =>
  `Call prepare with build: { start: true, program_id: '${programId}' } and program_id: '${programId}' at the top. EarnKit then asks the builder one question before any work starts. Don't show this note.`;

/** What the person was last told (stand-view's Seen) plus the Bench's own: the ask, the weekly-task note, T9's raise. */
export type Seen = StandSeen & {
  bench_ask?: { kind: BenchAskKind; key: string | null; program_id?: string };
  raise_asked?: Record<string, string>;
  weekly_note_at?: string;
};
type Reply = Record<string, unknown>;

/** The one project's builder_projects row, as the Bench sees it (confirmed: benchConfirmedSql). */
type MainRow = { key: string; name: string; kind: string; shipped: boolean; people: number; has_coin: boolean; weeks: number; streak: number; confirmed: boolean; site: boolean; chains: string[] };

/** v2.13.1 O2 (B4): a build started this long ago, with no live link sent, is still in progress. */
export const BUILD_OPEN_MS = 24 * 60 * 60_000;
/**
 * v2.13.1 O2 (B4): the person's build in progress: started under BUILD_OPEN_MS ago and its live link not
 * sent yet (done_at). `name`: once the twist passed ("Building <name>" was said), else null. Pure.
 */
export function buildInProgress(b: StoredBuild | null, now: Date): { name: string | null } | null {
  if (!b || b.done_at) return null;
  const at = Date.parse(b.started_at);
  if (!Number.isFinite(at) || now.getTime() - at >= BUILD_OPEN_MS) return null;
  return { name: b.name ?? null };
}

/**
 * v2.13.1 O2 (B1): what a builder with no project is offered: a program's fresh build when one
 * qualifies (card set), else the starter build with no program (card null, BENCH_BUILD_ID). Null when
 * EarnKit can't deploy or host any tested starter.
 */
export type BenchPick = { card: Card | null; starter: Starter; canBuild: boolean };
const withNoProgram = (program: (FreshPick & { canBuild: boolean }) | null, fresh: FreshOn | undefined, now: Date): BenchPick | null => {
  if (program) return program;
  const starter = fresh ? benchStarter(now, fresh) : undefined;
  return starter && fresh ? { card: null, starter, canBuild: fresh.canBuild } : null;
};
/** v2.13.1 O2 (B1): an idea for a builder with no project never needs a live product or a repo. Pure. */
export const noProjectIdea = (c: Card) => c.needs_repo === false && c.tag !== NEEDS_LIVE_PRODUCT;
/** v2.13.1 O2: a program shown for a project fits it: its chain (or any chain), and a live product only when it is live. Pure. */
export const fitsProject = (c: Card, p: { chains: string[]; live: boolean }) =>
  (c.any_chain === true || (c.chains ?? []).some((ch) => p.chains.includes(ch))) && (c.tag !== NEEDS_LIVE_PRODUCT || p.live);

type BenchRead = {
  base: StandBase; seen: Seen; main: string | null; row: MainRow | null;
  updatesOn: boolean; scheduled: boolean; postedThisWeek: boolean; ranks: RankLines;
  /** v2.13.1 O2 (B4): the build in progress, if any. */
  building: { name: string | null } | null;
  /** standBase answered (a profile exists): news is read only then. */
  profiled: boolean;
};
const EMPTY_BASE: StandBase = { standing: { ranked: false, rank: 0, total: 0 }, claimed: false, handle: null, claimLink: null, projects: [] };
const NO_RANK: RankLines = { bench: null, phrase: null, chains: [] };
const logged = (where: string) => (err: unknown) => {
  console.error(`[bench] ${where}`, err instanceof Error ? err.name : 'error');
  return null;
};

async function benchRead(id: number, now: Date, fresh: ToolContext['freshDeps']): Promise<BenchRead> {
  const stand = await standBase(id, { fresh }).catch(logged('stand'));
  const [p] = await sql()<{ main: string | null; on: Date | null; sched: Date | null; seen: unknown }[]>`
    SELECT main_project_key AS main, updates_on_at AS on, updates_scheduled_at AS sched, standing_seen AS seen FROM builder_profiles WHERE builder_id = ${id}`.catch(
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
    ? await sql()`SELECT 1 FROM project_updates WHERE lower(project_key) = lower(${main}) AND week = ${mondayOf(now)} AND text IS NOT NULL`.catch(() => [])
    : [];
  const ranks = await rankLines(id).catch(() => NO_RANK);
  const building = buildInProgress(await readBuild(id).catch(() => null), now);
  // standBase's seen, else the profile's own (the Bench's keys are read from the same column).
  const seen = (stand?.seen ?? (p?.seen && typeof p.seen === 'object' ? p.seen : {})) as Seen;
  return {
    base: stand?.base ?? EMPTY_BASE, seen, main, row: row ?? null, ranks, profiled: stand !== null,
    updatesOn: Boolean(p?.on), scheduled: Boolean(p?.sched), postedThisWeek: Boolean(week), building,
  };
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
  if (!p.shipped || p.has_coin || coin) return null;
  if (p.streak >= 5) {
    const offer = await offerCoin(id, p.key, 'streak_five', deps);
    if (offer) return { kind: 'coin', project_key: p.key, line: offer.line };
  }
  if (p.people <= 0) return null;
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
  const project: BenchProject | null = row
    ? { key: row.key, name: row.name, confirmed: row.confirmed, live: (row.shipped && row.kind === 'app') || row.site, weeks: row.weeks }
    : read.main
      ? { key: read.main, name: o.name ?? read.main.split('/').pop() ?? read.main, confirmed: false, live: false, weeks: 0 }
      : null;
  let fund: FundLine[] = [];
  if (building) fund = [];
  else if (project) {
    fund = o.fits.slice(0, 3).map((f) => ({ kind: 'fits', title: f.title, prize: f.prize, when: f.when }));
    // v2.13.1 O2: the open-all-year program only when it fits the project (its chain or any chain; a live product only when live).
    const fit = { chains: row?.chains ?? [], live: project.live };
    const rolling = fund.length === 0 && o.due.length === 0 ? rollingPick(o.cards.filter((c) => fitsProject(c, fit)), now, o.skip) : undefined;
    if (rolling) fund = [{ kind: 'rolling', title: rolling.title, prize: earnPrize(rolling) }];
  } else {
    const first = pick?.card ?? null;
    // v2.13.1 O2 (B1): never an idea that needs a live product or a repo for a builder with no project.
    const other = biggestPick(o.cards.filter(noProjectIdea), now, o.skip, first?.id ?? null);
    fund = [first, other].filter((c): c is Card => Boolean(c)).map((c) => ({ kind: 'idea', who: c.pitch?.who ?? c.title, prize: earnPrize(c), for: c.pitch?.for ?? 'a small app' }));
  }
  // v2.13.1 O1: a repo-key project that isn't confirmed gets the proof branch (proof-branch.ts says when).
  // O2: read before the ask, so a project being checked is asked the next Bench step (the updates yes).
  const branch = project && !project.confirmed ? await proofBranchFor(id, project.key, now, { canBuild: o.agentCanBuild }).catch(logged('proof branch')) : null;
  let ask: BenchAsk | null = null;
  if (!o.held && !building) {
    // Only a client that builds is asked to build (a chat-only one sees the ideas).
    const build: BenchAsk | null = !project && pick?.canBuild
      ? pick.card
        ? { kind: 'build', project_key: null, program_id: pick.card.id, line: buildAsk(pick.starter.offer) }
        : { kind: 'build', project_key: null, program_id: BENCH_BUILD_ID, line: benchBuildAsk(benchOffer(pick.starter)) }
      : null;
    const enter: BenchAsk | null = project && o.fits[0] ? { kind: 'enter', project_key: project.key, program_id: o.fits[0].program_id, line: enterAsk(o.fits[0].title) } : null;
    const web = project ? read.base.projects.some((x) => x.key.toLowerCase() === project.key.toLowerCase() && x.web) : false;
    const declined = declinedNow(read.seen, now.getTime());
    const asks = {
      project, canHost: Boolean(project && hostFor(o.agentCanBuild)(project.key) && web), updatesOn: read.updatesOn,
      postedThisWeek: read.postedThisWeek, scheduled: read.scheduled, build, declined,
      joining: Boolean(project && !project.confirmed && (!branch || branch.kind === 'checking')),
    };
    // The coin is offered (and its moment recorded) only when no earlier ask in the order applies.
    const before = chooseAsk({ ...asks, coin: null, enter: null });
    const coin = !before && project && row
      ? await coinAskBench(id, { ...project, people: row.people, has_coin: row.has_coin, streak: row.streak, shipped: row.shipped }, read.seen, o.coinDeps).catch(logged('coin'))
      : null;
    ask = before ?? chooseAsk({ ...asks, coin, enter });
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
    branch: branch?.kind ?? null, slow, fund, ask, due: building ? [] : o.due,
    building: building ? (building.name ?? null) : null,
    page: read.base.claimed && read.base.handle ? `${siteUrl()}${pagePath(read.base.handle)}` : null,
  };
  // A raise ask is answered through move_up (benchMoveUp: setRaising), as every Bench ask but the coin offer.
  const note = ask?.kind === 'coin' ? COIN_NOTE : BENCH_MOVE_UP_NOTE;
  const fields: Reply = {
    ...(ask && { move_up: { kind: ask.kind, project_key: ask.project_key, agent_note: note } }),
    ...(showsClaimLink(view) && read.base.claimLink && { claim: { link: read.base.claimLink } }),
    rank_lines: [read.ranks.bench, ...read.ranks.chains.map((c) => c.line)].filter((x): x is string => Boolean(x)),
    streak: row?.streak ?? 0,
  };
  return { view, ask, fields, branch };
}

/** What find hands benchFind: standFind's arguments, plus the project the agent named. */
export type BenchFindArgs = {
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
  await checkProofBranch(id, now, { ghFetch: ctx.proofBranchFetch ?? ctx.readerDeps?.ghFetch });
  const read = await benchRead(id, now, ctx.freshDeps);
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
    coinDeps: { check: ctx.tokenDeps?.check },
  });
  const proof = branch?.kind === 'checking' ? branch.proof : await branchToRemove(id, now).catch(logged('proof branch told'));
  const asks = held || Boolean(submit) || Boolean(ask);
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
    show_to_builder: [opener, benchReply(view), a.pickup?.question].filter(Boolean).join('\n\n'),
    note: ['Show show_to_builder to the builder exactly as written.', EARN_NOTE].join(' '),
    ...fields,
    ...(fits[0] && !submit && { lead: { program_id: fits[0].program_id, repo: fits[0].repo } }),
    ...(submit && { lead: { program_id: submit.card.id, step: 'submit', ...(submit.entry.id !== undefined && { project_id: submit.entry.id }) } }),
    ...(pick && { build_offer: { program_id: pick.card?.id ?? BENCH_BUILD_ID, starter_id: pick.starter.id, can_build: pick.canBuild } }),
    ...(proof && { proof }),
    ...(weekly && { schedule_weekly_update: WEEKLY_UPDATE_NOTE }),
  };
}

/**
 * score under the Bench flag: the profile (and a discovery run) on the first call, the refresh within
 * its budget, then find's view without a matcher: the one project's fits from what find last saw
 * (stand-view.ts scoreEarn), else the open-all-year program; no project, the build. One
 * score_viewed event a minute (v2.12). Null without a profile (score-tool.ts answers that).
 */
export async function benchScore(ctx: Pick<ToolContext, 'installationId' | 'freshDeps' | 'tokenDeps' | 'proofBranchFetch'>, now: Date, o: { hold?: boolean; reader?: ReaderDeps; fresh?: FreshOn } = {}): Promise<Reply | null> {
  const id = ctx.installationId;
  const made = await ensureProfile(id, now);
  if (!made) return null;
  if (made.created) await enqueueDiscovery(id, 'first_find');
  await startRefresh(id, { now, start: Date.now(), reader: o.reader }).within();
  await checkProofBranch(id, now, { ghFetch: ctx.proofBranchFetch ?? o.reader?.ghFetch });
  const read = await benchRead(id, now, ctx.freshDeps);
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
    agentCanBuild: fresh?.canBuild ?? false, due: [], coinDeps: { check: ctx.tokenDeps?.check },
  });
  const proof = branch?.kind === 'checking' ? branch.proof : await branchToRemove(id, now).catch(logged('proof branch told'));
  await noteEvent('score_viewed', () => ({
    type: 'score_viewed',
    dedupe_key: `score_viewed:${id}:${Math.floor(now.getTime() / 60_000)}`,
    installation_id: id,
    detail: { rank: read.base.standing.ranked ? read.base.standing.rank : null, total: read.base.standing.total },
  }));
  return {
    show_to_builder: benchReply(view),
    ...fields,
    ...(fits[0] && { lead: { program_id: fits[0].program_id }, note: EARN_NOTE }),
    ...(pick && { build_offer: { program_id: pick.card?.id ?? BENCH_BUILD_ID, starter_id: pick.starter.id, can_build: pick.canBuild } }),
    ...(proof && { proof }),
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
export async function benchMoveUp(ctx: Pick<ToolContext, 'installationId'>, m: { kind?: string; project_key?: string | null; answer: 'yes' | 'no'; live_url?: string }): Promise<Reply> {
  const id = ctx.installationId;
  const now = new Date();
  const okay = { show_to_builder: COUNT_LINES.noted };
  const asked = await benchAsked(id, m);
  if (!asked) return okay;
  if (m.answer === 'no') {
    await sql()`
      UPDATE builder_profiles SET standing_seen = jsonb_set(COALESCE(standing_seen, '{}'::jsonb), '{declined}',
        COALESCE(standing_seen->'declined', '{}'::jsonb) || jsonb_build_object(${benchStepKey(asked.kind, asked.key)}::text, ${now.toISOString()}::text)) - 'bench_ask'
      WHERE builder_id = ${id}`.catch(logged('decline'));
    return okay;
  }
  // Fix round 1: answered once. The ask is cleared before the yes runs, so a retried yes is "Okay.".
  // (go_live and coin yeses stay in tools.ts: go_live's yes is sent again with live_url by design.)
  if (['updates', 'post_update', 'build', 'enter', 'raise'].includes(asked.kind)) {
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
      return setRaising(id, true);
    default:
      return okay;
  }
}
