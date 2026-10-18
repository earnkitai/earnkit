import { xCallback } from '../../../lib/earnkit/claim';

/** v2.12.1: Sign in with X's redirect (lib/earnkit/claim.ts xCallback). */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return xCallback(request);
}
