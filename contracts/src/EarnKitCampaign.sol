// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title One EarnKit campaign's prize pool (deployed as a clone by EarnKitCampaigns)
/// @notice Money leaves only once, by one of:
///         - `award` (sponsor, after `endsAt`): whole prize to winners + fee to the treasury;
///         - `executeFallback` (anyone, for a winner list the operator proposed after
///           `endsAt + AWARD_GRACE` and nobody vetoed for `FALLBACK_DELAY`): same payout as award;
///         - `refund` (operator any time, sponsor after `endsAt + RECLAIM_AFTER`): all to the sponsor.
contract EarnKitCampaign is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        None,
        Funded,
        Awarded,
        Refunded
    }

    uint64 public constant AWARD_GRACE = 7 days;
    uint64 public constant FALLBACK_DELAY = 72 hours;
    uint64 public constant RECLAIM_AFTER = 60 days;
    uint256 public constant MAX_WINNERS = 50;

    /// The factory that deployed the implementation; shared by every clone (immutable is in code).
    address public immutable factory;
    /// The implementation's own address, also baked into the shared code, so every clone knows it.
    address private immutable implementation;

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
    /// The factory's pauser at creation time; can veto a pending operator fallback.
    address public guardian;
    /// Pending operator fallback: keccak256(abi.encode(winners, amounts)) and when it was proposed.
    bytes32 public fallbackHash;
    uint64 public fallbackAt;

    event Awarded(address[] winners, uint256[] amounts, uint256 fee);
    event Refunded(address indexed by, uint256 amount);
    event FallbackProposed(address[] winners, uint256[] amounts);
    event FallbackVetoed();

    error NotFactory();
    error NotFunded();
    error NotEnded();
    error NotAllowed();
    error BadWinners();
    error WrongTotal();
    error ExcludedWinner();
    error NoFallback();
    error FallbackMismatch();
    error FallbackNotReady();

    constructor() {
        factory = msg.sender;
        implementation = address(this);
        _disableInitializers();
    }

    /// @dev Called once by the factory right after cloning, before it moves the funds in.
    ///      `operator_`/`treasury_`/`guardian_` are snapshotted as-of creation; later factory
    ///      rotations only apply to campaigns created afterwards.
    function initialize(
        address sponsor_,
        IERC20 token_,
        uint256 amount,
        uint64 endsAt_,
        address operator_,
        address treasury_,
        address guardian_
    ) external initializer {
        if (msg.sender != factory) revert NotFactory();
        sponsor = sponsor_;
        token = token_;
        fee = amount / 10;
        prize = amount - amount / 10;
        endsAt = endsAt_;
        operator = operator_;
        treasury = treasury_;
        guardian = guardian_;
        state = State.Funded;
    }

    /// @notice Sponsor pays the whole prize to `winners` and the fee to the treasury, after `endsAt`.
    ///         Allowed while an operator fallback is pending (the sponsor's choice wins).
    function award(address[] calldata winners, uint256[] calldata amounts) external nonReentrant {
        if (state != State.Funded) revert NotFunded();
        if (block.timestamp < endsAt) revert NotEnded();
        if (msg.sender != sponsor) revert NotAllowed();
        _payout(winners, amounts);
    }

    /// @notice Operator proposes winners if the sponsor hasn't awarded by `endsAt + AWARD_GRACE`.
    ///         Anyone can execute it after `FALLBACK_DELAY`, unless the guardian vetoes first.
    ///         Re-proposing replaces the pending list and restarts the delay.
    function proposeFallback(address[] calldata winners, uint256[] calldata amounts) external {
        if (state != State.Funded) revert NotFunded();
        if (block.timestamp < uint256(endsAt) + AWARD_GRACE) revert NotEnded();
        if (msg.sender != operator) revert NotAllowed();
        _validate(winners, amounts);
        fallbackHash = keccak256(abi.encode(winners, amounts));
        fallbackAt = uint64(block.timestamp);
        emit FallbackProposed(winners, amounts);
    }

    /// @notice Pays out the pending fallback exactly as proposed, once its delay has passed.
    function executeFallback(address[] calldata winners, uint256[] calldata amounts) external nonReentrant {
        if (state != State.Funded) revert NotFunded();
        if (fallbackHash == bytes32(0)) revert NoFallback();
        if (fallbackHash != keccak256(abi.encode(winners, amounts))) revert FallbackMismatch();
        if (block.timestamp < uint256(fallbackAt) + FALLBACK_DELAY) revert FallbackNotReady();
        _payout(winners, amounts);
    }

    /// @notice Guardian cancels the pending fallback.
    function vetoFallback() external {
        if (msg.sender != guardian) revert NotAllowed();
        if (fallbackHash == bytes32(0)) revert NoFallback();
        _clearFallback();
        emit FallbackVetoed();
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
        _clearFallback();
        uint256 amount = prize + fee;
        token.safeTransfer(sponsor, amount);
        emit Refunded(msg.sender, amount);
    }

    /// @dev 1..MAX_WINNERS, equal lengths, no zero or excluded address, no zero amount, sum == prize.
    function _validate(address[] calldata winners, uint256[] calldata amounts) private view {
        uint256 n = winners.length;
        if (n == 0 || n > MAX_WINNERS || n != amounts.length) revert BadWinners();
        uint256 total = 0;
        for (uint256 i; i < n; ++i) {
            address w = winners[i];
            if (w == address(0) || amounts[i] == 0) revert BadWinners();
            if (
                w == sponsor || w == operator || w == treasury || w == guardian || w == address(this)
                    || w == factory || w == implementation
            ) revert ExcludedWinner();
            total += amounts[i];
        }
        if (total != prize) revert WrongTotal();
    }

    /// @dev Validates, settles state first, then transfers (checks-effects-interactions).
    function _payout(address[] calldata winners, uint256[] calldata amounts) private {
        _validate(winners, amounts);
        state = State.Awarded;
        _clearFallback();
        for (uint256 i; i < winners.length; ++i) {
            token.safeTransfer(winners[i], amounts[i]);
        }
        if (fee > 0) token.safeTransfer(treasury, fee);
        emit Awarded(winners, amounts, fee);
    }

    function _clearFallback() private {
        fallbackHash = bytes32(0);
        fallbackAt = 0;
    }
}
