/**
 * v3.1 reply format (2026-10-23): how show_to_builder reads on the surfaces builders use. Grok Bot renders replies as
 * markdown (react-markdown + remark-gfm, no line-break plugin), so lines joined by one newline collapse into one
 * paragraph; WhatsApp, Telegram and SMS (OpenClaw, Hermes, Instinct, Muse on WhatsApp) show markdown syntax raw. So the
 * one format that reads well everywhere: each line its own paragraph (a blank line between), list items and table rows
 * kept together as one block, bare URLs, and no emphasis syntax. Pure.
 */
const LIST_ITEM = /^(\d+[.)]|[-•])\s/;
const TABLE_ROW = /^\|.*\|$/;

const together = (a: string, b: string) => (LIST_ITEM.test(a) && LIST_ITEM.test(b)) || (TABLE_ROW.test(a) && TABLE_ROW.test(b));

export function formatReply(text: string): string {
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  let out = '';
  lines.forEach((line, i) => {
    if (i > 0) out += together(lines[i - 1], line) ? '\n' : '\n\n';
    out += line;
  });
  return out;
}

/** The tool result with its show_to_builder formatted (formatReply); anything else as it is. Pure. */
export function withFormattedReply<T>(result: T): T {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  return typeof r.show_to_builder === 'string' ? ({ ...r, show_to_builder: formatReply(r.show_to_builder) } as T) : result;
}
