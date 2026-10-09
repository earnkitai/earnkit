import { normalizeRepoUrl } from './campaigns';
import { publicReadKey, publicRepoKeys } from './repo-cache';
import {
  FETCH_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  LARGE_PAGE_MAX_BYTES,
  RedirectError,
  type Resolver,
  SafeFetchError,
  type Transport,
  safeFetchBytes,
  safeFetchText,
  sameSite,
} from './safe-fetch';
import { imageTypeOf } from './tokens';

/**
 * v2.10 item 12: the token logo when the agent sent none. tokens.fun writes the image link onchain
 * at launch, so EarnKit always sends a link it controls: fetched bytes are stored with the claim
 * (projects.token_image, served at /api/projects/<id>/image), else the generated mark
 * (/api/projects/<id>/mark, drawn from the id, never stored). The text tile is never sent.
 *
 * Order: the live site's apple-touch-icon, its largest PNG/JPEG/WebP icon of 128 px or more, its
 * og:image (each tried in turn, Pre-flight P24), then the repo's custom social preview, only for a
 * repo with a fresh anonymous public read (Ruling H6), never through the App and never for a
 * private repo. Every step catches and moves on; the whole resolve has an 8 s budget.
 */

export type Logo = { bytes: Buffer; type: 'image/png' | 'image/jpeg' | 'image/webp'; from: 'site' | 'preview' };

export type LogoDeps = {
  /** The live site's HTML (default: safeFetchText, 512 KB, one same-site redirect). */
  page?: (url: string) => Promise<string>;
  /** One image's bytes (default: safeFetchBytes, 1 MB, one redirect, each hop SSRF-checked). */
  image?: (url: string) => Promise<Buffer>;
  /** The repo's custom social preview link, or null (default: one GitHub GraphQL read). */
  preview?: (repoKey: string) => Promise<string | null>;
  /** The resolver and transport under the default page and image reads (tests: no network). */
  net?: { resolve?: Resolver; transport?: Transport };
  /** The overall budget (default LOGO_BUDGET_MS; tests shorten it). */
  budgetMs?: number;
};

export const LOGO_BUDGET_MS = 8_000;
/** At most this many of the site's candidates are fetched (the budget is shared). */
const SITE_TRIES = 3;

const RASTER = /\.(png|jpe?g|webp)$/i;
const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`[\\s<]${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find((v) => v !== undefined) ?? null;
const rels = (tag: string) => (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const sizeOf = (tag: string) =>
  Math.max(0, ...(attr(tag, 'sizes') ?? '').split(/\s+/).map((s) => Number(s.toLowerCase().split('x')[0]) || 0));

/**
 * v2.10 item 12 (Pre-flight P24): the logos a page names, best first: apple-touch-icon (largest
 * first), then raster `rel=icon` links of 128 px or more (largest first), then og:image. Only
 * absolute https links; never SVG or ICO. Pure.
 */
export function iconCandidates(html: string, pageUrl: string): string[] {
  const abs = (h: string | null) => {
    if (!h) return null;
    try {
      const u = new URL(h.trim().replace(/&amp;/gi, '&'), pageUrl);
      return u.protocol === 'https:' && !/\.(svg|svgz|ico)$/i.test(u.pathname) ? u.href : null;
    } catch {
      return null;
    }
  };
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const bySize = (tags: string[]) =>
    tags
      .map((t) => ({ href: abs(attr(t, 'href')), size: sizeOf(t), type: (attr(t, 'type') ?? '').toLowerCase() }))
      .sort((a, b) => b.size - a.size);
  const touch = bySize(links.filter((l) => rels(l).some((r) => r.startsWith('apple-touch-icon'))))
    .filter((i) => !i.type || /^image\/(png|jpeg|webp)$/.test(i.type))
    .map((i) => i.href);
  const icons = bySize(links.filter((l) => rels(l).includes('icon')))
    .filter((i) => i.href && i.size >= 128 && (i.type ? /^image\/(png|jpeg|webp)$/.test(i.type) : RASTER.test(new URL(i.href).pathname)))
    .map((i) => i.href);
  const og = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /^og:image(:secure_url)?$/i.test(attr(t, 'property') ?? attr(t, 'name') ?? ''))
    .map((t) => abs(attr(t, 'content')));
  return [...new Set([...touch, ...icons, ...og].filter((h): h is string => Boolean(h)))];
}

/** The best logo a page names (iconCandidates' first), or null. Pure. */
export function pickIconHref(html: string, pageUrl: string): string | null {
  return iconCandidates(html, pageUrl)[0] ?? null;
}

/** GETs `url`, following at most one redirect (to the same site only when `sameSiteOnly`). */
async function oneRedirect<T>(url: string, get: (u: string) => Promise<T>, sameSiteOnly: boolean): Promise<T> {
  try {
    return await get(url);
  } catch (err) {
    if (!(err instanceof RedirectError) || !err.location) throw err;
    const next = new URL(err.location, url);
    if (sameSiteOnly && !sameSite(next.hostname, new URL(url).hostname))
      throw new SafeFetchError(`redirects to another site (${next.hostname})`);
    return get(next.href);
  }
}

/**
 * The repo's custom social preview, through EarnKit's own GITHUB_TOKEN (never an App token): one
 * GraphQL read, a link only when the repo uses a custom image and GitHub says it isn't private.
 */
export async function githubPreview(repoKey: string, doFetch: typeof fetch = fetch): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  const m = repoKey.match(/^github\.com\/([^/]+)\/([^/]+)$/);
  if (!token || !m) return null;
  const res = await doFetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'EarnKit' },
    body: JSON.stringify({
      query: 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){isPrivate usesCustomOpenGraphImage openGraphImageUrl}}',
      variables: { owner: m[1], name: m[2] },
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    // A revoked or rate-limited GITHUB_TOKEN would quietly send every launch to the mark: say so
    // (the status only; never the token or the repo).
    console.error('[logo] github preview read failed', res.status);
    return null;
  }
  const repo = ((await res.json()) as {
    data?: { repository?: { isPrivate?: boolean; usesCustomOpenGraphImage?: boolean; openGraphImageUrl?: string } | null };
  }).data?.repository;
  return repo?.isPrivate === false && repo.usesCustomOpenGraphImage === true && repo.openGraphImageUrl?.startsWith('https://')
    ? repo.openGraphImageUrl
    : null;
}

/**
 * v2.10 item 12: the logo for a launch with no upload, or null (the caller sends the mark).
 * `repoKey` is a normalized repo the caller already knows is public (Ruling H6), else null.
 */
export async function resolveLogo(
  a: { liveUrl: string | null; repoKey: string | null },
  deps: LogoDeps = {},
): Promise<Logo | null> {
  const budgetMs = deps.budgetMs ?? LOGO_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  const timeoutMs = () => Math.max(1, Math.min(FETCH_TIMEOUT_MS, deadline - Date.now()));
  const page =
    deps.page ??
    ((u: string) => oneRedirect(u, (x) => safeFetchText(x, { ...deps.net, maxBytes: LARGE_PAGE_MAX_BYTES, timeoutMs: timeoutMs(), accept: 'text/html' }), true));
  const image =
    deps.image ?? ((u: string) => oneRedirect(u, (x) => safeFetchBytes(x, { ...deps.net, maxBytes: IMAGE_MAX_BYTES, timeoutMs: timeoutMs() }), false));
  const preview = deps.preview ?? ((k: string) => githubPreview(k));

  const fetchImage = async (href: string) => {
    try {
      const bytes = await image(href);
      const type = bytes.length <= IMAGE_MAX_BYTES ? imageTypeOf(bytes) : null;
      return type ? { bytes, type } : null;
    } catch {
      return null;
    }
  };
  const run = async (): Promise<Logo | null> => {
    if (a.liveUrl) {
      const html = await page(a.liveUrl).catch(() => null);
      for (const href of html ? iconCandidates(html, a.liveUrl).slice(0, SITE_TRIES) : []) {
        if (Date.now() >= deadline) return null;
        const got = await fetchImage(href);
        if (got) return { ...got, from: 'site' };
      }
    }
    if (a.repoKey && Date.now() < deadline) {
      const href = await preview(a.repoKey).catch(() => null);
      const got = href ? await fetchImage(href) : null;
      if (got) return { ...got, from: 'preview' };
    }
    return null;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  try {
    return await Promise.race([run().catch(() => null), budget]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The launch's logo: the repo's preview is read only when the repo isn't private and has an
 * anonymous public read within 7 days (Ruling H6, fail closed). That one indexed DB read runs
 * before resolveLogo's 8 s budget starts (it is fast, and a failure reads as not public).
 */
export async function launchLogo(
  a: { liveUrl: string | null; repoUrl: string | null; repoPrivate: boolean },
  deps: LogoDeps & { publicKeys?: typeof publicRepoKeys } = {},
): Promise<Logo | null> {
  let repoKey: string | null = null;
  if (a.repoUrl && !a.repoPrivate) {
    const shown = await (deps.publicKeys ?? publicRepoKeys)([a.repoUrl]).catch(() => new Set<string>());
    if (shown.has(publicReadKey(a.repoUrl))) repoKey = normalizeRepoUrl(a.repoUrl);
  }
  return resolveLogo({ liveUrl: a.liveUrl, repoKey }, deps);
}

/**
 * The default the launch flow uses (TokenFlowDeps.logo overrides it). Mutable so suites that run
 * the entry tools (fixtures/no-network-checks) never fetch a site or GitHub.
 */
export const logoDefaults: { launch: typeof launchLogo } = { launch: launchLogo };

export type Mark = { shape: 'circle' | 'square' | 'diamond' | 'hexagon'; from: string; to: string; angle: number };
const SHAPES: Mark['shape'][] = ['circle', 'square', 'diamond', 'hexagon'];

/** A 32-bit hash of the id (FNV-1a over its digits, then a murmur3 finalizer so near ids differ in every bit). Pure. */
const hashOf = (n: number) => {
  let h = 0x811c9dc5;
  for (const c of String(n)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** `hsl(h, s%, l%)` as #rrggbb. Pure. */
function hex(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * v2.10 item 12: the generated mark for a project: one shape on a two-colour gradient, all from
 * the id. Deterministic; no letters. Pure.
 *
 * MUST STAY STABLE: launched tokens carry /api/projects/<id>/mark onchain and it is cached as
 * immutable, so any change to hashOf, hex, SHAPES or the route's drawing silently redraws every
 * launched token's logo. token-logo.test.ts pins reference values (test 6.3).
 */
export function markFor(projectId: number): Mark {
  const h = hashOf(projectId);
  const hue = h % 360;
  return {
    shape: SHAPES[(h >>> 9) % SHAPES.length],
    from: hex(hue, 72, 58),
    to: hex((hue + 40 + ((h >>> 12) % 80)) % 360, 70, 38),
    angle: 45 * ((h >>> 20) % 8),
  };
}
