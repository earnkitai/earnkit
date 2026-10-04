// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {EarnKitCampaigns} from "../src/EarnKitCampaigns.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// One test function on purpose: vm.setEnv is process-wide, so splitting the cases across
/// parallel tests could make them read each other's env.
contract DeployTest is Test {
    function test_deploy_timelockDelayFloor() public {
        vm.setEnv("PROPOSER", vm.toString(makeAddr("proposer")));
        vm.setEnv("USDC", vm.toString(makeAddr("usdc")));
        vm.setEnv("USDC_CAP", "10000000000");
        vm.setEnv("OPERATOR", vm.toString(makeAddr("operator")));
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        vm.setEnv("PAUSER", vm.toString(makeAddr("pauser")));
        Deploy script = new Deploy();

        // Default: 48 h.
        vm.setEnv("TIMELOCK_DELAY", "172800");
        vm.setEnv("ALLOW_SHORT_TIMELOCK", "0");
        (TimelockController t, EarnKitCampaigns f) = script.run();
        assertEq(t.getMinDelay(), 48 hours);
        assertEq(f.owner(), address(t));

        // Short delay without the testnet flag: refused.
        vm.setEnv("TIMELOCK_DELAY", "0");
        vm.expectRevert(bytes("TIMELOCK_DELAY < 48h (set ALLOW_SHORT_TIMELOCK=1 for testnet)"));
        script.run();
        vm.setEnv("TIMELOCK_DELAY", "172799");
        vm.expectRevert(bytes("TIMELOCK_DELAY < 48h (set ALLOW_SHORT_TIMELOCK=1 for testnet)"));
        script.run();

        // With the explicit testnet flag: allowed (and loudly logged).
        vm.setEnv("TIMELOCK_DELAY", "60");
        vm.setEnv("ALLOW_SHORT_TIMELOCK", "1");
        (t,) = script.run();
        assertEq(t.getMinDelay(), 60);
        vm.setEnv("ALLOW_SHORT_TIMELOCK", "0");

        // Review L-02: the testnet flag is ignored on Base mainnet (8453), in any spelling.
        uint256 realChain = block.chainid;
        vm.chainId(8453);
        vm.setEnv("USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
        vm.setEnv("TIMELOCK_DELAY", "0");
        vm.setEnv("ALLOW_SHORT_TIMELOCK", "0x1");
        vm.expectRevert(bytes("TIMELOCK_DELAY < 48h is never allowed on Base mainnet"));
        script.run();
        vm.setEnv("ALLOW_SHORT_TIMELOCK", "0");
        // ...and on Base mainnet the token must be canonical USDC.
        vm.setEnv("TIMELOCK_DELAY", "172800");
        vm.setEnv("USDC", vm.toString(makeAddr("usdc")));
        vm.expectRevert(bytes("USDC is not canonical Base USDC"));
        script.run();
        vm.setEnv("USDC", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
        // v2.3: on Base mainnet the fee treasury must be the company treasury.
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));
        vm.expectRevert(bytes("TREASURY is not the company treasury 0xc8A889577446153e28D42254B75238Ae31EC7D57"));
        script.run();
        vm.setEnv("TREASURY", "0xc8A889577446153e28D42254B75238Ae31EC7D57");
        (t, f) = script.run();
        assertEq(t.getMinDelay(), 48 hours);
        assertEq(f.treasury(), 0xc8A889577446153e28D42254B75238Ae31EC7D57);
        vm.chainId(realChain);
        vm.setEnv("TREASURY", vm.toString(makeAddr("treasury")));

        // Review M-01: PAUSER == OPERATOR is refused with a clear message.
        vm.setEnv("PAUSER", vm.toString(makeAddr("operator")));
        vm.expectRevert(bytes("PAUSER must differ from OPERATOR (the pauser is the fallback-veto guardian)"));
        script.run();
        vm.setEnv("PAUSER", vm.toString(makeAddr("pauser")));
    }
}
