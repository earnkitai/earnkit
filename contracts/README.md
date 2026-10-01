# EarnKit campaign escrow

`EarnKitCampaigns` (factory, owned by a 48 h TimelockController) creates one `EarnKitCampaign`
clone per sponsor campaign. Each clone holds only its own pool. Money leaves a clone once, only:

- `award(winners, amounts)`: the whole prize (90%) to winners + fee (10%) to the treasury.
  Sponsor after `endsAt`; operator after `endsAt + 7 days`.
- `refund()`: everything back to the sponsor. Operator any time; sponsor after `endsAt + 60 days`.

The owner (timelock) can only change caps, operator, treasury, pauser, and unpause. It can't
touch deposited funds. The pauser can only stop new campaigns.

Each clone **snapshots `operator` and `treasury` at creation** (`initialize(sponsor, token,
amount, endsAt, operator, treasury)`, public `operator()`/`treasury()` views on the clone).
Later factory-level `setOperator`/`setTreasury` calls only affect campaigns created afterwards —
see "Known limitations" below.

## Test

    forge test                                   # unit + invariants (fork test self-skips)
    forge test --match-contract BaseUsdcForkTest --fork-url https://mainnet.base.org
    forge coverage --report summary --no-match-coverage "test|script"
    halmos --contract HalmosTest --solver-timeout-assertion 0
    slither src --filter-paths "lib|test" --exclude-dependencies
    aderyn .

### Evidence layer (this task)

- `test/invariant/Handler.sol` + `test/invariant/Invariants.t.sol`: a stateful fuzz handler
  (random sponsors/operators/strangers creating, awarding, refunding, warping, reconfiguring,
  pausing) plus 4 invariants — conservation of funds, the treasury only ever receiving fees, the
  factory never holding funds, and `prize + fee == deposit` with `fee == deposit / 10` for every
  campaign. `forge test --match-contract InvariantsTest -vv` → all 4 pass at
  `runs: 256, calls: 16384`.
- `test/halmos/Halmos.t.sol`: 5 symbolic proofs over fully symbolic amounts/durations/callers/
  timestamps — fee split, exact award payouts + caller/time gating, exact refund payouts + caller/
  time gating, the owner never extracting funds through a campaign, and (added in this task) owner
  rotation of operator/treasury never redirecting an *existing* campaign's payouts. Run with
  `halmos --contract HalmosTest --solver-timeout-assertion 0`.
  **Imports from `./EarnKitCampaignsFlat.sol`, not from `../../src/...` directly** — see
  "Analyzer notes" below for why, and how to regenerate it.
- `test/fork/BaseUsdc.t.sol`: the full create → warp → award flow against the real Base USDC
  proxy (`0x8335...29136`) on a live Base fork, using `deal()` for the token balance and
  `vm.deal()` + `vm.prank()` for the sponsor's calls.

## Analyzer notes

**Slither** (`slither src --filter-paths "lib|test" --exclude-dependencies`) — no High findings.
One Medium, explained below; all other findings are Low/Informational and accepted:

- `uninitialized-local` (Medium) on `total` in `EarnKitCampaign.award` — **false positive**:
  Solidity always zero-initializes a local of value type (`uint256 total;` starts at `0`), and the
  loop immediately after only ever adds to it before the `total != prize` check. Slither's
  detector flags any local without an *explicit* `= 0`, regardless of Solidity's guaranteed
  default; this is a well-known false-positive pattern for accumulator locals, not a reachable bug.
  Not weakened/changed — adding `= 0` would be cosmetic only and src/ is out of scope for this task.
- `events-maths` (Low) — `initialize` doesn't emit an event for `fee`/`prize`/`endsAt`; these are
  all implied by the `CampaignCreated` event the factory emits in the same transaction (with
  `amount` and `endsAt`), so there's no missing audit trail in practice.
- `missing-zero-check` (Low) on `sponsor_`/`operator_`/`treasury_` in `initialize` — `initialize`
  is only ever called once, by the factory, immediately after `Clones.clone`; the factory's own
  setters (`_setOperator`, `_setTreasury`) already reject the zero address, and `sponsor_` is
  always `msg.sender` of `createCampaign` (never the zero address for an external call).
- `timestamp` (Low) — the time-gated award/refund windows and the campaign-duration bound are
  intended behavior, not accidental timestamp manipulation surface (Base's block timestamp can't
  be manipulated by more than a few seconds by a validator, far below the day/week granularity
  these checks use).
- `unindexed-event-address` (Informational) on `OperatorSet`/`TreasurySet`/`PauserSet` — these are
  rare, owner-only, already-timelocked config events; indexing isn't needed for off-chain
  filtering at the expected volume (at most a handful of these events ever).

**Aderyn** — could not be run in this environment. `npx -y @cyfrin/aderyn` downloads a prebuilt
binary from `release-assets.githubusercontent.com` on first use; that host is unreachable from
this sandbox (`curl` to it fails with a TLS/connection error — `github.com` itself and
`registry.npmjs.org` are reachable, only the release-asset CDN host is blocked). The documented
alternative, `cargo install aderyn`, isn't usable either: no Rust toolchain (`cargo`/`rustc`) is
installed, and installing one is outside this task's scope. See `task-2-report.md` for the exact
commands and errors. Re-run `npx -y @cyfrin/aderyn . -o /tmp/aderyn.md` from a network that can
reach GitHub release assets before mainnet deployment.

### Known limitations

- **Operator/treasury snapshot vs. key rotation.** Each clone snapshots `operator` and `treasury`
  at creation; the owner (timelock) rotating the factory's operator or treasury only affects
  campaigns created *afterwards*. Trade-off: if an operator key is compromised, it **cannot be
  rotated out of already-funded campaigns**. A compromised operator can still award an existing
  stale campaign once the 7-day grace period has passed, or refund one at any time (refunds only
  ever go back to that campaign's own sponsor, never to the operator or anyone else — see
  `check_ownerCannotTakeFunds` and `check_ownerRotationCannotRedirectExisting` in
  `test/halmos/Halmos.t.sol`). This is an accepted trade-off for this version, not a bug: it keeps
  a campaign's payout rules fixed and auditable for its whole lifetime.
- **Token-type risks for future allowlisted tokens.** Only the owner (timelock) can allowlist a
  token via `setCap`, and USDC is the only token allowlisted today, but the mechanism allows more:
  - **Blocklisting** (USDC and similar tokens can block/freeze an address): if a chosen winner is
    blocked, `award` reverts for the whole batch and the sponsor can pick again with a different
    winner list; if the *sponsor* is blocked, `refund` reverts and that campaign's funds are stuck
    in the clone until the sponsor is unblocked (no unilateral owner/operator rescue path exists
    by design, since operator/refund funds only ever go to `sponsor`).
  - **Pausable tokens**: a token-level pause can delay `award`/`refund` until it's lifted; it can't
    redirect funds.
  - **Rebasing and fee-on-transfer tokens must never be allowlisted.** `createCampaign` already
    rejects fee-on-transfer tokens at creation time (it checks the clone's balance delta against
    the declared `amount`; see `test_create_reverts_feeOnTransferToken`), but a rebasing token
    would silently desync the clone's real balance from `prize + fee` after creation — do not add
    one to the cap list.

## Deploy

See `script/Deploy.s.sol`. The owner runs it from their own wallet.
