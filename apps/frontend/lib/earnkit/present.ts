import { EFFORT_ORDER, type Verdict } from './match';

/**
 * The builder-facing text for list_programs. Built on the server because many MCP clients
 * never show the model the server instructions; a ready-made result gets shown as written.
 */
export type Card = {
  id: string;
  title: string;
  summary: string;
  tag: string | null;
  each_time: string[];
  /** Added since the builder's last check. */
  is_new?: boolean;
  /** Whole days until the deadline, when it's 3 or fewer. */
  closes_in_days?: number | null;
  /** The known per-winner award in USD (programs.ts perWinnerUsd); unknown sorts as 0. */
  max_award_usd?: number | null;
  /**
   * A sponsor campaign whose sponsor isn't domain-verified: listed, but never the "Fastest"
   * headline or the closing offer, and after curated programs in "Also open".
   */
  unverified_sponsor?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days until a deadline if it's within 3 days, else null. */
export function closesInDays(endsAt: Date | null, now = new Date()) {
  if (!endsAt) return null;
  const days = Math.floor((endsAt.getTime() - now.getTime()) / DAY_MS);
  return days <= 3 ? Math.max(days, 0) : null;
}

const soon = (days: number) =>
  days === 0 ? 'closes today' : `closes in ${days} day${days === 1 ? '' : 's'}`;

/** "Since you last checked" line ("Heads up" on a first check), or null when nothing to flag. */
export function presentSinceLastCheck(
  cards: Card[],
  firstCheck = false,
  news: string[] = [],
) {
  const parts = [
    ...news,
    ...cards.filter((c) => c.is_new).map((c) => `new: ${c.title}`),
    ...cards
      .filter((c) => c.closes_in_days != null)
      .map((c) => `${c.title} ${soon(c.closes_in_days!)}`),
  ];
  if (parts.length === 0) return null;
  return `${firstCheck ? 'Heads up' : 'Since you last checked'}: ${parts.join(' · ')}`;
}

/** The builder's repos checked against open programs (only verdicts that can earn), or why not. */
export type YourRepos =
  | {
      checked: number;
      /** repo_url is null for private/local repos the agent reported. */
      fits: { repo: string; repo_url: string | null; verdicts: Verdict[] }[];
    }
  | { error: string };

/**
 * Programs where the builder only approves come first; tagged ones (long shot, needs a live
 * product) and unverified sponsor campaigns last.
 */
function rank(card: Card) {
  return (
    (card.unverified_sponsor ? 4 : 0) +
    (card.tag ? 2 : 0) +
    (card.each_time.length > 0 ? 1 : 0)
  );
}

/** One line per program: title, reward and deadline, flags, then what it needs from this repo. */
function line(c: Card, note?: string | null) {
  const flags = [
    c.is_new && 'new',
    c.closes_in_days != null && soon(c.closes_in_days),
    // The note already says a repo needs a live product.
    !(note && c.tag === 'needs a live product') && c.tag,
    note,
  ].filter(Boolean);
  return `- **${c.title}** · ${c.summary}${flags.map((f) => ` · ${f}`).join('')}`;
}

const MAX_REPOS = 5;

/** likely before after_step, then the least effort. */
const quickness = (v: Verdict) =>
  (v.status === 'likely' ? 0 : 10) + EFFORT_ORDER.indexOf(v.effort);

/** Quickest first; between equally quick fits, the larger known per-winner award. */
const byFit = (byId: Map<string, Card>) => (a: Verdict, b: Verdict) =>
  quickness(a) - quickness(b) ||
  (byId.get(b.program_id)?.max_award_usd ?? 0) -
    (byId.get(a.program_id)?.max_award_usd ?? 0);

/**
 * The one answer. Opens with the money (how many programs their repos can enter and the fastest
 * one), then what they're already working on, each repo with the programs it fits, every other
 * open program, and a single offer for the next step.
 */
export function presentPrograms(
  cards: Card[],
  agentCanBuild: boolean,
  repos?: YourRepos | null,
  /** Program ids this installation is preparing a submission for. */
  workingOn: string[] = [],
) {
  if (cards.length === 0) return 'No open programs right now. Check back soon.';
  const byId = new Map(cards.map((c) => [c.id, c]));
  const order = byFit(byId);
  const fits = repos && 'fits' in repos ? repos.fits : [];
  const noteFor = (id: string) =>
    fits
      .flatMap((f) => f.verdicts)
      .filter((v) => v.program_id === id)
      .sort(order)[0]?.note;

  const sections: string[] = [];
  const shown = new Set<string>();

  // Headline: the money first.
  const fitIds = new Set(
    fits
      .flatMap((f) => f.verdicts.map((v) => v.program_id))
      .filter((id) => byId.has(id)),
  );
  // Anything can be listed, but only curated programs and verified sponsors are put forward.
  const canLead = (id: string) =>
    byId.has(id) && !byId.get(id)!.unverified_sponsor;
  const fastest = fits
    .flatMap((f) => f.verdicts.map((v) => ({ repo: f.repo, v })))
    .filter(({ v }) => canLead(v.program_id))
    .sort((a, b) => order(a.v, b.v))[0];
  if (repos && 'error' in repos)
    sections.push(`Couldn't read your repos: ${repos.error}`);
  else if (repos && fitIds.size === 0)
    sections.push(
      `None of your ${repos.checked} repos fits an open program yet.`,
    );
  else if (fitIds.size > 0)
    sections.push(
      `Your repos can enter ${fitIds.size} program${fitIds.size === 1 ? '' : 's'}.` +
        // Skip "fastest" when they're already on it; "You're working on" says it.
        (!fastest || workingOn.includes(fastest.v.program_id)
          ? ''
          : ` Fastest: **${fastest.v.program}** with ${fastest.repo} (${fastest.v.note}).`),
    );

  const working = workingOn
    .map((id) => byId.get(id))
    .filter((c) => c !== undefined);
  if (working.length > 0) {
    working.forEach((c) => shown.add(c.id));
    sections.push(
      `**You're working on**\n${working.map((c) => line(c, noteFor(c.id))).join('\n')}`,
    );
  }

  // Each program once, under its first repo; repos that add nothing new are just named.
  const others: string[] = [];
  let repoSections = 0;
  for (const fit of fits) {
    const lines =
      repoSections < MAX_REPOS
        ? [...fit.verdicts].sort(order).flatMap((v) => {
            const card = byId.get(v.program_id);
            if (!card || shown.has(card.id)) return [];
            shown.add(card.id);
            return [line(card, v.note)];
          })
        : [];
    if (lines.length === 0) {
      others.push(fit.repo);
      continue;
    }
    repoSections++;
    sections.push(
      `**${fit.repo_url ? `[${fit.repo}](${fit.repo_url})` : fit.repo}**\n${lines.join('\n')}`,
    );
  }
  if (others.length > 0) {
    const named = others.slice(0, 3).join(', ');
    const more = others.length > 3 ? `, +${others.length - 3} more` : '';
    sections.push(
      `More of your repos fit too: ${named}${more}. Name one and I'll check it.`,
    );
  }

  const rest = cards
    .filter((c) => !shown.has(c.id))
    .sort((a, b) => rank(a) - rank(b));
  if (rest.length > 0)
    sections.push(
      `${shown.size > 0 ? '**Also open**\n' : ''}${rest.map((c) => line(c)).join('\n')}`,
    );

  // One offer, not five equal options; never an unverified sponsor campaign.
  const resume = working.find((c) => !c.unverified_sponsor);
  const next = resume
    ? `Want me to keep going on ${resume.title}?`
    : fastest
      ? `Want me to start on ${fastest.v.program}?`
      : "Pick one and I'll start.";
  sections.push(
    agentCanBuild
      ? `${next} I build, deploy, and submit; you approve before anything is sent, and I'll say up front if it needs something only you can give, like a pitch video.`
      : "I can't build or deploy from here, but I can plan it and write every answer for you to submit. To have it done for you, add EarnKit to a coding agent (Claude Code, Cursor, Codex).",
  );
  return sections.join('\n\n');
}
