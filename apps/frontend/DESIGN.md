# EarnKit design system (R18)

## Goal

Simple, calm, modern, obvious. A builder understands a page in a few seconds
and sees one next step. The design never makes a simple idea look complicated.

## Core rules

One section communicates one idea.

- Do not add UI to fill empty space
- Never put cards inside cards
- No eyebrow labels above headings; the heading carries its own weight
- No uppercase labels
- No decoration that is not information (no floating coins, glows, meshes)
- One primary action per view; do not repeat the same button down the page
- When in doubt, remove something

## Typography

Self-hosted in `app/layout.tsx` (`app/fonts`), exposed to Tailwind as
`font-funnel-display` (headings, numbers) and `font-funnel-sans` (everything else).

The scale lives in `app/components/common/Panel.tsx`:

| Constant | Use |
|---|---|
| `H1` | A page's title (2rem, 3.5rem from md) |
| `H2` | A section's title (1.5rem, 2.25rem from md) |
| `LEDE` | The one line under a page or section title (muted) |

The hero title is the one larger exception. Short sentences; body measure 65-75ch.

## Color

One source of truth: `lib/earnkit/theme.ts THEME`. `app/globals.css` defines each
value as `--ek-p-*` (a test checks they match), and `tailwind.config.ts` reads them
as named tokens. Do not use raw hex in components; do not add colors.

### Page tokens

| Tailwind | THEME | Hex | Use |
|---|---|---|---|
| `ek-page` | `page` | `#070D24` | The page (body), with a soft blue glow at the top (`pageTop`, `glow`) |
| `ek-surface-top` → `ek-surface` | `surfaceTop`, `surface` | `#111C3D` → `#0C1530` | The card surface (a top-down gradient) |
| `ek-raised` | `raised` | `#16224A` | A raised spot on a card (avatar, monogram, close button) |
| `ek-chip`, `ek-chip-hover` | `chip`, `chipHover` | brand blue at 10%, 18% | Chips, hover tints, filled tabs |
| `ek-line`, `ek-line-strong` | `border`, `borderStrong` | brand blue at 12%, 20% | Hairlines, card borders, outline buttons |
| `ek-glass` | `glass` | page at 85% | The sticky header |
| `ek-text` | `text` | `#F5F8FF` | Headings, names, numbers |
| `ek-body` | `body` | `#C8D4EE` | Body text |
| `ek-muted` | `muted` | `#94A3C4` | Secondary lines, meta, labels |
| `ek-accent` | `accent` | `#A3C5FE` | A quiet text link ("See all") |
| `ek-blue-bright` | `brand` | `#579DFF` | The primary button |

### Brand colors kept in Tailwind

| Token | Hex | Use |
|---|---|---|
| `ek-blue-bright` | `#579DFF` | Primary action (same as THEME.brand) |
| `ek-blue-soft` | `#A3C5FE` | Button hover, focus rings |
| `ek-score-orange` | `#FF7A1A` | A coin and program wins only |

### The profile's accent palette (on purpose)

`app/[handle]/score-colors.ts` holds #46's gradient hues. They are the profile's
accent palette, used on purpose to make the profile fun and encouraging for the
builder. Do not recolor them to brand blue.

| `PART_COLORS` | Gradient | Used for |
|---|---|---|
| `ship` | `#3B82F6` → `#22D3EE` | Going live, commits (chip dot) |
| `weeks` | `#D946EF` → `#F472B6` | The 52-week shipping grid, streaks (chip dot) |
| `wins` | `#F59E0B` → `#FB923C` | Program wins (chip dot) |

The score ring is white to `ek-accent` (`SCORE_COLORS.total`). `UpdateCard` (the
profile's ship log, the feed, the landing carousel) reads its chip dot from
`PART_COLORS`; nothing repeats the hex values.

There is no `ek-base` page and no orange world.

## Verified contrast (all text pairs ≥ 4.5:1)

| Text | On page `#070D24` | On surface `#0C1530` | On surface top `#111C3D` |
|---|---|---|---|
| `ek-text` `#F5F8FF` | 18.1 | 16.9 | 15.7 |
| `ek-body` `#C8D4EE` | 12.9 | 12.1 | 11.2 |
| `ek-muted` `#94A3C4` | 7.6 | 7.1 | 6.6 |
| `ek-accent` `#A3C5FE` | 11.0 | 10.3 | 9.5 |
| `ek-blue-bright` `#579DFF` | 7.0 | 6.6 | 6.1 |
| `ek-score-orange` `#FF7A1A` | 7.4 | 6.9 | 6.4 |

The `PART_COLORS` text shades are 4.5:1 or more on the page and both surface
stops, and their gradient stops 3:1 or more as graphics (profile-pages.test.ts 10.5).

Button text `ek-page` on `ek-blue-bright`: 7.0:1.

## Surfaces and layout (`app/components/common/Panel.tsx`)

- `SURFACE`: the one card (24px radius, `ek-line` border, the surface gradient).
  `Panel` is a section on it. Lists sit on one card, split by `ek-line` hairlines.
- `COLUMN`: the page column (max-w-6xl, 16px gutter, 32px from md). The header,
  footer and every page use it; the feed's reading column is narrower (max-w-4xl).
- Section titles sit on the page, not inside a card.

## Buttons (`app/components/common/Button.tsx`)

| Constant | Look |
|---|---|
| `BTN_PRIMARY` | Brand blue, page-colored text, full radius, 48px tall |
| `BTN_SECONDARY` | `ek-line-strong` outline, `ek-text`, chip tint on hover, 48px tall |

Every tap target is at least 44px on a phone (chips, tabs and the header button
are 44px tall below md). The brandShell pages (`lib/earnkit/brand-page.ts`) use
the same tokens and the same brand-blue button.

## Header and footer

- `Header.tsx`: one sticky glass bar on every page: the wordmark, Leaderboard,
  Feed and Docs (from sm), and "Add to your agent".
- `Footer.tsx`: a hairline, the wordmark and tagline, the links in one row, the
  company line.

## Graphics

- `public/images/graphics/builder-blue.png`: the builder, dim and masked, behind
  the landing hero. The only illustration.
- Chain logos (`public/images/chains`) and program logos (`public/programs`).

## Motion

The score ring draws in once (`.ek-arc`). Backed by scrolls slowly and pauses
on hover. Nothing else moves; reduced motion turns both off.

## Browser surfaces

Text selection, scrollbar and focus rings are themed from the tokens in
`globals.css`. They are part of the design, not browser defaults.
