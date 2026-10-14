import { walletGet, walletPost } from '../../../lib/earnkit/wallet-proof';

/** v2.12.1 T7: the claim page's optional wallet signature (GET the page, POST the signature), lib/earnkit/wallet-proof.ts. 404 with the flag off. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return walletGet(request);
}

export async function POST(request: Request) {
  return walletPost(request);
}
