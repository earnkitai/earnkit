import { pageUrl } from './reserved-routes';

/**
 * v2.13 spec "2a", "2b", "5. Ways to get funded", "The last line": the reply in three parts, ending
 * in at most one question. Plain words; chain names only inside a rank phrase; a funder's short
 * name and the starter's offer are names (plan B12). Pure.
 */
export const BENCH_HEADS = { stand: 'Where you stand', fund: 'Ways to get funded', up: 'How to move up' } as const;
export type BenchAskKind = 'build' | 'go_live' | 'coin' | 'raise' | 'enter' | 'grants' | 'suggest' | 'other_project' | 'grants_later' | 'install_app' | 'start';
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
  project: BenchProject | null; rank: string | null; claimed: boolean; handle: string | null;
  /**
   * v2.14 spec 2: the one project (a repo key) while it isn't confirmed: `private` (not proven yet: the read-only
   * App's install is the ask), `taken` (another person holds the repo) or `copy` (a fork or a template). Null:
   * nothing to say about its proof. T9 rewrites these into the five states.
   */
  branch?: 'taken' | 'copy' | 'private' | null;
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
};

/** v2.13.3 (3): no project: the stand line, with or without a build to offer (the ask leads with existing work). */
export const NO_PROJECT_LINE = "You're not on the Bench yet.";
export const NO_OFFER_LINE = NO_PROJECT_LINE;
/**
 * v2.13.3 (3) and owner ruling A (2026-10-17): no project: existing work first, and money it can win.
 * v2.14 A18: find offers no build, so this line is the last line.
 */
export const START_ASK = "I'll put your work on the Bench and find money it can win. What's your GitHub, or a link to something you've made?";
/** v2.13.1 O2 (B4): a build is in progress: the whole stand part, no ask. */
export const buildingNowLine = (name: string) => `Building ${name}. I'll be back with the live link.`;
/** v2.13.1 O2: once claimed, the page link after the stand line. */
export const pageLine = (url: string) => `Your page: ${url}`;
/** v2.13.1 O5 fix round 1 (ruling): a fork or a template is never the builder's own work. */
export const copyLine = (name: string) => `${name} is a copy of another repo. Use your own project.`;
/**
 * v2.13.4 (spec 3), v2.14 spec 2: the repo isn't proven yet (public or private: the App is the only proof), said
 * with the project's display name, never "EarnKit can't see earnkit".
 */
export const privateLine = (name: string) => `${name} isn't counted yet.`;
/**
 * v2.13.4 (spec 3, R4): the install link (the App proof link: sign-in hop, then install) in one line, the
 * reply's one link, then the one yes or no, last.
 */
export const installAppAsk = (name: string, link: string) =>
  `${privateLine(name)} Install the read-only EarnKit app on it (one click): ${link}\nWant me to count it once that's done?`;
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
/** v2.13.1 O2 fix round 1 (ruling 3): a confirmed project with nothing pending. */
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
 * spec "The last line: one question, in this order": 1. no project: existing work (v2.14 A18: never a build); 2. the best
 * program's entry; 3. a coin moment; 4. not live and EarnKit can put it online. A no keeps that ask away
 * for 30 days (`declined`, benchStepKey). v2.14 spec 3: the ship log writes itself, so there is no posting
 * yes and no week's-post ask. Fix round 1 (ruling 3), every reply ends on one question: no project and
 * nothing to build, the suggestion; a project that can't join (`other`), a different project; nothing
 * pending, grants that fit. Pure.
 */
export function chooseAsk(o: {
  project: BenchProject | null; canHost: boolean;
  coin: BenchAsk | null; enter: BenchAsk | null; declined: string[];
  /** O2 fix round 1: the project can't join (its branch never showed, or another person holds it). */
  other?: boolean;
  /** O2 fix round 1: false leaves out the last fallback (the coin step asks first whether anything earlier applies). */
  fallback?: boolean;
}): BenchAsk | null {
  const p = o.project;
  if (!p) {
    // v2.13.3 (3), ruling A: existing work (v2.14 A18: find offers no build).
    return o.declined.includes(benchStepKey('start', null)) ? null : { kind: 'start', project_key: null, line: START_ASK };
  }
  const off = (k: BenchAskKind) => o.declined.includes(benchStepKey(k, p.key));
  if (o.other && !p.confirmed) return off('other_project') ? null : { kind: 'other_project', project_key: p.key, line: OTHER_PROJECT_ASK };
  // Owner ruling A (v2.13.3): a project is tied to something it can win: the best-fitting program's entry,
  // else a community round (the coin, once the project is confirmed); only then the Bench's own steps.
  if (o.enter && !off('enter')) return o.enter;
  if (o.coin) return o.coin;
  if (!p.live && o.canHost && !off('go_live')) return { kind: 'go_live', project_key: p.key, line: goLiveAsk(p.name) };
  // O2 fix round 1 (ruling 3): nothing pending: grants that fit.
  if (o.fallback === false) return null;
  if (!off('grants')) return { kind: 'grants', project_key: p.key, line: grantsAsk(p.name) };
  // O5 N5: grants found none lately (or were declined): one small thing to ship this week.
  return off('suggest') ? null : { kind: 'suggest', project_key: p.key, line: shipAsk(p.name) };
}

function standLines(v: BenchView): string[] {
  // v2.13.4 (spec 2, R4): once claimed, "Your page: ...".
  // One link a reply: beside the install ask's link the page is named without https (earnkit.com/<handle>).
  const shown = v.ask?.kind === 'install_app' && v.handle ? pageUrl(v.handle) : v.page;
  const page = v.claimed && v.handle && shown ? [pageLine(shown)] : [];
  if (v.building) return [buildingNowLine(v.building), ...page];
  const p = v.project;
  if (!p) return [NO_PROJECT_LINE, ...page];
  // v2.13.4 (spec 3): the install ask says the project is private itself.
  if (v.ask?.kind === 'install_app' && page.length) return page;
  if (!p.confirmed) {
    // v2.14 spec 2: not counted yet (taken, a copy, or not proven: the App's install is the ask).
    const first = v.branch === 'taken' ? takenLine(p.name) : v.branch === 'copy' ? copyLine(p.name) : privateLine(p.name);
    return [first, ...page];
  }
  if (!v.claimed) return [CONFIRMED_LINE(p.name)];
  return [onBenchLine(p.name, v.rank, p.weeks), ...page];
}
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
