// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Contracts for the v2.4 campaign e2e (apps/frontend/scripts/campaign-e2e.mts). Local anvil only.

/// 18-decimal mintable token standing in for MINI.
contract MockToken18 is ERC20 {
    constructor() ERC20("Mock MINI", "MINI") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// A contract people use: the e2e's entered apps.
contract Ping {
    event Pinged(address indexed from);

    function ping() external {
        emit Pinged(msg.sender);
    }
}

/// A minimal smart account: anyone may make it call anything (the e2e's bundler drives it through
/// MockEntryPoint). `fanOut` makes it call a target through other accounts, the way a staged
/// clone farm would.
contract MockSmartAccount {
    function execute(address target, bytes calldata data) external {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function fanOut(address[] calldata clones, address target, bytes calldata data) external {
        for (uint256 i = 0; i < clones.length; i++) {
            MockSmartAccount(clones[i]).execute(target, data);
        }
    }
}

/// The parts of an ERC-4337 EntryPoint that scoring reads: `getNonce(sender, key)` and the
/// UserOperationEvent (same signature on v0.6, v0.7 and v0.8). The e2e installs its runtime code at
/// the v0.7 EntryPoint address with anvil_setCode.
contract MockEntryPoint {
    event UserOperationEvent(
        bytes32 indexed userOpHash,
        address indexed sender,
        address indexed paymaster,
        uint256 nonce,
        bool success,
        uint256 actualGasCost,
        uint256 actualGasUsed
    );

    mapping(address => mapping(uint192 => uint64)) internal seq;

    function getNonce(address sender, uint192 key) external view returns (uint256) {
        return seq[sender][key] | (uint256(key) << 64);
    }

    /// One UserOp from `sender` with nonce key `key`: the account runs `callData` on itself.
    function handleOp(address sender, uint192 key, bytes calldata callData) external {
        uint256 nonce = seq[sender][key] | (uint256(key) << 64);
        seq[sender][key]++;
        (bool ok,) = sender.call(callData);
        emit UserOperationEvent(keccak256(abi.encode(sender, nonce)), sender, address(0), nonce, ok, 0, 0);
    }
}
