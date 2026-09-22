---
name: feature-development
description: Feature development workflow. Load once planning is done and it's time to start implementing — adding capabilities, introducing new state, or changing system behavior. Covers discovery, ownership, contract, approval, tests, and layered implementation.
---

# Feature Development Workflow

Use when the primary intent is to intentionally add or change supported behavior:

* adding functionality
* supporting a new element, geometry, workflow, or case
* adding new business behavior
* introducing new state as part of a feature
* changing intended system capabilities

Do not use primarily for:

* correcting behavior that is already intended to work
* regressions
* exploratory investigation
* API research without an implementation task

If the primary goal is fixing incorrect existing behavior, use `bug-fixing` even if the eventual fix requires adding state or changing internal structures.

Follow `core-engineering-principles` throughout.

---

# Phase 0: Understand the Product Requirement

Before designing implementation, establish:

1. What user outcome are we creating?
2. What existing behavior does it extend or replace?
3. What is in scope?
4. What is explicitly out of scope?
5. What must remain unchanged?

Investigate available product context, code, tests, and existing behavior before asking questions that can be answered locally.

Surface unresolved questions only when different answers would materially change behavior, architecture, or scope.

Do not start designing implementation around an unclear product outcome.

---

# Phase 1: Discovery

Before designing ownership or contracts, determine whether important technical facts are unknown.

For features involving external systems or APIs, do not design against assumed behavior.
Investigate and verify first when:

* API behavior is unknown
* visible/UI behavior does not clearly map to API objects
* data representation is uncertain
* context-dependent behavior matters
* transaction or state-refresh behavior is uncertain
* multiple API surfaces could represent the same concept
* version behavior may differ
* required data may not exist in the assumed form

Example:

> Add support for a new derived field in an API response.

Before designing DTOs or ownership, determine what upstream representation actually produces that value.

Discovery should answer only the technical questions required for design.

Do not continue collecting information once design-critical uncertainty is resolved.

Skip dedicated discovery when the relevant behavior is already proven by:

* existing code
* tests
* runtime evidence
* established API behavior

---

# Phase 2: Identify Responsibilities and Ownership

After reality is understood well enough, identify the semantic responsibilities involved.

Ask:

1. What new semantic decisions does this feature require?
2. Which existing component owns each decision today?
3. Is this a genuinely new responsibility or a new case of an existing responsibility?
4. What existing pipeline stages should remain unaware of the new case?
5. What state, if any, is introduced?
6. What boundaries does data cross?

Prefer extending an existing semantic owner over creating another path.

Apply:

**One semantic decision, one owner. Different cases may use different implementations inside that owner.**

Do not organize architecture around:

* the new element type
* the customer request
* the limitation that motivated the feature
* whatever layer currently has convenient access to the data

---

# State Lifecycle

Only when the feature introduces meaningful state, define its lifecycle explicitly.

Answer:

* What state exists?
* Who owns it?
* Who may mutate it?
* Who only reads it?
* When is it created?
* When is it invalidated?
* What happens when source data changes?
* Does it survive transactions?
* Does it survive document reload?
* Does undo/redo affect it?
* Does it need synchronization with external system state?

For caches or references backed by an external system, explicitly consider:

* transaction boundaries
* state refresh/regeneration
* reference invalidation
* session/connection close-reopen
* context changes
* undo/redo
* dependency/environment version differences

Do not create state when the same behavior can be derived reliably and cheaply.

---

# Phase 3: Build the Skeleton

Before writing business logic, make the proposed architecture visible in the real codebase.

Create or modify the actual source files that define the feature shape.

The skeleton may include:

* interfaces
* domain types
* DTOs
* records
* enums
* method signatures
* service boundaries
* constructor dependencies
* ownership boundaries
* orchestration entry points
* result types
* error/result contracts
* dependency injection wiring required to express the dependency graph

The goal is to make the architecture reviewable before implementation details hide structural mistakes.

## Allowed

* interfaces
* records and data-only classes
* enums
* method signatures
* abstract boundaries
* constructor dependencies
* dependency registration needed to express the architecture
* orchestration signatures
* compile-safe placeholders only where unavoidable
* short comments explaining ownership, responsibility, or invariants

## Not Allowed Yet

* business logic
* geometry algorithms
* placement algorithms
* decision logic
* external-system extraction logic beyond already-established adapters
* implementation-heavy helpers
* speculative convenience methods
* speculative DTO fields
* fake implementations added merely to make the skeleton appear complete

Do not create documentation-only contract files that duplicate the real source contract.

The code is the contract.

The skeleton should answer:

1. What components exist?
2. What responsibility does each component own?
3. What data crosses each boundary?
4. What calls what?
5. Where will each semantic decision live?
6. Where does external-system-specific code stop and domain logic begin?
7. What state exists and who owns its lifecycle?
8. What outputs and failure states are exposed?

Do not hide unresolved architecture questions inside placeholder implementations.

If the skeleton exposes a missing requirement or unclear responsibility, stop and surface it.

---

# Phase 4: Define Execution Flow

After the source skeleton exists, describe the runtime flow separately.

The execution flow should reflect the skeleton exactly.

Include:

* entry point
* major stages
* important inputs
* important outputs
* meaningful branches
* ownership transitions
* external/API boundaries

Do not include:

* tiny validations
* helper functions
* implementation noise
* line-by-line details

Format when useful:

```text
# Feature Flow

ENTRY

[caller]
  → [component](input): output
  → [component](input): output
  → [component](input): output

BRANCH

if [condition]
  → [path A]
else
  → [path B]
```

A reviewer should be able to answer:

* What runs next?
* Which component owns each decision?
* What data moves between stages?
* Where does external-system-specific behavior end?
* Where does domain logic begin?
* Where is the final result adapted back into the external system?

If the flow and source skeleton disagree, fix the design before implementation.

Do not require a formal flow for trivial localized features.

---

# Phase 5: Skeleton Approval Gate

For non-trivial features, stop before writing business logic.

Output:

```text
SKELETON COMPLETE:

- [important interfaces/types/components]
- [ownership decisions]
- [execution flow]
- [important assumptions or unresolved tradeoffs]

NEED APPROVAL BEFORE BUSINESS LOGIC.
```

Wait for explicit approval.

Do not proceed to implementation bodies before approval.

This approval gate exists so architecture can be reviewed while it is still cheap to change.

A feature is non-trivial when it introduces or changes any of:

* services
* DTO boundaries
* domain types
* semantic ownership
* pipeline behavior
* external-system integration
* significant state
* shared contracts
* multi-stage execution

A tiny localized extension of an already-established pattern may skip the explicit gate when no meaningful design choice exists.

When uncertain, prefer showing the skeleton first.

---

# Phase 6: Design Verification Strategy

After skeleton approval and before substantial implementation, determine how correctness will be proven.

Do not write tests against unverified external-system assumptions.

For pure or domain logic, prefer:

* unit tests
* deterministic geometry tests
* invariant/property tests where useful

For external-system/API integration, use the strongest practical evidence available:

* integration tests
* controlled test environments
* runtime verification
* diagnostic/inspection commands
* focused diagnostic probes

Exploration probes are evidence, not automatically permanent tests.

Tests should cover meaningful behavior and invariants, not methods merely because they exist.

Prioritize:

* main expected behavior
* important edge cases
* shared semantic decisions
* known failure modes
* behavior likely to regress
* silent failure cases

---

# Phase 7: Write Tests

Load `testing.md`

For known, testable behavior, write tests before implementation where practical.

Tests should express the approved contract and intended behavior.

Do not couple tests to implementation structure unnecessarily.

Do not test:

* private helper structure
* exact internal call ordering unless behavior depends on it
* speculative future cases

For external-system behavior that cannot be isolated realistically, define the runtime verification procedure instead of creating fake tests.

A good test should fail when the intended behavior is absent or wrong and pass when the feature works.

---

# Phase 8: Implement Business Logic

Only after skeleton approval may implementation bodies be added.

Implement according to semantic responsibility.

Maintain dependency direction:

```text
External data
        ↓
Domain representation
        ↓
Core semantic decisions
        ↓
Result
        ↓
External adaptation and execution
```

Typical responsibilities:

## Domain / Data

Contains:

* domain types
* DTOs
* normalized representations
* meaningful state

Avoid hiding business decisions inside passive data structures unless that behavior genuinely belongs to the domain object.

## Core Logic

Contains:

* transformations
* geometry
* calculations
* classification
* topology
* business decisions
* placement decisions

Avoid direct external API dependencies when the logic can operate on domain representations.

## Integration

Contains:

* external API interaction
* session/context access
* transactions
* state refresh
* filesystem
* network/external systems
* conversion between external API objects and domain representations

Integration may measure, adapt, and execute.

It should not independently recreate domain decisions already owned elsewhere.

---

# Implementation Strategy

The skeleton is approved before business logic, but implementation does not need to follow an artificial "finish all data, then all core, then all integration" sequence.

Choose the implementation order that gives reliable feedback while preserving the approved boundaries.

For uncertain features, a narrow vertical slice may be best:

```text
real input
→ approved domain boundary
→ minimal core behavior
→ real output
```

Prove the path.

Then expand coverage.

For well-understood features, implementing shared domain/core logic first may be cleaner.

Regardless of order:

* preserve the approved skeleton unless new evidence invalidates it
* do not silently change interfaces or ownership while implementing
* do not mix unrelated responsibilities
* do not add hypothetical future requirements
* do not teach unrelated layers about the new case
* do not add new DTO fields merely because implementation became inconvenient

If implementation reveals that the approved skeleton is wrong:

Stop.

Explain:

```text
DESIGN CHANGE REQUIRED:

What changed:
[new evidence]

Why current skeleton is insufficient:
[reason]

Proposed skeleton change:
[change]
```

Get approval before materially changing the architecture.

---

# Adding a New Supported Case

When adding another element type, geometry, convention, or similar variant:

1. Find the existing semantic owner.
2. Determine which differences are genuine domain differences.
3. Add the variation inside that owner.
4. Reuse existing semantic classifications and registries.
5. Avoid case-specific flags passing through unrelated layers.
6. Avoid creating another pipeline solely for the new type.
7. Avoid rediscovering the same semantic classification in multiple places.
8. Verify that the next similar case would have an obvious place to go.

The feature is not architecturally complete if several unrelated layers must independently understand why the new case is special.

---

# Phase 9: Verify

After implementation, verify the intended user outcome.

Do not treat successful compilation as completion.

Run:

* focused tests first
* relevant broader tests when blast radius warrants them
* runtime verification when API behavior is involved

Check:

* expected feature behavior
* important edge cases
* unaffected existing behavior
* state lifecycle where relevant
* view differences where relevant
* version differences where relevant
* failure behavior
* failure visibility
* contract invariants
* behavior across the approved ownership boundaries

Compare results against Phase 0 requirements.

Do not claim completion without evidence.

---

# Phase 10: Review

After implementation and verification:

Load:

`code-review.md`

Review the completed change.

Specifically check:

* Does implementation still match the approved skeleton?
* Did any interfaces or DTOs drift during implementation?
* Did business logic leak into a boundary that was supposed to adapt only?
* Did we add a new semantic responsibility or merely a new case?
* Is each semantic decision owned in one place?
* Did the feature create a parallel path?
* Did unrelated layers learn about the new case?
* Were speculative fields added?
* Is external-system-specific behavior confined to appropriate boundaries?
* Is new state lifecycle explicit?
* Are failure modes visible?
* Is verification strong enough for the blast radius?
* Was unnecessary scope added?

Only then consider the feature complete.

---

# Short Form

For non-trivial feature work:

**Requirement → Discovery → Semantic ownership → Source skeleton → Execution flow → Approval → Tests/verification design → Business logic → Verification → Review**

The important gate is:

**Make architecture concrete before implementation. Review interfaces, types, boundaries, dependencies, and execution flow before business logic creates momentum around a bad design.**
