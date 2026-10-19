import { siteUrl } from './entry-text';
import { pagePath, pageUrl } from './reserved-routes';
import { scoreLine } from './rank';

/**
 * v2.13 spec "2a", "2b", "5. Ways to get funded", "The last line", v2.14 spec 4: the reply in three parts
 * (where you stand, ways to get funded, how to move up), one https link and exactly one question, last.
 * Plain words; chain names only inside a rank phrase; a funder's short name is a name (plan B12). Pure.
 */
export const BENCH_HEADS = { stand: 'Where you stand', fund: 'Ways to get funded', up: 'How to move up' } as const;
export type ReplyState = 'signed_out' | 'no_project' | 'not_counted' | 'proven' | 'shipping';
export type Variant = 'taken' | 'copy' | 'no_repo' | 'app_off' | null;
export type BenchAskKind = 'sign_in' | 'start' | 'install_app' | 'other_project' | 'repo_behind' | 'enter' | 'coin' | 'raise' | 'go_live' | 'suggest';
export type BenchAsk = { kind: BenchAskKind; project_key: string | null; line: string; program_id?: string };
export type FundLine =
  | { kind: 'fits'; title: string; prize: string; when: string }
  | { kind: 'idea'; who: string; prize: string; for: string }
  /** v2.13.4 (R5): `prize` null for a program with no known award (never a made-up figure). */
  | { kind: 'rolling'; title: string; prize: string | null }
  /** v2.13.3 (2): an open program and what it needs, in plain words (never a fit claimed). */
  | { kind: 'needs'; title: string; prize: string | null; needs: string };
export type BenchProject = { key: string; name: string; confirmed: boolean; live: boolean; weeks: number };

export const NOT_ON_BENCH = "You're not on the Bench yet.";
export const NO_MONEY_LINE = "No program is open right now. I'll look again next week.";
/** A13: the streak as the chips say it. */
export const streakWords = (n: number) => `${n} weeks in a row`;
/**
 * R16c: the ranked stand line is the score line: "EarnKit: Shipping 72 · #3 of 40 builders this week."
 * Before its first Shipping score (no row yet, or one from an older formula): the project is counted.
 */
export const shippingStand = (name: string, score: number | null, rank: string | null) =>
  score === null ? `${name} is counted. Its Shipping score comes with the next read.` : `${name}: ${scoreLine(score, rank)}.`;

/** `when` as stand-view earnWhen gives it: "open all year" or "closes Oct 14". */
export const fitsLine = (title: string, prize: string, name: string, when: string) =>
  `${title} pays ${prize} and fits ${name}; ${when === 'open all year' ? "it's open all year" : `it ${when}`}.`;
export const ideasLine = (ideas: { who: string; prize: string; for: string }[]) => ideas.map((i) => `${i.who} pays ${i.prize} for ${i.for}.`).join(' ');
export const rollingFundLine = (title: string, prize: string | null) => (prize ? `${title} pays ${prize}; it's open all year.` : `${title} is open all year.`);
/** v2.13.3 (2): "Base Builder Grants: up to $5K for a Base app, once it's live." */
export const needsLine = (title: string, prize: string | null, needs: string) => `${title}: ${prize ? `${prize} ` : ''}${needs}.`;
/** v2.13.1 O5 N5: one small thing to ship (the last step, never kept away). */
export const shipAsk = (name: string) => `Want me to suggest one small thing to ship in ${name} this week?`;
/** v2.13.1 O2 fix round 1 (ruling 3): another person holds the repo, or it is a copy. */
export const OTHER_PROJECT_ASK = 'Want to use a different project?';
export const goLiveAsk = (name: string) => `It takes a few minutes. Want me to put ${name} online?`;
export const enterAsk = (title: string) => `Want me to prepare an entry for ${title}?`;
/** The key a no keeps an ask away under (standing_seen.declined, 30 days). Pure. */
export const benchStepKey = (kind: BenchAskKind, key: string | null) => `${kind}:${key ?? '*'}`;

/**
 * v2.14 spec 4: the five states' copy, the only place it lives. Each state has one stand line and exactly one
 * question; the link a state carries is its question's (sign-in, install), else the page.
 */
export const STATE_COPY = {
  signed_out: {
    stand: () => NOT_ON_BENCH,
    ask: (link: string) => `Sign in with X to get your page (one click): ${link}\nWant me to put your work on the Bench once you're in?`,
    /** Fix round 1: the link couldn't be made this time (never read as signed in). */
    retry: () => "I couldn't make your sign-in link just now. Want me to try again?",
  },
  no_project: {
    stand: () => NOT_ON_BENCH,
    ask: () => "What's your GitHub, or a link to something you've made?",
  },
  not_counted: {
    stand: (name: string) => `${name} isn't counted yet.`,
    ask: (link: string) => `Install the read-only EarnKit app on it (one click): ${link}\nWant me to count it once that's done?`,
  },
  proven: { stand: (name: string, score: number | null, rank: string | null) => shippingStand(name, score, rank) },
  shipping: { stand: (name: string, score: number | null, rank: string | null, streak: number) => `${shippingStand(name, score, rank)} ${streakWords(streak)}.` },
} as const;
/** A15: not counted, when the install link can't help. */
export const VARIANT_COPY = {
  taken: { stand: (n: string) => `${n} is already on the Bench under another account.`, ask: () => OTHER_PROJECT_ASK },
  copy: { stand: (n: string) => `${n} is a copy of someone else's project. Use your own.`, ask: () => OTHER_PROJECT_ASK },
  no_repo: { stand: (n: string) => `${n} isn't counted yet.`, ask: (n: string) => `Where does ${n} live on GitHub?` },
  app_off: { stand: (n: string) => `${n} isn't counted yet.`, ask: (n: string) => shipAsk(n) },
} as const;

/** Which of the five states a reply is in. Pure. */
export function replyState(i: { signedIn: boolean; project: BenchProject | null; counted: boolean; streak: number }): ReplyState {
  if (!i.signedIn) return 'signed_out';
  if (!i.project) return 'no_project';
  if (!i.counted) return 'not_counted';
  return i.streak >= 2 ? 'shipping' : 'proven';
}

export type BenchView = {
  state: ReplyState; variant: Variant; project: BenchProject | null; rank: string | null; streak: number;
  /** Shipping (0 to 100) and its why sentence (score-v2.ts scoreWhy), shown in proven and shipping only. */
  score: number | null; why: string | null;
  /** The person's page handle (null: signed out, or no page to name, as with X off). */
  handle: string | null;
  /** The state's action link: the sign-in link (signed_out) or the install link (not_counted, no variant). */
  link: string | null;
  fund: FundLine[]; due: string[]; ask: BenchAsk;
  /** A17: an outcome question or a submission step, asked instead of the state's question. */
  held: string | null;
};

/** The fixed question of states 1 to 3 (A16; signed out with no link: the retry), or null for proven and shipping (nextStepAsk decides). Pure. */
export function stateAsk(v: Pick<BenchView, 'state' | 'variant' | 'project' | 'link'>): BenchAsk | null {
  const key = v.project?.key ?? null;
  const name = v.project?.name ?? '';
  if (v.state === 'signed_out') return { kind: 'sign_in', project_key: null, line: v.link ? STATE_COPY.signed_out.ask(v.link) : STATE_COPY.signed_out.retry() };
  if (v.state === 'no_project') return { kind: 'start', project_key: null, line: STATE_COPY.no_project.ask() };
  if (v.state !== 'not_counted') return null;
  if (v.variant === 'taken' || v.variant === 'copy') return { kind: 'other_project', project_key: key, line: VARIANT_COPY[v.variant].ask() };
  if (v.variant === 'no_repo') return { kind: 'repo_behind', project_key: key, line: VARIANT_COPY.no_repo.ask(name) };
  if (v.variant === 'app_off' || !v.link) return { kind: 'suggest', project_key: key, line: VARIANT_COPY.app_off.ask(name) };
  return { kind: 'install_app', project_key: key, line: STATE_COPY.not_counted.ask(v.link) };
}

/** Proven and shipping: the best fit's entry, else a community round, else going live, else one small thing (A16). Pure. */
export function nextStepAsk(o: { project: BenchProject; enter: BenchAsk | null; coin: BenchAsk | null; canHost: boolean; declined: string[] }): BenchAsk {
  const off = (k: BenchAskKind) => o.declined.includes(benchStepKey(k, o.project.key));
  if (o.enter && !off('enter')) return o.enter;
  if (o.coin) return o.coin;
  if (!o.project.live && o.canHost && !off('go_live')) return { kind: 'go_live', project_key: o.project.key, line: goLiveAsk(o.project.name) };
  return { kind: 'suggest', project_key: o.project.key, line: shipAsk(o.project.name) };
}

function standLine(v: BenchView): string {
  const name = v.project?.name ?? '';
  if (v.state === 'not_counted' && v.variant) return VARIANT_COPY[v.variant].stand(name);
  if (v.state === 'signed_out' || v.state === 'no_project') return NOT_ON_BENCH;
  if (v.state === 'not_counted') return STATE_COPY.not_counted.stand(name);
  return v.state === 'shipping' ? STATE_COPY.shipping.stand(name, v.score, v.rank, v.streak) : STATE_COPY.proven.stand(name, v.score, v.rank);
}
function fundLines(v: BenchView): string[] {
  const name = v.project?.name ?? '';
  const ideas = v.fund.filter((f): f is Extract<FundLine, { kind: 'idea' }> => f.kind === 'idea');
  const rest = v.fund.flatMap((f) =>
    f.kind === 'fits' ? [fitsLine(f.title, f.prize, name, f.when)] : f.kind === 'rolling' ? [rollingFundLine(f.title, f.prize)] : []).slice(0, 3);
  // v2.13.3 (2): what each other open program needs comes last (the programs that fit, and the ideas, first).
  const needs = v.fund.flatMap((f) => (f.kind === 'needs' ? [needsLine(f.title, f.prize, f.needs)] : [])).slice(0, 3);
  return [...v.due, ...rest, ...(ideas.length ? [ideasLine(ideas.slice(0, 2))] : []), ...needs];
}
export function benchReply(v: BenchView): string {
  // A14: one https link a reply. Beside the state's action link the page is named without https; a held
  // question (A17) carries no link, so the page is then the link.
  const linked = Boolean(v.link) && (!v.held || v.state === 'signed_out');
  const page = v.handle ? `Your page: ${linked && v.state !== 'signed_out' ? pageUrl(v.handle) : `${siteUrl()}${pagePath(v.handle)}`}` : null;
  // The why sentence sits under the ranked stand line: a statement, never a second question.
  const why = (v.state === 'proven' || v.state === 'shipping') && v.why ? [v.why] : [];
  const stand = [BENCH_HEADS.stand, standLine(v), ...why, ...(page && v.state !== 'signed_out' ? [page] : [])];
  const fund = fundLines(v);
  const money = [BENCH_HEADS.fund, ...(fund.length ? fund : [NO_MONEY_LINE])];
  // Fix round 1 (ruling 4): signed out, the sign-in question always wins.
  const up = [BENCH_HEADS.up, v.state === 'signed_out' ? v.ask.line : (v.held ?? v.ask.line)];
  return [stand, money, up].map((x) => x.join('\n')).join('\n\n');
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
