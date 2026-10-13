import { archiveFlag } from './builder-score-flag';

/** v2.12 spec 9: campaign.mts subcommands that write sponsor_campaigns. Null when allowed, else the one-line refusal. */
export function sponsorCommandBlock(command: string, env: Record<string, string | undefined> = process.env): string | null {
  if (command !== 'refund' && command !== 'fallback') return null;
  return archiveFlag('SPONSOR_CAMPAIGNS', env)
    ? null
    : `pnpm campaign ${command} is for sponsor campaigns, which are archived (set EARNKIT_SPONSOR_CAMPAIGNS=on; see archive/sponsor-campaigns/README.md).`;
}
