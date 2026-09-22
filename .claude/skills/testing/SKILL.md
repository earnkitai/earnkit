---
name: testing
description: Testing strategy. Use when adding regression coverage, validating production behavior, or deciding test approach.
---

# Testing Strategy

Testing has two separate purposes:

1. Verify known behavior.
2. Discover unknown behavior.

Do not confuse them.

---

# Tests vs Direct Observation

```
Tests verify behavior.

Direct observation (logging, debugging tools, runtime inspection) verifies reality.
```

They serve different purposes.

Do not replace direct observation with tests.

Do not treat tests as discovery of unknown external-system behavior.

---

# Discovery Probes

Discovery probes are not tests.

Purpose:

Understand reality.

Allowed:
- temporary commands
- diagnostic output
- inspection tools
- experiments

Examples:

- inspect geometry sources
- inspect parameters
- inspect relationships
- inspect view representation

Promote useful probes into reusable inspection/debugging tooling.

---

# Production Tests

Purpose:

Prevent regressions.

Tests should:

- verify user-visible behavior
- cover important edge cases
- protect known contracts

---

# Unknown Behavior vs Known Contract

## Unknown behavior

Discovery first.

Do not write tests against assumptions.

Do not invent expected values from documentation, memory, or guesses.

Probe → confirm → then decide what contract/tests should assert.

## Known contract

Tests before implementation.

For new production logic with a confirmed contract:

1. Understand domain.
2. Define contract in source (types/signatures only — not a docs contract file).
3. Write tests.
4. Implement bodies.

Do not write tests for unknown assumptions.

---

# When Testing Is Required

Load and apply testing when:

- production behavior changed
- bug regression possible
- contract behavior needs verification

Do not wait for the user to ask for tests.

---

# Integration Testing

Integration tests are different from pure code tests.

Separate:

Pure logic:

- normal unit tests

External integration:

- real external environment
- actual data/session
- actual API behavior

Do not mock away the thing being tested.

---

# Regression Rule

When fixing a bug:

Add regression coverage if:
- bug can return silently
- behavior matters long-term

Skip when:
- fix is trivial
- no stable behavior exists yet
- investigation is still ongoing
