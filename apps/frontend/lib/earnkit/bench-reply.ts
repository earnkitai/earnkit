import { pageUrl } from './reserved-routes';
import { CHEER_LINE, communityRow, mondayOpener, mondayRows } from './weekly-moment';

/**
 * v3.1 Task 16 (owner-approved copy, 2026-10-21): every reply written for a busy builder. Plain text, no headers,
 * short lines: the explanation, the action, then the points line when the step earns points; " · " joins facts on one
 * line; at most one https link; exactly one question; every number real (points read from the ledger rules, points.ts).
 * The logic stays: four states, each with one next step; ranked, in order: connect, apply, share (the weekly
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
/** 2026-10-22: `titles`, a private repo's titles question (ranked, once a person); `qualify`, Base's grant steps for a ranked builder with no fit. */
/** v3.1 one-tap posts: `post`, an event's drafted post for X (a yes redrafts it). */
/** v3.1 wallet proof: `wallet`, the optional signed wallet step after setup (once a person), or the change link (tell wallet). */
/**
 * 2026-10-23 Base onboarding: `base_start`, the one walk-through offer after the GitHub no; `next_step`, the no-project
 * reply once every onboarding question was asked; `new_repo`, the one nudge for a main project quiet for STALE_WEEKS.
 */
export type BenchAskKind = 'sign_in' | 'start' | 'pick_repo' | 'install_app' | 'other_project' | 'repo_behind' | 'ship' | 'suggest' | 'share' | 'connect' | 'apply' | 'titles' | 'qualify' | 'post' | 'wallet'
  | 'base_start' | 'next_step' | 'new_repo'
  /** GTM W2 (2026-10-23): `base_help`, the walk-through's step 1 help; `checkin`, the Monday check-in (once, clients that schedule); `none`, no question. */
  | 'base_help' | 'checkin' | 'none'
  /** v4.0 Task 8 fix round 1: the accepted nudge's share ask (its yes: the post's link). */
  | 'outcome_share'
  /** v4.0: `wallet_setup`, setup step 3 (the wallet, and the builder's token unless they say no), once a person. */
  | 'wallet_setup'
  /** v4.2 final review 3: the setup-done reply's `closest` (the closest program's one step) and `check_fits` (check which programs fit). */
  | 'closest' | 'check_fits'
  /** v4.2 Task 6: `token`, the one-time token offer for a builder who set up before v4 (a wallet, no token row, never offered). */
  | 'token'
  /** v4.6 Task 3: `stripe`, the one-time Stripe connect ask (a no is permanent). v4.7 T3: no reply asks it now; a stored one still answers. */
  | 'stripe';
/** `program_id`: the program an `apply` ask is about (its no is kept under it, never the project). */
export type BenchAsk = { kind: BenchAskKind; project_key: string | null; line: string; program_id?: string };
export type FundLine =
  /** R12: a program that fits: its award ("$5,000", null unknown), its deadline ("closes Oct 30" or "rolling"). */
  | { kind: 'fits'; title: string; amount: string | null; when: string; bar?: FitBar }
  /** v3 Stage 2: one program not open yet, for a ranked builder on a 4-week streak: a statement, no link. */
  | { kind: 'upcoming'; title: string; prize: string; note: string };
export type BenchProject = { key: string; name: string; confirmed: boolean; live: boolean; weeks: number };

/** v3 Stage 2: "Base Batches 005: up to $100K, not open yet. <note>" (a statement, never a link or a question). Pure. */
export const upcomingLine = (title: string, prize: string, note: string) => `${title}: ${prize}, not open yet. ${note}`;
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
/** Task 16: the connect offer: the weeks it posts (v4.2 final review 4: no points; the copy never shows them). */
export type ConnectOffer = { weeks: number };
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
  /** v4.0 Task 7: the builder's first name (firstName), last week's Shipping and its change (null: no week before). */
  first: string; score: number; change: number | null;
  /** v4.0 Task 7: what the community sent last week and the week before (community.ts weekCommunityUsd). */
  community: { usd: number; lastWeekUsd: number };
};
/** v3.1 one-tap posts: a drafted post: its exact text and the short link that opens X's composer with it. */
export type PostOffer = { text: string; link: string };
/** v3.1 one-tap posts: an event's post (went live, won, accepted, funded, the builder's news): its head line too. */
export type EventPost = PostOffer & { head: string };

/** v4.0 approved copy 1 (before sign-in): the head line and what EarnKit does. */
export const INTRO_LINE = '**EarnKit gets you paid for building.**';
/** v4.0: the open grant's line, from its data ("Up to $5,000 is open from Base right now."). Pure. */
export const grantOpenLine = (g: OpenGrant) => `Up to ${g.amount} is open from ${g.org} right now.`;
export const introWhat = (open: OpenGrant | null) =>
  `Every week I read what you ship, rank you against other builders, and find grants and programs you qualify for.${open ? ` ${grantOpenLine(open)}` : ''}`;
/** v4.0 approved copy 2: said once, on the first reply after sign-in (standing_seen.welcomed). */
export const youreIn = (handle: string) => `You're in, @${handle}. Really glad you're here.`;
/**
 * v4.0 approved copy 2: step 2's hint, only for a builder with no GitHub (BenchView.noGithub: said so, a link-only
 * project, or a Lovable or Bolt live link; never assumed). Only Lovable and Bolt are confirmed (v3.1-install-research.md).
 */
export const NO_GITHUB_HINT = 'Built it in Lovable or Bolt? Connect GitHub there first (Lovable: Project settings, then Git. Bolt: the GitHub icon, top right).';
/** The connect step's first words (isStep2 reads them). */
export const CONNECT_LEAD = "**Step 2 of 3:** connect your app's code on GitHub so I can match you";
/** v4.0 approved copy 2: the connect action (the repo picker, or a named repo's install link); the hint only without GitHub. */
export const pickRepoAsk = (link: string, noGithub: boolean) =>
  `${CONNECT_LEAD} to the right programs. Read-only, one click: ${link}\n\n${noGithub ? `${NO_GITHUB_HINT}\n\n` : ''}Done?`;
/**
 * v3.1 answerable replies (spec 6): the connect step again the same day (UTC) after its full pitch: the link and its
 * question only (the money line and the Lovable or Bolt hint once a day). Pure.
 */
export const pickRepoAgain = (link: string, noGithub = false) =>
  `Connect your app's code so I can match it (read-only, one click): ${link}\n${noGithub ? `${NO_GITHUB_HINT}\n` : ''}Done?`;
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
export const isStep2 = (a: BenchAsk) => (a.kind === 'pick_repo' && a.line.startsWith(CONNECT_LEAD)) || (a.kind === 'install_app' && a.line.startsWith(CONNECT_LEAD));
/** v3 Stage 1 (spec 5.1), v3.1 cold read: the connect weeks' one question (ranked, once a person); the page is its link (no count). */
export const connectAsk = (page: string) => `Make your shipping log public on ${page} so grant teams can see it?`;
/**
 * v3 Stage 2, Task 16 step 5: the apply step's money and its one question; `when` is the deadline's day ("Nov 18"),
 * null for a rolling program. Pure.
 */
export const applyAsk = (title: string, amount: string | null, when: string | null) => `${applyWhy(title, amount, when)}\nWant me to?`;
/** v4.7 T4: the apply step's own reason sentence (its move_up.why; no new line in the reply). Pure. */
export const applyWhy = (title: string, amount: string | null, when: string | null) =>
  `${title} ${when ? `closes ${when}` : 'is still open'}${upTo(amount)}. I can draft it in a minute.`;
/** Task 16: the ranked ship step's one question (a yes: one small thing to ship, SHIP_STEP_NOTE). */
export const SHIP_ASK = 'Want me to suggest one small thing to ship?';
/**
 * v4.7 T4 (exact copy, "Why lines"): each step's own short line, the paragraph just before its question, and the
 * move_up.why the agent answers "why" from. The ship line counts the streak's weeks (none: it starts one). Pure.
 */
export const shipWhy = (streak: number) =>
  streak > 0 ? `Shipping this week keeps your ${streak}-week streak and lifts your score.` : 'Shipping this week starts your streak and lifts your score.';
export const CHECKIN_WHY = 'A Monday check-in keeps your drafts current before deadlines.';
export const SHARE_WHY = 'Builders who share wins get noticed by programs.';
export const POST_WHY = 'A post with real numbers is what reviewers read.';
/**
 * v4.7 T4 (ruling R1: the server instructions are full, so this rides on every move_up that carries a why): the
 * agent answers "why" from move_up.why, never inventing a reason.
 */
export const WHY_NOTE = 'If they ask why, answer from move_up.why.';
/** v4.7 T4: WHY_NOTE on an agent note, before its closing "Don't show this note." (else at its end). Pure. */
export const whyNote = (note: string) =>
  note.endsWith(" Don't show this note.") ? `${note.slice(0, -" Don't show this note.".length)} ${WHY_NOTE} Don't show this note.` : `${note} ${WHY_NOTE}`;
/** v4.7 T4: a move_up with its why (and WHY_NOTE on its agent_note); with no why, as it is. Pure. */
export const withWhy = <M extends { agent_note: string }>(m: M, why: string | null | undefined): M & { why?: string } =>
  why ? { ...m, why, agent_note: whyNote(m.agent_note) } : m;
/**
 * v4.7 T4 fix round 0 (R13): the ship ask's why: the weekly rank target when there is one ("Ship code this week to
 * hold #1.", the more specific reason), else the streak line. Pure.
 */
export const shipWhyOf = (target: string | null | undefined, streak: number) =>
  target?.startsWith('Ship code this week to ') ? target : shipWhy(streak);
/** v4.7 T4 (exact copy): the setup-done reply's first-run line, a statement, said once (standing_seen.asks_hint). */
export const ASKS_HINT = 'Ask me anytime: where do I stand, what can I apply to, or draft my application.';
/**
 * v3.1 wallet proof (owner-approved 2026-10-23): the optional step right after setup, offered once a person. Its one
 * question takes "done" (a yes: the proof is checked) or "skip" (a no: remembered, never asked again). Pure.
 */
export const WALLET_ASK = 'Done?';
/** v3.1 cold read: only for a builder with contracts on Base known or reported (wallet-offer.ts walletOfferDue). */
export const walletOffer = (link: string) =>
  `Prove your Base wallet so your contracts show on your page. One signature, no fee: ${link}\n${WALLET_ASK}`;
/**
 * v4.4 (setup order): setup step 3 asks for the wallet only, for every builder once step 2 is done or answered no
 * (wallet-offer.ts walletSetupDue). The one token offer follows the sign (setupTokenOffer). `project`: the main project's
 * name ("MealMate is connected."); null on the no-GitHub path (nothing is connected, so only "One last step."). Pure.
 */
export const walletSetupAsk = (project: string | null, link: string) =>
  `${project ? `${project} is connected. ` : ''}One last step.\n\n**Step 3 of 3:** add your wallet. It's where grant money and builder campaign payouts get paid. One signature, no fee: ${link}\n\nDone?`;
/**
 * v4.4: the wallet signed during setup step 3 and the token offer is due (bench-find.ts afterStep3): the done line, the
 * one optional offer, and its question last. `short`: the wallet's short form (entry-text.ts shortWallet). Pure.
 */
export const setupTokenOffer = (short: string) =>
  `Done. Your payouts go to ${short}.\n\nOne optional thing: your own token, so people who believe in your work can back it. 40% of every trade's fee goes to you, claimed for you. ` +
  "If you already have a token or would rather skip it, just say so and I won't ask again.\n\nWant it live?";
/** v4.0: the builder said no to their token (tell move_up kind 'token', answer 'no'). */
export const TOKEN_NO_LINE = 'Got it.';
/** v4.4: the builder's own token, recorded (tell token { existing }; bench-find.ts tokenExisting). `short`: shortWallet. Pure. */
export const existingTokenLine = (short: string) => `Got it. I've noted ${short} as your token, and I won't offer one again.`;
/** v4.4: the address they named is not a token on Base (or not an address); the stored token ask stays. */
export const EXISTING_NOT_TOKEN = "That address isn't a token on Base. Paste your token's contract address, or say skip.";
/**
 * v4.2 Task 6 (F11): the one-time token offer for an earlier builder with a proven wallet and no token row. The lead is a
 * statement; the question ends the reply (and follows the explainer when the builder asked about their token).
 */
export const TOKEN_OFFER_LEAD = "One new thing: your token can go live today, so people who believe in your work can back it. 40% of every trade's fee goes to you, claimed for you.";
export const TOKEN_OFFER_QUESTION = "If you already have a token or would rather skip it, just say so and I won't ask again.\n\nWant it live?";
export const TOKEN_OFFER = `${TOKEN_OFFER_LEAD} ${TOKEN_OFFER_QUESTION}`;
/** v4.0 approved copy 4 ("Skipped the wallet"), its first sentence (Task 5 adds what's open). */
export const WALLET_SETUP_SKIPPED = "No worries, add it whenever you're ready.";
/**
 * v4.0 Task 5: how setup step 3 settled. 'launched': a wallet signed and the token launched; 'on_its_way' (final review
 * 1): a wallet signed and the token still launching or unknown (never told as live); 'set': a wallet signed with no
 * token to claim (the neutral lead); 'existing' (v4.4): a wallet signed and the builder's own token recorded (the same
 * lead as 'set'); 'declined': the token said no; 'skipped': no wallet.
 */
export type SetupOutcome = 'launched' | 'on_its_way' | 'set' | 'existing' | 'declined' | 'skipped';
/** v4.0: a token row launching or unknown, said to the builder. */
export const TOKEN_ON_ITS_WAY = "Your token is on its way. I'll confirm it here soon.";
/** v4.0 approved copy 4: the line above the open programs table. */
export const SETUP_OPEN = "Here's what's open for you right now:";
/**
 * v4.0 approved copy 4 ("Setup done"): the lead, word for word, ending with SETUP_OPEN (`open` false: no open fit, so
 * the lead alone). `first`: the builder's first name (X display name's first word, else the handle). Pure.
 */
export function setupDoneLead(first: string, outcome: SetupOutcome, open = true, trade?: string | null): string {
  const tail = open ? SETUP_OPEN : null;
  switch (outcome) {
    // v4.2: the sign that launched the token says so, with the trade link.
    case 'launched': return [trade ? `You're all set, ${first}. Your token is live, so your community can back what you're building: ${trade}` : `You're all set, ${first}. Your community can now back what you're building.`, tail].filter(Boolean).join('\n\n');
    case 'on_its_way': return [`You're all set, ${first}. ${TOKEN_ON_ITS_WAY}`, tail].filter(Boolean).join('\n\n');
    case 'set': case 'existing': return [`You're all set, ${first}.`, tail].filter(Boolean).join('\n\n');
    case 'declined': return ['No problem, no token.', tail].filter(Boolean).join(' ');
    case 'skipped': return [WALLET_SETUP_SKIPPED, tail].filter(Boolean).join(' ');
  }
}
export type ProgramRow = { program: string; upTo: string; closes: string };
/** A table cell: one line, never a `|` (it would break the row). Pure. */
const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
/** v4.0 approved copy 4: the open programs table (Program | Up to | Closes), its rows as given. Pure. */
export const programsTable = (rows: ProgramRow[]) =>
  ['| Program | Up to | Closes |', '|---|---|---|', ...rows.map((r) => `| ${cell(r.program)} | ${cell(r.upTo)} | ${cell(r.closes)} |`)].join('\n');
/** v4.0 approved copy 4: the one question, the first row's program (the apply ask: a yes drafts it). Pure. */
export const bestFitAsk = (program: string) => `${bestFitWhy(program)} Want me to draft it?`;
/** v4.7 T4: the setup-done questions' own reason sentences (their move_up.why; no new line). Pure. */
export const bestFitWhy = (program: string) => `${program} looks like your best fit.`;
export const closestWhy = (program: string, step: string) => `${program} is the closest. It needs ${step}.`;
/**
 * v4.0 Task 5: the setup-done reply: the lead, the table and the draft question; with no open fit, the lead alone and
 * `noFit` (never an empty table). Pure.
 */
export const setupDoneReply = (first: string, outcome: SetupOutcome, rows: ProgramRow[], noFit: string, opts: { trade?: string | null; closest?: { program: string; step: string } | null; check?: string | null; noAsk?: boolean; hint?: string | null } = {}) =>
  // v4.7 T4: the first-run line (`hint`, ASKS_HINT) is a statement before the question, so the question stays last.
  rows.length === 0
    ? [setupDoneLead(first, outcome, false, opts.trade), noFit, opts.hint].filter((x): x is string => Boolean(x)).join('\n\n')
    : [setupDoneLead(first, outcome, true, opts.trade), programsTable(rows), opts.hint,
        opts.noAsk ? null : opts.closest ? closestAsk(opts.closest.program, opts.closest.step) : opts.check ? checkFitsAsk(opts.check) : bestFitAsk(rows[0].program)]
        .filter((x): x is string => Boolean(x)).join('\n\n');
/** v4.2 Task 10: fits not known yet: the question (a yes runs the fit check, find). Pure. */
export const checkFitsAsk = (project: string) => `Want me to check which of these fits ${project}?`;
/** v4.2: nothing fits now: the closest program, the one step it needs, and the offer to help. Pure. */
export const closestAsk = (program: string, step: string) => `${closestWhy(program, step)} Want help with it?`;
/** Only when true: the Base Builder Code stays on the first wallet; a launched token's fees stay with its launch wallet. */
export const WALLET_BUILDER_CODE = 'Your Base Builder Code stays on your first wallet.';
export const WALLET_COIN_FEES = "Your token's fees keep going to the wallet it launched with.";
/** The builder asked to add their reward wallet (none yet): a fresh signing link, the statements, one question. Pure. */
export const walletChange = (link: string, extras: string[] = []) =>
  [`Sign with the wallet you want your rewards sent to. One signature, no fee: ${link}`, ...extras, 'Done?'].join('\n');
/** The builder asked to change their reward wallet: the current one (short), the X step, the statements, one question. Pure. */
export const walletChangeX = (current: string, link: string, extras: string[] = []) =>
  [`Your rewards go to ${current}. To change that, sign in with X and sign with the new wallet (one signature, no fee): ${link}`, ...extras, 'Done?'].join('\n');
/** "Done" before the signature arrived: a fresh link (the last one may have expired) and the same question. Pure. */
export const walletNotYet = (link: string) => `I don't see a signature yet. Here's a fresh link (one signature, no fee): ${link}\nDone?`;
/** Done: the wallet is the reward recipient (short). Pure. */
export const walletDone = (wallet: string, contracts = false) =>
  `Done. Your rewards now go to ${wallet}.${contracts ? ' Your contracts on Base will show on your page soon.' : ''}`;
/** Done for contracts only: no X sign-in, so the rewards stay with the current wallet (short). Pure. */
export const walletContractsOnly = (current: string) =>
  `Done. That wallet counts for your contracts. Your rewards still go to ${current} until you sign in with X on the wallet page.`;
/** The one-line notice on the next reply after the reward wallet changed. Pure. */
export const walletNotice = (wallet: string) => `Your reward wallet changed to ${wallet}.`;
export const WALLET_SKIPPED = 'Skipped. Ask me anytime to add your reward wallet.';
/** 2026-10-22: a private repo with titles off, asked once (a yes: updates.ts setShipTitles on). */
/** v4.2 Task 10: a no to the titles question. */
export const TITLES_NO_LINE = 'Got it, your commit titles stay private.';
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
export type QualifyOffer = {
  program_id: string; grant: OpenGrant; missing: QualifyStep[]; steps: QualifyStep[];
  /** v4.3: the program's title ("Base Builder Grant Program") and when ("rolling", "closes Nov 1"; stand-view.ts fundWhen), the reply's head. */
  title: string; when: string;
};
/** v4.3: another open grant the qualify reply names ("Arc Microgrants", "500 USDC × 8 grants", "closes Nov 1" or "rolling"). */
export type AlsoOpen = { title: string; amount: string; when: string };
/** Builder Codes' guide (Base's docs), the one link of the steps reply. */
export const BUILDER_CODES_GUIDE = 'docs.base.org/base-chain/builder-codes/builder-codes';
const NEEDS: Record<QualifyStep, string> = { base: 'put the app on Base', codes: 'add Builder Codes', use: 'get people using it' };
/** "a, b and c". Pure. */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** "Base's $5,000 grant". Pure. */
const grantName = (g: OpenGrant) => `${g.org}'s ${g.amount} grant`;
/** v4.3 (owner-approved): what Builder Codes are, said once in the gap. */
const CODES_TAG = "a one-line tag that credits your app's Base transactions to you";
/** v4.3 (owner-approved): "Base Builder Grants: $5,000, rolling." Pure. */
export const qualifyHead = (q: Pick<QualifyOffer, 'title' | 'grant' | 'when'>) => `${grantProgramName(q.title)}: ${q.grant.amount}, ${q.when}.`;
/**
 * v4.3 (owner-approved): the one gap in plain words. Every remaining step known missing: "EarnKit is one step away: add
 * Builder Codes, a one-line tag ..."; otherwise "To qualify, EarnKit needs to ..." (never "one step away" on a guess).
 * Builder Codes are explained right after their item when last, else in their own sentence after the gap. Pure.
 */
export function qualifyGap(name: string, q: Pick<QualifyOffer, 'missing' | 'steps'>): string {
  const steps = QUALIFY_STEPS.filter((s) => q.steps.includes(s));
  const known = steps.length > 0 && steps.every((s) => q.missing.includes(s));
  const codesLast = steps.at(-1) === 'codes';
  const needs = andList(steps.map((s) => (s === 'codes' && codesLast ? `${NEEDS.codes}, ${CODES_TAG}` : NEEDS[s])));
  const n = steps.length;
  const gap = known ? `${name} is ${n === 1 ? 'one step' : `${n} steps`} away: ${needs}.` : `To qualify, ${name} needs to ${needs}.`;
  return steps.includes('codes') && !codesLast ? `${gap} Builder Codes are ${CODES_TAG}.` : gap;
}
/**
 * v4.3 (owner-approved): "Also open: Arc Microgrants, 500 USDC × 8 grants, closes Nov 1. Circle Developer Grants, ...":
 * each title before its first ':', its amount cell and, unless rolling, when. Null with none. Pure.
 */
export const alsoLine = (a: AlsoOpen[]) =>
  a.length === 0 ? null : `Also open: ${a.map((x) => `${x.title.split(':')[0].trim()}, ${x.amount}${x.when === 'rolling' ? '' : `, ${x.when}`}.`).join(' ')}`;
/**
 * The no-fit reply's one question, by the first step left (v4.3, owner-approved): Builder Codes, "Want me to add
 * Builder Codes to EarnKit?" (fix round 1, ruling R1: an agent with no folder of the code (`hosted`) can't add it, so
 * "Want the steps to add Builder Codes to EarnKit?", whose yes is qualifySteps); Base, "Want help putting EarnKit on
 * Base?"; users only, the next step toward the grant. Pure.
 */
export function qualifyAsk(g: OpenGrant, steps: QualifyStep[], name: string, hosted = false): string {
  const first = QUALIFY_STEPS.find((s) => steps.includes(s));
  if (first === 'codes') return hosted ? `Want the steps to add Builder Codes to ${name}?` : `Want me to add Builder Codes to ${name}?`;
  if (first === 'base') return `Want help putting ${name} on Base?`;
  const n = steps.length;
  return n >= QUALIFY_STEPS.length ? `Want the ${n} steps to qualify for ${grantName(g)}?` : `Want the ${n === 1 ? 'next step' : `${n} steps`} toward ${grantName(g)}?`;
}
/**
 * v4.3 (owner-approved): the yes to "Want me to add Builder Codes to EarnKit?": a statement, never another question.
 * Final review F2: when EarnKit's check is unknown (`missing` false), "if they're not there yet". Pure.
 */
export const qualifyCodesYes = (name: string, missing = true) =>
  `Adding Builder Codes to ${name}${missing ? '' : " if they're not there yet"}. Base's guide: https://${BUILDER_CODES_GUIDE}`;
/** v4.3: the agent's note on that yes (Builder Codes known missing): do it here, show the change, ask nothing more. */
export const QUALIFY_CODES_NOTE =
  `The builder said yes to adding Builder Codes: add Base's Builder Code to the builder's app here, following Base's guide (https://${BUILDER_CODES_GUIDE}), then show them the change. ` +
  "Don't ask again whether to add it. Never tell them they qualify or that an application was sent. Don't show this note.";
/** v4.3 fix round 1: the same yes when EarnKit's Builder Codes check is unknown: check the code first, add it only if missing. */
export const QUALIFY_CODES_CHECK_NOTE =
  `The builder said yes to adding Builder Codes. EarnKit hasn't confirmed whether the app already has one: first check the builder's code here for Base's Builder Code. ` +
  `Only if it is not already there, add it following Base's guide (https://${BUILDER_CODES_GUIDE}) and show them the change; if it is there, tell them it's already in place. ` +
  "Don't ask again whether to add it. Never tell them they qualify or that an application was sent. Don't show this note.";
const STEP_LINE: Record<QualifyStep, string> = {
  base: 'Put your app on Base.',
  codes: `Add Base's Builder Code to your app, a one-line tag Base uses to see your traffic: https://${BUILDER_CODES_GUIDE}`,
  use: 'Have a live product people use.',
};
/** The steps reply's one question: help with the first step listed (always "step 1"). */
export const QUALIFY_HELP_ASK = 'Want help with step 1 now?';
/** Cold read: one step left has no "step 1" to point at. */
export const QUALIFY_HELP_ASK_ONE = 'Want help with it now?';
/**
 * The yes to qualifyAsk: the remaining steps as plain lines, what EarnKit does next, one question. Final review F4:
 * `ask` false (the builder already said yes to help, "Want help putting EarnKit on Base?"): the steps, no question. Pure.
 */
export function qualifySteps(g: OpenGrant, steps: QualifyStep[], ask = true): string {
  const todo = QUALIFY_STEPS.filter((s) => steps.includes(s));
  const head = todo.length >= QUALIFY_STEPS.length ? `${todo.length} steps to qualify for ${grantName(g)}:` : `${todo.length === 1 ? 'Your next step' : `Your next ${todo.length} steps`} toward ${grantName(g)}:`;
  const lines = [head, ...todo.map((s, i) => `${i + 1}. ${STEP_LINE[s]}`)];
  return (ask ? [...lines, '', todo.length === 1 ? QUALIFY_HELP_ASK_ONE : QUALIFY_HELP_ASK] : lines).join('\n');
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

/** Task 16, step 7; v4.0 Task 7 (approved copy 5): the weekly moment's question. */
export const MOMENT_ASK = 'Looks right?';
/**
 * v4.0 Task 7 (approved copy 5, "Every Monday"): the opener, the week's table (a blank first header: plain surfaces read
 * "Label: value", reply-format.ts), the cheer under it when the community sent $100 or double last week, the post link
 * (no post: the page), then `ask`. Never names the token. Pure.
 */
export function mondayReply(m: MomentView, page: string, ask: string, why: string | null = null): string {
  const facts = { score: m.score, change: m.change, streak: m.week, usd: m.community.usd, lastWeekUsd: m.community.lastWeekUsd };
  const table = ['| | This week |', '|---|---|', ...mondayRows(facts).map(([label, value]) => `| ${cell(label)} | ${cell(value)} |`)];
  return paras(
    [mondayOpener(m.first, m.summary ?? null)],
    table,
    [communityRow(facts.usd, facts.lastWeekUsd)?.cheer ? CHEER_LINE : null],
    [m.post ? `Your post is ready to share: ${m.post.link}` : pageLine(page)],
    // v4.7 T4: the share step's why, just before its question.
    [why],
    [ask],
  );
}
/** v4.0: "Maya Lin" is "Maya": the X display name's first word holding a letter; else the handle. Pure. */
export const firstName = (name: string | null, handle: string | null) =>
  name?.trim().split(/\s+/).find((w) => /\p{L}/u.test(w) && !w.startsWith('@')) || handle || 'there';
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
/** The event reply: its head, the post block and `ask`, one block; v4.7 T4: a `why` is its own paragraph before `ask`. Pure. */
export const postReply = (e: EventPost, ask: string, why: string | null = null) =>
  why ? `${[e.head, ...postLines(e)].filter(Boolean).join('\n')}\n\n${why}\n\n${ask}` : [e.head, ...postLines(e), ask].filter(Boolean).join('\n');
const theProgram = (p: string) => (/^the\s/i.test(p) ? p : `the ${p}`);
/**
 * The event reply's head (design 6): "Tally went live this week." (else "Tally is live." when it went live over 7
 * days ago, so the line stays true), "Ledgerline won the Base Builder Grant." , accepted or funded an empty head (the reply starts at "Your post for X, with your page card:"), else "Added to your page."
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
  // Fix round: the profile doesn't show an acceptance or funding, so never "Added to your page." for them; v4.0 Task 11:
  // nor for an old draft of the retired coin intro.
  if (c.moment === 'accepted' || c.moment === 'funded' || c.moment === 'coin_intro') return '';
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

/**
 * v4.6 Task 3: the connect reply, the disconnect reply and the rule for the agent. The link is the connect page's
 * (stripe.ts stripeLink); no key or account id is ever in a reply. v4.7 T3: the one-time ask left the reply order;
 * it is one line on a draft for a program that wants revenue (stripeDraftLine, tools.ts prepare).
 */
export const stripeConnectLine = (link: string) => `Connect Stripe read-only here: ${link}`;
/** v4.7 T3 (exact copy): the draft's Stripe line, a statement. Pure. */
export const stripeDraftLine = (link: string) => `Connect Stripe read-only so this draft can show verified revenue: ${link}`;
export const STRIPE_DISCONNECTED = 'Stripe disconnected. EarnKit deleted the key.';
export const STRIPE_NOT_CONNECTED = "Stripe isn't connected.";
export const STRIPE_NO_LINK = "Stripe connecting isn't available right now.";
export const STRIPE_NEVER_KEY =
  "Never ask the builder for a Stripe key in chat. If they paste one, tell them to use the link instead and not to repeat it. Don't show this note.";
/** v4.7 T3: the draft's agent note line: the Stripe line, shown once beside the draft (never a question of its own). */
export const stripeDraftNote = (link: string) => `Show the builder this line once, under the draft and above its question: "${stripeDraftLine(link)}" ${STRIPE_NEVER_KEY}`;

/** v2.13.1 O2 fix round 1 (ruling 3): another person holds the repo, or it is a copy. */
export const OTHER_PROJECT_ASK = 'Want to use a different project?';
/** The key a no keeps an ask away under (standing_seen.declined, 30 days). Pure. */
export const benchStepKey = (kind: string, key: string | null) => `${kind}:${key ?? '*'}`;

/** R16a: the steps that need words of their own before the account has a page. */
export const STATE_COPY = {
  signed_out: {
    /** v4.0 approved copy 1: the three steps, the sign-in link in the first. */
    ask: (link: string) => `Setup takes about a minute:\n1. Sign in with X: ${link}\n2. Connect your code\n3. Add your wallet\n\nDone with step 1?`,
    /** Fix round 1: the link couldn't be made this time (never read as signed in). */
    retry: () => "I couldn't make your sign-in link just now. Want me to try again?",
  },
  no_project: {
    /** Launch ready L2: the repo picker's install link (GitHub's page picks the repos); never a GitHub URL asked for. */
    ask: (link: string, noGithub: boolean) => pickRepoAsk(link, noGithub),
    /** The App link can't be made (the App is off): their work is asked for instead. */
    noApp: () => "What's your GitHub, or a link to something you've made?",
  },
  not_counted: {
    /** v3.1 cold read: never "<Project> isn't counted yet." (it meant nothing to a builder). */
    stand: (_name: string): string | null => null,
    ask: (link: string, noGithub: boolean) => pickRepoAsk(link, noGithub),
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
  /** v4.3: up to two other open grants the qualify reply names ("Also open: ..."); absent or empty: no line. */
  also?: AlsoOpen[];
  /**
   * v4.3 Task 2: the builder asked for the full list (find {more: true}): every shown program's table (present.ts
   * fullProgramTable), in place of "Also open" in the qualify reply, else right before the question. Absent: none.
   */
  fullTable?: string | null;
  /** v3.1 one-tap posts: an event's drafted post (ask kind 'post'). */
  post?: EventPost | null;
  /** 2026-10-23: a one-line statement said once (TEMPLATE_NOTICE), under the account line, else above the reply. */
  notice?: string | null;
  /** v3.1 cold read: "You're in, @maya." is this reply's (the first after sign-in only, standing_seen.welcomed). */
  welcome?: boolean;
  /**
   * v4.0: the builder has no GitHub: said so (standing_seen.github_no), the main project is link-only, or its live link
   * was built with Lovable or Bolt (builtWith). Step 2 carries NO_GITHUB_HINT only then (benchView always sets it).
   */
  noGithub?: boolean;
  /** v3.1 cold read: the ranked standing line is shown (it changed since last seen); absent: shown. */
  standingShown?: boolean;
  /** v4.7 T2: the score reply leads with the standing paragraph (standing.ts standingText), so no standing line here. */
  standingLed?: boolean;
  /** v3.1 cold read: the shipping points line is shown (at most once an ISO week); absent: shown. */
  nagShown?: boolean;
  /** v3.1 cold read: a live link with no GitHub (the builder said no once): its tool's GitHub steps (liveNoGithub). */
  liveTool?: { tool: 'lovable' | 'bolt' | null } | null;
  /** v3.1 answerable replies (spec 6): the connect step's full pitch was shown today: this one is short (pickRepoAgain). */
  pitched?: boolean;
  /** v4.0 Task 8: this week's nudge (nudges.ts takeNudge), its own paragraph leading a ranked reply. */
  nudge?: string | null;
  /** Fix round 1 (ruling 2): the nudge asks the reply's one question (its ask is `ask`); no other ask line is shown. */
  nudgeOwns?: boolean;
  /** v4.0 Task 5: the setup-done reply (setupDoneReply), said once in place of the state's reply. */
  setupDone?: string;
};

/** v3 Stage 2: the program the apply step offers to draft for (its deadline's day, "Nov 18"; v3.1: null, rolling). */
export type ApplyPick = { program_id: string; title: string; amount: string | null; when: string | null };
/**
 * Each state's one next step (A16; signed out with no link: the retry). Ranked, in order: the connect weeks' question
 * (`connect`), the drafted application (`apply`; v3.1 spec 3.2: money to the builder first), the weekly moment's question once a week (L6, `share`), the optional wallet step once
 * (`wallet`, v3.1 wallet proof), a private repo's titles
 * question once (`titles`), Base's grant steps with no fit (`qualify`), else the ship step. v4.7 T3 (money first):
 * benchView passes `apply` for an open fit not applied to on every reply until it is (asked again after the first
 * time), so the check-in, wallet, token, new-repo, titles and ship asks wait; there is no Stripe ask here (it rides on
 * a draft, tools.ts). Pure.
 */
export function stateAsk(
  v: Pick<BenchView, 'state' | 'variant' | 'project' | 'link'> & {
    handle?: string | null; connect?: ConnectOffer | null; share?: boolean; apply?: ApplyPick | null;
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
    /** v4.0: the builder has no GitHub (BenchView.noGithub): step 2 carries the Lovable or Bolt hint. */
    noGithub?: boolean;
    /** v4.0: setup step 3 is due (wallet-offer.ts walletSetupDue): its link and the project it names. */
    walletSetup?: { link: string; project: string | null } | null;
    /** v4.2 Task 6: the one-time token offer is due (wallet-offer.ts tokenOfferDue), in a quiet ranked reply. */
    tokenOffer?: boolean;
    /** v4.3 fix round 1 (R1): the agent has no folder of the code (agentReach hosted): the qualify question asks for the steps. */
    hosted?: boolean;
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
    // v4.0: setup step 3 right after the walk-through offer (the no's own reply), before its follow-ups.
    if (v.walletSetup) return { kind: 'wallet_setup', project_key: null, line: walletSetupAsk(v.walletSetup.project, v.walletSetup.link) };
    if (v.walk === 'help') return { kind: 'base_help', project_key: null, line: LOVABLE_PROMPT_ASK };
    if (v.walk === 'built' && v.link) return { kind: 'pick_repo', project_key: null, line: nextBuild(v.link) };
    if (v.wallet) return { kind: 'wallet', project_key: null, line: walletOffer(v.wallet) };
    return { kind: 'next_step', project_key: null, line: NEXT_STEP_ASK };
  }
  // v4.0 fix round 1: step 3 once step 2 is done, ranked or not (a project not counted yet: the App connected another repo).
  if (v.walletSetup && v.state !== 'ranked')
    return { kind: 'wallet_setup', project_key: key, line: walletSetupAsk(v.walletSetup.project, v.walletSetup.link) };
  if (v.state === 'no_project')
    return v.link ? { kind: 'pick_repo', project_key: null, line: STATE_COPY.no_project.ask(v.link, v.noGithub === true) } : { kind: 'start', project_key: null, line: STATE_COPY.no_project.noApp() };
  // v3.1 cold read: a live app (Lovable, Bolt) whose builder said no to GitHub once: how its tool puts the code on GitHub.
  if (noCode && v.link && v.liveTool) return { kind: 'pick_repo', project_key: null, line: liveNoGithub(v.liveTool.tool, name, v.link) };
  // GTM W2: a live link with no repo: step 2's repo picker (its no starts the Base walk-through), never "Where does it live?".
  if (noCode && v.link) return { kind: 'pick_repo', project_key: null, line: STATE_COPY.no_project.ask(v.link, v.noGithub === true) };
  // v4.0: setup step 3 comes before every ranked ask (it ends setup).
  if (v.state === 'ranked' && v.walletSetup)
    return { kind: 'wallet_setup', project_key: key, line: walletSetupAsk(v.walletSetup.project, v.walletSetup.link) };
  // Fix round 1 ruling: the page is the connect reply's one https link.
  if (v.state === 'ranked' && v.connect && v.handle) return { kind: 'connect', project_key: key, line: connectAsk(`https://${pageUrl(v.handle)}`) };
  // v4.7 T3 fix round 1 (R11): money first: the apply ask before an event's post (benchView holds every post, the hot
  // one too, while an open fit is unapplied; with none, a post goes in the share slot).
  if (v.state === 'ranked' && v.apply) return { kind: 'apply', project_key: key, program_id: v.apply.program_id, line: applyAsk(v.apply.title, v.apply.amount, v.apply.when) };
  // v3.1 one-tap posts: an event's post.
  if (v.state === 'ranked' && v.post) return { kind: 'post', project_key: key, line: POST_ASK };
  if (v.state === 'ranked' && v.share) return { kind: 'share', project_key: key, line: MOMENT_ASK };
  // GTM W2: the Monday check-in, once, on a client that can schedule (before the optional wallet step).
  if (v.state === 'ranked' && v.checkin) return { kind: 'checkin', project_key: key, line: CHECKIN_ASK };
  // v3.1 wallet proof: the optional wallet step, once, in the first reply after setup with no other question.
  if (v.state === 'ranked' && v.wallet) return { kind: 'wallet', project_key: key, line: walletOffer(v.wallet) };
  // v4.2 Task 6: the one-time token offer for an earlier builder (a wallet, no token row), before the lighter nudges.
  if (v.state === 'ranked' && v.tokenOffer) return { kind: 'token', project_key: null, line: TOKEN_OFFER };
  // 2026-10-23: a main project quiet for STALE_WEEKS: one light nudge to connect the new one.
  if (v.state === 'ranked' && v.newRepo) return { kind: 'new_repo', project_key: key, line: NEW_REPO_ASK };
  // 2026-10-22: a private repo's titles question (once), then Base's grant steps for a builder with no fit, else the ship step.
  if (v.state === 'ranked' && v.titles) return { kind: 'titles', project_key: key, line: TITLES_ASK };
  if (v.state === 'ranked' && v.qualify)
    return { kind: 'qualify', project_key: key, program_id: v.qualify.program_id, line: qualifyAsk(v.qualify.grant, v.qualify.steps, name, v.hosted === true) };
  // GTM W2: the ship question at most once in SHIP_ASK_DAYS; between, the quiet reply asks nothing.
  if (v.state === 'ranked') return v.shipAsked ? { kind: 'none', project_key: key, line: '' } : { kind: 'ship', project_key: key, line: SHIP_ASK };
  if (v.variant === 'taken' || v.variant === 'copy') return { kind: 'other_project', project_key: key, line: VARIANT_COPY[v.variant].ask() };
  if (v.variant === 'no_repo') return { kind: 'repo_behind', project_key: key, line: VARIANT_COPY.no_repo.ask(name) };
  if (v.variant === 'app_off' || !v.link) return { kind: 'suggest', project_key: key, line: VARIANT_COPY.app_off.ask(name) };
  // GTM W2: past setup (another repo connected), switching repos is one install for this repo, never step 2 again.
  if (v.appDone && key) return { kind: 'install_app', project_key: key, line: installMoreAsk(v.link) };
  return { kind: 'install_app', project_key: key, line: STATE_COPY.not_counted.ask(v.link, v.noGithub === true) };
}

/**
 * Ranked: the money line: the Best fit, else the first fit, else the upcoming program.
 */
function moneyLine(v: BenchView, o: { upcoming: boolean } = { upcoming: true }): string | null {
  const fit = v.best ?? v.fund.find((f): f is Extract<FundLine, { kind: 'fits' }> => f.kind === 'fits');
  if (fit) return qualifyLine(fit);
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
  // v4.0 approved copy 1: the head line, what EarnKit does (with the open grant), then the three steps.
  if (v.state === 'signed_out') return paras([INTRO_LINE], [introWhat(v.open ?? null)], [v.ask.line]);
  // v4.0 Task 5: the first reply after setup step 3 settled (benchView claims it once).
  if (v.setupDone) return v.setupDone;
  const step2 = !v.held && isStep2(v.ask);
  // v3.1 answerable replies (spec 6): after today's full pitch, the step is the link and its question alone.
  const again = step2 && v.pitched === true && v.link !== null;
  const ask = again ? pickRepoAgain(v.link!, v.noGithub === true) : (v.held ?? v.ask.line);
  const named = namesAccount(v);
  const notice = v.notice ?? null;
  // GTM W2 (2026-10-23, value before the ask): step 2 names the open grant ("Base pays up to $5,000 for apps on Base.")
  // before the GitHub step; a statement with no link, so the step keeps the reply's one link and one question.
  // v4.0 approved copy 2: the welcome reply is the welcome and the step alone (the intro already named the grant).
  const money = step2 && !again && v.open && !named ? grantHook(v.open) : null;
  // v4.0 approved copy 2: the welcome is its own paragraph above the step.
  const hi = [named ? youreIn(v.handle!) : null];
  // v4.0 approved copy 3: step 3 is its own reply, word for word, in any state.
  if (!v.held && v.ask.kind === 'wallet_setup' && v.state !== 'ranked') return paras(hi, [notice, ask]);
  if (v.state === 'no_project') return paras(hi, [notice, money, ...v.due, ask]);
  if (v.state === 'not_counted') {
    if (step2 && !v.variant) return paras(hi, [notice, money, ...v.due, ask]);
    // GTM W2: a link-only project's step 2 (Lovable, Bolt) names the account too.
    return paras(hi, [v.variant ? VARIANT_COPY[v.variant].stand(name) : STATE_COPY.not_counted.stand(name), notice, money, ...v.due, ask]);
  }
  // v4.0 Task 8: the week's nudge leads the ranked reply.
  const lead = [v.state === 'ranked' ? v.nudge : null, notice].filter((l): l is string => Boolean(l));
  // Fix round 1 (ruling 2): a nudge that asks is the reply's one question; the standing only when it changed.
  if (v.state === 'ranked' && v.nudge && v.nudgeOwns && !v.held)
    // v4.3 Task 2 fix round 1 (R3): the nudge's question leads, so no table (the question stays the one ask).
    return paras(...lead.map((l) => [l]), [v.standingShown === false || v.standingLed ? null : standingLine(name, v.rank, v.streak, v.earned ?? 0), ...v.due]);
  return lead.length > 0 ? paras(...lead.map((l) => [l])) + '\n\n' + rankedReply(v, name, ask) : rankedReply(v, name, ask);
}

/**
 * v3.1 GTM W3: whether a ranked reply carries the money line with the upcoming program in it (rankedReply's last
 * branch, no qualify steps), so the upcoming line is claimed only when it is really said. Pure.
 */
export function upcomingShown(v: Pick<BenchView, 'held' | 'ask' | 'connect' | 'moment' | 'handle' | 'post' | 'qualify' | 'nudgeOwns'>): boolean {
  if (v.held) return true;
  if (v.nudgeOwns) return false;
  if (v.ask.kind === 'connect' && v.connect) return false;
  if (v.ask.kind === 'share' && v.moment && v.handle) return false;
  if (v.ask.kind === 'post' && v.post) return false;
  if (v.ask.kind === 'apply' || v.ask.kind === 'wallet' || v.ask.kind === 'wallet_setup' || v.ask.kind === 'token' || v.ask.kind === 'new_repo') return false;
  return !(v.ask.kind === 'qualify' && v.qualify);
}

/** v4.2: the ship step's plain line (no points): the weekly target ("Ship code this week to hold #1."), else "Ship code this week." Pure. */
export const shipLine = (target: string | null) => (target?.startsWith('Ship code this week') ? target : 'Ship code this week.');

/**
 * v4.3 Task 2: the full program table right before the reply's question (its last line, `ask`); with no question
 * there, after everything else. Pure.
 */
function withTable(reply: string, table: string | null | undefined, ask: string): string {
  if (!table) return reply;
  if (ask && reply.endsWith(ask)) {
    const head = reply.slice(0, reply.length - ask.length).replace(/\n+$/, '');
    return head ? `${head}\n\n${table}\n\n${ask}` : `${table}\n\n${ask}`;
  }
  return reply ? `${reply}\n\n${table}` : table;
}

/** The ranked state's reply (benchReply); with the full list (fullTable), the table before the question. Pure. */
function rankedReply(v: BenchView, name: string, ask: string): string {
  // The qualify reply carries the table in place of "Also open" (rankedBody); fix round 1 (R3): step 3 stays word for word.
  if (!v.held && ((v.ask.kind === 'qualify' && v.qualify) || v.ask.kind === 'wallet_setup')) return rankedBody(v, name, ask);
  return withTable(rankedBody(v, name, ask), v.fullTable, ask);
}

function rankedBody(v: BenchView, name: string, ask: string): string {
  if (!v.held && v.ask.kind === 'connect' && v.connect)
    return paras(
      // v4.7 T2: the score reply's standing paragraph already said the rank and the weeks.
      [v.standingLed ? null : connectStanding(name, v.rank, v.streak), v.best ? qualifyLine(v.best) : null, ...v.due],
      [ask],
    );
  if (!v.held && v.ask.kind === 'share' && v.moment && v.handle)
    // v4.0 Task 7: the Monday block; last week's post link, else the page (the reply's one https link).
    return mondayReply(v.moment, `https://${pageUrl(v.handle)}`, ask, SHARE_WHY);
  if (!v.held && v.ask.kind === 'post' && v.post) return postReply(v.post, ask, POST_WHY);
  // v4.0 approved copy 3: setup step 3 is its own reply, word for word.
  if (!v.held && v.ask.kind === 'wallet_setup') return ask;
  const full = standingLine(name, v.rank, v.streak, v.earned ?? 0);
  // v3.1 cold read: the standing only when it changed since the builder last saw it, the points line at most once a week.
  // v4.7 T2: the score reply's standing paragraph leads (benchScore), so it says no standing line of its own.
  const standing = v.standingShown === false || v.standingLed ? null : full;
  const nag = v.nagShown !== false;
  const ship = shipLine(v.target);
  // A reply with nothing else to say still says where the builder stands (never an empty reply); the ship line alone is no reply either.
  const orStanding = (lines: (string | null | undefined)[]) => (v.standingLed || lines.some((l) => l && l !== ship) ? lines : [full, ...lines.filter((l) => l !== full)]);
  // v4.7 T3 (money first): the apply reply is the money alone: the deadlines, then the fit's amount, deadline and the
  // one step (applyAsk); no standing or ship line in front of it (the standing fact still carries where they stand).
  if (!v.held && v.ask.kind === 'apply') return paras([...v.due, ask]);
  // v3.1 wallet proof: the standing, then the step; no money line (the step's link is the reply's one link) and no points.
  // 2026-10-23: the new-repo nudge, the same way (a light nudge, nothing else).
  if (!v.held && (v.ask.kind === 'wallet' || v.ask.kind === 'token' || v.ask.kind === 'new_repo')) return paras(orStanding([standing, ...v.due, ask]));
  // v4.3 (owner-approved): no fit, so Base's grant carries the money: the head (program, amount, when) and the one gap,
  // up to two other open grants, then the one question. No ship line and no money line; the standing (once shown) above.
  if (!v.held && v.ask.kind === 'qualify' && v.qualify)
    return paras([standing, ...v.due], [`${qualifyHead(v.qualify)} ${qualifyGap(name, v.qualify)}`], [v.fullTable ?? alsoLine(v.also ?? [])], [ask]);
  // v4.7 T4: the ship ask's why line replaces the weekly ship line; fix round 0 (R14): on every ship ask (already at
  // most once in SHIP_ASK_DAYS), and (R13) the weekly rank target is that why when there is one. The quiet reply keeps
  // the ship line. The check-in's why always shows. Each is its own paragraph before the question.
  const target = nag && !v.held && v.ask.kind === 'none' ? ship : null;
  const why = v.held ? null : v.ask.kind === 'ship' ? shipWhyOf(v.target, v.streak) : v.ask.kind === 'checkin' ? CHECKIN_WHY : null;
  // The why and its question are something to say, so no standing is added for them (orStanding).
  if (why) return paras([standing, ...v.due, moneyLine(v), target], [why], [ask]);
  return paras(orStanding([standing, ...v.due, moneyLine(v), target, ask]));
}

/**
 * v4.7 T4: the why behind the reply's one question (move_up.why): the ship, check-in, share and post lines; for apply
 * and qualify, their own reason sentence (applyWhy; the qualify head and gap); an owning nudge's apply, the nudge's
 * statements. Null for the other asks. Pure.
 */
export function askWhy(v: Pick<BenchView, 'ask' | 'streak' | 'target' | 'qualify' | 'project' | 'nudge' | 'nudgeOwns'>): string | null {
  switch (v.ask.kind) {
    case 'ship': return shipWhyOf(v.target, v.streak);
    case 'checkin': return CHECKIN_WHY;
    case 'share': return SHARE_WHY;
    case 'post': return POST_WHY;
    case 'qualify': return v.qualify ? `${qualifyHead(v.qualify)} ${qualifyGap(v.project?.name ?? '', v.qualify)}` : null;
    case 'apply': {
      if (v.nudgeOwns && v.nudge) return v.nudge.replace(/\s*[^.?!]*\?\s*$/, '').trim() || null;
      const [why, ...rest] = v.ask.line.split('\n');
      return rest.length > 0 && why ? why : null;
    }
    default: return null;
  }
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
