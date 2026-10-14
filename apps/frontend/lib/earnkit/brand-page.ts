import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORDMARK_D } from '../../app/components/ui/Logo';

/**
 * v2.12.1 T11 fix round 2: the look of the claim, done and wallet pages (route handlers that answer
 * HTML with no script of ours but the wallet page's nonce one). The profile's navy design system in
 * one inline <style>: the site's navy, the panel shape, Funnel Display for the headline (embedded as
 * data: fonts only where the page's CSP allows fonts; the wallet page's CSP stays as it is and falls
 * back to the system font), one primary button, a thin orange to purple accent. Nothing external is
 * loaded, so no CSP changes.
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

let faces: string | null = null;
const fontFaces = () =>
  (faces ??= ([500, 700] as const)
    .map((w) => {
      const f = fontFile(w);
      return f ? `@font-face{font-family:"Funnel Display";font-weight:${w};font-style:normal;font-display:swap;src:url(data:font/woff;base64,${f.toString('base64')}) format("woff")}` : '';
    })
    .join(''));

const CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;min-height:100dvh;background:#1A2238;color:#F6F9FE;font:400 1rem/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;align-items:center;padding:24px 16px 48px}
.ek-top{width:100%;max-width:34rem;display:flex;justify-content:center;padding:8px 0 24px;color:#E5EEFC}
.ek-top svg{height:26px;width:auto}
.ek-panel{position:relative;overflow:hidden;width:100%;max-width:34rem;background:#0F1839;border-radius:32px;padding:40px 24px 32px;box-shadow:0 1px 0 rgba(163,197,254,.06) inset;background-image:radial-gradient(circle at 100% 0%,rgba(155,107,255,.16),transparent 55%),radial-gradient(circle at 0% 100%,rgba(255,122,26,.07),transparent 50%)}
.ek-accent{display:block;width:48px;height:4px;border-radius:4px;background:linear-gradient(90deg,#FF7A1A,#9B6BFF);margin-bottom:24px}
h1{font-family:"Funnel Display",ui-sans-serif,system-ui,sans-serif;font-weight:700;font-size:2rem;line-height:1.1;letter-spacing:-.02em;margin:0;text-wrap:balance}
.ek-line{margin:16px 0 0;font-size:1.0625rem;line-height:1.55;color:#E5EEFC}
.ek-url{margin:12px 0 0;font-family:"Funnel Display",ui-sans-serif,system-ui,sans-serif;font-weight:500;font-size:1.125rem;color:#A3C5FE;word-break:break-all}
.ek-first{margin-top:0;font-size:1.1875rem}
.ek-small{margin:20px 0 0;font-size:.875rem;line-height:1.55;color:#A3C5FE}
.ek-actions{margin-top:28px;display:flex;flex-direction:column;gap:12px}
form{margin:0}
.ek-btn{display:flex;width:100%;min-height:56px;align-items:center;justify-content:center;gap:10px;border:0;border-radius:999px;background:#579DFF;color:#0F1839;font:600 1.0625rem/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;cursor:pointer;transition:background-color .15s}
.ek-btn:hover{background:#A3C5FE}
.ek-btn:focus-visible,.ek-link:focus-visible{outline:3px solid #F6F9FE;outline-offset:3px}
.ek-btn svg{width:18px;height:18px}
.ek-links{margin:24px 0 0;padding:20px 0 0;border-top:1px solid rgba(163,197,254,.12);list-style:none;display:flex;flex-direction:column;gap:4px}
.ek-link{display:inline-flex;min-height:44px;align-items:center;color:#A3C5FE;text-decoration:underline;text-decoration-color:rgba(163,197,254,.4);text-underline-offset:4px;font-size:.9375rem}
.ek-link:hover{color:#F6F9FE}
.ek-status{margin:16px 0 0;min-height:1.5em;font-size:.9375rem;color:#E5EEFC}

@media (min-width:640px){body{padding-top:56px}.ek-panel{padding:56px 48px 44px;border-radius:40px}h1{font-size:2.5rem}}
@media (prefers-reduced-motion:reduce){.ek-btn{transition:none}}
`;

/** X's logo for the "Continue with X" button. */
export const X_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>';

/**
 * The page: the wordmark above one panel holding `inner` (already escaped HTML). `fonts`: embed
 * Funnel Display (only where the page's CSP allows fonts). Pure apart from the font files.
 */
export function brandShell(inner: string, o: { title?: string; fonts?: boolean } = {}): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta name="theme-color" content="#1A2238"><meta name="robots" content="noindex"><title>${o.title ?? 'EarnKit'}</title>` +
    `<style>${o.fonts === false ? '' : fontFaces()}${CSS}</style></head><body>` +
    `<header class="ek-top"><svg viewBox="0 0 124 23" role="img" aria-label="EarnKit" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="${WORDMARK_D}" fill="currentColor"/></svg></header>` +
    `<main class="ek-panel"><span class="ek-accent" aria-hidden="true"></span>${inner}</main></body></html>`
  );
}
