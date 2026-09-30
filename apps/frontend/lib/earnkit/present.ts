import type { Verdict } from './match';

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
  | { checked: number; fits: { repo: string; verdicts: Verdict[] }[] }
  | { error: string };

/** Programs where the builder only approves come first; tagged ones (long shot, needs a live product) last. */
function rank(card: Card) {
  return (card.tag ? 2 : 0) + (card.each_time.length > 0 ? 1 : 0);
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

/**
 * The one answer: each of the builder's repos with the programs it fits, then every other open
 * program, then who does what, said once.
 */
export function presentPrograms(
  cards: Card[],
  agentCanBuild: boolean,
  repos?: YourRepos | null,
) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const shown = new Set<string>();
  const sections: string[] = [];

  if (repos && 'error' in repos) {
    sections.push(`Couldn't read your repos: ${repos.error}`);
  } else if (repos && repos.fits.length === 0) {
    sections.push(
      `None of your ${repos.checked} public repos fits an open program yet.`,
    );
  } else if (repos) {
    for (const fit of repos.fits.slice(0, MAX_REPOS)) {
      const lines = [...fit.verdicts]
        .sort((a, b) => (a.status === 'likely' ? 0 : 1) - (b.status === 'likely' ? 0 : 1))
        .flatMap((v) => {
          const card = byId.get(v.program_id);
          if (!card) return [];
          shown.add(card.id);
          return [line(card, v.note)];
        });
      if (lines.length === 0) continue;
      const n = `${lines.length} program${lines.length === 1 ? '' : 's'}`;
      sections.push(`**Your ${fit.repo} fits ${n}**\n${lines.join('\n')}`);
    }
    if (repos.fits.length > MAX_REPOS)
      sections.push(
        `…and ${repos.fits.length - MAX_REPOS} more repos. Name any repo and I'll check it.`,
      );
  }

  const rest = cards
    .filter((c) => !shown.has(c.id))
    .sort((a, b) => rank(a) - rank(b));
  if (rest.length > 0)
    sections.push(
      `${shown.size > 0 ? '**Also open**\n' : ''}${rest.map((c) => line(c)).join('\n')}`,
    );
  if (cards.length === 0)
    sections.push('No open programs right now. Check back soon.');
  else
    sections.push(
      agentCanBuild
        ? "Pick one and I'll build, deploy, and submit it. You approve before anything is sent, and I'll say up front if it needs something only you can give, like a pitch video."
        : "I can't build or deploy from here, but I can plan it and write every answer for you to submit. To have it done for you, add EarnKit to a coding agent (Claude Code, Cursor, Codex).",
    );
  return sections.join('\n\n');
}
