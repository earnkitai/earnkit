import { walletGet, walletOtherMethod, walletPost } from '../../../lib/earnkit/wallet-proof';

/** v2.12.1 T7: the claim page's optional wallet signature (GET the page, POST the signature), lib/earnkit/wallet-proof.ts. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return walletGet(request);
}

export async function POST(request: Request) {
  return walletPost(request);
}

/** Final fix wave: every other method is a 405 that still carries frame-ancestors (wallet-proof.ts walletOtherMethod). */
export async function PUT() {
  return walletOtherMethod();
}

export async function PATCH() {
  return walletOtherMethod();
}

export async function DELETE() {
  return walletOtherMethod();
}
