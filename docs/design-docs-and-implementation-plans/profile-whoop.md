# Profile: premium dark, data-forward score layout (profile-whoop, v2)

Scope: the profile at earnkit.com/<handle> (`app/[handle]/`). Presentation only: no data, formula,
query or route change. v2 follows Jenil's direction (2026-10-19): more premium, gradients, closer to
WHOOP, and a slim top bar.

- Page: near-black `#0B0B0F`. Cards are dark surfaces with a 1px `white/6%` border and a soft
  top-down gradient (`#17191F` to `#111318`). Footer and Ship log cards follow the same style, scoped
  under `[data-ek-premium]` in globals.css, so no other page changes.
- Top bar (`ProfileTopBar.tsx`): 48px tall (56px from md). It holds the small wordmark, quiet links
  (Bench, Feed, Docs) and a small, subtle "Add to your agent" button, with a hairline under it. It is
  sticky. On this page the site header (desktop block and mobile bottom bar) is hidden via
  `body:has([data-ek-premium]) [data-ek-header]`.
- Total score: the hero ring, white to soft grey, with big tabular numerals beside the rank. The
  percentile is set large under a small uppercase "RANK" label, with the chain lines under it.
- Parts (score-v2: Shipped, Used, Earned, Consistency): each gets a card with a gradient ring in its
  hue family (`score-colors.ts`):
  - Shipped: deep blue to cyan.
  - Used: indigo to violet.
  - Earned: amber to orange.
  - Consistency: magenta to pink.

  The rings have a rounded cap, a thin dim track and a soft glow in their own color (25% alpha). Each
  card also has a small uppercase label in its hue and one muted sentence from the published formula.
- 52-week grid: Consistency's gradient, brighter toward the newest week.
- Accessibility:
  - Text colors are >= 4.5:1 on the page and on both surface stops (test 10.5).
  - Every ring has a text equivalent.
  - The rank line is read whole.
  - The arc draw-in is off under prefers-reduced-motion.
- Same rules as before: no ring without a rank line, and while Confirming, the score, parts and grid
  are hidden.
- These colors sit outside the DESIGN.md brand table, by the owner's direction for this page.

Open product gap (not changed here): the one-pager wants 3 scores (Consistency, Momentum,
Originality) plus a percentile. Momentum and Originality don't exist in the data, and Used and
Earned are raw-traction parts.

Screenshots: `docs/screenshots/profile-whoop/`, headless Chrome against `next dev` with the fixture
`lib/earnkit/fixtures/profile-data.ts` (avatar and Raising pill off) and reduced motion.
