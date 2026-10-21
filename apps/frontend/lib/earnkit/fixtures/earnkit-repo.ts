import { ProgramFile } from '../program-file';
import { matchRepo, productOdds, productScore, traction, type Detection, type ProgramFacts, type RepoFacts, type TractionFacts } from '../match';
import type { FitRepo } from '../alerts';
import type { RepoFit } from '../present';
import { committedProgram } from './program-file';

/**
 * v3.1 F1: the owner's repo, earnkitai/earnkit, as the matcher reads it: a contract with code on Base mainnet,
 * the live site earnkit.com (it loads), all six product signals, and realistic traction: 1 to 3 users (a handful
 * of transactions, under the 50 that count as measured real use), no revenue, daily commits. Product tier and
 * odds come from match.ts productScore and productOdds, never set by hand.
 */
export const EARNKIT_KEY = 'earnkitai/earnkit';
export const EARNKIT_URL = `https://github.com/${EARNKIT_KEY}`;
const CHAINS: Detection = { base: { mainnet: true, testnet: false, evidence: 'a contract with code on Base mainnet', basis: 'deployed' } };
const TRACTION: TractionFacts = { tx_count: 3, live_ok: true, commits_90d: 100 };
const SIGNALS = productScore({ active: true, young: true, original: true, readme: true, deployed: true, owned: true });
const score = traction(TRACTION);
export const EARNKIT_PRODUCT = { ...SIGNALS, traction: score, ...productOdds(SIGNALS, TRACTION, score) };

/** The repo as alerts and score remember it (installations.fit_repos). */
export const EARNKIT_FIT_REPO: FitRepo = {
  key: EARNKIT_KEY,
  name: 'earnkit',
  url: EARNKIT_URL,
  homepage: 'https://earnkit.com',
  created_at: '2025-09-01T00:00:00Z',
  chains: CHAINS,
  product: EARNKIT_PRODUCT,
  live_verified: true,
  said: null,
  tx_count: TRACTION.tx_count,
};

export const EARNKIT_FACTS: RepoFacts = {
  name: 'earnkit',
  url: EARNKIT_URL,
  homepage: 'https://earnkit.com',
  created_at: '2025-09-01T00:00:00Z',
  chains: CHAINS,
  commits_in_window: {},
  product: EARNKIT_PRODUCT,
  live_verified: true,
  claims: [],
  commits_90d: TRACTION.commits_90d,
  tx_count: TRACTION.tx_count,
  users_said: null,
};

/** A committed program file's matching facts (as programs.ts openProgramFacts reads its row). */
export function committedFacts(name: string): ProgramFacts {
  const f = ProgramFile.parse(committedProgram(name));
  return {
    id: f.id,
    title: f.title,
    chains: f.chains,
    any_chain: f.any_chain === true,
    existing_work: f.existing_work,
    tag: f.tag ?? null,
    starts_at: f.starts_at ? new Date(f.starts_at) : null,
    investment: f.investment === true,
    min_product_score: f.min_product_score ?? 0,
    match_floor: null,
  };
}

/** The repo as find's matcher returns it (a RepoFit), its verdicts from match.ts matchRepo over `programs`. */
export const earnkitRepoFit = (programs: ProgramFacts[], key = EARNKIT_KEY): RepoFit => ({
  repo: 'earnkit',
  repo_url: `https://github.com/${key}`,
  chains: ['base'],
  key,
  product: EARNKIT_PRODUCT,
  live_verified: true,
  facts: { ...EARNKIT_FACTS, url: `https://github.com/${key}` },
  verdicts: matchRepo(EARNKIT_FACTS, programs),
});

/** v3.1 F1: the owner's repo against Base Builder Grants and Alliance ALL19, the two programs the owner expects. */
export const EARNKIT_REPO_FIT: RepoFit = earnkitRepoFit([committedFacts('base-builder-grants'), committedFacts('alliance-all19')]);
