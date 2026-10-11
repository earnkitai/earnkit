/**
 * v2.11 spec 2: the starter registry. A starter is a small app EarnKit's builders' agents copy and
 * twist for a fresh build: a contract EarnKit deploys (capped, the builder's wallet as owner) and a
 * static site EarnKit hosts. Pure data, import-free. A program names its starter with the owner-set
 * program file field `fresh_build: { starter }` (program-file.ts freshBuildProblems).
 *
 * The bar: a fresh agent goes from zero to deployable in under an hour, proved by the starter
 * repo's own test (`test_cmd`). `tested_at` is the day that test last passed, and stays null until
 * it has: `pnpm programs:check` refuses a program naming an untested starter, or one whose test is
 * more than 30 days older than the program's `verified_at`.
 *
 * Owner decision 4 (2026-10-10): no x402 build path. The Base starter (`base-checkin`, chain-kits
 * `base/campaign` `Checkin.sol` plus a static page) is registered only once a Base program
 * qualifies for a fresh build and its test passes. Neither holds today, so it is left out.
 */

/** Chains EarnKit deploys starters to (deploy.ts: Arc and Base). */
export type StarterChain = 'arc' | 'base';

/**
 * How a starter's use is read by the 30 and 90 day usage checks (events.ts usageChecks).
 * `recent_logs`: count `usage_event` over the recent window of blocks (the contract keeps no total).
 * `view_total`: read the contract's own running-total views (ruling R-T6: the T6 arc-tipjar adds
 * `tipCount` and `totalTipped`; switch arc-tipjar to it when that starter ships).
 */
export type UsageRead = 'recent_logs' | 'view_total';

export type Starter = {
  id: 'arc-tipjar';
  chain: StarterChain;
  /** The degit path builders' agents copy, e.g. 'earnkitai/chain-kits/arc/tipjar'. */
  repo: string;
  /** Builder copy, mid-sentence and lower case: 'a USDC tip page on Arc'. */
  what: string;
  /** The bar: zero to deployable within this many minutes. */
  minutes: 60;
  /** The Foundry artifact EarnKit deploys, and whether the owner is its constructor argument. */
  contract: { artifact: string; owner_arg: boolean };
  /** The static output to zip and host, relative to the starter's folder. */
  site_dir: string;
  /** The event signature that counts as use (canonical types, no names or `indexed`). */
  usage_event: string;
  usage_read: UsageRead;
  /** YYYY-MM-DD of the last passing starter test (`test_cmd`); null until it has passed once. */
  tested_at: string | null;
  /** The starter repo's own test: zero to deployable, owner() set, one usage call. */
  test_cmd: string;
};
export type StarterId = Starter['id'];

export const STARTERS: Record<StarterId, Starter> = {
  /**
   * Arc Microgrants. The contract is the chain-kits `arc/example/src/UsdcTipJar.sol` (main at
   * b068976): `constructor(address owner_)`, `tip(uint256 amount, string note)`, and
   * `event Tipped(address indexed from, uint256 amount, string note)`; tested on Arc testnet
   * 2026-09-29. The starter around it (`arc/tipjar`: the static tip page, the twist slots, `site/`
   * and `scripts/e2e.sh`) is T6's (v2.11 plan), so `repo`, `site_dir` and `test_cmd` are the plan's
   * paths and `tested_at` stays null until T6's one-hour test passes. Usage: STARTER_USAGE in
   * events.ts, the recent window of `Tipped` logs, until T6's view counters ship (ruling R-T6).
   */
  'arc-tipjar': {
    id: 'arc-tipjar',
    chain: 'arc',
    repo: 'earnkitai/chain-kits/arc/tipjar',
    what: 'a USDC tip page on Arc',
    minutes: 60,
    contract: { artifact: 'UsdcTipJar', owner_arg: true },
    site_dir: 'site',
    usage_event: 'Tipped(address,uint256,string)',
    usage_read: 'recent_logs',
    tested_at: null,
    test_cmd: 'forge test && scripts/e2e.sh',
  },
};
