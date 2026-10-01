// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EarnKitCampaigns} from "../../src/EarnKitCampaigns.sol";
import {EarnKitCampaign} from "../../src/EarnKitCampaign.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// Random sponsors/operators/strangers/owner/pauser creating, awarding, refunding, warping, and
/// reconfiguring. Every successful award/refund is checked against the contract's own caller/time
/// rule via a ghost counter (`unauthorizedSuccesses`, asserted ==0 by an Invariants.t.sol
/// invariant) rather than a reverting assertion here — a `vm.assertTrue`/`assertTrue` failure
/// would revert this whole call and, under `fail_on_revert = false`, be silently discarded by the
/// fuzzer, unwinding the very evidence (ghost counters, and the mutation's real on-chain effect)
/// an invariant needs to see. Per-party ghost accounting below also catches a wrong-recipient
/// mutation directly, independent of the caller/time check.
contract Handler is Test {
    EarnKitCampaigns public factory;
    MockERC20 public usdc;
    address public owner;
    address public operator;
    address public treasury;
    address public pauser;
    address public stranger = makeAddr("stranger");
    address public winnerA = makeAddr("winnerA");
    address public winnerB = makeAddr("winnerB");
    address[] public actors;
    EarnKitCampaign[] public campaigns;

    uint256 public constant STARTING_BALANCE = 1_000_000e6;

    // Ghost accounting: what each party should have received, broken down per party so a wrong
    // recipient (not just a wrong total) is caught.
    uint256 public ghostDeposited;
    uint256 public ghostToWinners;
    uint256 public ghostToTreasury;
    uint256 public ghostRefunded;
    mapping(address actor => uint256 amount) public ghostDepositedBy;
    mapping(address actor => uint256 amount) public ghostRefundedTo;
    mapping(address campaign => uint256 amount) public ghostAmountOf;

    /// Incremented whenever `award`/`refund` succeeds for a caller/time that the contract's own
    /// rules should have rejected. Deliberately not asserted here (see contract-level comment);
    /// `invariant_noUnauthorizedSuccess` in Invariants.t.sol asserts this stays zero.
    uint256 public unauthorizedSuccesses;

    constructor(
        EarnKitCampaigns f,
        MockERC20 t,
        address owner_,
        address operator_,
        address treasury_,
        address pauser_
    ) {
        (factory, usdc, owner, operator, treasury, pauser) = (f, t, owner_, operator_, treasury_, pauser_);
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string(abi.encodePacked("actor", i)));
            actors.push(a);
            usdc.mint(a, STARTING_BALANCE);
            vm.prank(a);
            usdc.approve(address(factory), type(uint256).max);
        }
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function actorsCount() external view returns (uint256) {
        return actors.length;
    }

    /// Picks from sponsor / operator / owner / stranger / pauser / a random actor, so both the
    /// allowed callers and several disallowed ones are exercised for every action.
    function _pickCaller(EarnKitCampaign c, uint256 seed) internal view returns (address) {
        uint256 m = seed % 6;
        if (m == 0) return c.sponsor();
        if (m == 1) return operator;
        if (m == 2) return owner;
        if (m == 3) return stranger;
        if (m == 4) return pauser;
        return actors[seed % actors.length];
    }

    function create(uint256 actorSeed, uint256 amount, uint256 duration) external {
        address a = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 10_000e6);
        duration = bound(duration, 1, 180 days);
        vm.prank(a);
        try factory.createCampaign(
            keccak256(abi.encode(campaigns.length)), IERC20(address(usdc)), amount, uint64(block.timestamp + duration)
        ) returns (address c) {
            campaigns.push(EarnKitCampaign(c));
            ghostDeposited += amount;
            ghostDepositedBy[a] += amount;
            ghostAmountOf[c] = amount;
        } catch {}
    }

    function award(uint256 idx, uint256 callerSeed, uint256 split) external {
        if (campaigns.length == 0) return;
        EarnKitCampaign c = campaigns[idx % campaigns.length];
        address caller = _pickCaller(c, callerSeed);
        uint256 prize = c.prize();
        uint256 fee = c.fee();

        // `prize` is always >= 1 for any successfully created campaign (fee = amount/10, prize =
        // amount - fee, amount >= 1), but a 2-winner split needs prize >= 2 to give both a
        // nonzero amount. Use a single winner below that so amount-in-[1,9] campaigns (fee == 0)
        // can still be awarded, instead of being a dead path that always reverts BadWinners.
        address[] memory w;
        uint256[] memory amt;
        if (prize < 2) {
            w = new address[](1);
            amt = new uint256[](1);
            w[0] = winnerA;
            amt[0] = prize;
        } else {
            w = new address[](2);
            amt = new uint256[](2);
            w[0] = winnerA;
            w[1] = winnerB;
            uint256 first = bound(split, 1, prize - 1);
            amt[0] = first;
            amt[1] = prize - first;
        }

        bool allowed = (caller == c.sponsor() && block.timestamp >= c.endsAt())
            || (caller == operator && block.timestamp >= uint256(c.endsAt()) + c.AWARD_GRACE());

        vm.prank(caller);
        try c.award(w, amt) {
            // Deliberately NOT a reverting assertion here: `vm.assertTrue`/`assertTrue` on a
            // false condition reverts the current call, which would unwind this whole frame —
            // including the real `award()` effects just executed and this very counter
            // increment — before `invariant_noUnauthorizedSuccess` ever gets a chance to see it.
            // Under `fail_on_revert = false`, that revert would then be silently discarded by
            // the fuzzer, hiding the violation entirely. Record it in a ghost counter instead and
            // let a separate `view` invariant function assert on it after the call has committed.
            if (!allowed) unauthorizedSuccesses++;
            ghostToWinners += prize;
            ghostToTreasury += fee;
        } catch {}
    }

    function refund(uint256 idx, uint256 callerSeed) external {
        if (campaigns.length == 0) return;
        EarnKitCampaign c = campaigns[idx % campaigns.length];
        address caller = _pickCaller(c, callerSeed);
        address sponsorAddr = c.sponsor();
        uint256 amount = c.prize() + c.fee();

        bool allowed = (caller == operator)
            || (caller == sponsorAddr && block.timestamp >= uint256(c.endsAt()) + c.RECLAIM_AFTER());

        vm.prank(caller);
        try c.refund() {
            // See the comment in `award` above: no reverting assertion here, by design.
            if (!allowed) unauthorizedSuccesses++;
            ghostRefunded += amount;
            ghostRefundedTo[sponsorAddr] += amount;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 30 days));
    }

    function ownerReconfigures(uint256 cap) external {
        vm.startPrank(owner);
        factory.setCap(address(usdc), bound(cap, 1, 10_000e6));
        factory.setTreasury(treasury); // same treasury: invariants track one address
        vm.stopPrank();
    }

    function pauseToggle(bool on) external {
        vm.prank(owner);
        if (on) try factory.pause() {} catch {}
        else try factory.unpause() {} catch {}
    }
}
