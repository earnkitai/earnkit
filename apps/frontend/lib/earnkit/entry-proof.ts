import { recoverMessageAddress } from 'viem';
import { normalizeRepoUrl, parseAddresses } from './campaigns';

/**
 * The text a deploying wallet signs (EIP-191 personal_sign) to enter its contracts (v2.4 §2,
 * Ruling 23): "EarnKit entry: <program id> <repo key> <payout wallet> <contracts>", the repo key as
 * normalizeRepoUrl writes it (github.com/<owner>/<repo>, lowercase), the wallet lowercase, and the
 * entered contracts lowercase, sorted and joined with ",". A signature binds one entry: it can't be
 * replayed for another campaign, repo, payout wallet or contract set. Pure.
 */
export const entryMessage = (
  programId: string,
  repoKey: string,
  payoutWallet: string,
  contracts: string[],
) =>
  `EarnKit entry: ${programId} ${repoKey} ${payoutWallet.toLowerCase()} ${[
    ...new Set(contracts.map((c) => c.toLowerCase())),
  ]
    .sort()
    .join(',')}`;

/**
 * prepare_submission's sign_to_enter: the entry message once the repo, the payout wallet and 1 to
 * 5 well-formed contracts are known, else null (the signature binds the contract set). Pure.
 */
export function signToEnter(
  programId: string,
  repoUrl: string | undefined,
  payoutWallet: string | null,
  contractsAnswer: unknown,
) {
  const contracts = parseAddresses(contractsAnswer);
  if (!repoUrl || !payoutWallet || contracts.length < 1 || contracts.length > 5) return null;
  if (!contracts.every((c) => /^0x[0-9a-f]{40}$/.test(c))) return null;
  return entryMessage(programId, normalizeRepoUrl(repoUrl), payoutWallet, contracts);
}

/** Who signed this entry's message (lowercase), or null for a malformed signature. */
export async function entrySigner(
  programId: string,
  repoUrl: string,
  payoutWallet: string,
  contracts: string[],
  signature: string,
) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  try {
    const signer = await recoverMessageAddress({
      message: entryMessage(programId, normalizeRepoUrl(repoUrl), payoutWallet, contracts),
      signature: signature as `0x${string}`,
    });
    return signer.toLowerCase();
  } catch {
    return null;
  }
}
