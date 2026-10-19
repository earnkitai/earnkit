import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORDMARK_D } from '../../app/components/ui/Logo';
import { DOCS } from './footer-links';

/**
 * v2.12.1 T11 fix round 2: the look of the claim, done and wallet pages (route handlers that answer
 * HTML with no script of ours but the wallet page's nonce one). The profile's navy design system in
 * one inline <style>. v2 (premium dark, same as the profile and feed): a near-black page, a slim top
 * bar (wordmark plus quiet links), one centered dark gradient card, Funnel Display for the headline (embedded as
 * data: fonts; the wallet page's CSP allows font-src data: for them), one white primary button, a thin blue to cyan accent. Nothing external is
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
body{min-height:100vh;min-height:100dvh;background:#0B0B0F;color:#F5F6F8;font:400 1rem/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;align-items:center}
.ek-top{position:sticky;top:0;z-index:1;width:100%;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:rgba(11,11,15,.92);border-bottom:1px solid rgba(255,255,255,.06)}
.ek-home{display:inline-flex;align-items:center;min-height:44px;color:#F5F6F8}
.ek-home svg{height:18px;width:auto}
.ek-nav{display:flex;gap:4px}
.ek-nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;color:#9BA1AC;font-size:.875rem;text-decoration:none;border-radius:8px}
.ek-nav a:hover{color:#F5F6F8}
.ek-wrap{width:100%;display:flex;justify-content:center;padding:32px 16px 56px}
.ek-panel{position:relative;overflow:hidden;width:100%;max-width:30rem;border:1px solid rgba(255,255,255,.06);border-radius:24px;padding:32px 24px 28px;background:linear-gradient(180deg,#17191F,#111318);box-shadow:0 24px 64px -32px rgba(0,0,0,.8)}
.ek-accent{display:block;width:40px;height:3px;border-radius:3px;background:linear-gradient(90deg,#2563EB,#22D3EE);margin-bottom:24px}
.ek-mark{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:14px;margin-bottom:20px;background:#1C1F26;border:1px solid rgba(255,255,255,.08);color:#F5F6F8}
.ek-mark svg{width:24px;height:24px}
h1{font-family:"Funnel Display",ui-sans-serif,system-ui,sans-serif;font-weight:700;font-size:1.75rem;line-height:1.15;letter-spacing:-.02em;margin:0;text-wrap:balance}
.ek-line{margin:12px 0 0;font-size:1rem;line-height:1.55;color:#C9CDD4}
.ek-url{margin:12px 0 0;font-family:"Funnel Display",ui-sans-serif,system-ui,sans-serif;font-weight:500;font-size:1.0625rem;color:#67E8F9;word-break:break-all}
.ek-first{margin-top:0;font-size:1.0625rem;color:#F5F6F8}
.ek-small{margin:16px 0 0;font-size:.875rem;line-height:1.55;color:#9BA1AC}
.ek-rows{margin:24px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.ek-rows dd{margin:0}
.ek-row{margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.ek-k{min-width:3rem;font-size:.8125rem;color:#9BA1AC}
.ek-chip{display:inline-flex;align-items:center;gap:8px;max-width:100%;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#F5F6F8;font:500 .875rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.ek-chip svg{flex:none;width:14px;height:14px;color:#9BA1AC}
.ek-note{margin:20px 0 0;padding:12px 14px;border-radius:14px;background:rgba(34,211,238,.06);border:1px solid rgba(34,211,238,.18);color:#A5F3FC;font-size:.9375rem;line-height:1.45}
.ek-note strong{color:#F5F6F8;font-weight:600}
.ek-actions{margin-top:24px;display:flex;flex-direction:column;gap:12px}
form{margin:0}
.ek-btn{display:flex;width:100%;min-height:52px;align-items:center;justify-content:center;gap:10px;border:0;border-radius:999px;background:#F5F6F8;color:#0B0B0F;font:600 1rem/1 ui-sans-serif,system-ui,sans-serif;text-decoration:none;cursor:pointer;transition:background-color .15s}
.ek-btn:hover{background:#FFFFFF}
.ek-btn:focus-visible,.ek-link:focus-visible,.ek-nav a:focus-visible,.ek-home:focus-visible{outline:2px solid #67E8F9;outline-offset:3px}
.ek-btn svg{width:20px;height:20px}
.ek-links{margin:24px 0 0;padding:16px 0 0;border-top:1px solid rgba(255,255,255,.06);list-style:none;display:flex;flex-direction:column;gap:4px}
.ek-link{display:inline-flex;min-height:44px;align-items:center;color:#C9CDD4;text-decoration:underline;text-decoration-color:rgba(255,255,255,.25);text-underline-offset:4px;font-size:.9375rem}
.ek-link:hover{color:#F5F6F8}
.ek-status{margin:16px 0 0;min-height:1.5em;font-size:.9375rem;color:#C9CDD4}
.ek-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

@media (min-width:640px){.ek-row{flex-direction:row;align-items:center;gap:12px}.ek-top{height:56px;padding:0 32px}.ek-wrap{padding-top:72px}.ek-panel{padding:40px 40px 36px}h1{font-size:2rem}}
@media (prefers-reduced-motion:reduce){.ek-btn{transition:none}}
`;

/** GitHub's mark, for the "Continue with GitHub" button and the repo chip. */
export const GITHUB_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-1.96c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>';

/** X's logo for the "Continue with X" button. */
export const X_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>';

/**
 * The page: the wordmark above one panel holding `inner` (already escaped HTML). `fonts: false`
 * leaves Funnel Display out. Pure apart from the font files.
 */
export function brandShell(inner: string, o: { fonts?: boolean } = {}): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta name="theme-color" content="#0B0B0F"><meta name="robots" content="noindex"><title>EarnKit</title>` +
    `<style>${o.fonts === false ? '' : fontFaces()}${CSS}</style></head><body>` +
    `<header class="ek-top"><a class="ek-home" href="/"><svg viewBox="0 0 124 23" role="img" aria-label="EarnKit" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="${WORDMARK_D}" fill="currentColor"/></svg></a>` +
    `<nav class="ek-nav" aria-label="Site"><a href="/bench">Bench</a><a href="/feed">Feed</a><a href="${DOCS}">Docs</a></nav></header>` +
    `<div class="ek-wrap"><main class="ek-panel"><span class="ek-accent" aria-hidden="true"></span>${inner}</main></div></body></html>`
  );
}
