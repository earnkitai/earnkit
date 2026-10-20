# Weekly updates

Owner request (2026-10-20): the feed looked like spam because each card was a list of raw commit titles. Each week
should read as one useful update derived from the pushed commits, with an optional note from the builder.

## What changed

| Before | After |
| --- | --- |
| Up to 3 raw PR or commit titles, cut at 80 characters with "..." | One or two sentences about what changed for users (`project_updates.summary`) |
| The builder's line (`tell update { text }`) shown as plain text | The builder's note shown under the summary as a quote |
| A note always went to the current week | Monday and Tuesday (UTC) it goes under the finished week's update (`updates.ts noteMonday`) |
| The Monday moment listed 2 titles | It shows the summary, then "Send a line about your week and it goes under your update." |
| "Started tracking" could show on two weeks | Only the oldest week that stored a start shows it (`bench-data.ts logCards`) |

## How the summary is written

- The weekly job (`week-facts.ts writeWeek` -> `weekTitles`) already reads the week's PR and commit titles through
  the GitHub App. It now keeps up to 40 cleaned titles (`shipTitles(..., SUMMARY_TITLES_MAX)`) and passes them to
  `week-summary.ts weekSummary`.
- `aiSummary`: Claude Haiku 5.5 (`claude-haiku-5-5`), effort low, 15 s timeout, one retry. Only with
  `ANTHROPIC_API_KEY` set. The system prompt treats titles as data, asks for at most 200 characters, past tense,
  no project name, no numbers, no dashes. "NONE" when nothing is worth saying.
- `ruleSummary` is the free fallback (no key, an error, a refusal, or a reply the filter refuses): verb-led titles in
  the past tense ("Fixed the timer and added the shopping list."), the rest after "Shipped".
- Both go through `update-text.ts checkUpdate` before storing (no foreign links, @mentions, secrets).
- Privacy: titles of a private repo are only read once the builder turned titles on (unchanged), so no summary is
  written otherwise. At read time `summaryShown` applies the titles rule again and drops text naming a private
  repo, falling back to the rule summary of the titles the card may show. Rows written before this change show
  the rule summary of their stored titles.

## Cost

About 1,000 input and 100 output tokens a project a week: $0.0002 at Haiku 5.5's $0.10 / $0.50 per million.
Under $0.10 a month at 100 builders. No new service or cron.

## Owner steps

1. Create an Anthropic API key and set `ANTHROPIC_API_KEY` on the Railway `earnkit` service.
2. Run `railway run pnpm feed:summaries --redo` from the linked checkout to rewrite existing weeks with Haiku.
