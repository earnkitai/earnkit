# Sponsor campaigns (archived in v2.12)

## What it did

Sponsor-funded USDC campaigns (v2.1). A sponsor's agent called the `sponsor_campaign` tool:

- `create`: a draft campaign with a funding link and raw transactions.
- `status`: the deposit, the entries and their scores (reads the chain, may rescore).
- `award`: the winners and an optional split, after the campaign ended.

Around it:

| Piece | Where it lived |
|---|---|
| Escrow funding page | `/fund/<ref>` |
| Award page | `/award/<ref>` |
| Chain check route | `POST /api/sponsor/<ref>/check` |
| Campaign logic and sponsor copy | `lib/earnkit/sponsor.ts`, `sponsor-text.ts` |
| End to end script | `scripts/sponsor-e2e.mts` (`pnpm sponsor:e2e`) |

Production never had the escrow configured, so the tool was never offered there and no sponsor
campaign ran.

## The flag

`EARNKIT_SPONSOR_CAMPAIGNS=on`. Default off. With it off:

- Sponsor programs are not listed (`listPrograms`) and `getProgram` says not found.
- Nothing writes `sponsor_campaigns` (the link-merge update in `identity.ts` is skipped).
- The tool, `/fund`, `/award` and the check route do not exist (their files are in `files/`).

The tables are kept and never dropped (see `TABLES.md`).

## What stayed live and why

Live code reads these, so they did not move (plan R19):

- `sponsor-rules.ts`, `sponsor-identity.ts`, `sponsor-verify.ts`: read by `programs.ts`, `leaderboard.ts`, `token-proposal.ts`, `mcp.ts` and `/campaigns/<slug>`.
- `escrow.ts`, `escrow-abi.ts`: log-chunk helpers used by the cron and the bonus ledger, and escrow links.
- `scoring-lock.ts`: `withScoringLock` moved here out of `sponsor.ts` (used by `cron.ts` and `bonus-ledger.ts`); the archived `sponsor.ts` re-exports it, so a restore needs no edit.
- `app/components/wallet.ts` and `WalletGate.tsx`: still imported by the live tree.
- `app/terms/sections/SponsorTermsSection.tsx`: signed sponsors' terms stay public.
- `contracts/`: untouched.

## Restore

The app never imports from `archive/`. To bring the feature back:

1. `pnpm exec tsx apps/frontend/scripts/archive-restore.mts sponsor-campaigns` (moves every path in `MANIFEST.txt` back with `git mv`; refuses if a target exists).
2. Paste the two snippets back: `files/apps/frontend/lib/earnkit/tools-sponsor.ts` into `tools.ts` and `files/apps/frontend/lib/earnkit/mcp-sponsor.ts` into `mcp.ts` (each file's header says where). The old tool input tests are in `tools-sponsor.test.ts` there; add `sponsor:e2e` back to the root `package.json` scripts: `tsx --import ./apps/frontend/lib/earnkit/fixtures/test-guard.ts apps/frontend/scripts/sponsor-e2e.mts`.
3. `git revert <the unhook commit>` for the rest of the unhook (restore the `mcp.test.ts` and `tools.test.ts` expectations). Resolve any conflict by keeping the flag checks.
4. Set `EARNKIT_SPONSOR_CAMPAIGNS=on` and deploy the escrow per `contracts/`.

Checked in v2.12 in a scratch worktree: restore plus the snippets passes `sponsor.test.ts` and `mcp.test.ts` with the flag on.
