---
name: code-review
description: Code quality review gate. Use after implementation or before declaring code complete. Checks correctness, maintainability, failure handling, simplicity, architecture, and regressions.
---

# Code Review Gate

Run before declaring implementation complete.

Review the diff.

---

# Correctness

Check:

- Does implementation match intended behavior?
- Any requirements silently removed?
- Any edge cases ignored?
- Any stale state?
- Any incorrect assumptions?

---

# Failure Handling

Find:

- swallowed errors
- empty catch blocks
- silent failures
- misleading fallbacks
- ignored error states

---

# Simplicity

Check:

- unnecessary abstractions
- duplicate logic
- dead code
- unused parameters
- unnecessary files
- long mixed-responsibility functions

---

# Reasoning Quality

Check:

- unclear ownership
- hidden state
- magic values
- confusing naming
- excessive nesting
- implicit behavior
- difficult data flow

---

# Architecture

Check:

- correct module ownership
- no duplicated state ownership
- no unnecessary coupling
- boundaries respected

If the codebase has an integration/compute boundary:

Verify:

```
External/integration layer
    ↓
DTO boundary
    ↓
Compute layer
```

External objects should not leak into pure computation.

---

# External System / API Integration Review

Check:

- API assumptions verified
- transactions/side effects correct
- references/handles valid
- units handled
- context (env/view/state) correct
- data source confirmed
- failure handling intentional

---

# Knowledge Drift

Check:

- Does implementation still match the project's recorded knowledge (e.g. `docs/codebase-context`)?
- Did dependency/environment changes invalidate assumptions?
- Did new code bypass known patterns?

If drift is found:

- flag it
- fix code or update the knowledge doc after verification

Do not leave code and documented knowledge silently diverged.

---

# Output

For every issue:

```
[severity] file:line — problem — why it matters — suggested fix
```

Severity:

critical:
- bugs
- data loss
- broken behavior

major:
- maintainability problems
- architecture issues

minor:
- style
- readability

End:

```
Counts:
critical:
major:
minor:

Top fixes:
1.
2.
3.

Codebase became easier/harder to reason about:
```
