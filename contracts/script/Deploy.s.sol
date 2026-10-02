// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {EarnKitCampaigns} from "../src/EarnKitCampaigns.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --verify (owner's wallet signs)
contract Deploy is Script {
    function run() external returns (TimelockController timelock, EarnKitCampaigns factory) {
        address proposer = vm.envAddress("PROPOSER");
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = proposer;
        address[] memory tokens = new address[](1);
        tokens[0] = vm.envAddress("USDC");
        uint256[] memory caps = new uint256[](1);
        caps[0] = vm.envUint("USDC_CAP");
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(48 hours));
        if (delay < 48 hours) {
            // Testnet only: a short delay removes the "every config change is public 48 h ahead" guarantee.
            require(vm.envOr("ALLOW_SHORT_TIMELOCK", uint256(0)) == 1, "TIMELOCK_DELAY < 48h (set ALLOW_SHORT_TIMELOCK=1 for testnet)");
            console2.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
            console2.log("WARNING: TIMELOCK_DELAY below 48 hours (seconds):", delay);
            console2.log("WARNING: testnet only. Never use this deployment for real funds.");
            console2.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        }

        vm.startBroadcast();
        timelock = new TimelockController(delay, proposers, executors, address(0));
        factory = new EarnKitCampaigns(
            address(timelock), vm.envAddress("OPERATOR"), vm.envAddress("TREASURY"), vm.envAddress("PAUSER"), tokens, caps
        );
        vm.stopBroadcast();

        console2.log("timelock", address(timelock));
        console2.log("factory ", address(factory));
    }
}
