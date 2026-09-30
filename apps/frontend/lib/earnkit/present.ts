/**
 * The builder-facing text for list_programs. Built on the server because many MCP clients
 * never show the model the server instructions; a ready-made result gets shown as written.
 */
export type Card = {
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

function youLine(card: Card) {
  return card.each_time.length === 0
    ? 'approve'
    : `approve, plus ${card.each_time.join('; ')}`;
}

/** Programs where the builder only approves come first; tagged ones (long shot, needs a live product) last. */
function rank(card: Card) {
  return (card.tag ? 2 : 0) + (card.each_time.length > 0 ? 1 : 0);
}

export function presentPrograms(cards: Card[], agentCanBuild: boolean) {
  if (cards.length === 0) return 'No open programs right now. Check back soon.';

  const lines = [...cards]
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => {
      const flags = [
        c.is_new && 'new',
        c.closes_in_days != null && soon(c.closes_in_days),
        c.tag,
      ].filter(Boolean);
      const head = `**${c.title}**: ${c.summary}${flags.map((f) => ` · ${f}`).join('')}`;
      // Grants for live products are applications, not builds.
      const isApplication = c.tag === 'needs a live product';
      const split = agentCanBuild
        ? `Me: ${isApplication ? 'fill in and submit the application' : 'build, deploy, submit'} · You: ${youLine(c)}`
        : isApplication
          ? 'Me: every answer · You: paste and submit'
          : 'Me: the plan and every answer · You: build, deploy, submit';
      return `${head}\n${split}`;
    });

  const footer = agentCanBuild
    ? "Pick one and I'll start. The first time on a platform, I'll need one quick setup from you."
    : "I can't build or deploy from here. Add EarnKit to a coding agent (Claude Code, Cursor, Codex) and it does the work for you.";

  return [...lines, footer].join('\n\n');
}
