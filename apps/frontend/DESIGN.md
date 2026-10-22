# EarnKit design system (v3.1 site)

Owner-approved 2026-10-21. A dark page with big rounded colour cards, two paintings, one serif for names and
numbers and one sans for everything else. The decision record is
`docs/design-docs-and-implementation-plans/v3.1-site-design.md`; the pixels are the boards in
`v3.1-site-boards/`. One source for colour: `lib/earnkit/site-theme.ts SITE`. `app/globals.css` mirrors each value as
`--ek-s-<kebab>` (tested), Tailwind reads them as `s-<kebab>`, and components never write a raw hex or a `/NN`
opacity modifier on a token class. Class strings live in `app/components/site/ui.ts`.

## Page and card colours

| Token (`s-`) | Value | Use |
|---|---|---|
| `page` | `#0B0C14` | Profile, leaderboard, docs, terms, guides, 404 |
| `deep` | `#05060D` | Landing and feed (a page that renders `[data-ek-deep]` turns the body deep) |
| `card-top` to `card-bottom` | `#121629` to `#0C0F1E` | Neutral card: 180deg gradient, 7% white hairline, 16% on hover |
| `blue` | `#2D6BE0` | Blue card: profile hero, podium #1, selectors strip |
| `navy` | `#142159` | Navy card: Shipping score, Token card, podium #2 |
| `rust` | `#241008` | Rust card: Streak, podium #3, 404; accents `#FF6A1F`, `#FF8A4C` |
| `light` | `#FFFFFF` | Light card: profile Activity, docs install; inner `#F3F6FC`, hover `#E8EEFB` |
| `panel` | `#161927` | Panel: Highlights, leaderboard list, docs side nav; inner `#1F2336` |

Text on a card: white, `muted` `#A8B0CC` on page and panel, `on-blue-soft` `#F4F7FF` on blue, `on-navy` `#A9C2FF` on
navy, `rust-sub` `#D9B8A6` on rust, `ink` `#0B0C14` and `ink-body` `#2B3550` on light. `dim` `#747C97` is for the
page background only, never on a card (a test scans `app/`).

## Score bands

One hue per band, light to deep, never multi-hue. The number is text, the ring is a gradient with round caps.

| Band | Score | Text | Ring |
|---|---|---|---|
| good | 70 and up | `#4ADE80` | `#6EE7A0` to `#16A34A` |
| mid | 40 to 69 | `#FDBA74` | `#FDBA74` to `#F97316` |
| low | under 40 | `#FCA5A5` | `#FCA5A5` to `#E5484D` |

One set of text colours on every page (`site-copy.ts scoreBand`, `ScoreText`). A score number never stands alone: on the
landing's Activity cards, feed rows and leaderboard rows a quiet 12px "Shipping" caption sits under it (`ScoreText unit`,
`card-meta` on cards, `muted` on the panel); the podium says "Shipping" beside it. Streaks beside a name read "5-week
streak" (`streakRun`); the profile's Streak card keeps "5 weeks" under its title. The leaderboard's count line and the
profile's score card say the number is read from GitHub commits, not self-reported (the card links to `/docs#score`).

## Highlights

Every item is a fact a judge can verify in one click, and links to its proof: the live site, the first contract on
Basescan, the Builder Code's file on GitHub, the repo, the program's guide. At most 5, in that order (live, contracts
on Base, Builder Code, track record, won or applied), each only when true. A linked row is the whole tap target (62px)
and on hover fills with `panel-hover` inside a `line` hairline. Proof on another site opens in a new tab and ends in a
small muted arrow (lucide arrow-up-right, 16px); a program guide is EarnKit's own page, opens in the same tab and ends in
a chevron. An item without proof a visitor can open (a private repo's file or page) has no link and no mark. Uptime
reads "Up N of the last D days checked" (only days EarnKit read). No run of weeks here (the Streak card owns it). Icons are lucide strokes on the `panel-inner` tile: globe, box,
code brackets, git commit, send.

## Pictures and program marks

A builder's picture is their X one (pbs.twimg.com), else the GitHub one of their proven login
(`https://avatars.githubusercontent.com/<login>?s=200`), else their initial (`page-data.ts avatarUrl`, `Avatar`). A
program card's mark is a local file under `public/programs`; without one the organizer's name sits on the same white
tile (Alliance), never initials, and nothing is fetched from another site. A card with no deadline says "Rolling,
apply anytime".

## Standing metals

A pill beside the name: gold top 5%, silver top 10%, bronze top 25% (`site-copy.ts standingTier`; none outside the
top 25%). Each is a 135deg gradient with its ink, a soft glow and a top shine (`ui.ts METAL`). Label "Top N% on Base"
when the builder's project is on Base and the Base pool has 10 or more, else "Top N% of builders" from the whole
pool of 10 or more. Under 10 ranked builders: no pill, no "#N" on the profile or the leaderboard.

## Few builders

The site launches with one builder and must look intentional at 1 to 9 (all data-driven, the same pages at 10 and up):

| Where | Under the rule | From the rule |
|---|---|---|
| Leaderboard (RANK_MIN_POOL, 10 ranked) | No podium, no filter rail, every builder a plain panel row, the line "Scored by how often they ship, out of 100." (no count), the panel ends with one quiet line "Be the next builder here." and the white install pill | Podium, All / Base / Backed, "N builders, ranked by how often they ship" |
| Landing Activity (3 cards) | One card a builder; the invite card once, two columns wide beside one card | Three builders' cards |
| Feed stats (3 builders shipped that week) | No stat cards | The four cards |
| Feed rows (3 rows in the week) | The invite ("Your week goes here.") as the last row | No invite |

An empty filter says what is missing: "No builder on Base yet.", "No builder has opened Backing yet.", with "Show
everyone". Every invite's button opens the install sheet (`InstallButton`, `site/InviteRow.tsx`).

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
| Profile name | 60px | 44px |
| Profile Streak, podium name | 40px, 34px | same |
| Feed stat number | 64px | 48px |
| Docs title | 56px | 40px |
| 404 | 140px | 96px |
| Body, rows | 15px | 15px |
| Meta, handles | 13px | 13px |

## Shape

Cards 32 to 48px (`CARD_NEUTRAL` 32px; blue, navy, rust, light and panel 36px, 28px on a phone for the profile;
the landing hero and footer 48px). Inner tiles 16 to 26px, rows 24px, code blocks 22px, pills and chips 999px.
Columns: `PAGE_COL_WIDE` 1240px (landing, feed), `PAGE_COL` 1200px (everything else), 24px gutters from md.
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

`.ek-drift` (the hero's painting and light move a few px against the pointer, 1200ms), `.ek-pulse` (the green
"shipped" dot, only within 7 days of a push), `.ek-twinkle`, link and card colour transitions (200ms, `motion-safe:`).
Under `prefers-reduced-motion` all of them stop, and the pointer components attach no listener
(`useReducedMotion()`); the footer light also stays off on touch screens (`(hover: none)`).

## Phone

Designed at 390px: no horizontal scroll, 16px side gutters (`px-4`), every tap target 44px or taller (a text link
inside a line uses `INLINE_LINK`'s 44px hit area), 2-up feed stats, the profile's cards 28px radius, rails that wrap.
A rail that scrolls sideways instead (feed weeks, leaderboard filters) fades its cut edge over 40px while it overflows
(`FadeRail`, `SegTabs RAIL_FADE`). The agent tabs never scroll or fade: the install sheet and the docs install card wrap
them onto more rows (`segRail` 'sheet' and 'light', 26px radius), so every full name shows at every width (owner
2026-10-22, "in the modal tabs get cut off"; checked at 1440, 1024, 768, 390 and 320). The landing hero's ellipse is wider and higher on a phone (86% by
44% at 63%, not 44% by 36% at 68%) and its money chip is dark glass (`hero-chip-phone`), so the chip, title and sub
line hold over the painting (measured 2026-10-22 from screenshots, 95th-percentile background: chip 4.86:1, sub 9.29:1
at 1440; chip 9.24:1, sub 7.85:1 at 390).
Checked at 1440x900 and 390x844 for every page (`v31-site-sweep.test.ts` and the SDD screenshots).

## Contrast

Every text-on-surface pair on the site is 4.5:1 or more (`v31-site-tokens.test.ts`). Two canvas colours were
adjusted to pass:

| Canvas | Shipped | Why |
|---|---|---|
| `#DCE6FF` on blue (3.92:1) | `on-blue-soft` `#F4F7FF` (4.57:1) | Secondary text on blue and podium #1 |
| `#6F7792` on page (4.39:1) | `dim` `#747C97` (4.71:1) | Used only on `page` and `deep` |

## Install tabs and the hero chip

Agent tabs in this order: Grok Bot (owner: most popular), Claude (claude.ai and the desktop app), Muse, OpenClaw,
Claude Code, Cursor, Codex (`agents.tsx AGENTS`). Claude's steps are only the confirmed ones in
`docs/design-docs-and-implementation-plans/v3.1-install-research.md`, the EarnKit link above them on /docs, and the
Free plan's one-connector limit. "A connector lets your AI use EarnKit." (`agents.tsx CONNECTOR_LINE`) is said once,
above the tabs (the sheet's intro, the docs card), so the default Grok Bot tab has it too. Both tab rails are full tab
patterns (ids, `aria-controls`, roving `tabIndex`, arrows and Home/End via `tabKeyTarget`). ChatGPT gets a tab only once OpenAI's own help page
confirms the steps (unreadable on 2026-10-22). /docs carries "No GitHub yet?" on the install card (a light-inner tile:
Lovable and Bolt steps, the v0 note; no Replit until confirmed).

The hero chip counts only programs open to Base builders (chains include Base, or any chain: `landing.ts openToBase`),
"$5K in Base grants open now"; nothing open to Base, no chip. It is 44px at least (36px from md) with vertical padding
and a 22px radius, so a long chip wraps to two balanced lines on a 320px phone (checked at 320 and 390). The cards below may list other chains; each says its chain.

## Post cards (one-tap posts, 2026-10-22)
`card.png?m=<code>` (`post-card-image.tsx`): these tokens, Kaftan Serif headline and numbers (`assets/fonts/kaftan-serif.woff`). Three layouts: number (weekly, live, news: "Week 6" 176px, summary, navy numbers panel, 12 week squares), milestone (rust Streak card, the streak at 300px), text (verified win or funding, coin: blue hero, the program in Kaftan). Backing pill only while EARNKIT_RAISING is on, backers from 5, rank only from 10 ranked builders, never a price; no proof link, no win card.

## Copy rules

Sentence case, short, money first, no emoji, never an em dash. "Backing" (never a raise or a community round);
"of N builders" (never "this week" after it) and a rank only from 10 ranked builders; no points on any page
(points show in agent replies only); every number is real data and the canvas's example people never ship. The words
live in `lib/earnkit/site-copy.ts` and `docs-copy.ts`.

## What stays on the v3 flat system

Black page `#000000`, white type, one accent (Base blue `#0052FF` fill, `#3D7BFF` as text), hairlines and no cards,
from `lib/earnkit/theme.ts THEME` (`--ek-p-*`, `ek-*` Tailwind tokens), Funnel Display headings, a 1120px column, and
`app/components/common/Panel.tsx` (`H1`, `H2`, `ROWS`), `Button.tsx` (`BTN_PRIMARY`, `BTN_SECONDARY`):

- the brandShell pages (`lib/earnkit/brand-page.ts`: X sign-in, GitHub verify, claim, wallet, week, unsubscribe);
  only their header lost its Programs link
- the page's share card (`app/[handle]/card-response.tsx`; a post's own card is v3.1, above), the README badge (`badge.ts`) and the OG image (`scripts/og.mts`)
- `app/[handle]/score-colors.ts PART_COLORS`, kept for `app/components/ui/UpdateCard.tsx`; the v3.1 pages use the score bands above

The OG image still says "Ship every week. Get funded." until a later pass. White on `#0052FF` is 5.8:1, and blue
text on black is always `#3D7BFF` because `#0052FF` is 3.7:1.
