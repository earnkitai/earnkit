/**
 * Archived v2.12 (spec 9, archive/starters): get_program's `build_help`, the EarnKit kits and
 * starters for a program's chains. Moved out of programs.ts (it sat after the EARNKIT_ORGS
 * re-export). A real module: archive-restore.mts moves it back to
 * apps/frontend/lib/earnkit/programs-starters.ts. Then, in programs.ts:
 *   import { buildHelp } from './programs-starters';
 * and in programDetails, after `submission_url: program.submission_url,`:
 *   ...(archiveFlag('STARTER_REGISTRY') && { build_help: buildHelp(program.chains, program.campaign) }),
 */
import type { CampaignConfig } from './campaigns';
import type { Chain } from './match';

const KITS = 'https://github.com/earnkitai/chain-kits/tree/main';
export const AGENT_SERVICE_STARTER = {
  use: 'Starting point for a service other agents pay per call in USDC (x402) on Arc or Base',
  url: 'https://github.com/earnkitai/starter-agent-service',
  start: 'npx degit earnkitai/starter-agent-service my-service',
};

/** EarnKit's Base campaign starter (v2.4 §7): contracts people call directly, Builder Codes on every transaction. */
export const CAMPAIGN_STARTER = {
  use:
    "Campaign starter: a Base contract people call directly (so every user counts), with EarnKit's Builder Code on every transaction. Registering your own Builder Code at base.dev also qualifies you for Base rewards.",
  url: `${KITS}/base/campaign`,
  start: 'npx degit earnkitai/chain-kits/base/campaign my-entry',
};

/** Tested, EarnKit-maintained help for the chains a program uses. Read before building. */
export function buildHelp(chains: Chain[], campaign?: CampaignConfig | null) {
  // An EarnKit campaign scores users of the entry's contracts: only the starter that builds one.
  if (campaign?.kind === 'earnkit') return [CAMPAIGN_STARTER];
  const help: { use: string; url: string; start: string }[] = [];
  if (chains.includes('arc')) {
    help.push({
      use: 'Deploy + verify on Arc; USDC gas, 18 vs 6 decimals, 20 gwei floor',
      url: `${KITS}/arc`,
      start: 'npx degit earnkitai/chain-kits/arc/example arc-kit',
    });
  }
  if (chains.includes('base')) {
    help.push({
      use: 'Base Builder Codes (needed for Base grants): get one, attach it, check it',
      url: `${KITS}/base`,
      start: 'npx degit earnkitai/chain-kits/base/example base-kit',
    });
  }
  if (chains.includes('arc') || chains.includes('base'))
    help.push(AGENT_SERVICE_STARTER);
  return help;
}

