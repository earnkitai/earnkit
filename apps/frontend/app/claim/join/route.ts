import { claimJoinPost } from '../../../lib/earnkit/claim';

/** v2.13.4 (R1): the claim page's one button for an X account that already has a page. 404 without the Bench. */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return claimJoinPost(request);
}
