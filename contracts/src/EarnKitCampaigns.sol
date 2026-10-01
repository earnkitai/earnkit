// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EarnKitCampaign} from "./EarnKitCampaign.sol";

/// @title EarnKit campaign factory
/// @notice Creates one isolated escrow clone per sponsor campaign. Holds no funds and cannot move
///         a campaign's funds. Owned by a TimelockController, so config changes are public in advance.
contract EarnKitCampaigns is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_DURATION = 180 days;

    address public immutable implementation;
    address public operator;
    address public treasury;
    address public pauser;
    /// Max amount per campaign for each allowed token (0 = not allowed).
    mapping(address token => uint256 cap) public capOf;
    mapping(address sponsor => mapping(bytes32 ref => address campaign)) public campaignOf;

    event CampaignCreated(
        bytes32 indexed ref, address indexed sponsor, address campaign, address token, uint256 amount, uint64 endsAt
    );
    event CapSet(address indexed token, uint256 cap);
    event OperatorSet(address operator);
    event TreasurySet(address treasury);
    event PauserSet(address pauser);

    error ZeroAddress();
    error LengthMismatch();
    error TokenNotAllowed();
    error BadAmount();
    error BadEndsAt();
    error RefUsed();
    error AmountMismatch();
    error NotPauser();
    error RenounceDisabled();

    constructor(
        address owner_,
        address operator_,
        address treasury_,
        address pauser_,
        address[] memory tokens,
        uint256[] memory caps
    ) Ownable(owner_) {
        if (tokens.length != caps.length) revert LengthMismatch();
        implementation = address(new EarnKitCampaign());
        _setOperator(operator_);
        _setTreasury(treasury_);
        _setPauser(pauser_);
        for (uint256 i; i < tokens.length; ++i) {
            _setCap(tokens[i], caps[i]);
        }
    }

    /// @notice Deposits `amount` of `token` into a new escrow clone for this sponsor's `ref`.
    function createCampaign(bytes32 ref, IERC20 token, uint256 amount, uint64 endsAt)
        external
        whenNotPaused
        nonReentrant
        returns (address campaign)
    {
        uint256 cap = capOf[address(token)];
        if (cap == 0) revert TokenNotAllowed();
        if (amount == 0 || amount > cap) revert BadAmount();
        if (endsAt <= block.timestamp || endsAt > block.timestamp + MAX_DURATION) revert BadEndsAt();
        if (campaignOf[msg.sender][ref] != address(0)) revert RefUsed();

        campaign = Clones.clone(implementation);
        campaignOf[msg.sender][ref] = campaign;
        EarnKitCampaign(campaign).initialize(msg.sender, token, amount, endsAt);

        uint256 before = token.balanceOf(campaign);
        token.safeTransferFrom(msg.sender, campaign, amount);
        if (token.balanceOf(campaign) - before != amount) revert AmountMismatch();

        emit CampaignCreated(ref, msg.sender, campaign, address(token), amount, endsAt);
    }

    function setCap(address token, uint256 cap) external onlyOwner {
        _setCap(token, cap);
    }

    function setOperator(address operator_) external onlyOwner {
        _setOperator(operator_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        _setTreasury(treasury_);
    }

    function setPauser(address pauser_) external onlyOwner {
        _setPauser(pauser_);
    }

    /// @notice Stops new campaigns. Awards and refunds are never affected.
    function pause() external {
        if (msg.sender != pauser && msg.sender != owner()) revert NotPauser();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev An ownerless factory could never change caps or the operator again.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function _setCap(address token, uint256 cap) private {
        if (token == address(0)) revert ZeroAddress();
        capOf[token] = cap;
        emit CapSet(token, cap);
    }

    function _setOperator(address operator_) private {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function _setTreasury(address treasury_) private {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function _setPauser(address pauser_) private {
        if (pauser_ == address(0)) revert ZeroAddress();
        pauser = pauser_;
        emit PauserSet(pauser_);
    }
}
