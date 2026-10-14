import { claimGet, claimPost } from '../../../lib/earnkit/claim';

/** v2.12.1: the claim page (GET) and its button (POST), lib/earnkit/claim.ts. 404 with the flag off. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return claimGet(request, (await params).code);
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  return claimPost(request, (await params).code);
}
