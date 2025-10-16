// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EarnKit Escrow (Base-optimized, stack-safe)
/// @notice Users deposit ETH to an agentId; developer withdraws net (platform fee accrued). Optional EIP-712 gasless withdraw.

contract EarnKitEscrow {
  /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/
  error NotOwner();
  error NotDeveloper();
  error AgentExists();
  error AgentUnknown();
  error ZeroAddress();
  error ZeroAmount();
  error FeeTooHigh();
  error InsufficientBalance();
  error DeadlineExpired();
  error Reentrancy();
  error Paused();

  /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
  event AgentRegistered(bytes32 indexed agentId, address indexed developer);
  event Deposit(bytes32 indexed agentId, address indexed from, uint256 amount);
  event Withdraw(
    bytes32 indexed agentId,
    address indexed developer,
    address indexed to,
    uint256 amount,
    uint256 fee,
    uint256 net
  );
  event FeesSwept(address indexed to, uint256 amount);
  event PlatformFeeUpdated(uint16 bps);
  event PlatformWalletUpdated(address wallet);
  event OwnershipTransferStarted(
    address indexed oldOwner,
    address indexed newOwner
  );
  event OwnershipTransferred(
    address indexed oldOwner,
    address indexed newOwner
  );
  event PausedSet(bool paused);

  /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

  // ownership (2-step)
  address public owner;
  address public pendingOwner;

  // platform config
  uint16 public platformFeeBps; // 2000 = 20%
  address public platformWallet;

  // circuit breaker
  bool public paused;

  // per-agent data (packed)
  struct Agent {
    address developer; // 20 bytes
    uint128 balance; // 16 bytes
    // packed into a single slot with padding
  }
  mapping(bytes32 => Agent) private agents;

  // fee accrual
  uint256 public feesAccrued;

  // EIP-712 nonces (per developer)
  mapping(address => uint256) public nonces;

  // EIP-712 domain (cached)
  bytes32 private immutable _DOMAIN_SEPARATOR;
  uint256 private immutable _CACHED_CHAIN_ID;
  // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
  bytes32 private constant _TYPE_HASH =
    keccak256(
      'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
    );
  bytes32 private constant _NAME_HASH = keccak256('AgentEscrow');
  bytes32 private constant _VERSION_HASH = keccak256('1');

  // keccak256("Withdraw(bytes32 agentId,uint256 amount,address to,uint256 nonce,uint256 deadline)")
  bytes32 private constant _WITHDRAW_TYPEHASH =
    keccak256(
      'Withdraw(bytes32 agentId,uint256 amount,address to,uint256 nonce,uint256 deadline)'
    );

  // simple nonReentrant
  uint256 private _locked = 1;

  /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
  constructor(address _platformWallet, uint16 _platformFeeBps) {
    if (_platformWallet == address(0)) revert ZeroAddress();
    if (_platformFeeBps > 10_000) revert FeeTooHigh();

    owner = msg.sender;
    platformWallet = _platformWallet;
    platformFeeBps = _platformFeeBps;

    _CACHED_CHAIN_ID = block.chainid;
    _DOMAIN_SEPARATOR = _buildDomainSeparator(
      _TYPE_HASH,
      _NAME_HASH,
      _VERSION_HASH
    );
  }

  /*//////////////////////////////////////////////////////////////
                          MODIFIERS / INTERNAL
    //////////////////////////////////////////////////////////////*/
  modifier onlyOwner() {
    if (msg.sender != owner) revert NotOwner();
    _;
  }

  modifier nonReentrant() {
    if (_locked != 1) revert Reentrancy();
    _locked = 2;
    _;
    _locked = 1;
  }

  modifier whenNotPaused() {
    if (paused) revert Paused();
    _;
  }

  function _buildDomainSeparator(
    bytes32 typeHash,
    bytes32 nameHash,
    bytes32 versionHash
  ) private view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          typeHash,
          nameHash,
          versionHash,
          block.chainid,
          address(this)
        )
      );
  }

  function DOMAIN_SEPARATOR() public view returns (bytes32) {
    return
      (block.chainid == _CACHED_CHAIN_ID)
        ? _DOMAIN_SEPARATOR
        : _buildDomainSeparator(_TYPE_HASH, _NAME_HASH, _VERSION_HASH);
  }

  /*//////////////////////////////////////////////////////////////
                           AGENT LIFECYCLE
    //////////////////////////////////////////////////////////////*/
  function registerAgent(bytes32 agentId) external whenNotPaused {
    Agent storage a = agents[agentId];
    if (a.developer != address(0)) revert AgentExists();
    a.developer = msg.sender;
    emit AgentRegistered(agentId, msg.sender);
  }

  function adminRegisterAgent(
    bytes32 agentId,
    address developer
  ) external onlyOwner {
    if (developer == address(0)) revert ZeroAddress();
    Agent storage a = agents[agentId];
    if (a.developer != address(0)) revert AgentExists();
    a.developer = developer;
    emit AgentRegistered(agentId, developer);
  }

  function developerOf(bytes32 agentId) external view returns (address) {
    address dev = agents[agentId].developer;
    if (dev == address(0)) revert AgentUnknown();
    return dev;
  }

  /*//////////////////////////////////////////////////////////////
                               DEPOSITS
    //////////////////////////////////////////////////////////////*/
  function deposit(bytes32 agentId) external payable whenNotPaused {
    Agent storage a = agents[agentId];
    if (a.developer == address(0)) revert AgentUnknown();
    uint256 amt = msg.value;
    if (amt == 0) revert ZeroAmount();

    uint256 newBal = uint256(a.balance) + amt;
    require(newBal <= type(uint128).max, 'balance overflow');
    a.balance = uint128(newBal);

    emit Deposit(agentId, msg.sender, amt);
  }

  receive() external payable {
    revert(); // enforce explicit deposit(agentId)
  }

  /*//////////////////////////////////////////////////////////////
                              WITHDRAWALS
    //////////////////////////////////////////////////////////////*/

  /// @dev Core withdraw that checks the authorized developer, updates state, transfers, and emits.
  function _authorizeAndWithdraw(
    bytes32 agentId,
    uint256 amount,
    address payable to,
    address authorizedDev
  ) private {
    Agent storage a = agents[agentId];
    if (a.developer == address(0)) revert AgentUnknown();
    if (authorizedDev != a.developer) revert NotDeveloper();
    if (to == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();

    uint128 bal = a.balance;
    if (amount > bal) revert InsufficientBalance();

    unchecked {
      a.balance = uint128(bal - amount);
    }

    // fee calc
    uint256 fee = (amount * uint256(platformFeeBps)) / 10_000;
    uint256 net = amount - fee;

    unchecked {
      feesAccrued += fee;
    }

    (bool ok, ) = to.call{value: net}('');
    require(ok, 'transfer failed');

    emit Withdraw(agentId, a.developer, to, amount, fee, net);
  }

  /// @notice Direct withdraw by the developer (pays their own gas).
  function withdraw(
    bytes32 agentId,
    uint256 amount,
    address payable to
  ) external nonReentrant whenNotPaused {
    _authorizeAndWithdraw(agentId, amount, to, msg.sender);
  }

  /// @notice Gasless withdraw with EIP-712 signature by the developer.
  function withdrawWithSig(
    bytes32 agentId,
    uint256 amount,
    address payable to,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external nonReentrant whenNotPaused {
    // Get the developer for this agent early (so we don't keep Agent storage/live locals around during sig verify)
    address dev = agents[agentId].developer;
    if (dev == address(0)) revert AgentUnknown();
    if (block.timestamp > deadline) revert DeadlineExpired();
    if (to == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();

    // Scope signature locals in a block to keep them off the stack at the callsite below.
    {
      uint256 nonce = nonces[dev];

      bytes32 structHash = keccak256(
        abi.encode(_WITHDRAW_TYPEHASH, agentId, amount, to, nonce, deadline)
      );
      // If chainId changed, DOMAIN_SEPARATOR() recomputes using the current chainId.
      bytes32 digest = keccak256(
        abi.encodePacked('\x19\x01', DOMAIN_SEPARATOR(), structHash)
      );
      address signer = ecrecover(digest, v, r, s);
      require(signer == dev, 'bad sig');

      unchecked {
        nonces[dev] = nonce + 1;
      }
    }

    // Now all signature locals are out of scope; perform the actual withdraw and emit inside.
    _authorizeAndWithdraw(agentId, amount, to, dev);
  }

  /*//////////////////////////////////////////////////////////////
                             PLATFORM ADMIN
    //////////////////////////////////////////////////////////////*/
  function sweepFees(address payable to) external onlyOwner nonReentrant {
    if (to == address(0)) revert ZeroAddress();
    uint256 amt = feesAccrued;
    if (amt == 0) return;
    feesAccrued = 0;
    (bool ok, ) = to.call{value: amt}('');
    require(ok, 'fee sweep failed');
    emit FeesSwept(to, amt);
  }

  function sweepFeesToPlatformWallet() external onlyOwner {
    address payable to = payable(platformWallet);
    if (to == address(0)) revert ZeroAddress();
    uint256 amt = feesAccrued;
    if (amt == 0) return;
    feesAccrued = 0;
    (bool ok, ) = to.call{value: amt}('');
    require(ok, 'fee sweep failed');
    emit FeesSwept(to, amt);
  }

  function setPlatformFeeBps(uint16 bps) external onlyOwner {
    if (bps > 10_000) revert FeeTooHigh();
    platformFeeBps = bps;
    emit PlatformFeeUpdated(bps);
  }

  function setPlatformWallet(address wallet) external onlyOwner {
    if (wallet == address(0)) revert ZeroAddress();
    platformWallet = wallet;
    emit PlatformWalletUpdated(wallet);
  }

  function setPaused(bool p) external onlyOwner {
    paused = p;
    emit PausedSet(p);
  }

  /*//////////////////////////////////////////////////////////////
                               READ HELPERS
    //////////////////////////////////////////////////////////////*/
  function agentBalance(bytes32 agentId) external view returns (uint256) {
    return agents[agentId].balance;
  }

  /*//////////////////////////////////////////////////////////////
                             OWNERSHIP (2-STEP)
    //////////////////////////////////////////////////////////////*/
  function transferOwnership(address newOwner) external onlyOwner {
    if (newOwner == address(0)) revert ZeroAddress();
    pendingOwner = newOwner;
    emit OwnershipTransferStarted(owner, newOwner);
  }

  function acceptOwnership() external {
    if (msg.sender != pendingOwner) revert NotOwner();
    address old = owner;
    owner = msg.sender;
    pendingOwner = address(0);
    emit OwnershipTransferred(old, owner);
  }
}
