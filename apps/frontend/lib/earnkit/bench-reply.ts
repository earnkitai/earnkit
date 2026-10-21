import { siteUrl } from './entry-text';
import { pagePath, pageUrl } from './reserved-routes';
import { scoreLine } from './rank';
import { POINTS_LINE } from './points';

/**
 * v2.13 spec "2a", "2b", "5. Ways to get funded", "The last line", v2.14 spec 4: the reply in three parts
 * (where you stand, ways to get funded, how to move up), one https link and exactly one next step, last.
 * Scoring and clarity R8, R12, R16a: four states; ranked replies move up by shipping (launch ready L5: the
 * weekly target), never by a coin, token or community round; ways to get funded are the programs that fit, each
 * with its deadline and why. Plain words; a funder's short name is a name (plan B12). Pure.
 */
export const BENCH_HEADS = { stand: 'Where you stand', fund: 'Ways to get funded', up: 'How to move up' } as const;
/** R16a: four states; proven and shipping merged into `ranked` (the streak lives in the Shipping score). */
export type ReplyState = 'signed_out' | 'no_project' | 'not_counted' | 'ranked';
export type Variant = 'taken' | 'copy' | 'no_repo' | 'app_off' | null;
/** R8: `ship` is the ranked state's one step; `suggest` stays for a project the App can't count (app_off). */
/** Launch ready L2: `pick_repo`, the no_project state's repo picker (`start` only while the App link can't be made). */
/** Launch ready L6: `share`, the weekly moment's share link and question (ranked, once a week). */
/** v3 Stage 1: `connect`, the backfilled weeks' one yes after the App connects a repo (ranked, once a person). */
/** v3 Stage 2: `apply`, the drafted application for a fit closing within APPLY_WINDOW_DAYS (ranked, once a program). */
/** v3 Stage 2: `backing`, the backing offer after the first approved week with code (ranked, once a project, EARNKIT_RAISING on). */
export type BenchAskKind = 'sign_in' | 'start' | 'pick_repo' | 'install_app' | 'other_project' | 'repo_behind' | 'ship' | 'suggest' | 'share' | 'connect' | 'backing' | 'apply';
/** `program_id`: the program an `apply` ask is about (its no is kept under it, never the project). */
export type BenchAsk = { kind: BenchAskKind; project_key: string | null; line: string; program_id?: string };
export type FundLine =
  /** R12: a program that fits: its award, its deadline ("closes Oct 30" or "rolling") and why it fits. */
  | { kind: 'fits'; title: string; prize: string; when: string; why: string }
  | { kind: 'idea'; who: string; prize: string; for: string }
  /** v2.13.3 (2): an open program and what it needs, in plain words (never a fit claimed). */
  | { kind: 'needs'; title: string; prize: string | null; needs: string }
  /** v3 Stage 1: the ranked builder's points so far (points.ts), last under Ways to get funded. */
  | { kind: 'points'; total: number }
  /** v3 Stage 2: one program not open yet, for a ranked builder on a 4-week streak: a statement, no link. */
  | { kind: 'upcoming'; title: string; prize: string; note: string }
  /** v3 Stage 2: backing is open on the one project (EARNKIT_RAISING on): its backers and fees earned, and the page. A statement, never a step. */
  | { kind: 'backing'; backers: number; earned_usd: number; page: string };
export type BenchProject = { key: string; name: string; confirmed: boolean; live: boolean; weeks: number };

export const NOT_ON_BENCH = "You're not on the leaderboard yet.";
/** v3 Stage 2: "Base Batches 005: up to $100K, not open yet. <note>" (a statement, never a link or a question). Pure. */
export const upcomingLine = (title: string, prize: string, note: string) => `${title}: ${prize}, not open yet. ${note}`;
/**
 * v3 Stage 2 (spec 5.3 Route 2): the backing fund line, "Backing: 3 backers, $12 in fees. Your page: ..."; with none of
 * either yet, "Backing open. Your page: ...". Pure.
 */
export const backingLine = (backers: number, earned: number, page: string) =>
  backers === 0 && earned === 0 ? `Backing open. Your page: ${page}` : `Backing: ${backers} ${backers === 1 ? 'backer' : 'backers'}, $${earned.toLocaleString('en-US')} in fees. Your page: ${page}`;
export const NO_MONEY_LINE = "No program is open right now. I'll look again next week.";
/** R12: a ranked project no open program fits (only fits are named for it). */
export const noFitLine = (name: string) => `No open program fits ${name} yet. I'll look again next week.`;
/** R8: the ranked state's one next step when no weekly target can be worked out (no Shipping row yet). */
export const SHIP_STEP = 'Ship this week to climb.';
/** v3 Stage 1 (spec 5.1): the connect weeks' one question (ranked, once a person); the page stays the link. */
export const connectAsk = (handle: string) => `Post these weeks to your public page? Yes puts them on ${pageUrl(handle)} and the Feed.`;
/** v3 Stage 2 (spec 5.3): a fit whose deadline is this many days away (or fewer) is offered as a drafted application. */
export const APPLY_WINDOW_DAYS = 30;
/** v3 Stage 2: the apply step's one question; `when` is the deadline's day as fundWhen gives it, without "closes" ("Nov 18"). */
export const applyAsk = (title: string, when: string) => `${title} closes ${when}. Want me to draft your application from your ship log?`;
/** Launch ready L6: the weekly moment's one next step, in place of the target (one link, one question). */
export const shareAsk = (link: string) => `Share your week on X: ${link}\nDoes last week look right?`;
/**
 * R16c: the ranked stand line is the score line: "EarnKit: Shipping 72 · #3 of 40 builders."
 * Before its first Shipping score (no row yet, or one from an older formula): the project is counted.
 */
export const shippingStand = (name: string, score: number | null, rank: string | null) =>
  score === null ? `${name} is counted. Its Shipping score comes with the next read.` : `${name}: ${scoreLine(score, rank)}.`;

/** R12: "Base Builder Grants: up to $5K, rolling. You deployed on Base and your app is live." Pure. */
export const fitsLine = (title: string, prize: string, when: string, why: string) => `${title}: ${prize}, ${when}. ${why}`;
export const ideasLine = (ideas: { who: string; prize: string; for: string }[]) => ideas.map((i) => `${i.who} pays ${i.prize} for ${i.for}.`).join(' ');
/** v2.13.3 (2): "Base Builder Grants: up to $5K for a Base app, once it's live." */
export const needsLine = (title: string, prize: string | null, needs: string) => `${title}: ${prize ? `${prize} ` : ''}${needs}.`;
/** v2.13.1 O5 N5: one small thing to ship (app_off: the App can't count the project). */
export const shipAsk = (name: string) => `Want me to suggest one small thing to ship in ${name} this week?`;
/** v2.13.1 O2 fix round 1 (ruling 3): another person holds the repo, or it is a copy. */
export const OTHER_PROJECT_ASK = 'Want to use a different project?';
/** The key a no keeps an ask away under (standing_seen.declined, 30 days). Pure. */
export const benchStepKey = (kind: string, key: string | null) => `${kind}:${key ?? '*'}`;

/**
 * R16a: the four states' copy, the only place it lives. Each state has one stand line and exactly one next
 * step; the link a state carries is its step's (sign-in, install), else the page.
 */
export const STATE_COPY = {
  signed_out: {
    stand: () => NOT_ON_BENCH,
    ask: (link: string) => `Sign in with X to get your page (one click): ${link}\nWant me to put your work on the leaderboard once you're in?`,
    /** Fix round 1: the link couldn't be made this time (never read as signed in). */
    retry: () => "I couldn't make your sign-in link just now. Want me to try again?",
  },
  no_project: {
    stand: () => NOT_ON_BENCH,
    /** Launch ready L2: the repo picker's install link (GitHub's page picks the repos); never a GitHub URL asked for. */
    ask: (link: string) => `Install the read-only EarnKit app on the repo you want ranked (one click): ${link}\nWant me to rank it once that's done?`,
    /** The App link can't be made (the App is off): their work is asked for instead. */
    noApp: () => "What's your GitHub, or a link to something you've made?",
  },
  not_counted: {
    stand: (name: string) => `${name} isn't counted yet.`,
    ask: (link: string) => `Install the read-only EarnKit app on it (one click): ${link}\nWant me to count it once that's done?`,
  },
  ranked: {
    stand: (name: string, score: number | null, rank: string | null) => shippingStand(name, score, rank),
    /** Launch ready L5: the weekly target (weekly-target.ts weeklyTarget), else the plain step. */
    ask: (target: string | null = null) => target ?? SHIP_STEP,
  },
} as const;
/** v3 Stage 2 (spec 5.2): "Earned $340." after the ranked score line, only from $1 (a statement, never a step). Pure. */
export const earnedWords = (usd: number) => `Earned $${Math.round(usd).toLocaleString('en-US')}.`;
/** Scoring and clarity R3: "Originality 72." beside the score line (computed only; never a rank). Pure. */
export const originalityWords = (n: number) => `Originality ${n}.`;
/** A15: not counted, when the install link can't help. */
export const VARIANT_COPY = {
  taken: { stand: (n: string) => `${n} is already on the leaderboard under another account.`, ask: () => OTHER_PROJECT_ASK },
  copy: { stand: (n: string) => `${n} is a copy of someone else's project. Use your own.`, ask: () => OTHER_PROJECT_ASK },
  no_repo: { stand: (n: string) => `${n} isn't counted yet.`, ask: (n: string) => `Where does ${n} live on GitHub?` },
  app_off: { stand: (n: string) => `${n} isn't counted yet.`, ask: (n: string) => shipAsk(n) },
} as const;

/** Which of the four states a reply is in. Pure. */
export function replyState(i: { signedIn: boolean; project: BenchProject | null; counted: boolean }): ReplyState {
  if (!i.signedIn) return 'signed_out';
  if (!i.project) return 'no_project';
  if (!i.counted) return 'not_counted';
  return 'ranked';
}

/** R10: only the ranked state shows a rank (the one project counts); the others carry no rank and no rank news. Pure. */
export const rankedState = (s: ReplyState) => s === 'ranked';

export type BenchView = {
  state: ReplyState; variant: Variant; project: BenchProject | null; rank: string | null;
  /** Shipping (0 to 100) and its why sentence (score-v2.ts scoreWhy), shown in the ranked state only. */
  score: number | null; why: string | null;
  /** Launch ready L5: the weekly target, the ranked state's one next step (null: "Ship this week to climb."). */
  target: string | null;
  /** Launch ready L6: the weekly moment's X share link (ranked, once a week); it is then the reply's one link and its step. */
  share: string | null;
  /** Scoring and clarity R3: Originality (0 to 100, never ranked), after the score line when ranked; null until computed. */
  originality: number | null;
  /** v3 Stage 2 (spec 5.2): Earned (earned.ts paid_usd: fees claimed plus announced prizes), after the ranked score line from $1. */
  earned?: number;
  /** The person's page handle (null: signed out, or no page to name, as with X off). */
  handle: string | null;
  /** The state's action link: the sign-in link (signed_out), the repo picker (no_project), the install link (not_counted, no variant) or the share link (ranked, the weekly moment). */
  link: string | null;
  fund: FundLine[]; due: string[]; ask: BenchAsk;
  /** A17: an outcome question or a submission step, asked instead of the state's step. */
  held: string | null;
};

/** v3 Stage 2: the program the apply step offers to draft for (its deadline's day, "Nov 18"). */
export type ApplyPick = { program_id: string; title: string; when: string };
/**
 * Each state's one next step (A16; signed out with no link: the retry). Ranked, in order: the connect weeks' question
 * (`connect`), the backing offer (`backing`, its line given), the drafted application (`apply`), the weekly moment's
 * share ask once a week (L6), else the weekly target (L5), else "Ship this week to climb.". Pure.
 */
export function stateAsk(
  v: Pick<BenchView, 'state' | 'variant' | 'project' | 'link'> & Partial<Pick<BenchView, 'target' | 'share'>> & { handle?: string | null; connect?: boolean; backing?: string | null; apply?: ApplyPick | null },
): BenchAsk {
  const key = v.project?.key ?? null;
  const name = v.project?.name ?? '';
  if (v.state === 'signed_out') return { kind: 'sign_in', project_key: null, line: v.link ? STATE_COPY.signed_out.ask(v.link) : STATE_COPY.signed_out.retry() };
  if (v.state === 'no_project')
    return v.link ? { kind: 'pick_repo', project_key: null, line: STATE_COPY.no_project.ask(v.link) } : { kind: 'start', project_key: null, line: STATE_COPY.no_project.noApp() };
  if (v.state === 'ranked' && v.connect && v.handle) return { kind: 'connect', project_key: key, line: connectAsk(v.handle) };
  if (v.state === 'ranked' && v.backing) return { kind: 'backing', project_key: key, line: v.backing };
  if (v.state === 'ranked' && v.apply) return { kind: 'apply', project_key: key, program_id: v.apply.program_id, line: applyAsk(v.apply.title, v.apply.when) };
  if (v.state === 'ranked')
    return v.share ? { kind: 'share', project_key: key, line: shareAsk(v.share) } : { kind: 'ship', project_key: key, line: STATE_COPY.ranked.ask(v.target ?? null) };
  if (v.variant === 'taken' || v.variant === 'copy') return { kind: 'other_project', project_key: key, line: VARIANT_COPY[v.variant].ask() };
  if (v.variant === 'no_repo') return { kind: 'repo_behind', project_key: key, line: VARIANT_COPY.no_repo.ask(name) };
  if (v.variant === 'app_off' || !v.link) return { kind: 'suggest', project_key: key, line: VARIANT_COPY.app_off.ask(name) };
  return { kind: 'install_app', project_key: key, line: STATE_COPY.not_counted.ask(v.link) };
}

function standLine(v: BenchView): string {
  const name = v.project?.name ?? '';
  if (v.state === 'not_counted' && v.variant) return VARIANT_COPY[v.variant].stand(name);
  if (v.state === 'signed_out' || v.state === 'no_project') return NOT_ON_BENCH;
  if (v.state === 'not_counted') return STATE_COPY.not_counted.stand(name);
  const stand = STATE_COPY.ranked.stand(name, v.score, v.rank);
  const line = Math.round(v.earned ?? 0) > 0 ? `${stand} ${earnedWords(v.earned!)}` : stand;
  return v.originality !== null && v.score !== null ? `${line} ${originalityWords(v.originality)}` : line;
}
function fundLines(v: BenchView): string[] {
  const ideas = v.fund.filter((f): f is Extract<FundLine, { kind: 'idea' }> => f.kind === 'idea');
  // R12: at most 3 programs that fit.
  const fits = v.fund.flatMap((f) => (f.kind === 'fits' ? [fitsLine(f.title, f.prize, f.when, f.why)] : [])).slice(0, 3);
  // v2.13.3 (2): what each other open program needs comes last (the programs that fit, and the ideas, first).
  const needs = v.fund.flatMap((f) => (f.kind === 'needs' ? [needsLine(f.title, f.prize, f.needs)] : [])).slice(0, 3);
  return [...v.due, ...fits, ...(ideas.length ? [ideasLine(ideas.slice(0, 2))] : []), ...needs];
}
export function benchReply(v: BenchView): string {
  // A14: one https link a reply. Beside the state's action link the page is named without https; a held
  // question (A17) carries no link, so the page is then the link.
  const linked = Boolean(v.link) && (!v.held || v.state === 'signed_out');
  const page = v.handle ? `Your page: ${linked && v.state !== 'signed_out' ? pageUrl(v.handle) : `${siteUrl()}${pagePath(v.handle)}`}` : null;
  // The why sentence sits under the ranked stand line: a statement, never a second question.
  const why = v.state === 'ranked' && v.why ? [v.why] : [];
  const stand = [BENCH_HEADS.stand, standLine(v), ...why, ...(page && v.state !== 'signed_out' ? [page] : [])];
  const fund = fundLines(v);
  const none = v.state === 'ranked' && v.project ? noFitLine(v.project.name) : NO_MONEY_LINE;
  // v3 Stage 1: the points statement is last, and never stands in for the no-fit line.
  const pts = v.state === 'ranked' ? v.fund.flatMap((f) => (f.kind === 'points' && f.total > 0 ? [POINTS_LINE(f.total)] : [])) : [];
  // v3 Stage 2: at most one upcoming line, after the fits (or the no-fit line) and before the points.
  const soon = v.state === 'ranked' ? v.fund.flatMap((f) => (f.kind === 'upcoming' ? [upcomingLine(f.title, f.prize, f.note)] : [])).slice(0, 1) : [];
  // v3 Stage 2: the backing line, a statement after the upcoming line; its page is the reply's link only when no other is.
  const backing = v.state === 'ranked' ? v.fund.flatMap((f) => (f.kind === 'backing' ? [backingLine(f.backers, f.earned_usd, page || linked ? pageUrlOf(f.page) : f.page)] : [])).slice(0, 1) : [];
  const money = [BENCH_HEADS.fund, ...(fund.length ? fund : [none]), ...soon, ...backing, ...pts];
  // Fix round 1 (ruling 4): signed out, the sign-in step always wins.
  const up = [BENCH_HEADS.up, v.state === 'signed_out' ? v.ask.line : (v.held ?? v.ask.line)];
  return [stand, money, up].map((x) => x.join('\n')).join('\n\n');
}

/** A page link without its scheme ("earnkit.com/maya"), as a reply names it beside its one https link. Pure. */
const pageUrlOf = (u: string) => u.replace(/^https?:\/\//i, '');

/** "tip-jar" -> "Tip Jar". Pure. */
const titleCase = (s: string) =>
  s.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * v2.13.4 (spec 3): the project's name in a reply. A name that is only the repo's own name ("earnkit") is
 * shown as the live site spells it ("EarnKit", the title's first part, only when it is the same name and
 * plain letters), else title-cased ("Earnkit"); a name the agent gave stays. The site's title never adds
 * words of its own (it is untrusted text). Pure.
 */
export function displayName(name: string, key: string, siteTitle: string | null): string {
  const base = key.includes('/') ? key.split('/').pop()! : key;
  if (squash(name) !== squash(base) || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) return name;
  const first = siteTitle?.split(/\s+[-|–—:·]\s+|\s*[|–—:·]\s*/)[0]?.trim() ?? '';
  if (first && /^[A-Za-z0-9][A-Za-z0-9 .&'+-]{0,39}$/.test(first) && squash(first) === squash(base)) return first;
  return titleCase(name);
}
