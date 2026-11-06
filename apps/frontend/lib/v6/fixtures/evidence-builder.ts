/**
 * A minimal valid Evidence for pure tests: nothing read, not partial. `evidence()` takes overrides,
 * `contract()` and `codeRows()` build one block from a few fields. Test only.
 */
import type { CodeRows } from '../code';
import type { Evidence } from '../evidence';
import type { LiveRows } from '../live';
import type { OnchainRows } from '../onchain';
import type { TeamRows } from '../team';

export const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

export const liveRows = (o: Partial<LiveRows> = {}): LiveRows => ({
  url: null, url_ok: null, status: null, is_app: null, domain: null, domain_age_days: null, title: null, github_links: [], note: null, ...o,
});
export const contract = (o: Partial<OnchainRows> = {}): OnchainRows => ({
  chain: 'base', address: `0x${'1'.repeat(40)}`, mainnet: true, is_contract: true, verified_source: true, deployer: null,
  deployed_at: null, deployer_matches_repo: null, tx_90d: 0, senders_90d: 0, senders_30d: 0, funded_senders_90d: 0,
  funded_sample: 0, first_tx_at: null, counted: true, counted_reason: 'listed by the applicant', note: null, ...o,
});
export const codeRows = (o: Partial<CodeRows> = {}): CodeRows => ({
  fork_of: null, template_overlap: null, template_name: null, own_share: null, commits_own: null, files_own: null,
  first_commit_at: null, last_push_at: null, commits_90d: 0, active_weeks_90d: 0, releases: 0, has_tests: false, has_ci: false, issues_open: 0, issues_answered_90d: 0, note: null,
  // Unless a test says otherwise, the 90-day commits all fall inside 60 days.
  ...o, commits_60d: o.commits_60d !== undefined ? o.commits_60d : o.commits_90d !== undefined ? o.commits_90d : 0,
});
export const teamRows = (o: Partial<TeamRows> = {}): TeamRows => ({
  contributors_90d: 1, top_share: 1, account_ages_days: [], prior_repos_used: 0, logins: [], note: null, ...o,
});
export function evidence(o: Partial<Evidence> = {}): Evidence {
  return {
    repo: null, live: liveRows(), onchain: [], code: null, team: null, depth: null, rows: [],
    reads: { github: 0, explorer: 0, site: 0 }, partial: false, read_at: NOW.toISOString(), notes: [],
    read_times: { repo: null, onchain: [] }, ...o,
  };
}
