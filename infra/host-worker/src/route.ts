/**
 * v2.9 C12/C14: the host Worker's routing, pure and testable in Node. `<slug>.<zone>` maps to the R2
 * keys `sites/<slug>/<path>`; `state/<slug>.json` is the kill switch and the end page (plan Ruling 9).
 * Every response carries HOST_HEADERS (the sandbox CSP), errors included.
 */
import { HOST_HEADERS, HOST_RESERVED, SITE_PREFIX, STATE_PREFIX, contentTypeFor } from '../../../apps/frontend/lib/earnkit/host-names';

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
  if (!z || !h.endsWith(`.${z}`)) return null;
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

export { contentTypeFor };

const page = (text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text}</title></head>` +
  `<body style="font-family:system-ui,sans-serif;padding:3rem 1rem;text-align:center"><p>${text}</p>` +
  `<p><a href="https://earnkit.com">earnkit.com</a></p></body></html>`;

export const ENDED_PAGE = page('This site has ended.');
export const TAKEN_DOWN_PAGE = page('This site was taken down.');

const HTML = 'text/html; charset=utf-8';
const TEXT = 'text/plain; charset=utf-8';
/** Edge TTLs. A file is cached at most FILE_TTL after a state read up to STATE_TTL old: a takedown shows within 300 s. */
const STATE_TTL = 60;
const FILE_TTL = 240;
const MISS_TTL = 60;
const ttl = (seconds: number) => `public, max-age=${seconds}`;
/** Query of the per-slug state entry. File cache keys never carry a query, so they can't collide with it. */
const STATE_QUERY = '?earnkit-state';

/** HOST_HEADERS are set last, so no other header source can drop or duplicate them. */
function withHeaders(body: BodyInit | null, status: number, extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  for (const [name, value] of Object.entries(HOST_HEADERS)) headers.set(name, value);
  return new Response(body, { status, headers });
}

const plain = (status: number, text: string, extra: Record<string, string> = {}) =>
  withHeaders(text, status, { 'Content-Type': TEXT, 'Cache-Control': 'no-store', ...extra });

const fixedPage = (html: string) => withHeaders(html, 410, { 'Content-Type': HTML, 'Cache-Control': 'no-store' });

type Stored = NonNullable<Awaited<ReturnType<Bucket['get']>>>;
type WaitUntil = (p: Promise<unknown>) => void;

const logError = (e: unknown) => console.error('host worker error', e instanceof Error ? e.name : 'error');

/** Answers one request. Reserved and unknown hosts never touch the bucket or the cache. */
export async function handle(req: Request, env: Env, cache: EdgeCache, waitUntil: WaitUntil): Promise<Response> {
  try {
    return await route(req, env, cache, waitUntil);
  } catch (e) {
    logError(e);
    return plain(500, 'Something went wrong.');
  }
}

/** The cache URL for a key: one entry per decoded path, each segment re-encoded, never a query. */
const cacheUrl = (origin: string, rest: string) => `${origin}/${rest.split('/').map(encodeURIComponent).join('/')}`;

async function route(req: Request, env: Env, cache: EdgeCache, waitUntil: WaitUntil): Promise<Response> {
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

  // Built from the validated slug and decoded path: Host spelling, query and encoding never split it.
  const origin = `https://${slug}.${env.ZONE.toLowerCase()}`;
  const cacheKey = new Request(cacheUrl(origin, key.slice(SITE_PREFIX.length + slug.length + 1)));
  const put = (res: Response) => waitUntil(cache.put(cacheKey, res.clone()).catch(logError));

  const hit = await cache.match(cacheKey);
  if (hit) return finish(hit, url, head);

  const status = await siteStatus(slug, origin, env, cache, waitUntil);
  if (status === 'killed' || status === 'review') return finish(fixedPage(TAKEN_DOWN_PAGE), url, head);
  if (status === 'ended') return finish(fixedPage(ENDED_PAGE), url, head);
  if (status !== 'live') return plain(404, 'Not found.');

  let res: Response;
  const found = await env.BUCKET.get(key);
  if (found) {
    res = fileResponse(found, contentTypeFor(key), 200, ttl(FILE_TTL));
  } else if (!/\.[^/]*$/.test(key) && (await exists(env.BUCKET, `${key}/index.html`))) {
    // Ruling G17: a directory gets its trailing slash, so the page's relative links resolve.
    res = withHeaders(null, 301, { Location: `${url.pathname}/`, 'Cache-Control': ttl(MISS_TTL) });
  } else {
    res = await notFoundPage(slug, origin, env, cache, waitUntil);
  }
  put(res);
  return finish(res, url, head);
}

/** Rewraps a response: HOST_HEADERS again, no body for HEAD, and a redirect keeps this request's query. */
function finish(res: Response, url: URL, head: boolean): Response {
  const headers = new Headers(res.headers);
  if (res.status === 301) headers.set('Location', `${url.pathname}/${url.search}`);
  if (head) void res.body?.cancel().catch(() => {});
  return withHeaders(head ? null : res.body, res.status, headers);
}

/** The site's status from `state/<slug>.json`, cached per slug for STATE_TTL ('none' when absent). */
async function siteStatus(slug: string, origin: string, env: Env, cache: EdgeCache, waitUntil: WaitUntil): Promise<string> {
  const stateKey = new Request(`${origin}/${STATE_QUERY}`);
  const hit = await cache.match(stateKey);
  if (hit) return hit.text();
  const obj = await env.BUCKET.get(`${STATE_PREFIX}${slug}.json`);
  const status = obj ? ((await readStatus(obj)) ?? 'invalid') : 'none';
  const entry = new Response(status, { headers: { 'Content-Type': TEXT, 'Cache-Control': ttl(STATE_TTL) } });
  waitUntil(cache.put(stateKey, entry).catch(logError));
  return status;
}

/**
 * The site's 404.html as a 404, else a plain 404. The page is looked up through its own `/404.html`
 * cache entry (a 200 when present, a 404 when absent), so a flood of distinct missing paths reads
 * it from R2 at most once per entry lifetime.
 */
async function notFoundPage(slug: string, origin: string, env: Env, cache: EdgeCache, waitUntil: WaitUntil): Promise<Response> {
  const pageKey = new Request(cacheUrl(origin, '404.html'));
  let page = await cache.match(pageKey);
  if (!page) {
    const obj = await env.BUCKET.get(`${SITE_PREFIX}${slug}/404.html`);
    page = obj ? fileResponse(obj, HTML, 200, ttl(FILE_TTL)) : plain(404, 'Not found.', { 'Cache-Control': ttl(MISS_TTL) });
    waitUntil(cache.put(pageKey, page.clone()).catch(logError));
  }
  if (page.status !== 200) {
    void page.body?.cancel().catch(() => {});
    return plain(404, 'Not found.', { 'Cache-Control': ttl(MISS_TTL) });
  }
  const headers = new Headers(page.headers);
  headers.set('Cache-Control', ttl(MISS_TTL));
  return withHeaders(page.body, 404, headers);
}

async function exists(bucket: Bucket, key: string): Promise<boolean> {
  const obj = await bucket.get(key);
  if (!obj) return false;
  void obj.body.cancel().catch(() => {});
  return true;
}

function fileResponse(obj: Stored, contentType: string, status: number, cacheControl: string): Response {
  return withHeaders(obj.body, status, {
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
