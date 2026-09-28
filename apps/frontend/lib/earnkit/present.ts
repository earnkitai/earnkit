/**
 * The builder-facing text for list_programs. Built on the server because many MCP clients
 * never show the model the server instructions; a ready-made result gets shown as written.
 */
export type Card = {
  title: string;
  summary: string;
  tag: string | null;
  each_time: string[];
};

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
      const head = `**${c.title}**: ${c.summary}${c.tag ? ` · ${c.tag}` : ''}`;
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
