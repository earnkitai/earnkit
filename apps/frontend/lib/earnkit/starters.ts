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
 * `view_total`: one eth_call of the contract's own running-total view (`usage_view`), exact since
 * the deploy (ruling R-T6).
 * `recent_logs`: count `usage_event` over the recent window of blocks, for a contract that keeps no
 * total (and the fallback when a view_total contract's view answers nothing).
 */
export type UsageRead = 'recent_logs' | 'view_total';

/**
 * A `view_total` starter's view: its signature, its 4-byte selector, and the name of each uint256
 * word it returns, in order.
 */
export type UsageView = { call: string; selector: `0x${string}`; words: readonly string[] };

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
  /** Required with `view_total`. */
  usage_view?: UsageView;
  /** YYYY-MM-DD of the last passing starter test (`test_cmd`); null until it has passed once. */
  tested_at: string | null;
  /** The starter repo's own test: zero to deployable, owner() set, one usage call. */
  test_cmd: string;
};
export type StarterId = Starter['id'];

export const STARTERS: Record<StarterId, Starter> = {
  /**
   * Arc Microgrants. chain-kits `arc/tipjar` (main at 0f573a7, merged 2026-10-11; v2.11 T6 report):
   * - `src/UsdcTipJar.sol`: `constructor(address owner_, string name_, uint256 minTip_)` (owner is
   *   the builder, so no transfer), `tip(uint256 amount, string note)`, and
   *   `event Tipped(address indexed from, uint256 amount, string note)`;
   * - running totals (ruling R-T6): `stats()` returns (tips, total in USDC base units, unique
   *   tippers), selector 0xd80528ae, so a usage check is one eth_call;
   * - `site/` is the static tip page EarnKit hosts; `twist.json` holds the name, description and
   *   feature slots; `scripts/e2e.sh` is the zero-to-deployable test (forge test, anvil deploy with
   *   the builder as owner, one tip, the site zip and EarnKit's deploy and host checks). It passed on
   *   2026-10-11, and two timed fresh-agent runs reached it in about 70 and 64 seconds.
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
    usage_read: 'view_total',
    usage_view: { call: 'stats()', selector: '0xd80528ae', words: ['tips', 'total', 'tippers'] },
    tested_at: '2026-10-11',
    test_cmd: 'bash scripts/e2e.sh',
  },
};
