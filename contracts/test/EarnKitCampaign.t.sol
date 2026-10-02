// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {EarnKitCampaign} from "../src/EarnKitCampaign.sol";

contract EarnKitCampaignTest is BaseTest {
    EarnKitCampaign c;
    uint64 endsAt;

    function setUp() public override {
        super.setUp();
        endsAt = uint64(block.timestamp + 14 days);
        c = create(1000e6, endsAt); // prize 900e6, fee 100e6
    }

    function amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        (r[0], r[1]) = (a, b);
    }

    function winners(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        (r[0], r[1]) = (a, b);
    }

    function test_award_bySponsorAfterEnd_paysWinnersAndFee() public {
        vm.warp(endsAt);
        vm.expectEmit(false, false, false, true, address(c));
        emit EarnKitCampaign.Awarded(winners(alice, bob), amounts(600e6, 300e6), 100e6);
        vm.prank(sponsor);
        c.award(winners(alice, bob), amounts(600e6, 300e6));
        assertEq(usdc.balanceOf(alice), 600e6);
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.balanceOf(treasury), 100e6);
        assertEq(usdc.balanceOf(address(c)), 0);
        assertEq(uint8(c.state()), 2);
    }

    function test_award_reverts_beforeEnd() public {
        vm.warp(endsAt - 1);
        vm.prank(sponsor);
        vm.expectRevert(EarnKitCampaign.NotEnded.selector);
        c.award(one(alice), oneAmt(900e6));
    }

    function test_award_reverts_forOperator_evenAfterGrace() public {
        vm.warp(endsAt + 30 days);
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.award(one(alice), oneAmt(900e6));
        vm.prank(pauser);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.award(one(alice), oneAmt(900e6));
    }

    function test_award_reverts_forStrangersAndOwner() public {
        vm.warp(endsAt + 30 days);
        vm.prank(alice);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.award(one(alice), oneAmt(900e6));
        vm.prank(owner);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.award(one(owner), oneAmt(900e6));
    }

    function test_award_reverts_wrongTotal() public {
        vm.warp(endsAt);
        vm.startPrank(sponsor);
        vm.expectRevert(EarnKitCampaign.WrongTotal.selector);
        c.award(one(alice), oneAmt(900e6 - 1));
        vm.expectRevert(EarnKitCampaign.WrongTotal.selector);
        c.award(one(alice), oneAmt(900e6 + 1));
        vm.stopPrank();
    }

    function test_award_reverts_badWinnerLists() public {
        vm.warp(endsAt);
        vm.startPrank(sponsor);
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.award(new address[](0), new uint256[](0));
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.award(winners(alice, bob), oneAmt(900e6));
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.award(one(address(0)), oneAmt(900e6));
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.award(winners(alice, bob), amounts(900e6, 0));
        address[] memory many = new address[](51);
        uint256[] memory each = new uint256[](51);
        for (uint256 i; i < 51; ++i) {
            (many[i], each[i]) = (alice, 1);
        }
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.award(many, each);
        vm.stopPrank();
    }

    function test_award_onlyOnce_andNotAfterRefund() public {
        vm.warp(endsAt);
        vm.prank(sponsor);
        c.award(one(alice), oneAmt(900e6));
        vm.prank(sponsor);
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        c.award(one(alice), oneAmt(900e6));
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        c.refund();
    }

    function test_refund_byOperatorAnytime_returnsEverythingToSponsor() public {
        uint256 before = usdc.balanceOf(sponsor);
        vm.expectEmit(true, false, false, true, address(c));
        emit EarnKitCampaign.Refunded(operator, 1000e6);
        vm.prank(operator);
        c.refund();
        assertEq(usdc.balanceOf(sponsor), before + 1000e6);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(uint8(c.state()), 3);
        vm.warp(endsAt);
        vm.prank(sponsor);
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        c.award(one(alice), oneAmt(900e6));
    }

    function test_refund_bySponsorOnlyAfterReclaimWindow() public {
        vm.warp(endsAt + 60 days - 1);
        vm.prank(sponsor);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.refund();
        vm.warp(endsAt + 60 days);
        vm.prank(sponsor);
        c.refund();
        assertEq(usdc.balanceOf(address(c)), 0);
    }

    function test_refund_reverts_forStrangersAndOwner() public {
        vm.warp(endsAt + 365 days);
        vm.prank(alice);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.refund();
        vm.prank(owner);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.refund();
    }

    function test_operatorAndTreasuryRotation_onlyAffectNewCampaigns() public {
        // A second campaign created before the rotation, so we can check refund on an
        // untouched, still-Funded campaign after `c` has been awarded below.
        vm.prank(sponsor);
        address c2Addr = factory.createCampaign(
            keccak256("ref-2"), IERC20(address(usdc)), 1000e6, uint64(block.timestamp + 14 days)
        );
        EarnKitCampaign c2 = EarnKitCampaign(c2Addr);

        vm.startPrank(owner);
        factory.setOperator(bob);
        factory.setTreasury(bob);
        vm.stopPrank();

        // The old operator can still run the fallback on the pre-rotation campaign, and its fee
        // still goes to the old treasury, not bob. bob (new operator) can't propose on it.
        vm.warp(endsAt + 7 days);
        vm.prank(bob);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.proposeFallback(one(alice), oneAmt(900e6));
        vm.prank(operator);
        c.proposeFallback(one(alice), oneAmt(900e6));
        vm.warp(block.timestamp + 72 hours);
        c.executeFallback(one(alice), oneAmt(900e6));
        assertEq(usdc.balanceOf(treasury), 100e6);
        assertEq(usdc.balanceOf(bob), 0);

        // The new operator (bob) cannot touch the pre-rotation campaign; the old operator still can.
        vm.prank(bob);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c2.refund();
        vm.prank(operator);
        c2.refund();

        // A campaign created after the rotation uses bob for both operator and treasury.
        vm.prank(sponsor);
        address c3Addr = factory.createCampaign(
            keccak256("ref-3"), IERC20(address(usdc)), 1000e6, uint64(block.timestamp + 14 days)
        );
        EarnKitCampaign c3 = EarnKitCampaign(c3Addr);
        assertEq(c3.operator(), bob);
        assertEq(c3.treasury(), bob);
    }

    function test_ownerCannotHijackOperatorOrTreasury_onExistingCampaign() public {
        // Regression for the admin-key-compromise scenario: the owner making itself the
        // operator/treasury must not let it touch funds already escrowed in `c`.
        vm.startPrank(owner);
        factory.setOperator(owner);
        factory.setTreasury(owner);
        vm.stopPrank();

        vm.warp(endsAt + 7 days);
        vm.prank(owner);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.award(one(alice), oneAmt(900e6));
        vm.prank(owner);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.proposeFallback(one(alice), oneAmt(900e6));

        vm.prank(owner);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.refund();

        assertEq(usdc.balanceOf(address(c)), 1000e6);
    }

    function test_strayTokensSentToTheClone_doNotChangePayouts() public {
        usdc.mint(address(c), 5e6);
        vm.warp(endsAt);
        vm.prank(sponsor);
        c.award(one(alice), oneAmt(900e6));
        assertEq(usdc.balanceOf(alice), 900e6);
        assertEq(usdc.balanceOf(treasury), 100e6);
        assertEq(usdc.balanceOf(address(c)), 5e6);
    }

    // ---------------------------------------------------------------- operator fallback

    uint256 constant GRACE = 7 days;
    uint256 constant DELAY = 72 hours;

    function _propose(address[] memory w, uint256[] memory a) internal {
        vm.prank(operator);
        c.proposeFallback(w, a);
    }

    function test_propose_storesHashAndTime_andEmits() public {
        vm.warp(endsAt + GRACE);
        vm.expectEmit(false, false, false, true, address(c));
        emit EarnKitCampaign.FallbackProposed(winners(alice, bob), amounts(600e6, 300e6));
        _propose(winners(alice, bob), amounts(600e6, 300e6));
        assertEq(c.fallbackHash(), keccak256(abi.encode(winners(alice, bob), amounts(600e6, 300e6))));
        assertEq(c.fallbackAt(), endsAt + GRACE);
        assertEq(usdc.balanceOf(address(c)), 1000e6); // proposing moves nothing
    }

    function test_propose_reverts_beforeGrace() public {
        vm.warp(endsAt + GRACE - 1);
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.NotEnded.selector);
        c.proposeFallback(one(alice), oneAmt(900e6));
    }

    function test_propose_reverts_forNonOperator() public {
        vm.warp(endsAt + GRACE);
        address[4] memory who = [sponsor, pauser, owner, alice];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
            c.proposeFallback(one(alice), oneAmt(900e6));
        }
    }

    function test_propose_reverts_whenSettled() public {
        vm.prank(operator);
        c.refund();
        vm.warp(endsAt + GRACE);
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        c.proposeFallback(one(alice), oneAmt(900e6));
    }

    function test_propose_validatesLikeAward() public {
        vm.warp(endsAt + GRACE);
        vm.startPrank(operator);
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.proposeFallback(new address[](0), new uint256[](0));
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.proposeFallback(winners(alice, bob), oneAmt(900e6));
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.proposeFallback(one(address(0)), oneAmt(900e6));
        vm.expectRevert(EarnKitCampaign.BadWinners.selector);
        c.proposeFallback(winners(alice, bob), amounts(900e6, 0));
        vm.expectRevert(EarnKitCampaign.WrongTotal.selector);
        c.proposeFallback(one(alice), oneAmt(900e6 - 1));
        vm.stopPrank();
    }

    function test_execute_byAnyoneAfterDelay_paysExactly_andClears() public {
        vm.warp(endsAt + GRACE);
        _propose(winners(alice, bob), amounts(600e6, 300e6));
        vm.warp(block.timestamp + DELAY);
        vm.expectEmit(false, false, false, true, address(c));
        emit EarnKitCampaign.Awarded(winners(alice, bob), amounts(600e6, 300e6), 100e6);
        vm.prank(makeAddr("anyone"));
        c.executeFallback(winners(alice, bob), amounts(600e6, 300e6));
        assertEq(usdc.balanceOf(alice), 600e6);
        assertEq(usdc.balanceOf(bob), 300e6);
        assertEq(usdc.balanceOf(treasury), 100e6);
        assertEq(usdc.balanceOf(address(c)), 0);
        assertEq(uint8(c.state()), 2);
        assertEq(c.fallbackHash(), bytes32(0));
        assertEq(c.fallbackAt(), 0);
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        c.executeFallback(winners(alice, bob), amounts(600e6, 300e6));
    }

    function test_execute_reverts_beforeDelay() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(EarnKitCampaign.FallbackNotReady.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
    }

    function test_execute_reverts_withDifferentPayload() public {
        vm.warp(endsAt + GRACE);
        _propose(winners(alice, bob), amounts(600e6, 300e6));
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(EarnKitCampaign.FallbackMismatch.selector);
        c.executeFallback(winners(alice, bob), amounts(300e6, 600e6));
        vm.expectRevert(EarnKitCampaign.FallbackMismatch.selector);
        c.executeFallback(winners(bob, alice), amounts(600e6, 300e6));
        vm.expectRevert(EarnKitCampaign.FallbackMismatch.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
    }

    function test_execute_reverts_withNoProposal() public {
        vm.warp(endsAt + 365 days);
        vm.expectRevert(EarnKitCampaign.NoFallback.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
    }

    function test_repropose_overwritesAndRestartsTimer() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.warp(block.timestamp + DELAY - 1);
        _propose(one(bob), oneAmt(900e6));
        assertEq(c.fallbackAt(), block.timestamp);
        vm.warp(block.timestamp + 1); // first proposal's delay has passed, second's has not
        vm.expectRevert(EarnKitCampaign.FallbackMismatch.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
        vm.expectRevert(EarnKitCampaign.FallbackNotReady.selector);
        c.executeFallback(one(bob), oneAmt(900e6));
        vm.warp(block.timestamp + DELAY - 1);
        c.executeFallback(one(bob), oneAmt(900e6));
        assertEq(usdc.balanceOf(bob), 900e6);
    }

    function test_veto_byGuardian_clearsProposal() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.expectEmit(false, false, false, true, address(c));
        emit EarnKitCampaign.FallbackVetoed();
        vm.prank(pauser);
        c.vetoFallback();
        assertEq(c.fallbackHash(), bytes32(0));
        assertEq(c.fallbackAt(), 0);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(EarnKitCampaign.NoFallback.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
        // The veto is sticky (review M-02): the operator can never propose again on this campaign.
        assertTrue(c.fallbackVetoed());
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.FallbackClosed.selector);
        c.proposeFallback(one(bob), oneAmt(900e6));
    }

    function test_veto_reverts_forNonGuardian() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        address[4] memory who = [sponsor, operator, owner, alice];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
            c.vetoFallback();
        }
    }

    function test_veto_reverts_withNoProposal() public {
        vm.prank(pauser);
        vm.expectRevert(EarnKitCampaign.NoFallback.selector);
        c.vetoFallback();
    }

    function test_sponsorAward_duringPendingProposal_settlesAndMootsIt() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.prank(sponsor);
        c.award(one(bob), oneAmt(900e6));
        assertEq(usdc.balanceOf(bob), 900e6);
        assertEq(c.fallbackHash(), bytes32(0));
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_refund_duringPendingProposal_clearsIt() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        uint256 before = usdc.balanceOf(sponsor);
        vm.prank(operator);
        c.refund();
        assertEq(usdc.balanceOf(sponsor), before + 1000e6);
        assertEq(c.fallbackHash(), bytes32(0));
        assertEq(c.fallbackAt(), 0);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
    }

    function _excluded() internal view returns (address[8] memory) {
        return
            [sponsor, operator, treasury, pauser, address(c), address(factory), factory.implementation(), address(usdc)];
    }

    function test_excludedWinners_rejectedBySponsorAward() public {
        vm.warp(endsAt);
        address[8] memory ex = _excluded();
        for (uint256 i; i < ex.length; ++i) {
            vm.prank(sponsor);
            vm.expectRevert(EarnKitCampaign.ExcludedWinner.selector);
            c.award(winners(alice, ex[i]), amounts(450e6, 450e6));
        }
    }

    function test_excludedWinners_rejectedByProposeFallback() public {
        vm.warp(endsAt + GRACE);
        address[8] memory ex = _excluded();
        for (uint256 i; i < ex.length; ++i) {
            vm.prank(operator);
            vm.expectRevert(EarnKitCampaign.ExcludedWinner.selector);
            c.proposeFallback(winners(ex[i], alice), amounts(450e6, 450e6));
        }
    }

    function test_feeZero_awardSkipsTreasuryTransfer() public {
        vm.prank(sponsor);
        EarnKitCampaign dust = EarnKitCampaign(
            factory.createCampaign(keccak256("dust"), IERC20(address(usdc)), 9, uint64(block.timestamp + 1 days))
        );
        assertEq(dust.fee(), 0);
        assertEq(dust.prize(), 9);
        vm.warp(block.timestamp + 1 days);
        vm.recordLogs();
        vm.prank(sponsor);
        dust.award(one(alice), oneAmt(9));
        // Only one Transfer (to alice): no zero-value transfer to the treasury.
        assertEq(vm.getRecordedLogs().length, 2); // Transfer + Awarded
        assertEq(usdc.balanceOf(alice), 9);
        assertEq(usdc.balanceOf(treasury), 0);
    }

    // ------------------------------------------- regressions from the T1 review (M-02, L-01, I-1)

    /// M-02: a compromised operator used to be able to re-propose after every veto until one
    /// window was missed. Now one veto closes the fallback; the remaining exits pay only winners
    /// the sponsor picks, or the sponsor.
    function test_R02_vetoIsSticky_noReproposeSpam_refundStillWorks() public {
        address thief = makeAddr("thief");
        vm.warp(endsAt + GRACE);
        _propose(one(thief), oneAmt(900e6));
        vm.prank(pauser);
        c.vetoFallback();
        for (uint256 i; i < 17; ++i) {
            vm.warp(block.timestamp + DELAY);
            vm.prank(operator);
            vm.expectRevert(EarnKitCampaign.FallbackClosed.selector);
            c.proposeFallback(one(thief), oneAmt(900e6));
            vm.expectRevert(EarnKitCampaign.NoFallback.selector);
            c.executeFallback(one(thief), oneAmt(900e6));
        }
        // Rotating the factory pauser changes nothing for this campaign: still closed.
        vm.prank(owner);
        factory.setPauser(makeAddr("newPauser"));
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.FallbackClosed.selector);
        c.proposeFallback(one(thief), oneAmt(900e6));
        assertEq(usdc.balanceOf(thief), 0);
        // Exits that remain: the sponsor's award, the operator's refund, the sponsor's late refund.
        vm.warp(endsAt + 60 days);
        uint256 before = usdc.balanceOf(sponsor);
        vm.prank(sponsor);
        c.refund();
        assertEq(usdc.balanceOf(sponsor), before + 1000e6);
    }

    function test_R02_sponsorCanStillAwardAfterVeto() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.prank(pauser);
        c.vetoFallback();
        vm.prank(sponsor);
        c.award(one(bob), oneAmt(900e6));
        assertEq(usdc.balanceOf(bob), 900e6);
    }

    /// I-1: at exactly fallbackAt + 72 h, execute and veto are both valid; the guardian's safe
    /// window is [fallbackAt, fallbackAt + 72 h). Documented, not changed.
    function test_R02c_boundary_executeValidAtExactlyDelay_vetoAfterIsMoot() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.warp(block.timestamp + DELAY);
        c.executeFallback(one(alice), oneAmt(900e6));
        vm.prank(pauser);
        vm.expectRevert(EarnKitCampaign.NoFallback.selector);
        c.vetoFallback();
    }

    /// L-01: the token contract is now an excluded winner (shares sent there are locked forever).
    /// Another EarnKit clone is still accepted on-chain (needs a registry call to detect); the app
    /// must reject known escrow addresses as payout wallets. This test pins both behaviours.
    function test_R03_tokenExcluded_otherCloneStillAccepted() public {
        vm.warp(endsAt);
        vm.prank(sponsor);
        vm.expectRevert(EarnKitCampaign.ExcludedWinner.selector);
        c.award(winners(alice, address(usdc)), amounts(450e6, 450e6));

        vm.prank(sponsor);
        address other =
            factory.createCampaign(keccak256("other"), IERC20(address(usdc)), 1000e6, uint64(block.timestamp + 1 days));
        vm.prank(sponsor);
        c.award(winners(alice, other), amounts(450e6, 450e6));
        assertEq(usdc.balanceOf(other), 1450e6); // known limitation: 450e6 surplus stuck in `other`
    }

    function test_HELD_reproposeAfterDelayPassed_restartsTimer_noLastSecondSwap() public {
        address thief = makeAddr("thief");
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.warp(block.timestamp + 100 hours);
        _propose(one(thief), oneAmt(900e6));
        vm.expectRevert(EarnKitCampaign.FallbackMismatch.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
        vm.expectRevert(EarnKitCampaign.FallbackNotReady.selector);
        c.executeFallback(one(thief), oneAmt(900e6));
        assertEq(c.fallbackAt(), block.timestamp);
    }

    function test_HELD_duplicateWinnersHashDistinct_andPayExactly() public {
        vm.warp(endsAt + GRACE);
        _propose(winners(alice, alice), amounts(450e6, 450e6));
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(EarnKitCampaign.FallbackMismatch.selector);
        c.executeFallback(one(alice), oneAmt(900e6));
        c.executeFallback(winners(alice, alice), amounts(450e6, 450e6));
        assertEq(usdc.balanceOf(alice), 900e6);
    }

    /// Non-canonical calldata (offsets swapped, trailing junk) re-encodes to the proposed payload.
    function test_HELD_nonCanonicalCalldataSameHash() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.warp(block.timestamp + DELAY);
        bytes memory data = abi.encodePacked(
            EarnKitCampaign.executeFallback.selector,
            uint256(0x80),
            uint256(0x40),
            uint256(1),
            uint256(900e6),
            uint256(1),
            uint256(uint160(alice)),
            uint256(0xdead)
        );
        (bool ok,) = address(c).call(data);
        assertTrue(ok);
        assertEq(usdc.balanceOf(alice), 900e6);
    }

    function test_HELD_dirtyAddressBitsRejected() public {
        vm.warp(endsAt + GRACE);
        _propose(one(alice), oneAmt(900e6));
        vm.warp(block.timestamp + DELAY);
        bytes memory data = abi.encodePacked(
            EarnKitCampaign.executeFallback.selector,
            uint256(0x40),
            uint256(0x80),
            uint256(1),
            uint256(uint160(alice)) | (uint256(1) << 200),
            uint256(1),
            uint256(900e6)
        );
        (bool ok,) = address(c).call(data);
        assertFalse(ok);
        assertEq(usdc.balanceOf(address(c)), 1000e6);
    }

    function test_HELD_implementationCannotBeUsed() public {
        EarnKitCampaign impl = EarnKitCampaign(factory.implementation());
        vm.expectRevert(EarnKitCampaign.NotFunded.selector);
        impl.executeFallback(one(alice), oneAmt(1));
    }
}
