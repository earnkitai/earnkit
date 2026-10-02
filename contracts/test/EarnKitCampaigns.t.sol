// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {BaseTest} from "./Base.t.sol";
import {EarnKitCampaigns} from "../src/EarnKitCampaigns.sol";
import {EarnKitCampaign} from "../src/EarnKitCampaign.sol";
import {FeeOnTransferERC20} from "./mocks/MockERC20.sol";

contract EarnKitCampaignsTest is BaseTest {
    function test_create_movesFundsIntoTheCloneAndRecordsIt() public {
        uint64 endsAt = uint64(block.timestamp + 14 days);
        vm.expectEmit(true, true, false, false);
        emit EarnKitCampaigns.CampaignCreated(REF, sponsor, address(0), address(usdc), 1000e6, endsAt);
        EarnKitCampaign c = create(1000e6, endsAt);

        assertEq(usdc.balanceOf(address(c)), 1000e6);
        assertEq(usdc.balanceOf(address(factory)), 0);
        assertEq(factory.campaignOf(sponsor, REF), address(c));
        assertEq(c.sponsor(), sponsor);
        assertEq(address(c.token()), address(usdc));
        assertEq(c.fee(), 100e6);
        assertEq(c.prize(), 900e6);
        assertEq(c.endsAt(), endsAt);
        assertEq(uint8(c.state()), 1);
        assertEq(c.factory(), address(factory));
        assertEq(c.operator(), operator);
        assertEq(c.treasury(), treasury);
        assertEq(c.guardian(), pauser);
        assertEq(c.fallbackHash(), bytes32(0));
    }

    function test_create_roundsTheFeeDown() public {
        EarnKitCampaign c = create(100_000_001, uint64(block.timestamp + 1 days));
        assertEq(c.fee(), 10_000_000);
        assertEq(c.prize(), 90_000_001);
    }

    function test_create_eachCampaignIsItsOwnAddress() public {
        EarnKitCampaign a = create(10e6, uint64(block.timestamp + 1 days));
        vm.prank(sponsor);
        address b =
            factory.createCampaign(keccak256("ref-2"), IERC20(address(usdc)), 20e6, uint64(block.timestamp + 1 days));
        assertTrue(address(a) != b);
        assertEq(usdc.balanceOf(address(a)), 10e6);
        assertEq(usdc.balanceOf(b), 20e6);
    }

    function test_create_reverts_tokenNotAllowed() public {
        FeeOnTransferERC20 other = new FeeOnTransferERC20();
        vm.prank(sponsor);
        vm.expectRevert(EarnKitCampaigns.TokenNotAllowed.selector);
        factory.createCampaign(REF, IERC20(address(other)), 1e6, uint64(block.timestamp + 1 days));
    }

    function test_create_reverts_zeroOrOverCap() public {
        vm.startPrank(sponsor);
        vm.expectRevert(EarnKitCampaigns.BadAmount.selector);
        factory.createCampaign(REF, IERC20(address(usdc)), 0, uint64(block.timestamp + 1 days));
        vm.expectRevert(EarnKitCampaigns.BadAmount.selector);
        factory.createCampaign(REF, IERC20(address(usdc)), CAP + 1, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_create_reverts_badEndsAt() public {
        vm.startPrank(sponsor);
        vm.expectRevert(EarnKitCampaigns.BadEndsAt.selector);
        factory.createCampaign(REF, IERC20(address(usdc)), 1e6, uint64(block.timestamp));
        vm.expectRevert(EarnKitCampaigns.BadEndsAt.selector);
        factory.createCampaign(REF, IERC20(address(usdc)), 1e6, uint64(block.timestamp + 180 days + 1));
        vm.stopPrank();
    }

    function test_create_minDurationBoundary() public {
        vm.startPrank(sponsor);
        vm.expectRevert(EarnKitCampaigns.BadEndsAt.selector);
        factory.createCampaign(REF, IERC20(address(usdc)), 1e6, uint64(block.timestamp + 1 days - 1));
        factory.createCampaign(REF, IERC20(address(usdc)), 1e6, uint64(block.timestamp + 1 days));
        factory.createCampaign(keccak256("max"), IERC20(address(usdc)), 1e6, uint64(block.timestamp + 180 days));
        vm.stopPrank();
    }

    function test_create_snapshotsPauserAsGuardian_rotationOnlyAffectsNewCampaigns() public {
        EarnKitCampaign a = create(10e6, uint64(block.timestamp + 1 days));
        vm.prank(owner);
        factory.setPauser(bob);
        vm.prank(sponsor);
        EarnKitCampaign b = EarnKitCampaign(
            factory.createCampaign(keccak256("ref-2"), IERC20(address(usdc)), 10e6, uint64(block.timestamp + 1 days))
        );
        assertEq(a.guardian(), pauser);
        assertEq(b.guardian(), bob);
    }

    function test_create_reverts_refReusedBySameSponsor_butNotByOthers() public {
        create(1e6, uint64(block.timestamp + 1 days));
        vm.prank(sponsor);
        vm.expectRevert(EarnKitCampaigns.RefUsed.selector);
        factory.createCampaign(REF, IERC20(address(usdc)), 1e6, uint64(block.timestamp + 1 days));

        // Another sender can't squat this sponsor's ref, and can use the same bytes for itself.
        usdc.mint(alice, 1e6);
        vm.startPrank(alice);
        usdc.approve(address(factory), 1e6);
        address c = factory.createCampaign(REF, IERC20(address(usdc)), 1e6, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        assertEq(factory.campaignOf(alice, REF), c);
    }

    function test_create_reverts_feeOnTransferToken() public {
        FeeOnTransferERC20 fot = new FeeOnTransferERC20();
        vm.prank(owner);
        factory.setCap(address(fot), CAP);
        fot.mint(sponsor, 100e6);
        vm.startPrank(sponsor);
        fot.approve(address(factory), 100e6);
        vm.expectRevert(EarnKitCampaigns.AmountMismatch.selector);
        factory.createCampaign(REF, IERC20(address(fot)), 100e6, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_pause_stopsCreateOnly_pauserCanPause_onlyOwnerUnpauses() public {
        EarnKitCampaign c = create(100e6, uint64(block.timestamp + 1 days));
        vm.prank(pauser);
        factory.pause();

        vm.prank(sponsor);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        factory.createCampaign(keccak256("x"), IERC20(address(usdc)), 1e6, uint64(block.timestamp + 1 days));

        // Payouts and refunds still work while paused.
        vm.warp(block.timestamp + 1 days);
        vm.prank(sponsor);
        c.award(one(alice), oneAmt(90e6));
        assertEq(usdc.balanceOf(alice), 90e6);

        vm.prank(pauser);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, pauser));
        factory.unpause();
        vm.prank(owner);
        factory.unpause();
    }

    function test_pause_reverts_forStrangers() public {
        vm.prank(alice);
        vm.expectRevert(EarnKitCampaigns.NotPauser.selector);
        factory.pause();
    }

    function test_config_onlyOwner_andNoZeroAddresses() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.setCap(address(usdc), 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.setOperator(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.setTreasury(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.setPauser(alice);
        vm.stopPrank();

        vm.startPrank(owner);
        vm.expectRevert(EarnKitCampaigns.ZeroAddress.selector);
        factory.setOperator(address(0));
        vm.expectRevert(EarnKitCampaigns.ZeroAddress.selector);
        factory.setTreasury(address(0));
        vm.expectRevert(EarnKitCampaigns.ZeroAddress.selector);
        factory.setPauser(address(0));
        factory.setOperator(bob);
        factory.setTreasury(bob);
        factory.setPauser(bob);
        factory.setCap(address(usdc), 0);
        vm.stopPrank();
        assertEq(factory.operator(), bob);
        assertEq(factory.treasury(), bob);
        assertEq(factory.pauser(), bob);
        assertEq(factory.capOf(address(usdc)), 0);
    }

    function test_renounceOwnership_isDisabled() public {
        vm.prank(owner);
        vm.expectRevert(EarnKitCampaigns.RenounceDisabled.selector);
        factory.renounceOwnership();
    }

    function test_constructor_reverts_onBadConfig() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256[] memory caps = new uint256[](0);
        vm.expectRevert(EarnKitCampaigns.LengthMismatch.selector);
        new EarnKitCampaigns(owner, operator, treasury, pauser, tokens, caps);
        uint256[] memory oneCap = new uint256[](1);
        vm.expectRevert(EarnKitCampaigns.ZeroAddress.selector);
        new EarnKitCampaigns(owner, address(0), treasury, pauser, tokens, oneCap);
    }

    function test_implementation_cannotBeInitialized() public {
        EarnKitCampaign impl = EarnKitCampaign(factory.implementation());
        vm.expectRevert();
        impl.initialize(alice, IERC20(address(usdc)), 1, uint64(block.timestamp + 1), operator, treasury, pauser);
    }

    function test_initialize_reverts_whenCalledDirectlyNotByFactory() public {
        // A fresh, never-initialized clone of the implementation: the `initializer` modifier
        // lets the call through, so this exercises the explicit `msg.sender != factory` check.
        EarnKitCampaign rawClone = EarnKitCampaign(Clones.clone(factory.implementation()));
        vm.expectRevert(EarnKitCampaign.NotFactory.selector);
        rawClone.initialize(alice, IERC20(address(usdc)), 1, uint64(block.timestamp + 1), operator, treasury, pauser);
    }

    function test_setCap_reverts_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(EarnKitCampaigns.ZeroAddress.selector);
        factory.setCap(address(0), 1);
    }

    function test_clone_cannotBeReinitialized() public {
        EarnKitCampaign c = create(1e6, uint64(block.timestamp + 1 days));
        vm.prank(address(factory));
        vm.expectRevert();
        c.initialize(alice, IERC20(address(usdc)), 1, uint64(block.timestamp + 1), operator, treasury, pauser);
    }
}
