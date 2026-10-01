// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EarnKitCampaigns} from "../../src/EarnKitCampaigns.sol";
import {EarnKitCampaign} from "../../src/EarnKitCampaign.sol";

/// FORK=1 forge test --match-contract BaseUsdcForkTest --fork-url $BASE_RPC_URL
contract BaseUsdcForkTest is Test {
    IERC20 constant USDC = IERC20(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913);

    function test_fullFlowWithRealUsdc() public {
        if (block.chainid != 8453) return; // only meaningful on a Base fork
        address sponsor = makeAddr("sponsor");
        address treasury = makeAddr("treasury");
        address[] memory tokens = new address[](1);
        tokens[0] = address(USDC);
        uint256[] memory caps = new uint256[](1);
        caps[0] = 10_000e6;
        EarnKitCampaigns f = new EarnKitCampaigns(address(this), makeAddr("op"), treasury, makeAddr("p"), tokens, caps);
        deal(address(USDC), sponsor, 1000e6);
        // Fund `sponsor` with a trace of ETH before pranking as it. Without this, forge's fork
        // backend never materializes local account state for a fresh (never-touched) address, and
        // a vm.prank'd call as that address into the real USDC proxy reverts with empty returndata
        // before even reaching the implementation (confirmed via bisection: the same call succeeds
        // from an address forge already knows about, e.g. this test contract, and succeeds via a
        // plain `cast call --from` against the live chain — isolating this to forge's own
        // prank+fork interaction, not USDC or our contracts). See task-2-report.md.
        vm.deal(sponsor, 1 ether);
        vm.startPrank(sponsor);
        USDC.approve(address(f), 1000e6);
        EarnKitCampaign c = EarnKitCampaign(f.createCampaign(bytes32("r"), USDC, 1000e6, uint64(block.timestamp + 1 days)));
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
}
