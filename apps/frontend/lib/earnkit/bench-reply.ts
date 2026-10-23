import { pageUrl } from './reserved-routes';
import { MAX_WEEK_POINTS } from './points';

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
/** v3.1 one-tap posts: `post`, an event's drafted post (went live, won before apply for 48 hours; else in the share slot). */
/** v3 Stage 1: `connect`, the backfilled weeks' one yes after the App connects a repo (ranked, once a person). */
/** v3 Stage 2: `apply`, the drafted application for a fit closing within APPLY_WINDOW_DAYS, v3.1 else a rolling fit (ranked, once a program). */
/** v3 Stage 2: `backing`, the backing offer after the first approved week with code (ranked, once a project, EARNKIT_RAISING on). */
/** 2026-10-22: `titles`, a private repo's titles question (ranked, once a person); `qualify`, Base's grant steps for a ranked builder with no fit. */
/** v3.1 one-tap posts: `post`, an event's drafted post for X (a yes redrafts it). */
/** v3.1 wallet proof: `wallet`, the optional signed wallet step after setup (once a person), or the change link (tell wallet). */
/**
 * 2026-10-23 Base onboarding: `base_start`, the one walk-through offer after the GitHub no; `next_step`, the no-project
 * reply once every onboarding question was asked; `new_repo`, the one nudge for a main project quiet for STALE_WEEKS.
 */
export type BenchAskKind = 'sign_in' | 'start' | 'pick_repo' | 'install_app' | 'other_project' | 'repo_behind' | 'ship' | 'suggest' | 'share' | 'connect' | 'backing' | 'apply' | 'titles' | 'qualify' | 'post' | 'wallet'
  | 'base_start' | 'next_step' | 'new_repo'
  /** GTM W2 (2026-10-23): `base_help`, the walk-through's step 1 help; `checkin`, the Monday check-in (once, clients that schedule); `none`, no question. */
  | 'base_help' | 'checkin' | 'none'
  /** v3.1 cold read: `coin_publish`, the coin ask's publish-first question; `backers_post`, the backers answer's post question. */
  | 'coin_publish' | 'backers_post'
  /** v3.1 cold read round 2: `coin_wallet`, a coin yes waiting for its fee wallet (asked again, never the wallet step). */
  | 'coin_wallet';
/** `program_id`: the program an `apply` ask is about (its no is kept under it, never the project). */
export type BenchAsk = { kind: BenchAskKind; project_key: string | null; line: string; program_id?: string };
export type FundLine =
  /** R12: a program that fits: its award ("$5,000", null unknown), its deadline ("closes Oct 30" or "rolling"). */
  | { kind: 'fits'; title: string; amount: string | null; when: string; bar?: FitBar }
  /** v3 Stage 2: one program not open yet, for a ranked builder on a 4-week streak: a statement, no link. */
  | { kind: 'upcoming'; title: string; prize: string; note: string }
  /** v3 Stage 2: backing is open on the one project (EARNKIT_RAISING on): its backers and fees earned, and the page. A statement, never a step. */
  | { kind: 'backing'; backers: number; earned_usd: number; page: string; news?: number };
export type BenchProject = { key: string; name: string; confirmed: boolean; live: boolean; weeks: number };

/** v3 Stage 2: "Base Batches 005: up to $100K, not open yet. <note>" (a statement, never a link or a question). Pure. */
export const upcomingLine = (title: string, prize: string, note: string) => `${title}: ${prize}, not open yet. ${note}`;
/**
 * v3 Stage 2 (spec 5.3 Route 2): the backing fund line, "Backing: 3 backers, $12 in fees. Your page: ..."; with none of
 * either yet, "Backing open. Your page: ...". Pure.
 */
export const backingLine = (backers: number, earned: number, page: string) =>
  backers === 0 && earned === 0 ? `Backing open. Your page: ${page}` : `Backing: ${backers} ${backers === 1 ? 'backer' : 'backers'}, $${earned.toLocaleString('en-US')} in fees. Your page: ${page}`;
/** v3.1 cold read: the backing line after launch, only when backers changed since last shown ("2 new backers since you last looked."). Pure. */
export const newBackersLine = (n: number) => `${n.toLocaleString('en-US')} new ${n === 1 ? 'backer' : 'backers'} since you last looked.`;
/** v3 Stage 2 (spec 5.3): a fit whose deadline is this many days away (or fewer) is offered as a drafted application. */
export const APPLY_WINDOW_DAYS = 30;
/**
 * v3.1 (spec 3.2): the ranked reply's money, the top apply candidate. `when` as fundWhen gives it ("closes Nov 18" or
 * "rolling"); `amount`: its award ("$5,000"; null when unknown); `codes`: the Builder Codes sentence (Base Builder
 * Grants), else null; Task 16: the draft shows it, the reply doesn't (its check warms here for the draft).
 */
export type BestFit = { program_id: string; title: string; amount: string | null; when: string; why: string; codes: string | null; bar?: FitBar };
/**
 * v3.1 GTM W3: what stands between the builder and a program, from the program's own facts (never invented):
 * 'qualify', nothing the builder doesn't show; 'company', an investment (match.ts INVESTMENT_NOTE: a company with a
 * full-time team); 'long_shot', the program's "long shot" tag; 'needs_live', tagged "needs a live product" while the
 * app shows no live link; 'needs_users', the matcher's "no users yet". Only 'qualify' may say "You qualify".
 */
export type FitBar = 'qualify' | 'company' | 'long_shot' | 'needs_live' | 'needs_users';
/** v3.1 GTM W3: the bar for a program and the project's facts (`live`: a live link; `noUsers`: the matcher said no users yet). Pure. */
export const fitBar = (c: { investment?: boolean | null; tag?: string | null }, f: { live: boolean; noUsers?: boolean }): FitBar =>
  c.investment ? 'company' : c.tag === 'long shot' ? 'long_shot' : c.tag === 'needs a live product' && !f.live ? 'needs_live' : f.noUsers ? 'needs_users' : 'qualify';
/** Task 16: an award as the copy names it: "$5,000", "$500,000 investment"; null when unknown. Pure. */
export const awardAmount = (c: { max_award_usd?: number | null; investment?: boolean }) =>
  c.max_award_usd && c.max_award_usd > 0 ? `$${Math.round(c.max_award_usd).toLocaleString('en-US')}${c.investment ? ' investment' : ''}` : null;
/** ", up to $5,000" (nothing when the award is unknown). Pure. */
const upTo = (amount: string | null) => (amount ? `, up to ${amount}` : '');
/**
 * Task 16: "You qualify for the Base Builder Grant Program, up to $5,000." (", closes Nov 18" when dated). v3.1 GTM W3:
 * only with nothing in the way (`bar` 'qualify', the default); otherwise the program's own condition, never a claim:
 * "Long shot: a16z speedrun SR008, up to $1,000,000 investment, closes Nov 1. It takes a company with a full-time team." Pure.
 */
export const qualifyLine = (f: { title: string; amount: string | null; when: string; bar?: FitBar }) => {
  const facts = `${f.title}${upTo(f.amount)}${f.when.startsWith('closes ') ? `, ${f.when}` : ''}`;
  switch (f.bar ?? 'qualify') {
    case 'company': return `Long shot: ${facts}. It takes a company with a full-time team.`;
    case 'long_shot': return `Long shot: ${facts}.`;
    case 'needs_live': return `${facts}, once your app is live.`;
    case 'needs_users': return `${facts}, once you have real users.`;
    default: return `You qualify for the ${facts}.`;
  }
};

/**
 * Task 16: the signed-out reply's open grant ("Base pays up to $5,000 for apps on Base."): its organizer, its award and,
 * for a one-chain program, that chain's name (null: any chain, "for apps").
 */
export type OpenGrant = { org: string; amount: string; chain: string | null; name?: string };
/**
 * v3.1 cold read (owner-approved): the program as a builder names it, from its title: "Base Builder Grant Program" is
 * "Base Builder Grants"; "Circle Developer Grants" stays. Pure.
 */
export const grantProgramName = (title: string) => title.trim().replace(/\s+Grant Program$/i, ' Grants').replace(/\s+Program$/i, '');
/**
 * v3.1 cold read: "Base Builder Grants pay up to $5,000 for apps on Base." (the program's own facts; "for apps." on any
 * chain; the organizer when the program's name is unknown). Pure.
 */
export const grantHook = (g: OpenGrant) => {
  const who = g.name ?? g.org;
  return `${who} ${/s$/i.test(who) ? 'pay' : 'pays'} up to ${g.amount} for apps${g.chain ? ` on ${g.chain}` : ''}.`;
};
/** Task 16: the connect offer: the weeks it posts and the points that yes adds (ledger rules: points.ts connectOfferPoints). */
export type ConnectOffer = { weeks: number; points: number };
/**
 * Task 16: the weekly moment (step 7): the week's number (the project's weeks shipping), where the builder stands
 * (`place`: 'still' or 'now' beside the rank, null under RANK_MIN_POOL: "on EarnKit"), last week's rank, and the points
 * the yes adds (points.ts weekPointsNow; fix round 1: null when it adds none, a week with no facts or already paid).
 */
export type MomentView = {
  week: number; place: 'still' | 'now' | null; rank: number;
  /** Owner batch fix wave: last week's stored summary, shown as one quoted line under the head; a yes binds to it. */
  summary?: string | null;
  /** v3.1 one-tap posts (design 6): last week's drafted post, else null (the reply gives the page). */
  post: PostOffer | null;
};
/** v3.1 one-tap posts: a drafted post: its exact text and the short link that opens X's composer with it. */
export type PostOffer = { text: string; link: string };
/** v3.1 one-tap posts: an event's post (went live, won, accepted, funded, the builder's news, the coin): its head line too. */
export type EventPost = PostOffer & { head: string };

/** Task 16, step 1: the signed-out reply's two lines. */
export const INTRO_LINE = 'EarnKit gets you paid for building.';
export const introWhat = (open: OpenGrant | null) =>
  `I read your commits every week, rank you against other builders, and find grants you qualify for.${open ? ` ${grantHook(open)}` : ''}`;
/** Task 16, step 2; v3.1 cold read: said once, on the first reply after sign-in (standing_seen.welcomed). */
export const youreIn = (handle: string) => `You're in, @${handle}. I find grants your app qualifies for and write the applications.`;
/**
 * 2026-10-22: step 2's hint for a builder whose app has no GitHub yet. Only Lovable and Bolt are confirmed
 * (v3.1-install-research.md); a statement, so the reply keeps exactly one question.
 */
export const NO_GITHUB_HINT = 'Built it in Lovable or Bolt: connect GitHub there first (Lovable: Project settings, Git. Bolt: GitHub icon, top right).';
/** v3.1 cold read: the connect step's first words (never "Step 2 of 2"). */
export const CONNECT_LEAD = "Connect your app's code on GitHub so I can match it";
/** Task 16, v3.1 cold read (owner-approved): the connect action (the repo picker, or a named repo's install link). */
export const pickRepoAsk = (link: string) => `${CONNECT_LEAD} (read-only, one click): ${link}\n${NO_GITHUB_HINT}\nDone?`;
/** v3.1 cold read: the tool a live link was built with, from its host (only Lovable and Bolt are confirmed). Pure. */
export const builtWith = (url: string | null | undefined): 'lovable' | 'bolt' | null => {
  const host = url && URL.canParse(url) ? new URL(url).hostname.toLowerCase() : '';
  if (/(^|\.)lovable\.(app|dev)$/.test(host)) return 'lovable';
  if (/(^|\.)bolt\.(new|host)$/.test(host)) return 'bolt';
  return null;
};
/**
 * v3.1 cold read (owner-approved): a live app with no GitHub (the builder said no to the connect step): how its tool
 * puts the code on GitHub, then the connect link (never "Want to start building on Base?"). Pure.
 */
export function liveNoGithub(tool: 'lovable' | 'bolt' | null, name: string, link: string): string {
  const how =
    tool === 'lovable'
      ? `Lovable puts ${name}'s code on GitHub in two clicks: Project settings, then Git, then GitHub.`
      : tool === 'bolt'
        ? `Bolt puts ${name}'s code on GitHub from the GitHub icon, top right.`
        : 'Lovable or Bolt put your code on GitHub in two clicks (Lovable: Project settings, Git. Bolt: GitHub icon, top right).';
  return `${how} Then connect it here: ${link}\nDone?`;
}
/** GTM W2: the ship question is asked at most once in this many days per builder. */
export const SHIP_ASK_DAYS = 7;
/** GTM W2: the install ask for one more repo once setup is done (its own install link). Pure. */
export const installMoreAsk = (link: string) => `Install the read-only EarnKit app on it too (one click): ${link}\nDone?`;
/** The step 2 reply (the repo picker, or the first repo's install link), never the one-more-repo install. Pure. */
const isStep2 = (a: BenchAsk) => (a.kind === 'pick_repo' && a.line.startsWith(CONNECT_LEAD)) || (a.kind === 'install_app' && a.line.startsWith(CONNECT_LEAD));
/** Task 16, step 5: the shipping points line (`lead`: the weekly target without its period, else "Ship code this week"). */
export const shipPointsLine = (lead: string = 'Ship code this week') => `${lead}: up to +${MAX_WEEK_POINTS} points`;
/** v3 Stage 1 (spec 5.1), v3.1 cold read: the connect weeks' one question (ranked, once a person); the page is its link (no count). */
export const connectAsk = (page: string) => `Make your shipping log public on ${page} so grant teams can see it?`;
/**
 * v3 Stage 2, Task 16 step 5: the apply step's money and its one question; `when` is the deadline's day ("Nov 18"),
 * null for a rolling program. Pure.
 */
export const applyAsk = (title: string, amount: string | null, when: string | null) =>
  `${title} ${when ? `closes ${when}` : 'is still open'}${upTo(amount)}. I can draft it in a minute.\nWant me to?`;
/** Task 16: the ranked ship step's one question (a yes: one small thing to ship, SHIP_STEP_NOTE). */
export const SHIP_ASK = 'Want me to suggest one small thing to ship?';
/**
 * v3.1 wallet proof (owner-approved 2026-10-23): the optional step right after setup, offered once a person. Its one
 * question takes "done" (a yes: the proof is checked) or "skip" (a no: remembered, never asked again). Pure.
 */
export const WALLET_ASK = 'Done?';
/** v3.1 cold read: only for a builder with contracts on Base known or reported (wallet-offer.ts walletOfferDue). */
export const walletOffer = (link: string) =>
  `Prove your Base wallet so your contracts show on your page. One signature, no fee: ${link}\n${WALLET_ASK}`;
/** Only when true: the Base Builder Code stays on the first wallet; a launched coin's fees stay with its launch wallet. */
export const WALLET_BUILDER_CODE = 'Your Base Builder Code stays on your first wallet.';
export const WALLET_COIN_FEES = "Your coin's fees keep going to the wallet it launched with.";
/** The builder asked to add their reward wallet (none yet): a fresh signing link, the statements, one question. Pure. */
export const walletChange = (link: string, extras: string[] = []) =>
  [`Sign with the wallet you want your rewards sent to. One signature, no fee: ${link}`, ...extras, 'Done?'].join('\n');
/** The builder asked to change their reward wallet: the current one (short), the X step, the statements, one question. Pure. */
export const walletChangeX = (current: string, link: string, extras: string[] = []) =>
  [`Your rewards go to ${current}. To change that, sign in with X and sign with the new wallet (one signature, no fee): ${link}`, ...extras, 'Done?'].join('\n');
/** "Done" before the signature arrived: a fresh link (the last one may have expired) and the same question. Pure. */
export const walletNotYet = (link: string) => `I don't see a signature yet. Here's a fresh link (one signature, no fee): ${link}\nDone?`;
/** Done: the wallet is the reward recipient (short). Pure. */
export const walletDone = (wallet: string) => `Done. Your rewards now go to ${wallet}. Your contracts on Base will show on your page soon.`;
/** Done for contracts only: no X sign-in, so the rewards stay with the current wallet (short). Pure. */
export const walletContractsOnly = (current: string) =>
  `Done. That wallet counts for your contracts. Your rewards still go to ${current} until you sign in with X on the wallet page.`;
/** The one-line notice on the next reply after the reward wallet changed. Pure. */
export const walletNotice = (wallet: string) => `Your reward wallet changed to ${wallet}.`;
export const WALLET_SKIPPED = 'Skipped. Ask me anytime to add your reward wallet.';
/** 2026-10-22: a private repo with titles off, asked once (a yes: updates.ts setShipTitles on). */
export const TITLES_ASK = 'Show what you shipped (commit titles) on your page so grant teams see real progress? Your code stays private.';

/**
 * 2026-10-22: Base Builder Grants' steps, only from its program file's rules ("for builders exclusively building on
 * Base", "the first step to be eligible is to integrate Builder Codes", "a live product that's getting used").
 */
export type QualifyStep = 'base' | 'codes' | 'use';
export const QUALIFY_STEPS: readonly QualifyStep[] = ['base', 'codes', 'use'];
/**
 * 2026-10-22: the no-fit reply's path to Base's grant: its hook (grantHook), the steps the matcher and the Builder
 * Codes check show missing (`missing`, named) and the steps to take (`steps`: missing or unknown, never one known met).
 */
export type QualifyOffer = { program_id: string; grant: OpenGrant; missing: QualifyStep[]; steps: QualifyStep[] };
/** Builder Codes' guide (Base's docs), the one link of the steps reply. */
export const BUILDER_CODES_GUIDE = 'docs.base.org/base-chain/builder-codes/builder-codes';
const NEEDS: Record<QualifyStep, string> = { base: 'put the app on Base', codes: 'add Builder Codes', use: 'get people using it' };
/** "a, b and c". Pure. */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/**
 * "To qualify, Kit still needs to add Builder Codes and get people using it.": only when every remaining step is known
 * missing, so the line names exactly the steps the question counts; null otherwise (fix round 1: never one named thing
 * beside "the 3 steps"). Pure.
 */
export const qualifyMissing = (name: string, q: Pick<QualifyOffer, 'missing' | 'steps'>) =>
  q.steps.length > 0 && q.steps.every((s) => q.missing.includes(s))
    ? `To qualify, ${name} still needs to ${andList(QUALIFY_STEPS.filter((s) => q.steps.includes(s)).map((s) => NEEDS[s]))}.`
    : null;
/** "Base's $5,000 grant". Pure. */
const grantName = (g: OpenGrant) => `${g.org}'s ${g.amount} grant`;
/** The no-fit reply's one question: all three steps "to qualify", fewer "toward" (never a claim the rest is met). Pure. */
export const qualifyAsk = (g: OpenGrant, n: number) =>
  n >= QUALIFY_STEPS.length ? `Want the ${n} steps to qualify for ${grantName(g)}?` : `Want the ${n === 1 ? 'next step' : `${n} steps`} toward ${grantName(g)}?`;
const STEP_LINE: Record<QualifyStep, string> = {
  base: 'Put your app on Base.',
  codes: `Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic: https://${BUILDER_CODES_GUIDE}`,
  use: 'Have a live product people use.',
};
/** The steps reply's one question: help with the first step listed (always "step 1"). */
export const QUALIFY_HELP_ASK = 'Want help with step 1 now?';
/** Cold read: one step left has no "step 1" to point at. */
export const QUALIFY_HELP_ASK_ONE = 'Want help with it now?';
/** The yes to qualifyAsk: the remaining steps as plain lines, what EarnKit does next, one question. Pure. */
export function qualifySteps(g: OpenGrant, steps: QualifyStep[]): string {
  const todo = QUALIFY_STEPS.filter((s) => steps.includes(s));
  const head = todo.length >= QUALIFY_STEPS.length ? `${todo.length} steps to qualify for ${grantName(g)}:` : `${todo.length === 1 ? 'Your next step' : `Your next ${todo.length} steps`} toward ${grantName(g)}:`;
  return [head, ...todo.map((s, i) => `${i + 1}. ${STEP_LINE[s]}`), '', todo.length === 1 ? QUALIFY_HELP_ASK_ONE : QUALIFY_HELP_ASK].join('\n');
}
/**
 * 2026-10-23 Base onboarding (owner-approved): a builder who said no to step 2 (no GitHub, or not connecting now) is
 * asked once to start building on Base; its yes is these steps, only from v3.1-install-research.md (Lovable and Bolt,
 * confirmed) and the Base program file (Base, Builder Codes first); the Builder Codes guide is the one link. EarnKit
 * guides; it never builds for them (v3.1 spec 3.4).
 */
export const BASE_START_ASK = "Want to start building on Base? I'll walk you through it.";
/** v3.1 cold read (owner-approved): the walk-through's one question; a yes is the agent's Lovable prompt (never the block again). */
export const LOVABLE_PROMPT_ASK = 'Want me to write your Lovable prompt?';
/** v3.1 cold read (owner-approved): the path to Base's grant for a builder with only an idea. Pure. */
export const baseStartSteps = (g: OpenGrant) =>
  [
    `Here's the path to ${grantName(g)}:`,
    '1. Build your app in Lovable or Bolt. Describe the idea and they write the code.',
    '2. Connect it to GitHub inside Lovable or Bolt.',
    "3. Connect GitHub here and I'll tell you what's left.",
    LOVABLE_PROMPT_ASK,
  ].join('\n');
/** v3.1 cold read round 2: after the Lovable prompt was written, the no-project reply's one step (the connect link). Pure. */
export const nextBuild = (link: string) => `Next: build your app in Lovable or Bolt, then connect GitHub here: ${link}\nDone?`;
/** v3.1 cold read round 2: a coin yes waiting for its fee wallet (coin-moments.ts COIN_WALLET_ASK's words). */
export const COIN_WALLET_REASK = 'Send me the wallet the fees should go to.';
/** The no-project reply once the onboarding questions were asked: one question (a yes gives step 2's link again). */
export const NEXT_STEP_ASK = "Is your app's code on GitHub yet?";
/** GTM W2: a no to the resting question or the walk-through (never "Okay." on the no-GitHub path). */
export const NEXT_STEP_LATER = "No rush. Once your app's code is on GitHub, tell me and I'll send the one-click link.";
/** GTM W2: the Monday check-in, asked once on a client that can schedule (its yes: the agent sets its own weekly routine). */
export const CHECKIN_ASK = 'Want me to check in here every Monday?';
export const CHECKIN_ON = "Done. I'll check in every Monday with your week and any new money.";
/**
 * The next reply after the repo picker refused only forks or templates (github-app.ts pickSetup): the way out in one
 * line, a statement so the reply keeps its one question.
 */
export const TEMPLATE_NOTICE = 'If you made your app from a template, make a copy in your own account, then connect that.';
/** A main project with no commits in this many weeks (this one included) gets the one new-repo nudge. */
export const STALE_WEEKS = 8;
export const NEW_REPO_ASK = 'Working on something new? Connect that repo instead.';

/** Task 16, step 7: the weekly moment's question. */
export const MOMENT_ASK = 'Look right?';
/**
 * Task 16, step 7; v3.1 cold read (owner-approved): "Week 4 done:" ("Last week done:" with no week counted yet), then
 * the summary. v3.1 one-tap posts (owner ruling 5): no points in post replies. Pure.
 */
export const momentHead = (m: Pick<MomentView, 'week'>) => (m.week > 0 ? `Week ${m.week} done:` : 'Last week done:');
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
/** v3.1 one-tap posts (design 6): the post block: what it is, the post in quotes, the one-tap link (the reply's one link). Pure. */
export const POST_HEAD = 'Your post for X:';
export const postLines = (p: PostOffer) => [POST_HEAD, `"${p.text}"`, `Post it in one tap: ${p.link}`];
/** The event reply's question (a yes redrafts with the next shape). */
export const POST_ASK = 'Want a different version?';
/** Fix round: the builder's news is their own words (it can't be redrafted): a yes asks for new words. */
export const NEWS_ASK = 'Want to change any words?';
/** The Monday moment with no post to offer: the page is the reply's one link. Pure. */
export const pageLine = (page: string) => `Your page: ${page}`;
/** Owner ruling 3: an accepted, funded or won outcome told without its proof link. */
export const PROOF_ASK = "Send me a public link that shows it, like the program's post.";
/** Final review 1: an outcome told for a program that lists no proof hosts or X accounts (no link could prove it). */
export const OUTCOME_NOTED = 'Congrats. Saved.';
/** The event reply: its head, the post block and `ask`, one block. Pure. */
export const postReply = (e: EventPost, ask: string) => [e.head, ...postLines(e), ask].filter(Boolean).join('\n');
const theProgram = (p: string) => (/^the\s/i.test(p) ? p : `the ${p}`);
/**
 * The event reply's head (design 6): "Tally went live this week." (else "Tally is live." when it went live over 7
 * days ago, so the line stays true), "Ledgerline won the Base Builder Grant.", the coin's "Backing is open on your
 * page.", accepted or funded an empty head (the reply starts at "Your post for X, with your page card:"), else "Added to your page."
 * (the builder's news, on the page as their update). Pure.
 */
export function eventHead(c: { moment: string; input: object; card?: Record<string, unknown> }, now: Date = new Date()): string {
  const i = c.input as { name?: string | null; program?: string };
  const name = i.name ?? null;
  if (c.moment === 'went_live' && name) {
    const at = typeof c.card?.live_at === 'string' ? Date.parse(c.card.live_at) : NaN;
    return now.getTime() - at <= 7 * 86_400_000 ? `${name} went live this week.` : `${name} is live.`;
  }
  if (c.moment === 'won' && name && i.program) return `${name} won ${theProgram(i.program)}.`;
  if (c.moment === 'coin_intro') return 'Backing is open on your page.';
  // Fix round: the profile doesn't show an acceptance or funding, so never "Added to your page." for them.
  if (c.moment === 'accepted' || c.moment === 'funded') return '';
  return 'Added to your page.';
}
/**
 * The yes to "Want a different version?" when no new one can be written: the limit for today or no other wording. The
 * post they have stays; its link is the reply's one link. Pure.
 */
export function redraftLine(why: 'limit' | 'only', link: string): string {
  if (why === 'only') return `That's the only version I can write for this one. Post it in one tap: ${link}`;
  return `That's the last new version for today. The one you have still works: ${link}`;
}

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
    /** v3.1 cold read: never "<Project> isn't counted yet." (it meant nothing to a builder). */
    stand: (_name: string): string | null => null,
    ask: (link: string) => pickRepoAsk(link),
  },
} as const;
/** A15: not counted, when the install link can't help. */
export const VARIANT_COPY = {
  taken: { stand: (n: string) => `${n} is already on the leaderboard under another account.`, ask: () => OTHER_PROJECT_ASK },
  // 2026-10-22: the template way out as a statement (the reply's one question is the ask).
  copy: { stand: (n: string) => `${n} is a copy of someone else's project. If you made it from a template, make a copy in your own account, then connect that.`, ask: () => OTHER_PROJECT_ASK },
  no_repo: { stand: (_n: string): string | null => null, ask: (n: string) => `Where does ${n} live on GitHub?` },
  app_off: { stand: (_n: string): string | null => null, ask: (n: string) => shipAsk(n) },
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
  /** 2026-10-22: Base's grant steps (ask kind 'qualify'). */
  qualify?: QualifyOffer | null;
  /** v3.1 one-tap posts: an event's drafted post (ask kind 'post'). */
  post?: EventPost | null;
  /** 2026-10-23: a one-line statement said once (TEMPLATE_NOTICE), under the account line, else above the reply. */
  notice?: string | null;
  /** v3.1 cold read: "You're in, @maya." is this reply's (the first after sign-in only, standing_seen.welcomed). */
  welcome?: boolean;
  /** v3.1 cold read: the ranked standing line is shown (it changed since last seen); absent: shown. */
  standingShown?: boolean;
  /** v3.1 cold read: the shipping points line is shown (at most once an ISO week); absent: shown. */
  nagShown?: boolean;
  /** v3.1 cold read: a live link with no GitHub (the builder said no once): its tool's GitHub steps (liveNoGithub). */
  liveTool?: { tool: 'lovable' | 'bolt' | null } | null;
};

/** v3 Stage 2: the program the apply step offers to draft for (its deadline's day, "Nov 18"; v3.1: null, rolling). */
export type ApplyPick = { program_id: string; title: string; amount: string | null; when: string | null };
/**
 * Each state's one next step (A16; signed out with no link: the retry). Ranked, in order: the connect weeks' question
 * (`connect`), the drafted application (`apply`; v3.1 spec 3.2: money to the builder first), the backing offer
 * (`backing`, its line given), the weekly moment's question once a week (L6, `share`), the optional wallet step once
 * (`wallet`, v3.1 wallet proof), a private repo's titles
 * question once (`titles`), Base's grant steps with no fit (`qualify`), else the ship step. Pure.
 */
export function stateAsk(
  v: Pick<BenchView, 'state' | 'variant' | 'project' | 'link'> & {
    handle?: string | null; connect?: ConnectOffer | null; share?: boolean; backing?: string | null; apply?: ApplyPick | null;
    titles?: boolean; qualify?: QualifyOffer | null;
    /** v3.1 wallet proof: the signing link of the optional wallet step (wallet-offer.ts walletOfferLink), null: not offered. */
    wallet?: string | null;
    /** v3.1 one-tap posts: an event's drafted post (benchView offers it only where it goes: hot before apply, else in the share slot). */
    post?: EventPost | null;
    /** 2026-10-23 Base onboarding: the builder said no to step 2 (standing_seen.github_no): step 2 is never repeated. */
    githubNo?: boolean;
    /** The Base walk-through offer is due (after the GitHub no, once). */
    baseAsk?: boolean;
    /** The ranked main project had no commits in STALE_WEEKS (asked once). */
    newRepo?: boolean;
    /** GTM W2: the Monday check-in is due (once, a client that can schedule, after setup). */
    checkin?: boolean;
    /** GTM W2: the ship question was asked within SHIP_ASK_DAYS (the quiet reply then asks nothing). */
    shipAsked?: boolean;
    /** GTM W2: the builder already connected a repo with the App (setup is done): never "Step 2 of 2" again. */
    appDone?: boolean;
    /** v3.1 cold read: a live link with no GitHub after one no: its tool's GitHub steps with the connect link. */
    liveTool?: { tool: 'lovable' | 'bolt' | null } | null;
    /** v3.1 cold read round 2: the Base walk-through was taken: 'help' (the Lovable prompt not written yet), 'built' (written). */
    walk?: 'help' | 'built' | null;
    /** v3.1 cold read round 2: a coin yes is waiting for its fee wallet. */
    coinWallet?: boolean;
  },
): BenchAsk {
  const key = v.project?.key ?? null;
  const name = v.project?.name ?? '';
  if (v.state === 'signed_out') return { kind: 'sign_in', project_key: null, line: v.link ? STATE_COPY.signed_out.ask(v.link) : STATE_COPY.signed_out.retry() };
  // GTM W2 (2026-10-23): a project named only by its live link (no repo: Lovable, Bolt) is on the no-GitHub path too.
  const noCode = v.state === 'no_project' || (v.state === 'not_counted' && v.variant === 'no_repo');
  // 2026-10-23 Base onboarding: after the GitHub no, the Base walk-through once, then the optional wallet step once, then
  // the resting question; step 2 never again (until the builder asks: bench-find.ts benchMoveUp).
  if (noCode && v.githubNo) {
    if (v.baseAsk) return { kind: 'base_start', project_key: null, line: BASE_START_ASK };
    // v3.1 cold read round 2: after the walk-through, its question stands until the Lovable prompt is written; then the
    // next step is building it and connecting GitHub (never "Is your app's code on GitHub yet?" again).
    if (v.walk === 'help') return { kind: 'base_help', project_key: null, line: LOVABLE_PROMPT_ASK };
    if (v.walk === 'built' && v.link) return { kind: 'pick_repo', project_key: null, line: nextBuild(v.link) };
    if (v.wallet) return { kind: 'wallet', project_key: null, line: walletOffer(v.wallet) };
    return { kind: 'next_step', project_key: null, line: NEXT_STEP_ASK };
  }
  if (v.state === 'no_project')
    return v.link ? { kind: 'pick_repo', project_key: null, line: STATE_COPY.no_project.ask(v.link) } : { kind: 'start', project_key: null, line: STATE_COPY.no_project.noApp() };
  // v3.1 cold read: a live app (Lovable, Bolt) whose builder said no to GitHub once: how its tool puts the code on GitHub.
  if (noCode && v.link && v.liveTool) return { kind: 'pick_repo', project_key: null, line: liveNoGithub(v.liveTool.tool, name, v.link) };
  // GTM W2: a live link with no repo: step 2's repo picker (its no starts the Base walk-through), never "Where does it live?".
  if (noCode && v.link) return { kind: 'pick_repo', project_key: null, line: STATE_COPY.no_project.ask(v.link) };
  // Fix round 1 ruling: the page is the connect reply's one https link.
  if (v.state === 'ranked' && v.connect && v.handle) return { kind: 'connect', project_key: key, line: connectAsk(`https://${pageUrl(v.handle)}`) };
  // GTM W2 (owner: no coin launched is the biggest revenue failure): the backing offer comes in the first reply after the
  // builder is proven with an approved code week, right after connect, above the event post and the apply step.
  if (v.state === 'ranked' && v.backing) return { kind: 'backing', project_key: key, line: v.backing };
  // v3.1 cold read round 2: a coin yes waiting for its fee wallet is asked again (never the wallet-proof step meanwhile).
  if (v.state === 'ranked' && v.coinWallet) return { kind: 'coin_wallet', project_key: key, line: COIN_WALLET_REASK };
  // v3.1 one-tap posts: an event's post (went live and won jump ahead of apply for 48 hours; benchView holds the rest
  // until the share slot).
  if (v.state === 'ranked' && v.post) return { kind: 'post', project_key: key, line: POST_ASK };
  if (v.state === 'ranked' && v.apply) return { kind: 'apply', project_key: key, program_id: v.apply.program_id, line: applyAsk(v.apply.title, v.apply.amount, v.apply.when) };
  if (v.state === 'ranked' && v.share) return { kind: 'share', project_key: key, line: MOMENT_ASK };
  // GTM W2: the Monday check-in, once, on a client that can schedule (before the optional wallet step).
  if (v.state === 'ranked' && v.checkin) return { kind: 'checkin', project_key: key, line: CHECKIN_ASK };
  // v3.1 wallet proof: the optional wallet step, once, in the first reply after setup with no other question.
  if (v.state === 'ranked' && v.wallet) return { kind: 'wallet', project_key: key, line: walletOffer(v.wallet) };
  // 2026-10-23: a main project quiet for STALE_WEEKS: one light nudge to connect the new one.
  if (v.state === 'ranked' && v.newRepo) return { kind: 'new_repo', project_key: key, line: NEW_REPO_ASK };
  // 2026-10-22: a private repo's titles question (once), then Base's grant steps for a builder with no fit, else the ship step.
  if (v.state === 'ranked' && v.titles) return { kind: 'titles', project_key: key, line: TITLES_ASK };
  if (v.state === 'ranked' && v.qualify)
    return { kind: 'qualify', project_key: key, program_id: v.qualify.program_id, line: qualifyAsk(v.qualify.grant, v.qualify.steps.length) };
  // GTM W2: the ship question at most once in SHIP_ASK_DAYS; between, the quiet reply asks nothing.
  if (v.state === 'ranked') return v.shipAsked ? { kind: 'none', project_key: key, line: '' } : { kind: 'ship', project_key: key, line: SHIP_ASK };
  if (v.variant === 'taken' || v.variant === 'copy') return { kind: 'other_project', project_key: key, line: VARIANT_COPY[v.variant].ask() };
  if (v.variant === 'no_repo') return { kind: 'repo_behind', project_key: key, line: VARIANT_COPY.no_repo.ask(name) };
  if (v.variant === 'app_off' || !v.link) return { kind: 'suggest', project_key: key, line: VARIANT_COPY.app_off.ask(name) };
  // GTM W2: past setup (another repo connected), switching repos is one install for this repo, never step 2 again.
  if (v.appDone && key) return { kind: 'install_app', project_key: key, line: installMoreAsk(v.link) };
  return { kind: 'install_app', project_key: key, line: STATE_COPY.not_counted.ask(v.link) };
}

/** The weekly target as the points line's lead ("Ship code this week to pass #3"), else the plain lead ("Done this week." too). Pure. */
const shipLead = (target: string | null) => (target?.startsWith('Ship code this week') ? target.replace(/\.$/, '') : undefined);
/**
 * Ranked: the money line: the Best fit, else the first fit, else the backing statement (its page the reply's one link:
 * a ranked reply carries no other), else the upcoming program.
 */
function moneyLine(v: BenchView, o: { upcoming: boolean } = { upcoming: true }): string | null {
  const fit = v.best ?? v.fund.find((f): f is Extract<FundLine, { kind: 'fits' }> => f.kind === 'fits');
  if (fit) return qualifyLine(fit);
  const b = v.fund.find((f): f is Extract<FundLine, { kind: 'backing' }> => f.kind === 'backing');
  if (b) return b.news ? newBackersLine(b.news) : backingLine(b.backers, b.earned_usd, b.page);
  const u = o.upcoming ? v.fund.find((f): f is Extract<FundLine, { kind: 'upcoming' }> => f.kind === 'upcoming') : undefined;
  return u ? upcomingLine(u.title, u.prize, u.note) : null;
}
/** Paragraphs, each its lines; empty ones dropped. */
const paras = (...ps: (string | null | undefined)[][]) =>
  ps.map((p) => p.filter((x): x is string => typeof x === 'string' && x.length > 0)).filter((p) => p.length > 0).map((p) => p.join('\n')).join('\n\n');

/**
 * Task 16: the step 2 reply may name the account ("You're in, @maya."); v3.1 cold read: only the first after sign-in
 * (`welcome`, claimed by the caller once this holds). Pure.
 */
export const welcomeFits = (v: Pick<BenchView, 'state' | 'handle' | 'held' | 'ask'> & { variant?: Variant }) =>
  Boolean(v.handle) && (v.state === 'no_project' || (v.state === 'not_counted' && !v.held && isStep2(v.ask) && (v.variant ?? null) === (v.ask.kind === 'pick_repo' ? 'no_repo' : null)));
/** The reply names the account ("You're in, @maya."), so no account line goes above it. Pure. */
export const namesAccount = (v: Pick<BenchView, 'state' | 'handle' | 'held' | 'ask' | 'welcome'> & { variant?: Variant }) => v.welcome === true && welcomeFits(v);
/** Task 16: the reply, as the owner approved it, for each state and step. Pure. */
export function benchReply(v: BenchView): string {
  const name = v.project?.name ?? '';
  // 2026-10-22 (owner): no points lines in the first two replies.
  if (v.state === 'signed_out') return paras([INTRO_LINE, introWhat(v.open ?? null)], [v.ask.line]);
  const ask = v.held ?? v.ask.line;
  const step2 = !v.held && isStep2(v.ask);
  const named = namesAccount(v);
  const notice = v.notice ?? null;
  // GTM W2 (2026-10-23, value before the ask): step 2 names the open grant ("Base pays up to $5,000 for apps on Base.")
  // before the GitHub step; a statement with no link, so the step keeps the reply's one link and one question.
  const money = step2 && v.open ? grantHook(v.open) : null;
  if (v.state === 'no_project') return paras([named ? youreIn(v.handle!) : null, notice, money, ...v.due, ask]);
  if (v.state === 'not_counted') {
    if (step2 && !v.variant) return paras([named ? youreIn(v.handle!) : null, notice, money, ...v.due, ask]);
    // GTM W2: a link-only project's step 2 (Lovable, Bolt) names the account too.
    return paras([named ? youreIn(v.handle!) : null, v.variant ? VARIANT_COPY[v.variant].stand(name) : STATE_COPY.not_counted.stand(name), notice, money, ...v.due, ask]);
  }
  return notice ? paras([notice]) + '\n\n' + rankedReply(v, name, ask) : rankedReply(v, name, ask);
}

/**
 * v3.1 GTM W3: whether a ranked reply carries the money line with the upcoming program in it (rankedReply's last
 * branch, no qualify steps), so the upcoming line is claimed only when it is really said. Pure.
 */
export function upcomingShown(v: Pick<BenchView, 'held' | 'ask' | 'connect' | 'moment' | 'handle' | 'post' | 'qualify'>): boolean {
  if (v.held) return true;
  if (v.ask.kind === 'connect' && v.connect) return false;
  if (v.ask.kind === 'share' && v.moment && v.handle) return false;
  if (v.ask.kind === 'post' && v.post) return false;
  if (v.ask.kind === 'apply' || v.ask.kind === 'wallet' || v.ask.kind === 'new_repo' || v.ask.kind === 'coin_wallet') return false;
  return !(v.ask.kind === 'qualify' && v.qualify);
}

/** The ranked state's reply (benchReply). Pure. */
function rankedReply(v: BenchView, name: string, ask: string): string {
  if (!v.held && v.ask.kind === 'connect' && v.connect)
    return paras(
      [connectStanding(name, v.rank, v.streak), v.best ? qualifyLine(v.best) : null, ...v.due],
      [ask, v.connect.points > 0 ? `+${v.connect.points} points` : null],
    );
  if (!v.held && v.ask.kind === 'share' && v.moment && v.handle)
    // v3.1 one-tap posts (design 6): last week's post and its one-tap link, else the page (the reply's one https link).
    return paras([momentHead(v.moment), ...(v.moment.summary ? [`"${v.moment.summary}"`] : []), ...(v.moment.post ? postLines(v.moment.post) : [pageLine(`https://${pageUrl(v.handle)}`)]), ask]);
  if (!v.held && v.ask.kind === 'post' && v.post) return postReply(v.post, ask);
  const full = standingLine(name, v.rank, v.streak, v.earned ?? 0);
  // v3.1 cold read: the standing only when it changed since the builder last saw it, the points line at most once a week.
  const standing = v.standingShown === false ? null : full;
  const nag = v.nagShown !== false;
  // A reply with nothing else to say still says where the builder stands (never an empty reply).
  // The points line alone is no reply either: the standing goes above it.
  const pointsOnly = (l: string) => / up to \+\d+ points$/.test(l);
  const orStanding = (lines: (string | null | undefined)[]) => (lines.some((l) => l && !pointsOnly(l)) ? lines : [full, ...lines.filter((l) => l !== full)]);
  if (!v.held && v.ask.kind === 'apply') return paras(orStanding([standing, ...v.due, ask, nag ? shipPointsLine() : null]));
  // v3.1 wallet proof: the standing, then the step; no money line (the step's link is the reply's one link) and no points.
  // 2026-10-23: the new-repo nudge, the same way (a light nudge, nothing else).
  if (!v.held && (v.ask.kind === 'wallet' || v.ask.kind === 'new_repo' || v.ask.kind === 'coin_wallet')) return paras(orStanding([standing, ...v.due, ask]));
  const points = nag && !v.held && (v.ask.kind === 'ship' || v.ask.kind === 'qualify' || v.ask.kind === 'none') ? shipPointsLine(shipLead(v.target)) : null;
  // 2026-10-22: no fit, so Base's grant: its hook and what the matcher shows missing, above the one question (in place
  // of the upcoming program's line, so the reply stays short).
  const q = !v.held && v.ask.kind === 'qualify' && v.qualify ? [grantHook(v.qualify.grant), qualifyMissing(name, v.qualify)] : [];
  return paras(orStanding([standing, ...v.due, moneyLine(v, { upcoming: q.length === 0 }), ...q, ask, points]));
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
  const base = keyName(key);
  if (squash(name) !== squash(base) || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) return name;
  const first = siteTitle?.split(/\s+[-|–—:·]\s+|\s*[|–—:·]\s*/)[0]?.trim() ?? '';
  if (first && /^[A-Za-z0-9][A-Za-z0-9 .&'+-]{0,39}$/.test(first) && squash(first) === squash(base)) return first;
  // v3.1 GTM W3: a host stays as written ("mealmate.lovable.app"), never title-cased into "Mealmate.lovable.app".
  return name.includes('.') ? name : titleCase(name);
}
/**
 * v3.1 GTM W3: a project key's own name: a repo's name ("maya/recipes" is "recipes"), a link's host
 * ("https://mealmate.lovable.app/" is "mealmate.lovable.app"), else the key. Pure.
 */
export const keyName = (key: string): string =>
  URL.canParse(key) && /^https?:/i.test(key) ? new URL(key).hostname.replace(/^www\./, '') : key.includes('/') ? key.split('/').pop()! : key;
