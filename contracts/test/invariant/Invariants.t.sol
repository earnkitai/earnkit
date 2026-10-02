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
        handler = new Handler(factory, usdc, owner, operator, treasury, pauser);
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

    /// prize + fee == the amount actually deposited for that campaign (not a self-referential
    /// rebuild of amount from prize + fee) and fee == amount / 10.
    function invariant_feeMath() public view {
        uint256 n = handler.campaignCount();
        for (uint256 i; i < n; ++i) {
            EarnKitCampaign c = handler.campaigns(i);
            uint256 amount = handler.ghostAmountOf(address(c));
            assertEq(c.prize() + c.fee(), amount, "prize + fee == deposited amount");
            assertEq(c.fee(), amount / 10, "fee == amount / 10");
        }
    }

    /// The two fixed winner addresses, combined, never hold more or less than what award() ever
    /// paid out to winners. Catches a mutation that pays the wrong recipient (e.g. the sponsor
    /// instead of the winners): the recipient balances would then diverge from this ghost total.
    function invariant_winnersPaid() public view {
        assertEq(
            usdc.balanceOf(handler.winnerA()) + usdc.balanceOf(handler.winnerB()),
            handler.ghostToWinners(),
            "winners' combined balance == total ever awarded to winners"
        );
    }

    /// Each sponsor's balance is exactly what it started with, minus what it deposited into
    /// campaigns, plus what it got back via refund. Catches a mutation that lets a non-sponsor
    /// receive a refund, or that sends a refund to the wrong address.
    function invariant_sponsorsWhole() public view {
        uint256 n = handler.actorsCount();
        for (uint256 i; i < n; ++i) {
            address a = handler.actors(i);
            assertEq(
                usdc.balanceOf(a),
                handler.STARTING_BALANCE() - handler.ghostDepositedBy(a) + handler.ghostRefundedTo(a),
                "sponsor balance == minted - deposited + refunded"
            );
        }
    }

    /// No award/propose/veto/refund ever succeeded for a caller/time the contract's own rules should have
    /// rejected. This is the direct fix for the mutation check in the task review: a mutant that
    /// lets any caller refund, or any caller award, bumps `unauthorizedSuccesses` in the handler
    /// (see Handler.sol for why that's a ghost counter checked here, rather than a reverting
    /// assertion inside the handler call itself).
    function invariant_noUnauthorizedSuccess() public view {
        assertEq(
            handler.unauthorizedSuccesses(), 0, "an award/propose/veto/refund succeeded for a disallowed caller/time"
        );
    }

    /// No address that an award path must exclude ever received prize money from a clone.
    /// (The treasury is excluded as a winner but still gets the fee: `invariant_treasuryOnlyGetsFees`.
    /// The sponsor only ever gets refunds: `invariant_sponsorsWhole`. Settled clones hold 0 and
    /// the factory holds 0: `invariant_conservation`/`invariant_factoryHoldsNothing`.)
    function invariant_excludedNeverPaid() public view {
        assertEq(handler.excludedPaid(), 0, "an award/fallback with an excluded winner succeeded");
        for (uint256 k; k < 4; ++k) {
            assertEq(usdc.balanceOf(handler.roleKeys(k)), 0, "an operator/guardian key received funds");
        }
        assertEq(usdc.balanceOf(address(usdc)), 0, "token contract received funds");
        assertEq(usdc.balanceOf(factory.implementation()), 0, "implementation received funds");
    }

    /// A fallback only ever executes with the exact proposed payload, at or after proposal + 72 h,
    /// and every pending proposal the contract reports matches the handler's own record.
    function invariant_fallbackOnlyAfterDelay() public view {
        assertEq(handler.badFallbackExecutions(), 0, "fallback executed early, unproposed, or with another payload");
        uint256 n = handler.campaignCount();
        for (uint256 i; i < n; ++i) {
            EarnKitCampaign c = handler.campaigns(i);
            assertEq(c.fallbackHash(), handler.ghostProposedHash(address(c)), "pending hash matches handler");
            assertEq(c.fallbackAt(), handler.ghostProposedAt(address(c)), "pending time matches handler");
            if (c.state() != EarnKitCampaign.State.Funded) {
                assertEq(c.fallbackHash(), bytes32(0), "settled => no proposal");
            }
        }
    }

    /// A veto is sticky: once vetoed, a campaign never again has a pending proposal, and the
    /// contract's veto flag matches the handler's record.
    function invariant_noProposalAfterVeto() public view {
        uint256 n = handler.campaignCount();
        for (uint256 i; i < n; ++i) {
            EarnKitCampaign c = handler.campaigns(i);
            assertEq(c.fallbackVetoed(), handler.ghostVetoed(address(c)), "veto flag matches handler");
            if (c.fallbackVetoed()) assertEq(c.fallbackHash(), bytes32(0), "proposal exists after a veto");
        }
    }

    /// The guardian (pauser) is never the operator: not at the factory after any rotation, and not
    /// in any campaign's snapshot (which also matches the handler's model of the factory then).
    function invariant_guardianNeverOperator() public view {
        assertEq(handler.configViolations(), 0, "a rotation made pauser == operator");
        assertTrue(factory.pauser() != factory.operator(), "factory pauser == operator");
        assertEq(factory.operator(), handler.curOperator(), "factory operator matches model");
        assertEq(factory.pauser(), handler.curPauser(), "factory pauser matches model");
        uint256 n = handler.campaignCount();
        for (uint256 i; i < n; ++i) {
            EarnKitCampaign c = handler.campaigns(i);
            assertTrue(c.guardian() != c.operator(), "campaign guardian == operator");
            assertEq(c.operator(), handler.ghostOperatorOf(address(c)), "operator snapshot");
            assertEq(c.guardian(), handler.ghostGuardianOf(address(c)), "guardian snapshot");
        }
    }
}
