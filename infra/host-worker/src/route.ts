/**
 * v2.9 C12/C14: the host Worker's routing, pure and testable in Node. `<slug>.<zone>` maps to the R2
 * keys `sites/<slug>/<path>`; `state/<slug>.json` is the kill switch and the end page (plan Ruling 9).
 * Every response carries HOST_HEADERS (the sandbox CSP), errors included.
 */
import { HOST_HEADERS, HOST_RESERVED, SITE_PREFIX, STATE_PREFIX } from '../../../apps/frontend/lib/earnkit/host-names';

export type Bucket = {
  get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>;
};
export type EdgeCache = {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
};
export type Env = { BUCKET: Bucket; ZONE: string; RESERVED?: string };

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The site slug for a Host header: exactly one valid label under the zone, not reserved; else null. */
export function siteSlug(host: string, zone: string, reserved: readonly string[]): string | null {
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const z = zone.toLowerCase();
  if (!h.endsWith(`.${z}`)) return null;
  const label = h.slice(0, -(z.length + 1));
  if (!LABEL.test(label) || reserved.includes(label)) return null;
  return label;
}

/** The R2 key for a URL path under `sites/<slug>/`, or null for traversal, odd bytes or bad encoding. */
export function objectKey(slug: string, pathname: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\\\x00-\x1f]|\/\/|(^|\/)\.\.?(\/|$)/.test(p)) return null;
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.endsWith('/')) p += 'index.html';
  return `${SITE_PREFIX}${slug}${p}`;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  webmanifest: 'application/manifest+json',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

/** The Content-Type for a key, from the extension of its last segment. */
export function contentTypeFor(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return TYPES[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

const page = (text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;padding:3rem 1rem;text-align:center"><p>${text}</p>` +
  `<p><a href="https://earnkit.com">earnkit.com</a></p></body></html>`;

export const ENDED_PAGE = page('This site has ended.');
export const TAKEN_DOWN_PAGE = page('This site was taken down.');

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
const CACHE_CONTROL = 'public, max-age=300';

/** HOST_HEADERS are set last, so no other header source can drop or duplicate them. */
function withHeaders(body: BodyInit | null, status: number, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  for (const [name, value] of Object.entries(HOST_HEADERS)) headers.set(name, value);
  return new Response(body, { status, headers });
}

const plain = (status: number, text: string, extra: Record<string, string> = {}) =>
  withHeaders(text, status, { 'Content-Type': TEXT, 'Cache-Control': 'no-store', ...extra });

const fixedPage = (html: string, head: boolean) =>
  withHeaders(head ? null : html, 410, { 'Content-Type': HTML, 'Cache-Control': 'no-store' });

type Stored = NonNullable<Awaited<ReturnType<Bucket['get']>>>;

/** Answers one request. Reserved and unknown hosts never touch the bucket. */
export async function handle(
  req: Request,
  env: Env,
  cache: EdgeCache,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  try {
    return await route(req, env, cache, waitUntil);
  } catch {
    return plain(500, 'Something went wrong.');
  }
}

async function route(req: Request, env: Env, cache: EdgeCache, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
  const head = req.method === 'HEAD';
  if (req.method !== 'GET' && !head) return plain(405, 'Method not allowed.', { Allow: 'GET, HEAD' });

  const url = new URL(req.url);
  const extra = (env.RESERVED ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const slug = siteSlug(req.headers.get('host') ?? url.host, env.ZONE, [...HOST_RESERVED, ...extra]);
  if (!slug) return plain(404, 'Not found.');

  const key = objectKey(slug, url.pathname);
  if (!key) return plain(400, 'Bad request.');

  // One cache entry per slug and path: the query string and Host spelling never split or bypass it.
  const cacheKey = new Request(`https://${slug}.${env.ZONE.toLowerCase()}${url.pathname}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) {
    if (head) void hit.body?.cancel().catch(() => {});
    return withHeaders(head ? null : hit.body, hit.status, hit.headers);
  }

  const stateObj = await env.BUCKET.get(`${STATE_PREFIX}${slug}.json`);
  if (!stateObj) return plain(404, 'Not found.');
  const status = await readStatus(stateObj);
  if (status === 'killed' || status === 'review') return fixedPage(TAKEN_DOWN_PAGE, head);
  if (status === 'ended') return fixedPage(ENDED_PAGE, head);
  if (status !== 'live') return plain(404, 'Not found.');

  let found = await env.BUCKET.get(key);
  let foundKey = key;
  if (!found && !/\.[^/]*$/.test(key)) {
    foundKey = `${key}/index.html`;
    found = await env.BUCKET.get(foundKey);
  }
  if (!found) {
    const notFound = await env.BUCKET.get(`${SITE_PREFIX}${slug}/404.html`);
    if (!notFound) return plain(404, 'Not found.');
    return fileResponse(notFound, HTML, 404, 'no-store', head);
  }

  const res = fileResponse(found, contentTypeFor(foundKey), 200, CACHE_CONTROL, head);
  if (!head) waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function fileResponse(obj: Stored, contentType: string, status: number, cacheControl: string, head: boolean): Response {
  if (head) void obj.body.cancel().catch(() => {});
  return withHeaders(head ? null : obj.body, status, {
    'Content-Type': contentType,
    'Content-Length': String(obj.size),
    'Cache-Control': cacheControl,
  });
}

async function readStatus(obj: Stored): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await new Response(obj.body).text());
    const status = (parsed as { status?: unknown } | null)?.status;
    return typeof status === 'string' ? status : null;
  } catch {
    return null;
  }
}
