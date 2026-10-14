import { builderScoreEnabled } from '../../../lib/earnkit/builder-score-flag';
import { shareResponse } from '../card-response';

/** v2.12.1 spec 5: earnkit.com/<x-handle>/share records card_shared and opens X (card-response.tsx). Flag off: 404. */
export async function GET(_: Request, { params }: { params: Promise<{ handle: string }> }) {
  if (!builderScoreEnabled()) return new Response('Not found', { status: 404 });
  const { handle } = await params;
  return shareResponse(handle, `/${handle}`);
}
