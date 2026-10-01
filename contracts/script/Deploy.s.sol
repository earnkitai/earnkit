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
