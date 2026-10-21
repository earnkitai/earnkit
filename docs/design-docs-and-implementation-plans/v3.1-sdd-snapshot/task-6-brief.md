### Task 6: Best fit leads; rolling programs get the draft offer; apply before backing (spec 3.2) (I: Opus, R: Opus)

**Files:**
- Modify: `apps/frontend/lib/earnkit/bench-reply.ts` (`BenchView.best`, `bestFitLine`, `applyAsk`, `ApplyPick.when`, `stateAsk` order, `benchReply` first line)
- Modify: `apps/frontend/lib/earnkit/bench-find.ts:382-528` (`benchView`: apply computed before backing; `applyPick` split), `:871-875` unchanged
- Test: `apps/frontend/lib/earnkit/v31-best-fit.test.ts`; update `v3-apply.test.ts` (the order tests and the "never rolling" assertion), `v3-backing.test.ts (a)` (backing now waits behind an open apply ask), `bench-reply.test.ts`, `reply-states.test.ts`, `v2133-owner-test.test.ts` (stateAsk order)

**Interfaces:**
- `bench-reply.ts`:
  - `export type ApplyPick = { program_id: string; title: string; when: string | null }` (`null`: rolling).
  - `export const applyAsk = (title: string, when: string | null) => when ? \`${title} closes ${when}. Want me to draft your application from your ship log?\` : \`${title} is open now (rolling). Want me to draft your application from your ship log?\``
  - `export type BestFit = { program_id: string; title: string; prize: string; when: string; why: string; codes: string | null }` (`when` as `fundWhen`: "closes Nov 18" or "rolling"; `codes`: Task 7's sentence or null).
  - `export const bestFitLine = (b: BestFit) => \`Best fit: ${b.title}, ${b.prize}, ${b.when}. ${b.why}${b.codes ? \` ${b.codes}\` : ''}\``
  - `BenchView.best?: BestFit | null`; `benchReply` puts `bestFitLine(best)` as the first line of the reply (its own paragraph, above "Where you stand") in the ranked state only.
  - `stateAsk` ranked order: connect > apply > backing > share > ship.
- `bench-find.ts`:
  - `export function applyCandidates(fits: Fit[], seen: Seen, skip: Set<string>, now: Date): Fit[]` (pure): not skipped, not declined in the last `DECLINE_MS` (`declined['apply:<id>']`); the dated ones closing within `APPLY_WINDOW_DAYS` in `byDeadline` order; if none, the rolling ones (`ends_at === null`) in `byRelevance` order (on `Fit.card`).
  - `async function openCandidates(id, fits): Promise<Fit[] | null>`: drops those in `builder_program_status` for this person (any status); null on a read error.
  - Best fit = `open[0]` (R11). Apply ask = the first of `open` not in `seen.apply_asked`, taken with the existing guarded UPDATE. A shown apply ask holds backing and the weekly moment for a later reply.
  - Never for `taken`, a held question, or a non-ranked state.

- [ ] **Step 1: Tests**
```ts
test('(a) a rolling fit only: Best fit line first, then the rolling ask, once', ...) // "Best fit: Base Builder Grant Program, up to $5K, rolling. ..." and "... is open now (rolling). Want me to draft ..."
test('(b) a fit closing in 20 days wins over a rolling one; one closing in 45 days does not', ...)
test('(c) apply before backing: with both due, the apply ask shows; the next reply offers backing', ...) // withEnv EARNKIT_RAISING on
test('(d) a no keeps the program off the Best fit line and the ask for 30 days', ...)
test('(e) a taken repo or a program in builder_program_status: no Best fit line, no ask', ...)
test('(f) one https link and one question in every reply above', ...)
test('(g) score shows the same Best fit line as find', ...)
```
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS** plus the updated files and Task 1's `v31-fit-gates.test.ts`, Task 4's `v31-reply-trim.test.ts` (upcoming shows only with no fit and no Best fit).
- [ ] **Step 5: Commit** `feat(v3.1): Best fit leads every ranked reply; rolling programs get the draft offer; apply before backing`

---

