// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Contracts for the v2.5 builder bonus ledger anvil test (apps/frontend/lib/earnkit/bonus-ledger.anvil.test.ts).
// Local anvil only. Events and the read/claim functions match Clanker v4's FeeLocker and LP lockers
// (tokens.fun lib/fees/abi.ts); the fee math is simplified to WETH-only rewards.

/// 18-decimal mintable token standing in for WETH.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Clanker's FeeLocker: per (fee owner, token) balances; `claim` is permissionless and pays the owner.
contract MockFeeLocker {
    event StoreTokens(address indexed sender, address indexed feeOwner, address indexed token, uint256 balance, uint256 amount);
    event ClaimTokens(address indexed feeOwner, address indexed token, uint256 amountClaimed);

    mapping(address => mapping(address => uint256)) internal fees;

    function storeFees(address feeOwner, address token, uint256 amount) external {
        ERC20(token).transferFrom(msg.sender, address(this), amount);
        fees[feeOwner][token] += amount;
        emit StoreTokens(msg.sender, feeOwner, token, fees[feeOwner][token], amount);
    }

    function availableFees(address feeOwner, address token) external view returns (uint256) {
        return fees[feeOwner][token];
    }

    function claim(address feeOwner, address token) external {
        uint256 amount = fees[feeOwner][token];
        require(amount > 0, "NoFeesToClaim");
        fees[feeOwner][token] = 0;
        ERC20(token).transfer(feeOwner, amount);
        emit ClaimTokens(feeOwner, token, amount);
    }
}

/// A Clanker LP locker: `collectRewards(coin)` reverts for a coin it doesn't hold; for one it holds,
/// it stores each non-zero slot's share in the FeeLocker (StoreTokens, slot order), then emits
/// ClaimedRewards(coin, ...), as Clanker v4 does.
contract MockLpLocker {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct TokenRewardInfo {
        address token;
        PoolKey poolKey;
        uint256 positionId;
        uint256 numPositions;
        uint16[] rewardBps;
        address[] rewardAdmins;
        address[] rewardRecipients;
    }

    event ClaimedRewards(address indexed token, uint256 amount0, uint256 amount1, uint256[] rewards0, uint256[] rewards1);

    MockFeeLocker public immutable feeLocker;
    MockWETH public immutable weth;
    mapping(address => TokenRewardInfo) internal infos;
    mapping(address => uint256) public pending;

    constructor(MockFeeLocker feeLocker_, MockWETH weth_) {
        feeLocker = feeLocker_;
        weth = weth_;
    }

    function register(address coin, address[] calldata recipients, uint16[] calldata bps) external {
        TokenRewardInfo storage info = infos[coin];
        info.token = coin;
        info.poolKey.currency0 = address(weth);
        info.poolKey.currency1 = coin;
        info.rewardRecipients = recipients;
        info.rewardAdmins = recipients;
        info.rewardBps = bps;
    }

    /// Trading fees accrue to a coin's position (WETH minted to the locker).
    function accrue(address coin, uint256 amount) external {
        pending[coin] += amount;
        weth.mint(address(this), amount);
    }

    function tokenRewards(address coin) external view returns (TokenRewardInfo memory) {
        require(infos[coin].token != address(0), "TokenNotFound");
        return infos[coin];
    }

    function collectRewards(address coin) external {
        _collect(coin);
    }

    /// Several coins collected in one transaction (as tokens.fun's batch harvest can).
    function collectMany(address[] calldata coins) external {
        for (uint256 i = 0; i < coins.length; i++) _collect(coins[i]);
    }

    function _collect(address coin) internal {
        TokenRewardInfo storage info = infos[coin];
        require(info.token != address(0), "TokenNotFound");
        uint256 total = pending[coin];
        pending[coin] = 0;
        uint256 n = info.rewardRecipients.length;
        uint256[] memory rewards0 = new uint256[](n);
        uint256[] memory rewards1 = new uint256[](n);
        weth.approve(address(feeLocker), total);
        for (uint256 i = 0; i < n; i++) {
            uint256 share = (total * info.rewardBps[i]) / 10_000;
            rewards0[i] = share;
            if (share > 0) feeLocker.storeFees(info.rewardRecipients[i], address(weth), share);
        }
        emit ClaimedRewards(coin, total, 0, rewards0, rewards1);
    }
}
