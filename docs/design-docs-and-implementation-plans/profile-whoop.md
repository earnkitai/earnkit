# Profile: calm, data-forward score layout (profile-whoop)

Scope: the Bench profile at earnkit.com/<handle> (`app/[handle]/BenchProfileView.tsx`) and its score
components. Presentation only: no data, formula, query or route change.

- The total score is one white ring beside the rank. The rank line ("Top 4% on the Bench", or
  "#3 of 12 ...") shows its number large; chain lines sit under it.
- Each of the four existing parts (score-v2: Shipped, Used, Earned, Consistency) is its own ring in
  one fixed color (`app/[handle]/score-colors.ts`, all brand tokens, each >= 4.5:1 on the panel),
  with one sentence on what counts, taken from the published formula.
- The 52-week grid uses Consistency's color. No gradients, glows or blurred light.
- The arcs draw in once (`.ek-arc` in globals.css), never under prefers-reduced-motion.
- Same rules as before: no ring without a rank line, Confirming hides score, parts and grid.

Open product gap (not changed here): the one-pager wants 3 scores (Consistency, Momentum,
Originality) + percentile. Momentum and Originality don't exist in the data; Used and Earned are
raw-traction parts. The layout takes any part list, so swapping the parts later is a data change.

Screenshots: `docs/screenshots/profile-whoop/` (fixture `lib/earnkit/fixtures/profile-data.ts`,
avatar and Raising pill off, headless Chrome against `next dev`, reduced motion).
