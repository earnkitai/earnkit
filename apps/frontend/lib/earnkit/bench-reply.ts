import { pageUrl } from './reserved-routes';

/**
 * v2.13 spec "2a", "2b", "5. Ways to get funded", "The last line": the reply in three parts, ending
 * in at most one question. Plain words; chain names only inside a rank phrase; a funder's short
 * name and the starter's offer are names (plan B12). Pure.
 */
export const BENCH_HEADS = { stand: 'Where you stand', fund: 'Ways to get funded', up: 'How to move up' } as const;
export type BenchAskKind = 'build' | 'go_live' | 'updates' | 'post_update' | 'coin' | 'raise' | 'enter' | 'grants' | 'suggest' | 'other_project' | 'grants_later' | 'install_app' | 'start' | 'claim';
export type BenchAsk = { kind: BenchAskKind; project_key: string | null; line: string; program_id?: string };
export type FundLine =
  | { kind: 'fits'; title: string; prize: string; when: string }
  | { kind: 'idea'; who: string; prize: string; for: string }
  /** v2.13.4 (R5): `prize` null for a program with no known award (never a made-up figure). */
  | { kind: 'rolling'; title: string; prize: string | null }
  /** v2.13.3 (2): an open program and what it needs, in plain words (never a fit claimed). */
  | { kind: 'needs'; title: string; prize: string | null; needs: string };
export type BenchProject = { key: string; name: string; confirmed: boolean; live: boolean; weeks: number };
export type BenchView = {
  project: BenchProject | null; rank: string | null; claimed: boolean; handle: string | null; claimLink: string | null;
  /**
   * v2.13.1 O1: the one project (a repo key) while it isn't confirmed: `checking` (the agent was given
   * the proof branch), `failed` (the branch never showed within the hour, the agent said the push was
   * refused, or EarnKit can't read the repo: O5 N2), `needs_agent` (fix round 1, ruling c: an agent that
   * can't push gets no code), `taken` (another person holds the repo) or `foreign` (O5 N2: a User's repo
   * whose owner isn't the login the agent reported, so no push of theirs can prove it); O5 fix round 1:
   * `copy` (a fork or a template) or `unseen` (EarnKit's token can't read it: 404). v2.13.2 (1): `recheck`
   * (checking, after an org repo's proof expired). v2.13.3 (5): `private` (unseen, and the read-only GitHub
   * App is on: the install ask replaces the different-project one).
   */
  branch?: 'checking' | 'recheck' | 'failed' | 'needs_agent' | 'taken' | 'foreign' | 'copy' | 'unseen' | 'private' | null;
  /** Final fix I3: not confirmed and outside the hour of fast checks (main-project confirmingFast): no "a minute or two". */
  slow?: boolean;
  fund: FundLine[]; ask: BenchAsk | null;
  /**
   * v2.13.1 O2 (B4): a build is in progress for this person: the stand line is only "Building <name>. I'll
   * be back with the live link." (no ways to get funded, no ask).
   */
  building?: string | null;
  /** v2.13.1 O2: the claimed person's page, a full https URL ("Your page: ..." after the stand line). */
  page?: string | null;
  /** Money already on its way (v2.12.1 `due`: a deadline, an entry waiting on the builder's own submission). */
  due?: string[];
  /** v2.13.4 (R1): this agent just joined the page from the claim page: "Linked to your page: ..." once. */
  linked?: boolean;
};

/** v2.13.3 (3): no project: the stand line, with or without a build to offer (the ask leads with existing work). */
export const NO_PROJECT_LINE = "You're not on the Bench yet.";
export const NO_OFFER_LINE = NO_PROJECT_LINE;
/**
 * v2.13.3 (3) and owner ruling A (2026-10-17): no project: existing work first, and money it can win.
 * Never the generic tip jar: a build is offered only for a specific open program whose starter can
 * compete (startBuildAsk); otherwise this line is the last line.
 */
export const START_ASK = "I'll put your work on the Bench and find money it can win. What's your GitHub, or a link to something you've made?";
/** Ruling A: the build, aimed at one open program (its owner-set starter), inside the same one question. */
export const startBuildAsk = (offer: string, program: string) =>
  `I'll put your work on the Bench and find money it can win. What's your GitHub, a link to something you've made, or should I build ${offer} for ${program}?`;
/** v2.13.3 (4): the X claim, a line (v2.13.4: only beside a build in progress, which asks nothing). */
export const claimLine = (link: string) => `Your page: claim it with X at ${link}`;
/**
 * v2.13.4 (spec 2, R4): the first find asks for X once, as the only question: the claim link, then one
 * yes or no. `name`: the project the claim puts on the Bench (null: none, or one that can't join).
 */
export const claimAskLine = (link: string) => `Claim your page with X (it's your name and photo on the Bench): ${link}`;
export const claimQuestion = (name: string | null) =>
  name ? `Want me to put ${name} on the Bench once that's done?` : "Want me to find money you can win once that's done?";
export const claimAsk = (link: string, name: string | null) => `${claimAskLine(link)}\n${claimQuestion(name)}`;
/** v2.13.4 (R1): the first reply after this agent joined the page from the claim page. */
export const linkedLine = (page: string) => `Linked to your page: ${page}`;
/** v2.13.1 O2 (B4): a build is in progress: the whole stand part, no ask. */
export const buildingNowLine = (name: string) => `Building ${name}. I'll be back with the live link.`;
/** v2.13.1 O2: once claimed, the page link after the stand line. */
export const pageLine = (url: string) => `Your page: ${url}`;
export const confirmingLine = (name: string) => `${name} joins the Bench as soon as I've confirmed it's yours (a minute or two).`;
/** Final fix I3: outside the hour of fast checks, no time is promised. */
export const confirmingSlowLine = (name: string) => `${name} joins the Bench once I've confirmed it's yours. I check again every day.`;
/** v2.13.1 O1: the proof branch, told to the builder in one line (no question). */
export const checkingBranchLine = (name: string) => `I'll check ${name} is yours with a quick temporary branch on GitHub. It's removed right after.`;
/** v2.13.2 (1): an org repo's proof expired after 90 days; a fresh branch is checking (no question). */
export const stillYoursLine = (name: string) => `Time to show ${name} is still yours: I'll check with a quick temporary branch on GitHub.`;
/** v2.13.1 O1: the branch never showed within the hour (the agent couldn't push): no loop, no proof line. O5 N8: the agent's own voice. */
export const cantShowLine = (name: string) => `I couldn't show ${name} is yours. It needs a project you can push to.`;
/** v2.13.1 O5 N2: a User's repo under another GitHub account than the one the agent reported. */
export const foreignLine = (name: string) => `${name} is under someone else's GitHub account.`;
/** v2.13.1 O5 fix round 1 (ruling): a fork or a template is never the builder's own work. */
export const copyLine = (name: string) => `${name} is a copy of another repo. Use your own project.`;
/**
 * v2.13.1 O5 fix round 1: GitHub answers 404 to EarnKit (often the builder's own private repo), so no push can help.
 * v2.13.3 (5): with the read-only GitHub App off, said honestly in one line.
 */
export const cantSeeLine = (name: string) => `I can't see ${name}. EarnKit can only see public repos right now.`;
/**
 * v2.13.4 (spec 3): the App is on and EarnKit can't read the repo (private, or an org's): said with the
 * project's display name, never "EarnKit can't see earnkit".
 */
export const privateLine = (name: string) => `${name} is private, so I can't count it yet.`;
/**
 * v2.13.4 (spec 3, R4): the install link (the App proof link: sign-in hop, then install) in one line, the
 * reply's one link, then the one yes or no, last.
 */
export const installAppAsk = (name: string, link: string) =>
  `${privateLine(name)} Install the read-only EarnKit app on it (one click): ${link}\nWant me to count it once that's done?`;
/** v2.13.1 O1 fix round 1 (ruling c): an agent that can't push gets no proof branch. O5 N15: names the project and why. */
export const needsAgentLine = (name: string) => `Open ${name} in your coding agent to put it on the Bench.`;
/** v2.13.1 O1 fix round 1 (authorization ruling): the first confirmed holder keeps a repo. */
export const takenLine = (name: string) => `${name} is already on the Bench under another account.`;
export const CONFIRMED_LINE = (name: string) => `${name} is confirmed as yours.`;
export function onBenchLine(name: string, rank: string | null, weeks: number): string {
  const w = weeks > 0 ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'} shipping` : null;
  if (rank && w) return `${name} is on the Bench: ${rank}, ${w}.`;
  if (rank) return `${name} is on the Bench: ${rank}.`;
  return w ? `${name} is on the Bench, ${w}.` : `${name} is on the Bench.`;
}
/** `when` as stand-view earnWhen gives it: "open all year" or "closes Oct 14". */
export const fitsLine = (title: string, prize: string, name: string, when: string) =>
  `${title} pays ${prize} and fits ${name}; ${when === 'open all year' ? "it's open all year" : `it ${when}`}.`;
export const ideasLine = (ideas: { who: string; prize: string; for: string }[]) => ideas.map((i) => `${i.who} pays ${i.prize} for ${i.for}.`).join(' ');
export const rollingFundLine = (title: string, prize: string | null) => (prize ? `${title} pays ${prize}; it's open all year.` : `${title} is open all year.`);
/** v2.13.3 (2): "Base Builder Grants: up to $5K for a Base app, once it's live." */
export const needsLine = (title: string, prize: string | null, needs: string) => `${title}: ${prize ? `${prize} ` : ''}${needs}.`;
/** v2.13.4 (R4): the one question is the last thing said. */
export const UPDATES_ASK = 'Want me to post what you ship here every week, to keep your streak going on the Bench?';
export const POST_UPDATE_ASK = "Want me to post this week's update?";
/** v2.13.1 O2 fix round 1: the updates yes before the project is confirmed (it isn't on the Bench yet). */
export const UPDATES_ASK_JOINING = 'Want me to post what you ship here every week?';
/** v2.13.1 O2 fix round 1 (ruling 3): a confirmed project with nothing pending and updates off. */
export const grantsAsk = (name: string) => `Want me to find grants that fit ${name}?`;
/** v2.13.1 O5 fix round 2: the last fallback after a grants yes that found nothing (its yes keeps grants quiet a week). */
export const GRANTS_LATER_ASK = 'Want me to check again for grants next week?';
/** v2.13.1 O5 N5: a project with nothing pending once grants found none (or were declined): one small thing to ship. */
export const shipAsk = (name: string) => `Want me to suggest one small thing to ship in ${name} this week?`;
/** v2.13.1 O2 fix round 1 (ruling 3): no project and nothing EarnKit can build here. */
export const SUGGEST_ASK = 'Want me to suggest something small you could build this week?';
/** v2.13.1 O2 fix round 1 (ruling 3): the branch never showed, or another person holds the repo. */
export const OTHER_PROJECT_ASK = 'Want to use a different project?';
/** v2.13.1 O2 (honest build copy): the build then asks a twist and a wallet, so never "you won't have to do anything". */
export const buildAsk = (offer: string) => `It takes a few minutes and I'll ask you one or two things. Want me to build ${offer} and put it online?`;
/** v2.13.1 O2 (B1): the starter build with no program attached ("a tip jar", no chain). */
export const benchBuildAsk = (offer: string) => `Want me to build ${offer} and put it online, so you're on the Bench today?`;
export const goLiveAsk = (name: string) => `It takes a few minutes. Want me to put ${name} online?`;
export const enterAsk = (title: string) => `Want me to prepare an entry for ${title}?`;
/** The key a no keeps an ask away under (standing_seen.declined, 30 days). Pure. */
export const benchStepKey = (kind: BenchAskKind, key: string | null) => `${kind}:${key ?? '*'}`;

/**
 * spec "The last line: one question, in this order": 1. no project: the build; 2. not live and
 * EarnKit can put it online; 3. confirmed, posting not on; 4. posting on, nothing posted this week
 * and no scheduled task; 5. a coin moment; 6. the best program's entry. A no keeps that ask away
 * for 30 days (`declined`, benchStepKey). v2.13.1 O2: the updates yes is also the next step while the
 * project is joining (`joining`), without "on the Bench". Fix round 1 (ruling 3), every reply ends on one
 * question: no project and nothing to build, the suggestion; a project that can't join (`other`), a
 * different project; nothing pending, the week's update (posting on, not yet posted this week) or
 * grants that fit. Pure.
 */
export function chooseAsk(o: {
  project: BenchProject | null; canHost: boolean; updatesOn: boolean; postedThisWeek: boolean; scheduled: boolean;
  coin: BenchAsk | null; build: BenchAsk | null; enter: BenchAsk | null; declined: string[]; joining?: boolean;
  /** O2 fix round 1: the project can't join (its branch never showed, or another person holds it). */
  other?: boolean;
  /** O2 fix round 1: false leaves out the last fallback (the coin step asks first whether anything earlier applies). */
  fallback?: boolean;
  /** O5 N13: claimed with X (absent: claimed). Until then the updates yes never says "on the Bench". */
  claimed?: boolean;
}): BenchAsk | null {
  const p = o.project;
  if (!p) {
    // v2.13.3 (3), ruling A: the build (only for a program its starter can compete in), else existing work.
    if (o.build) return o.build;
    return o.declined.includes(benchStepKey('start', null)) ? null : { kind: 'start', project_key: null, line: START_ASK };
  }
  const off = (k: BenchAskKind) => o.declined.includes(benchStepKey(k, p.key));
  if (o.other && !p.confirmed) return off('other_project') ? null : { kind: 'other_project', project_key: p.key, line: OTHER_PROJECT_ASK };
  // Owner ruling A (v2.13.3): a project is tied to something it can win: the best-fitting program's entry,
  // else a community round (the coin, once the project is confirmed); only then the Bench's own steps.
  if (o.enter && !off('enter')) return o.enter;
  if (o.coin) return o.coin;
  if (!p.live && o.canHost && !off('go_live')) return { kind: 'go_live', project_key: p.key, line: goLiveAsk(p.name) };
  if ((p.confirmed || o.joining) && !o.updatesOn && !off('updates'))
    return { kind: 'updates', project_key: p.key, line: p.confirmed && o.claimed !== false ? UPDATES_ASK : UPDATES_ASK_JOINING };
  if (p.confirmed && o.updatesOn && !o.postedThisWeek && !o.scheduled && !off('post_update')) return { kind: 'post_update', project_key: p.key, line: POST_UPDATE_ASK };
  // O2 fix round 1 (ruling 3): nothing pending: the week's update when posting is on, else grants that fit.
  // v2.13.1 O3: never offer this week's update once it is posted (a second post replaces it).
  if (o.fallback === false) return null;
  if (p.confirmed && o.updatesOn && !o.postedThisWeek && !off('post_update')) return { kind: 'post_update', project_key: p.key, line: POST_UPDATE_ASK };
  if (!off('grants')) return { kind: 'grants', project_key: p.key, line: grantsAsk(p.name) };
  // O5 N5: grants found none lately (or were declined): one small thing to ship this week.
  return off('suggest') ? null : { kind: 'suggest', project_key: p.key, line: shipAsk(p.name) };
}

function standLines(v: BenchView): string[] {
  // v2.13.4 (spec 2): the X claim is the reply's one question (the ask), never a line beside another ask.
  const claim = v.building && !v.claimed && v.claimLink ? [claimLine(v.claimLink)] : [];
  // v2.13.4 (spec 2, R4): once claimed, "Your page: ..." (or, right after a join, "Linked to your page: ...").
  // One link a reply: beside the install ask's link the page is named without https (earnkit.com/<handle>).
  const shown = v.ask?.kind === 'install_app' && v.handle ? pageUrl(v.handle) : v.page;
  const page = v.claimed && v.handle && shown ? [v.linked ? linkedLine(shown) : pageLine(shown)] : [];
  if (v.building) return [buildingNowLine(v.building), ...claim, ...page];
  const p = v.project;
  if (!p) return [NO_PROJECT_LINE, ...page];
  // v2.13.4 (spec 3): the install ask says the project is private itself.
  if (v.ask?.kind === 'install_app' && page.length) return page;
  if (!p.confirmed) {
    const first =
      v.branch === 'checking' ? checkingBranchLine(p.name)
      : v.branch === 'recheck' ? stillYoursLine(p.name)
      : v.branch === 'failed' ? cantShowLine(p.name)
      : v.branch === 'needs_agent' ? needsAgentLine(p.name)
      : v.branch === 'taken' ? takenLine(p.name)
      : v.branch === 'foreign' ? foreignLine(p.name)
      : v.branch === 'copy' ? copyLine(p.name)
      : v.branch === 'unseen' ? cantSeeLine(p.name)
      : v.branch === 'private' ? privateLine(p.name)
      : v.slow ? confirmingSlowLine(p.name) : confirmingLine(p.name);
    return [first, ...page];
  }
  if (!v.claimed) return [CONFIRMED_LINE(p.name)];
  return [onBenchLine(p.name, v.rank, p.weeks), ...page];
}
/**
 * Whether the reply shows the claim link (find's `claim` field goes with it). v2.13.4: only as the claim
 * ask (or beside a build in progress). Pure.
 */
export const showsClaimLink = (v: BenchView): boolean => Boolean(!v.claimed && v.claimLink && (v.ask?.kind === 'claim' || v.building));

function fundLines(v: BenchView): string[] {
  const name = v.project?.name ?? '';
  const ideas = v.fund.filter((f): f is Extract<FundLine, { kind: 'idea' }> => f.kind === 'idea');
  const rest = v.fund.flatMap((f) =>
    f.kind === 'fits' ? [fitsLine(f.title, f.prize, name, f.when)] : f.kind === 'rolling' ? [rollingFundLine(f.title, f.prize)] : []).slice(0, 3);
  // v2.13.3 (2): what each other open program needs comes last (the programs that fit, and the ideas, first).
  const needs = v.fund.flatMap((f) => (f.kind === 'needs' ? [needsLine(f.title, f.prize, f.needs)] : [])).slice(0, 3);
  return [...(v.due ?? []), ...rest, ...(ideas.length ? [ideasLine(ideas.slice(0, 2))] : []), ...needs];
}
export function benchReply(v: BenchView): string {
  const parts = [[BENCH_HEADS.stand, ...standLines(v)]];
  if (v.building) return parts[0].join('\n');
  const fund = fundLines(v);
  if (fund.length) parts.push([BENCH_HEADS.fund, ...fund]);
  if (v.ask) parts.push([BENCH_HEADS.up, v.ask.line]);
  return parts.map((x) => x.join('\n')).join('\n\n');
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
