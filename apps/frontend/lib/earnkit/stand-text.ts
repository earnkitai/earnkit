import { rankWords, type Standing } from './rank';

/**
 * The Bench's shared reply text and types (v2.14: what stayed of v2.12.1's where-you-stand.ts once
 * the flag-off reply went). Plain words: no technical word unless the builder used it. Pure.
 */
export type StandProject = {
  key: string; name: string; what: string | null; shipped: boolean; people: number; has_coin: boolean; sends_tx: boolean; tagged: boolean;
  untracked_contract: string | null; untracked_people: number; certain: boolean; app: boolean;
  /** v2.12.2: only code (a GitHub repo, no site, package, contract or coin): it can be put online too. Absent: no. */
  code?: boolean;
  /** v2.12.2: code with a sign it is a website (a homepage, or web code): only then go_live for it. Absent: no. */
  web?: boolean;
  /** EarnKit confirmed it is theirs (T7). Absent: confirmed (nothing to offer). */
  confirmed?: boolean;
  /**
   * T9 fix round 1: its untracked contract is provable now (counted on a yes), though the rescore may
   * wait for review (then `certain` is false: no "today"). Absent: as `certain`.
   */
  provable?: boolean;
  /** T9 fix round 1: it has a contract EarnKit tracks (its tags are read now). Absent: tracked. */
  tracked_tx?: boolean;
};
export type EarnLine = { program_id: string; project: string; title: string; prize: string; when: string };
/**
 * `go_live` (controller ruling S15): put a made-but-not-live app online through EarnKit hosting.
 * `confirm` (T7 carry): a claimed person's work that isn't confirmed yet; the yes re-issues the
 * wallet or GitHub link (the claim page's links last 30 minutes).
 */
export type MoveUp = {
  kind: 'count_past' | 'confirm' | 'tag_future' | 'coin' | 'payment' | 'go_live' | 'send_link' | 'build';
  project_key: string | null;
  line: string;
};
export type StandView = {
  standing: Standing; claimed: boolean; handle: string | null; claimLink: string | null;
  projects: StandProject[]; earn: EarnLine[]; fresh: { title: string; prize: string } | null; step: MoveUp | null; news: string | null;
  /**
   * Money already on the way, first under "Ways to earn right now": the deadline line and an entry
   * whose only step left is the builder's own submission (its question is then the reply's one yes).
   */
  due?: string[];
  /**
   * Fix round 1 (every reply has a way to earn): a money statement when no program fits and no build
   * is offered: a project that could win once people use it, or an open-all-year program.
   */
  money?: string | null;
  /**
   * v2.12.1 T9: the steps the builder said no to in the last 30 days (`<kind>:<project_key or *>`,
   * stepKey), never offered again until then.
   */
  declined?: string[];
  /**
   * T9 fix round 1 (ruling 4): whether each kind of yes can deliver right now. `prove`: the one-tap
   * link that shows work is theirs can be made; `tag`: the attribution line can be made; `tips`: a
   * tip jar can be deployed. Absent (or a field absent): it can.
   */
  can?: { prove?: boolean; tag?: boolean; tips?: boolean };
};

const ARTICLE = /^(a|an|the|my)\s+/i;
/** "Your tip jar" from the few words; a name stays exactly as the builder wrote it ("tokens.fun", never capitalized). */
const yours = (p: StandProject) => (p.what ? `Your ${p.what.replace(ARTICLE, '')}` : p.name);
const sentenceStart = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const PAY = /\b(tip|donat|pay|shop|store|ticket|book|course|member|support|fund|sell|order|subscri)/i;
/** Plan S14: a payment side fits only apps whose own words are about money changing hands. Pure. */
export const paymentFits = (words: string): boolean => PAY.test(words);
/** T8 carry: words that say the app already takes money (a tip jar, donations, payments, checkout). */
const PAY_THERE = /\b(tip ?jars?|tips|tipping|donat\w*|payments?|pay|paying|checkout|paywall)\b/i;
/**
 * T9 (T8 carry): a way to take tips is offered only where a payment fits and isn't already there:
 * a coffee shop site yes, an app named tipjar (it already takes tips) no. Pure.
 */
export const paymentStepFits = (words: string): boolean => paymentFits(words) && !PAY_THERE.test(words);
/** The key a no to this step is kept under (builder_profiles.standing_seen.declined). Pure. */
export const stepKey = (kind: MoveUp['kind'], key: string | null) => `${kind}:${key ?? '*'}`;

/** Words a builder reply never says unless the builder did (spec copy rule); a project's few words with one are not used. */
const JARGON = /\b(contracts?|wallets?|repos?|repository|commits?|onchain|on-chain|builder codes?|outcomes?|percentiles?|base|arc|monad|tempo|ethereum|robinhood|solidity|erc-?\d+|evm|sdk|api|cli|next\.?js|react|typescript|javascript|python|npm|github)\b/i;

/**
 * A project's few words as the reply can use them ("a tip jar"), else null (the name is used): a
 * short phrase that starts with an article, no sentence inside, no technical word. A GitHub
 * description ("A Next.js app for recipes.") reads "a recipe app" only when it is that plain. Pure.
 */
export function plainWhat(what: string | null): string | null {
  const w = what?.trim().replace(/[.!]+$/, '');
  if (!w || w.split(/\s+/).length > 8 || /[.!?:;()[\]{}<>|`"]/.test(w) || JARGON.test(w)) return null;
  const low = /^[A-Z](?![A-Z])/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w;
  return /^(a|an|the)\s+\S/.test(low) ? low : null;
}

/** Fix round 1: a project that could win once people use it, as a statement (the reply's one yes stays the step). Pure. */
export function usersMoneyLine(project: StandProject | null, repo: string, title: string, prize: string): string {
  const who = project ? yours(project) : repo.split('/').pop()!;
  return `${who} could win ${prize} from ${title} once people use it.`;
}
/**
 * Fix rounds 1, 2: an open-all-year program, as a statement. `canPrepare`: a shipped project of theirs
 * can enter it (the program needs no live product they lack), so the entry is offered too. Pure.
 */
export const rollingLine = (title: string, prize: string, canPrepare: boolean) =>
  `You could win ${prize} from ${title}; it's open all year.${canPrepare ? ' I can prepare an entry with one of your projects.' : ''}`;

/**
 * spec 4: "EarnKit messages only when something real happens": new people counted on a project,
 * or a move up into a rank that reads well. `ask`: the reply has no other question, so the card
 * is offered (spec 5's moments). Null when nothing happened. Pure.
 */
export function standingNews(
  prev: { rank?: number; people?: Record<string, number>; at?: string },
  now: { standing: Standing; projects: { key: string; name: string; people: number }[] },
  at: Date,
  ask: boolean,
): { line: string; card: 'people' | 'rank' | null } | null {
  const grew = now.projects.map((p) => ({ ...p, n: p.people - (prev.people?.[p.key] ?? 0) })).filter((p) => p.n > 0).sort((a, b) => b.n - a.n)[0];
  const words = rankWords(now.standing);
  const up = words && prev.rank !== undefined && prev.rank > 0 && now.standing.rank < prev.rank ? now.standing : null;
  if (!grew && !up) return null;
  const seenAt = prev.at ? Date.parse(prev.at) : NaN;
  const week = Number.isFinite(seenAt) && at.getTime() - seenAt <= 7 * 86_400_000 ? ' this week' : '';
  // "top 20% of people building with AI": only the first letter is lowered (AI stays AI).
  const rankBit = up ? (up.total < 50 ? `you moved up to #${up.rank}` : `you're now in the ${words!.short.replace(/^Top/, 'top')}`) : null;
  const line = grew
    ? `${grew.n} new ${grew.n === 1 ? 'person' : 'people'} used ${grew.name}${week}${rankBit ? `, and ${rankBit}` : ''}.`
    : `${sentenceStart(rankBit!)}.`;
  return { line: ask ? `${line} Want a card to share it?` : line, card: ask ? (grew ? 'people' : 'rank') : null };
}

/**
 * The news opener: "Since you last checked: " with the alert items (fragments, joined as v2.11 does)
 * and then the news sentences. Never a period after a link (a sentence ending in one is left as is).
 * Null with nothing to say. Pure.
 */
export function newsOpener(alerts: string[], news: string[]): string | null {
  const parts = [...(alerts.length ? [`${alerts.join('; ')}.`] : []), ...news];
  return parts.length ? `Since you last checked: ${parts.join(' ')}` : null;
}

export const pageReadyLine = (link: string) => `Your EarnKit page is ready. Claim it with X: ${link}`;
/** The yes to a `confirm` step: the re-issued link, which lasts 30 minutes (never a period after it). */
export const confirmLinkLine = (link: string) => `Open this to show it's yours. It works for 30 minutes: ${link}`;
export const EARN_NOTE = 'If the builder picks a program, prepare it with lead.program_id (call prepare). Programs are named, not asked: the reply has one question, the last line.';
/** The plain answer when a yes or no changes nothing (v2.12.1 make-countable.ts COUNT_LINES.noted). */
export const NOTED_LINE = 'Okay.';
