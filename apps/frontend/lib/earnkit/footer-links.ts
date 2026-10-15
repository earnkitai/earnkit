import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export type FooterColumn = {
  title: string;
  links: { label: string; href: string; icon?: 'x' }[];
};

/**
 * These four link constants live here (lib/earnkit), not in app/lib/links.ts, because
 * EXTERNAL_ALLOW and FOOTER_COLUMNS need them and lib/earnkit never imports from app/ (fix round
 * 1, Important #1; every other app/ constant stays in app/lib/links.ts, which re-exports these).
 */
/** docs.earnkit.com: for builders and sponsors (v2.7 §5). */
export const DOCS = 'https://docs.earnkit.com';
/** The sponsor-facing docs, linked from the footer's Resources column (Ruling 22, plan). */
export const FOR_SPONSORS = 'https://docs.earnkit.com/for-sponsors';
/** The owner's personal account, used only for the footer's contact column (Ruling 22, plan). */
export const JENIL_X = 'https://x.com/jenilt';
/** The footer's contact email (Ruling 22, plan). */
export const CONTACT_EMAIL = 'mailto:j@earnkit.com';

/** Ruling 22 (plan): the tagline under the wordmark, on the left of the footer card. */
export const FOOTER_TAGLINE = 'Earn rewards for building';
/** v2.13 (controller ruling): the tagline under the flag, the landing hero's title. */
export const BENCH_FOOTER_TAGLINE = 'Ship every week. Get funded.';

/**
 * Ruling 22 (plan): the only external destinations the footer may link to. Owner rule: real
 * links only, no extras and no placeholders.
 */
export const EXTERNAL_ALLOW = [DOCS, FOR_SPONSORS, JENIL_X, CONTACT_EMAIL];

/** Ruling 22 (plan): the footer's four columns, in order. */
export const FOOTER_COLUMNS: FooterColumn[] = [
  { title: 'Product', links: [{ label: 'Programs', href: '/programs' }] },
  {
    title: 'Resources',
    links: [
      { label: 'Docs', href: DOCS },
      { label: 'For sponsors', href: FOR_SPONSORS },
    ],
  },
  { title: 'Legal', links: [{ label: 'Terms', href: '/terms' }] },
  {
    title: 'Contact',
    links: [
      { label: 'j@earnkit.com', href: CONTACT_EMAIL },
      { label: '@jenilt on X', href: JENIL_X, icon: 'x' },
    ],
  },
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
        if (!routes.includes(l.href)) problems.push(`internal link ${l.href} has no page`);
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
