import { signInLink } from './x-link';
import { sql } from './db';
import { noteEvent } from './events';
import { REFRESH_BUDGET_MS, refreshPerson, standingOf, trackingHeld } from './person-score';
import { personCode } from './attribution';
import { emptyMemory, hiddenIds, hiddenPrograms, readMemory } from './builder-memory';
import { deployChainOn } from './deploy';
import { listPrograms } from './programs';
import { rpcFor } from './verify';
import { r2Enabled } from './r2';
import type { Standing } from './rank';
import type { ReaderDeps } from './source-readers';
import { paymentStepFits, stepKey, plainWhat, rollingLine, standingNews, usersMoneyLine, type EarnLine, type StandProject, type StandView } from './stand-text';
import { closeDayOf, prizeOf } from './entry-text';
import { freshPick, type FreshPick } from './fresh-build';
import { byPrize, type Card, type FreshOn } from './present';
import { NEEDS_LIVE_PRODUCT, levelRank } from './guide';
import { moneyText, openCurated } from './pool';
import { newProgramOf, openCuratedRows, repoCanWin } from './alerts';
import { readFitRepos } from './installations';

/**
 * v2.12.1 T8: the reads and writes behind the three-part reply (where-you-stand.ts is pure): the
 * on-demand refresh within its budget, the person's view, the news since they last looked, the
 * one-time "Your page is ready";
 * callers check it.
 */

/** What the person was last told (builder_profiles.standing_seen). */
export type Seen = { rank?: number; people?: Record<string, number>; at?: string; declined?: Record<string, string> };
/** T9: a no keeps that step away this long. */
export const DECLINE_MS = 30 * 86_400_000;
/** The step keys declined within DECLINE_MS of `now`. Pure. */
export const declinedNow = (seen: Seen, now: number): string[] =>
  Object.entries(seen.declined && typeof seen.declined === 'object' ? seen.declined : {})
    .filter(([, at]) => typeof at === 'string' && now - Date.parse(at) < DECLINE_MS)
    .map(([k]) => k);
export type StandBase = Omit<StandView, 'step' | 'news' | 'earn' | 'fresh'>;

/**
 * spec 2: "Inside that call (10-second budget) EarnKit reads the person's public data. Anything
 * slower finishes on the next reply or page view." Starts the refresh (Task 4: at most once every
 * 10 minutes, never throws); `within` resolves when it is done or the budget is spent, whichever is
 * first. A reader that ignores its deadline keeps running in the background and its rescore lands
 * for the next reply; this reply uses the last stored numbers.
 */
export function startRefresh(id: number, o: { now: Date; start: number; reader?: ReaderDeps; minAgeMs?: number }): { within: (capMs?: number) => Promise<void> } {
  const deadline = o.start + REFRESH_BUDGET_MS;
  const refresh = refreshPerson(id, { now: o.now, deadline, reader: o.reader, minAgeMs: o.minAgeMs }).catch((err: unknown) => {
    console.error('[stand] refresh', err instanceof Error ? err.name : 'error');
  });
  return {
    // v2.13.1 O5 N1: `capMs` (the Bench's reply wait) ends the wait sooner; the refresh runs on to its deadline.
    within: async (capMs?: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const until = capMs === undefined ? deadline : Math.min(deadline, o.start + capMs);
      const spent = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, until - Date.now()));
      });
      await Promise.race([refresh, spent]);
      clearTimeout(timer);
    },
  };
}

type ProjectDbRow = {
  project_key: string; name: string; what: string | null; kind: string; confirmed: boolean; shipped: boolean; people: number;
  has_coin: boolean; sends_tx: boolean; tagged: boolean; untracked_contract: string | null; readable: boolean; certain: boolean; tracked_tx: boolean; web: boolean;
};

/** Fix round 1: the switches a tip jar needs (FreshOn's); absent, the server's own (deploys, hosting). */
export type TipSwitches = Partial<Pick<FreshOn, 'deployOn' | 'hostOn' | 'starters'>>;
export const TIPJAR = 'arc-tipjar';

/**
 * Fix round 1 (rulings 2, 3): the program a tip jar can be deployed under now: freshPick over the
 * open programs with the arc-tipjar starter, with the person's real hidden and entered programs; a
 * program they already entered is reused (`entered`). The deploy itself never enters a program (an
 * entry is only ever made by confirm, on the builder's own yes). Null when nothing can deploy one.
 */
export async function tipsPick(id: number, now: Date, fresh: TipSwitches = {}): Promise<{ program_id: string; starter: string; entered: boolean } | null> {
  const cards = (await listPrograms()).filter((c) => c.fresh_build?.starter === TIPJAR);
  if (cards.length === 0) return null;
  // Fix round 2: every installation of the person's group (their memory is per installation).
  const group = (await sql()<{ id: number }[]>`SELECT id FROM installations WHERE COALESCE(builder_id, id) = ${id}`).map((r) => r.id);
  const hidden = new Set<string>();
  for (const member of group.length ? group : [id]) {
    const memory = await readMemory({ installationId: member, login: '' }).catch(() => emptyMemory());
    for (const h of hiddenIds(hiddenPrograms(memory, cards))) hidden.add(h);
  }
  const rows = await sql()<{ program_id: string }[]>`
    SELECT DISTINCT p.program_id FROM projects p JOIN installations i ON i.id = p.installation_id
    WHERE COALESCE(i.builder_id, i.id) = ${id} AND p.program_id IN ${sql()(cards.map((c) => c.id))}`;
  const entered = new Set(rows.map((r) => r.program_id));
  const opts = {
    hidden,
    deployOn: fresh.deployOn ?? ((c: Parameters<FreshOn['deployOn']>[0]) => deployChainOn(c) && rpcFor(c) !== null),
    hostOn: fresh.hostOn ?? r2Enabled(),
    ...(fresh.starters && { starters: fresh.starters }),
  };
  const fresh1 = freshPick(cards, now, { ...opts, entered });
  if (fresh1) return { program_id: fresh1.card.id, starter: fresh1.starter.id, entered: false };
  const again = freshPick(cards.filter((c) => entered.has(c.id)), now, { ...opts, entered: new Set() });
  return again ? { program_id: again.card.id, starter: again.starter.id, entered: true } : null;
}

/** A GitHub repo key ("lee/tipjar"): the project EarnKit can host (R2) or put on GitHub Pages. Pure. */
const REPO_KEY = /^[a-z0-9-]+\/[a-z0-9._-]+$/i;
/**
 * Ruling S15: EarnKit can put this project online now: it has a GitHub repo, and EarnKit hosting
 * is on (R2) or the agent can push a GitHub Pages branch (it builds).
 */
export const hostFor = (agentCanBuild: boolean) => (key: string) => REPO_KEY.test(key) && (r2Enabled() || agentCanBuild);

/**
 * The person's view without programs or a step: their standing (Task 4), their projects (shipped
 * first, then people, then newest), and the X sign-in link while they have no page (x-link.ts signInLink, for the
 * caller's own installation). Null without a profile.
 */
export async function standBase(id: number, o: { fresh?: TipSwitches; own?: number } = {}): Promise<{ base: StandBase; seen: Seen; created_at: Date; page_ready_shown_at: Date | null } | null> {
  const [p] = await sql()<{ standing_seen: unknown; created_at: Date; page_ready_shown_at: Date | null }[]>`
    SELECT standing_seen, created_at, page_ready_shown_at FROM builder_profiles WHERE builder_id = ${id}`;
  if (!p) return null;
  const s = await standingOf(id);
  // T9: `readable`: none of the project's contracts is only on a chain EarnKit doesn't read (Monad,
  // Tempo), so its tags can be counted;
  // `certain`: its untracked contract is provable now, so counting it moves the rank today (EarnKit
  // deployed it for this person, or a wallet they signed with created it, and no one else has it).
  const rows = await sql()<ProjectDbRow[]>`
    SELECT p.project_key, p.name, p.what, p.kind, p.confirmed, p.shipped, p.people, p.has_coin, p.sends_tx, p.tagged, p.untracked_contract,
      (NOT EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${id} AND s.project_key = p.project_key AND s.kind = 'contract'
          AND s.state <> 'rejected')
        OR EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${id} AND s.project_key = p.project_key AND s.kind = 'contract'
          AND s.state <> 'rejected' AND s.ref ~ '^(base|arc):')
        OR EXISTS (SELECT 1 FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
          WHERE COALESCE(i.builder_id, i.id) = ${id} AND d.status = 'deployed' AND lower(d.repo_key) = lower(p.project_key))) AS readable,
      (p.untracked_contract IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM builder_sources o WHERE o.kind = 'contract' AND o.state = 'verified' AND o.builder_id <> ${id}
          AND lower(o.ref) = lower(p.untracked_contract))
        AND (EXISTS (SELECT 1 FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
              WHERE COALESCE(i.builder_id, i.id) = ${id} AND d.status = 'deployed' AND d.address IS NOT NULL
                AND d.chain || ':' || lower(d.address) = lower(p.untracked_contract))
          OR EXISTS (SELECT 1 FROM builder_sources s JOIN person_wallets w ON w.wallet = s.deployer AND w.builder_id = ${id}
              -- as contractOwnership: a proven wallet's contract is theirs (deploy_wallet comes before the
              -- deployer-taken check, which only guards a repo deploy file's claim, repo_link)
              WHERE s.builder_id = ${id} AND s.kind = 'contract' AND lower(s.ref) = lower(p.untracked_contract)))) AS certain,
      (EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${id} AND s.project_key = p.project_key AND s.kind = 'contract'
          AND s.state = 'verified' AND s.ref ~ '^(base|arc):')
        OR EXISTS (SELECT 1 FROM contract_deploys d JOIN installations i ON i.id = d.installation_id
          WHERE COALESCE(i.builder_id, i.id) = ${id} AND d.status = 'deployed' AND lower(d.repo_key) = lower(p.project_key))) AS tracked_tx,
      -- v2.12.2: a sign the code is a website (its homepage, or GitHub's web-code reading): go_live is offered only then.
      (EXISTS (SELECT 1 FROM builder_sources s WHERE s.builder_id = ${id} AND s.project_key = p.project_key AND s.kind = 'site' AND s.state <> 'rejected')
        OR EXISTS (SELECT 1 FROM builder_sources s JOIN source_live l ON l.source_id = s.id
          WHERE s.builder_id = ${id} AND s.kind = 'repo' AND lower(s.ref) = lower(p.project_key) AND l.signals->>'web' = 'true')
        OR EXISTS (SELECT 1 FROM builder_sources s JOIN source_readings g ON g.source_id = s.id
          WHERE s.builder_id = ${id} AND s.kind = 'repo' AND lower(s.ref) = lower(p.project_key) AND g.signals->>'web' = 'true')) AS web
    FROM builder_projects p WHERE p.builder_id = ${id}
    ORDER BY p.shipped DESC, p.people DESC, p.last_active_at DESC NULLS LAST, p.project_key`;
  const projects: StandProject[] = rows.map((r) => ({
    key: r.project_key,
    name: r.name,
    what: plainWhat(r.what),
    shipped: r.shipped,
    people: Math.max(0, r.people),
    has_coin: r.has_coin,
    // T9: tags are read only on contracts EarnKit reads: a project on any other chain is never asked to tag.
    sends_tx: r.sends_tx && r.readable,
    tagged: r.tagged,
    untracked_contract: r.untracked_contract,
    // Task 4 sets untracked_contract only for a contract with callers; the count itself is T9's read.
    untracked_people: r.untracked_contract ? 1 : 0,
    // T9: provable from stored facts (make-countable.ts countableNow). `certain` (the count moves the
    // rank today) is set below for the one count_past candidate only.
    certain: false,
    provable: r.certain,
    tracked_tx: r.tracked_tx,
    app: r.kind === 'app',
    code: r.kind === 'code',
    web: r.web,
    confirmed: r.confirmed,
  }));
  const claimed = s.claimed && Boolean(s.handle);
  const link = claimed ? null : await signInLink(o.own ?? id, new Date()).catch((err: unknown) => {
    console.error('[stand] sign-in link', err instanceof Error ? err.name : 'error');
    return null;
  });
  const standing: Standing = { ranked: s.ranked, rank: s.rank, total: s.total };
  const seen = p.standing_seen && typeof p.standing_seen === 'object' ? (p.standing_seen as Seen) : {};
  const declined = declinedNow(seen, Date.now());
  // Fix rounds 1, 2: "today" only when the rescore would not be held (trackingHeld, one rolled-back
  // rescore), checked for the count_past candidate chooseStep would pick (shipped, untracked users, not
  // declined), only when it is provable.
  const pastKey = (k: string) => declined.includes(stepKey('count_past', k));
  const canProve = claimed ? Boolean(process.env.EARNKIT_AUTH_SECRET) : link !== null;
  // chooseStep's own count_past condition (certain is false here, so: provable, or the link can be made).
  const past = projects.find((x) => x.shipped && x.untracked_contract && x.untracked_people > 0 && !pastKey(x.key) && (x.provable || canProve));
  if (past?.provable) past.certain = !(await trackingHeld(id, past.untracked_contract!, new Date()));
  // Fix round 1 (ruling 4): a step is offered only when its yes can deliver. `prove`: the one tap to
  // show work is theirs can be made (claimed: the wallet page needs the secret; unclaimed: the X
  // sign-in link, X sign-in on). `tag`: the person code can be made. `tips`: a tip jar can be deployed now
  // (read only when a project could be offered one).
  const tipsWanted = projects.some((x) => x.shipped && x.app && !x.sends_tx && paymentStepFits(`${x.what ?? ''} ${x.name}`));
  const can = {
    prove: canProve,
    tag: personCode(id) !== null,
    tips: tipsWanted ? (await tipsPick(id, new Date(), o.fresh).catch(() => null)) !== null : false,
  };
  return {
    base: { standing, claimed, handle: claimed ? s.handle : null, signInLink: link, projects, can, ...(declined.length > 0 && { declined }) },
    seen,
    created_at: p.created_at,
    page_ready_shown_at: p.page_ready_shown_at,
  };
}

/**
 * spec 4: the news line since the person last looked, or null. The first look records where they
 * stand and says nothing (nothing happened yet). A line made records the new standing and, with a
 * card offer, the card's moment (card_moments.latest), and one news_shown event.
 */
export async function takeNews(id: number, seen: Seen, base: StandBase, now: Date, ask: boolean): Promise<string | null> {
  const record = async (card: 'people' | 'rank' | null) => {
    const next: Seen = {
      ...(base.standing.ranked && { rank: base.standing.rank }),
      people: Object.fromEntries(base.projects.map((p) => [p.key, p.people])),
      at: now.toISOString(),
    };
    await sql()`
      UPDATE builder_profiles SET standing_seen = ${sql().json(next as never)}::jsonb || jsonb_strip_nulls(jsonb_build_object('declined', standing_seen->'declined',
          -- v2.13 (bench-find.ts): what the Bench reply asked and noted is kept too 
          'bench_ask', standing_seen->'bench_ask', 'weekly_note_at', standing_seen->'weekly_note_at', 'raise_asked', standing_seen->'raise_asked',
          -- v2.13.1 O5: the quiet asks.
          'quiet', standing_seen->'quiet'))
          -- v2.13.1 O5 fix round 2: the kept repo reads and match, unstripped (their nulls are values).
          -- v2.13.4: the live link check.
          || (SELECT COALESCE(jsonb_object_agg(k, standing_seen->k), '{}'::jsonb) FROM unnest(ARRAY['repo_probe', 'bench_match', 'live_check']) k WHERE standing_seen ? k),
        card_moments = CASE WHEN ${card}::text IS NULL THEN card_moments ELSE card_moments || jsonb_build_object('latest', ${card}::text) END
      WHERE builder_id = ${id}`;
  };
  if (!seen.at) {
    await record(null);
    return null;
  }
  const news = standingNews(seen, { standing: base.standing }, now, ask);
  if (!news) return null;
  await record(news.card);
  await noteEvent('news_shown', () => ({
    type: 'news_shown', dedupe_key: `news_shown:${id}:${now.toISOString()}`, installation_id: id, detail: { card: news.card },
  }));
  return news.line;
}

// ---- Fix round 1: every reply has a way to earn -------------------------------------------------

/** An earn line's prize: "up to $10K" from the per-winner award, else the summary's prize. Pure. */
export const earnPrize = (c: { max_award_usd?: number | null; summary: string; investment?: boolean }) =>
  c.max_award_usd ? `up to ${moneyText(c.max_award_usd)}` : prizeOf(c).split(' × ')[0];
/** "closes Oct 14", or "open all year" for a rolling program. Pure. */
export const earnWhen = (c: { summary: string; ends_at?: Date | null }) => {
  const day = closeDayOf(c);
  return day ? `closes ${day}` : 'open all year';
};

/** A program a person could still be shown: curated, open, never an investment, not entered or hidden. Pure. */
export const showable = (c: Card & { agent_completable?: boolean; earnkit_campaign?: boolean }, now: Date, skip: Set<string>) =>
  !c.sponsored && !c.earnkit_campaign && !c.investment && c.agent_completable !== false && !skip.has(c.id) &&
  openCurated(c as Parameters<typeof openCurated>[0], now);

/**
 * The open-all-year program to name when nothing fits (byLazy first), or undefined. v2.13.4 (R5, the
 * v2.13.3 deferred): `o.unknownPrize` (the Bench) also names a program with no known award (null), as
 * needsPicks does; a program whose award is 0 never. Pure.
 */
export const rollingPick = (cards: Card[], now: Date, skip: Set<string>, o: { unknownPrize?: boolean } = {}): Card | undefined =>
  cards
    .filter((c) => showable(c, now, skip) && closeDayOf(c) === null && ((c.max_award_usd ?? 0) > 0 || (o.unknownPrize === true && c.max_award_usd == null)))
    .sort(byLazy)[0];

/** v2.13 (spec "2b"): the biggest-prize program a person could still be shown, other than `not`. Pure. */
export const biggestPick = (cards: Card[], now: Date, skip: Set<string>, not: string | null): Card | undefined =>
  cards.filter((c) => c.id !== not && showable(c, now, skip) && (c.max_award_usd ?? 0) > 0).sort(byPrize)[0];

/**
 * Controller ruling (fix round 1, concern 2): the open-all-year fallback for the lazy target user:
 * Easy before Medium (a program with no level sorts as Medium), then fewer things to fill in (each
 * time asks plus builder-only fields), then the bigger prize. Pure.
 */
export const byLazy = (a: Card, b: Card) =>
  levelRank(a.difficulty?.level ?? 'Medium') - levelRank(b.difficulty?.level ?? 'Medium') ||
  a.each_time.length + (a.builder_fields ?? 0) - (b.each_time.length + (b.builder_fields ?? 0)) ||
  byPrize(a, b);

/**
 * Fix round 1 (controller ruling): when no program fits a project and no build lead was made, the
 * earn part still says how to earn, in this order: (a) a project that could win once people use it
 * (find's users question, said as a statement), (b) the easiest open-all-year program (byLazy), (c) a fresh build
 * (freshPick directly, without v2.11's lead guards). Pure.
 */
export function moneyFallback(o: {
  cards: Card[]; entered: Set<string>; hidden: Set<string>; now: Date; projects: StandProject[];
  users?: { repo: string; key: string | null; card: Card };
  fresh?: FreshOn;
  /** Matching failed or a repo couldn't be seen (freshLead's Review M1 guard): no fresh build. */
  repoTrouble?: boolean;
}): { money: string | null; pick: (FreshPick & { canBuild: boolean }) | null } {
  if (o.users && !o.users.card.investment) {
    const k = (o.users.key ?? o.users.repo).toLowerCase();
    const p = o.projects.find((x) => x.key.toLowerCase() === k) ?? null;
    return { money: usersMoneyLine(p, o.users.repo, o.users.card.title, earnPrize(o.users.card)), pick: null };
  }
  const rolling = rollingPick(o.cards, o.now, new Set([...o.entered, ...o.hidden]));
  if (rolling)
    return { money: rollingLine(rolling.title, earnPrize(rolling), o.projects.some((p) => p.shipped) && rolling.tag !== NEEDS_LIVE_PRODUCT), pick: null };
  // Review M1 (as freshLead): never a fresh build past a repo read error or a repo EarnKit can't see.
  if (o.fresh && !o.repoTrouble) {
    const pick = freshPick(o.cards, o.now, { hidden: o.hidden, entered: o.entered, deployOn: o.fresh.deployOn, hostOn: o.fresh.hostOn, starters: o.fresh.starters });
    if (pick) return { money: null, pick: { ...pick, canBuild: o.fresh.canBuild } };
  }
  return { money: null, pick: null };
}

/**
 * Fix round 1: the score reply's one earn line, by find's rules without a GitHub read: the biggest
 * open program a remembered fitting project can win (alerts.ts repoCanWin over the fits find last
 * saw), else moneyFallback's statement or build. `cards`: the open programs (listPrograms, agent
 * completable). Never throws (no line on an error).
 */
export async function scoreEarn(
  id: number,
  o: { cards: Card[]; entered: Set<string>; hidden: Set<string>; now: Date; projects: StandProject[]; fresh?: FreshOn },
): Promise<{ earn: EarnLine[]; money: string | null; pick: (FreshPick & { canBuild: boolean }) | null }> {
  try {
    const [fits, rows] = await Promise.all([readFitRepos(id), openCuratedRows()]);
    const byId = new Map(rows.map((r) => [r.id, newProgramOf(r)]));
    const skip = new Set([...o.entered, ...o.hidden]);
    for (const c of o.cards.filter((x) => showable(x, o.now, skip)).sort(byPrize)) {
      const np = byId.get(c.id);
      const repo = np && fits.find((f) => repoCanWin(np, f));
      if (!repo) continue;
      const key = o.projects.find((p) => p.key.toLowerCase() === repo.key.toLowerCase())?.key ?? repo.key;
      return { earn: [{ program_id: c.id, project: key, title: c.title, prize: earnPrize(c), when: earnWhen(c) }], money: null, pick: null };
    }
  } catch (err) {
    console.error('[score] earn', err instanceof Error ? err.name : 'error');
  }
  return { earn: [], ...moneyFallback(o) };
}

