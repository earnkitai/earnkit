import { pageUrl } from './reserved-routes';
import { CONNECT_POINTS, MAX_WEEK_POINTS } from './points';

/**
 * v3.1 Task 16 (owner-approved copy, 2026-10-21): every reply written for a busy builder. Plain text, no headers,
 * short lines: the explanation, the action, then the points line when the step earns points; " · " joins facts on one
 * line; at most one https link; exactly one question; every number real (points read from the ledger rules, points.ts).
 * The logic stays: four states, each with one next step; ranked, in order: connect, apply, backing, share (the weekly
 * moment), ship; a rank only from RANK_MIN_POOL (the rank phrase given is null under it). Pure.
 */
/** R16a: four states; proven and shipping merged into `ranked` (the streak lives in the Shipping score). */
export type ReplyState = 'signed_out' | 'no_project' | 'not_counted' | 'ranked';
export type Variant = 'taken' | 'copy' | 'no_repo' | 'app_off' | null;
/** R8: `ship` is the ranked state's one step; `suggest` stays for a project the App can't count (app_off). */
/** Launch ready L2: `pick_repo`, the no_project state's repo picker (`start` only while the App link can't be made). */
/** Launch ready L6: `share`, the weekly moment's post for X and question (ranked, once a week). */
/** v3 Stage 1: `connect`, the backfilled weeks' one yes after the App connects a repo (ranked, once a person). */
/** v3 Stage 2: `apply`, the drafted application for a fit closing within APPLY_WINDOW_DAYS, v3.1 else a rolling fit (ranked, once a program). */
/** v3 Stage 2: `backing`, the backing offer after the first approved week with code (ranked, once a project, EARNKIT_RAISING on). */
export type BenchAskKind = 'sign_in' | 'start' | 'pick_repo' | 'install_app' | 'other_project' | 'repo_behind' | 'ship' | 'suggest' | 'share' | 'connect' | 'backing' | 'apply';
/** `program_id`: the program an `apply` ask is about (its no is kept under it, never the project). */
export type BenchAsk = { kind: BenchAskKind; project_key: string | null; line: string; program_id?: string };
export type FundLine =
  /** R12: a program that fits: its award ("$5,000", null unknown), its deadline ("closes Oct 30" or "rolling"). */
  | { kind: 'fits'; title: string; amount: string | null; when: string }
  /** v3 Stage 2: one program not open yet, for a ranked builder on a 4-week streak: a statement, no link. */
  | { kind: 'upcoming'; title: string; prize: string; note: string }
  /** v3 Stage 2: backing is open on the one project (EARNKIT_RAISING on): its backers and fees earned, and the page. A statement, never a step. */
  | { kind: 'backing'; backers: number; earned_usd: number; page: string };
export type BenchProject = { key: string; name: string; confirmed: boolean; live: boolean; weeks: number };

/** v3 Stage 2: "Base Batches 005: up to $100K, not open yet. <note>" (a statement, never a link or a question). Pure. */
export const upcomingLine = (title: string, prize: string, note: string) => `${title}: ${prize}, not open yet. ${note}`;
/**
 * v3 Stage 2 (spec 5.3 Route 2): the backing fund line, "Backing: 3 backers, $12 in fees. Your page: ..."; with none of
 * either yet, "Backing open. Your page: ...". Pure.
 */
export const backingLine = (backers: number, earned: number, page: string) =>
  backers === 0 && earned === 0 ? `Backing open. Your page: ${page}` : `Backing: ${backers} ${backers === 1 ? 'backer' : 'backers'}, $${earned.toLocaleString('en-US')} in fees. Your page: ${page}`;
/** v3 Stage 2 (spec 5.3): a fit whose deadline is this many days away (or fewer) is offered as a drafted application. */
export const APPLY_WINDOW_DAYS = 30;
/**
 * v3.1 (spec 3.2): the ranked reply's money, the top apply candidate. `when` as fundWhen gives it ("closes Nov 18" or
 * "rolling"); `amount`: its award ("$5,000"; null when unknown); `codes`: the Builder Codes sentence (Base Builder
 * Grants), else null; Task 16: the draft shows it, the reply doesn't (its check warms here for the draft).
 */
export type BestFit = { program_id: string; title: string; amount: string | null; when: string; why: string; codes: string | null };
/** Task 16: an award as the copy names it: "$5,000", "$500,000 investment"; null when unknown. Pure. */
export const awardAmount = (c: { max_award_usd?: number | null; investment?: boolean }) =>
  c.max_award_usd && c.max_award_usd > 0 ? `$${Math.round(c.max_award_usd).toLocaleString('en-US')}${c.investment ? ' investment' : ''}` : null;
/** ", up to $5,000" (nothing when the award is unknown). Pure. */
const upTo = (amount: string | null) => (amount ? `, up to ${amount}` : '');
/** Task 16: "You qualify for the Base Builder Grant Program, up to $5,000." (", closes Nov 18" when dated). Pure. */
export const qualifyLine = (f: { title: string; amount: string | null; when: string }) =>
  `You qualify for the ${f.title}${upTo(f.amount)}${f.when.startsWith('closes ') ? `, ${f.when}` : ''}.`;

/** Task 16: the signed-out reply's open grant ("Base pays up to $5,000 right now."): its organizer and award. */
export type OpenGrant = { org: string; amount: string };
/** Task 16: the connect offer: the weeks it posts and the points that yes adds (ledger rules: points.ts connectOfferPoints). */
export type ConnectOffer = { weeks: number; points: number };
/**
 * Task 16: the weekly moment (step 7): the week's number (the project's weeks shipping), where the builder stands
 * (`place`: 'still' or 'now' beside the rank, null under RANK_MIN_POOL: "on EarnKit"), last week's rank, and the points
 * the yes adds (points.ts weekPointsNow; fix round 1: null when it adds none, a week with no facts or already paid).
 */
export type MomentView = { week: number; place: 'still' | 'now' | null; rank: number; points: number | null };

/** Task 16, step 1: the signed-out reply's two lines. */
export const INTRO_LINE = 'EarnKit gets you paid for building.';
export const introWhat = (open: OpenGrant | null) =>
  `I read your commits every week, rank you against other builders, and find grants you qualify for.${open ? ` ${open.org} pays up to ${open.amount} right now.` : ''}`;
/** Task 16, step 2: "You're in, @maya.". */
export const youreIn = (handle: string) => `You're in, @${handle}.`;
/** Task 16: the step 2 action (the repo picker, or a named repo's install link). */
export const pickRepoAsk = (link: string) => `Step 2 of 2: pick the repo you're building. I only get read access (one click): ${link}\nDone?`;
export const POINTS_ON_SIGN_IN = `+${CONNECT_POINTS} points when you finish step 2`;
export const POINTS_ON_CONNECT = `+${CONNECT_POINTS} points when it's connected`;
/** Task 16, step 5: the shipping points line (`lead`: the weekly target without its period, else "Ship code this week"). */
export const shipPointsLine = (lead: string = 'Ship code this week') => `${lead}: up to +${MAX_WEEK_POINTS} points`;
/** v3 Stage 1 (spec 5.1), Task 16 step 3: the connect weeks' one question (ranked, once a person); the page is its link. */
export const connectAsk = (weeks: number, page: string) =>
  `Post your ${weeks === 1 ? 'week' : `${weeks} weeks`} to ${page} so grant teams can see ${weeks === 1 ? 'it' : 'them'}?`;
/**
 * v3 Stage 2, Task 16 step 5: the apply step's money and its one question; `when` is the deadline's day ("Nov 18"),
 * null for a rolling program. Pure.
 */
export const applyAsk = (title: string, amount: string | null, when: string | null) =>
  `${title} ${when ? `closes ${when}` : 'is still open'}${upTo(amount)}. I can draft it in a minute.\nWant me to?`;
/** Task 16: the ranked ship step's one question (a yes: one small thing to ship, SHIP_STEP_NOTE). */
export const SHIP_ASK = 'Want me to suggest one small thing to ship?';
/** Task 16, step 7: the weekly moment's question. */
export const MOMENT_ASK = 'Does last week look right?';
/**
 * Task 16, step 7: "Week 4 done. You're now #3: +70 points." ("Last week done." with no week counted yet; fix round 1:
 * no points clause when the yes adds none, "Week 4 done. You're now #3."). Pure.
 */
export const momentHead = (m: MomentView) =>
  `${m.week > 0 ? `Week ${m.week} done.` : 'Last week done.'} You're ${m.place ? `${m.place} #${m.rank.toLocaleString('en-US')}` : 'on EarnKit'}${m.points ? `: +${m.points} points` : ''}.`;
/** Task 16, step 7: the post for X, plain text to paste (never an intent link): "Week 4 shipping Kit. https://earnkit.com/maya". Pure. */
export const momentPost = (week: number, name: string, page: string) => `"${week > 0 ? `Week ${week} shipping ${name}.` : `Shipping ${name}.`} ${page}"`;
export const MOMENT_POST_HEAD = 'A post for X, ready to paste:';
/** "4 weeks in a row" (none: null). Pure. */
const streakWords = (n: number) => (n > 0 ? `${n} ${n === 1 ? 'week' : 'weeks'} in a row` : null);
/**
 * Task 16 step 5: the ranked standing line, "Kit · #1 of 13 builders · 4 weeks in a row" (no rank under RANK_MIN_POOL;
 * "· $340 earned" from $1). Nothing beside the name: "Kit is on EarnKit.". Pure.
 */
export function standingLine(name: string, rank: string | null, streak: number, earned = 0): string {
  const usd = Math.round(earned);
  const parts = [rank, streakWords(streak), usd > 0 ? `$${usd.toLocaleString('en-US')} earned` : null].filter((x): x is string => Boolean(x));
  return parts.length ? [name, ...parts].join(' · ') : `${name} is on EarnKit.`;
}
/** Task 16 step 3: "Kit is on the leaderboard: #1 of 13 builders, 4 weeks in a row." ("Kit is on EarnKit: 4 weeks in a row." under RANK_MIN_POOL). Pure. */
export function connectStanding(name: string, rank: string | null, streak: number): string {
  const rest = [rank, streakWords(streak)].filter((x): x is string => Boolean(x)).join(', ');
  return `${name} is on ${rank ? 'the leaderboard' : 'EarnKit'}${rest ? `: ${rest}` : ''}.`;
}
/** v2.13.1 O5 N5: one small thing to ship (app_off: the App can't count the project). */
export const shipAsk = (name: string) => `Want me to suggest one small thing to ship in ${name} this week?`;
/** v2.13.1 O2 fix round 1 (ruling 3): another person holds the repo, or it is a copy. */
export const OTHER_PROJECT_ASK = 'Want to use a different project?';
/** The key a no keeps an ask away under (standing_seen.declined, 30 days). Pure. */
export const benchStepKey = (kind: string, key: string | null) => `${kind}:${key ?? '*'}`;

/** R16a: the steps that need words of their own before the account has a page. */
export const STATE_COPY = {
  signed_out: {
    ask: (link: string) => `Step 1 of 2: sign in with X (one click): ${link}\nDone?`,
    /** Fix round 1: the link couldn't be made this time (never read as signed in). */
    retry: () => "I couldn't make your sign-in link just now. Want me to try again?",
  },
  no_project: {
    /** Launch ready L2: the repo picker's install link (GitHub's page picks the repos); never a GitHub URL asked for. */
    ask: (link: string) => pickRepoAsk(link),
    /** The App link can't be made (the App is off): their work is asked for instead. */
    noApp: () => "What's your GitHub, or a link to something you've made?",
  },
  not_counted: {
    stand: (name: string) => `${name} isn't counted yet.`,
    ask: (link: string) => pickRepoAsk(link),
  },
} as const;
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
  state: ReplyState; variant: Variant; project: BenchProject | null;
  /** The rank phrase (rank.ts shownRankLine: "#3 of 40 builders", "Top 4% of builders"; null under RANK_MIN_POOL), ranked only. */
  rank: string | null;
  /** Weeks shipped in a row (streak.ts streaksFor, the profile's own value). */
  streak: number;
  /** Launch ready L5: the weekly target (weekly-target.ts weeklyTarget), the ship step's points line lead (null: "Ship code this week"). */
  target: string | null;
  /** v3 Stage 2 (spec 5.2): Earned (earned.ts paid_usd: fees claimed plus announced prizes), on the ranked standing line from $1. */
  earned?: number;
  /** The person's page handle (null: signed out, or no page to name, as with X off). */
  handle: string | null;
  /** The state's action link: the sign-in link (signed_out), the repo picker (no_project) or the install link (not_counted, no variant). */
  link: string | null;
  fund: FundLine[]; due: string[]; ask: BenchAsk;
  /** A17: an outcome question or a submission step, asked instead of the state's step. */
  held: string | null;
  /** v3.1 (spec 3.2): the top apply candidate, the ranked reply's money line (null or absent: none). */
  best?: BestFit | null;
  /** Task 16 step 1: the open grant the signed-out reply names (null: the sentence is dropped). */
  open?: OpenGrant | null;
  /** Task 16 step 3: the connect offer (ask kind 'connect'). */
  connect?: ConnectOffer | null;
  /** Task 16 step 7: the weekly moment (ask kind 'share'). */
  moment?: MomentView | null;
};

/** v3 Stage 2: the program the apply step offers to draft for (its deadline's day, "Nov 18"; v3.1: null, rolling). */
export type ApplyPick = { program_id: string; title: string; amount: string | null; when: string | null };
/**
 * Each state's one next step (A16; signed out with no link: the retry). Ranked, in order: the connect weeks' question
 * (`connect`), the drafted application (`apply`; v3.1 spec 3.2: money to the builder first), the backing offer
 * (`backing`, its line given), the weekly moment's question once a week (L6, `share`), else the ship step. Pure.
 */
export function stateAsk(
  v: Pick<BenchView, 'state' | 'variant' | 'project' | 'link'> & { handle?: string | null; connect?: ConnectOffer | null; share?: boolean; backing?: string | null; apply?: ApplyPick | null },
): BenchAsk {
  const key = v.project?.key ?? null;
  const name = v.project?.name ?? '';
  if (v.state === 'signed_out') return { kind: 'sign_in', project_key: null, line: v.link ? STATE_COPY.signed_out.ask(v.link) : STATE_COPY.signed_out.retry() };
  if (v.state === 'no_project')
    return v.link ? { kind: 'pick_repo', project_key: null, line: STATE_COPY.no_project.ask(v.link) } : { kind: 'start', project_key: null, line: STATE_COPY.no_project.noApp() };
  // Fix round 1 ruling: the page is the connect reply's one https link.
  if (v.state === 'ranked' && v.connect && v.handle) return { kind: 'connect', project_key: key, line: connectAsk(v.connect.weeks, `https://${pageUrl(v.handle)}`) };
  if (v.state === 'ranked' && v.apply) return { kind: 'apply', project_key: key, program_id: v.apply.program_id, line: applyAsk(v.apply.title, v.apply.amount, v.apply.when) };
  if (v.state === 'ranked' && v.backing) return { kind: 'backing', project_key: key, line: v.backing };
  if (v.state === 'ranked') return v.share ? { kind: 'share', project_key: key, line: MOMENT_ASK } : { kind: 'ship', project_key: key, line: SHIP_ASK };
  if (v.variant === 'taken' || v.variant === 'copy') return { kind: 'other_project', project_key: key, line: VARIANT_COPY[v.variant].ask() };
  if (v.variant === 'no_repo') return { kind: 'repo_behind', project_key: key, line: VARIANT_COPY.no_repo.ask(name) };
  if (v.variant === 'app_off' || !v.link) return { kind: 'suggest', project_key: key, line: VARIANT_COPY.app_off.ask(name) };
  return { kind: 'install_app', project_key: key, line: STATE_COPY.not_counted.ask(v.link) };
}

/** The weekly target as the points line's lead ("Ship code this week to pass #3"), else the plain lead ("Done this week." too). Pure. */
const shipLead = (target: string | null) => (target?.startsWith('Ship code this week') ? target.replace(/\.$/, '') : undefined);
/**
 * Ranked: the money line: the Best fit, else the first fit, else the backing statement (its page the reply's one link:
 * a ranked reply carries no other), else the upcoming program.
 */
function moneyLine(v: BenchView): string | null {
  const fit = v.best ?? v.fund.find((f): f is Extract<FundLine, { kind: 'fits' }> => f.kind === 'fits');
  if (fit) return qualifyLine(fit);
  const b = v.fund.find((f): f is Extract<FundLine, { kind: 'backing' }> => f.kind === 'backing');
  if (b) return backingLine(b.backers, b.earned_usd, b.page);
  const u = v.fund.find((f): f is Extract<FundLine, { kind: 'upcoming' }> => f.kind === 'upcoming');
  return u ? upcomingLine(u.title, u.prize, u.note) : null;
}
/** Paragraphs, each its lines; empty ones dropped. */
const paras = (...ps: (string | null | undefined)[][]) =>
  ps.map((p) => p.filter((x): x is string => typeof x === 'string' && x.length > 0)).filter((p) => p.length > 0).map((p) => p.join('\n')).join('\n\n');

/** Task 16: the step 2 reply names the account ("You're in, @maya."), so no account line goes above it. Pure. */
export const namesAccount = (v: Pick<BenchView, 'state' | 'handle' | 'held' | 'ask'>) =>
  Boolean(v.handle) && (v.state === 'no_project' || (v.state === 'not_counted' && !v.held && v.ask.kind === 'install_app'));
/** Task 16: the reply, as the owner approved it, for each state and step. Pure. */
export function benchReply(v: BenchView): string {
  const name = v.project?.name ?? '';
  if (v.state === 'signed_out')
    return paras([INTRO_LINE, introWhat(v.open ?? null)], [v.ask.line, v.link ? POINTS_ON_SIGN_IN : null]);
  const ask = v.held ?? v.ask.line;
  const step2 = !v.held && (v.ask.kind === 'pick_repo' || v.ask.kind === 'install_app');
  const named = namesAccount(v);
  if (v.state === 'no_project') return paras([named ? youreIn(v.handle!) : null, ...v.due, ask, step2 ? POINTS_ON_CONNECT : null]);
  if (v.state === 'not_counted') {
    if (step2) return paras([named ? youreIn(v.handle!) : null, ...v.due, ask, POINTS_ON_CONNECT]);
    return paras([v.variant ? VARIANT_COPY[v.variant].stand(name) : STATE_COPY.not_counted.stand(name), ...v.due, ask]);
  }
  if (!v.held && v.ask.kind === 'connect' && v.connect)
    return paras(
      [connectStanding(name, v.rank, v.streak), v.best ? qualifyLine(v.best) : null, ...v.due],
      [ask, v.connect.points > 0 ? `+${v.connect.points} points` : null],
    );
  if (!v.held && v.ask.kind === 'share' && v.moment && v.handle)
    // Fix round 1 ruling: the post keeps the full page URL (the reply's one https link), so it is clickable when pasted.
    return paras([momentHead(v.moment), MOMENT_POST_HEAD, momentPost(v.moment.week, name, `https://${pageUrl(v.handle)}`), ask]);
  const standing = standingLine(name, v.rank, v.streak, v.earned ?? 0);
  if (!v.held && v.ask.kind === 'apply') return paras([standing, ...v.due, ask, shipPointsLine()]);
  const points = !v.held && v.ask.kind === 'ship' ? shipPointsLine(shipLead(v.target)) : null;
  return paras([standing, ...v.due, moneyLine(v), ask, points]);
}

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
