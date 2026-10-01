// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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

    function test_award_operatorOnlyAfterGrace() public {
        vm.warp(endsAt + 7 days - 1);
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.award(one(alice), oneAmt(900e6));
        vm.warp(endsAt + 7 days);
        vm.prank(operator);
        c.award(one(alice), oneAmt(900e6));
        assertEq(usdc.balanceOf(alice), 900e6);
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
        for (uint256 i; i < 51; ++i) (many[i], each[i]) = (alice, 1);
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

    function test_operatorRotation_appliesToExistingCampaigns() public {
        vm.prank(owner);
        factory.setOperator(bob);
        vm.prank(operator);
        vm.expectRevert(EarnKitCampaign.NotAllowed.selector);
        c.refund();
        vm.prank(bob);
        c.refund();
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
}
