/**
 * Agents that installed EarnKit before v5 keep a cached tool list and call its old names. A
 * `tools/call` with one of those names is answered with a refresh message instead of "unknown tool".
 */
export const OLD_TOOLS = ['score', 'tell', 'prepare', 'confirm', 'list_programs', 'get_program', 'prepare_submission', 'confirm_entry', 'record_submission', 'launch_token', 'tell_earnkit'];

export const OLD_TOOL_TEXT =
  "EarnKit's tools changed. Refresh this server's tool list, or remove and re-add the EarnKit connector. The tools are now find (what this repo can earn) and track (what the builder did).";

type Msg = { id?: unknown; method?: unknown; params?: { name?: unknown } };

const oldName = (m: unknown): string | null => {
  const x = m as Msg;
  if (!x || typeof x !== 'object' || x.method !== 'tools/call' || !x.params || typeof x.params !== 'object') return null;
  const name = x.params.name;
  return typeof name === 'string' && OLD_TOOLS.includes(name) && (typeof x.id === 'string' || typeof x.id === 'number') ? name : null;
};

/**
 * Splits a parsed JSON-RPC body: `answers` are the replies to its old-name calls, `rest` is what
 * still goes to the transport (null when nothing is left), `names` the old names called. Pure.
 */
export function answerOldTools(body: unknown): { answers: unknown[]; rest: unknown | null; names: string[] } {
  const items = Array.isArray(body) ? body : [body];
  const answers: unknown[] = [];
  const names: string[] = [];
  const rest: unknown[] = [];
  for (const m of items) {
    const name = oldName(m);
    if (name === null) {
      rest.push(m);
      continue;
    }
    names.push(name);
    answers.push({ jsonrpc: '2.0', id: (m as Msg).id, result: { content: [{ type: 'text', text: OLD_TOOL_TEXT }], isError: true } });
  }
  if (answers.length === 0) return { answers, rest: body, names };
  return { answers, rest: rest.length === 0 ? null : Array.isArray(body) ? rest : rest[0], names };
}
