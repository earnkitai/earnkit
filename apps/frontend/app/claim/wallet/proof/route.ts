import { walletPost } from '../../../../lib/earnkit/wallet-proof';

/** v3.1 wallet proof: the signing page's POST ({ t, wallet, signature }); same origin, its own rate limit (wallet-proof.ts). */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return walletPost(request);
}
