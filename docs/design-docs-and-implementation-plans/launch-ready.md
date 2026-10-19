# Launch ready: installs, onboarding, one weekly target

Owner, 2026-10-19:
- Work on what brings installs, then retention.
- Keep the first version simple: one number, one target, one weekly moment.
- Points are the only reward until $EARN launches.
- No paid services.
- "No bugs and flawless UX. Next version should be ready to launch in every way."

## Decisions

| # | Decision |
|---|---|
| L1 | **Claude Code install line** uses `--scope user`, so EarnKit works in every folder. Where an agent supports a one-click deep link, the modal offers it first. |
| L2 | **Repo picker on install (owner's item 4).** After sign-in, the no-project reply's one question is "Install the read-only EarnKit app on the repo you want ranked (one click): <link>". The link is not tied to a named repo, and GitHub's installer lets the builder pick. On setup, EarnKit proves the picked repo(s). With more than one, the most recently pushed becomes the main project, and the builder can change it by telling their agent. Typing a GitHub URL still works, but is never asked for. |
| L3 | **The "Community round" leaderboard filter is removed** (owner and tester). |
| L4 | **2 or 3 real programs with dated deadlines are added**, following programs/README.md, from official sources only, with nothing invented. |
| L5 | **One weekly target.** The score counts active weeks, so the target is this week's ship: "Ship code this week: +N points, which passes <name> for #k". It is computed from the why-sentence math plus the next rank's score. Once this week has code, it becomes "Done this week: +N. Next week adds up to M." It shows in replies (as the one next step for ranked builders) and on the profile (owner view only), under the score. |
| L6 | **One weekly moment.** The first find/score of a new week leads with "Last week: Shipping 72 (+6), #3 (up 2)." plus one line of the week's titles. It offers a free share link: an X intent URL with the rank line and profile link, so no X API and no new scopes. A yes marks the week approved, which feeds the activated and weekly-active metrics. |
| L7 | **Profile for visitors vs owner.** A visitor sees "Add EarnKit to your agent" as the first call to action. The owner (an agent-linked session isn't available on the web, so this is visitor-only on the web) sees the weekly target in agent replies. |
| L8 | **README badge.** `/badge/<handle>.svg` renders "EarnKit · Shipping 72 · #3", is cached, and links to the profile. The profile offers a copy-the-markdown button. |
| L9 | **Funnel numbers in /api/stats for jenil.ai:** activated (profile + App-proven repo + first approved week), weekly_active (an approved week in the last 7 days), shared (share links opened, or approvals). Counts only, no per-user data. |
| L10 | **UX pass:** walk the whole site and the agent flow as a new builder and as a designer, on desktop and mobile. Fix every bug, inconsistency, confusing line and broken layout found. Run it as one batched pass, then one confirm pass. |

Out of scope (owner): trends, records, milestones, chain comparisons, the score preview, the daily live check, sponsor prizes, and token flows.
