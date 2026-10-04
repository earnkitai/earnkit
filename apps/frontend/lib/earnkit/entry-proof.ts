import { recoverMessageAddress } from 'viem';
import { normalizeRepoUrl } from './campaigns';

/**
 * The text a deploying wallet signs (EIP-191 personal_sign) to enter its contracts for a payout
 * wallet (v2.4 §2): "EarnKit entry: <repo key> <payout wallet>", the repo key as normalizeRepoUrl
 * writes it (github.com/<owner>/<repo>, lowercase) and the wallet lowercase. Pure.
 */
export const entryMessage = (repoKey: string, payoutWallet: string) =>
  `EarnKit entry: ${repoKey} ${payoutWallet.toLowerCase()}`;

/** Who signed this repo's entry message for this payout wallet (lowercase), or null for a malformed signature. */
export async function entrySigner(repoUrl: string, payoutWallet: string, signature: string) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return null;
  try {
    const signer = await recoverMessageAddress({
      message: entryMessage(normalizeRepoUrl(repoUrl), payoutWallet),
      signature: signature as `0x${string}`,
    });
    return signer.toLowerCase();
  } catch {
    return null;
  }
}
