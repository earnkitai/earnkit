/**
 * v2.10.1 fix round 1 (I1): shared Base contracts that are never one builder's own deployment, so
 * they never count as a repo's contract, its deploy or its real use (lowercase). Import-free.
 *
 * - Clanker v4 and the Uniswap v4 PoolManager, as traction.ts CLANKER_ADDRESSES lists them (a test
 *   keeps the two in step).
 * - Uniswap v2, v3 and v4 periphery on Base, the Universal Routers and Permit2
 *   (docs.uniswap.org/contracts/v4/deployments, v3 and v2 deployment pages).
 * - WETH, USDC and Multicall3; the ERC-4337 EntryPoints v0.6 and v0.7.
 * - The 0x Exchange Proxy, the 1inch v5 and v6 routers and the Aerodrome router.
 */
export const SHARED_BASE_CONTRACTS: ReadonlySet<string> = new Set(
  [
    // Clanker v4 on Base and the Uniswap v4 PoolManager (traction.ts CLANKER_ADDRESSES).
    '0x498581ff718922c3f8e6a244956af099b2652b2b', // Uniswap v4 PoolManager
    '0xe85a59c628f7d27878aceb4bf3b35733630083a9', // Clanker v4 factory
    '0xffa37784d619f228d8b379d287a4d7282e500762', // Clanker LP locker
    '0x63d2dfea64b3433f4071a98665bcd7ca14d93496', // Clanker LP locker (older)
    '0x8e845ead15737bf71904a30bddd3aee76d6adf6c', // vault
    '0xf652b3610d75d81871bf96db50825d9af28391e0', // airdrop
    '0x1331f0788f9c08c8f38d52c7a1152250a9de00be', // dev buy
    '0xfdc013ce003980889cffd66b0c8329545ae1d1e8', // MEV module
    '0xebb25bb797d82cb78e1bc70406b13233c0854413', // MEV module v2
    '0xf3622742b1e446d92e45e22923ef11c2fcd55d68', // FeeLocker
    '0xdd5eeaff7bd481ad55db083062b13a3cdf0a68cc', // static fee hook
    '0xb429d62f8f3bffb98cdb9569533ea23bf0ba28cc', // static fee hook v2
    '0x34a45c6b61876d739400bd71228cbcbd4f53e8cc', // dynamic fee hook
    '0xd60d6b218116cfd801e28f78d011a203d2b068cc', // dynamic fee hook v2
    '0xeebbc567c3d612f50a67820f39cdd30dccf7e6b8', // presale
    '0x789c2452353eee400868e7d3e5add6be0ef4185d', // presale allowlist
    // Uniswap v4 periphery on Base.
    '0x7c5f5a4bbd8fd63184577525326123b519429bdc', // PositionManager
    '0x0d5e0f971ed27fbff6c2837bf31316121532048d', // V4Quoter
    '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71', // StateView
    '0x6ff5693b99212da76ad316178a184ab56d299b43', // Universal Router (v4)
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Universal Router (v3)
    '0x000000000022d473030f116ddee9f6b43ac78ba3', // Permit2
    // Uniswap v3 and v2 on Base.
    '0x2626664c2603336e57b271c5c0b26f421741e481', // SwapRouter02
    '0x33128a8fc17869897dce68ed026d694621f6fdfd', // v3 factory
    '0x03a520b32c04bf3beef7beb72e919cf822ed34f1', // v3 NonfungiblePositionManager
    '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a', // v3 QuoterV2
    '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // v2 router
    '0x8909dc15e40173ff4699343b6eb8132c65e18ec6', // v2 factory
    // Tokens and infrastructure.
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0xca11bde05977b3631167028862be2a173976ca11', // Multicall3
    '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', // ERC-4337 EntryPoint v0.6
    '0x0000000071727de22e5e9d8baf0edac6f37da032', // ERC-4337 EntryPoint v0.7
    // Aggregators and other DEX routers.
    '0xdef1c0ded9bec7f1a1670819833240f027b25eff', // 0x Exchange Proxy
    '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch v5 router
    '0x111111125421ca6dc452d289314280a0f8842a65', // 1inch v6 router
    '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43', // Aerodrome router
  ].map((a) => a.toLowerCase()),
);

/** v2.10.1 (I1): an address that is a shared Base contract, never a builder's own. Pure. */
export const sharedContract = (address: string): boolean => SHARED_BASE_CONTRACTS.has(address.toLowerCase());

/**
 * v2.12.1: the shared contracts a coin is bought from (pools, routers, aggregators). A transfer out
 * of one is a buy; one out of a locker, vault, airdrop, presale or the dev buy is not a trade.
 */
const TRADE_VENUES: ReadonlySet<string> = new Set([
  '0x498581ff718922c3f8e6a244956af099b2652b2b', // Uniswap v4 PoolManager
  '0x6ff5693b99212da76ad316178a184ab56d299b43', // Universal Router (v4)
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad', // Universal Router (v3)
  '0x000000000022d473030f116ddee9f6b43ac78ba3', // Permit2
  '0x2626664c2603336e57b271c5c0b26f421741e481', // SwapRouter02
  '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // v2 router
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff', // 0x Exchange Proxy
  '0x1111111254eeb25477b68fb85ed929f73a960582', // 1inch v5 router
  '0x111111125421ca6dc452d289314280a0f8842a65', // 1inch v6 router
  '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43', // Aerodrome router
]);

/** v2.12.1: a pool or router a coin is bought from (a subset of SHARED_BASE_CONTRACTS). Pure. */
export const tradeVenue = (address: string): boolean => TRADE_VENUES.has(address.toLowerCase());
