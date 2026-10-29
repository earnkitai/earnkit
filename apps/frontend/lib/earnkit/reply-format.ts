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

export type Surface = 'rich' | 'plain';

/** v4.0 Task 6: WhatsApp-style agents show markdown symbols raw, so they get plain "Label: value" lines. Pure. */
export function surfaceOf(clientName: string | null): Surface {
  return clientName && /\b(muse|meta|instinct|openclaw|hermes|whatsapp|telegram)\b/i.test(clientName) ? 'plain' : 'rich';
}

const SEPARATOR_ROW = /^\|[\s|:-]*\|$/;
const cellsOf = (row: string) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** A markdown table block as plain lines: header and separator dropped, each row "first cell: other cells, joined". */
function plainTable(rows: string[]): string[] {
  const data = rows.filter((r) => !SEPARATOR_ROW.test(r));
  return data
    .slice(1)
    .map(cellsOf)
    .map(([first, ...rest]) => {
      const others = rest.filter((c) => c !== '').join(', ');
      return others ? `${first}: ${others}` : first;
    });
}

function plainLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!TABLE_ROW.test(lines[i])) {
      out.push(lines[i].replace(/\*\*/g, ''));
      continue;
    }
    const rows: string[] = [];
    while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(lines[i++]);
    i--;
    out.push(...plainTable(rows).map((l) => l.replace(/\*\*/g, '')));
  }
  return out.filter((l) => l.trim() !== '');
}

export function formatReply(text: string, surface: Surface = 'rich'): string {
  let lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (surface === 'plain') lines = plainLines(lines);
  let out = '';
  lines.forEach((line, i) => {
    if (i > 0) out += together(lines[i - 1], line) ? '\n' : '\n\n';
    out += line;
  });
  return out;
}

/** The tool result with its show_to_builder formatted (formatReply); anything else as it is. Pure. */
export function withFormattedReply<T>(result: T, surface: Surface = 'rich'): T {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  return typeof r.show_to_builder === 'string' ? ({ ...r, show_to_builder: formatReply(r.show_to_builder, surface) } as T) : result;
}
