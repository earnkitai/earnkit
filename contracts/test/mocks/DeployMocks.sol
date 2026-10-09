// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// v2.10 item 13 (deploy.anvil.test.ts): a builder contract whose deployer is its first owner, so
/// EarnKit's deployer must call transferOwnership(builder) once.
contract OwnedTipJar {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address next) external {
        require(msg.sender == owner, "not owner");
        owner = next;
    }

    function tip() external payable {}
}
