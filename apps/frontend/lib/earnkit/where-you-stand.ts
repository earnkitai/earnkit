import { rankWords, type Standing } from './rank';
import { pageUrl } from './reserved-routes';

/**
 * v2.12.1 spec 2: the first reply in three short parts, ending in one yes: where you stand (what
 * they shipped, the rank only when it reads well, the claim link or their page), ways to earn right
 * now (at most 3 programs, each tied to a project, never one they can't win or entered), and how
 * to move up (the single step that helps most now, promising only what EarnKit can deliver).
 * Plain words: no technical word unless the builder used it (their own names are theirs). Pure.
 */
export const HEADS = { stand: 'Where you stand', earn: 'Ways to earn right now', up: 'How to move up' } as const;
export type StandProject = {
  key: string; name: string; what: string | null; shipped: boolean; people: number; has_coin: boolean; sends_tx: boolean; tagged: boolean;
  untracked_contract: string | null; untracked_people: number; certain: boolean; app: boolean;
  /** EarnKit confirmed it is theirs (T7). Absent: confirmed (nothing to offer). */
  confirmed?: boolean;
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
};

const ARTICLE = /^(a|an|the|my)\s+/i;
/** "a tip jar" as a list item; the name when no words were given. */
const listed = (p: StandProject) => p.what ?? p.name;
/** "Your tip jar" from the few words; a name stays exactly as the builder wrote it ("tokens.fun", never capitalized). */
const yours = (p: StandProject) => (p.what ? `Your ${p.what.replace(ARTICLE, '')}` : p.name);
/** "your tip jar" inside a sentence; the name as written. */
const yoursIn = (p: StandProject) => (p.what ? `your ${p.what.replace(ARTICLE, '')}` : p.name);
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const sentenceStart = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nounOf = (ps: StandProject[]) => {
  const apps = ps.every((p) => p.app);
  return ps.length === 1 ? (apps ? 'app' : 'project') : apps ? 'apps' : 'projects';
};

const PAY = /\b(tip|donat|pay|shop|store|ticket|book|course|member|support|fund|sell|order|subscri)/i;
/** Plan S14: a payment side fits only apps whose own words are about money changing hands. Pure. */
export const paymentFits = (words: string): boolean => PAY.test(words);

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

export const SEND_LINK_LINE ="Send me a link to something you've made and I'll add it.";

/**
 * The one step that helps most now (spec 3), in this order: count past users, confirm work that
 * isn't counted yet (claimed people only: the links need a page), count future users, a coin, a
 * payment side; with nothing live, put an app online (when EarnKit can host it) or send a link;
 * else the build offer, if any. `host`: EarnKit can put that project online now. Pure.
 */
export function chooseStep(
  v: Omit<StandView, 'step' | 'news'>,
  o: { coin: (key: string) => boolean; build: string | null; host?: (key: string) => boolean },
): MoveUp | null {
  const shown = v.projects.filter((p) => p.shipped);
  if (shown.length === 0) {
    // Ruling S15: the agent named apps but none is live: the one yes puts the best one online.
    const live = o.host ? v.projects.find((p) => p.app && o.host!(p.key)) : undefined;
    if (live)
      return {
        kind: 'go_live', project_key: live.key,
        line: `Want me to put ${yoursIn(live)} online? It takes a few minutes and you won't have to do anything.`,
      };
    return { kind: 'send_link', project_key: null, line: SEND_LINK_LINE };
  }
  const past = shown.find((p) => p.untracked_contract && p.untracked_people > 0);
  if (past)
    return {
      kind: 'count_past', project_key: past.key,
      line: `${yours(past)} has people using it who aren't counted yet. Want me to count them? ${past.certain ? 'Your rank goes up today.' : "I'll send you a link to show it's yours."}`,
    };
  const unconfirmed = v.claimed ? shown.filter((p) => p.confirmed === false) : [];
  if (unconfirmed.length > 0) {
    const [one] = unconfirmed;
    const head =
      unconfirmed.length === 1
        ? `${yours(one)} isn't confirmed as yours yet, so it doesn't count.`
        : `${unconfirmed.length} of your ${nounOf(unconfirmed)} aren't confirmed as yours yet, so they don't count.`;
    return {
      kind: 'confirm', project_key: unconfirmed.length === 1 ? one.key : null,
      line: `${head} Want a link to show ${unconfirmed.length === 1 ? "it's" : "they're"} yours? It takes one tap.`,
    };
  }
  const tag = shown.find((p) => p.sends_tx && !p.tagged);
  if (tag)
    return {
      kind: 'tag_future', project_key: tag.key,
      // Spec example 1's words fit an app people pay through; any other app is asked about its users.
      line: paymentFits(`${tag.what ?? ''} ${tag.name}`)
        ? `${yours(tag)} has a payment side people could use. Want me to make it count the people who pay you? You won't have to do anything.`
        : `Want me to make ${yoursIn(tag)} count the people who use it? You won't have to do anything.`,
    };
  const coin = shown.find((p) => p.people > 0 && !p.has_coin && o.coin(p.key));
  if (coin) return { kind: 'coin', project_key: coin.key, line: `${yours(coin)} has people using it. Want to launch a coin for it? You'd get 40% of its trading fees.` };
  const pay = shown.find((p) => p.app && !p.sends_tx && paymentFits(`${p.what ?? ''} ${p.name}`));
  if (pay) return { kind: 'payment', project_key: pay.key, line: `${yours(pay)} could take tips from the people who use it. Want me to add that? You won't have to do anything.` };
  return o.build ? { kind: 'build', project_key: null, line: o.build } : null;
}

function standLines(v: StandView): string[] {
  const shipped = v.projects.filter((p) => p.shipped);
  const link = v.claimed && v.handle ? `Your page: ${pageUrl(v.handle)}` : v.claimLink ? `Claim your page with X: ${v.claimLink}` : null;
  if (shipped.length === 0) {
    // Pre-flight (target user), ruling S15: the agent named projects but none is live. Name them;
    // never "nothing found". No rank (nothing confirmed ranks them yet).
    const k = v.projects.length;
    if (k === 0) return ["I couldn't find anything you've made yet."];
    const made = `You've made ${k} ${nounOf(v.projects)} with AI${k <= 3 ? `: ${andList(v.projects.map(listed))}` : ''}. ${k === 1 ? "It isn't" : 'None is'} live yet.`;
    return [made, ...(link ? [link] : [])];
  }
  const n = shipped.length;
  const noun = nounOf(shipped);
  const used = shipped.filter((p) => p.people > 0).length;
  const rank = rankWords(v.standing);
  const usedWords = n === 1 ? 'and people are using it' : `and ${used} of them ${used === 1 ? 'has people using it' : 'have people using them'}`;
  const work =
    used > 0
      ? `You've shipped ${n} ${noun}, ${usedWords}.`
      : `You've shipped ${n} ${noun} with AI${n <= 3 ? `: ${andList(shipped.map(listed))}` : ''}.`;
  const first = used > 0 && rank ? `${rank.reply} ${work}` : [work, rank?.reply].filter(Boolean).join(' ');
  return [first, ...(link ? [link] : [])];
}

function earnLines(v: StandView): string[] {
  const named = new Map(v.projects.map((p) => [p.key, p]));
  const due = v.due ?? [];
  if (v.earn.length > 0) {
    // A key with no named project reads as its last part ("tipjar", never "lee/tipjar": no repo paths in builder text).
    const lines = v.earn.slice(0, 3).map((e) => `${named.get(e.project) ? yours(named.get(e.project)!) : e.project.split('/').pop()} fits ${e.title}: ${e.prize}, ${e.when}.`);
    lines[lines.length - 1] += lines.length === 1 ? ' I can prepare the entry.' : ' I can prepare any of these entries.';
    return [...due, ...lines];
  }
  if (v.fresh) return [...due, `${v.fresh.title} pays ${v.fresh.prize} for a small app, and I can build one with you in about an hour.`];
  return v.money ? [...due, v.money] : due;
}

/** Fix round 1: a project that could win once people use it, as a statement (the reply's one yes stays the step). Pure. */
export function usersMoneyLine(project: StandProject | null, repo: string, title: string, prize: string): string {
  const who = project ? yours(project) : repo.split('/').pop()!;
  return `${who} could win ${prize} from ${title} once people use it.`;
}
/** Fix round 1: an open-all-year program, as a statement. Pure. */
export const rollingLine = (title: string, prize: string, hasProjects: boolean) =>
  `${title} pays ${prize} and is open all year.${hasProjects ? ' I can prepare an entry with one of your projects.' : ''}`;

/** The step when no project of theirs has a better one: the fresh build, money first. Pure. */
export const buildStepLine = (title: string, prize: string, canBuild: boolean) =>
  canBuild
    ? `${title} pays ${prize} for a small app. Want me to build one with you? It takes about an hour.`
    : `${title} pays ${prize} for a small app. I can plan it with you; it takes about an hour to build. Want the plan?`;

export function whereYouStand(v: StandView, o: { programs?: boolean } = {}): string {
  const parts = [[HEADS.stand, ...standLines(v)]];
  const earn = o.programs === false ? [] : earnLines(v);
  if (earn.length) parts.push([HEADS.earn, ...earn]);
  if (v.step) parts.push([HEADS.up, v.step.line]);
  return parts.map((p) => p.join('\n')).join('\n\n');
}

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
export const MOVE_UP_NOTE = 'A yes to the last line: call tell with move_up: { kind, project_key, answer: "yes" } (kind and project_key as given here); a no: answer "no". Do the steps it returns yourself; never ask the builder to edit files.';
export const EARN_NOTE = 'If the builder picks a program, prepare it with lead.program_id (call prepare). Programs are named, not asked: the reply has one question, the last line.';
