### Task 1 (F1): the owner's repo gets its fits; investments in the fit lines (I: Opus, R: Opus)

The owner's ranked reply for earnkitai/earnkit said "No open program fits EarnKit yet." on the connect reply and the next one, while Alliance ALL19 (any chain, investment, Nov 18) and Base Builder Grants (Base, rolling) should be candidates. Production DB is unreachable: work from code and fixtures. **The implementer states the root cause in the commit body and in `.superpowers/sdd/v3.1-plan-p0/progress.md`.**

Suspect gates, in the order a reply meets them:
- (0) `benchFind`: the match of a big repo cut by `REPLY_WAIT_MS`, with no `keptBenchMatch` yet on the first reply after connect (`a.repos` null or no `fits` → `can` empty).
- (1) `benchFind:650` / `benchScore:734`: investments dropped from fit lines (Alliance).
- (2) `present.ts canApply` (find): `odds === 'good'` and no `new_work`.
- (3) `alerts.ts repoCanWin` (score): `product.tier === 'noise'`; odds `low`/`unknown`; `match.ts fitsWideProgram` for any-chain and investments (`tier === 'product' && !missing.includes('original')`: an Originality miss drops Alliance); `matchRepo` verdict `no`; `onlyMentioned`; the "close" gate (`real_users` missing drops a "needs a live product" program such as Base Builder Grants); the Hard-row gate.

**Files:**
- Modify: `apps/frontend/lib/earnkit/alerts.ts:307-328` (`repoCanWin` becomes a wrapper of a new `fitGate`)
- Modify: `apps/frontend/lib/earnkit/bench-find.ts:322` (`Fit`), `:644-658` (benchFind rows), `:728-734` (benchScore fits)
- Modify: `apps/frontend/lib/earnkit/stand-view.ts:143-162` (`scoreFits` order)
- Create: `apps/frontend/lib/earnkit/fixtures/earnkit-repo.ts` (a `FitRepo` and a `RepoFit` shaped like earnkitai/earnkit: `chains: { base: { basis: 'deployed', mainnet: true } }`, homepage `https://earnkit.com`, `live_verified: true`, product tier and odds as `match.ts productScore/productOdds` compute them from realistic traction: 1 to 3 users, no revenue)
- Test: `apps/frontend/lib/earnkit/v31-fit-gates.test.ts`

**Interfaces:**
- Produces `alerts.ts`: `export type FitGate = 'tier' | 'odds' | 'wide' | 'facts' | 'verdict' | 'mentioned' | 'close' | 'hard'`; `export function fitGate(p: NewProgram, r: FitRepo, o?: { apply?: boolean }): FitGate | null` (the first gate that drops the pair, null when it passes); `repoCanWin(p, r, o) === (fitGate(p, r, o) === null)`.
- Produces `bench-find.ts`: `Fit` gains `card: Pick<Card, 'id' | 'status' | 'chains' | 'any_chain' | 'ends_at' | 'max_award_usd' | 'investment'>` (Tasks 6 and 12 sort and filter on it). `investment` stays.
- Fit lines (both paths): every apply candidate, investments included, sorted by `present.ts byRelevance` (Base, then any chain; grants before investments; then deadline), at most `FITS_MAX` (3). An investment reads through `earnPrize` ("up to $400K investment"). `recordShown` and `lead` keep using the non-investment rows.

- [ ] **Step 1: Write the diagnostic tests** (pure, no DB, the committed program files through `committedProgram`):
```ts
test('(a) which gate drops Base Builder Grants for an EarnKit-like repo', ...)
// assert.equal(fitGate(newProgramOf(row('base-builder-grants')), EARNKIT_FIT_REPO, { apply: true }), null, 'gate: ' + gate)
test('(b) which gate drops Alliance ALL19 (any chain, investment)', ...) // same, 'alliance-all19'
test('(c) find path: layout() over EARNKIT_REPO_FIT keeps both rows and canApply is true for both', ...)
test('(d) repoCanWin equals fitGate === null for every committed program and both fixtures', ...)
test('(e) mcpCall find for a ranked builder whose kept match holds both: the reply names both, Base first, and never "No open program fits"', ...)
test('(f) mcpCall score: the same two fit lines in the same order', ...)
```
- [ ] **Step 2: Run; (a)/(b) FAIL and print the gate.** Record which gate fired and why.
- [ ] **Step 3: Fix the gate that is wrong, never a program fact.** Expected shape, to confirm with the test: the "close" and Hard gates are alert-worthiness rules (a nag), not eligibility; for `o.apply` they are skipped, as the investment shortcut already does; `fitsWideProgram`'s `original` miss is a ranking signal and is skipped for `o.apply` too if (b) shows it. If (0) is the cause (no match on the connect reply), the connect reply reads `keptBenchMatch` or `scoreFits` (installations.fit_repos) when the live match is cut. Then include investments in the fit lines and sort by `byRelevance`.
- [ ] **Step 4: Run; PASS** plus `alerts.test.ts`, `match.test.ts`, `v3-apply.test.ts`, `v3-programs.test.ts`, `v214-replies.test.ts`, `reply-states.test.ts`, `move-up.test.ts`, `also-qualifies.test.ts`, `digest.test.ts` (it uses `alertFit`).
- [ ] **Step 5: Commit** `fix(v3.1): the owner's repo gets its fits; investments in the fit lines (F1)` with the root cause in the body.

---

