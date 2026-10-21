### Task 5 (F4): the weekly target and the Monday line name the rank only (I: Sonnet, R: Sonnet)

**Files:**
- Modify: `apps/frontend/lib/earnkit/weekly-target.ts:44-101` (`weeklyTarget`, `weekStartLine`; `shortOf` stays exported, unused by copy)
- Modify: `apps/frontend/lib/earnkit/fixtures/ranked-step.ts` (`RANKED_STEP`), `apps/frontend/lib/earnkit/fixtures/profile-data.ts:8`
- Test: rewrite `weekly-target.test.ts` expectations; update `bench-reply.test.ts:16-45`, `weekly-moment.test.ts:76-258`, `v214-app-proof.test.ts:112`, `profile-bench.test.ts:52,131`, `v3-profile.test.ts:61`, `copy-review.test.ts weeklyCopy`

**Interfaces (exact copy):**
- Reply voice: active week `Done this week.`; no gain and a rank `Ship code this week to hold #3.`; rank null `Ship code this week.`; no one above `Ship code this week to hold #1.`; this week passes `Ship code this week to pass #2.`; not enough `Ship code this week to move toward #2.`
- Page voice: active `Shipped this week.`; no gain or rank null: `null`; hold `Code this week holds #1.`; pass `Code this week passes #2.`; not enough `Code this week moves toward #2.`
- `weekStartLine`: `This week starts at Shipping 50: ship code to pass #2.` / `... to hold #1.` / `... to move toward #2.` / rank null `This week starts at Shipping 50: ship code to climb.`; null when the week has code or adds nothing (unchanged).
- `RANKED_STEP = /^(Ship this week to climb\.|Ship code this week( to (hold|pass|move toward) #\d+)?\.|Done this week\.)$/`
- No string anywhere in these outputs matches `/\+\d+|points/`.

- [ ] **Step 1: Tests** (rewrite) `L5.1 ... rank only`, plus `(n) no target, page line or week-start line contains "+N" or "points"` over every shape.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus the files listed.
- [ ] **Step 5: Commit** `feat(v3.1): the weekly target names the rank, never the points (F4)`

---

