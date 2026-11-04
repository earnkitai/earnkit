# EarnKit design system (v5 site)

Owner-approved 2026-10-21. A dark page with big rounded colour cards, two paintings, one serif for names and
numbers and one sans for everything else. The v3.1 decision record is
`docs/design-docs-and-implementation-plans/v3.1-site-design.md`; v5 keeps its look and removes its surfaces. One source for colour: `lib/v5/site-theme.ts SITE`. `app/globals.css` mirrors each value as
`--ek-s-<kebab>` (tested), Tailwind reads them as `s-<kebab>`, and components never write a raw hex or a `/NN`
opacity modifier on a token class. Class strings live in `app/components/site/ui.ts`.

## Page and card colours

| Token (`s-`) | Value | Use |
|---|---|---|
| `page` | `#0B0C14` | Docs, terms, program guides, 404 |
| `deep` | `#05060D` | Landing (a page that renders `[data-ek-deep]` turns the body deep) |
| `card-top` to `card-bottom` | `#121629` to `#0C0F1E` | Neutral card: 180deg gradient, 7% white hairline, 16% on hover |
| `blue` | `#2D6BE0` | Blue card: accents and the install strip |
| `navy` | `#142159` | Navy card: counts and notes |
| `rust` | `#241008` | Rust card: the 404; accents `#FF6A1F`, `#FF8A4C` |
| `light` | `#FFFFFF` | Light card: the docs install card; inner `#F3F6FC`, hover `#E8EEFB` |
| `panel` | `#161927` | Panel: terms sections, docs side nav; inner `#1F2336` |

Text on a card (`site-theme.ts` holds a few more keys than the surfaces below use): white, `muted` `#A8B0CC` on page and panel, `on-blue-soft` `#F4F7FF` on blue, `on-navy` `#A9C2FF` on
navy, `rust-sub` `#D9B8A6` on rust, `ink` `#0B0C14` and `ink-body` `#2B3550` on light. `dim` `#747C97` is for the
page background only, never on a card (a test scans `app/`).

## Type

Kaftan Serif (`app/fonts/kaftan-serif.woff2`, `--font-kaftan`, weight 400, owner-owned licence) only for names,
headlines, big numbers and section titles, always through `.ek-serif` or `<Serif>`, which set `font-size-adjust: 0.36`
so it sits level with Funnel Sans. Funnel Sans (`app/fonts`) for everything else, including currency signs inside
Kaftan numbers (`Money.tsx`).

| Where | Desktop | Phone |
|---|---|---|
| Page title `H1_SITE` | 72px | 48px |
| Section title `H2_SITE` | 64px | 44px |
| Landing hero title | 96px, one line | `clamp(28px, 9.6vw, 96px)`, one line down to 320px |
| Hero sub, program text | 19px | 17px |
| Steps and Activity titles | 40px | 32px |
| Opportunities big number | 64px | 52px |
| Docs title | 56px | 40px |
| 404 | 140px | 96px |
| Body, rows | 15px | 15px |
| Meta, handles | 13px | 13px |

## Shape

Cards 32 to 48px (`CARD_NEUTRAL` 32px; blue, navy, rust, light and panel 36px;
the landing hero and footer 48px). Inner tiles 16 to 26px, rows 24px, code blocks 22px, pills and chips 999px.
Columns: `PAGE_COL_WIDE` 1240px (landing), `PAGE_COL` 1200px (everything else), 24px gutters from md.
White pill `PILL_WHITE` and blue pill `PILL_BLUE` are 44px tall.

## Paintings

Plain `<img srcSet>` of pre-sized JPEGs in `public/art` (no Next image optimizer: no new paid service, one file per
width, cached by the CDN). Public domain, from the Google Art Project scans. Re-exported 2026-10-22 from the full scans
(Panini from the 5401px Google Art Project scan), lanczos3 and a light sharpen, mozjpeg q88.

| Where | Painting | Files |
|---|---|---|
| Landing hero | C.W. Eckersberg, A View through Three Arches of the Third Storey of the Colosseum, 1815 | `hero-eckersberg-{800,1600,3200}.jpg`, high priority, 1600x1036 space |
| Full footer | G.P. Panini, Interior of the Pantheon, Rome, c. 1734, cropped to the dome | `foot-panini-{700,1400,2800}.jpg`, lazy |

The footer's headline sits under the oculus at every width (the crop is 45% down from md and 59% across on a phone, the
headline block drops below it), never on the bright sky. The footer's credit line is `site-copy.ts ART_CREDIT`: "Art: C.W. Eckersberg, 1815 · G.P. Panini, c. 1734". The hero
painting sits at `brightness(0.95) saturate(1.04) contrast(1.04)` so the art reads crisp, with a shade only behind the
words (owner "option 1", 2026-10-22): a soft ellipse centred on the chip, title, sub line and CTA (`hero-halo` to
`hero-halo-mid` to clear) and a low band under the agent marks (`hero-band`); the arches and sky stay clear. It
adds an SVG arch clip path and a sunset circle that follows the mouse; the footer a faint warm light that follows
the mouse. The footer's only social link is X, https://x.com/EarnKitAI (owner-confirmed 2026-10-22).

## Motion

`.ek-drift` (the hero's painting and light move a few px against the pointer, 1200ms), `.ek-twinkle`, link and card colour transitions (200ms, `motion-safe:`).
Under `prefers-reduced-motion` all of them stop, and the pointer components attach no listener
(`useReducedMotion()`); the footer light also stays off on touch screens (`(hover: none)`).

## Phone

Designed at 390px: no horizontal scroll, 16px side gutters (`px-4`), every tap target 44px or taller (a text link
inside a line uses `INLINE_LINK`'s 44px hit area), rails that wrap.
The agent tabs never scroll or fade: the install sheet and the docs install card wrap
them onto more rows (`segRail` 'sheet' and 'light', 26px radius), so every full name shows at every width (owner
2026-10-22, "in the modal tabs get cut off"; checked at 1440, 1024, 768, 390 and 320). The landing hero's ellipse is wider and higher on a phone (86% by
44% at 63%, not 44% by 36% at 68%) and its money chip is dark glass (`hero-chip-phone`), so the chip, title and sub
line hold over the painting (measured 2026-10-22 from screenshots, 95th-percentile background: chip 4.86:1, sub 9.29:1
at 1440; chip 9.24:1, sub 7.85:1 at 390).
Check every page at 1440x900 and 390x844 by eye before a release.

## Contrast

Every text-on-surface pair on the site is 4.5:1 or more. Two canvas colours were
adjusted to pass:

| Canvas | Shipped | Why |
|---|---|---|
| `#DCE6FF` on blue (3.92:1) | `on-blue-soft` `#F4F7FF` (4.57:1) | Secondary text on blue |
| `#6F7792` on page (4.39:1) | `dim` `#747C97` (4.71:1) | Used only on `page` and `deep` |

## Install tabs and the hero chip

Agent tabs in this order: Grok Bot (owner: most popular), Muse, OpenClaw, Hermes, Claude (claude.ai and the desktop app),
Claude Code, Cursor, Codex (`lib/v5/agents.ts`). Claude's steps are only the confirmed ones in
`docs/design-docs-and-implementation-plans/v3.1-install-research.md`, the EarnKit link above them on /docs, and the
Free plan's one-connector limit. "A connector lets your AI use EarnKit." (`agents.tsx CONNECTOR_LINE`) is said once,
above the tabs (the sheet's intro, the docs card), so the default Grok Bot tab has it too. Both tab rails are full tab
patterns (ids, `aria-controls`, roving `tabIndex`, arrows and Home/End via `tabKeyTarget`). ChatGPT gets a tab only once OpenAI's own help page
confirms the steps (unreadable on 2026-10-22). /docs carries "No GitHub yet?" on the install card (a light-inner tile:
Lovable and Bolt steps, the v0 note; no Replit until confirmed).

The hero chip is the open programs' money, "$400K in grants open now" (`site-copy.ts heroChipText`); no open money, no chip.
It is 44px at least (36px from md) with vertical padding and a 22px radius, so a long chip wraps to two balanced lines on a
320px phone. The cards below list every open program, each with its chain.

## Copy rules

Sentence case, short, money first, no emoji, never an em dash. Every number is real data. The words live in
`lib/v5/site-copy.ts`.
