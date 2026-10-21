/**
 * v3 Stage 3 Task 6 (spec 5.8): the site's link preview, public/og.png (1200x630), drawn by the share card's renderer
 * (next/og, Funnel Display from assets/fonts) on the flat system: the wordmark top left, the hero's words
 * (BENCH_HERO_TITLE and BENCH_HERO_SUBTITLE, below), the site's host at the foot. Every colour is a THEME value.
 * Run from the repo root or apps/frontend:
 *   npx tsx apps/frontend/scripts/og.mts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { ImageResponse } from 'next/og';
import { CardWordmark, loadFonts } from '../app/[handle]/card-response';
import { THEME as T } from '../lib/earnkit/theme';

// The card's JSX compiles to React.createElement under tsx (the tests do the same).
(globalThis as { React?: typeof React }).React = React;
const h = React.createElement;

/**
 * The v3 hero's words, which public/og.png shows. v3.1 W11 keeps the OG image's v3 look, so its words live here
 * since the landing hero (v3.1 Task 6) moved to HERO_TITLE and HERO_SUB.
 */
export const BENCH_HERO_TITLE = 'Ship every week. Get funded.';
export const BENCH_HERO_SUBTITLE =
  'Add EarnKit to the agent you already use. It writes your weekly ship log from real commits, ranks you against every builder, and routes you to grants, accelerators and backers.';

/** The foot of the image: public/og.png is committed, so it names the production host whatever EARNKIT_URL says here. */
export const OG_HOST = 'earnkit.com';

/** The OG page: the wordmark, the title in two lines, the subline, the host. Pure. */
export function ogCard() {
  const [first, second] = BENCH_HERO_TITLE.split(/(?<=\.) /);
  return h(
    'div',
    { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 72px 52px', backgroundColor: T.page, color: T.text, fontFamily: 'Funnel Display' } },
    h(CardWordmark, { height: 30 }),
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column' } },
      h('div', { style: { display: 'flex', fontSize: 104, fontWeight: 500, lineHeight: 1.02, letterSpacing: -4 } }, first),
      second ? h('div', { style: { display: 'flex', fontSize: 104, fontWeight: 500, lineHeight: 1.02, letterSpacing: -4 } }, second) : null,
      h('div', { style: { display: 'flex', marginTop: 32, maxWidth: 1000, fontSize: 30, fontWeight: 500, lineHeight: 1.35, color: T.body } }, BENCH_HERO_SUBTITLE),
    ),
    h('div', { style: { display: 'flex', fontSize: 30, fontWeight: 500, color: T.muted } }, OG_HOST),
  );
}

/** The PNG bytes of the OG image. */
export async function ogImage(): Promise<Buffer> {
  const fonts = await loadFonts();
  if (!fonts.length) throw new Error('Funnel Display not found under assets/fonts');
  const res = new ImageResponse(ogCard(), { width: 1200, height: 630, fonts });
  return Buffer.from(await res.arrayBuffer());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(import.meta.dirname, '..', 'public', 'og.png');
  const png = await ogImage();
  await writeFile(out, png);
  console.log(`${out}: ${png.byteLength} bytes`);
}
