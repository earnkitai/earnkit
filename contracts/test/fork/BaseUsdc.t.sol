// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EarnKitCampaigns} from "../../src/EarnKitCampaigns.sol";
import {EarnKitCampaign} from "../../src/EarnKitCampaign.sol";

/// forge test --match-contract BaseUsdcForkTest --fork-url <BASE_RPC_URL>
/// Without a Base fork (wrong chain, or no --fork-url at all) this test is reported SKIPPED, not
/// PASSED, so a plain `forge test` run can't be mistaken for fork coverage.
contract BaseUsdcForkTest is Test {
    IERC20 constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);

    function test_fullFlowWithRealUsdc() public {
        vm.skip(block.chainid != 8453); // only meaningful on a Base fork
        address sponsor = makeAddr("sponsor");
        address treasury = makeAddr("treasury");
        address[] memory tokens = new address[](1);
        tokens[0] = address(USDC);
        uint256[] memory caps = new uint256[](1);
        caps[0] = 10_000e6;
        EarnKitCampaigns f = new EarnKitCampaigns(address(this), makeAddr("op"), treasury, makeAddr("p"), tokens, caps);
        deal(address(USDC), sponsor, 1000e6);
        // Fund `sponsor` with a trace of ETH before pranking as it. Without this, a vm.prank'd
        // call as `sponsor` into the real USDC proxy reverts with empty returndata before even
        // reaching the implementation, while the identical call from an address forge already
        // knows about (e.g. this test contract) succeeds, and the identical call succeeds via a
        // plain `cast call --from` against the live chain too — so this is a forge/fork
        // interaction with vm.prank, not a USDC or EarnKit bug. (The exact mechanism isn't fully
        // confirmed; `makeAddr` addresses have publicly known private keys and could in principle
        // carry real on-chain state, so this workaround is treated as empirical, not as a proven
        // root cause.) Harmless here either way: it only funds a throwaway test address with ETH.
        vm.deal(sponsor, 1 ether);
        vm.startPrank(sponsor);
        USDC.approve(address(f), 1000e6);
        EarnKitCampaign c =
            EarnKitCampaign(f.createCampaign(bytes32("r"), USDC, 1000e6, uint64(block.timestamp + 1 days)));
        vm.warp(block.timestamp + 1 days);
        address[] memory w = new address[](1);
        w[0] = makeAddr("winner");
        uint256[] memory a = new uint256[](1);
        a[0] = 900e6;
        c.award(w, a);
        vm.stopPrank();
        assertEq(USDC.balanceOf(w[0]), 900e6);
        assertEq(USDC.balanceOf(treasury), 100e6);
    }

    /// Operator fallback on real USDC: propose after grace, a vetoed proposal never pays, a
    /// re-proposal executes (by a stranger) after 72 h, and pays winners + treasury exactly.
    function test_fallbackCycleWithRealUsdc() public {
        vm.skip(block.chainid != 8453);
        address sponsor = makeAddr("sponsor");
        address treasury = makeAddr("treasury");
        address op = makeAddr("op");
        address guardian = makeAddr("p");
        address[] memory tokens = new address[](1);
        tokens[0] = address(USDC);
        uint256[] memory caps = new uint256[](1);
        caps[0] = 10_000e6;
        EarnKitCampaigns f = new EarnKitCampaigns(address(this), op, treasury, guardian, tokens, caps);
        deal(address(USDC), sponsor, 1000e6);
        // Same empirical workaround as test_fullFlowWithRealUsdc: give every pranked address a
        // trace of ETH, or pranked calls on the fork revert with empty returndata.
        vm.deal(sponsor, 1 ether);
        vm.deal(op, 1 ether);
        vm.deal(guardian, 1 ether);
        vm.startPrank(sponsor);
        USDC.approve(address(f), 1000e6);
        EarnKitCampaign c =
            EarnKitCampaign(f.createCampaign(bytes32("r"), USDC, 1000e6, uint64(block.timestamp + 1 days)));
        vm.stopPrank();
        assertEq(c.guardian(), guardian);

        address[] memory w = new address[](2);
        (w[0], w[1]) = (makeAddr("winner1"), makeAddr("winner2"));
        uint256[] memory a = new uint256[](2);
        (a[0], a[1]) = (600e6, 300e6);

        vm.warp(c.endsAt() + 7 days);
        vm.prank(op);
        c.proposeFallback(w, a);
        vm.prank(guardian);
        c.vetoFallback();
        vm.warp(block.timestamp + 72 hours);
        vm.expectRevert(EarnKitCampaign.NoFallback.selector);
        c.executeFallback(w, a);

        vm.prank(op);
        c.proposeFallback(w, a);
        vm.warp(block.timestamp + 72 hours - 1);
        vm.expectRevert(EarnKitCampaign.FallbackNotReady.selector);
        c.executeFallback(w, a);
        vm.warp(block.timestamp + 1);
        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        c.executeFallback(w, a);

        assertEq(USDC.balanceOf(w[0]), 600e6);
        assertEq(USDC.balanceOf(w[1]), 300e6);
        assertEq(USDC.balanceOf(treasury), 100e6);
        assertEq(USDC.balanceOf(address(c)), 0);
    }
}
