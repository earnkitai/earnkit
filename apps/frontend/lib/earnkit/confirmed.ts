/**
 * v2.12.1 spec "Identity": confirmed is "apps EarnKit hosts or deploys, contracts deployed by
 * EarnKit or by a wallet that signed once on the claim page, a GitHub account proven by sign-in or
 * proof line or whose public X field matches the confirmed X, and what that GitHub account links
 * (repo homepages and Pages sites)". earnkit_txt and dns_txt (v2.12 site proofs) are not in the
 * list (plan S9): those rows show as not yet confirmed. Pure.
 */
export const CONFIRMED_PROOFS: ReadonlySet<string> = new Set([
  'github_signin', 'proof_line', 'repo_owner', 'repo_link', 'deployer', 'deploy_wallet', 'wallet_signed', 'earnkit_hosted', 'x_match',
]);
export const isConfirmedProof = (p: string | null | undefined): boolean => p != null && CONFIRMED_PROOFS.has(p);
