/**
 * v4.8.1 Task 4 (R6): builders sometimes paste a secret key into chat, and the agent passes it on in a tool
 * argument. Every `tools/call` body is scrubbed in the route (app/mcp/route.ts withAliases) before the
 * transport or any tool sees it, and the reply to that call leads with SCRUB_LINE. A scrubbed value is
 * never logged, stored or echoed: the route logs only `[mcp] scrubbed {n}`.
 *
 * Raw 64-hex strings are not matched: they collide with transaction hashes.
 */
export const SECRET_PATTERNS: RegExp[] = [
  // Stripe
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g,
  /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  // GitHub
  /\bgh[opsur]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  // Anthropic (before OpenAI, whose pattern would also match it)
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  // OpenAI: project keys, and legacy keys (letters and digits only), so a name like sk-learn-... never matches
  /\bsk-proj-[A-Za-z0-9_-]{40,}/g,
  /\bsk-[A-Za-z0-9]{40,}\b/g,
  // AWS
  /\bAKIA[0-9A-Z]{16}\b/g,
  // PEM private key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export const KEY_REMOVED = '[key removed]';

export const SCRUB_LINE =
  "That looked like a secret key, so I removed it and saved nothing. If it was a live key, roll it now in that dashboard. Never paste keys in chat; I'll send a private link when one is needed.";

function scrubString(s: string): { value: string; removed: number } {
  let removed = 0;
  let value = s;
  for (const p of SECRET_PATTERNS) {
    value = value.replace(p, () => {
      removed += 1;
      return KEY_REMOVED;
    });
  }
  return { value, removed };
}

/** Each match in every string (walking objects and arrays) replaced by `[key removed]`; `removed` counts every match. Pure. */
export function scrubSecrets(value: unknown): { value: unknown; removed: number } {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) {
    let removed = 0;
    const out = value.map((v) => {
      const r = scrubSecrets(v);
      removed += r.removed;
      return r.value;
    });
    return removed ? { value: out, removed } : { value, removed: 0 };
  }
  if (value && typeof value === 'object') {
    let removed = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = scrubSecrets(v);
      removed += r.removed;
      out[k] = r.value;
    }
    return removed ? { value: out, removed } : { value, removed: 0 };
  }
  return { value, removed: 0 };
}

type Id = string | number;

/**
 * A POSTed MCP body (one JSON-RPC message or a batch) with each `tools/call`'s `params.arguments` scrubbed.
 * Nothing else is touched (unchanged messages are the same objects). `ids` are the scrubbed calls' JSON-RPC
 * ids, so their replies get SCRUB_LINE. Pure.
 */
export function scrubToolCalls(body: unknown): { body: unknown; removed: number; ids: Set<Id> } {
  const ids = new Set<Id>();
  let removed = 0;
  const one = (m: unknown): unknown => {
    const msg = m as { id?: unknown; method?: unknown; params?: { arguments?: unknown } };
    if (!msg || typeof msg !== 'object' || msg.method !== 'tools/call' || !msg.params || typeof msg.params !== 'object') return m;
    const r = scrubSecrets(msg.params.arguments);
    if (!r.removed) return m;
    removed += r.removed;
    if (typeof msg.id === 'string' || typeof msg.id === 'number') ids.add(msg.id);
    return { ...msg, params: { ...msg.params, arguments: r.value } };
  };
  const out = Array.isArray(body) ? body.map(one) : one(body);
  return removed ? { body: out, removed, ids } : { body, removed: 0, ids };
}

/**
 * One JSON-RPC reply to a scrubbed call: the first text content carries SCRUB_LINE. A JSON object text
 * (every successful tool reply, mcp.ts run) gets it as a top-level `scrub_note`; any other text (an error
 * line) is prefixed with SCRUB_LINE and a blank line. A JSON-RPC error (no result) is returned as is. Pure.
 */
export function withScrubNote(message: unknown): unknown {
  const m = message as { result?: { content?: { type?: string; text?: unknown }[] } };
  if (!m || typeof m !== 'object' || !m.result || !Array.isArray(m.result.content)) return message;
  const at = m.result.content.findIndex((c) => c?.type === 'text' && typeof c.text === 'string');
  if (at < 0) return { ...m, result: { ...m.result, content: [{ type: 'text', text: SCRUB_LINE }, ...m.result.content] } };
  const c = m.result.content[at] as { type: string; text: string };
  let text: string;
  try {
    const parsed = JSON.parse(c.text) as unknown;
    text =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? JSON.stringify({ scrub_note: SCRUB_LINE, ...parsed })
        : `${SCRUB_LINE}\n\n${c.text}`;
  } catch {
    text = `${SCRUB_LINE}\n\n${c.text}`;
  }
  const content = m.result.content.map((x, i) => (i === at ? { ...c, text } : x));
  return { ...m, result: { ...m.result, content } };
}

/**
 * The transport's response with SCRUB_LINE on each scrubbed call's reply (by id). The hosted transport
 * answers in plain JSON (enableJsonResponse), so the reply is rewritten as the aliased replies are. A
 * response that isn't a 200 JSON body passes through (the call itself was still scrubbed).
 */
export async function withScrubNotes(response: Response, ids: Set<Id>): Promise<Response> {
  if (ids.size === 0 || response.status !== 200 || !/application\/json/i.test(response.headers.get('content-type') ?? '')) return response;
  const parsed = (await response.json()) as unknown;
  const one = (m: unknown) => {
    const id = (m as { id?: unknown })?.id;
    return (typeof id === 'string' || typeof id === 'number') && ids.has(id) ? withScrubNote(m) : m;
  };
  const body = Array.isArray(parsed) ? parsed.map(one) : one(parsed);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: 200, headers });
}
