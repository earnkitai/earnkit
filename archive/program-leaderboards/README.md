# Program boards, staged for archive

## What it did
`/campaigns/<slug>` showed an EarnKit campaign's public board (`app/campaigns/[slug]/page.tsx`,
`apps/frontend/lib/earnkit/campaign-page-text.ts`, read through `leaderboard.ts getCampaignBoard`).
`/bonus/<round>` (the builder bonus round board) is not archived: it stays live (owner ruling D1).

## The flag
`EARNKIT_PROGRAM_LEADERBOARDS=on`, default off. With `EARNKIT_BUILDER_SCORE=on` and this flag off,
`/campaigns/<slug>` and every `/bonus/<round>` not in review move to `/leaderboard?program=<id>`
(`bonus-rounds.ts boardRedirect`). With the builder score off, both pages are as in v2.11.

## The move, at go-live
Once EARNKIT_BUILDER_SCORE is on for good:
1. `git mv apps/frontend/app/campaigns/[slug]/page.tsx apps/frontend/lib/earnkit/campaign-page-text.ts` into
   `archive/program-leaderboards/files/<same path>`, uncomment both MANIFEST.txt lines.
2. Add `app/campaigns/[slug]/route.ts` answering 301 to `/leaderboard?program=<slug>` (a route can).
3. Add `'program-leaderboards': 'EARNKIT_PROGRAM_LEADERBOARDS'` to `archive.test.ts`'s ARCHIVED map; `pnpm -s test`; commit.

## Restore
`pnpm exec tsx apps/frontend/scripts/archive-restore.mts program-leaderboards`, delete the route.ts of step 2, set the flag.
