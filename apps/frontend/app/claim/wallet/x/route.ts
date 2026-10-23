import { walletXStart } from '../../../../lib/earnkit/wallet-proof';

/** v3.1 wallet proof fix round: the X sign-in that lets a link change an existing reward wallet (wallet-proof.ts walletXStart). */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return walletXStart(request);
}
