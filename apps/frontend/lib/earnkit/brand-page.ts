import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORDMARK_D } from '../../app/components/ui/Logo';
import { DOCS } from './footer-links';
import { THEME as T } from './theme';

/**
 * v2.12.1 T11 fix round 2: the look of the claim, done and wallet pages (route handlers that answer
 * HTML with no script of ours but the wallet page's nonce one). The site's one design system (the shared THEME of
 * theme.ts, same as every React page) in one inline <style>. v3 Stage 3 Task 6 (spec 5.6, 5.8): the flat system.
 * A black page, the React header's slim sticky bar (wordmark plus quiet links, the 1120px column), the words in the
 * page column at a 36rem measure with no panel around them, Funnel Display for the headline and Funnel Sans for the
 * text (both embedded as data: fonts; the wallet page's CSP allows font-src data: for them), hairline rows, one
 * brand-blue primary button with white text (BTN_PRIMARY). No gradient, no glow, no shadow, no radius but the
 * pills and the icon disc. Nothing external is loaded, so no CSP changes.
 */

/** The Funnel Display files (assets/fonts, OFL), read once; null when missing (tests run from the repo root). */
export function fontFile(weight: 500 | 700): Buffer | null {
  for (const dir of [join(process.cwd(), 'assets/fonts'), join(process.cwd(), 'apps/frontend/assets/fonts')]) {
    try {
      return readFileSync(join(dir, `funnel-display-latin-${weight}.woff`));
    } catch {
      // Try the next place.
    }
  }
  return null;
}

/** The Funnel Sans variable file (app/fonts, OFL, the one the React pages load); null when missing. */
export function sansFile(): Buffer | null {
  for (const dir of [join(process.cwd(), 'app/fonts'), join(process.cwd(), 'apps/frontend/app/fonts')]) {
    try {
      return readFileSync(join(dir, 'funnel-sans-latin-wght-normal.woff2'));
    } catch {
      // Try the next place.
    }
  }
  return null;
}

let faces: string | null = null;
const fontFaces = () => {
  if (faces !== null) return faces;
  // Task 7: the CSS sets Funnel Display at weight 500 only, so that is the one Display face embedded.
  const display = ([500] as const)
    .map((w) => {
      const f = fontFile(w);
      return f ? `@font-face{font-family:"Funnel Display";font-weight:${w};font-style:normal;font-display:swap;src:url(data:font/woff;base64,${f.toString('base64')}) format("woff")}` : '';
    })
    .join('');
  const sans = sansFile();
  const text = sans ? `@font-face{font-family:"Funnel Sans";font-weight:300 700;font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${sans.toString('base64')}) format("woff2")}` : '';
  return (faces = display + text);
};

const SANS = '"Funnel Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const DISPLAY = '"Funnel Display",ui-sans-serif,system-ui,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;min-height:100dvh;background:${T.page};color:${T.text};font:400 1rem/1.55 ${SANS};-webkit-font-smoothing:antialiased}
.ek-top{position:sticky;top:0;z-index:1;width:100%;background:${T.glass};border-bottom:1px solid ${T.border};-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.ek-bar{max-width:1120px;height:56px;margin:0 auto;display:flex;align-items:center;gap:4px;padding:0 16px}
.ek-home{display:inline-flex;align-items:center;min-height:44px;margin-right:auto;color:${T.text}}
.ek-home svg{height:18px;width:auto}
.ek-nav{display:flex;gap:4px}
.ek-nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 8px;color:${T.muted};font-size:.875rem;font-weight:500;text-decoration:none;transition:color .15s}
.ek-nav a:hover{color:${T.text}}
.ek-nav .ek-wide{display:none}
.ek-wrap{max-width:1120px;margin:0 auto;padding:56px 16px 96px}
.ek-panel{max-width:36rem}
.ek-mark{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:999px;margin-bottom:24px;background:${T.raised};color:${T.text}}
.ek-mark svg{width:24px;height:24px}
h1{font-family:${DISPLAY};font-weight:500;font-size:2.25rem;line-height:1.05;letter-spacing:-.03em;margin:0;text-wrap:balance}
.ek-line{margin:16px 0 0;font-size:1.125rem;line-height:1.55;color:${T.body}}
.ek-first{margin-top:0;font-family:${DISPLAY};font-weight:500;font-size:1.75rem;line-height:1.15;letter-spacing:-.02em;color:${T.text};text-wrap:balance}
.ek-url{margin:12px 0 0;font-family:${DISPLAY};font-weight:500;font-size:1.125rem;color:${T.accent};word-break:break-all}
.ek-small{margin:16px 0 0;font-size:.9375rem;line-height:1.55;color:${T.muted}}
.ek-line a,.ek-small a{color:${T.accent};text-decoration:none;overflow-wrap:anywhere}
.ek-line a:hover,.ek-small a:hover{text-decoration:underline;text-underline-offset:4px}
.ek-rows{margin:32px 0 0;padding:0;border-bottom:1px solid ${T.hairline}}
.ek-rows dd{margin:0;min-width:0}
.ek-row{margin:0;padding:14px 0;border-top:1px solid ${T.hairline};display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.ek-k{min-width:4.5rem;font-size:.875rem;color:${T.muted}}
.ek-chip{display:inline-flex;align-items:center;gap:8px;max-width:100%;padding:6px 12px;border-radius:999px;border:1px solid ${T.borderStrong};color:${T.text};font-size:.9375rem;line-height:1.3;overflow-wrap:anywhere}
.ek-chip svg{flex:none;width:14px;height:14px;color:${T.muted}}
.ek-code{margin:16px 0 0;padding:18px 16px;background:${T.surface};border:1px solid ${T.border};color:${T.text};font:600 1.5rem/1.2 ${MONO};letter-spacing:.08em;text-align:center;white-space:nowrap;user-select:all;-webkit-user-select:all}
.ek-note{margin:0;padding:14px 0;border-top:1px solid ${T.hairline};color:${T.body};font-size:.9375rem;line-height:1.5}
.ek-rows+.ek-note{border-top:0}
.ek-note strong{color:${T.text};font-weight:500}
.ek-actions{margin-top:32px;display:flex;flex-direction:column;gap:12px}
form{margin:0}
.ek-btn{display:flex;width:100%;min-height:48px;align-items:center;justify-content:center;gap:8px;padding:0 24px;border:0;border-radius:999px;background:${T.brand};color:${T.text};font:500 1rem/1 ${SANS};white-space:nowrap;text-decoration:none;cursor:pointer;transition:background-color .15s}
.ek-btn:hover{background:${T.accent}}
.ek-btn:focus-visible,.ek-link:focus-visible,.ek-nav a:focus-visible,.ek-home:focus-visible{outline:2px solid ${T.accent};outline-offset:3px}
.ek-btn svg{width:20px;height:20px}
.ek-links{margin:32px 0 0;padding:0;border-top:1px solid ${T.hairline};list-style:none;display:flex;flex-direction:column}
.ek-link{display:inline-flex;min-height:44px;align-items:center;color:${T.accent};text-decoration:none;font-size:1rem;font-weight:500}
.ek-link:hover{text-decoration:underline;text-underline-offset:4px}
.ek-status{margin:16px 0 0;min-height:1.5em;font-size:1rem;color:${T.body}}
.ek-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

@media (min-width:640px){.ek-nav .ek-wide{display:inline-flex}.ek-nav a{padding:0 12px;font-size:1rem}.ek-bar{height:64px;padding:0 32px}.ek-home svg{height:20px}.ek-wrap{padding:96px 32px 128px}.ek-row{flex-direction:row;align-items:center;gap:16px}h1{font-size:3rem}.ek-first{font-size:2rem}.ek-actions{flex-direction:row}.ek-btn{display:inline-flex;width:auto}}
@media (prefers-reduced-motion:reduce){.ek-btn,.ek-nav a{transition:none}}
`;

/** GitHub's mark, for the "Continue with GitHub" button and the repo chip. */
export const GITHUB_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-1.96c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>';

/** X's logo for the "Continue with X" button. */
export const X_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>';

/**
 * The page: the top bar, then `inner` (already escaped HTML) in the page column. `fonts: false`
 * leaves the embedded fonts out. Pure apart from the font files.
 */
export function brandShell(inner: string, o: { fonts?: boolean } = {}): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta name="theme-color" content="${T.page}"><meta name="robots" content="noindex"><title>EarnKit</title>` +
    `<style>${o.fonts === false ? '' : fontFaces()}${CSS}</style></head><body>` +
    `<header class="ek-top"><div class="ek-bar"><a class="ek-home" href="/"><svg viewBox="0 0 124 23" role="img" aria-label="EarnKit" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="${WORDMARK_D}" fill="currentColor"/></svg></a>` +
    `<nav class="ek-nav" aria-label="Site"><a href="/leaderboard">Leaderboard</a><a class="ek-wide" href="/feed">Feed</a><a class="ek-wide" href="/programs">Programs</a><a class="ek-wide" href="${DOCS}">Docs</a></nav></div></header>` +
    `<div class="ek-wrap"><main class="ek-panel">${inner}</main></div></body></html>`
  );
}
