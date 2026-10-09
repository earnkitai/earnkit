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

/// v2.10 fix round 1 (I2): the OP Stack GasPriceOracle's getL1Fee, placed at Base's predeploy
/// (0x420...0F) on a plain anvil with anvil_setCode: 1 gwei of L1 fee per calldata byte.
contract MockGasPriceOracle {
    function getL1Fee(bytes calldata data) external pure returns (uint256) {
        return data.length * 1 gwei;
    }
}
