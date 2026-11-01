/**
 * v4.8.1 Task 4 (R6): builders sometimes paste a secret key into chat, and the agent passes it on in a tool
 * argument. Every `tools/call` body is scrubbed in the route (app/mcp/route.ts withAliases) before the
 * transport or any tool sees it, and the reply to that call leads with SCRUB_LINE. A scrubbed value is
 * never logged, stored or echoed: the route logs only `[mcp] scrubbed {n}`.
 *
 * Raw 64-hex strings are not matched: they collide with transaction hashes.
 */
// Fix 3 (review F6): `\b` fails after `_`, so a key glued to an identifier (token_sk_live_...) was missed; the
// leading and trailing edges are "not a letter or digit" instead.
const L = '(?<![A-Za-z0-9])';
const R = '(?![A-Za-z0-9])';
const g = (src: string) => new RegExp(src, 'g');

/** The secret shapes matched by a regex. PEM private keys are matched by a linear pass instead (scrubPem). */
export const SECRET_PATTERNS: RegExp[] = [
  // Stripe secret and restricted keys: 16+ characters with a digit, or 24+ characters (a legacy key can have no digit;
  // final review 5). sk_test_fixtures is a name, not a key: the underscore ends its body at 8 characters.
  // Publishable pk_ keys are public by design and are left alone (review F5).
  g(`${L}(?:sk|rk)_(?:live|test)_(?:(?=[A-Za-z0-9]*\\d)[A-Za-z0-9]{16,}|[A-Za-z0-9]{24,})${R}`),
  g(`${L}whsec_[A-Za-z0-9]{16,}${R}`),
  // GitHub
  g(`${L}gh[opsur]_[A-Za-z0-9]{30,}${R}`),
  g(`${L}github_pat_[A-Za-z0-9_]{30,}(?![A-Za-z0-9_])`),
  // Anthropic (before OpenAI)
  g(`${L}sk-ant-[A-Za-z0-9_-]{20,}`),
  // OpenAI: project, service-account and admin keys, and legacy keys (letters and digits only), so a name
  // like sk-learn-tutorial-... never matches
  g(`${L}sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}`),
  g(`${L}sk-[A-Za-z0-9]{40,}`),
  // AWS access keys: long-term AKIA and temporary ASIA
  g(`${L}A(?:KIA|SIA)[0-9A-Z]{16}${R}`),
];

export const KEY_REMOVED = '[key removed]';

/** A PEM private key's body is at most this long (a 4096-bit RSA key is about 3,300 characters). */
export const PEM_MAX_BODY = 10_000;

export const SCRUB_LINE =
  "That looked like a secret key, so I removed it and saved nothing. If it was a live key, roll it now in that dashboard. Never paste keys in chat; I'll send a private link when one is needed.";

type Scrubbed = { value: unknown; removed: number };

const BEGIN = '-----BEGIN ';
const END = '-----END ';
const LABEL = /[A-Z ]{0,40}PRIVATE KEY-----/y;

/** The end of a `[A-Z ]{0,40}PRIVATE KEY-----` label starting at `at`, or -1. Bounded work. */
function labelEnd(s: string, at: number): number {
  LABEL.lastIndex = at;
  return LABEL.test(s) ? LABEL.lastIndex : -1;
}

/**
 * Fix 3 (review F1): each `-----BEGIN {label}PRIVATE KEY-----` with a `-----END {label}PRIVATE KEY-----` at most
 * PEM_MAX_BODY characters after it is replaced (the first END, as a lazy match would). O(n): the BEGIN walk only
 * moves forward, and one cached next valid END is recomputed only once the walk passes it, so every END is looked
 * at once. (A regex with a lazy body rescans from every BEGIN: many BEGINs with one END at the end are quadratic.)
 */
export function scrubPem(s: string): { value: string; removed: number } {
  if (!s.includes(BEGIN)) return { value: s, removed: 0 };
  let out = '';
  let last = 0;
  let pos = 0;
  let removed = 0;
  let endAt = -1; // the cached next valid END (-1: not looked for yet; Infinity: none left)
  let endStop = -1; // where that END's label ends
  const findEnd = (from: number) => {
    for (let at = from; ; ) {
      const e = s.indexOf(END, at);
      if (e < 0) {
        endAt = Infinity;
        return;
      }
      const stop = labelEnd(s, e + END.length);
      if (stop >= 0) {
        endAt = e;
        endStop = stop;
        return;
      }
      at = e + 1;
    }
  };
  for (;;) {
    const b = s.indexOf(BEGIN, pos);
    if (b < 0) break;
    const body = labelEnd(s, b + BEGIN.length);
    if (body < 0) {
      pos = b + 1;
      continue;
    }
    // Each search starts past the last END found, so the searches never overlap.
    if (endAt < body) findEnd(body);
    if (endAt === Infinity) break;
    if (endAt - body <= PEM_MAX_BODY) {
      out += s.slice(last, b) + KEY_REMOVED;
      removed += 1;
      last = pos = endStop;
    } else {
      pos = b + 1;
    }
  }
  return removed ? { value: out + s.slice(last), removed } : { value: s, removed: 0 };
}

function scrubString(s: string): Scrubbed {
  const pem = scrubPem(s);
  let removed = pem.removed;
  let value = pem.value;
  for (const p of SECRET_PATTERNS) {
    value = value.replace(p, () => {
      removed += 1;
      return KEY_REMOVED;
    });
  }
  return { value, removed };
}

/**
 * Each match in every string (walking objects and arrays) replaced by `[key removed]`; `removed` counts every
 * match. Every string is scanned, whatever its length (the route caps the body at MAX_MCP_BODY_BYTES). Pure.
 */
export function scrubSecrets(value: unknown): Scrubbed {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) {
    let removed = 0;
    const out = value.map((v) => {
      const r = scrubSecrets(v);
      removed += r.removed;
      return r.value;
    });
    return { value: removed ? out : value, removed };
  }
  if (value && typeof value === 'object') {
    let removed = 0;
    // Object.fromEntries defines own properties, so a `__proto__` argument key survives (review F4).
    const out = Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        const r = scrubSecrets(v);
        removed += r.removed;
        return [k, r.value];
      }),
    );
    return { value: removed ? out : value, removed };
  }
  return { value, removed: 0 };
}

/** Fix 3 (review F1): the largest POST body /mcp reads (bytecode, the largest argument, is under 100 KB). */
export const MAX_MCP_BODY_BYTES = 1_000_000;

/** The 413 answer to a body over MAX_MCP_BODY_BYTES, JSON-RPC shaped. */
export const BODY_TOO_LARGE = {
  jsonrpc: '2.0',
  error: { code: -32600, message: 'Request too large: EarnKit reads at most 1 MB per request.' },
  id: null,
} as const;

/**
 * The request body as text, or null once it passes `max` bytes (Content-Length first, then while reading, so a
 * chunked body is never read past the cap).
 */
export async function readCapped(request: Request, max = MAX_MCP_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
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
 * (every successful tool reply, mcp.ts run) gets it as a top-level `scrub_note`, and (final review 7: every agent note
 * says to show `show_to_builder`, so a note field alone is never shown) at the start of `show_to_builder`, followed by
 * a blank line, wherever the reply has one; the easy reply stays last. Any other text (an error line) is prefixed with
 * SCRUB_LINE and a blank line. A JSON-RPC error (no result) is returned as is. Pure.
 */
const withShowLine = (r: Record<string, unknown>) => {
  const show = r.show_to_builder;
  const out: Record<string, unknown> = { scrub_note: SCRUB_LINE, ...r };
  if (typeof show === 'string') out.show_to_builder = show ? `${SCRUB_LINE}\n\n${show}` : SCRUB_LINE;
  return out;
};
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
        ? JSON.stringify(withShowLine(parsed as Record<string, unknown>))
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
