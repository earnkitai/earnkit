/**
 * Draws public/og.png, the one share card every page uses (L27-5, v6.1.16): 1200x630, the site's deep background, the
 * one line (ONE_LINE without its closing "Free.") large in a serif, and earnkit.com under it. Offline: no font or
 * image is fetched. The text is set by sharp's Pango renderer in system fonts present at build time (Georgia, then
 * any serif; Helvetica, then any sans): the repo's own fonts are WOFF2, which that renderer cannot read.
 * Run with `pnpm -s og:image` and commit the PNG.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ONE_LINE } from '../lib/v5/site-copy';
import { SITE } from '../lib/v5/site-theme';

const W = 1200;
const H = 630;
const PAD = 88;
const LINE = ONE_LINE.replace(/\s*Free\.$/, '');
const OUT = join(import.meta.dirname, '..', 'public', 'og.png');

// sharp ships with Next (its image optimizer); the frontend does not list it, so resolve it through next.
const require = createRequire(createRequire(import.meta.url).resolve('next/package.json'));
const sharp = require('sharp') as typeof import('sharp');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** One block of text as a transparent PNG, wrapped at `width`. */
const text = (markup: string, font: string, width: number) =>
  sharp({ text: { text: markup, font, width, rgba: true, dpi: 72, wrap: 'word', spacing: 8 } }).png().toBuffer({ resolveWithObject: true });

const background = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="g" cx="0.85" cy="0.1" r="0.9"><stop offset="0" stop-color="${SITE.navy}"/><stop offset="1" stop-color="${SITE.deep}"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="${PAD}" y="${PAD}" width="56" height="6" rx="3" fill="${SITE.blue}"/>
  </svg>`,
);

const headline = await text(`<span foreground="${SITE.text}">${esc(LINE)}</span>`, 'Georgia, serif 60', W - 2 * PAD);
const site = await text(`<span foreground="${SITE.muted}">earnkit.com</span>`, 'Helvetica, sans 30', W - 2 * PAD);

await sharp(background)
  .composite([
    { input: headline.data, left: PAD, top: Math.round((H - headline.info.height) / 2) - 10 },
    { input: site.data, left: PAD, top: H - PAD - site.info.height },
  ])
  .png({ compressionLevel: 9 })
  .toFile(OUT);

const meta = await sharp(OUT).metadata();
if (meta.width !== W || meta.height !== H) throw new Error(`og.png is ${meta.width}x${meta.height}`);
console.log(`[og-image] wrote ${OUT} (${W}x${H})`);
