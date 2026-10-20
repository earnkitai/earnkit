# EarnKit v3: the power-user version

Date: 2026-10-20. Owner: Jenil (solo founder, first builder). Status: APPROVED by the owner on 2026-10-20 with the answers in section 7. Launch: when the owner, as a user, finds value and EarnKit delivers its promise to them; Oct 22 is the aim, not a gate.

Owner's bar (2026-10-20): "the flow for me is flawless"; "a complete transformation from how clanky and thrown together it is right now"; let low-impact issues go; the first goal after launch is installs, but the system must be solid first. The owner tests through Grok Bot, so the hosted-client path is built first.

## 1. Intent

EarnKit connects builders with capital. A builder installs the EarnKit MCP into the agent they already use. EarnKit builds their profile from GitHub (and X for identity), writes a weekly ship log from real commits and deploys, ranks them against every other builder, and routes them to money.

The one goal is cash in the Safe. Near term the only rail that can print is trading fees from coins launched through tokens.fun (Safe keeps 50% of the post-Clanker fee stream). Later rails: a cut of sponsor funding, and $EARN.

This document describes the version of EarnKit the founder can use every week as its first power user, that a rejected Base Batches applicant can install on Oct 22 and get value from in ten minutes, and that has a visible, honest money rail on every page. It is a product and UX document. It does not propose refactors.

## 2. Where EarnKit stands on 2026-10-20 (facts)

Production (`origin/main 084da29b`, `/api/stats`, the Postgres read replica, the live site):

| Fact | Value |
|---|---|
| Installs | 28, of which 1 person signed in with X (the owner) |
| Activated (page + App repo + an approved week) | 0 |
| Weekly active | 0 |
| Weeks stored for the owner | 4, every one at 0 points, so the feed shows "No updates yet" |
| Open programs | 4: a16z speedrun, Avalanche, Base Builder Grants, Circle. None of Base Batches, Alliance, Monad Nitro, ETHGlobal |
| "$1.1M+ open right now" | 90% of it is a16z's $1M investment |
| Coins launched | 1 (an old test). The owner answered "no" to the only coin offer |
| Fees to Safe | 0 |
| Footer "Docs" | 404 on earnkit.com; docs.earnkit.com answers 402 |
| Footer "For sponsors" | 404 |
| X | sign-in only; no posts are read |
| Hosted clients (Grok Bot, Muse) | get no page, no rank, no App link, no coin (`oauth.ts servesMany`) |
| Code | 99k lines in `lib/earnkit`, 77 tables, 14 versions of sediment; the README describes v2.9 |

What is good and stays: X sign-in at install; the read-only GitHub App as the only proof; one project per builder; the Shipping score (0 to 100, 12-week weighted, +10 for a live ship); Originality; the four-state reply shape (Where you stand / Ways to get funded / How to move up, one link, one question); Haiku week summaries; the dark single-palette site; the badge.

What is wrong, in order of damage:

1. **The loop has never closed, not even for the founder.** Points are written by a feed step that has not run for the owner's weeks; approval needs the builder to open their agent on a Monday after 15:00 UTC; EarnKit has no push channel (the weekly email exists but `RESEND_API_KEY` is unset). So the feed is empty and "activated" is 0.
2. **The money rail is dark.** A coin exists only if the builder asks about a token; the community round is behind a flag; the profile and replies never show money the builder could earn from attention. Revenue is therefore $0 by design.
3. **The programs are the wrong programs for the audience.** The launch audience is Base builders rejected by Base Batches. Two of the four cards they see are Arc and Avalanche. The programs the pitch names are missing, and the one program that explicitly rewards public weekly ship logs (Monad Nitro) is not listed.
4. **No application drafting is offered.** `prepare` exists, but the ranked reply's step is always "ship code". The outcome vocabulary lacks `accepted` and `funded`, so the dataset the deck promises cannot be collected.
5. **Trust breaks on the first click.** Docs 404, sponsors 404, terms that contradict each other (public-only vs private repos; "every entry is offered a token" vs "only when asked"), a 1.5 MB hero decoration and a 17 MB autoplay video on a page meant for a terminal user.
6. **The founder's own agent cannot use it.** Grok Bot is the owner's EA and is listed first in the install modal, and it gets the anonymous path.

## 3. Goals, non-goals, anti-goals

Goals, in order:

1. The founder completes the whole loop on production before Oct 22 and keeps completing it weekly with no manual steps beyond one yes.
2. A new Base builder goes from install to a public ranked page with a first ship log in under ten minutes, in any of Claude Code, Cursor, Codex, OpenClaw, Grok Bot or Muse.
3. Every ranked page and every ranked reply shows money: programs that fit with a drafted application, backing, and EARN points.
4. Backing (a tokens.fun coin under the hood) is offered once at a proof moment to every eligible builder, honestly, and is the one revenue rail at launch.
5. Outcomes are recorded: applied, accepted, funded, rejected.

Non-goals (owner's list, in force until revenue passes $5,000 a month): refactors and infra cleanup; tokens.fun growth or marketing; any token other than $EARN; Robinhood Chain; sponsor outreach; raw traction tracking; sales calls; a mobile app.

Anti-goals (this would be a failure even if it works):

- Ranking that can be bought: a coin, backing or spend never moves Shipping or rank.
- A builder discovers a tradable coin exists for their project without having said yes to one.
- A reply with two links or two questions.
- Any number on the site that a visitor can show to be inflated ("$1.1M open" counted from one $1M investment).
- A week that silently never posts.

## 4. Constraints

- Spend stays at or under $107 a month until revenue passes $2,000 a month. Resend's free tier (3,000 emails a month) and Haiku summaries (under $1 a month) fit.
- No new services. Railway `earnkit`, Postgres, the hourly GitHub Actions cron, tokens.fun's deploy API.
- Base is the chain. Other chains are shown where a program is on them, never pushed.
- EarnKit cannot message a builder through their agent. Email and the public page are the only push surfaces.
- Everything in code stays unless it is on a visible surface. Dead flags stay dark.
- Copy rules: short, money first, tables, no emojis, never em dashes.

## 5. The product

### 5.1 The one loop

```
install MCP  ->  Sign in with X (page exists)  ->  install the read-only GitHub App on one repo
   ->  transcript: last 12 weeks read, 3 weeks of ship log written, score and rank computed
   ->  first reply shows the transcript and this week's draft; one yes approves it (ACTIVATED)
   ->  every Monday: EarnKit writes the week, emails the builder the draft with a one-click
       "Looks right" link, and the first agent reply of the week shows the same moment
   ->  the week posts to the page and the feed on Monday whether or not the builder answered;
       the builder's yes confirms it and may add a note; a hide is always one line away
   ->  money: programs that fit (drafted application), backing (coin under the hood), EARN points
   ->  outcomes: applied / accepted / funded / rejected, one line each
```

Changes from today, each marked (mine) or (owner) for who decides:

- **Approve on connect (mine).** The backfill already writes the last 3 finished weeks when the App connects. The first ranked reply after connect shows them ("Your last 12 weeks: code in 7, live since Sep 3. Last three weeks:" then one line per week with its summary) and asks "Does this look right? Yes posts them." A yes approves all the shown weeks that carry facts and counts as activation. The running week is never shown as a draft; it gets its row on Monday like every other week. Today activation waits for a Monday.
- **Monday email with one-click approve (mine, owner sets the key).** The weekly email already exists (`digest.ts`, Resend, opt-in). It becomes the Monday moment: last week's summary, score and rank delta, this week's target, and two signed links: "Looks right" (approves, no agent needed) and "Hide this week". The email address is asked once in the first reply after activation ("Want the Monday summary by email? Which address?"). Today the email only lists programs and wins.
- **Weeks publish on Monday; approval confirms (owner).** Today a week stays off the feed until the builder says yes. Proposed: a week with facts posts Monday 15:00 UTC with the Haiku summary, labelled "not yet confirmed" until the builder's yes (the terms already promise that label). Private repos keep facts-only until titles are on, unchanged. See decision D1.
- **Points bug (mine).** The owner's weeks carry 230 commits and 0 points, so the feed never shows them. The `feed` cron step or the `hasFacts` path is not writing points on production. Fixed and verified on the owner's page before launch.

### 5.2 The three numbers

Every profile, every leaderboard row and every ranked reply shows the same three numbers with the same names:

| Number | Meaning | Where it comes from |
|---|---|---|
| **Shipping** (0 to 100) | effort over 12 weeks, +10 live | unchanged (`score-v2.ts`) |
| **Rank** ("#3 of 41" or "Top 4%") | relative to every ranked builder | unchanged |
| **Earned** ("$340") | money that reached the builder through EarnKit: backing fees paid to their wallet, program wins recorded from published results, $EARN later | new; summed from `safe_fees` style indexing of the creator share plus `entry_outcomes` with a prize |

Originality stays on the profile as a fourth, unranked line.

Wording fixes everywhere: "Ranked by Shipping" (never "Shipping points"); "of N builders" (never "this week", since the score is a 12-week window); one name for the feed: "Feed" in the nav, "What builders shipped this week" nowhere.

### 5.3 Money routes

Three routes, always in this order, always present on a ranked page and in a ranked reply. "Ways to get funded" lists them; the step at the bottom of the reply offers at most one action.

**Route 1: Programs.** The curated list becomes the list for a Base builder in the last quarter of 2026, from the research of 2026-10-20:

| Program | Deadline | Award | Status on EarnKit |
|---|---|---|---|
| Base Builder Grants | rolling, "next cohort" | up to $5K + Builder Stack | open; guide says "Builder Codes first" |
| Circle Developer Grants | rolling | $5K to $100K USDC | open (Arc) |
| a16z speedrun SR008 | Nov 1 | $500K for 10% | open |
| Alliance ALL19 | Nov 18 | $400K SAFE | open; new |
| ETHGlobal Mumbai | Nov 8, in person | ~$141K pool | open; new; "in person" chip |
| Monad Nitro cohort 2 | "opening soon" | $500K | **upcoming**; new; guide: "needs four consecutive public weekly ship logs; your EarnKit log qualifies" |
| Base Batches 005 | not announced | $100K | **upcoming**; new; guide: "004 rejected? Your ship log is the re-application" |
| Arbitrum Foundation grants | rolling | unspecified | open; new |
| Avalanche Team1 | rolling | up to $10K | open; sorted by fit, so a Base builder sees it last |

Arbitrum is dropped from the table: it would need a new chain on every surface, and Base comes first. Avalanche stays only because it already exists.

"Upcoming" is a new program status: shown with "Opens soon" instead of a deadline, never counted in the money total, matchable so the agent can say "Your four weeks already qualify you for the Nitro interview when it opens." An upcoming program has no `submission_url` and no `submission_requirements`; `programs:check` must allow that for the status. Alliance and ETHGlobal need their real forms mirrored field by field, per `programs/README.md`; the sources are in Appendix A.

The money total counts the per-team maximum of every open grant or prize with a stated per-team amount: today $5K (Base) + $100K (Circle) + $10K (Avalanche) = "$115K in grants open". Pools without a per-team figure (ETHGlobal), investments (a16z, Alliance) and upcoming programs are excluded from the number and named in words: "plus two accelerators and a hackathon". The same rule feeds `/api/stats open_money_usd`; `open_pools_usd` stays deprecated.

**Drafted application (mine).** For a program with a deadline inside 30 days that fits, the ranked reply's step once reads: "Alliance ALL19 closes Nov 18. Want me to draft your application from your ship log?" A yes calls `prepare`, which already builds the coach and draft; the agent fills the form on the program's site with the builder; `tell submitted` records it. The draft leads with the ship log facts (weeks shipping, live link, commits, rank) because that is what every program converged on.

**Outcomes (mine).** `tell program_status` gains `accepted`, `funded` and `rejected` (today: applied, won, placed, lost, not_interested). The reply asks once, 14 days after a submitted deadline: "Did Alliance come back on EarnKit? applied / accepted / funded / rejected." What shows where:

| Status | Source | Public on the page |
|---|---|---|
| applied | the builder's word | yes: "Applied to Alliance ALL19" (a fact about their own action) |
| accepted, funded, rejected | the builder's word | no; private, counted in `/api/stats` only |
| won, placed, funded | a published result (`programs/outcomes/*.json`) | yes: "Accepted by …", "Won $500 in …", and Earned |

A self-reported acceptance never prints on a verified-looking page.

**Route 2: Backing.** This is the revenue rail. A tokens.fun coin, launched by EarnKit through the existing `confirm { project_id }` path on Clanker v4 rails on Base, with the existing split (Clanker 20%; of the rest, builder 40, MINI 10, Safe 50). The owner's project (EarnKit itself) is the one exception: it never gets a backing offer, because $EARN comes later.

*How it works in the flow, and for whom.* Two people have to want this: the builder, who fears a volatile asset tied to their name, and the trader, who needs a reason the coin could go up. EarnKit's answer to both is the same object: the verified weekly ship log.

For the builder:

1. Backing is offered once, after the first approved week with code, so a coin is only ever attached to a public, verified shipping record. It is never a condition of anything.
2. The builder never has to say "token". Their page says "Backing open · 12 backers · Earned $340"; the Back button sends people to the coin's page on tokens.fun. EarnKit's Monday share line can carry it ("12 people back <project>"); posting is still the builder's choice.
3. Nothing about backing moves Shipping or rank, so nobody can say they bought their place.
4. Income is passive: 40% of trading fees, paid to their wallet, shown as Earned.
5. They can close backing any time (`tell coin { raising: false }`): the button and the count leave the page. The consent line and the close line both say the coin stays onchain, because it does.
6. The consent line is honest and said once: "A tradable token on Base; it can go to zero."

For the trader, the thesis is "verified dev activity": the number one way a small coin dies is the builder disappearing, and EarnKit is the only place that shows, weekly and from GitHub, whether the builder is still shipping.

1. The coin's page on tokens.fun shows the EarnKit numbers live: Shipping, rank, streak, the last week's summary, "last shipped 3 days ago", and a plain "Stopped shipping" state after two weeks without code. (tokens.fun side; P1, read from a public JSON on earnkit.com so no tokens.fun DB work.)
2. Attention routes through the leaderboard: a "Backed" chip on rows and a Backed filter, so the top backed builders are one click from the home page. Rank is still Shipping only.
3. Each week the builder moves on the leaderboard is a reason to look again; the feed card carries the backers count. Attention, not EarnKit, is what moves price, and the site never says a coin will rise.
4. Later, not now: backers of ranked builders could earn points toward $EARN, proportional. Noted as a P2 idea for the owner; it is not in this design.

What changes is where it lives and how it is said:

- **Name.** "Backing" on the page ("Back EarnKit", "12 backers", "Earned $340 from backers"). The coin is named after the project with EarnKit's proposed ticker, as today. The word "token" appears once, in the consent line, because the consent must be honest. See decision D2 on the name.
- **Who is eligible.** Every guard in `coin-moments.ts` and `token-gate.ts` stays: not a held profile, once per project, declines remembered and capped, the repo App-proven within a day. Two changes: the trigger is the first approved week with code (no Shipping, live or Originality floor), and a private repo is not eligible (a coin named after a project the page hides is wrong). Hosted-client installs bound to an X account (D4) are eligible like any other; the wallet is asked after the yes, as the non-shared path does today.
- **Offer moment.** Once, in the first reply after the builder's first approved week (the proof moment), and never again unless the builder asks. The line: "People can back <project> onchain. EarnKit launches a $<SYM> coin on tokens.fun for it; you keep 40% of its trading fees, paid to <wallet>. It is a tradable token on Base and can go to zero. Want to open backing for <project>?" A no is remembered. Today the offer exists only after `tell token: 'ask'`, which no agent sends unprompted.
- **On the page.** A ranked page with backing open shows a "Back <project>" button that opens the coin's tokens.fun page with the swap ready, "N backers" (unique buyer wallets, indexed), and "Earned $X" in the three numbers. A page without backing shows nothing about coins. The share card gets the same button line.
- **Earned is paid money.** Earned counts creator fees that reached the builder's wallet (claims and transfers, indexed the way `safe_fees` indexes the Safe's share) plus published program prizes. Fees accrued in the FeeLocker but not yet claimed show as a second, smaller line, "and $X waiting", from the `fees.ts` read that alerts already use. Never summed into Earned.
- **The flag.** `EARNKIT_RAISING` gates every coin-facing surface at once: the offer, the Back button, backers, the backing line in replies, the terms backing section and the old "$SYM on tokens.fun" line. Earned stays visible (program prizes) with the flag off. Flag off means the rail ships dark and nothing legal is published before the lawyer's yes.
- **In replies.** Once backing is open, "Ways to get funded" carries one line: "Backing: 12 backers, $340 earned. Your page: earnkit.com/jenilt." Never a step, never a nag.
- **Never ranked.** Backers, fees and the coin never touch Shipping or rank. The leaderboard has no backing column. The anti-goal stands.
- **tokens.fun side (later, P2).** The coin page on tokens.fun shows the EarnKit three numbers and the latest week, and links back. That is the vertical integration a trader sees: a coin whose creator ships every week, verified. Not built before revenue; noted so the EarnKit side links with a `?ref=earnkit` the coin page can read.

**Route 3: Points.** The default program every ranked builder is in. The word is "points", never "EARN points". Each approved week earns points by rank at the moment of approval: 100 for #1, 90 for top 10%, 70 for top 25%, 50 for top 50%, 30 for any approved week with code. The weeks approved at connect (the backfill) earn the flat 30 each, since a rank at connect means little. Points accrue in a ledger (new table, one row per builder-week, written once). The profile shows "1,240 points" with the line "Points convert to $EARN when it launches, in proportion to all points earned. They are not a token and have no value until then." The leaderboard does not show points. $EARN itself is not built. Launch week (D3).

### 5.4 The weekly loop without a push channel

| Moment | Monday 15:00 UTC | Any time that week |
|---|---|---|
| EarnKit | writes the week (facts, Haiku summary), posts it as "not yet confirmed", scores, ranks, emails the draft with Looks right / Hide links | the first agent reply of the week shows the same moment with "Does last week look right?" |
| Builder | clicks Looks right, or replies yes to the agent, or does nothing | sends one line with `tell update { text }`; it goes under the week as a quote |
| Result | the week is confirmed and the "not yet confirmed" label drops; EARN points are written | nothing lost if the builder is silent; the page is never empty for a builder who shipped |

The X share stays an intent link in the same moment, one line, never a question.

### 5.5 Replies

The four states stay (signed_out, no_project, not_counted, ranked). Two additions to the ranked state:

- The step is chosen in this priority: the first approved week's backing offer (once) > a drafted application for a deadline inside 30 days (once per program) > the weekly moment's "Does last week look right?" (once a week) > the weekly target statement.
- "Ways to get funded" lists, in order: programs that fit (up to 3, deadline first, upcoming last with "opens soon"), then backing (one line, only when open), then "EARN points: 1,240" (one line, once ranked).

Copy that changes: "Signed in as @handle." stays. "Shipping 72 · #3 of 40 builders" (drop "this week"). "Earned $340" appears in the stand line when above zero.

### 5.6 The site

**Landing.** Hero stays: "Ship every week. Get funded." Subtitle becomes: "Add EarnKit to your AI agent. It writes your weekly ship log from real commits, ranks you against every builder, and routes you to grants, accelerators and backers." Drop the decorative 1.5 MB image and the 17 MB autoplay video; the demo becomes a 60-second GIF of the agent reply or a link to the founder's own page. Sections: Leaderboard top 10, Feed (last finished week), Money open now (the new list, honest total), Backed by, footer. The footer's Docs link goes to `/docs` on earnkit.com (one page: install per agent, what the agent can do, the three numbers, money routes, for program selectors). "For sponsors" goes to `/docs#selectors`. docs.earnkit.com is dropped.

**Profile.** Header, then the three numbers (Shipping ring, Rank, Earned) with Originality under them, the streak grid, tabs Ship log / Project / Money. The Money tab is new: programs that fit, applied and outcomes, backing with the button, EARN points. "Not yet confirmed" label on unconfirmed weeks. The share button on the page itself (today it exists only as a link in replies). The README badge markdown only for the owner's own view; visitors see the badge image.

**Leaderboard.** Header "Ranked by Shipping". Filters: chain chips and "Shipping every week". Rows: avatar, name, @handle, chain logos, project · best fact, Shipping, rank. Empty state keeps the one line and adds the Add button. No backing column.

**Feed.** "Feed" everywhere. Cards: summary, note as a quote, chips, "not yet confirmed" where applicable.

**Programs.** Cards gain "Opens soon" and "In person" chips, deadlines as dates. Guides for Nitro and Batches 005 say in one line why four EarnKit weeks matter.

**Terms.** Fix the two contradictions (what is read: public and App-installed private repos; the token is offered once, after the first approved week, and only with a yes). Add the backing section (the split, the risk line, the wallet). Keep the risk disclosure but head it "Risk disclosure (tokens.fun coins)".

### 5.7 Hosted clients (Grok Bot, Muse)

Today a client that serves many builders is given an anonymous installation with no X sign-in, so Grok Bot users (the founder included) can never get a page. The X authorize step happens in each person's own browser regardless of the client, so the person is known. Decided (D4, yes): hosted clients go through the same X sign-in; the installation token is bound to the X account as for every other client; the App link, wallet memory, email and coin follow the same rules as any other client. The paste-code fallback stays for clients that cannot finish a browser step. The owner tests in Grok Bot, so this is the first thing built and the first thing verified on production.

### 5.8 The site's look

The owner's brief: simpler, cleaner, premium, not AI slop; the feel of an established brand, Base in crypto; a builder understands it on arrival without a wall of words; ambitious and forward-looking.

Rules for the redesign (the frontend-design skill carries the craft; these are the constraints):

- One typeface family (Funnel Display for display, Funnel Sans for text stays; both self-hosted), one accent (the brand blue), one dark surface. No gradients, no glows, no decorative images, no video, no emoji, no icon grids, no three-column feature rows.
- Big type and space do the work. The landing says what EarnKit is in one line and shows it in one real artifact: the founder's own live ship log card and rank, pulled from production data. Then the leaderboard, then money, then Backed by.
- Fewer words everywhere. Every heading is a statement a builder can repeat. No "revolutionize", no "unlock", no "supercharge".
- One primary action per view ("Add to your agent"), in the header only; the hero repeats it once, nothing else does.
- The profile is the product: the three numbers, the streak grid, the log. It must look like something a builder wants to share on X unprompted.
- Tables and rows over cards. Chips carry one fact each.
- Phones first at 390px; nothing wraps badly; 44px targets.
- The same shell on every page, including the sign-in, GitHub and setup pages (today they fall back to the system font).

What goes: the 1.5 MB hero decoration, the 17 MB video, the "$1.1M" number, the duplicate CTA buttons, the three names for the feed, "this week" on a 12-week score, "Shipping points".

## 6. Build order

Everything below is in scope for this build. The order is the owner's test order: what they touch first is built and verified first. Low-impact items are out (the README badge for visitors, the sitemap, the stale README text beyond what the Docs page replaces, the `/claim/wallet` dead page, the campaign pages).

**Stage 1. The founder's loop works in Grok Bot.**
1. Hosted clients get X sign-in and the full product (5.7).
2. The points bug: the owner's weeks carry points and show on the feed.
3. Approve on connect: the first ranked reply shows the last three weeks and takes one yes; activation.
4. Weeks publish Monday as "not yet confirmed"; a yes confirms; hide stays one line away (5.4).
5. The Monday email with Looks right / Hide; the address asked once after activation.
6. Points ledger and the profile line.

**Stage 2. Money.**
7. Programs: the table in 5.3 and Appendix A, `upcoming` status, the honest total.
8. Drafted application for a deadline inside 30 days; `accepted`, `funded`, `rejected`; the outcome ask.
9. Backing: the offer after the first approved week, the Back button, backers, Earned and "waiting", the Backed chip and filter, the terms section, all behind `EARNKIT_RAISING`; the owner's project excluded; the public JSON the tokens.fun coin page reads.

**Stage 3. The site.**
10. The redesign in 5.8: landing, profile (with the Money tab and the share button), leaderboard, feed, programs and guides, the Docs page, the auth and setup pages, the install modal, the share card and badge.
11. Copy pass on every reply and page against 5.2 and 5.5.

**Stage 4. The founder's acceptance.**
12. A runbook for a non-engineer: install in Grok Bot and in Claude Code, sign in, connect `earnkitai/earnkit`, approve, note, Monday email, draft the Alliance ALL19 application, see the points, see the programs; verified on production by the builder before the owner is asked to test.

**Later (not this build):** the tokens.fun coin page reading the JSON (P1 on the tokens.fun side); backer points; the selectors' view after 300 weekly active builders.

## 7. Decisions

Decided by the owner in the brief, and binding here: Base first; one goal is cash; revenue from tokens.fun launches is the near-term rail; $EARN is points until it launches; no refactors; no sponsor outreach; the MCP is the form factor; the owner is the first power user; launch Oct 22.

My calls, overridable: approve on connect; the Monday email as the moment; the programs table; the drafted-application step; the outcome vocabulary; the three numbers and their names; "Earned" counts only money that reached the builder; the backing offer moment (first approved week, once); the `/docs` page replacing docs.earnkit.com; dropping the hero image and video; the EARN points schedule in 5.3.

Answered by the owner on 2026-10-20:

- **D1. Weeks publish on Monday as "not yet confirmed".** Yes, on the feed and the page. Posting to X is the builder's decision and is never enforced.
- **D2. "Backing" is the word.** The owner asked how it works for builders and for traders; section 5.3 Route 2 answers both.
- **D3. Points in launch week.** Called "points", not "EARN points". Conversion to $EARN is proportional, by a formula decided later.
- **D4. Hosted clients get X sign-in and the full product.** Yes. The owner tests in Grok Bot.
- **D5. No backing for EarnKit itself.** The owner is the exception; $EARN comes later.
- **The 28 installs** are probably the owner's own tests, unattributed; the funnel numbers before launch mean nothing. Stage 4 verifies attribution so the first real installs count.
- **Resend.** The owner sets `RESEND_API_KEY` on Railway; the email is the Monday moment and, later, the weekly hook for installs.

## 8. Left to the builder

- Where the backers count and the creator-share "Earned" are indexed (the Safe indexing in `bonus-ledger.ts` / `safe_fees` already walks the fee stream; mirror it for the creator share, or read tokens.fun's split-info endpoint).
- The signed one-click approve link format and expiry (reuse the digest's HMAC unsubscribe scheme).
- The `upcoming` status in `programs/*.json`, `program-file.ts` and the cards.
- How the drafted application is handed to the agent (the existing `prepare` coach and draft; the program's `submission_requirements` already name the fields).
- Which weeks the points bug affects and why the feed step did not write them.
- Test coverage through the real MCP path (`fixtures/mcp-call.ts`), per the 2026-10-18 lesson.
- The founder's acceptance runbook, written for a non-engineer, as the v2.14 runbook was.

## Appendix A. Program facts researched 2026-10-20

Verified from the programs' own pages unless marked unverified. Re-check each `verified_at` when writing the JSON; the README forbids guessing.

| Program | Source | Apply | Deadline | Per-team award | Notes |
|---|---|---|---|---|---|
| Base Builder Grants | docs.base.org/get-started/builders | forms.gle/urqjBJYJjR6Vqqre6 | next cohort, no date | up to $5K + GTM + Builder Stack credits | "First step: integrate Builder Codes." Focus: prediction markets, launchpads, DeFi 2.0, agents/x402, new assets, consumer tx growth |
| Circle Developer Grants | circle.com/grant | circle.questbook.app | rolling | $5K to $100K USDC, milestones | Arc + Circle Developer Platform; asks for shipped evidence |
| a16z speedrun SR008 | speedrun.a16z.com/faq | same | Nov 1, 2026 11:59 PM PT | $500K for 10% on a SAFE | residency Feb 1 to Apr 18, 2027, SF in person; non-US welcome |
| Alliance ALL19 | alliance.xyz | alliance.xyz/apply | Nov 18, 2026 (regular) | $400K SAFE at $4M post + token side letter | technical founder, crypto-adjacent incl. fintech and AI; "can your team ship"; starts Jan 11, 2027 NYC then remote |
| ETHGlobal Mumbai | ethglobal.com/events/mumbai | same, apply to attend | submissions Nov 8, 2026 09:00 IST | pool ~$141K summed from the prizes page (unverified total; third parties say $144.5K or $175K) | in person at Devcon 8; EF, Uniswap, Arc, 0G, Hedera $15K each; no online ETHGlobal event in Nov or Dec 2026 |
| Monad Nitro cohort 2 | monad.xyz/blog/home-for-builders; nitroacc.xyz | not open | "opening soon" per Monad's July 2026 update; no date | $500K per team, 15 teams, plus credits | "must publish four consecutive public weekly ship logs before an interview is granted" (verbatim from the Monad blog); any chain |
| Base Batches 005 | base.org/batches; basebatches.xyz | not open | not announced; 004 closed Sep 10, Demo Day Nov 17; program runs twice a year | $100K investment (004) | do not quote a 005 date |

Not listed and why: Arbitrum Foundation grants (new chain); Unichain retro grants (new chain); Optimism grants paused at least 12 months from Jan 8, 2026; Base Builder Rewards via Talent Protocol ended (Talent Protocol acquired by IPTS Aug 19, 2026); Arc Microgrants closed Oct 14; Monad Metropolis closed Oct 13; a16z CSX has no 2026 cohort; Gitcoin GG25 unscheduled.

## 9. Metrics (effort only, owner's rule)

installs -> activated (first approved week) -> weekly active (approved week in the last 7 days, by email or agent) -> shared -> money event (application drafted and submitted; backing opened; outcome recorded) -> cash in Safe. `/api/stats` gains `applications`, `backing_open`, `backers`, `earned_usd`, and `points_total`. jenil.ai's `get_funnel` reads them.
