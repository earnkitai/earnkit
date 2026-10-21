### Task 1: tokens, Kaftan, paintings, primitives (I: Opus, R: Opus)

**Files:**
- Create: `apps/frontend/lib/earnkit/site-theme.ts`, `apps/frontend/app/fonts/kaftan-serif.woff2` (copy of `/Users/jenil/Desktop/Code/jenil.ai/src/app/fonts/kaftan-serif.woff2`, 41,008 bytes), `apps/frontend/public/art/hero-eckersberg-{800,1600,3200}.jpg`, `apps/frontend/public/art/foot-panini-{700,1400,2800}.jpg`, `apps/frontend/app/components/site/{ui.ts,Serif.tsx,ScoreText.tsx,XHandle.tsx,Pager.tsx,SegTabs.tsx,useReducedMotion.ts}`
- Modify: `apps/frontend/app/globals.css`, `apps/frontend/tailwind.config.ts`, `apps/frontend/app/layout.tsx` (font only; Header swap is Task 5)
- Test: `apps/frontend/lib/earnkit/v31-site-tokens.test.ts`; update `v3-tokens.test.ts:64` (body background pin moves to `--ek-s-page`)

**Interfaces:**
- Produces: `SITE` (below), `siteVar(k: keyof typeof SITE): string` (`onBlueSoft` → `--ek-s-on-blue-soft`); Tailwind colours `s-<kebab key>` for every key; `font-kaftan` family; CSS class `.ek-serif` (`font-family: var(--font-kaftan), Georgia, serif; font-size-adjust: 0.36; font-weight: 400`); `ui.ts` class strings `CARD_NEUTRAL`, `CARD_BLUE`, `CARD_NAVY`, `CARD_RUST`, `CARD_LIGHT`, `CARD_PANEL`, `PILL_WHITE`, `PILL_BLUE`, `PAGE_COL_WIDE` (1240), `PAGE_COL` (1200), `H1_SITE` (72px, 48px phone), `H2_SITE` (64px, 44px phone); `<Serif as size className>`; `<ScoreText score size />` (band colour from `scoreBand`, Task 2); `<XHandle handle tone />` (11px X glyph + `@handle`, a link to `https://x.com/<handle>` with `rel="noopener noreferrer"`); `<Pager page pages href labels numbers tone />` (links, disabled ends as `aria-disabled` spans at 35% opacity, `min-h-11` on phone); `<SegTabs items: {label, href, on}[] tone />` (a pill rail of links with `aria-current`); `useReducedMotion(): boolean`.

`SITE` values (from the canvas; S11, S12 applied):

| Key | Value | Use |
|---|---|---|
| `page` | `#0B0C14` | Profile, leaderboard, docs, 404, body |
| `deep` | `#05060D` | Landing, feed (body switches via `body:has([data-ek-deep])`) |
| `cardTop` / `cardBottom` | `#121629` / `#0C0F1E` | Neutral card gradient (180deg) |
| `stepTop` / `stepBottom` | `#11152A` / `#0A0D1C` | Step cards, dark program and stat cards (160deg) |
| `line` / `lineHover` | `rgba(255,255,255,0.07)` / `rgba(255,255,255,0.16)` | Card borders |
| `blue` / `blueTop` / `blueBottom` | `#2D6BE0` / `#1E4FD8` / `#0E2A8A` | Blue card; blue gradient cards |
| `navy` / `navyInner` / `navyTrack` | `#142159` / `#0E1840` / `#22306A` | Score and token cards, ring track |
| `rust` / `rustTop` / `rustBottom` / `rustOn` / `rustOff` / `rustSoft` / `rustSub` | `#241008` / `#2A1209` / `#160904` / `#FF6A1F` / `#3A1A0C` / `#FF8A4C` / `#D9B8A6` | Streak, 404, rust cards |
| `rustLight` | `#FFB088` | Streak this-week line, leaderboard streak |
| `greenTop` / `greenBottom` / `greenSub` | `#0D2A1C` / `#07150E` / `#A6D9BC` | Applications stat card |
| `light` / `lightInner` / `lightHover` | `#FFFFFF` / `#F3F6FC` / `#E8EEFB` | Profile Activity and Docs install card |
| `ink` / `inkBody` / `inkMuted` / `inkSoft` | `#0B0C14` / `#2B3550` / `#5A6380` / `#3A4562` | Text on light cards |
| `panel` / `panelInner` / `panelHover` | `#161927` / `#1F2336` / `#1C2031` | Highlights, leaderboard list, docs side nav, filter rail |
| `text` / `muted` / `dim` | `#FFFFFF` / `#A8B0CC` / `#747C97` | Text |
| `cardBody` / `cardMeta` / `cardHandle` | `#B6BDD6` / `#7E87A6` / `#8A93B0` | Text on neutral cards |
| `onBlue` / `onBlueSoft` / `onNavy` / `onNavySoft` | `#FFFFFF` / `#F4F7FF` / `#A9C2FF` / `#C9D6FF` | Text on blue and navy |
| `iconBlue` / `barOn` / `barOff` | `#6FA0FF` / `#6FA0FF` / `#2A3C86` | Line icons, token bars |
| `live` | `#22C55E` | Live dot |
| `goodText` / `midText` / `lowText` | `#4ADE80` / `#FDBA74` / `#FCA5A5` | Score numbers (S13) |
| `goodLight` / `goodDeep` / `midLight` / `midDeep` / `lowLight` / `lowDeep` | `#6EE7A0` / `#16A34A` / `#FDBA74` / `#F97316` / `#FCA5A5` / `#E5484D` | Ring gradients |
| `chip` / `chipLine` / `chipText` | `rgba(255,255,255,0.08)` / `rgba(255,255,255,0.16)` / `#F3E6D3` | Hero chip |
| `stepLine` / `stepText` / `heroSub` | `rgba(255,255,255,0.08)` / `#8FB0E8` / `#E2E5F2` | Step card border and text, hero sub line |
| `scrim` / `inset` / `inset22` / `footLink` | `rgba(5,6,13,0.8)` / `rgba(0,0,0,0.16)` / `rgba(0,0,0,0.22)` / `#C9CFE6` | Sheet backdrop, profile project panel, selectors code box, footer links |

Painting files (from `/Users/jenil/earnkit-v31/.superpowers/art/pd/`: `hero-eckersberg.jpg` 3200x2073, `foot-panini.jpg` 2800x1533): resize with `sips -Z <w> -s format jpeg -s formatOptions <q>`; byte budgets: hero 3200 ≤ 900,000, 1600 ≤ 300,000, 800 ≤ 110,000; footer 2800 ≤ 600,000, 1400 ≤ 220,000, 700 ≤ 80,000 (lower the quality until under).

Font: in `layout.tsx` `const kaftan = localFont({ src: './fonts/kaftan-serif.woff2', variable: '--font-kaftan', weight: '400', display: 'swap' })`, added to the body's class list beside the two Funnel variables. Funnel Sans stays the body font (weights 400, 500, 600, 700 used). Funnel Display stays loaded for the untouched pages.

- [ ] **Step 1: Write the failing test** `v31-site-tokens.test.ts`:
  - `(a) every SITE key has a --ek-s-* line in globals.css with the same value, and :root declares nothing else under --ek-s-`
  - `(b) tailwind.config.ts maps s-<kebab> to var(--ek-s-<kebab>) for every key and holds no #hex`
  - `(c) contrast >= 4.5: text, muted, dim on page and deep; stepText on stepBottom; heroSub on deep; footLink on deep; cardBody, cardMeta, cardHandle on cardTop and cardBottom; muted on panel; onBlue, onBlueSoft on blue; onNavy, onNavySoft on navy; rustSub, rustSoft, rustLight on rust; inkBody, inkMuted, inkSoft on light and lightInner; greenSub on greenTop; the three score texts on cardTop and panel; dim is never used inside a component that sets a card class (scan app/ for files using CARD_ and s-dim together)`
  - `(d) the six art files exist under public/art, each JPEG (FFD8 header) with its width from the SOF0/SOF2 marker and under its byte budget`
  - `(e) app/fonts/kaftan-serif.woff2 starts with wOF2; layout.tsx loads it with variable --font-kaftan; globals.css .ek-serif sets font-size-adjust: 0.36`
  - `(f) globals.css has a prefers-reduced-motion block covering .ek-drift, .ek-pulse, .ek-twinkle and transitions; body background-color is var(--ek-s-page) and body:has([data-ek-deep]) is var(--ek-s-deep)`
  - `(g) Pager renders "1 of 3" with Previous disabled (aria-disabled) and Next linking to href(2); with numbers it renders 1..pages, the current one aria-current="page"; pages=1 renders nothing`
  - `(h) ScoreText: 70 -> s-good-text, 69 and 40 -> s-mid-text, 39 -> s-low-text`
- [ ] **Step 2:** Run it; expected FAIL (module `./site-theme` not found).
- [ ] **Step 3: Implement** the files above. Contrast helper: reuse the one in `v3-tokens.test.ts` (import or copy its `contrast()`).
- [ ] **Step 4:** Run the new test and `v3-tokens.test.ts`, `profile-pages.test.ts`, `v3-landing.test.ts` (its (i) scan); expected PASS. `cd apps/frontend && npx tsc --noEmit -p . && npx eslint .`
- [ ] **Step 5: Commit** `feat(v3.1 site): tokens, Kaftan, the two paintings and the site primitives`

---

