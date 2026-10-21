### Task 4: the ranked reply loses words (I: Opus, R: Opus)

Owner: "too many words". Also spec 3.4 Originality and Points line in replies; F4's points line.

**Files:**
- Modify: `apps/frontend/lib/earnkit/bench-reply.ts:179-216` (`standLine`, `benchReply`), `apps/frontend/lib/earnkit/bench-find.ts:466-470` (no `points` FundLine)
- Test: `apps/frontend/lib/earnkit/v31-reply-trim.test.ts`; update `bench-reply.test.ts`, `v3-points.test.ts:91-93` (the reply no longer has `POINTS_LINE`; the ledger still writes), `originality.test.ts` (reply side), and every reply assertion that includes the why sentence: `busy-repo-weeks.test.ts`, `profile-bench.test.ts` (reply parts only), `reply-states.test.ts`, `score-v2.test.ts`, `v214-app-proof.test.ts`, `weekly-moment.test.ts` (find them with `grep -n "Code in [0-9]* of the last 12 weeks" apps/frontend/lib/earnkit/*.test.ts`); `v3-programs.test.ts (e)` (upcoming line)

**Interfaces:**
- `benchReply`: the why sentence is not shown (`BenchView.why` stays for the page and `ship_log`); `originalityWords` is not used in the reply (the function and `BenchView.originality` stay); the `points` FundLine kind and `POINTS_LINE` stay exported but `benchView` no longer adds a `points` line; the `upcoming` line shows only when the reply has no fit line and no Best fit (Task 6 adds `best`; until then: no fit line).

- [ ] **Step 1: Tests**
```ts
test('(a) a ranked reply has no why sentence, no Originality and no Points line', ...)
test('(b) the upcoming line shows only with no fit', ...) // 4-week streak, a fit: absent; no fit: "Base Batches 005: up to $100K investment, not open yet. ..."
test('(c) builder_points still gets its row on approval', ...)
```
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus the updated files.
- [ ] **Step 5: Commit** `feat(v3.1): the ranked reply drops the why, Originality, points and the upcoming line (F4)`

---

