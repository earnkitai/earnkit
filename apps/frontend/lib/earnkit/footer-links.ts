import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export type FooterColumn = {
  title: string;
  links: { label: string; href: string; icon?: 'x' }[];
};

/**
 * These link constants live here (lib/earnkit), not in app/lib/links.ts, because EXTERNAL_ALLOW and
 * FOOTER_COLUMNS need them and lib/earnkit never imports from app/ (fix round 1, Important #1; every other
 * app/ constant stays in app/lib/links.ts, which re-exports these).
 */
/** "Docs" in the header, footer and shell pages: the site's own page (v3 Stage 3, Task 5). */
export const DOCS = '/docs';
/** EarnKit on X (@EarnKitAI, as the site metadata; v3.1 S17, owner decision O3). */
export const X = 'https://x.com/EarnKitAI';

/** Ruling 22 (plan), v2.13 (controller ruling): the old footer tagline, kept as a copy constant (v213-copy.test.ts). */
export const BENCH_FOOTER_TAGLINE = 'Ship every week. Get funded.';

/**
 * Ruling 22 (plan): the only external destinations the footer may link to. Owner rule: real
 * links only, no extras and no placeholders. v3.1: EarnKit's X only (no email, no personal account).
 */
export const EXTERNAL_ALLOW = [X];

/**
 * v3.1 (Foot board, S16): the full footer's links, in order: Leaderboard, Feed, Docs, Terms, then the X
 * button. The programs list left the footer (W10), and so did "For sponsors" and the email. The titles
 * group them in code only.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { label: 'Leaderboard', href: '/leaderboard' },
      { label: 'Feed', href: '/feed' },
      { label: 'Docs', href: DOCS },
    ],
  },
  { title: 'Legal', links: [{ label: 'Terms', href: '/terms' }] },
  { title: 'Social', links: [{ label: 'EarnKit on X', href: X, icon: 'x' }] },
];

/**
 * Checks every footer link: an internal path (starting with "/") must be a real app route (per
 * `routes`); an external link must be in `EXTERNAL_ALLOW`; every label must be non-empty. Pure
 * (no filesystem, no network) so it runs in every test, not just `LINK_CHECK=1` (Ruling 22, plan).
 */
export function footerLinkProblems(columns: FooterColumn[], routes: string[]): string[] {
  const problems: string[] = [];
  for (const c of columns)
    for (const l of c.links) {
      if (!l.label.trim()) problems.push(`${c.title}: empty label`);
      if (l.href.startsWith('/')) {
        if (!routes.includes(l.href.split('#')[0])) problems.push(`internal link ${l.href} has no page`);
      } else if (!EXTERNAL_ALLOW.includes(l.href)) problems.push(`external link not allowed: ${l.href}`);
    }
  return problems;
}

/**
 * Every route the app serves a page for: one entry per folder under `appDir` holding a
 * `page.tsx`, as its path from `appDir` (dynamic segments kept as written, e.g. "[id]"). The root
 * `page.tsx` is "/". A folder with no `page.tsx` (an API route, a layout-only folder, a
 * component folder) contributes nothing.
 */
export function appRoutes(appDir: string): string[] {
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === 'page.tsx'))
      routes.push(segments.length ? `/${segments.join('/')}` : '/');
    for (const e of entries) if (e.isDirectory()) walk(join(dir, e.name), [...segments, e.name]);
  };
  walk(appDir, []);
  return routes;
}
