/**
 * v2.13 spec "2a", "2b", "5. Ways to get funded", "The last line": the reply in three parts, ending
 * in at most one question. Plain words; chain names only inside a rank phrase; a funder's short
 * name and the starter's offer are names (plan B12). Pure.
 */
export const BENCH_HEADS = { stand: 'Where you stand', fund: 'Ways to get funded', up: 'How to move up' } as const;
export type BenchAskKind = 'build' | 'go_live' | 'updates' | 'post_update' | 'coin' | 'raise' | 'enter';
export type BenchAsk = { kind: BenchAskKind; project_key: string | null; line: string; program_id?: string };
export type FundLine =
  | { kind: 'fits'; title: string; prize: string; when: string }
  | { kind: 'idea'; who: string; prize: string; for: string }
  | { kind: 'rolling'; title: string; prize: string };
export type BenchProject = { key: string; name: string; confirmed: boolean; live: boolean; weeks: number };
export type BenchView = {
  project: BenchProject | null; rank: string | null; claimed: boolean; handle: string | null; claimLink: string | null;
  /**
   * v2.13.1 O1: the one project (a repo key) while it isn't confirmed: `checking` (the agent was given
   * the proof branch), `failed` (the branch never showed within the hour), `needs_agent` (fix round 1,
   * ruling c: an agent that can't push gets no code) or `taken` (another person holds the repo).
   */
  branch?: 'checking' | 'failed' | 'needs_agent' | 'taken' | null;
  /** Final fix I3: not confirmed and outside the hour of fast checks (main-project confirmingFast): no "a minute or two". */
  slow?: boolean;
  fund: FundLine[]; ask: BenchAsk | null;
  /** Money already on its way (v2.12.1 `due`: a deadline, an entry waiting on the builder's own submission). */
  due?: string[];
};

export const NO_PROJECT_LINE = "You're not on the Bench yet. Pick something to build and you're on it today.";
export const confirmingLine = (name: string) => `${name} joins the Bench as soon as I've confirmed it's yours (a minute or two).`;
/** Final fix I3: outside the hour of fast checks, no time is promised. */
export const confirmingSlowLine = (name: string) => `${name} joins the Bench once I've confirmed it's yours. I check again every day.`;
/** v2.13.1 O1: the proof branch, told to the builder in one line (no question). */
export const checkingBranchLine = (name: string) => `I'll check ${name} is yours with a quick temporary branch on GitHub. It's removed right after.`;
/** v2.13.1 O1: the branch never showed within the hour (the agent couldn't push): no loop, no proof line. */
export const cantShowLine = (name: string) => `I couldn't show ${name} is yours. Ask your agent to use a project you can push to.`;
/** v2.13.1 O1 fix round 1 (ruling c): an agent that can't push gets no proof branch. */
export const NEEDS_AGENT_LINE = 'Open this project in your coding agent to finish.';
/** v2.13.1 O1 fix round 1 (authorization ruling): the first confirmed holder keeps a repo. */
export const takenLine = (name: string) => `${name} is already on the Bench under another account.`;
export const claimToJoinLine = (name: string, link: string) => `${name} goes on the Bench once you claim your page with X: ${link}`;
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
export const rollingFundLine = (title: string, prize: string) => `${title} pays ${prize}; it's open all year.`;
export const UPDATES_ASK = 'Want me to post what you ship here every week? It keeps your streak going on the Bench.';
export const POST_UPDATE_ASK = "Want me to post this week's update?";
export const buildAsk = (offer: string) => `Want me to build ${offer} and put it online? It takes a few minutes and you won't have to do anything.`;
export const goLiveAsk = (name: string) => `Want me to put ${name} online? It takes a few minutes and you won't have to do anything.`;
export const enterAsk = (title: string) => `Want me to prepare an entry for ${title}?`;
/** The key a no keeps an ask away under (standing_seen.declined, 30 days). Pure. */
export const benchStepKey = (kind: BenchAskKind, key: string | null) => `${kind}:${key ?? '*'}`;

/**
 * spec "The last line: one question, in this order": 1. no project: the build; 2. not live and
 * EarnKit can put it online; 3. confirmed, posting not on; 4. posting on, nothing posted this week
 * and no scheduled task; 5. a coin moment; 6. the best program's entry. A no keeps that ask away
 * for 30 days (`declined`, benchStepKey). Pure.
 */
export function chooseAsk(o: {
  project: BenchProject | null; canHost: boolean; updatesOn: boolean; postedThisWeek: boolean; scheduled: boolean;
  coin: BenchAsk | null; build: BenchAsk | null; enter: BenchAsk | null; declined: string[];
}): BenchAsk | null {
  const p = o.project;
  if (!p) return o.build;
  const off = (k: BenchAskKind) => o.declined.includes(benchStepKey(k, p.key));
  if (!p.live && o.canHost && !off('go_live')) return { kind: 'go_live', project_key: p.key, line: goLiveAsk(p.name) };
  if (p.confirmed && !o.updatesOn && !off('updates')) return { kind: 'updates', project_key: p.key, line: UPDATES_ASK };
  if (p.confirmed && o.updatesOn && !o.postedThisWeek && !o.scheduled && !off('post_update')) return { kind: 'post_update', project_key: p.key, line: POST_UPDATE_ASK };
  if (o.coin) return o.coin;
  return o.enter && !off('enter') ? o.enter : null;
}

function standLines(v: BenchView): string[] {
  const p = v.project;
  if (!p) return [NO_PROJECT_LINE];
  if (!p.confirmed) {
    const first =
      v.branch === 'checking' ? checkingBranchLine(p.name)
      : v.branch === 'failed' ? cantShowLine(p.name)
      : v.branch === 'needs_agent' ? NEEDS_AGENT_LINE
      : v.branch === 'taken' ? takenLine(p.name)
      : v.slow ? confirmingSlowLine(p.name) : confirmingLine(p.name);
    return [first, ...(!v.claimed && v.claimLink ? [`Claim your page with X: ${v.claimLink}`] : [])];
  }
  if (!v.claimed) return [v.claimLink ? claimToJoinLine(p.name, v.claimLink) : CONFIRMED_LINE(p.name)];
  return [onBenchLine(p.name, v.rank, p.weeks)];
}
/** Whether the reply shows the claim link (find's `claim` field goes with it). Pure. */
export const showsClaimLink = (v: BenchView): boolean => Boolean(v.project && !v.claimed && v.claimLink);

function fundLines(v: BenchView): string[] {
  const name = v.project?.name ?? '';
  const ideas = v.fund.filter((f): f is Extract<FundLine, { kind: 'idea' }> => f.kind === 'idea');
  const rest = v.fund.flatMap((f) =>
    f.kind === 'fits' ? [fitsLine(f.title, f.prize, name, f.when)] : f.kind === 'rolling' ? [rollingFundLine(f.title, f.prize)] : []).slice(0, 3);
  return [...(v.due ?? []), ...rest, ...(ideas.length ? [ideasLine(ideas.slice(0, 2))] : [])];
}
export function benchReply(v: BenchView): string {
  const parts = [[BENCH_HEADS.stand, ...standLines(v)]];
  const fund = fundLines(v);
  if (fund.length) parts.push([BENCH_HEADS.fund, ...fund]);
  if (v.ask) parts.push([BENCH_HEADS.up, v.ask.line]);
  return parts.map((x) => x.join('\n')).join('\n\n');
}
