/**
 * v2.12.1 spec "Identity": confirmed is "apps EarnKit hosts or deploys, contracts deployed by
 * EarnKit or by a wallet that signed once on the claim page, a GitHub account proven by sign-in or
 * proof line or whose public X field matches the confirmed X, and what that GitHub account links
 * (repo homepages and Pages sites)". Pure.
 */
export const CONFIRMED_PROOFS: ReadonlySet<string> = new Set([
  'github_signin', 'proof_line', 'repo_owner', 'repo_link', 'deployer', 'deploy_wallet', 'wallet_signed', 'earnkit_hosted', 'x_match', 'proof_branch',
  // v2.14 spec 2: the read-only GitHub App's install (repo-proof.ts proveByApp), the only new repo proof.
  'github_app',
]);
export const isConfirmedProof = (p: string | null | undefined): boolean => p != null && CONFIRMED_PROOFS.has(p);

/**
 * Owner batch 2026-10-23 (reverses plan S9 for sites): a site proven by its own earnkit.txt (the person's
 * `profile:` code) or a DNS TXT record is confirmed, so it counts toward the Shipping score. Only for a site
 * source: these proofs say nothing about a repo, a package or a contract.
 */
export const SITE_PROOFS: ReadonlySet<string> = new Set(['earnkit_txt', 'dns_txt']);
/** The proofs that confirm a site source: the confirmed proofs and the site proofs. */
export const CONFIRMED_SITE_PROOFS: readonly string[] = [...CONFIRMED_PROOFS, ...SITE_PROOFS];
/** Whether a verified source's proof confirms it (a site proof only for a site). Pure. */
export const isConfirmedSource = (s: { kind: string; proof: string | null | undefined }): boolean =>
  isConfirmedProof(s.proof) || (s.kind === 'site' && s.proof != null && SITE_PROOFS.has(s.proof));
