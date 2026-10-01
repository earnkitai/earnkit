// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title One EarnKit campaign's prize pool (deployed as a clone by EarnKitCampaigns)
/// @notice Money leaves only by `award` (whole prize to winners + fee to the treasury) or
///         `refund` (everything back to the sponsor), once, under the time rules below.
contract EarnKitCampaign is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Awarded,
        Refunded
    }

    uint64 public constant AWARD_GRACE = 7 days;
    uint64 public constant RECLAIM_AFTER = 60 days;
    uint256 public constant MAX_WINNERS = 50;

    /// The factory that deployed the implementation; shared by every clone (immutable is in code).
    address public immutable factory;

    address public sponsor;
    IERC20 public token;
    uint256 public prize;
    uint256 public fee;
    uint64 public endsAt;
    State public state;
    /// Snapshotted from the factory at creation time: later factory rotations never affect an
    /// already-funded campaign, so the factory owner can't redirect its payouts or fees.
    address public operator;
    address public treasury;

    event Awarded(address[] winners, uint256[] amounts, uint256 fee);
    event Refunded(address indexed by, uint256 amount);

    error NotFactory();
    error NotFunded();
    error NotEnded();
    error NotAllowed();
    error BadWinners();
    error WrongTotal();

    constructor() {
        factory = msg.sender;
        _disableInitializers();
    }

    /// @dev Called once by the factory right after cloning, before it moves the funds in.
    ///      `operator_`/`treasury_` are snapshotted as-of creation; later factory rotations only
    ///      apply to campaigns created afterwards.
    function initialize(
        address sponsor_,
        IERC20 token_,
        uint256 amount,
        uint64 endsAt_,
        address operator_,
        address treasury_
    ) external initializer {
        if (msg.sender != factory) revert NotFactory();
        sponsor = sponsor_;
        token = token_;
        fee = amount / 10;
        prize = amount - amount / 10;
        endsAt = endsAt_;
        operator = operator_;
        treasury = treasury_;
        state = State.Funded;
    }

    /// @notice Pays the whole prize to `winners` and the fee to the treasury.
    /// @dev Sponsor after `endsAt`; the operator only after `endsAt + AWARD_GRACE`.
    function award(address[] calldata winners, uint256[] calldata amounts) external nonReentrant {
        if (state != State.Funded) revert NotFunded();
        if (block.timestamp < endsAt) revert NotEnded();
        bool bySponsor = msg.sender == sponsor;
        bool byOperator = msg.sender == operator && block.timestamp >= uint256(endsAt) + AWARD_GRACE;
        if (!bySponsor && !byOperator) revert NotAllowed();

        uint256 n = winners.length;
        if (n == 0 || n > MAX_WINNERS || n != amounts.length) revert BadWinners();
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (winners[i] == address(0) || amounts[i] == 0) revert BadWinners();
            total += amounts[i];
        }
        if (total != prize) revert WrongTotal();

        state = State.Awarded;
        for (uint256 i; i < n; ++i) {
            token.safeTransfer(winners[i], amounts[i]);
        }
        token.safeTransfer(treasury, fee);
        emit Awarded(winners, amounts, fee);
    }

    /// @notice Returns prize + fee to the sponsor.
    /// @dev The operator at any time (takedown / no eligible entries); the sponsor after
    ///      `endsAt + RECLAIM_AFTER`, so funds are never stuck if EarnKit disappears.
    function refund() external nonReentrant {
        if (state != State.Funded) revert NotFunded();
        bool byOperator = msg.sender == operator;
        bool bySponsor = msg.sender == sponsor && block.timestamp >= uint256(endsAt) + RECLAIM_AFTER;
        if (!byOperator && !bySponsor) revert NotAllowed();

        state = State.Refunded;
        uint256 amount = prize + fee;
        token.safeTransfer(sponsor, amount);
        emit Refunded(msg.sender, amount);
    }
}
