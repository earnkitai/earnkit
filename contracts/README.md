# EarnKit campaign escrow

`EarnKitCampaigns` (factory, owned by a 48 h TimelockController) creates one `EarnKitCampaign`
clone per sponsor campaign. Each clone holds only its own pool. Money leaves a clone once, only:

- `award(winners, amounts)`: the whole prize (90%) to winners + fee (10%) to the treasury.
  Sponsor after `endsAt`; operator after `endsAt + 7 days`.
- `refund()`: everything back to the sponsor. Operator any time; sponsor after `endsAt + 60 days`.

The owner (timelock) can only change caps, operator, treasury, pauser, and pause/unpause new
campaign creation. It can't touch deposited funds. The pauser can also pause (not unpause) new
campaign creation; neither the owner nor the pauser can block or affect an existing campaign's
`award`/`refund`.

Each clone **snapshots `operator` and `treasury` at creation** (`initialize(sponsor, token,
amount, endsAt, operator, treasury)`, public `operator()`/`treasury()` views on the clone).
Later factory-level `setOperator`/`setTreasury` calls only affect campaigns created afterwards —
see "Known limitations" below.

## Test

    forge test                                   # unit + invariants (fork test self-skips off-fork)
    forge test --match-contract BaseUsdcForkTest --fork-url https://mainnet.base.org
    forge coverage --report summary --no-match-coverage "test|script"
    ./test/halmos/check-flat.sh && halmos --contract HalmosTest --solver-timeout-assertion 0
    slither src --filter-paths "lib|test" --exclude-dependencies
    npx -y @cyfrin/aderyn .

Halmos and Slither need a Python 3.10+ environment (system Python may be older): create one with
`python3.12 -m venv venv && source venv/bin/activate && pip install halmos slither-analyzer`, then
run the commands above from inside that venv. Aderyn runs via `npx` (Node, no global install).

### Evidence layer

- `test/invariant/Handler.sol` + `test/invariant/Invariants.t.sol`: a stateful fuzz handler
  (sponsors, the operator, the owner, a stranger, and the pauser creating, awarding, refunding,
  warping, reconfiguring, and pausing) plus invariants that check actual token balances against
  per-party ghost accounting — fund conservation, the treasury only ever receiving fees, the
  factory never holding funds, per-campaign fee math against the real deposited amount, winners'
  combined balance equals what they were ever paid, each sponsor's balance equals what it
  deposited minus what it got refunded, and (critically) that no `award`/`refund` ever succeeded
  for a disallowed caller or time — enforced both as an immediate assertion inside the handler and
  as a standing `unauthorizedSuccesses == 0` invariant. `forge test --match-contract
  InvariantsTest -vv` → all pass at `runs: 256, calls: 16384`.
- `test/halmos/Halmos.t.sol`: 5 symbolic proofs over fully symbolic amounts/durations/callers/
  timestamps — fee split, exact award payouts + caller/time gating, exact refund payouts + caller/
  time gating, the owner never extracting funds through a campaign, and owner rotation of
  operator/treasury never redirecting an *existing* campaign's payouts (including that a
  legitimate sponsor award after rotation cannot be silently swallowed by a `catch {}`). Run with
  `./test/halmos/check-flat.sh && halmos --contract HalmosTest --solver-timeout-assertion 0`.
  **Imports from `./EarnKitCampaignsFlat.sol`, not from `../../src/...` directly** — see
  "Analyzer notes" below for why, and `check-flat.sh` for the staleness guard.
- `test/fork/BaseUsdc.t.sol`: the full create → warp → award flow against the real Base USDC
  proxy (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) on a live Base fork, using `deal()` for the
  token balance and `vm.deal()` + `vm.prank()` for the sponsor's calls. Reports **skipped** (not
  passed) when not run against a Base fork, via `vm.skip`.

## Analyzer notes

**Halmos** proves its properties against `test/halmos/EarnKitCampaignsFlat.sol`, a `forge
flatten` of `src/EarnKitCampaigns.sol` (which pulls in `src/EarnKitCampaign.sol`), instead of
importing `src/` directly. Reason: with a direct `src/` import, Halmos 0.3.3 fails every check
before evaluating any property (`HalmosException: No successful path found in setUp()` /
`Unsupported cheat code: deployCode(...)`) while constructing either contract. Bisection showed
this is a Halmos build-resolution bug tied to these two source files specifically (one file name a
strict prefix of the other, each imported by several other files in this project) and not a
contract bug: a byte-identical copy of the same two contracts, under a different path or flattened
into one file, builds and runs under Halmos with zero logic changes. Because the flattened copy
can drift from `src/` silently, `test/halmos/check-flat.sh` re-flattens `src/` on demand and diffs
it against the committed copy, failing loudly on any difference. Always run it immediately before
Halmos:

    ./test/halmos/check-flat.sh && halmos --contract HalmosTest --solver-timeout-assertion 0

Regenerate the flattened copy after any `src/` change with:

    forge flatten src/EarnKitCampaigns.sol -o test/halmos/EarnKitCampaignsFlat.sol

Pre-mainnet, retry importing `src/` directly on a newer Halmos release so this workaround (and the
staleness risk it carries) can be dropped entirely.

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

**Aderyn** — has not been run against this codebase yet in any environment. The sandbox this task
was developed in couldn't run it: `npx -y @cyfrin/aderyn` downloads a prebuilt binary from
`release-assets.githubusercontent.com` on first use, and that specific host was unreachable
(`curl` to it failed with a TLS/connection error, while `github.com` itself and
`registry.npmjs.org` were both reachable — only the release-asset CDN host was blocked). The
documented alternative, `cargo install aderyn`, wasn't usable either: no Rust toolchain
(`cargo`/`rustc`) was installed, and installing one was out of that task's scope.
**This is a pre-mainnet gate, not optional**: run `npx -y @cyfrin/aderyn . -o /tmp/aderyn.md` from
an unrestricted network (a developer laptop or an unrestricted CI runner) and resolve any High/
Medium finding before mainnet deployment.

## Known limitations

- **Operator/treasury snapshot vs. key rotation — what a compromised operator key can actually
  steal.** Each clone snapshots `operator` and `treasury` at creation; the owner (timelock)
  rotating the factory's operator or treasury only affects campaigns created *afterwards*, and
  cannot rotate a compromised operator out of campaigns that already exist. Concretely: once
  `endsAt + 7 days` has passed for a given campaign, a compromised operator key can call `award`
  on it and send **the whole prize (90% of the deposit) to any addresses it chooses**, for *every*
  unsettled campaign that operator was snapshotted on — rotation cannot stop this for campaigns
  that already exist, only for new ones. The same key can also `refund` any of those campaigns at
  any time, but a refund only ever pays the campaign's own `sponsor`, never the operator or anyone
  else, so `refund` cannot be used to steal funds (see `check_ownerCannotTakeFunds` and
  `check_ownerRotationCannotRedirectExisting` in `test/halmos/Halmos.t.sol`). Mitigations: sponsors
  should award their campaign within the 7-day grace window whenever possible, so there's no
  window left for the operator fallback to matter; and on the first sign of operator-key
  compromise, the (still-trusted, at that moment) operator should pre-emptively `refund` every
  at-risk unsettled campaign back to its sponsor before the key is used maliciously. The owner
  cannot `refund` directly (only the operator, or the sponsor after `endsAt + 60 days`, can) — its
  only lever is rotating the operator for *future* campaigns and, if it also controls the
  compromised key, racing it to refund first.
- **Token-type risks for future allowlisted tokens.** Only the owner (timelock) can allowlist a
  token via `setCap`, and USDC is the only token allowlisted today, but the mechanism allows more:
  - **Blocklisting** (USDC and similar tokens can block/freeze an address) has four different
    failure modes depending on which address gets blocked:
    - **A winner is blocked**: `award` reverts for the whole batch (the transfer to that winner
      fails); the sponsor can simply pick again with a different winner list. No funds at risk.
    - **The sponsor is blocked**: only `refund` fails (it pays the sponsor). `award` is unaffected
      — the sponsor can still call it after `endsAt`, or the operator after the grace period, and
      winners still get paid, because USDC only checks the clone and the recipients, not the
      sponsor.
    - **The treasury is blocked**: because `treasury` is snapshotted per campaign, this is
      permanent for every campaign that snapshotted it — `award`'s `safeTransfer(treasury, fee)`
      (`EarnKitCampaign.sol`) can never be rerouted to a different treasury for an existing
      campaign. `award` reverts forever for those campaigns; the only remaining exit is `refund`
      (by the operator at any time, or by the sponsor after `endsAt + 60 days`).
    - **The clone itself is blocked**: both `award` and `refund` fail (every transfer out of the
      clone reverts), since the token checks the sender too. There is no workaround at the
      contract level for this case.
  - **Pausable tokens**: a token-level pause can delay `award`/`refund` until it's lifted; it can't
    redirect funds.
  - **Rebasing and fee-on-transfer tokens must never be allowlisted.** `createCampaign` already
    rejects fee-on-transfer tokens at creation time (it checks the clone's balance delta against
    the declared `amount`; see `test_create_reverts_feeOnTransferToken`), but a rebasing token
    would silently desync the clone's real balance from `prize + fee` after creation — do not add
    one to the cap list.

## Deploy

See `script/Deploy.s.sol`. The owner runs it from their own wallet.
