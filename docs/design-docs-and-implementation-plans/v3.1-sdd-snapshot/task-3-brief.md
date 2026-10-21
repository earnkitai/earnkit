### Task 3 (F3): no rank below 10 ranked builders (I: Opus, R: Opus)

**Files:**
- Modify: `apps/frontend/lib/earnkit/rank.ts` (constant and helper), `apps/frontend/lib/earnkit/bench-rank.ts:30-50` (`rankLines`), `apps/frontend/lib/earnkit/stand-text.ts:20` (news line), `apps/frontend/lib/earnkit/page-data.ts:73`, `apps/frontend/lib/earnkit/weekly-target.ts poolPlace/targetIn`, `apps/frontend/lib/earnkit/weekly-moment.ts momentLines/shareText`, `apps/frontend/lib/earnkit/builder-json.ts:53`, `apps/frontend/lib/earnkit/bench-data.ts` (`ProfileData.rankListed`)
- Test: `apps/frontend/lib/earnkit/v31-rank-pool.test.ts`; update `rank.test.ts`, `weekly-moment.test.ts`, `weekly-target.test.ts`, `digest.test.ts`, `v3-monday-email.test.ts`, `v3-backing.test.ts` (JSON), `profile-bench.test.ts`, `v3-profile.test.ts`, `card-route.test.ts`, `v3-landing.test.ts` wherever a fixture pool under 10 asserts "#N of M"

**Interfaces:**
- `rank.ts`: `export const RANK_MIN_POOL = 10`; `export function shownRankLine(s: Standing, o?: { chain?: BenchChain }): string | null` = `s.total >= RANK_MIN_POOL ? rankLine(s, o) : null`. `rankLine` itself is unchanged (the leaderboard list and the builder JSON use it).
- `RankLines` gains `listed: boolean` (rankLine of the whole pool is non-null); `bench` and each chain line use `shownRankLine` (a chain line against its own chain pool total). `line` follows `bench` ("Shipping 60" alone).
- `stand-text.ts standingNews`: no news line when `shownRankLine` is null.
- `poolPlace` returns `total: number` too; `targetIn` sets `rank: null, above: null` when `total < RANK_MIN_POOL` (R14).
- `weekly-moment.ts`: `momentLines` head without the rank part when `now.total < RANK_MIN_POOL`: `Last week you finished at Shipping 72 (+6).` / `Last week you finished at Shipping 72.`; `shareText(w)` = `My week on EarnKit: Shipping 72` under 10, unchanged from 10. The digest subject follows (it slices `shareText`).
- `builder-json.ts`: `rank: d.rankListed && s.ranked && s.listed ? s.rank : null` (never cut by the pool size).
- Profile: `Numbers` shows `DASH` for Rank while `bench` is null on a ranked page (R16).

- [ ] **Step 1: Tests**
```ts
test('(a) 9 ranked builders: find and score replies, the moment and the share post carry no "#"', ...)
test('(b) 10 ranked builders: "#3 of 10 builders" as today', ...)
test('(c) the Monday email subject and body under 10: "Your week on EarnKit: Shipping 60", no "#"', ...)
test('(d) builder JSON keeps rank at 1 of 1', ...)
test('(e) the profile shows a dash for Rank under 10', ...)
```
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus the files listed above.
- [ ] **Step 5: Commit** `feat(v3.1): no rank below 10 ranked builders (F3)`

---

