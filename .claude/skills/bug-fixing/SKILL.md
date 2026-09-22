---
name: bug-fixing
description: Bug fixing workflow. Load when trying to fix a bug — existing behavior is incorrect, regressed, or does not match intended behavior. Emphasizes evidence, root-cause ownership, external-system behavior classification, minimal coherent fixes, and regression verification.
---

# Bug Fixing Workflow

Use when:

* existing behavior is incorrect
* existing logic produces wrong output
* previously working behavior regressed
* implementation does not match intended behavior

Do not use primarily for:

* adding new capability
* introducing new product behavior
* adding a new supported state

Use feature-development instead.

Follow `core-engineering-principles` throughout this workflow.

---

# Phase 1: Establish the Failure

Determine:

* expected behavior
* actual behavior
* reproduction conditions
* affected element/type/view/version/configuration
* whether behavior is deterministic

Do not edit production code yet.

If reproduction is unclear, investigate until the failure boundary is understood.

Do not infer root cause from the visible symptom.

---

# Phase 2: Collect Evidence

Do not guess.

Use the strongest available evidence:

* logs
* debugger state
* test failures
* runtime values
* inspector/debugger output
* extracted geometry
* serialized intermediate data
* temporary diagnostic probes
* comparison with a known-working case
* API documentation or controlled experiments when external system behavior is uncertain

Prefer observing the value at each relevant stage over reasoning from final output alone.

Temporary diagnostics should answer a specific question. Remove them after investigation unless they have lasting diagnostic value.

---

# Classify Before Fixing

For bugs involving external systems or APIs, ask early:

**Is our code wrong, or is our model of the external system's behavior wrong?**

Do not assume either.

Classify the failure where possible:

1. **Code logic bug**
2. **Wrong assumption about external system behavior**
3. **Missing representation/data**
4. **View or context difference**
5. **Dependency/environment version difference**
6. **Lifecycle/state/transaction issue**

Examples:

### Code logic bug

* wrong condition
* incorrect transform
* incorrect calculation
* wrong branch
* bad indexing or grouping

### Wrong assumption about external system behavior

* assuming an API's documented behavior matches its actual behavior
* assuming a UI/display representation matches the underlying data model
* assuming one API property has consistent semantics across categories

### Missing representation/data

* required data was never extracted
* required parameter was omitted
* only part of the available representation was considered while another part mattered

### View or context difference

* behavior differs between environments or execution contexts
* configuration/scope changes extracted data
* detail/verbosity level changes representation
* component behaves differently under a different runtime configuration

### Dependency/environment version difference

* behavior differs by dependency or runtime version
* API availability or semantics changed

### Lifecycle/state/transaction issue

* geometry requires regeneration before reading
* element state differs before and after transaction commit
* cached data became stale
* document mutation happened in the wrong transaction phase
* API result depends on current document/view state

Classification is not the root cause by itself. It narrows where to investigate.

---

# Phase 3: Trace to Root Cause

Trace backward from the incorrect result until you find the **first incorrect semantic decision, assumption, or missing input**.

Do not stop at the first function where the bad value becomes visible.

Ask:

* Where was the value first wrong?
* Where should this decision conceptually be made?
* Which component owns that responsibility?
* Did the owner receive incorrect input?
* Did the owner make the wrong decision?
* Did a downstream layer reinterpret or compensate for the decision incorrectly?
* Is this a domain bug, API adaptation bug, extraction bug, or execution bug?

Output:

```text
ROOT CAUSE:
[precise cause]

CATEGORY:
[code logic | wrong assumption about external system | missing representation/data | view/context | version | lifecycle/state/transaction | external behavior]

SEMANTIC OWNER:
[component/stage that should own the correct behavior]

EVIDENCE:
[observations proving the diagnosis]

FIX LOCATION:
[where the change belongs and why]

REGRESSION RISK:
[what adjacent behavior could be affected]
```

A root cause should describe something actionable such as:

* incorrect logic
* incorrect assumption
* missing input
* wrong data source
* wrong state transition
* wrong API interpretation
* duplicated semantic decision
* incorrect responsibility ownership

Not:

> The code failed.

And not:

> `Foo()` returned the wrong value.

unless you can explain why it returned the wrong value.

---

# Phase 4: Check Fix Ownership

Before editing, verify:

**Does the proposed fix modify the component that owns the failed responsibility?**

Prefer fixing:

`incorrect decision at owner`

over:

`downstream compensation for incorrect decision`

Be suspicious of fixes that require:

* a new `skip...` flag
* an element-specific flag passed through unrelated layers
* special handling in a distant consumer
* recalculating the same semantic result elsewhere
* preprocessing unusual data only for one downstream case
* bypassing the normal pipeline
* introducing a parallel path
* checking the same element classification in another layer

A bug is not justification for weakening semantic ownership.

If the bug exposes a missing responsibility or broken architecture, surface that explicitly rather than hiding it behind a local patch.

---

# Phase 5: Approval Boundary

For a small, well-proven fix with narrow blast radius, proceed.

Stop for approval before implementation when the fix would:

* change architecture or ownership boundaries
* alter shared contracts or DTOs
* affect multiple components or pipeline stages
* introduce a new abstraction or execution path
* change externally visible behavior beyond the reported bug
* require a meaningful tradeoff between alternative fixes

Present diagnosis and proposed fix before editing.

---

# Phase 6: Implement the Fix

Apply `core-engineering-principles`.

In particular:

* Fix the semantic owner.
* Make the smallest change that is both correct and architecturally coherent.
* Do not refactor unrelated code.
* Do not clean up adjacent systems.
* Do not add speculative improvements.
* Do not preserve a bad architecture merely to minimize the diff.
* Remove compensating logic made obsolete by the fix when it is clearly part of the same behavior.

Avoid broad rewrites unless root cause demonstrates they are necessary.

---

# Phase 7: Regression Verification

Reproduce the original failure after the fix.

Then verify:

* the original case now works
* nearby cases still work
* existing relevant tests pass
* affected environments/versions/configurations are checked when relevant

Create a targeted regression test when practical, especially when:

* the bug was deterministic
* the failure could silently recur
* the root cause involved geometry/math
* the behavior has multiple type-specific implementations
* a previous regression caused the bug
* the fix changes a shared semantic decision

The strongest regression test fails for the original defect and passes after the fix.

If automated testing is impractical because of external system/API constraints, record concrete runtime evidence instead.

Do not treat successful compilation as proof of the fix.

---

# Phase 8: Review the Fix

After implementation and verification:

Load:

`code-review.md`

Review the completed diff.

Specifically check:

* Was the root cause fixed rather than the symptom?
* Is the semantic decision still owned in one place?
* Did the fix introduce new case-specific plumbing?
* Did it create another path for one element type?
* Is temporary diagnostic code gone?
* Is obsolete compensating logic still present?
* Is regression evidence sufficient?

Only then consider the bug fixed.
