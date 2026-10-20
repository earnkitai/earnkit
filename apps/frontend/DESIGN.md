# EarnKit design system (v3, spec 5.8)

Simpler, cleaner, premium. The feel of an established brand: a black page, white type, one accent,
and rows instead of cards. A builder understands a page in a few seconds and sees one next step.

## Rules

- No gradients, no glow, no box shadows, no decorative images, no video, no emoji, never an em dash
- One accent (Base blue). No orange world, no second blue in the UI
- Everything is sentence case. No all-caps labels, no eyebrows above headings
- No cards. A list is rows split by hairlines; a section title sits on the page
- One column, max 1120px, 16px gutters on a phone (32px from md)
- Every tap target is 44px or taller on a phone
- One primary action per view; do not repeat the same button down the page
- When in doubt, remove something

## Type

Self-hosted (`app/layout.tsx`, `app/fonts`): `font-funnel-display` is Funnel Display (headings and
numbers), `font-funnel-sans` is Funnel Sans (everything else). The scale is `app/components/common/Panel.tsx`:

| Constant | Use |
|---|---|
| `H1` | A page's title: 56px, 36px on a phone, weight 500, tight tracking |
| `H2` | A section's title: 32px, 24px on a phone |
| `LEDE` | The one line under a title: body colour, 16 to 18px, 36rem measure |
| `NUM` | A number: Funnel Display, tabular figures |

Body is 16 to 18px in `ek-body`. Short sentences. No text in all caps.

## Colour

One source: `lib/earnkit/theme.ts THEME`. `app/globals.css` mirrors each value as `--ek-p-*` (tested),
`tailwind.config.ts` reads the variables as `ek-*` tokens and holds no raw hex. Components use the
tokens only; never add a colour.

| Tailwind | THEME | Value | Use |
|---|---|---|---|
| `ek-page` | `page` | `#000000` | The page (body). `pageTop` is the same black |
| `ek-surface` | `surface` | `#0E1116` | A flat block where one is needed (an input, a code block). `surfaceTop` is the same |
| `ek-raised` | `raised` | `#161A22` | A raised spot (avatar, monogram, close button) |
| `ek-line`, `ek-line-strong` | `border`, `borderStrong` | white at 12%, 24% | Hairlines, outline buttons |
| `ek-chip`, `ek-chip-hover` | `chip`, `chipHover` | white at 6%, 12% | Chip fills, hover tints |
| `ek-track` | `track` | white at 10% | A ring's empty track, a bar's track |
| `ek-glass` | `glass` | black at 85% | The sticky header |
| `ek-text` | `text` | `#FFFFFF` | Headings, names, numbers, button text |
| `ek-body` | `body` | `#C9CDD6` | Body text |
| `ek-muted` | `muted` | `#7E8694` | Secondary lines, meta, labels |
| `ek-accent` | `accent` | `#3D7BFF` | Blue as text (a link, the won line, the Backing pill) and the primary button's hover |
| `ek-brand` | `brand` | `#0052FF` | Base blue as a fill: the primary button, dots, selection. Never as text |

`ek-brand-hover` is an alias of `ek-accent`. `glow` is transparent and exists only so the mirrors stay
complete. The three old brand hexes (a bright blue, a soft blue, a coin orange) are gone: the coin orange on
the Backing pill and the share card becomes brand blue (the pill's text is `ek-accent`).

### Contrast (WCAG, text 4.5:1 or more, graphics 3:1 or more)

| Colour | On page | On surface | On raised |
|---|---|---|---|
| `ek-text` | 21.0 | 18.9 | 17.4 |
| `ek-body` | 13.2 | 11.9 | 10.9 |
| `ek-muted` | 5.7 | 5.2 | 4.8 |
| `ek-accent` | 5.5 | 4.9 | 4.5 |
| `ek-brand` (a fill) | 3.7 | 3.3 | 3.0 |

White on `ek-brand`: 5.8:1. `ek-brand` is below 4.5 on black, so blue text is always `ek-accent`.

### The profile's palette (on purpose)

`app/[handle]/score-colors.ts PART_COLORS` is the one place with more than one hue. The owner keeps
it to make the profile fun and encouraging; do not recolour it to brand blue. The text shades are
4.5:1 or more on the page and the raised spot; the ring stops are 3:1 or more on the surface (tested).

| `PART_COLORS` | Stops | Used for |
|---|---|---|
| `ship` | `#3B82F6` to `#22D3EE` | Going live, commits |
| `weeks` | `#D946EF` to `#F472B6` | Streak and weeks chips (the shipping grid itself is hairline cells filled `ek-brand`) |
| `wins` | `#F59E0B` to `#FB923C` | Program wins |

The hero ring is white to `ek-accent` (`SCORE_COLORS.total`). The rings are the one gradient on the site.

## Layout (`Panel.tsx`)

| Constant | Look |
|---|---|
| `COLUMN` | The column: 1120px, 16px gutters, 32px from md. Header, footer and every page use it |
| `SECTION` | A section's vertical rhythm (56px, 96px from md) |
| `ROWS`, `ROW` | A list: each row opens with a hairline, the list closes with one; 16 to 20px of padding |
| `FilterChip.tsx Chip` | A filter: a hairline pill, 44px on a phone (36px from md), `aria-pressed`; on, it inverts to white with black text |
| `ProgramLogo` | A program's mark at 70% on a white disc (`ek-text`), so dark marks read on the page; the monogram on the raised disc |
| `SURFACE` | A flat block that opens with a hairline. Kept for callers; no radius, no gradient |

## Buttons (`Button.tsx`)

| Constant | Look |
|---|---|
| `BTN_PRIMARY` | Pill, 48px, `ek-brand` fill, white text, `ek-accent` on hover |
| `BTN_SECONDARY` | Pill, 48px, `ek-line-strong` outline, white text, `ek-chip` on hover |

The brandShell pages (`lib/earnkit/brand-page.ts`) read the same THEME and draw the same button, header and
type; so do the share card (`card-response.tsx`), the README badge (`badge.ts`) and the OG image (`scripts/og.mts`).

## Motion

The score ring draws in once (`.ek-arc`). Nothing else moves. `prefers-reduced-motion` turns the
draw off and collapses every transition.

## Browser surfaces

Selection is `ek-brand` with white text; the focus ring is `ek-accent`; the scrollbar is `ek-raised`
on the page. All in `globals.css`, from the tokens.
