### Task 2 (F2): the connect question says where the weeks go (I: Sonnet, R: Sonnet)

**Files:**
- Modify: `apps/frontend/lib/earnkit/bench-reply.ts:55` (`CONNECT_ASK` → `connectAsk`), `:160-170` (`stateAsk` input gains `handle`), `apps/frontend/lib/earnkit/connect-moment.ts:5-6` (re-export), `apps/frontend/lib/earnkit/bench-find.ts:474` (pass `handle`)
- Test: update `v3-connect.test.ts:63,76`, `v214-app-proof.test.ts:103`; add case (g) to `v3-connect.test.ts`

**Interfaces:**
- `export const connectAsk = (handle: string) => \`Post these weeks to your public page? Yes puts them on ${pageUrl(handle)} and the Feed.\`` (`pageUrl` is schemeless; the reply's one https link stays the page line). `CONNECT_ASK` is removed. `stateAsk(v: ... & { handle?: string | null })`; connect is only asked with a handle (benchView already requires it).

- [ ] **Step 1: Test** `(g) the connect question names the page and the Feed, one https link, one question` (mcpCall find after connect: ends with `How to move up\nPost these weeks to your public page? Yes puts them on earnkit.com/<handle> and the Feed.`).
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus `bench-reply.test.ts`, `reply-states.test.ts`, `copy-review.test.ts` (add `connectAsk('maya')` to `v2121Texts`).
- [ ] **Step 5: Commit** `fix(v3.1): the connect question says where the weeks go (F2)`

---

