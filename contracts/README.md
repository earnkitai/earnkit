# EarnKit campaign escrow

`EarnKitCampaigns` (factory, owned by a 48 h TimelockController) creates one `EarnKitCampaign`
clone per sponsor campaign (`endsAt` between 1 and 180 days out). Each clone holds only its own
pool. Money leaves a clone once, only:

- `award(winners, amounts)`: the whole prize (90%) to winners + fee (10%) to the treasury.
  **Sponsor only**, after `endsAt`. The operator cannot call it.
- **Operator fallback** (two steps with a veto), for when the sponsor never awards:
  - `proposeFallback(winners, amounts)`: operator only, after `endsAt + 7 days`, same validation
    as `award`. Stores `fallbackHash = keccak256(abi.encode(winners, amounts))` and
    `fallbackAt = now`, emits `FallbackProposed`. Re-proposing replaces it and restarts the timer.
  - `executeFallback(winners, amounts)`: anyone, once `now >= fallbackAt + 72 hours`, only with
    the exact proposed payload. Pays exactly like `award` and emits the same `Awarded` event.
  - `vetoFallback()`: the campaign's **guardian** cancels the pending proposal (`FallbackVetoed`)
    and **closes the fallback for good on that campaign** (`fallbackVetoed = true`; any later
    `proposeFallback` reverts `FallbackClosed`). After a veto the exits are the sponsor's `award`
    and `refund` (operator any time, sponsor after `endsAt + 60 days`).
  - The sponsor can still `award` while a proposal is pending; that settles the campaign and
    makes the proposal moot. A `refund` also clears it.
- `refund()`: everything back to the sponsor. Operator any time; sponsor after `endsAt + 60 days`.

**Excluded winners**: every award path (`award` and `proposeFallback`, re-checked at
`executeFallback`) rejects the sponsor, operator, treasury, guardian, the clone itself, the
factory, the implementation and the token contract (`ExcludedWinner`). Tokens sent to any of those would either be
self-dealing by a privileged party or locked forever (audit F-03). The fee transfer is skipped
when the fee rounds to 0 (amounts under 10 base units, audit I-01).

**The guardian must be a different custodian from the operator** (ideally a multisig): the factory
refuses `pauser == operator` in its constructor, `setOperator` and `setPauser`
(`GuardianIsOperator`), and `Deploy.s.sol` refuses `PAUSER == OPERATOR`.

So stealing a campaign's prize now needs the operator key, **plus** 72 h of public on-chain notice
(`FallbackProposed`), **plus** a separate guardian key that doesn't veto that one proposal, **plus**
a sponsor who doesn't award first. One veto ends the attempt on that campaign.

The owner (timelock) can only change caps, operator, treasury, pauser, and pause/unpause new
campaign creation. It can't touch deposited funds. The pauser can also pause (not unpause) new
campaign creation; neither the owner nor the pauser can block or affect an existing campaign's
`award`/`refund`. The only power over existing campaigns is the snapshotted guardian (the pauser
at creation time) vetoing a pending operator fallback.

Each clone **snapshots `operator`, `treasury` and `guardian` (the factory's `pauser`) at
creation** (`initialize(sponsor, token, amount, endsAt, operator, treasury, guardian)`, public
`operator()`/`treasury()`/`guardian()` views on the clone). Later factory-level
`setOperator`/`setTreasury`/`setPauser` calls only affect campaigns created afterwards — see
"Known limitations" below.

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
  (sponsors, the operator, the owner, a stranger, and the pauser creating, awarding, proposing/
  executing/vetoing fallbacks with random callers and payloads — sometimes naming an excluded
  address as a winner — refunding, warping, reconfiguring, and pausing) plus invariants that check actual token balances against
  per-party ghost accounting — fund conservation, the treasury only ever receiving fees, the
  factory never holding funds, per-campaign fee math against the real deposited amount, winners'
  combined balance equals what they were ever paid, each sponsor's balance equals what it
  deposited minus what it got refunded, and (critically) that no `award`/`refund` ever succeeded
  for a disallowed caller or time (`unauthorizedSuccesses == 0`, now covering award/propose/
  veto/refund). v2.2 adds: no excluded address ever receives funds (`invariant_excludedNeverPaid`),
  and a fallback only ever executes the exact proposed payload at or after proposal + 72 h, with
  the contract's pending proposal always matching the handler's own record
  (`invariant_fallbackOnlyAfterDelay`). Fix round 1 adds: no proposal ever exists after a veto
  and the contract's veto flag matches the handler (`invariant_noProposalAfterVeto`), and the
  owner randomly rotating operator/pauser among four keys never leaves `pauser == operator` at the
  factory or in any campaign snapshot (`invariant_guardianNeverOperator`). Each of these was mutation-checked: removing the delay
  check, the payload check, the guardian check, the operator check, the grace check, any single
  excluded address, the refund/veto clearing, the sticky-veto check, or either
  `GuardianIsOperator` check makes an invariant fail. `forge test --match-contract
InvariantsTest -vv` → all pass at `runs: 256, calls: 16384`.
- `test/halmos/Halmos.t.sol`: 11 symbolic proofs over fully symbolic amounts/durations/callers/
  timestamps — fee split, exact award payouts + sponsor-only/time gating, the operator never
  awarding directly, a fallback executing only the exact proposed payload at or after +72 h (and
  then paying exactly; the candidate payload has a symbolic second winner, either order, and a
  symbolic split), a re-proposal replacing the old payload and restarting the timer, only the
  guardian vetoing and a vetoed campaign never executing or accepting a new proposal, two fully
  symbolic winners being accepted only if neither is an excluded address, no owner rotation
  ever making `pauser == operator`, exact refund
  payouts + caller/time gating, the owner never extracting funds through a campaign, and owner
  rotation of operator/treasury never redirecting an _existing_ campaign's payouts (including that a
  legitimate sponsor award after rotation cannot be silently swallowed by a `catch {}`). Run with
  `./test/halmos/check-flat.sh && halmos --contract HalmosTest --solver-timeout-assertion 0`.
  **Imports from `./EarnKitCampaignsFlat.sol`, not from `../../src/...` directly** — see
  "Analyzer notes" below for why, and `check-flat.sh` for the staleness guard.
- `test/Deploy.t.sol`: runs `script/Deploy.s.sol` and checks the 48 h timelock floor (audit F-05):
  `TIMELOCK_DELAY < 48 hours` is refused unless `ALLOW_SHORT_TIMELOCK=1` (testnet only), which
  logs a loud warning. On Base mainnet (chain 8453) a short delay is refused regardless of the
  flag and `USDC` must be the canonical address. `PAUSER == OPERATOR` is refused. After deploying,
  the script asserts the timelock's delay and that it owns the factory.
- `test/fork/BaseUsdc.t.sol`: the full create → warp → award flow, and a fallback cycle (USDC
  rejected as a winner; propose → veto → re-propose refused → refund on one campaign; propose →
  execute at exactly 72 h on another), against the real Base USDC
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

**Slither** (`slither src --filter-paths "lib|test" --exclude-dependencies`) — no High or Medium
findings (the old `uninitialized-local` false positive is gone: `total` is now explicitly `= 0`).
13 Low/Informational results, all accepted:

- `events-maths` (Low) — `initialize` doesn't emit an event for `fee`/`prize`/`endsAt`; these are
  all implied by the `CampaignCreated` event the factory emits in the same transaction.
- `missing-zero-check` (Low) on `sponsor_`/`operator_`/`treasury_`/`guardian_` in `initialize` —
  only the factory can call it, right after `Clones.clone`; the factory's setters reject the zero
  address for operator/treasury/pauser, and `sponsor_` is `msg.sender` of `createCampaign`.
- `timestamp` (Low) — the award, fallback, refund and duration windows are intended time rules at
  day/hour granularity; a sequencer can shift Base timestamps by seconds at most.
- `unindexed-event-address` (Informational) on `OperatorSet`/`TreasurySet`/`PauserSet` — rare,
  timelocked config events.

**Aderyn** (`npx -y @cyfrin/aderyn .`, run 2026-10-02 on this code; `aderyn.toml` now carries the
`version = 1` field current Aderyn requires) — 0 High, 6 Low, all accepted: centralization (the
timelocked owner is by design), literal `10` for the fee split, `nonReentrant` not the first
modifier on `createCampaign` (`whenNotPaused` has no external calls), revert inside the winner
loop (intentional: one bad winner must fail the whole award), address state set without zero
checks in `initialize` (see Slither above), and accumulator/loop locals relying on zero init.

## Known limitations

- **Operator key compromise (audit F-02) — bounded by the fallback delay and a sticky veto.**
  Each clone snapshots `operator`, `treasury` and `guardian` at creation, and rotation at the
  factory only affects new campaigns. The operator can no longer `award`. A compromised operator
  key can only `proposeFallback` (after `endsAt + 7 days`), which is public for 72 h before anyone
  can execute it. During that window the guardian can `vetoFallback`, which closes the fallback on
  that campaign for good, so the attacker gets **one** attempt per campaign, not one per 72 h.
  The sponsor can also `award`, and the (honest) operator or the sponsor (after
  `endsAt + 60 days`) can `refund`. A refund only ever pays the campaign's sponsor, so the
  operator's `refund` power can't be used to steal. Guardian runbook: alert on every
  `FallbackProposed` and veto any proposal not made by the team. The guardian's safe window is
  `[fallbackAt, fallbackAt + 72 h)`; at exactly `fallbackAt + 72 h` an execute and a veto are
  both valid and block order decides, so treat the deadline as about one block earlier (review
  I-1).
- **Cost of the sticky veto.** A veto also blocks a _legitimate_ fallback on that campaign. After
  a veto, if the sponsor never awards, the only exit is a refund to the sponsor; the entrants of
  that campaign are not paid by the fallback. The guardian should therefore veto only proposals
  it doesn't recognise.
- **The guardian is the factory's `pauser`, snapshotted per clone, and never the operator.** A
  compromised guardian alone can only veto fallbacks (closing that path; payouts then need the
  sponsor's award or a refund), not move funds. A _rotated-away_ guardian keeps veto power over
  the campaigns created before rotation. The factory refuses `pauser == operator`, but it can't
  tell two addresses held by one person apart: keep the keys with different custodians.
- **Other EarnKit clones as winners (review L-01).** The token contract is excluded, but another
  campaign's clone is not, because detecting it would need a registry lookup (a new external
  call). A share sent to another clone is stuck there as surplus forever. The app must reject any
  known escrow, factory or implementation address as a payout wallet.
- **Owner key compromise defeats the two-key model for future campaigns (re-audit L-01).** The
  owner (timelock) can set both `operator` and `pauser` (the guardian) to attacker addresses;
  every campaign created after that has an attacker operator _and_ guardian, so its fallback can
  pay the attacker. Existing campaigns keep their snapshots and are unaffected. The 48 h timelock
  delay is the notice: watch `OperatorSet`, `PauserSet` and `TreasurySet`, and keep the timelock
  proposer and the guardian with different custodians.
- **Stray tokens are unrecoverable (re-audit I-02).** Clone addresses come from `CREATE` and are
  predictable. Tokens sent directly to a clone or to the factory (surplus of the campaign token,
  or any other token) can never be withdrawn: there is no sweep. Escrowed funds are unaffected
  (`createCampaign` measures the balance delta).
- **Propose a fallback by `endsAt + 57 days` (re-audit I-03).** From `endsAt + 60 days` the
  sponsor's `refund` is allowed even while a fallback is pending or executable, and clears it. A
  proposal must be executable (72 h later) before then.
- **`executeFallback` emits the same `Awarded` event as a sponsor award (review I-3).** This is by
  design (one payout path for off-chain consumers). To tell them apart, record `FallbackProposed`
  and `FallbackVetoed`, or check the tx selector.
- **Accepted audit findings (2026-10-02 review):**
  - **F-04 (blocklistable token).** A USDC-blocklisted treasury makes `award`/`executeFallback`
    revert for every campaign that snapshotted it (only `refund` remains); a blocked clone, or a
    blocked treasury _and_ sponsor, locks funds. Accepted: a pull-based fee would add a second
    exit path and state for a case that requires Circle to blocklist EarnKit's own treasury. Ops
    note: keep the treasury a clean, dedicated address. Details per party below.
  - **F-06 (pauser can re-pause after every unpause).** Accepted: pausing only blocks _new_
    campaigns, never awards, fallbacks or refunds. Ops note: rotate the pauser and unpause in one
    timelock batch (`setPauser(new)` + `unpause()`).
  - **I-03 (operator refund during the sponsor's award window).** Accepted: the operator's
    any-time refund is the takedown path, and a refund only pays the sponsor (griefing, not
    theft). With award power removed, the operator can no longer front-run the sponsor's award.
  - **I-05 (USDC is upgradeable/pausable by Circle).** Accepted as an external trust assumption:
    `nonReentrant` + state-before-transfer contain a hook-adding upgrade; a USDC pause delays every
    exit but can't redirect funds; a malicious upgrade is out of scope.
- **Sponsor self-award.** The sponsor can no longer name itself as a winner, but can still pay
  sybil wallets it controls (audit I-04; review I-2). Treat the exclusion as a typo guard, not a
  sybil control; the app flags off-plan winners. It also blocks a sponsor from paying its own
  wallet even when that would be legitimate.
- **Token-type risks for future allowlisted tokens.** Only the owner (timelock) can allowlist a
  token via `setCap`, and USDC is the only token allowlisted today, but the mechanism allows more:
  - **Blocklisting** (USDC and similar tokens can block/freeze an address) has five different
    failure modes depending on which address gets blocked:
    - **A winner is blocked**: `award` reverts for the whole batch (the transfer to that winner
      fails); the sponsor can simply pick again with a different winner list. No funds at risk.
    - **The sponsor is blocked**: only `refund` fails (it pays the sponsor). `award` is unaffected
      — the sponsor can still call it after `endsAt`, or the operator fallback can run, and
      winners still get paid, because USDC only checks the clone and the recipients, not the
      sponsor.
    - **The treasury is blocked**: because `treasury` is snapshotted per campaign, this is
      permanent for every campaign that snapshotted it — `award`'s `safeTransfer(treasury, fee)`
      (`EarnKitCampaign.sol`) can never be rerouted to a different treasury for an existing
      campaign. `award` and `executeFallback` revert forever for those campaigns; the only
      remaining exit is `refund` (by the operator at any time, or by the sponsor after
      `endsAt + 60 days`).
    - **The clone itself is blocked**: both `award` and `refund` fail (every transfer out of the
      clone reverts), since the token checks the sender too. There is no workaround at the
      contract level for this case.
    - **The factory is blocked (re-audit I-05)**: USDC's `transferFrom` also checks the spender,
      so every `createCampaign` reverts. Existing clones are unaffected (the factory never moves
      their funds); new campaigns need a new factory.
  - **Pausable tokens**: a token-level pause can delay `award`/`refund` until it's lifted; it can't
    redirect funds.
  - **Rebasing and fee-on-transfer tokens must never be allowlisted.** `createCampaign` already
    rejects fee-on-transfer tokens at creation time (it checks the clone's balance delta against
    the declared `amount`; see `test_create_reverts_feeOnTransferToken`), but a rebasing token
    would silently desync the clone's real balance from `prize + fee` after creation — do not add
    one to the cap list.

## Deploy

See `script/Deploy.s.sol`. The owner runs it from their own wallet. It refuses
`TIMELOCK_DELAY < 48 hours` unless `ALLOW_SHORT_TIMELOCK=1` is set (testnet only; it then logs a
loud warning), and on Base mainnet (8453) it refuses a short delay whatever the flag says and
requires `USDC` to be canonical Base USDC. It refuses `PAUSER == OPERATOR`. On Base mainnet the
script refuses any TREASURY other than the company treasury 0xc8A889577446153e28D42254B75238Ae31EC7D57
(the 10% campaign fee goes there). Never use a short-timelock deployment for real funds.
