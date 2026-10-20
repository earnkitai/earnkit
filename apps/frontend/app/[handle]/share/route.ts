import { shareResponse } from '../card-response';

/** v2.12.1 spec 5: earnkit.com/<x-handle>/share records card_shared and opens X (card-response.tsx). */
export async function GET(_: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return shareResponse(handle, `/${handle}`);
}
