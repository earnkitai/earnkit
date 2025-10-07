// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract EarnKitAgentVault {
  // ---------- Errors ----------
  error NotOwner();
  error Paused();
  error ZeroAddress();
  error InvalidAmount();
  error InsufficientBalance();
  error TransferFailed();
  error Expired();
  error InvalidSigner();

  // ---------- Admin / Config ----------
  address public owner;
  address public platformWalletSigner; // receives fees AND signs withdrawal authorizations
  uint256 public feePoints; // points ( /1000 ) 25% => 250
  uint256 public constant FEE_DENOMINATOR = 1000;
  uint256 public constant MAX_FEE_POINTS = 1000;

  bool public paused;

  // ---------- Accounting ----------
  mapping(bytes32 => uint256) public agentBalance;
  mapping(bytes32 => uint256) public totalDeposited;
  mapping(bytes32 => uint256) public totalWithdrawn;
  mapping(address => uint256) public nonces; // per-developer

  // ---------- Events ----------
  event OwnershipTransferred(
    address indexed oldOwner,
    address indexed newOwner
  );
  event PlatformWalletSignerUpdated(
    address indexed oldAddr,
    address indexed newAddr
  );
  event FeeUpdated(uint256 oldFeePoints, uint256 newFeePoints);
  event PausedStateChanged(bool paused);

  event Deposit(address indexed from, bytes32 indexed agentId, uint256 amount);
  event WithdrawAuthorized(
    address indexed developer,
    bytes32 indexed agentId,
    uint256 gross,
    uint256 fee,
    uint256 net,
    address indexed to
  );

  // ---------- Reentrancy Guard ----------
  uint256 private _entered; // 0 = not entered, 1 = entered
  modifier nonReentrant() {
    require(_entered == 0, 'REENTRANCY');
    _entered = 1;
    _;
    _entered = 0;
  }

  // ---------- Modifiers ----------
  modifier onlyOwner() {
    if (msg.sender != owner) revert NotOwner();
    _;
  }
  modifier whenNotPaused() {
    if (paused) revert Paused();
    _;
  }

  // ---------- EIP-712 Domain ----------
  // EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
  bytes32 private constant _EIP712_DOMAIN_TYPEHASH =
    keccak256(
      'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
    );

  // Withdraw(bytes32 agentId,address developer,address to,uint256 amount,uint256 nonce,uint256 deadline)
  bytes32 private constant _WITHDRAW_TYPEHASH =
    keccak256(
      'Withdraw(bytes32 agentId,address developer,address to,uint256 amount,uint256 nonce,uint256 deadline)'
    );

  bytes32 private constant _NAME_HASH = keccak256(bytes('EarnKitAgentVault'));
  bytes32 private constant _VERSION_HASH = keccak256(bytes('1'));

  function _domainSeparator() private view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          _EIP712_DOMAIN_TYPEHASH,
          _NAME_HASH,
          _VERSION_HASH,
          block.chainid,
          address(this)
        )
      );
  }

  // ---------- Constructor ----------
  constructor(address _platformWalletSigner, uint256 _feePoints) {
    if (_platformWalletSigner == address(0)) revert ZeroAddress();
    if (_feePoints > MAX_FEE_POINTS) revert InvalidAmount();
    owner = msg.sender;
    platformWalletSigner = _platformWalletSigner;
    feePoints = _feePoints;
  }

  // ---------- Admin ----------
  function transferOwnership(address newOwner) external onlyOwner {
    if (newOwner == address(0)) revert ZeroAddress();
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
  }

  function setPlatformWalletSigner(address newAddr) external onlyOwner {
    if (newAddr == address(0)) revert ZeroAddress();
    emit PlatformWalletSignerUpdated(platformWalletSigner, newAddr);
    platformWalletSigner = newAddr;
  }

  function setFeePoints(uint256 newFeePoints) external onlyOwner {
    if (newFeePoints > MAX_FEE_POINTS) revert InvalidAmount();
    emit FeeUpdated(feePoints, newFeePoints);
    feePoints = newFeePoints;
  }

  function setPaused(bool _paused) external onlyOwner {
    paused = _paused;
    emit PausedStateChanged(_paused);
  }

  // ---------- Deposit ----------
  function deposit(bytes32 agentId) external payable whenNotPaused {
    if (msg.value == 0) revert InvalidAmount();
    agentBalance[agentId] += msg.value;
    totalDeposited[agentId] += msg.value;
    emit Deposit(msg.sender, agentId, msg.value);
  }

  // ---------- Withdraw (off-chain authorized) ----------
  function withdrawWithAuthorization(
    bytes32 agentId,
    uint256 amount,
    address to,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external nonReentrant whenNotPaused {
    address developer = msg.sender;
    if (to == address(0)) revert ZeroAddress();
    if (amount == 0) revert InvalidAmount();
    if (block.timestamp > deadline) revert Expired();

    // Verify signature & consume nonce in its own frame (reduces locals here)
    _verifyAndConsumeNonce(agentId, amount, developer, to, deadline, v, r, s);

    // Effects
    uint256 bal = agentBalance[agentId];
    if (bal < amount) revert InsufficientBalance();
    agentBalance[agentId] = bal - amount;
    totalWithdrawn[agentId] += amount;

    // Fee math (points / 1000)
    uint256 fee = (amount * feePoints) / FEE_DENOMINATOR;
    uint256 net = amount - fee;

    // Interactions
    _pay(platformWalletSigner, fee);
    _pay(to, net);

    emit WithdrawAuthorized(developer, agentId, amount, fee, net, to);
  }

  // ---------- Internal helpers (reduce “stack too deep”) ----------
  function _verifyAndConsumeNonce(
    bytes32 agentId,
    uint256 amount,
    address developer,
    address to,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) internal {
    uint256 nonce = nonces[developer];

    bytes32 structHash = keccak256(
      abi.encode(
        _WITHDRAW_TYPEHASH,
        agentId,
        developer,
        to,
        amount,
        nonce,
        deadline
      )
    );
    bytes32 digest = keccak256(
      abi.encodePacked('\x19\x01', _domainSeparator(), structHash)
    );
    address recovered = ecrecover(digest, v, r, s);
    if (recovered == address(0) || recovered != platformWalletSigner)
      revert InvalidSigner();

    // consume nonce last to avoid accidental state changes before all checks pass
    nonces[developer] = nonce + 1;
  }

  function _pay(address to, uint256 amount) internal {
    if (amount == 0) return;
    (bool ok, ) = payable(to).call{value: amount}('');
    if (!ok) revert TransferFailed();
  }

  // ---------- Views / Helpers ----------
  function quoteWithdrawal(
    uint256 amount
  ) external view returns (uint256 fee, uint256 net) {
    fee = (amount * feePoints) / FEE_DENOMINATOR;
    net = amount - fee;
  }

  function getAgentBalance(bytes32 agentId) external view returns (uint256) {
    return agentBalance[agentId];
  }

  function computeAgentId(
    string memory slugOrUuid
  ) external pure returns (bytes32) {
    return keccak256(abi.encodePacked(slugOrUuid));
  }

  // ---------- Safety ----------
  function rescue(address to, uint256 amount) external onlyOwner {
    if (to == address(0)) revert ZeroAddress();
    (bool ok, ) = payable(to).call{value: amount}('');
    if (!ok) revert TransferFailed();
  }

  receive() external payable {
    revert('Use deposit(agentId)');
  }
  fallback() external payable {
    revert('Invalid call');
  }
}
