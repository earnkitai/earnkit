// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
// WORKAROUND (see README.md "Analyzer notes" for the full writeup): importing EarnKitCampaigns and
// EarnKitCampaign from their real paths under src/ (two separate files, one name a prefix of the
// other) makes Halmos 0.3.3 fail every check with "HalmosException: No successful path found in
// setUp()" / "Unsupported cheat code: deployCode(...)" while constructing either contract — a
// Halmos build-resolution bug, not a contract bug (confirmed by bisection: byte-identical copies
// of the same two contracts, flattened into one file, execute under Halmos with no changes to any
// contract logic). EarnKitCampaignsFlat.sol is a mechanical `forge flatten` of src/EarnKitCampaigns.sol
// (which pulls in src/EarnKitCampaign.sol).
//
// STALENESS GUARD: this flattened copy can drift from src/ if src/ changes and nobody
// regenerates it. `test/halmos/check-flat.sh` re-flattens src/ into a temp file and diffs it
// against this file, failing loudly if they differ. There is NO automatic diff run by this test
// file itself — always run the guard script immediately before Halmos:
//   ./test/halmos/check-flat.sh && halmos --contract HalmosTest --solver-timeout-assertion 0
// To regenerate after a legitimate src/ change:
//   forge flatten src/EarnKitCampaigns.sol -o test/halmos/EarnKitCampaignsFlat.sol
// IERC20 is imported from the same flattened file (not from @openzeppelin/... directly) so it's
// the same type the flattened contracts use.
import {EarnKitCampaigns, EarnKitCampaign, IERC20} from "./EarnKitCampaignsFlat.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// Run `./test/halmos/check-flat.sh` first, then `halmos --contract HalmosTest`. Parameters are
/// symbolic: proofs hold for ALL values.
contract HalmosTest is Test {
    EarnKitCampaigns factory;
    MockERC20 usdc;
    address constant OWNER = address(0x1000);
    address constant OPERATOR = address(0x2000);
    address constant TREASURY = address(0x3000);
    address constant PAUSER = address(0x4000);
    address constant SPONSOR = address(0x5000);

    function setUp() public {
        usdc = new MockERC20();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256[] memory caps = new uint256[](1);
        caps[0] = type(uint128).max;
        factory = new EarnKitCampaigns(OWNER, OPERATOR, TREASURY, PAUSER, tokens, caps);
    }

    function _create(uint256 amount, uint64 endsAt) internal returns (EarnKitCampaign c) {
        usdc.mint(SPONSOR, amount);
        vm.startPrank(SPONSOR);
        usdc.approve(address(factory), amount);
        c = EarnKitCampaign(factory.createCampaign(bytes32(0), IERC20(address(usdc)), amount, endsAt));
        vm.stopPrank();
    }

    /// prize + fee == amount and fee == amount / 10, for every amount.
    function check_feeSplit(uint128 amount, uint32 duration) public {
        vm.assume(amount > 0 && duration >= 1 days && duration <= 180 days);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + duration));
        assert(c.prize() + c.fee() == amount);
        assert(c.fee() == uint256(amount) / 10);
    }

    /// A successful award moves exactly prize to the two winners and fee to the treasury, and only
    /// the sponsor (after endsAt) can make it succeed.
    function check_awardPaysExactly(uint128 amount, uint128 first, address caller, uint64 when) public {
        vm.assume(amount >= 2);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));
        uint256 prize = c.prize();
        vm.assume(first > 0 && first < prize);
        address[] memory w = new address[](2);
        (w[0], w[1]) = (address(0xA), address(0xB));
        uint256[] memory a = new uint256[](2);
        (a[0], a[1]) = (first, prize - first);
        vm.warp(when);
        vm.prank(caller);
        try c.award(w, a) {
            assert(usdc.balanceOf(address(0xA)) == first);
            assert(usdc.balanceOf(address(0xB)) == prize - first);
            assert(usdc.balanceOf(TREASURY) == c.fee());
            assert(usdc.balanceOf(address(c)) == 0);
            // Only the sponsor, after the end. The operator has no award power at all.
            assert(caller == SPONSOR && when >= c.endsAt());
        } catch {
            assert(usdc.balanceOf(address(c)) == amount);
        }
    }

    /// A successful refund returns everything to the sponsor, only by allowed callers and times.
    function check_refundRules(uint128 amount, address caller, uint64 when) public {
        vm.assume(amount > 0);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));
        vm.warp(when);
        vm.prank(caller);
        try c.refund() {
            assert(usdc.balanceOf(SPONSOR) == amount);
            assert(usdc.balanceOf(TREASURY) == 0);
            assert(caller == OPERATOR || (caller == SPONSOR && uint256(when) >= uint256(c.endsAt()) + 60 days));
        } catch {
            assert(usdc.balanceOf(address(c)) == amount);
        }
    }

    /// The factory owner can never take a campaign's funds through the campaign.
    function check_ownerCannotTakeFunds(uint128 amount, uint64 when, bool tryAward) public {
        vm.assume(amount >= 10);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));
        vm.warp(when);
        vm.startPrank(OWNER);
        if (tryAward) {
            address[] memory w = new address[](1);
            w[0] = OWNER;
            uint256[] memory a = new uint256[](1);
            a[0] = c.prize();
            try c.award(w, a) {
                assert(false);
            } catch {}
        } else {
            try c.refund() {
                assert(false);
            } catch {}
        }
        vm.stopPrank();
        assert(usdc.balanceOf(OWNER) == 0);
    }

    /// Owner rotation (factory.setOperator/setTreasury to itself) after a campaign is created
    /// cannot redirect that existing campaign: operator/treasury were snapshotted at creation, so
    /// OWNER acting as "operator" on this older campaign is always rejected, and an award by the
    /// sponsor still pays the fee to the ORIGINAL treasury, never to OWNER.
    function check_ownerRotationCannotRedirectExisting(uint128 amount, uint64 when, bool tryAward) public {
        vm.assume(amount >= 10);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));

        // Owner rotates operator and treasury to itself AFTER the campaign already exists.
        vm.startPrank(OWNER);
        factory.setOperator(OWNER);
        factory.setTreasury(OWNER);
        vm.stopPrank();

        // The existing campaign's snapshot must be unaffected by the rotation.
        assert(c.operator() == OPERATOR);
        assert(c.treasury() == TREASURY);

        vm.warp(when);

        // OWNER can never award or refund this older campaign by posing as its operator: the
        // clone still only recognizes the original OPERATOR.
        vm.startPrank(OWNER);
        if (tryAward) {
            address[] memory w = new address[](1);
            w[0] = OWNER;
            uint256[] memory a = new uint256[](1);
            a[0] = c.prize();
            try c.award(w, a) {
                assert(false);
            } catch {}
        } else {
            try c.refund() {
                assert(false);
            } catch {}
        }
        vm.stopPrank();
        assert(usdc.balanceOf(OWNER) == 0);

        // A sponsor-driven award on this same campaign, at any later time, still pays the fee to
        // the ORIGINAL treasury, never to OWNER (even though OWNER is now the factory's treasury).
        if (c.state() == EarnKitCampaign.State.Funded && when >= c.endsAt()) {
            uint256 prize = c.prize();
            uint256 fee = c.fee();
            address[] memory w2 = new address[](1);
            w2[0] = address(0xB1);
            uint256[] memory a2 = new uint256[](1);
            a2[0] = prize;
            vm.prank(SPONSOR);
            try c.award(w2, a2) {
                assert(usdc.balanceOf(TREASURY) == fee);
                assert(usdc.balanceOf(OWNER) == 0);
            } catch {
                // Every precondition for success already holds here (Funded, past endsAt, a
                // valid single winner, caller == sponsor): the owner's rotation must never be
                // able to make an otherwise-legitimate sponsor award fail. A silent `catch {}`
                // here would make this check vacuously pass even if rotation introduced a DoS
                // on sponsor funds (e.g. a future change reading factory.treasury() and
                // reverting), so a failure here is asserted as a hard failure.
                assert(false);
            }
        }
    }

    function _two(uint256 prize, uint128 first) internal pure returns (address[] memory w, uint256[] memory a) {
        w = new address[](2);
        (w[0], w[1]) = (address(0xA), address(0xB));
        a = new uint256[](2);
        (a[0], a[1]) = (first, prize - first);
    }

    /// The operator can never award directly, at any time, to anyone.
    function check_operatorCannotAward(uint128 amount, uint64 when, address winner) public {
        vm.assume(amount > 0);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));
        address[] memory w = new address[](1);
        w[0] = winner;
        uint256[] memory a = new uint256[](1);
        a[0] = c.prize();
        vm.warp(when);
        vm.prank(OPERATOR);
        try c.award(w, a) {
            assert(false);
        } catch {}
        assert(usdc.balanceOf(address(c)) == amount);
    }

    /// After the operator proposes P at time t1, an execute of payload Q at time t2 by anyone
    /// succeeds only if Q == P and t2 >= t1 + 72 h, and then pays exactly P.
    function check_fallbackOnlyExactPayloadAfterDelay(
        uint128 amount,
        uint128 first,
        uint128 first2,
        uint64 t1,
        uint64 t2,
        address caller
    ) public {
        vm.assume(amount >= 2);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));
        uint256 prize = c.prize();
        vm.assume(first > 0 && first < prize && first2 > 0 && first2 < prize);
        (address[] memory w, uint256[] memory a) = _two(prize, first);
        vm.assume(uint256(t1) >= uint256(c.endsAt()) + 7 days);
        vm.warp(t1);
        vm.prank(OPERATOR);
        c.proposeFallback(w, a);
        assert(c.fallbackAt() == t1);

        (address[] memory w2, uint256[] memory a2) = _two(prize, first2);
        vm.warp(t2);
        vm.prank(caller);
        try c.executeFallback(w2, a2) {
            assert(first2 == first);
            assert(uint256(t2) >= uint256(t1) + 72 hours);
            assert(usdc.balanceOf(address(0xA)) == first);
            assert(usdc.balanceOf(address(0xB)) == prize - first);
            assert(usdc.balanceOf(TREASURY) == c.fee());
            assert(usdc.balanceOf(address(c)) == 0);
            assert(c.fallbackHash() == bytes32(0));
        } catch {
            assert(usdc.balanceOf(address(c)) == amount);
        }
    }

    /// Only the guardian can veto; a veto clears the proposal so it can never execute afterwards.
    function check_vetoClears(uint128 amount, uint64 t1, uint64 t2, address vetoer, address caller) public {
        vm.assume(amount >= 1);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));
        address[] memory w = new address[](1);
        w[0] = address(0xA);
        uint256[] memory a = new uint256[](1);
        a[0] = c.prize();
        vm.assume(uint256(t1) >= uint256(c.endsAt()) + 7 days);
        vm.warp(t1);
        vm.prank(OPERATOR);
        c.proposeFallback(w, a);

        vm.prank(vetoer);
        try c.vetoFallback() {
            assert(vetoer == PAUSER);
            assert(c.fallbackHash() == bytes32(0) && c.fallbackAt() == 0);
            vm.warp(t2);
            vm.prank(caller);
            try c.executeFallback(w, a) {
                assert(false);
            } catch {}
            assert(usdc.balanceOf(address(c)) == amount);
        } catch {
            assert(vetoer != PAUSER);
        }
    }

    /// For a fully symbolic winner `x`: a sponsor award or an operator proposal naming `x` only
    /// succeeds if `x` is none of the excluded addresses, so an excluded address is never paid.
    function check_excludedNeverAccepted(uint128 amount, address x, uint64 when, bool viaFallback) public {
        vm.assume(amount >= 1);
        EarnKitCampaign c = _create(amount, uint64(block.timestamp + 1 days));
        address[] memory w = new address[](1);
        w[0] = x;
        uint256[] memory a = new uint256[](1);
        a[0] = c.prize();
        vm.warp(when);
        bool ok;
        if (viaFallback) {
            vm.prank(OPERATOR);
            try c.proposeFallback(w, a) {
                ok = true;
            } catch {}
        } else {
            vm.prank(SPONSOR);
            try c.award(w, a) {
                ok = true;
            } catch {}
        }
        if (ok) {
            assert(x != SPONSOR && x != OPERATOR && x != TREASURY && x != PAUSER);
            assert(x != address(c) && x != address(factory) && x != factory.implementation());
        } else {
            assert(usdc.balanceOf(address(c)) == amount);
        }
    }
}
