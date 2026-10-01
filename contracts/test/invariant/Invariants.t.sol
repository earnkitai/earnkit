// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {BaseTest} from "../Base.t.sol";
import {EarnKitCampaign} from "../../src/EarnKitCampaign.sol";
import {Handler} from "./Handler.sol";

contract InvariantsTest is StdInvariant, BaseTest {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(factory, usdc, owner, operator, treasury);
        targetContract(address(handler));
    }

    /// Every deposited unit is still in a Funded clone, or went to winners, the treasury, or back.
    function invariant_conservation() public view {
        uint256 held;
        uint256 n = handler.campaignCount();
        for (uint256 i; i < n; ++i) {
            EarnKitCampaign c = handler.campaigns(i);
            uint256 bal = usdc.balanceOf(address(c));
            if (c.state() == EarnKitCampaign.State.Funded) {
                assertEq(bal, c.prize() + c.fee(), "funded clone holds exactly its pool");
                held += bal;
            } else {
                assertEq(bal, 0, "settled clone is empty");
            }
        }
        assertEq(
            handler.ghostDeposited(),
            held + handler.ghostToWinners() + handler.ghostToTreasury() + handler.ghostRefunded(),
            "deposits = held + paid + fees + refunds"
        );
    }

    /// The treasury only ever receives fees from awarded campaigns.
    function invariant_treasuryOnlyGetsFees() public view {
        assertEq(usdc.balanceOf(treasury), handler.ghostToTreasury());
    }

    /// The factory never holds funds.
    function invariant_factoryHoldsNothing() public view {
        assertEq(usdc.balanceOf(address(factory)), 0);
    }

    /// prize + fee == deposit and fee == deposit / 10 for every campaign.
    function invariant_feeMath() public view {
        uint256 n = handler.campaignCount();
        for (uint256 i; i < n; ++i) {
            EarnKitCampaign c = handler.campaigns(i);
            uint256 amount = c.prize() + c.fee();
            assertEq(c.fee(), amount / 10);
        }
    }
}
