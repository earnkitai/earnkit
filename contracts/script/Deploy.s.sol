// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {EarnKitCampaigns} from "../src/EarnKitCampaigns.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --verify (owner's wallet signs)
contract Deploy is Script {
    uint256 constant BASE = 8453;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant COMPANY_TREASURY = 0xc8A889577446153e28D42254B75238Ae31EC7D57;

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
        address operator = vm.envAddress("OPERATOR");
        address pauser = vm.envAddress("PAUSER");
        address treasury = vm.envAddress("TREASURY");
        // The pauser is each campaign's fallback-veto guardian: it must be a different custodian.
        require(pauser != operator, "PAUSER must differ from OPERATOR (the pauser is the fallback-veto guardian)");
        if (block.chainid == BASE) {
            require(delay >= 48 hours, "TIMELOCK_DELAY < 48h is never allowed on Base mainnet");
            require(tokens[0] == BASE_USDC, "USDC is not canonical Base USDC");
            require(
                treasury == COMPANY_TREASURY,
                "TREASURY is not the company treasury 0xc8A889577446153e28D42254B75238Ae31EC7D57"
            );
        }
        if (delay < 48 hours) {
            // Testnet only: a short delay removes the "every config change is public 48 h ahead" guarantee.
            require(
                vm.envOr("ALLOW_SHORT_TIMELOCK", uint256(0)) == 1,
                "TIMELOCK_DELAY < 48h (set ALLOW_SHORT_TIMELOCK=1 for testnet)"
            );
            console2.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
            console2.log("WARNING: TIMELOCK_DELAY below 48 hours (seconds):", delay);
            console2.log("WARNING: testnet only. Never use this deployment for real funds.");
            console2.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        }

        vm.startBroadcast();
        timelock = new TimelockController(delay, proposers, executors, address(0));
        factory = new EarnKitCampaigns(address(timelock), operator, treasury, pauser, tokens, caps);
        vm.stopBroadcast();
        require(timelock.getMinDelay() == delay && factory.owner() == address(timelock), "post-deploy check failed");

        console2.log("timelock", address(timelock));
        console2.log("factory ", address(factory));
    }
}
