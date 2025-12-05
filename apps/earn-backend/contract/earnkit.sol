// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EarnKit Escrow (Base-optimized, stack-safe, ERC-20 support)
/// @notice Users deposit ETH or ERC-20 tokens to an agentId; developer withdraws net (platform fee accrued). Optional EIP-712 gasless withdraw.

/// @dev Minimal ERC-20 interface
interface IERC20 {
  function totalSupply() external view returns (uint256);
  function balanceOf(address account) external view returns (uint256);
  function transfer(address to, uint256 amount) external returns (bool);
  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

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
  error TokenNotSupported();
  error TokenTransferFailed();

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
  
  // ERC-20 token events
  event TokenAdded(address indexed token);
  event TokenRemoved(address indexed token);
  event TokenDeposit(
    bytes32 indexed agentId,
    address indexed token,
    address indexed from,
    uint256 amount
  );
  event TokenWithdraw(
    bytes32 indexed agentId,
    address indexed token,
    address indexed developer,
    address to,
    uint256 amount,
    uint256 fee,
    uint256 net
  );
  event TokenFeesSwept(address indexed token, address indexed to, uint256 amount);

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
    uint128 balance; // 16 bytes (ETH balance)
    // packed into a single slot with padding
  }
  mapping(bytes32 => Agent) private agents;

  // ERC-20 token support
  mapping(address => bool) public supportedTokens;
  // agentId => token => balance
  mapping(bytes32 => mapping(address => uint128)) public tokenBalances;
  // token => fees accrued
  mapping(address => uint256) public tokenFeesAccrued;

  // fee accrual (ETH)
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
    
  // keccak256("WithdrawToken(bytes32 agentId,address token,uint256 amount,address to,uint256 nonce,uint256 deadline)")
  bytes32 private constant _WITHDRAW_TOKEN_TYPEHASH =
    keccak256(
      'WithdrawToken(bytes32 agentId,address token,uint256 amount,address to,uint256 nonce,uint256 deadline)'
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
                         TOKEN MANAGEMENT (ADMIN)
    //////////////////////////////////////////////////////////////*/
  
  /// @notice Add a token to the supported tokens list
  function addSupportedToken(address token) external onlyOwner {
    if (token == address(0)) revert ZeroAddress();
    supportedTokens[token] = true;
    emit TokenAdded(token);
  }
  
  /// @notice Remove a token from the supported tokens list
  function removeSupportedToken(address token) external onlyOwner {
    if (token == address(0)) revert ZeroAddress();
    supportedTokens[token] = false;
    emit TokenRemoved(token);
  }
  
  /// @notice Check if a token is supported
  function isTokenSupported(address token) external view returns (bool) {
    return supportedTokens[token];
  }

  /*//////////////////////////////////////////////////////////////
                               DEPOSITS
    //////////////////////////////////////////////////////////////*/
  
  /// @notice Deposit ETH to an agent
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
  
  /// @notice Deposit ERC-20 tokens to an agent
  /// @param agentId The agent to deposit to
  /// @param token The ERC-20 token address
  /// @param amount The amount of tokens to deposit
  function depositToken(
    bytes32 agentId,
    address token,
    uint256 amount
  ) external nonReentrant whenNotPaused {
    if (!supportedTokens[token]) revert TokenNotSupported();
    Agent storage a = agents[agentId];
    if (a.developer == address(0)) revert AgentUnknown();
    if (amount == 0) revert ZeroAmount();
    
    // Transfer tokens from sender to this contract
    uint256 balanceBefore = IERC20(token).balanceOf(address(this));
    bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
    if (!success) revert TokenTransferFailed();
    uint256 balanceAfter = IERC20(token).balanceOf(address(this));
    
    // Use actual received amount (handles fee-on-transfer tokens)
    uint256 actualAmount = balanceAfter - balanceBefore;
    if (actualAmount == 0) revert ZeroAmount();
    
    uint128 currentBal = tokenBalances[agentId][token];
    uint256 newBal = uint256(currentBal) + actualAmount;
    require(newBal <= type(uint128).max, 'balance overflow');
    tokenBalances[agentId][token] = uint128(newBal);
    
    emit TokenDeposit(agentId, token, msg.sender, actualAmount);
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
  
  /// @dev Core token withdraw that checks the authorized developer, updates state, transfers, and emits.
  function _authorizeAndWithdrawToken(
    bytes32 agentId,
    address token,
    uint256 amount,
    address to,
    address authorizedDev
  ) private {
    if (!supportedTokens[token]) revert TokenNotSupported();
    Agent storage a = agents[agentId];
    if (a.developer == address(0)) revert AgentUnknown();
    if (authorizedDev != a.developer) revert NotDeveloper();
    if (to == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();
    
    uint128 bal = tokenBalances[agentId][token];
    if (amount > bal) revert InsufficientBalance();
    
    unchecked {
      tokenBalances[agentId][token] = uint128(bal - amount);
    }
    
    // fee calc
    uint256 fee = (amount * uint256(platformFeeBps)) / 10_000;
    uint256 net = amount - fee;
    
    unchecked {
      tokenFeesAccrued[token] += fee;
    }
    
    bool success = IERC20(token).transfer(to, net);
    if (!success) revert TokenTransferFailed();
    
    emit TokenWithdraw(agentId, token, a.developer, to, amount, fee, net);
  }

  /// @notice Direct withdraw by the developer (pays their own gas).
  function withdraw(
    bytes32 agentId,
    uint256 amount,
    address payable to
  ) external nonReentrant whenNotPaused {
    _authorizeAndWithdraw(agentId, amount, to, msg.sender);
  }
  
  /// @notice Direct token withdraw by the developer (pays their own gas).
  function withdrawToken(
    bytes32 agentId,
    address token,
    uint256 amount,
    address to
  ) external nonReentrant whenNotPaused {
    _authorizeAndWithdrawToken(agentId, token, amount, to, msg.sender);
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
  
  /// @notice Gasless token withdraw with EIP-712 signature by the developer.
  function withdrawTokenWithSig(
    bytes32 agentId,
    address token,
    uint256 amount,
    address to,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external nonReentrant whenNotPaused {
    if (!supportedTokens[token]) revert TokenNotSupported();
    address dev = agents[agentId].developer;
    if (dev == address(0)) revert AgentUnknown();
    if (block.timestamp > deadline) revert DeadlineExpired();
    if (to == address(0)) revert ZeroAddress();
    if (amount == 0) revert ZeroAmount();
    
    {
      uint256 nonce = nonces[dev];
      
      bytes32 structHash = keccak256(
        abi.encode(_WITHDRAW_TOKEN_TYPEHASH, agentId, token, amount, to, nonce, deadline)
      );
      bytes32 digest = keccak256(
        abi.encodePacked('\x19\x01', DOMAIN_SEPARATOR(), structHash)
      );
      address signer = ecrecover(digest, v, r, s);
      require(signer == dev, 'bad sig');
      
      unchecked {
        nonces[dev] = nonce + 1;
      }
    }
    
    _authorizeAndWithdrawToken(agentId, token, amount, to, dev);
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
  
  /// @notice Sweep accumulated token fees to a specified address
  function sweepTokenFees(address token, address to) external onlyOwner nonReentrant {
    if (to == address(0)) revert ZeroAddress();
    uint256 amt = tokenFeesAccrued[token];
    if (amt == 0) return;
    tokenFeesAccrued[token] = 0;
    bool success = IERC20(token).transfer(to, amt);
    if (!success) revert TokenTransferFailed();
    emit TokenFeesSwept(token, to, amt);
  }
  
  /// @notice Sweep accumulated token fees to platform wallet
  function sweepTokenFeesToPlatformWallet(address token) external onlyOwner nonReentrant {
    address to = platformWallet;
    if (to == address(0)) revert ZeroAddress();
    uint256 amt = tokenFeesAccrued[token];
    if (amt == 0) return;
    tokenFeesAccrued[token] = 0;
    bool success = IERC20(token).transfer(to, amt);
    if (!success) revert TokenTransferFailed();
    emit TokenFeesSwept(token, to, amt);
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
  
  /// @notice Get the token balance for an agent
  function agentTokenBalance(bytes32 agentId, address token) external view returns (uint256) {
    return tokenBalances[agentId][token];
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
