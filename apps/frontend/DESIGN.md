# EarnKit design system

## Goal

Simple, bold, calm, modern, friendly, obvious. Understandable in a few seconds.
The design must never make a simple idea look complicated.

## Core rule

One section communicates one idea.

- Do not add UI to fill empty space
- Do not turn every piece of information into a card
- Never put cards inside cards
- Do not decorate information that is already clear
- When in doubt, remove something

## Personality

Optimistic and direct. Not corporate, luxury, cyberpunk, trader-focused,
DeFi-looking, developer-tool-looking, or overly technical. It should feel like a
simple consumer product for AI agents.

## Typography

Already wired via `next/font/google` in `app/layout.tsx`, exposed to Tailwind as
`font-funnel-display` and `font-funnel-sans`.

- Headings — Funnel Display, Medium or SemiBold. Bold and simple, never
  condensed or aggressive. Display capped at 6rem.
- Body — Funnel Sans, Regular or Light. Medium for buttons, labels, navigation.
- Short sentences. No dense paragraphs. Body measure 65–75ch.

## Color

Figma Brand Design System is the source of truth. Do not invent brand colors.
Tailwind tokens are named (`ek-*`); the legacy `colorN` aliases are retained so
untouched pages keep rendering.

### Backgrounds
| Token | Hex | Use |
|---|---|---|
| `ek-base` | `#1A2238` | Main page background |
| `ek-black` | `#0A0B1A` | Very dark contrast |
| `ek-navy-deep` | `#0F1839` | Darker sections, text on bright blue |
| `ek-navy` | `#112969` | Cards, navigation, surfaces |

### Blue scale
| Token | Hex |
|---|---|
| `ek-blue-deep` | `#0D3991` |
| `ek-blue-strong` | `#0A4EC2` |
| `ek-blue` | `#2E70EA` |
| `ek-blue-bright` | `#579DFF` |
| `ek-blue-soft` | `#A3C5FE` |
| `ek-blue-light` | `#E5EEFC` |
| `ek-white` | `#F6F9FE` |

### Accents — rare and intentional
`ek-pink` `#D76CEF` · `ek-purple` `#562AA7` · `ek-orange` `#FE6C11` ·
`ek-brown` `#210800` · `ek-purple-paint` `#8A63D2`

### Usage
`#579DFF` is the main action color. `#2E70EA` and `#0A4EC2` carry secondary blue
emphasis. `#A3C5FE` is muted/secondary text. `#E5EEFC` and `#F6F9FE` are
readable text on dark. Do not make the product multicolored merely because the
accents exist. No colors outside this system except functional success, warning
and error states.

## Verified contrast pairs

Measured, all ≥ 4.5:1. Use these; do not improvise text/background pairs.

| Text | On | Ratio |
|---|---|---|
| `#E5EEFC` | `#1A2238` | 13.4:1 |
| `#A3C5FE` | `#1A2238` | 9.0:1 |
| `#579DFF` | `#1A2238` | 5.7:1 |
| `#E5EEFC` | `#112969` | 11.3:1 |
| `#A3C5FE` | `#112969` | 7.6:1 |
| `#0F1839` | `#579DFF` | 6.4:1 |

Known failures from the previous design, now retired: `#0D3991` on `#579DFF`
(3.8:1), `#E5EEFC` on `#2E70EA` (3.9:1), `#2E70EA` on `#0F1839` (3.8:1).

## Orange world (from the Figma landing, source of truth)

The page alternates blue and orange worlds for rhythm. Orange sections use:

| Token | Hex | Use |
|---|---|---|
| `ek-ember` | `#140300` | Orange-section panel background |
| `ek-card-brown` | `#210800` | Cards inside orange sections |
| `ek-amber` | `#FC9E19` | Orange headings, icons |
| `ek-cream` | `#FDF1DF` | Body text on ember/brown |

Icons in orange cards are large (64px) with an amber glow
(`drop-shadow(0 0 14px rgba(252,158,25,0.55))`).

## Graphics (exported from Figma → public/images/graphics/)

- `city.jpg` — LED-matrix skyline; hero background (agents), final panel
  (ecosystems). From Graphics page node 875:4280.
- `icon-grid.png` — 3×3 glowing orange EarnKit marks; how-it-works right
  panel. Node 704:2984.
- `builder.png` — glowing builder-at-laptop; ember banner. Node 756:3540
  (467px wide screenshot — refetch at full 1024px when the Figma MCP rate
  limit resets).
- `octo.jpg` — LED octopus; landing final panel. Node 973:4281.
- Not yet fetched (rate limit): the gold coin (node 1309:6379).

## Motion

One authored moment — the hero entrance. Sections below the fold do not each
get their own identical entrance animation. No infinite auto-scrolling content.

## Browser surfaces

Text selection, scrollbar, focus rings and caret are themed from the palette in
`globals.css`. They are part of the design, not browser defaults.
